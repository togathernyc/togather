/**
 * Tests for OTAUpdateProvider
 * Tests the non-blocking OTA update state machine and auto-apply logic.
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { OTAUpdateProvider, useOTAUpdateStatus } from '../OTAUpdateProvider';
import * as Updates from 'expo-updates';

// --- Mocks ---

jest.mock('expo-updates', () => ({
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
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

describe('OTAUpdateProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    appStateChangeHandler = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('skips update check in dev mode and stays idle', () => {
    // __DEV__ is true in test environment by default
    const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });

    expect(result.current.status).toBe('idle');
    expect(result.current.errorMessage).toBeNull();
    expect(mockCheckForUpdate).not.toHaveBeenCalled();
    expect(mockFetchUpdate).not.toHaveBeenCalled();
  });

  describe('with __DEV__ = false', () => {
    const originalDev = (global as any).__DEV__;

    beforeEach(() => {
      (global as any).__DEV__ = false;
    });

    afterEach(() => {
      (global as any).__DEV__ = originalDev;
    });

    it('transitions to idle when no update is available', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: false });

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });

      // Initially checking
      expect(result.current.status).toBe('checking');

      await waitFor(() => {
        expect(result.current.status).toBe('idle');
      });

      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
      expect(mockFetchUpdate).not.toHaveBeenCalled();
      expect(result.current.errorMessage).toBeNull();
    });

    it('transitions checking -> downloading -> ready when update is available', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: true });
      mockFetchUpdate.mockResolvedValue({ isNew: true });

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });

      expect(result.current.status).toBe('checking');

      await waitFor(() => {
        expect(result.current.status).toBe('ready');
      });

      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
      expect(mockFetchUpdate).toHaveBeenCalledTimes(1);
      expect(result.current.errorMessage).toBeNull();
    });

    it('transitions to error on failure, then auto-dismisses to idle after 5s', async () => {
      mockCheckForUpdate.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('error');
      });

      expect(result.current.errorMessage).toBe('Network error');

      // Auto-dismiss after 5 seconds
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.errorMessage).toBeNull();
    });

    it('skips error state for known error codes (ERR_UPDATES_DISABLED)', async () => {
      const error = new Error('Updates are disabled');
      (error as any).code = 'ERR_UPDATES_DISABLED';
      mockCheckForUpdate.mockRejectedValue(error);

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('idle');
      });

      // Should never have gone to error
      expect(result.current.errorMessage).toBeNull();
    });

    it('auto-applies update when app is backgrounded for 30+ seconds', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: true });
      mockFetchUpdate.mockResolvedValue({ isNew: true });

      renderHook(() => useOTAUpdateStatus(), { wrapper });

      // Wait for update to be ready
      await waitFor(() => {
        expect(appStateChangeHandler).not.toBeNull();
      });

      // Need to wait for status to become 'ready' so the AppState listener
      // is registered with the correct status closure
      await waitFor(() => {
        // The status should be ready by now
        expect(mockFetchUpdate).toHaveBeenCalled();
      });

      // Re-render to pick up the effect with status='ready'
      // Simulate going to background
      act(() => {
        appStateChangeHandler!('background');
      });

      // Advance past the 30s background timer
      act(() => {
        jest.advanceTimersByTime(30000);
      });

      // Simulate coming back to foreground
      act(() => {
        appStateChangeHandler!('active');
      });

      expect(mockReload).toHaveBeenCalledTimes(1);
    });
  });
});
