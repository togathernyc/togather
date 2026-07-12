import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GhostThreadPointer } from '../GhostThreadPointer';

// Theme stub — GhostThreadPointer only reads a handful of color tokens.
jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#ccc',
      surfaceSecondary: '#eee',
      textSecondary: '#666',
      textTertiary: '#999',
      link: '#06c',
      chatBubbleOwn: '#e0efff',
      chatBubbleOther: '#E5E5EA',
      chatBubbleOwnText: '#1a1a1a',
      chatBubbleOtherText: '#1a1a1a',
    },
  }),
}));

// Stub AppImage (the author avatar) — it pulls in native image plumbing we
// don't need here. Expose the resolved initials name so we can assert the
// avatar renders for other-side previews.
jest.mock('@components/ui', () => {
  const { Text: RNText } = require('react-native');
  return {
    AppImage: ({ placeholder }: { placeholder?: { name?: string } }) => (
      <RNText testID="ghost-avatar">{`avatar:${placeholder?.name ?? ''}`}</RNText>
    ),
  };
});

// Stub the "N replies" pill so the test isolates the ghost's wiring (the pill
// itself is exercised by ThreadReplies' own coverage). The stub exposes the
// count text and forwards its onPress so we can assert the open-thread target.
jest.mock('../ThreadReplies', () => {
  const { Text: RNText, Pressable: RNPressable } = require('react-native');
  return {
    ThreadReplies: ({ replyCount, onPress }: { replyCount: number; onPress?: () => void }) => (
      <RNPressable testID="thread-replies-pill" onPress={onPress}>
        <RNText>{`${replyCount} replies`}</RNText>
      </RNPressable>
    ),
  };
});

// Mock the replies hook — alignment now keys off the thread's LAST reply, so
// each test seeds the reply set that decides the side. `mockReplies` is the
// (asc-ordered) reply list the component reduces over to find the newest.
let mockReplies: Array<{ senderId?: string; createdAt: number }> = [];
jest.mock('../../hooks/useThreadReplies', () => ({
  useThreadReplies: () => ({ replies: mockReplies, isLoading: false, hasMore: false }),
}));

const PARENT_ID = 'msg_parent' as any;
const CHANNEL_ID = 'chan_1' as any;
const ME = 'user_me' as any;
const SOMEONE_ELSE = 'user_other' as any;

const baseProps = {
  parentMessageId: PARENT_ID,
  channelId: CHANNEL_ID,
  replyCount: 2,
  currentUserId: ME,
  onOpenThread: jest.fn(),
  onScrollToOriginal: jest.fn(),
};

beforeEach(() => {
  mockReplies = [];
});

describe('GhostThreadPointer', () => {
  it('shows the original message text (not just the reply count)', () => {
    mockReplies = [{ senderId: SOMEONE_ELSE, createdAt: 1 }];
    const { getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Who's bringing snacks?"
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
      />,
    );

    // The echoed original message text is shown…
    expect(getByText("Who's bringing snacks?")).toBeTruthy();
    // …alongside the count pill.
    expect(getByText('2 replies')).toBeTruthy();
  });

  it('left-aligns with the original author avatar + name when SOMEONE ELSE sent the last reply', () => {
    // Original authored by me, but the newest reply is from someone else →
    // the preview follows the last replier onto the LEFT, showing the original
    // author's identity. Proves alignment keys off the replier, not the author.
    mockReplies = [
      { senderId: ME, createdAt: 1 },
      { senderId: SOMEONE_ELSE, createdAt: 2 },
    ];
    const { getByTestId, getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Who's bringing snacks?"
        originalSenderId={ME}
        senderName="Samuel Baker"
        senderProfilePhoto="https://example.com/samuel.jpg"
      />,
    );

    expect(getByText('Samuel Baker')).toBeTruthy();
    expect(getByTestId('ghost-avatar')).toBeTruthy();
  });

  it('right-aligns with no avatar/name when the CURRENT USER sent the last reply', () => {
    // Original authored by someone else, but I sent the newest reply → the
    // preview follows me onto the RIGHT (no avatar/name). The inverse proof.
    mockReplies = [
      { senderId: SOMEONE_ELSE, createdAt: 1 },
      { senderId: ME, createdAt: 2 },
    ];
    const { queryByTestId, queryByText, getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Who's bringing snacks?"
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
      />,
    );

    // The text still shows…
    expect(getByText("Who's bringing snacks?")).toBeTruthy();
    // …but there's no avatar and no sender-name label on your own side.
    expect(queryByTestId('ghost-avatar')).toBeNull();
    expect(queryByText('Samuel Baker')).toBeNull();
  });

  it('falls back to the original author side before any replies have loaded', () => {
    // No replies loaded yet → align by the original author. Here that is me,
    // so the preview is right-aligned (no avatar/name).
    mockReplies = [];
    const { queryByTestId } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Can we move it to 7:30 instead?"
        originalSenderId={ME}
        senderName="Me"
      />,
    );

    expect(queryByTestId('ghost-avatar')).toBeNull();
  });

  it('renders a connector line linking the bubble to the replies pill', () => {
    mockReplies = [{ senderId: SOMEONE_ELSE, createdAt: 1 }];
    const { getByTestId } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Who's bringing snacks?"
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
      />,
    );

    expect(getByTestId(`ghost-thread-connector-${PARENT_ID}`)).toBeTruthy();
  });

  it('shows a placeholder for an image-only original', () => {
    mockReplies = [{ senderId: SOMEONE_ELSE, createdAt: 1 }];
    const { getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent=""
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
        attachments={[{ type: 'image' }]}
      />,
    );

    expect(getByText('📷 Photo')).toBeTruthy();
  });

  it('shows the deleted-message treatment for a deleted original', () => {
    mockReplies = [{ senderId: SOMEONE_ELSE, createdAt: 1 }];
    const { getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent=""
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
        isDeleted
      />,
    );

    expect(getByText('This message was deleted')).toBeTruthy();
  });

  it('tapping the "N replies" pill opens the thread (not scroll-to-original)', () => {
    mockReplies = [{ senderId: SOMEONE_ELSE, createdAt: 1 }];
    const onOpenThread = jest.fn();
    const onScrollToOriginal = jest.fn();
    const { getByTestId } = render(
      <GhostThreadPointer
        {...baseProps}
        replyCount={3}
        originalContent="Who's bringing snacks?"
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
        onOpenThread={onOpenThread}
        onScrollToOriginal={onScrollToOriginal}
      />,
    );

    fireEvent.press(getByTestId('thread-replies-pill'));
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    expect(onScrollToOriginal).not.toHaveBeenCalled();
  });

  it('tapping the bubble body scrolls up to the original message', () => {
    mockReplies = [{ senderId: SOMEONE_ELSE, createdAt: 1 }];
    const onOpenThread = jest.fn();
    const onScrollToOriginal = jest.fn();
    const { getByTestId } = render(
      <GhostThreadPointer
        {...baseProps}
        replyCount={1}
        originalContent="Who's bringing snacks?"
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
        onOpenThread={onOpenThread}
        onScrollToOriginal={onScrollToOriginal}
      />,
    );

    // The bubble body carries a stable testID derived from the parent id.
    fireEvent.press(getByTestId(`ghost-thread-${PARENT_ID}`));
    expect(onScrollToOriginal).toHaveBeenCalledTimes(1);
  });
});
