/**
 * Tests for PostUpdateRecoveryBanner
 * Verifies the one-shot detection that compares Updates.updateId against the
 * value persisted from the previous launch, and the silent "Updating…" →
 * "Updated" pill presentation that auto-dismisses with no user action.
 */
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react-native';
import {
  PostUpdateRecoveryBanner,
  STORAGE_KEY,
  UPDATING_PHASE_MS,
  UPDATED_HOLD_MS,
  FADE_MS,
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

const UPDATING_TEXT = /^Updating…$/;
const UPDATED_TEXT = /^Updated$/;
// Either phase of the pill is on screen.
const PILL_TEXT = /^(Updating…|Updated)$/;

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
    expect(screen.queryByText(PILL_TEXT)).toBeNull();
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
      expect(screen.queryByText(PILL_TEXT)).toBeNull();
    });

    it('embedded launch (fresh install): no storage activity, no pill', async () => {
      setUpdateId('update-embedded');
      setIsEmbeddedLaunch(true);
      mockGetItem.mockResolvedValue(null);

      render(<PostUpdateRecoveryBanner />);
      await act(async () => {});

      expect(mockGetItem).not.toHaveBeenCalled();
      expect(mockSetItem).not.toHaveBeenCalled();
      expect(screen.queryByText(PILL_TEXT)).toBeNull();
    });

    it('embedded launch with a prior stored OTA id (App Store update): does not overwrite, no pill', async () => {
      // A native App Store update bumps the embedded updateId. Without the
      // isEmbeddedLaunch short-circuit the previous code would have read the
      // (different) stored OTA id, treated it as a transition, shown the
      // pill, AND overwritten the stored baseline — making the next *real*
      // OTA transition impossible to detect.
      setUpdateId('update-new-embedded');
      setIsEmbeddedLaunch(true);
      mockGetItem.mockResolvedValue('update-old-ota');

      render(<PostUpdateRecoveryBanner />);
      await act(async () => {});

      expect(mockGetItem).not.toHaveBeenCalled();
      expect(mockSetItem).not.toHaveBeenCalled();
      expect(screen.queryByText(PILL_TEXT)).toBeNull();
    });

    it('first launch with this code on an OTA bundle (no stored id + non-embedded): SHOWS pill', async () => {
      // Existing users upgrading from a pre-pill bundle write nothing to
      // storage on their old bundle, so `stored` is null. The
      // isEmbeddedLaunch disambiguation lets us still show the notice on this
      // OTA transition.
      setUpdateId('update-with-pill');
      setIsEmbeddedLaunch(false);
      mockGetItem.mockResolvedValue(null);

      render(<PostUpdateRecoveryBanner />);

      await waitFor(() => {
        expect(screen.getByText(PILL_TEXT)).toBeTruthy();
      });
      expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEY, 'update-with-pill');
    });

    it('does NOT show pill when updateId matches the stored value', async () => {
      setUpdateId('update-same');
      mockGetItem.mockResolvedValue('update-same');

      render(<PostUpdateRecoveryBanner />);

      await waitFor(() => {
        expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEY, 'update-same');
      });
      expect(screen.queryByText(PILL_TEXT)).toBeNull();
    });

    it('shows the pill when updateId differs from stored value', async () => {
      setUpdateId('update-new');
      mockGetItem.mockResolvedValue('update-old');

      render(<PostUpdateRecoveryBanner />);

      await waitFor(() => {
        expect(screen.getByText(PILL_TEXT)).toBeTruthy();
      });

      // Persists the new id so the pill doesn't re-show next launch.
      expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEY, 'update-new');
    });

    it('starts on "Updating…" then transitions to "Updated"', async () => {
      jest.useFakeTimers();
      try {
        setUpdateId('update-new');
        mockGetItem.mockResolvedValue('update-old');

        render(<PostUpdateRecoveryBanner />);

        // Flush the async detection so the pill mounts in its "Updating…"
        // phase.
        await act(async () => {});
        expect(screen.getByText(UPDATING_TEXT)).toBeTruthy();
        expect(screen.queryByText(UPDATED_TEXT)).toBeNull();

        act(() => {
          jest.advanceTimersByTime(UPDATING_PHASE_MS);
        });

        expect(screen.getByText(UPDATED_TEXT)).toBeTruthy();
        expect(screen.queryByText(UPDATING_TEXT)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('auto-dismisses (fades out) after the full timeline with no user action', async () => {
      jest.useFakeTimers();
      try {
        setUpdateId('update-new');
        mockGetItem.mockResolvedValue('update-old');

        render(<PostUpdateRecoveryBanner />);

        await act(async () => {});
        expect(screen.getByText(PILL_TEXT)).toBeTruthy();

        act(() => {
          jest.advanceTimersByTime(
            UPDATING_PHASE_MS + UPDATED_HOLD_MS + FADE_MS,
          );
        });

        expect(screen.queryByText(PILL_TEXT)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not capture touches on the content beneath it', async () => {
      setUpdateId('update-new');
      mockGetItem.mockResolvedValue('update-old');

      render(<PostUpdateRecoveryBanner />);

      await screen.findByText(PILL_TEXT);
      const overlay = screen.getByTestId('post-update-pill-overlay');
      expect(overlay.props.pointerEvents).toBe('none');
    });

    it('floats over the top safe-area inset', async () => {
      // Without the top inset the pill would sit under the iOS notch / status
      // bar. Mock returns top: 47 (typical iPhone notch); the overlay offsets
      // by 8 base + 47 inset.
      setUpdateId('update-new');
      mockGetItem.mockResolvedValue('update-old');

      render(<PostUpdateRecoveryBanner />);

      await screen.findByText(PILL_TEXT);
      const overlay = screen.getByTestId('post-update-pill-overlay');
      const styles = overlay.props.style;
      const flat = Array.isArray(styles)
        ? Object.assign({}, ...styles.filter(Boolean))
        : styles;
      expect(flat.top).toBe(55); // 8 base + 47 inset
    });

    it('fails open if AsyncStorage.getItem throws', async () => {
      setUpdateId('update-new');
      mockGetItem.mockRejectedValue(new Error('disk full'));

      render(<PostUpdateRecoveryBanner />);
      await act(async () => {});

      expect(screen.queryByText(PILL_TEXT)).toBeNull();
      // We never reached the setItem step.
      expect(mockSetItem).not.toHaveBeenCalled();
    });
  });
});
