/**
 * Regression: first loadMore must not blank the list while the paginated query loads.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';

let mockPaginationLoading = false;
const mockLivePage = {
  messages: [{ _id: 'live-1', content: 'Live', createdAt: 100 }],
  hasMore: true,
  cursor: 'older-cursor',
};
const mockOlderPage = {
  messages: [{ _id: 'old-1', content: 'Old', createdAt: 50 }],
  hasMore: false,
  cursor: undefined,
};

jest.mock('@services/api/convex', () => ({
  useQuery: jest.fn((_api: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const a = args as { cursor?: string };
    if (a.cursor != null) {
      if (mockPaginationLoading) return undefined;
      return mockOlderPage;
    }
    return mockLivePage;
  }),
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

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({
    token: 'test-token',
  }),
}));

jest.mock('../../../../stores/messageCache', () => ({
  useMessageCache: jest.fn(() => ({
    getChannelMessages: jest.fn((): null => null),
    setChannelMessages: jest.fn(),
  })),
}));

import { useMessages } from '../useMessages';

describe('useMessages pagination', () => {
  beforeEach(() => {
    mockPaginationLoading = false;
  });

  it('keeps showing live messages while paginated query is loading', async () => {
    const { result } = renderHook(() => useMessages('ch-1' as any, 20));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]._id).toBe('live-1');
    });

    mockPaginationLoading = true;

    await act(async () => {
      result.current.loadMore();
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]._id).toBe('live-1');
  });
});
