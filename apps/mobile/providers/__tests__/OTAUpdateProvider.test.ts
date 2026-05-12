/**
 * Tests for OTAUpdateProvider
 * Tests the auto-applying OTA update state machine and its safety guards.
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import {
  OTAUpdateProvider,
  useOTAUpdateStatus,
  STARTUP_GRACE_MS,
  MIN_RECHECK_INTERVAL_MS,
  PRE_RELOAD_SETTLE_MS,
} from '../OTAUpdateProvider';
import * as Updates from 'expo-updates';

// --- Mocks ---

jest.mock('expo-updates', () => ({
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

jest.mock('../SentryProvider', () => ({
  SentryUtils: {
    addBreadcrumb: jest.fn(),
  },
}));

let appStateChangeHandler: ((state: string) => void) | null = null;
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn((event: string, handler: (state: string) => void) => {
      if (event === 'change') appStateChangeHandler = handler;
      return { remove: jest.fn() };
    }),
    currentState: 'active',
  },
}));

const mockCheckForUpdate = Updates.checkForUpdateAsync as jest.Mock;
const mockFetchUpdate = Updates.fetchUpdateAsync as jest.Mock;
const mockReload = Updates.reloadAsync as jest.Mock;

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(OTAUpdateProvider, null, children);

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const triggerForeground = () => {
  // Real background -> active transition (active -> active is ignored by the guard).
  act(() => {
    appStateChangeHandler!('background');
  });
  act(() => {
    appStateChangeHandler!('active');
  });
};

describe('OTAUpdateProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appStateChangeHandler = null;
  });

  it('skips update check in dev mode and stays idle', () => {
    // __DEV__ is true in test environment by default
    const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });

    expect(result.current.status).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
    expect(mockCheckForUpdate).not.toHaveBeenCalled();
    expect(mockFetchUpdate).not.toHaveBeenCalled();
    expect(mockReload).not.toHaveBeenCalled();
  });

  describe('with __DEV__ = false', () => {
    const originalDev = (global as any).__DEV__;

    beforeEach(() => {
      (global as any).__DEV__ = false;
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
      jest.setSystemTime(0);
    });

    afterEach(() => {
      jest.useRealTimers();
      (global as any).__DEV__ = originalDev;
    });

    it('defers initial mount check until startup grace window passes', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: false });

      renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      // Mount-time check is scheduled via setTimeout(STARTUP_GRACE_MS);
      // nothing fires immediately.
      expect(mockCheckForUpdate).not.toHaveBeenCalled();
      expect(mockReload).not.toHaveBeenCalled();
    });

    it('runs deferred mount check after startup grace expires (no foreground needed)', async () => {
      // Codex P2 on PR #392: a user who opens the app after an OTA is
      // published and stays foregrounded must still receive the update,
      // even without a background→foreground transition.
      mockCheckForUpdate.mockResolvedValue({ isAvailable: true });
      mockFetchUpdate.mockResolvedValue({ isNew: true });
      mockReload.mockResolvedValue(undefined);

      renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      expect(mockCheckForUpdate).not.toHaveBeenCalled();

      // Advance through the grace window; the deferred mount timer fires.
      await act(async () => {
        jest.advanceTimersByTime(STARTUP_GRACE_MS);
        await flushPromises();
      });

      await waitFor(() => {
        expect(mockFetchUpdate).toHaveBeenCalledTimes(1);
      });

      // Then through the settle window; reloadAsync fires.
      await act(async () => {
        jest.advanceTimersByTime(PRE_RELOAD_SETTLE_MS);
        await flushPromises();
      });

      await waitFor(() => {
        expect(mockReload).toHaveBeenCalledTimes(1);
      });
    });

    it('transitions to idle when no update is available after grace passes', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: false });

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      // Advance past startup grace, then simulate a real foreground.
      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();

      await waitFor(() => {
        expect(result.current.status).toBe('idle');
      });

      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
      expect(mockFetchUpdate).not.toHaveBeenCalled();
      expect(mockReload).not.toHaveBeenCalled();
    });

    it('downloads and auto-applies update after grace + settle delay', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: true });
      mockFetchUpdate.mockResolvedValue({ isNew: true });
      mockReload.mockResolvedValue(undefined);

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();

      await waitFor(() => {
        expect(mockFetchUpdate).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(result.current.status).toBe('ready');
      });

      // Reload is deferred until the settle window has elapsed.
      expect(mockReload).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(PRE_RELOAD_SETTLE_MS);
        await flushPromises();
      });

      await waitFor(() => {
        expect(mockReload).toHaveBeenCalledTimes(1);
      });
    });

    it('does NOT reload on active->active (system dialog dismissal)', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: true });
      mockFetchUpdate.mockResolvedValue({ isNew: true });

      renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);

      // Fire 'active' without any preceding background — mimics Face ID /
      // share-sheet dismissal where iOS reports the app as active again
      // without it ever truly suspending.
      act(() => {
        appStateChangeHandler!('active');
      });
      await flushPromises();

      expect(mockCheckForUpdate).not.toHaveBeenCalled();
    });

    it('does NOT reload on inactive->active (Notification Center / call / Control Center)', async () => {
      // Codex P2 #2 on PR #392: iOS transient interruptions like
      // Notification Center, incoming calls, and Control Center go
      // active -> inactive -> active without ever hitting 'background'.
      // The previous regex /inactive|background/ matched these and would
      // have triggered a destructive reloadAsync over a still-live UI.
      mockCheckForUpdate.mockResolvedValue({ isAvailable: true });
      mockFetchUpdate.mockResolvedValue({ isNew: true });

      renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);

      act(() => {
        appStateChangeHandler!('inactive');
      });
      act(() => {
        appStateChangeHandler!('active');
      });
      await flushPromises();

      expect(mockCheckForUpdate).not.toHaveBeenCalled();
    });

    it('throttles re-checks within MIN_RECHECK_INTERVAL_MS', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: false });

      renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();
      await waitFor(() => expect(mockCheckForUpdate).toHaveBeenCalledTimes(1));

      // Another foreground a minute later should be throttled.
      jest.setSystemTime(STARTUP_GRACE_MS + 1 + 60_000);
      triggerForeground();
      await flushPromises();
      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);

      // Past the throttle window, a new check runs.
      jest.setSystemTime(STARTUP_GRACE_MS + 1 + MIN_RECHECK_INTERVAL_MS + 1);
      triggerForeground();
      await waitFor(() => expect(mockCheckForUpdate).toHaveBeenCalledTimes(2));
    });

    it('silently returns to idle on check failure (e.g. offline)', async () => {
      mockCheckForUpdate.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();

      await waitFor(() => {
        expect(result.current.status).toBe('idle');
      });

      expect(result.current.errorMessage).toBeNull();
      expect(mockFetchUpdate).not.toHaveBeenCalled();
      expect(mockReload).not.toHaveBeenCalled();
    });

    it('does not re-enter while a check is already in flight', async () => {
      // Never resolves — first check stays in flight.
      mockCheckForUpdate.mockReturnValue(new Promise(() => {}));

      renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();
      await waitFor(() => expect(mockCheckForUpdate).toHaveBeenCalledTimes(1));

      // Another foreground past the throttle window — should still be blocked
      // by the in-flight status guard.
      jest.setSystemTime(STARTUP_GRACE_MS + 1 + MIN_RECHECK_INTERVAL_MS + 1);
      triggerForeground();
      await flushPromises();

      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
