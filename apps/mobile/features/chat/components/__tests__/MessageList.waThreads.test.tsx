/**
 * The reply/thread timeline, end to end through MessageList.
 *
 * Flag-ON there are NO ghost rows: a lone reply is a real bubble carrying its
 * parent's quote, and a collapsed thread is one pill on the parent. Flag-OFF
 * the ghost + old pill model is untouched, which is the whole point of the
 * flag gate — the two branches must not bleed into each other.
 *
 * The activation rule itself (1 reply inline vs 2+ collapsed) is decided
 * server-side; here we prove the client renders exactly what the query hands
 * it and asks the query for the right thing.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

let mockShellEnabled = false;
let mockMessagesResult: any;
const mockUseMessages = jest.fn();

jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockShellEnabled,
  useWhatsappShellState: () => ({ enabled: mockShellEnabled, loaded: true }),
}));
jest.mock('../../hooks/useMessages', () => ({
  useMessages: (...args: any[]) => {
    mockUseMessages(...args);
    return mockMessagesResult;
  },
}));
jest.mock('../../context/ChatPrefetchContext', () => ({
  useChatPrefetch: () => null,
}));
jest.mock('../../context/ReactionsContext', () => ({
  ReactionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../MessageItem', () => {
  const { View } = require('react-native');
  return {
    MessageItem: (props: any) => (
      <View
        testID={`item-${props.message._id}`}
        // Surfaced so assertions can read what the list decided to pass down.
        accessibilityValue={{
          text: JSON.stringify({
            quotedParent: props.replyQuote?.parentMessageId ?? null,
            threadCount: props.threadSummary?.replyCount ?? null,
            hasQuoteHandler: !!props.onQuotePress,
          }),
        }}
      />
    ),
  };
});
jest.mock('../GhostThreadPointer', () => {
  const { View } = require('react-native');
  return {
    GhostThreadPointer: (props: any) => (
      <View testID={`ghost-${props.parentMessageId}`} />
    ),
  };
});
jest.mock('@services/api/convex', () => ({ api: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { MessageList } from '../MessageList';

const T0 = 1_700_000_000_000;

const parent = {
  _id: 'msg-parent',
  _creationTime: T0,
  channelId: 'ch-1',
  senderId: 'user-2',
  content: 'Who is bringing the chairs?',
  contentType: 'text',
  createdAt: T0,
  isDeleted: false,
  senderName: 'Dara Peters',
};

const loneReply = {
  _id: 'msg-reply',
  _creationTime: T0 + 1000,
  channelId: 'ch-1',
  senderId: 'user-1',
  content: "I've got them",
  contentType: 'text',
  createdAt: T0 + 1000,
  isDeleted: false,
  senderName: 'Ada Nwosu',
  parentMessageId: 'msg-parent',
  replyQuote: {
    parentMessageId: 'msg-parent',
    parentSenderId: 'user-2',
    parentSenderName: 'Dara Peters',
    parentContent: 'Who is bringing the chairs?',
  },
};

function setMessages(messages: any[]) {
  mockMessagesResult = {
    messages,
    isLoading: false,
    hasMore: false,
    isStale: false,
    loadMore: jest.fn(),
  };
}

function renderList() {
  return render(
    <MessageList channelId={'ch-1' as any} currentUserId={'user-1' as any} />,
  );
}

function passedTo(node: any) {
  return JSON.parse(node.props.accessibilityValue.text);
}

describe('MessageList flag-on — replies in the timeline', () => {
  beforeEach(() => {
    mockShellEnabled = true;
    mockUseMessages.mockClear();
  });

  it('asks the query for WhatsApp reply rendering', () => {
    setMessages([parent]);
    renderList();
    // (channelId, pageSize, groupId, anchor, waReplies)
    expect(mockUseMessages.mock.calls.at(-1)?.[4]).toBe(true);
  });

  it('renders a lone reply as its own row, with its parent quoted', () => {
    setMessages([parent, loneReply]);
    const { getByTestId, queryByTestId } = renderList();

    expect(queryByTestId('item-msg-reply')).not.toBeNull();
    expect(passedTo(getByTestId('item-msg-reply'))).toMatchObject({
      quotedParent: 'msg-parent',
      hasQuoteHandler: true,
    });
    // The parent carries no thread affordance — one reply is not a thread.
    expect(passedTo(getByTestId('item-msg-parent')).threadCount).toBeNull();
  });

  it('never floats a ghost, even for a bumped parent', () => {
    // A parent whose lastActivityAt was bumped past createdAt is exactly the
    // shape that makes the flag-off timeline emit a ghost.
    setMessages([
      { ...parent, threadReplyCount: 1, lastActivityAt: T0 + 1000 },
      loneReply,
    ]);
    const { queryByTestId } = renderList();
    expect(queryByTestId('ghost-msg-parent')).toBeNull();
  });

  it('shows the parent with one summary pill once the thread collapses', () => {
    // Both replies are gone from the page — the server dropped them — and the
    // parent arrives decorated.
    setMessages([
      {
        ...parent,
        threadReplyCount: 2,
        lastActivityAt: T0 + 2000,
        threadSummary: {
          replyCount: 2,
          lastReplyAt: T0 + 2000,
          repliers: [{ userId: 'user-1', name: 'Ada Nwosu' }],
        },
      },
    ]);
    const { getByTestId, queryByTestId } = renderList();

    expect(queryByTestId('item-msg-reply')).toBeNull();
    expect(queryByTestId('ghost-msg-parent')).toBeNull();
    expect(passedTo(getByTestId('item-msg-parent')).threadCount).toBe(2);
  });

  it('quotes an in-flight optimistic reply from the loaded parent', () => {
    setMessages([parent]);
    const { getByTestId } = render(
      <MessageList
        channelId={'ch-1' as any}
        currentUserId={'user-1' as any}
        optimisticMessages={[
          {
            _id: 'optimistic-1',
            channelId: 'ch-1' as any,
            senderId: 'user-1' as any,
            content: "I've got them",
            contentType: 'text',
            parentMessageId: 'msg-parent' as any,
            createdAt: T0 + 1000,
            isDeleted: false,
            senderName: 'Ada Nwosu',
            _optimistic: true,
            _status: 'sending',
          },
        ]}
      />,
    );
    // No quote-less flash while the send is in flight.
    expect(passedTo(getByTestId('item-optimistic-1'))).toMatchObject({
      quotedParent: 'msg-parent',
    });
  });

  it('reports the parent AND its inline reply as ways into the same thread', () => {
    // This is the signal the chat room follows to navigate the sender into the
    // thread on the send that collapses it. Replying to the inline reply roots
    // at the same parent, so it has to map onto the same thread — otherwise the
    // owner's exact tap ("reply to the reply") sends them nowhere and their
    // message appears to vanish.
    const onCollapsibleThreadsChange = jest.fn();
    setMessages([parent, loneReply]);
    render(
      <MessageList
        channelId={'ch-1' as any}
        currentUserId={'user-1' as any}
        onCollapsibleThreadsChange={onCollapsibleThreadsChange}
      />,
    );
    expect(onCollapsibleThreadsChange).toHaveBeenCalledWith(
      new Map([
        ['msg-parent', 'msg-parent'],
        ['msg-reply', 'msg-parent'],
      ]),
    );
  });

  it('reports nothing collapsible for a parent with no reply yet', () => {
    const onCollapsibleThreadsChange = jest.fn();
    setMessages([parent]);
    render(
      <MessageList
        channelId={'ch-1' as any}
        currentUserId={'user-1' as any}
        onCollapsibleThreadsChange={onCollapsibleThreadsChange}
      />,
    );
    expect(onCollapsibleThreadsChange).toHaveBeenCalledWith(new Map());
  });

  it('reports nothing collapsible once the thread has already collapsed', () => {
    // Already a thread — a further reply changes nothing about the timeline, so
    // there is nothing to follow the sender into.
    const onCollapsibleThreadsChange = jest.fn();
    setMessages([
      {
        ...parent,
        threadReplyCount: 2,
        threadSummary: {
          replyCount: 2,
          lastReplyAt: T0 + 2000,
          repliers: [{ userId: 'user-1', name: 'Ada Nwosu' }],
        },
      },
    ]);
    render(
      <MessageList
        channelId={'ch-1' as any}
        currentUserId={'user-1' as any}
        onCollapsibleThreadsChange={onCollapsibleThreadsChange}
      />,
    );
    expect(onCollapsibleThreadsChange).toHaveBeenCalledWith(new Map());
  });

  it('renders a reply whose parent is not in the loaded window', () => {
    // Pagination: the parent is hundreds of messages up. The quote still has
    // everything it needs, because the reply carries it — this is the job the
    // ghost pointer used to do.
    setMessages([loneReply]);
    const { getByTestId } = renderList();
    expect(passedTo(getByTestId('item-msg-reply'))).toMatchObject({
      quotedParent: 'msg-parent',
    });
  });
});

describe('MessageList flag-off — the ghost model is untouched', () => {
  beforeEach(() => {
    mockShellEnabled = false;
    mockUseMessages.mockClear();
  });

  it('does not ask the query for WhatsApp reply rendering', () => {
    setMessages([parent]);
    renderList();
    expect(mockUseMessages.mock.calls.at(-1)?.[4]).toBe(false);
  });

  it('still floats a ghost for a bumped parent, and passes no decoration', () => {
    setMessages([{ ...parent, threadReplyCount: 1, lastActivityAt: T0 + 1000 }]);
    const { getByTestId, queryByTestId } = renderList();

    expect(queryByTestId('ghost-msg-parent')).not.toBeNull();
    expect(passedTo(getByTestId('item-msg-parent'))).toMatchObject({
      quotedParent: null,
      threadCount: null,
    });
  });

  it('emits no ghost for an unreplied message', () => {
    setMessages([parent]);
    const { queryByTestId } = renderList();
    expect(queryByTestId('ghost-msg-parent')).toBeNull();
  });

  it('never reports a collapsible thread — there are no inline replies at all', () => {
    const onCollapsibleThreadsChange = jest.fn();
    setMessages([{ ...parent, threadReplyCount: 1, lastActivityAt: T0 + 1000 }]);
    render(
      <MessageList
        channelId={'ch-1' as any}
        currentUserId={'user-1' as any}
        onCollapsibleThreadsChange={onCollapsibleThreadsChange}
      />,
    );
    expect(onCollapsibleThreadsChange).toHaveBeenCalledWith(new Map());
  });
});
