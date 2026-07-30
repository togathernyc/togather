/**
 * Channel-switch flicker guard.
 *
 * Tapping between channels in the chat room's tab strip restarts the
 * `useMessages` subscription, which reports `messages: []` + `isLoading:
 * true` for a beat. Flag-on, `MessageList` must keep the previous channel's
 * rows painted across that gap (stale-while-switch) and repaint a revisited
 * channel's own last page instantly, instead of tearing the list down to a
 * bare surface. Flag-off must keep today's blank loading branch exactly.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

let mockShellEnabled = false;
let mockMessagesResult: any = {
  messages: [],
  isLoading: false,
  hasMore: false,
  loadMore: jest.fn(),
};

jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockShellEnabled,
  useWhatsappShellState: () => ({ enabled: mockShellEnabled, loaded: true }),
}));
jest.mock('../../hooks/useMessages', () => ({
  useMessages: () => mockMessagesResult,
}));
jest.mock('../../context/ChatPrefetchContext', () => ({
  useChatPrefetch: () => null,
}));
jest.mock('../../context/ReactionsContext', () => ({
  ReactionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../MessageItem', () => {
  const { Text: RNText } = require('react-native');
  return {
    MessageItem: ({ message }: any) => (
      <RNText testID={`row-${message._id}`}>{message.content}</RNText>
    ),
  };
});
jest.mock('../GhostThreadPointer', () => ({ GhostThreadPointer: () => null }));
jest.mock('@services/api/convex', () => ({ api: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { MessageList } from '../MessageList';

const NOW = 1_700_000_000_000;

function msg(id: string, channelId: string, content: string) {
  return {
    _id: id,
    _creationTime: NOW,
    channelId,
    senderId: 'user-1',
    content,
    contentType: 'text',
    createdAt: NOW,
    isDeleted: false,
    senderName: 'Test User',
  };
}

const GENERAL = [msg('g1', 'ch-general', 'General hello')];
const HELPERS = [msg('h1', 'ch-helpers', 'Helpers hello')];

function loaded(messages: any[]) {
  return { messages, isLoading: false, hasMore: false, loadMore: jest.fn() };
}
function loading() {
  return { messages: [], isLoading: true, hasMore: false, loadMore: jest.fn() };
}

function renderList(channelId: string) {
  return render(
    <MessageList channelId={channelId as any} currentUserId={'user-1' as any} />
  );
}

describe('MessageList channel switching', () => {
  beforeEach(() => {
    mockShellEnabled = false;
    mockMessagesResult = loaded(GENERAL);
  });

  describe('flag on', () => {
    beforeEach(() => {
      mockShellEnabled = true;
    });

    it('keeps the previous channel rendered while the new channel loads', () => {
      mockMessagesResult = loaded(GENERAL);
      const { rerender, queryByTestId } = renderList('ch-general');
      expect(queryByTestId('row-g1')).toBeTruthy();

      // Tap "Helpers": the subscription restarts with no data yet.
      mockMessagesResult = loading();
      rerender(
        <MessageList channelId={'ch-helpers' as any} currentUserId={'user-1' as any} />
      );

      // No blank surface — General's rows are still painted.
      expect(queryByTestId('message-list-container')).toBeTruthy();
      expect(queryByTestId('row-g1')).toBeTruthy();

      // Helpers' first page lands → content swaps.
      mockMessagesResult = loaded(HELPERS);
      rerender(
        <MessageList channelId={'ch-helpers' as any} currentUserId={'user-1' as any} />
      );
      expect(queryByTestId('row-g1')).toBeNull();
      expect(queryByTestId('row-h1')).toBeTruthy();
    });

    it('repaints a revisited channel from its own buffered page, not the other channel', () => {
      mockMessagesResult = loaded(GENERAL);
      const { rerender, queryByTestId } = renderList('ch-general');

      mockMessagesResult = loaded(HELPERS);
      rerender(
        <MessageList channelId={'ch-helpers' as any} currentUserId={'user-1' as any} />
      );
      expect(queryByTestId('row-h1')).toBeTruthy();

      // Back to General, still loading — its own last page repaints, and
      // Helpers' rows are gone immediately.
      mockMessagesResult = loading();
      rerender(
        <MessageList channelId={'ch-general' as any} currentUserId={'user-1' as any} />
      );
      expect(queryByTestId('row-g1')).toBeTruthy();
      expect(queryByTestId('row-h1')).toBeNull();
    });

    it('does not append the new channel optimistic sends onto the stale list', () => {
      mockMessagesResult = loaded(GENERAL);
      const { rerender, queryByTestId } = renderList('ch-general');

      const optimistic = [
        {
          _id: 'opt-1',
          channelId: 'ch-helpers',
          senderId: 'user-1',
          content: 'Sending into Helpers',
          contentType: 'text',
          createdAt: NOW + 1000,
          isDeleted: false as const,
          senderName: 'Test User',
          _optimistic: true as const,
          _status: 'sending' as const,
        },
      ];

      mockMessagesResult = loading();
      rerender(
        <MessageList
          channelId={'ch-helpers' as any}
          currentUserId={'user-1' as any}
          optimisticMessages={optimistic as any}
        />
      );
      expect(queryByTestId('row-g1')).toBeTruthy();
      expect(queryByTestId('row-opt-1')).toBeNull();

      // Once Helpers' page arrives, the optimistic row shows normally.
      mockMessagesResult = loaded(HELPERS);
      rerender(
        <MessageList
          channelId={'ch-helpers' as any}
          currentUserId={'user-1' as any}
          optimisticMessages={optimistic as any}
        />
      );
      expect(queryByTestId('row-h1')).toBeTruthy();
      expect(queryByTestId('row-opt-1')).toBeTruthy();
    });

    // The hold's 2.5s bound needs fake timers, which don't mix with the rest
    // of this file — it lives in
    // ../../hooks/__tests__/useChannelSwitchBuffer.test.tsx instead.

    it('still shows the blank loading branch on a first-ever load', () => {
      mockMessagesResult = loading();
      const { queryByTestId } = renderList('ch-general');
      expect(queryByTestId('message-list-container')).toBeTruthy();
      expect(queryByTestId('row-g1')).toBeNull();
    });

    it('clears to empty when the new channel confirms it has no messages', () => {
      mockMessagesResult = loaded(GENERAL);
      const { rerender, queryByTestId } = renderList('ch-general');

      mockMessagesResult = loaded([]);
      rerender(
        <MessageList channelId={'ch-helpers' as any} currentUserId={'user-1' as any} />
      );
      expect(queryByTestId('row-g1')).toBeNull();
    });
  });

  describe('flag off (unchanged behavior)', () => {
    it('tears down to the blank loading branch on a channel switch', () => {
      mockMessagesResult = loaded(GENERAL);
      const { rerender, queryByTestId } = renderList('ch-general');
      expect(queryByTestId('row-g1')).toBeTruthy();

      mockMessagesResult = loading();
      rerender(
        <MessageList channelId={'ch-helpers' as any} currentUserId={'user-1' as any} />
      );
      expect(queryByTestId('message-list-container')).toBeTruthy();
      expect(queryByTestId('row-g1')).toBeNull();
    });

    it('does not buffer a revisited channel page', () => {
      mockMessagesResult = loaded(GENERAL);
      const { rerender, queryByTestId } = renderList('ch-general');

      mockMessagesResult = loaded(HELPERS);
      rerender(
        <MessageList channelId={'ch-helpers' as any} currentUserId={'user-1' as any} />
      );

      mockMessagesResult = loading();
      rerender(
        <MessageList channelId={'ch-general' as any} currentUserId={'user-1' as any} />
      );
      expect(queryByTestId('row-g1')).toBeNull();
      expect(queryByTestId('row-h1')).toBeNull();
    });
  });
});
