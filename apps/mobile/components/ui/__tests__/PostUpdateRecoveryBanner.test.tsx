/**
 * Tests for PostUpdateRecoveryBanner
 * Verifies the one-shot detection that compares Updates.updateId against
 * the value persisted from the previous launch.
 */
import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react-native';
import {
  PostUpdateRecoveryBanner,
  STORAGE_KEY,
  AUTO_DISMISS_MS,
} from '../PostUpdateRecoveryBanner';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-updates', () => {
  let _updateId: string | null = null;
  let _isEmbeddedLaunch = false;
  return {
    get updateId() {
      return _updateId;
    },
    set updateId(v: string | null) {
      _updateId = v;
    },
    get isEmbeddedLaunch() {
      return _isEmbeddedLaunch;
    },
    set isEmbeddedLaunch(v: boolean) {
      _isEmbeddedLaunch = v;
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

const setUpdateId = (id: string | null) => {
  // Goes through the getter/setter pair defined on the mock.
  (Updates as { updateId: string | null }).updateId = id;
};

const setIsEmbeddedLaunch = (v: boolean) => {
  (Updates as { isEmbeddedLaunch: boolean }).isEmbeddedLaunch = v;
};

const BANNER_TEXT = /app just updated/i;

describe('PostUpdateRecoveryBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    setUpdateId(null);
    setIsEmbeddedLaunch(false);
  });

  it('renders nothing in dev mode', async () => {
    // __DEV__ is true by default in the test environment.
    setUpdateId('update-a');
    mockGetItem.mockResolvedValue('update-b');

    render(<PostUpdateRecoveryBanner />);

    await waitFor(() => {
      expect(mockGetItem).not.toHaveBeenCalled();
    });
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
  });

  describe('with __DEV__ = false', () => {
    const originalDev = (global as any).__DEV__;

    beforeEach(() => {
      (global as any).__DEV__ = false;
    });

    afterEach(() => {
      (global as any).__DEV__ = originalDev;
    });

    it('renders nothing on embedded launch (no updateId)', async () => {
      setUpdateId(null);

      render(<PostUpdateRecoveryBanner />);
      // Allow the async effect to settle.
      await act(async () => {});

      expect(mockGetItem).not.toHaveBeenCalled();
      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it('embedded launch (fresh install): no storage activity, no banner', async () => {
      setUpdateId('update-embedded');
      setIsEmbeddedLaunch(true);
      mockGetItem.mockResolvedValue(null);

      render(<PostUpdateRecoveryBanner />);
      await act(async () => {});

      expect(mockGetItem).not.toHaveBeenCalled();
      expect(mockSetItem).not.toHaveBeenCalled();
      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it('embedded launch with a prior stored OTA id (App Store update): does not overwrite, no banner', async () => {
      // A native App Store update bumps the embedded updateId. Without
      // the isEmbeddedLaunch short-circuit the previous code would have
      // read the (different) stored OTA id, treated it as a transition,
      // shown the banner, AND overwritten the stored baseline — making
      // the next *real* OTA transition impossible to detect.
      setUpdateId('update-new-embedded');
      setIsEmbeddedLaunch(true);
      mockGetItem.mockResolvedValue('update-old-ota');

      render(<PostUpdateRecoveryBanner />);
      await act(async () => {});

      expect(mockGetItem).not.toHaveBeenCalled();
      expect(mockSetItem).not.toHaveBeenCalled();
      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it('first launch with banner code on an OTA bundle (no stored id + non-embedded): SHOWS banner', async () => {
      // The bug that shipped in PR #393's squash: existing users
      // upgrading from a pre-banner bundle write nothing to storage on
      // their old bundle, so `stored` is null. The original logic
      // treated `!stored` as "fresh install" and suppressed the banner
      // on the exact transition it's meant to help. Without the
      // isEmbeddedLaunch disambiguation this user would never see it.
      setUpdateId('update-with-banner');
      setIsEmbeddedLaunch(false);
      mockGetItem.mockResolvedValue(null);

      render(<PostUpdateRecoveryBanner />);

      await waitFor(() => {
        expect(screen.getByText(BANNER_TEXT)).toBeTruthy();
      });
      expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEY, 'update-with-banner');
    });

    it('does NOT show banner when updateId matches the stored value', async () => {
      setUpdateId('update-same');
      mockGetItem.mockResolvedValue('update-same');

      render(<PostUpdateRecoveryBanner />);

      await waitFor(() => {
        expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEY, 'update-same');
      });
      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it('shows banner when updateId differs from stored value', async () => {
      setUpdateId('update-new');
      mockGetItem.mockResolvedValue('update-old');

      render(<PostUpdateRecoveryBanner />);

      await waitFor(() => {
        expect(screen.getByText(BANNER_TEXT)).toBeTruthy();
      });

      // Persists the new id so the banner doesn't re-show next launch.
      expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEY, 'update-new');
    });

    it('auto-dismisses after AUTO_DISMISS_MS', async () => {
      jest.useFakeTimers();
      try {
        setUpdateId('update-new');
        mockGetItem.mockResolvedValue('update-old');

        render(<PostUpdateRecoveryBanner />);

        await waitFor(() => {
          expect(screen.getByText(BANNER_TEXT)).toBeTruthy();
        });

        act(() => {
          jest.advanceTimersByTime(AUTO_DISMISS_MS);
        });

        expect(screen.queryByText(BANNER_TEXT)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('manual dismiss hides the banner', async () => {
      setUpdateId('update-new');
      mockGetItem.mockResolvedValue('update-old');

      render(<PostUpdateRecoveryBanner />);

      await waitFor(() => {
        expect(screen.getByText(BANNER_TEXT)).toBeTruthy();
      });

      fireEvent.press(screen.getByLabelText('Dismiss update notice'));

      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
    });

    it('applies the top safe-area inset to the banner container', async () => {
      // Codex P2 on PR #393: without the top inset the banner sat under
      // the iOS notch / status bar in the very case it's meant to help.
      // Mock returns top: 47 (typical iPhone notch).
      setUpdateId('update-new');
      mockGetItem.mockResolvedValue('update-old');

      render(<PostUpdateRecoveryBanner />);

      const text = await screen.findByText(BANNER_TEXT);
      // The container is the banner View; on RN testing-library the parent
      // node carries the merged style array.
      const container = text.parent?.parent;
      expect(container).toBeTruthy();
      const styles = (container as any).props.style;
      const flat = Array.isArray(styles)
        ? Object.assign({}, ...styles.filter(Boolean))
        : styles;
      expect(flat.paddingTop).toBe(57); // 10 base + 47 inset
    });

    it('fails open if AsyncStorage.getItem throws', async () => {
      setUpdateId('update-new');
      mockGetItem.mockRejectedValue(new Error('disk full'));

      render(<PostUpdateRecoveryBanner />);
      await act(async () => {});

      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
      // We never reached the setItem step.
      expect(mockSetItem).not.toHaveBeenCalled();
    });
  });
});
