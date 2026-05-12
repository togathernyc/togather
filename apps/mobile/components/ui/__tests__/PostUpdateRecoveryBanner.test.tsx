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
  return {
    get updateId() {
      return _updateId;
    },
    set updateId(v: string | null) {
      _updateId = v;
    },
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

const setUpdateId = (id: string | null) => {
  // Goes through the getter/setter pair defined on the mock.
  (Updates as { updateId: string | null }).updateId = id;
};

const BANNER_TEXT = /app just updated/i;

describe('PostUpdateRecoveryBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockResolvedValue(undefined);
    setUpdateId(null);
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

    it('seeds storage on first-ever launch and shows no banner', async () => {
      setUpdateId('update-first');
      mockGetItem.mockResolvedValue(null);

      render(<PostUpdateRecoveryBanner />);

      await waitFor(() => {
        expect(mockSetItem).toHaveBeenCalledWith(STORAGE_KEY, 'update-first');
      });
      expect(screen.queryByText(BANNER_TEXT)).toBeNull();
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
