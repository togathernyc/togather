/**
 * Tests for OTAUpdateProvider
 * Tests the auto-applying OTA update state machine.
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
      expect(mockReload).not.toHaveBeenCalled();
      expect(result.current.errorMessage).toBeNull();
    });

    it('auto-applies update when one is available', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: true });
      mockFetchUpdate.mockResolvedValue({ isNew: true });
      mockReload.mockResolvedValue(undefined);

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });

      expect(result.current.status).toBe('checking');

      await waitFor(() => {
        expect(mockReload).toHaveBeenCalledTimes(1);
      });

      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
      expect(mockFetchUpdate).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('ready');
      expect(result.current.errorMessage).toBeNull();
    });

    it('silently returns to idle on check failure (e.g. offline)', async () => {
      mockCheckForUpdate.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useOTAUpdateStatus(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('idle');
      });

      expect(result.current.errorMessage).toBeNull();
      expect(mockFetchUpdate).not.toHaveBeenCalled();
      expect(mockReload).not.toHaveBeenCalled();
    });

    it('re-checks for updates when the app returns to foreground', async () => {
      mockCheckForUpdate.mockResolvedValue({ isAvailable: false });

      renderHook(() => useOTAUpdateStatus(), { wrapper });

      await waitFor(() => {
        expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
      });

      // Ensure the listener was registered.
      expect(appStateChangeHandler).not.toBeNull();

      // Simulate background -> active transition.
      act(() => {
        appStateChangeHandler!('background');
      });
      act(() => {
        appStateChangeHandler!('active');
      });

      await waitFor(() => {
        expect(mockCheckForUpdate).toHaveBeenCalledTimes(2);
      });
    });

    it('does not re-enter while a check is already in flight', async () => {
      // Never resolves — first check stays in flight.
      mockCheckForUpdate.mockReturnValue(new Promise(() => {}));

      renderHook(() => useOTAUpdateStatus(), { wrapper });

      await waitFor(() => {
        expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
      });

      // Foreground event during the in-flight check should be ignored.
      act(() => {
        appStateChangeHandler!('active');
      });

      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
