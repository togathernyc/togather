/**
 * Tests for StatusBar component
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { StatusBar } from '../StatusBar';

// Mock connection and OTA providers
let mockConnectionStatus: any = {
  status: 'connected',
  isNetworkAvailable: true,
  isInternetReachable: true,
};
let mockOTAStatus: any = { status: 'idle', errorMessage: null };

jest.mock('@providers/ConnectionProvider', () => ({
  useConnectionStatus: jest.fn(() => mockConnectionStatus),
}));

jest.mock('@providers/OTAUpdateProvider', () => ({
  useOTAUpdateStatus: jest.fn(() => mockOTAStatus),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('expo-updates', () => ({
  reloadAsync: jest.fn(),
}));

describe('StatusBar', () => {
  beforeEach(() => {
    mockConnectionStatus = {
      status: 'connected',
      isNetworkAvailable: true,
      isInternetReachable: true,
    };
    mockOTAStatus = { status: 'idle', errorMessage: null };
  });

  it('is hidden when connected and OTA is idle', () => {
    const { queryByText } = render(<StatusBar />);
    expect(queryByText('No internet connection')).toBeNull();
    expect(queryByText('Reconnecting...')).toBeNull();
    expect(queryByText('Connected')).toBeNull();
    expect(queryByText('Downloading update...')).toBeNull();
  });

  it('does not show error banner during connecting state (cold start - no false alarm)', () => {
    mockConnectionStatus = {
      status: 'connecting',
      isNetworkAvailable: true,
      isInternetReachable: true,
    };
    const { queryByText } = render(<StatusBar />);
    // Connecting state should not show "No internet connection" - getActiveConfig returns null
    expect(queryByText('No internet connection')).toBeNull();
  });

  it('does not show "No internet" banner during connecting state when isInternetReachable is false (cold start race condition)', () => {
    // This tests the cold start race condition where NetInfo reports
    // isInternetReachable: false before the reachability check completes
    mockConnectionStatus = {
      status: 'connecting',
      isNetworkAvailable: true,
      isInternetReachable: false,
    };
    const { queryByText } = render(<StatusBar />);
    // During connecting state, no banner should show regardless of isInternetReachable
    expect(queryByText('No internet connection')).toBeNull();
    expect(queryByText('No internet')).toBeNull();
  });

  it('shows disconnected state', () => {
    mockConnectionStatus = {
      status: 'disconnected',
      isNetworkAvailable: false,
      isInternetReachable: false,
    };
    const { getByText, getByTestId } = render(<StatusBar />);
    expect(getByTestId('status-bar')).toBeTruthy();
    expect(getByText('No internet connection')).toBeTruthy();
  });

  it('shows no internet reachable state', () => {
    mockConnectionStatus = {
      status: 'connected',
      isNetworkAvailable: true,
      isInternetReachable: false,
    };
    const { getByText, getByTestId } = render(<StatusBar />);
    expect(getByTestId('status-bar')).toBeTruthy();
    expect(getByText('No internet')).toBeTruthy();
  });

  it('shows slow connection state', () => {
    mockConnectionStatus = {
      ...mockConnectionStatus,
      status: 'slow',
    };
    const { getByText, getByTestId } = render(<StatusBar />);
    expect(getByTestId('status-bar')).toBeTruthy();
    expect(getByText('Slow connection')).toBeTruthy();
  });

  it('shows reconnecting state', () => {
    mockConnectionStatus = {
      ...mockConnectionStatus,
      status: 'reconnecting',
    };
    const { getByText, getByTestId } = render(<StatusBar />);
    expect(getByTestId('status-bar')).toBeTruthy();
    expect(getByText('Reconnecting...')).toBeTruthy();
  });

  it('shows reconnected state', () => {
    mockConnectionStatus = {
      ...mockConnectionStatus,
      status: 'reconnected',
    };
    const { getByText, getByTestId } = render(<StatusBar />);
    expect(getByTestId('status-bar')).toBeTruthy();
    expect(getByText('Connected')).toBeTruthy();
  });

  it('does not show OTA downloading state (handled by OTAUpdateModal)', () => {
    mockOTAStatus = { status: 'downloading', errorMessage: null };
    const { queryByText } = render(<StatusBar />);
    expect(queryByText('Downloading update...')).toBeNull();
  });

  it('does not show OTA ready state (handled by OTAUpdateModal)', () => {
    mockOTAStatus = { status: 'ready', errorMessage: null };
    const { queryByText } = render(<StatusBar />);
    expect(queryByText('Update ready')).toBeNull();
  });

  it('shows OTA checking state', () => {
    mockOTAStatus = { status: 'checking', errorMessage: null };
    const { getByText, getByTestId } = render(<StatusBar />);
    expect(getByTestId('status-bar')).toBeTruthy();
    expect(getByText('Checking for updates...')).toBeTruthy();
  });

  it('does not show OTA error state (failures are silent)', () => {
    mockOTAStatus = { status: 'error', errorMessage: 'Network error' };
    const { queryByText } = render(<StatusBar />);
    expect(queryByText("Couldn't check for updates")).toBeNull();
  });

  it('prioritizes connection status over OTA status', () => {
    mockConnectionStatus = {
      status: 'disconnected',
      isNetworkAvailable: false,
      isInternetReachable: false,
    };
    mockOTAStatus = { status: 'checking', errorMessage: null };
    const { getByText, queryByText } = render(<StatusBar />);
    expect(getByText('No internet connection')).toBeTruthy();
    expect(queryByText('Checking for updates...')).toBeNull();
  });
});
