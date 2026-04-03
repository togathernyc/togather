/**
 * Tests for useSendMessage hook enhancements
 * Tests: queued status, retry, dismiss, offline queue flush
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useSendMessage } from '../useConvexSendMessage';

// Mock mutation
const mockSendMutation = jest.fn(() => Promise.resolve('msg-id'));
jest.mock('@services/api/convex', () => ({
  useMutation: jest.fn(() => mockSendMutation),
  useStoredAuthToken: jest.fn(() => 'test-token'),
  api: {
    functions: {
      messaging: {
        messages: {
          sendMessage: 'sendMessage',
        },
      },
    },
  },
}));

// Mock auth
jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      first_name: 'Test',
      last_name: 'User',
    },
  }),
}));

// Mock connection status - mutable for tests
let mockConnectionStatus = { status: 'connected', isEffectivelyOffline: false } as { status: string; isEffectivelyOffline: boolean };
jest.mock('@providers/ConnectionProvider', () => ({
  useConnectionStatus: jest.fn(() => mockConnectionStatus),
}));

describe('useSendMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMutation.mockImplementation(() => Promise.resolve('msg-id'));
    mockConnectionStatus = { status: 'connected', isEffectivelyOffline: false };
  });

  it('creates optimistic message with _status sending when online', async () => {
    const { result } = renderHook(() => useSendMessage('channel-1' as any));

    await act(async () => {
      await result.current.sendMessage('Hello!');
    });

    // Mutation should have been called
    expect(mockSendMutation).toHaveBeenCalled();
  });

  it('creates optimistic message with _status queued when offline', async () => {
    mockConnectionStatus = { status: 'disconnected', isEffectivelyOffline: true };
    const { result } = renderHook(() => useSendMessage('channel-1' as any));

    await act(async () => {
      await result.current.sendMessage('Hello offline!');
    });

    // Mutation should NOT be called when offline
    expect(mockSendMutation).not.toHaveBeenCalled();

    // Should have a queued optimistic message
    expect(result.current.optimisticMessages).toHaveLength(1);
    expect(result.current.optimisticMessages[0]._status).toBe('queued');
    expect(result.current.optimisticMessages[0].content).toBe('Hello offline!');
  });

  it('transitions sending -> sent on mutation success', async () => {
    const { result } = renderHook(() => useSendMessage('channel-1' as any));

    await act(async () => {
      await result.current.sendMessage('Hello!');
    });

    // After success, message transitions to sent
    await waitFor(() => {
      const msg = result.current.optimisticMessages.find(m => m.content === 'Hello!');
      expect(msg?._status).toBe('sent');
    });
  });

  it('transitions sending -> error on mutation failure', async () => {
    mockSendMutation.mockImplementation(() => Promise.reject(new Error('Network error')));

    const { result } = renderHook(() => useSendMessage('channel-1' as any));

    await act(async () => {
      try {
        await result.current.sendMessage('Hello!');
      } catch {
        // Expected to throw
      }
    });

    // Message should be in error state
    await waitFor(() => {
      const msg = result.current.optimisticMessages.find(m => m.content === 'Hello!');
      expect(msg?._status).toBe('error');
    });
  });

  it('does NOT auto-remove error messages (they persist)', async () => {
    mockSendMutation.mockImplementation(() => Promise.reject(new Error('fail')));

    const { result } = renderHook(() => useSendMessage('channel-1' as any));

    await act(async () => {
      try {
        await result.current.sendMessage('Hello!');
      } catch {
        // Expected
      }
    });

    // Wait to ensure no auto-removal
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 4000));
    });

    // Error message should still be there
    expect(result.current.optimisticMessages.find(m => m.content === 'Hello!')).toBeTruthy();
  });

  it('retryMessage transitions error -> sending and re-calls mutation', async () => {
    mockSendMutation.mockImplementationOnce(() => Promise.reject(new Error('fail')));

    const { result } = renderHook(() => useSendMessage('channel-1' as any));

    await act(async () => {
      try {
        await result.current.sendMessage('Hello!');
      } catch {
        // Expected
      }
    });

    // Get the failed message ID
    const failedMsg = result.current.optimisticMessages[0];
    expect(failedMsg._status).toBe('error');

    // Now retry (mutation will succeed this time)
    mockSendMutation.mockImplementation(() => Promise.resolve('msg-id'));

    await act(async () => {
      await result.current.retryMessage(failedMsg._id);
    });

    // Should have called mutation again
    expect(mockSendMutation).toHaveBeenCalledTimes(2);
  });

  it('dismissMessage removes message from optimistic list', async () => {
    mockSendMutation.mockImplementation(() => Promise.reject(new Error('fail')));

    const { result } = renderHook(() => useSendMessage('channel-1' as any));

    await act(async () => {
      try {
        await result.current.sendMessage('Hello!');
      } catch {
        // Expected
      }
    });

    const failedMsg = result.current.optimisticMessages[0];

    await act(async () => {
      result.current.dismissMessage(failedMsg._id);
    });

    expect(result.current.optimisticMessages).toHaveLength(0);
  });

  it('flushes queued messages when connection restores', async () => {
    // Start offline
    mockConnectionStatus = { status: 'disconnected', isEffectivelyOffline: true };
    const { result, rerender } = renderHook(() => useSendMessage('channel-1' as any));

    // Send while offline
    await act(async () => {
      await result.current.sendMessage('Queued msg');
    });

    expect(result.current.optimisticMessages[0]._status).toBe('queued');

    // Come back online
    mockConnectionStatus = { status: 'connected', isEffectivelyOffline: false };
    rerender(undefined);

    // Wait for flush
    await waitFor(() => {
      expect(mockSendMutation).toHaveBeenCalled();
    });
  });

  it('flushes queued messages on slow connection (not effectively offline)', async () => {
    // Start offline
    mockConnectionStatus = { status: 'disconnected', isEffectivelyOffline: true };
    const { result, rerender } = renderHook(() => useSendMessage('channel-1' as any));

    // Send while offline
    await act(async () => {
      await result.current.sendMessage('Queued on slow');
    });

    expect(result.current.optimisticMessages[0]._status).toBe('queued');

    // Reconnect on slow (2G/3G) — isEffectivelyOffline is false
    mockConnectionStatus = { status: 'slow', isEffectivelyOffline: false };
    rerender(undefined);

    // Should still flush on slow connection
    await waitFor(() => {
      expect(mockSendMutation).toHaveBeenCalled();
    });
  });
});
