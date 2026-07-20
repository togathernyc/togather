/**
 * AuthErrorBoundary — recovers from a COMMUNITY_ARCHIVED query error instead
 * of crashing to the app-root ErrorBoundary.
 *
 * Background: `convex/react`'s `useQuery` re-throws query errors during
 * render (that's how the library surfaces them — there's no error return
 * value to check, so a try/catch around a hook call can't intercept this).
 * Some queries are mounted unconditionally as soon as an auth token exists —
 * e.g. NotificationProvider's `unreadCount` — so if the token is scoped to a
 * community that gets archived (closed) via admin Settings while the token is
 * still live (access tokens last 30 days), the strict `requireAuth` gate
 * throws `ConvexError("COMMUNITY_ARCHIVED")` on the very next render and the
 * app hard-crashes to the generic "Something went wrong" screen with no way
 * out, because the app-root ErrorBoundary sits ABOVE AuthProvider and has no
 * way to recover the session.
 *
 * This boundary sits INSIDE the provider tree, below AuthProvider, so it can
 * call `exitToCommunitySelection()` (re-mints a community-less token, wipes
 * per-community caches) and route the user back to community selection
 * instead of dead-ending. Any other error is re-thrown from
 * `getDerivedStateFromError` so it keeps propagating to the app-root
 * ErrorBoundary unchanged — this boundary only ever handles the one error
 * shape it knows how to recover from.
 *
 * The Convex-side comments referencing a mobile `AuthErrorBoundary` (see
 * apps/convex/lib/auth.ts, apps/convex/functions/scheduling/permissions.ts)
 * anticipated this component; today it's scoped to COMMUNITY_ARCHIVED only.
 */
import React from 'react';
import { router } from 'expo-router';
import { useAuth } from './AuthProvider';
import { isCommunityArchivedError } from '@services/api/convex';

interface Props {
  children: React.ReactNode;
  /** Injected by the AuthErrorBoundary wrapper so the class body can stay hook-free. */
  onCommunityArchived: () => Promise<void>;
}

interface State {
  isRecovering: boolean;
}

class AuthErrorBoundaryClass extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { isRecovering: false };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    if (!isCommunityArchivedError(error)) {
      // Not ours to handle — rethrow so the error keeps bubbling to the
      // nearest ancestor boundary (the app-root ErrorBoundary).
      throw error;
    }
    return { isRecovering: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(
      '[AuthErrorBoundary] Recovering from archived-community session:',
      error,
    );
    this.recover();
  }

  private recover = async () => {
    try {
      await this.props.onCommunityArchived();
    } catch (recoveryError) {
      console.error('[AuthErrorBoundary] Recovery failed:', recoveryError);
    }
    // The archived community is no longer selected (token re-minted,
    // per-community caches wiped) — send the user back to pick a community.
    router.replace('/(auth)/select-community');
    this.setState({ isRecovering: false });
  };

  render() {
    // Render nothing while recovering rather than the children (which would
    // immediately re-throw with the same still-archived token) or a fallback
    // screen (recovery is near-instant and this is a rare edge case, not
    // worth a dedicated UI).
    if (this.state.isRecovering) {
      return null;
    }

    return this.props.children;
  }
}

export function AuthErrorBoundary({ children }: { children: React.ReactNode }) {
  const { exitToCommunitySelection } = useAuth();

  return (
    <AuthErrorBoundaryClass onCommunityArchived={exitToCommunitySelection}>
      {children}
    </AuthErrorBoundaryClass>
  );
}
