/**
 * Tests for KingdomCityMigrationNotice — the one-time sheet telling members of
 * the KingdomCity community that its groups are moving to
 * kingdomcity.com/connect.
 */
import React from 'react';
import { Linking } from 'react-native';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  KingdomCityMigrationNotice,
  KINGDOMCITY_CONNECT_URL,
  isKingdomCityCommunity,
  dismissedStorageKey,
} from '../KingdomCityMigrationNotice';

const mockUseAuth = jest.fn();
jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('expo-router', () => ({
  usePathname: () => '/(tabs)/chat',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

const TITLE = 'KingdomCity is moving';

function authFor(communityName: string | undefined, overrides: Record<string, unknown> = {}) {
  return {
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'user-1', date_of_birth: '1990-01-01' },
    community: communityName ? { id: 'community-1', name: communityName } : null,
    ...overrides,
  };
}

describe('isKingdomCityCommunity', () => {
  it.each(['KingdomCity', 'Kingdom City', 'kingdomcity nyc', 'KingdomCity Church'])(
    'matches %s',
    (name) => {
      expect(isKingdomCityCommunity(name)).toBe(true);
    },
  );

  it.each([undefined, '', 'Demo Community', 'City Kingdom', 'The Kingdom'])(
    'does not match %s',
    (name) => {
      expect(isKingdomCityCommunity(name)).toBe(false);
    },
  );
});

describe('KingdomCityMigrationNotice', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('shows the notice to someone in the KingdomCity community', async () => {
    mockUseAuth.mockReturnValue(authFor('KingdomCity'));
    render(<KingdomCityMigrationNotice />);
    expect(await screen.findByText(TITLE)).toBeTruthy();
    expect(screen.getByText('Join new groups')).toBeTruthy();
  });

  it('shows nothing in other communities', async () => {
    mockUseAuth.mockReturnValue(authFor('Demo Community'));
    render(<KingdomCityMigrationNotice />);
    await waitFor(() => expect(AsyncStorage.getItem).not.toHaveBeenCalled());
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('waits for the birthday prompt so two modals never stack', async () => {
    mockUseAuth.mockReturnValue(
      authFor('KingdomCity', { user: { id: 'user-1', date_of_birth: null } }),
    );
    render(<KingdomCityMigrationNotice />);
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
  });

  it('opens kingdomcity.com/connect without dismissing', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockUseAuth.mockReturnValue(authFor('KingdomCity'));
    render(<KingdomCityMigrationNotice />);

    fireEvent.press(await screen.findByText('Join new groups'));

    expect(openURL).toHaveBeenCalledWith(KINGDOMCITY_CONNECT_URL);
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it.each([
    ['Got it', 'text'],
    ['Dismiss', 'label'],
  ])('dismisses for good via %s', async (target, kind) => {
    mockUseAuth.mockReturnValue(authFor('KingdomCity'));
    const { unmount } = render(<KingdomCityMigrationNotice />);
    await screen.findByText(TITLE);

    fireEvent.press(
      kind === 'text' ? screen.getByText(target) : screen.getByLabelText(target),
    );

    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(await AsyncStorage.getItem(dismissedStorageKey('user-1', 'community-1'))).toBe('1');

    // A fresh launch on the same device stays quiet.
    unmount();
    render(<KingdomCityMigrationNotice />);
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('still shows for a different person on the same device', async () => {
    await AsyncStorage.setItem(dismissedStorageKey('user-1', 'community-1'), '1');
    mockUseAuth.mockReturnValue(authFor('KingdomCity', { user: { id: 'user-2', date_of_birth: '1990-01-01' } }));
    render(<KingdomCityMigrationNotice />);
    expect(await screen.findByText(TITLE)).toBeTruthy();
  });
});
