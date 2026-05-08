/**
 * Regression: when the live query returns 0 messages after the viewer loses
 * access (or messages are deleted), the hook must not keep showing buffered
 * older pages. See PR #378 — codex flagged that `getMessages` returning a
 * normal empty page on lost membership would still render pre-revocation
 * history because `olderMessagesRef` was preferred over an empty live result.
 */
import { renderHook, act, waitFor } from '@testing-library/react-native';

let mockLiveMessages: any[] = [
  { _id: 'live-1', content: 'Live', createdAt: 100 },
];
let mockOlderHasMore = true;
let mockLiveCursor: string | undefined = 'older-cursor';

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
      return mockOlderPage;
    }
    return {
      messages: mockLiveMessages,
      hasMore: mockOlderHasMore,
      cursor: mockLiveCursor,
    };
  }),
  useStoredAuthToken: jest.fn(() => 'test-token'),
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

jest.mock('../../../../stores/messageCache', () => ({
  useMessageCache: jest.fn(() => ({
    getChannelMessages: jest.fn((): null => null),
    setChannelMessages: jest.fn(),
  })),
}));

import { useMessages } from '../useMessages';

describe('useMessages access-revoked', () => {
  beforeEach(() => {
    mockLiveMessages = [{ _id: 'live-1', content: 'Live', createdAt: 100 }];
    mockOlderHasMore = true;
    mockLiveCursor = 'older-cursor';
  });

  it('clears buffered older messages when live query returns empty', async () => {
    const { result, rerender } = renderHook(() => useMessages('ch-1' as any, 20));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]._id).toBe('live-1');
    });

    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.messages.map((m: any) => m._id).sort()).toEqual([
        'live-1',
        'old-1',
      ]);
    });

    mockLiveMessages = [];
    mockOlderHasMore = false;
    mockLiveCursor = undefined;
    rerender();

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(0);
      expect(result.current.hasMore).toBe(false);
    });
  });
});
