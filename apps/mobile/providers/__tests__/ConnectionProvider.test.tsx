/**
 * Tests for ConnectionProvider
 * Tests the state machine: connected -> disconnected -> reconnected -> connected
 */
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { ConnectionProvider, useConnectionStatus } from '../ConnectionProvider';

// Mock NetInfo
const mockNetInfoListeners: Array<(state: any) => void> = [];
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((callback: any) => {
    mockNetInfoListeners.push(callback);
    // Return unsubscribe
    return () => {
      const idx = mockNetInfoListeners.indexOf(callback);
      if (idx >= 0) mockNetInfoListeners.splice(idx, 1);
    };
  }),
  fetch: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true })
  ),
}));

// Mock Convex connection state - returns an object with isWebSocketConnected
let mockIsWebSocketConnected = true;
jest.mock('@services/api/convex', () => ({
  useConvexConnectionState: jest.fn(() => ({
    isWebSocketConnected: mockIsWebSocketConnected,
    hasInflightRequests: false,
    timeOfOldestInflightRequest: null,
    hasEverConnected: true,
    connectionCount: 1,
    failedConnectionCount: 0,
  })),
}));

function simulateNetInfoChange(state: {
  isConnected: boolean;
  isInternetReachable: boolean;
  type?: string;
  details?: any;
}) {
  mockNetInfoListeners.forEach((listener) => listener(state));
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ConnectionProvider>{children}</ConnectionProvider>
);

describe('ConnectionProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIsWebSocketConnected = true;
    mockNetInfoListeners.length = 0;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns connected when both NetInfo and Convex are connected', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });
    expect(result.current.status).toBe('connected');
    expect(result.current.isNetworkAvailable).toBe(true);
    expect(result.current.isWebSocketConnected).toBe(true);
  });

  it('returns disconnected after 2s debounce when NetInfo reports offline', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    act(() => {
      simulateNetInfoChange({ isConnected: false, isInternetReachable: false });
    });

    // Should NOT be disconnected yet (debounce)
    expect(result.current.status).toBe('connected');

    // After 2 seconds
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.status).toBe('disconnected');
    expect(result.current.isNetworkAvailable).toBe(false);
  });

  it('does NOT show disconnected if network recovers within 2s (debounce cancellation)', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    act(() => {
      simulateNetInfoChange({ isConnected: false, isInternetReachable: false });
    });

    // Network recovers within 1 second
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    act(() => {
      simulateNetInfoChange({ isConnected: true, isInternetReachable: true });
    });

    // Even after full debounce time
    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.status).toBe('connected');
  });

  it('transitions disconnected -> reconnected when connection restores', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    // Go offline
    act(() => {
      simulateNetInfoChange({ isConnected: false, isInternetReachable: false });
    });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.status).toBe('disconnected');

    // Come back online
    act(() => {
      simulateNetInfoChange({ isConnected: true, isInternetReachable: true });
    });

    expect(result.current.status).toBe('reconnected');
  });

  it('transitions reconnected -> connected after 3 seconds', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    // Go offline then online
    act(() => {
      simulateNetInfoChange({ isConnected: false, isInternetReachable: false });
    });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    act(() => {
      simulateNetInfoChange({ isConnected: true, isInternetReachable: true });
    });
    expect(result.current.status).toBe('reconnected');

    // After 3 seconds
    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(result.current.status).toBe('connected');
  });

  it('isWebSocketConnected reflects Convex state', () => {
    mockIsWebSocketConnected = false;
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });
    expect(result.current.isWebSocketConnected).toBe(false);
  });

  it('provides isEffectivelyOffline=true when isInternetReachable is false', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    act(() => {
      simulateNetInfoChange({
        isConnected: true,
        isInternetReachable: false,
        type: 'wifi',
        details: {},
      });
    });

    expect(result.current.isInternetReachable).toBe(false);
    expect(result.current.isEffectivelyOffline).toBe(true);
  });

  it('detects cellular generation', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    act(() => {
      simulateNetInfoChange({
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: { cellularGeneration: '3g' },
      });
    });

    expect(result.current.connectionType).toBe('cellular');
    expect(result.current.cellularGeneration).toBe('3g');
  });

  it('sets slow status for 2G/3G cellular', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    act(() => {
      simulateNetInfoChange({
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: { cellularGeneration: '2g' },
      });
    });

    // Allow status to settle
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(result.current.status).toBe('slow');
  });

  it('provides connected status for 4G/5G cellular', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    act(() => {
      simulateNetInfoChange({
        isConnected: true,
        isInternetReachable: true,
        type: 'cellular',
        details: { cellularGeneration: '4g' },
      });
    });

    expect(result.current.status).toBe('connected');
  });

  it('provides disconnected status when network unavailable', () => {
    const { result } = renderHook(() => useConnectionStatus(), { wrapper });

    act(() => {
      simulateNetInfoChange({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      });
    });

    act(() => {
      jest.advanceTimersByTime(2100); // past 2s debounce
    });

    expect(result.current.status).toBe('disconnected');
    expect(result.current.isEffectivelyOffline).toBe(true);
  });
});
