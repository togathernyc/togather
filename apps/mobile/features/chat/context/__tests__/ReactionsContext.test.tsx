/**
 * Tests for ReactionsContext prefetch integration
 *
 * TDD approach - these tests verify that:
 * 1. When prefetch data is available, the batch query is SKIPPED
 * 2. When prefetch data is NOT available, the batch query is CALLED
 *
 * This prevents the "pop-in" effect where reactions load after the screen renders.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { ReactionsProvider, useReactionsContext } from '../ReactionsContext';
import type { Id } from '@services/api/convex';

// Track what arguments useAuthenticatedQuery was called with
let lastQueryArgs: any = null;
let mockQueryResult: any = undefined;

// Mock the Convex hooks
jest.mock('@services/api/convex', () => ({
  useAuthenticatedQuery: jest.fn((queryFn, args) => {
    lastQueryArgs = args;
    return mockQueryResult;
  }),
  useAuthenticatedMutation: jest.fn(() => jest.fn()),
  api: {
    functions: {
      messaging: {
        reactions: {
          getReactionsForMessages: 'api.functions.messaging.reactions.getReactionsForMessages',
          toggleReaction: 'api.functions.messaging.reactions.toggleReaction',
        },
      },
    },
  },
}));

// Mock prefetch context - this is the key mock for testing prefetch integration
let mockPrefetchState: any = null;

jest.mock('../ChatPrefetchContext', () => ({
  useChatPrefetch: jest.fn(() => ({
    getPrefetchState: jest.fn((channelId: string) => mockPrefetchState),
  })),
}));

// Test component that consumes the context
function TestConsumer({ messageId }: { messageId: string }) {
  const context = useReactionsContext();
  const reactions = context?.getReactions(messageId as Id<"chatMessages">);
  const isLoading = context?.isLoading ?? true;

  return (
    <View>
      <Text testID="loading">{isLoading ? 'loading' : 'ready'}</Text>
      <Text testID="reactions-count">{reactions?.length ?? 0}</Text>
    </View>
  );
}

describe('ReactionsContext prefetch integration', () => {
  const mockChannelId = 'channel-123' as Id<"chatChannels">;
  const mockMessageIds = ['msg-1', 'msg-2'] as Id<"chatMessages">[];

  beforeEach(() => {
    jest.clearAllMocks();
    lastQueryArgs = null;
    mockQueryResult = undefined;
    mockPrefetchState = null;
  });

  describe('when prefetch data is NOT available', () => {
    it('should call the batch query with messageIds', () => {
      // No prefetch data
      mockPrefetchState = null;

      render(
        <ReactionsProvider messageIds={mockMessageIds} channelId={mockChannelId}>
          <TestConsumer messageId="msg-1" />
        </ReactionsProvider>
      );

      // The query should be called with the messageIds (not 'skip')
      expect(lastQueryArgs).not.toBe('skip');
      expect(lastQueryArgs).toEqual({ messageIds: mockMessageIds });
    });

    it('should call batch query when prefetch status is not ready', () => {
      // Prefetch exists but is still loading
      mockPrefetchState = {
        status: 'loading',
        reactions: new Map(),
      };

      render(
        <ReactionsProvider messageIds={mockMessageIds} channelId={mockChannelId}>
          <TestConsumer messageId="msg-1" />
        </ReactionsProvider>
      );

      // Should still query since prefetch is not ready
      expect(lastQueryArgs).not.toBe('skip');
      expect(lastQueryArgs).toEqual({ messageIds: mockMessageIds });
    });
  });

  describe('when prefetch data IS available', () => {
    it('should STILL run the batch query for real-time updates (but use prefetch for initial render)', () => {
      // Prefetch is ready with reactions data
      mockPrefetchState = {
        status: 'ready',
        reactions: new Map([
          ['msg-1', [{ emoji: '👍', count: 1, userIds: ['user-1'], hasReacted: false }]],
        ]),
      };

      render(
        <ReactionsProvider messageIds={mockMessageIds} channelId={mockChannelId}>
          <TestConsumer messageId="msg-1" />
        </ReactionsProvider>
      );

      // The query should STILL run for real-time updates (Convex subscription)
      // Prefetch is only used while the live query is loading
      expect(lastQueryArgs).toEqual({ messageIds: mockMessageIds });
    });

    it('should return prefetched reactions immediately without loading state', async () => {
      const prefetchedReactions = [
        { emoji: '👍', count: 2, userIds: ['user-1', 'user-2'], hasReacted: true },
        { emoji: '❤️', count: 1, userIds: ['user-3'], hasReacted: false },
      ];

      mockPrefetchState = {
        status: 'ready',
        reactions: new Map([
          ['msg-1', prefetchedReactions],
        ]),
      };

      const { getByTestId } = render(
        <ReactionsProvider messageIds={mockMessageIds} channelId={mockChannelId}>
          <TestConsumer messageId="msg-1" />
        </ReactionsProvider>
      );

      // Should show ready state immediately (not loading)
      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('ready');
      });

      // Should have the correct number of reactions
      expect(getByTestId('reactions-count').props.children).toBe(2);
    });

    it('should return empty array for messages with no reactions when prefetch is ready', async () => {
      // Prefetch is ready but msg-2 has no reactions
      mockPrefetchState = {
        status: 'ready',
        reactions: new Map([
          ['msg-1', [{ emoji: '👍', count: 1, userIds: ['user-1'], hasReacted: false }]],
          // msg-2 intentionally not in the map
        ]),
      };

      const { getByTestId } = render(
        <ReactionsProvider messageIds={mockMessageIds} channelId={mockChannelId}>
          <TestConsumer messageId="msg-2" />
        </ReactionsProvider>
      );

      // Should show ready state (not loading)
      await waitFor(() => {
        expect(getByTestId('loading').props.children).toBe('ready');
      });

      // Should return 0 reactions (empty array, not undefined)
      expect(getByTestId('reactions-count').props.children).toBe(0);
    });
  });

  describe('when channelId is not provided', () => {
    it('should fall back to batch query even if prefetch exists', () => {
      mockPrefetchState = {
        status: 'ready',
        reactions: new Map([
          ['msg-1', [{ emoji: '👍', count: 1, userIds: ['user-1'], hasReacted: false }]],
        ]),
      };

      // No channelId provided
      render(
        <ReactionsProvider messageIds={mockMessageIds}>
          <TestConsumer messageId="msg-1" />
        </ReactionsProvider>
      );

      // Should query since channelId is not provided (can't look up prefetch)
      expect(lastQueryArgs).not.toBe('skip');
    });
  });
});
