/**
 * Tests for useMessages offline behavior (stale-while-revalidate)
 */
import { renderHook, waitFor } from '@testing-library/react-native';

// Mock convex query - override global jest.setup mock
let mockQueryResult: any = undefined;
jest.mock('@services/api/convex', () => ({
  useQuery: jest.fn(() => mockQueryResult),
  api: {
    functions: {
      messaging: {
        messages: {
          getMessages: 'getMessages',
        },
      },
    },
  },
}));

// Mock auth
jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({
    token: 'test-token',
  }),
}));

// Mock connection status
let mockConnectionStatus = { status: 'connected', isEffectivelyOffline: false } as { status: string; isEffectivelyOffline: boolean };
jest.mock('@providers/ConnectionProvider', () => ({
  useConnectionStatus: jest.fn(() => mockConnectionStatus),
}));

// Mock message cache
const mockGetChannelMessages = jest.fn((): any[] | null => null);
const mockSetChannelMessages = jest.fn();
jest.mock('../../../../stores/messageCache', () => ({
  useMessageCache: jest.fn(() => ({
    getChannelMessages: mockGetChannelMessages,
    setChannelMessages: mockSetChannelMessages,
  })),
}));

import { useMessages } from '../useMessages';

describe('useMessages offline behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult = undefined;
    mockConnectionStatus = { status: 'connected', isEffectivelyOffline: false };
    mockGetChannelMessages.mockReturnValue(null);
  });

  it('returns live messages when online and query returns data', async () => {
    mockQueryResult = {
      messages: [
        { _id: 'msg-1', content: 'Hello', createdAt: Date.now() },
      ],
      hasMore: false,
    };

    const { result } = renderHook(() => useMessages('ch-1' as any, 20));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.isStale).toBe(false);
    });
  });

  it('caches messages when live query returns data', async () => {
    mockQueryResult = {
      messages: [
        { _id: 'msg-1', content: 'Hello', createdAt: Date.now() },
      ],
      hasMore: false,
    };

    renderHook(() => useMessages('ch-1' as any, 20));

    await waitFor(() => {
      expect(mockSetChannelMessages).toHaveBeenCalledWith(
        'ch-1',
        expect.arrayContaining([
          expect.objectContaining({ _id: 'msg-1' }),
        ])
      );
    });
  });

  it('returns cached messages with isStale=true when offline and no live data', () => {
    mockConnectionStatus = { status: 'disconnected', isEffectivelyOffline: true };
    mockQueryResult = undefined; // No live data
    mockGetChannelMessages.mockReturnValue([
      { _id: 'msg-cached', content: 'Cached', createdAt: Date.now() },
    ]);

    const { result } = renderHook(() => useMessages('ch-1' as any, 20));

    // Should return cached data
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('Cached');
    expect(result.current.isStale).toBe(true);
  });

  it('returns cached messages when online but query is loading (stale-while-revalidate)', () => {
    mockConnectionStatus = { status: 'connected', isEffectivelyOffline: false };
    mockQueryResult = undefined; // Query hasn't resolved yet
    mockGetChannelMessages.mockReturnValue([
      { _id: 'msg-cached', content: 'Cached', createdAt: Date.now() },
    ]);

    const { result } = renderHook(() => useMessages('ch-1' as any, 20));

    // Should show cached messages immediately while query loads
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('Cached');
    expect(result.current.isStale).toBe(true);
  });

  it('returns empty messages when no live data and no cache', () => {
    mockConnectionStatus = { status: 'disconnected', isEffectivelyOffline: true };
    mockQueryResult = undefined;
    mockGetChannelMessages.mockReturnValue(null);

    const { result } = renderHook(() => useMessages('ch-1' as any, 20));

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.isStale).toBe(false);
  });

  it('isStale is false when returning live data', async () => {
    mockQueryResult = {
      messages: [{ _id: 'msg-1', content: 'Live', createdAt: Date.now() }],
      hasMore: false,
    };

    const { result } = renderHook(() => useMessages('ch-1' as any, 20));

    await waitFor(() => {
      expect(result.current.isStale).toBe(false);
    });
  });
});
