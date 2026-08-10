/**
 * ThreadPage is keyed on the thread's ROOT, not on the id it was navigated
 * with.
 *
 * The pill and the ghost pointer always hand it a root, so for them the two
 * are the same message and nothing here changes. Inbox search does not: it
 * opens a hit's IMMEDIATE PARENT, which can itself be a reply. The backend
 * folds that back to the root when it returns the thread's replies, and the
 * page adopts it — otherwise the tapped reply renders once as the page header
 * and a second time inside the folded reply list, and the composer, the header
 * and the notification bell each mean a different "thread".
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const ROOT_ID = 'msg-root';
const MIDDLE_ID = 'msg-middle';
const LEAF_ID = 'msg-leaf';
const CHANNEL_ID = 'ch-1';

const message = (id: string, content: string) => ({
  _id: id,
  _creationTime: 0,
  channelId: CHANNEL_ID,
  senderId: 'user-2',
  content,
  contentType: 'text',
  createdAt: 0,
  isDeleted: false,
  senderName: 'Dara Peters',
});

const messagesById: Record<string, ReturnType<typeof message>> = {
  [ROOT_ID]: message(ROOT_ID, 'Who is bringing the chairs?'),
  [MIDDLE_ID]: message(MIDDLE_ID, "I've got them"),
  [LEAF_ID]: message(LEAF_ID, 'How many?'),
};

// What the backend resolved the thread to. Flipped per test.
let mockRootMessageId: string | undefined = ROOT_ID;
const mockUseParentMessage = jest.fn((id: string | null) => ({
  message: id ? messagesById[id] : null,
  isLoading: false,
}));
const mockUseThreadReplies = jest.fn((_id: string | null) => ({
  replies: [messagesById[MIDDLE_ID], messagesById[LEAF_ID]],
  isLoading: false,
  hasMore: false,
  rootMessageId: mockRootMessageId,
}));

jest.mock('../../hooks/useParentMessage', () => ({
  useParentMessage: (id: any) => mockUseParentMessage(id),
}));
jest.mock('../../hooks/useThreadReplies', () => ({
  useThreadReplies: (id: any) => mockUseThreadReplies(id),
}));
jest.mock('../../../groups/hooks/useGroupDetails', () => ({
  useGroupDetails: () => ({ data: undefined }),
}));

const mockUseQuery = jest.fn(() => undefined);
jest.mock('@services/api/convex', () => ({
  api: {
    functions: {
      messaging: {
        reactions: { toggleReaction: 'toggleReaction' },
        messages: { deleteMessage: 'deleteMessage' },
        flagging: { flagMessage: 'flagMessage' },
        threadSubscriptions: {
          setThreadSubscription: 'setThreadSubscription',
          getThreadSubscription: 'getThreadSubscription',
        },
      },
    },
  },
  useMutation: () => jest.fn(),
  useQuery: (...args: any[]) => mockUseQuery(...(args as [])),
  useStoredAuthToken: () => 'token-1',
}));

jest.mock('@providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', is_admin: false } }),
}));
jest.mock('@hooks/useCommunityTheme', () => ({
  useCommunityTheme: () => ({ primaryColor: '#000' }),
}));
jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      surface: '#fff',
      border: '#eee',
      text: '#000',
      textSecondary: '#666',
      textTertiary: '#999',
    },
    isDark: false,
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

jest.mock('@shopify/flash-list', () => {
  const { View } = require('react-native');
  return {
    FlashList: ({ data, renderItem }: any) => (
      <View>{data.map((item: any, index: number) => (
        <View key={index}>{renderItem({ item })}</View>
      ))}</View>
    ),
  };
});

jest.mock('../ThreadHeader', () => ({ ThreadHeader: () => null }));
jest.mock('../MessageActionsOverlay', () => ({ MessageActionsOverlay: () => null }));

// Both surfaces that must agree on which message the thread is.
jest.mock('../MessageItem', () => {
  const { View } = require('react-native');
  return {
    MessageItem: (props: any) => <View testID={`item-${props.message._id}`} />,
  };
});
jest.mock('../MessageInput', () => {
  const { View } = require('react-native');
  return {
    MessageInput: (props: any) => (
      <View testID={`composer-replying-to-${props.replyToMessage?._id}`} />
    ),
  };
});

import { ThreadPage } from '../ThreadPage';

describe('ThreadPage — the page adopts the resolved thread root', () => {
  beforeEach(() => {
    mockRootMessageId = ROOT_ID;
    mockUseParentMessage.mockClear();
    mockUseQuery.mockClear();
  });

  it('opened from inbox search on a REPLY, it headers the root — once', () => {
    // Search navigates with the hit's immediate parent, which here is itself a
    // reply. Before canonicalizing, that reply was both the header and a row in
    // the reply list below it.
    const { queryByTestId, queryAllByTestId } = render(
      <ThreadPage messageId={MIDDLE_ID as any} groupId={'grp-1' as any} />,
    );

    expect(mockUseParentMessage).toHaveBeenCalledWith(ROOT_ID);
    expect(mockUseParentMessage).not.toHaveBeenCalledWith(MIDDLE_ID);
    expect(queryByTestId(`item-${ROOT_ID}`)).not.toBeNull();
    // The tapped reply appears exactly once, in the reply list.
    expect(queryAllByTestId(`item-${MIDDLE_ID}`)).toHaveLength(1);
  });

  it('the composer and the notification bell key off the root too', () => {
    render(<ThreadPage messageId={MIDDLE_ID as any} groupId={'grp-1' as any} />);

    // A reply typed here belongs to the thread, not to whatever was tapped.
    expect(mockUseQuery).toHaveBeenCalledWith('getThreadSubscription', {
      token: 'token-1',
      threadId: ROOT_ID,
    });
  });

  it('composes against the root', () => {
    const { queryByTestId } = render(
      <ThreadPage messageId={MIDDLE_ID as any} groupId={'grp-1' as any} />,
    );
    expect(queryByTestId(`composer-replying-to-${ROOT_ID}`)).not.toBeNull();
  });

  it('the pill and ghost entry points are unaffected — they already pass a root', () => {
    const { queryByTestId } = render(
      <ThreadPage messageId={ROOT_ID as any} groupId={'grp-1' as any} />,
    );
    expect(mockUseParentMessage).toHaveBeenCalledWith(ROOT_ID);
    expect(queryByTestId(`item-${ROOT_ID}`)).not.toBeNull();
  });

  it('falls back to the navigated id until the thread resolves', () => {
    // First paint, before the replies query answers: nothing to adopt yet, so
    // the page behaves exactly as it did before.
    mockRootMessageId = undefined;
    render(<ThreadPage messageId={MIDDLE_ID as any} groupId={'grp-1' as any} />);
    expect(mockUseParentMessage).toHaveBeenCalledWith(MIDDLE_ID);
  });
});
