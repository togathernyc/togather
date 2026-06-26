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

// The running bundle's manifest, exposed via a getter so tests can swap it
// (a namespace import's properties are read-only and can't be reassigned).
let mockRunningManifest: unknown;
jest.mock('expo-updates', () => ({
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
  get manifest() {
    return mockRunningManifest;
  },
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

// EAS Update nests the app config under manifest.extra.expoClient, so the
// forced-floor serial lives at extra.expoClient.extra.otaForcedSerial. `id` is
// the per-update identifier used to skip re-fetching an already-staged bundle.
// `otaForcedSerial: undefined` omits the field entirely (reads back as 0).
const manifestWithSerial = (otaForcedSerial: number | undefined, id = 'update-1') => ({
  id,
  extra: {
    expoClient: {
      extra: otaForcedSerial === undefined ? {} : { otaForcedSerial },
    },
  },
});
const setRunningSerial = (serial: number) => {
  mockRunningManifest = manifestWithSerial(serial, 'running');
};

// Running bundle sits at floor 0; an update at serial 0 is silent, > 0 is forced.
const SILENT_UPDATE = { isAvailable: true, manifest: manifestWithSerial(0, 'silent-1') };
const FORCED_UPDATE = { isAvailable: true, manifest: manifestWithSerial(100, 'forced-1') };

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
    setRunningSerial(0);
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
      mockCheckForUpdate.mockResolvedValue(FORCED_UPDATE);
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

    it('downloads and auto-applies a FORCED update after grace + settle delay', async () => {
      mockCheckForUpdate.mockResolvedValue(FORCED_UPDATE);
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

    it('stages a SILENT update in the background without showing UI or reloading', async () => {
      // Default delivery mode: download for next launch, never reload mid-session.
      mockCheckForUpdate.mockResolvedValue(SILENT_UPDATE);
      mockFetchUpdate.mockResolvedValue({ isNew: true });

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();

      await waitFor(() => {
        expect(mockFetchUpdate).toHaveBeenCalledTimes(1);
      });

      // Settle window passes — a forced update would reload here; a silent one
      // must not. Status returns to idle and the modal (downloading/ready) is
      // never shown.
      await act(async () => {
        jest.advanceTimersByTime(PRE_RELOAD_SETTLE_MS);
        await flushPromises();
      });

      expect(mockReload).not.toHaveBeenCalled();
      expect(result.current.status).toBe('idle');
    });

    it('treats an update with no forced serial as silent (no reload)', async () => {
      // Missing serial reads as 0, never exceeding the running floor.
      mockCheckForUpdate.mockResolvedValue({ isAvailable: true, manifest: manifestWithSerial(undefined) });
      mockFetchUpdate.mockResolvedValue({ isNew: true });

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();

      await waitFor(() => {
        expect(mockFetchUpdate).toHaveBeenCalledTimes(1);
      });
      await act(async () => {
        jest.advanceTimersByTime(PRE_RELOAD_SETTLE_MS);
        await flushPromises();
      });

      expect(mockReload).not.toHaveBeenCalled();
      expect(result.current.status).toBe('idle');
    });

    it('keeps checking but does not re-fetch the same staged silent update', async () => {
      mockCheckForUpdate.mockResolvedValue(SILENT_UPDATE);
      mockFetchUpdate.mockResolvedValue({ isNew: true });

      renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();
      await waitFor(() => expect(mockFetchUpdate).toHaveBeenCalledTimes(1));

      // A later foreground past the throttle still RE-CHECKS (a later deploy
      // could be forced and must win), but the same staged bundle (same id) is
      // not downloaded again.
      jest.setSystemTime(STARTUP_GRACE_MS + 1 + MIN_RECHECK_INTERVAL_MS + 1);
      triggerForeground();
      await waitFor(() => expect(mockCheckForUpdate).toHaveBeenCalledTimes(2));
      await flushPromises();

      expect(mockFetchUpdate).toHaveBeenCalledTimes(1);
    });

    it('still forces a reload when a forced update lands after a silent one was staged', async () => {
      // Codex P2 on PR #503: a session that staged a silent update must still
      // receive a later forced update (the breaking-contract use case) without
      // needing the user to kill and reopen the app.
      mockCheckForUpdate
        .mockResolvedValueOnce(SILENT_UPDATE)
        .mockResolvedValueOnce(FORCED_UPDATE);
      mockFetchUpdate.mockResolvedValue({ isNew: true });
      mockReload.mockResolvedValue(undefined);

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      // First foreground: stage the silent update, no reload.
      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();
      await waitFor(() => expect(mockFetchUpdate).toHaveBeenCalledTimes(1));
      await act(async () => {
        jest.advanceTimersByTime(PRE_RELOAD_SETTLE_MS);
        await flushPromises();
      });
      expect(mockReload).not.toHaveBeenCalled();

      // Later foreground past the throttle: a forced update is now available
      // and must reach this still-alive session.
      jest.setSystemTime(STARTUP_GRACE_MS + 1 + MIN_RECHECK_INTERVAL_MS + 1);
      triggerForeground();
      await waitFor(() => expect(result.current.status).toBe('ready'));

      await act(async () => {
        jest.advanceTimersByTime(PRE_RELOAD_SETTLE_MS);
        await flushPromises();
      });
      await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
    });

    it('forces a device that missed a forced release even when the superseding update is silent', async () => {
      // Codex P1 on PR #503: the running bundle predates a forced release (floor
      // 100), and the only update now offered is a *silent* one — but it carries
      // the sticky forced floor (100) > running (0), so the device must still
      // force-reload instead of quietly staging it.
      setRunningSerial(0);
      mockCheckForUpdate.mockResolvedValue({
        isAvailable: true,
        manifest: manifestWithSerial(100, 'silent-after-forced'),
      });
      mockFetchUpdate.mockResolvedValue({ isNew: true });
      mockReload.mockResolvedValue(undefined);

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();

      await waitFor(() => expect(result.current.status).toBe('ready'));
      await act(async () => {
        jest.advanceTimersByTime(PRE_RELOAD_SETTLE_MS);
        await flushPromises();
      });
      await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
    });

    it('stays silent for a device already on the forced bundle', async () => {
      // Running bundle is already at the forced floor (100); a later silent
      // release also carries 100, so 100 > 100 is false → no forced reload.
      setRunningSerial(100);
      mockCheckForUpdate.mockResolvedValue({
        isAvailable: true,
        manifest: manifestWithSerial(100, 'later-silent'),
      });
      mockFetchUpdate.mockResolvedValue({ isNew: true });

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });
      await flushPromises();

      jest.setSystemTime(STARTUP_GRACE_MS + 1);
      triggerForeground();

      await waitFor(() => expect(mockFetchUpdate).toHaveBeenCalledTimes(1));
      await act(async () => {
        jest.advanceTimersByTime(PRE_RELOAD_SETTLE_MS);
        await flushPromises();
      });

      expect(mockReload).not.toHaveBeenCalled();
      expect(result.current.status).toBe('idle');
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
