/**
 * Regression tests for the AuthErrorBoundary redesign (see the file-level
 * comment on ../AuthErrorBoundary.tsx for the defects this fixes):
 *
 * 1. The fallback must never render `null` (that would unmount the
 *    Navigator living in `children`) — it always renders an explicit
 *    "Switching community…" view while recovery is in flight.
 * 2. A failed recovery must not loop silently — it's capped at
 *    MAX_RECOVERY_ATTEMPTS and then hands the original error off to the
 *    nearest ancestor error boundary instead of retrying forever.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// jest.setup.js registers a global stand-in for @services/api/convex that
// doesn't export isCommunityArchivedError — unmock so getDerivedStateFromError
// exercises the real classifier this boundary depends on.
jest.unmock('@services/api/convex');

import { AuthErrorBoundary } from '../AuthErrorBoundary';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

const mockUseAuth = jest.fn();
jest.mock('../AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

/** Throws the archived-community shape convex/react reconstructs client-side, while `shouldThrowRef.current` is true. */
function ThrowingChild({ shouldThrowRef }: { shouldThrowRef: { current: boolean } }) {
  if (shouldThrowRef.current) {
    throw { data: 'COMMUNITY_ARCHIVED', message: 'ConvexError: COMMUNITY_ARCHIVED' };
  }
  return <Text testID="child-ok">ok</Text>;
}

/** Minimal ancestor boundary standing in for the app-root ErrorBoundary, to assert a give-up rethrow is actually caught above this boundary. */
class OuterTestBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return <Text testID="outer-caught">caught</Text>;
    }
    return this.props.children;
  }
}

describe('AuthErrorBoundary', () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it('never renders null while recovering, and only navigates after children have remounted', async () => {
    const shouldThrow = { current: true };
    const exitToCommunitySelection = jest.fn(async () => {
      // Simulate the token now being fixed, same as the real
      // exitToCommunitySelection() re-minting a community-less token so the
      // next render of children no longer throws.
      shouldThrow.current = false;
      return true;
    });
    mockUseAuth.mockReturnValue({ exitToCommunitySelection });

    const { queryByText, findByTestId } = render(
      <AuthErrorBoundary>
        <ThrowingChild shouldThrowRef={shouldThrow} />
      </AuthErrorBoundary>
    );

    // Fallback is an explicit view, never null.
    expect(queryByText('Switching community…')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    // Children (the Navigator's stand-in here) remount once recovery succeeds.
    await findByTestId('child-ok');

    // Navigation only fires after that remount has committed.
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/select-community')
    );
    expect(exitToCommunitySelection).toHaveBeenCalledTimes(1);
  });

  it('caps recovery at 2 attempts and rethrows to the ancestor boundary instead of looping', async () => {
    const shouldThrow = { current: true };
    const exitToCommunitySelection = jest.fn(async () => false); // always fails, like a persistent network error
    mockUseAuth.mockReturnValue({ exitToCommunitySelection });

    const { findByText, getByText, findByTestId } = render(
      <OuterTestBoundary>
        <AuthErrorBoundary>
          <ThrowingChild shouldThrowRef={shouldThrow} />
        </AuthErrorBoundary>
      </OuterTestBoundary>
    );

    // First (automatic) attempt fails -> explicit retry view, not a silent loop.
    await findByText("Couldn't switch communities");
    expect(exitToCommunitySelection).toHaveBeenCalledTimes(1);

    fireEvent.press(getByText('Try again'));

    // Second attempt also fails -> cap reached -> original error rethrown ->
    // caught by the ancestor boundary, not swallowed or looped forever.
    await findByTestId('outer-caught');
    expect(exitToCommunitySelection).toHaveBeenCalledTimes(2);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
