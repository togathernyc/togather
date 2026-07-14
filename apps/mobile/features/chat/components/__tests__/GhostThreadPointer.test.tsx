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
// avatar renders for other-authored previews.
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

describe('GhostThreadPointer', () => {
  it('shows the original message text (not just the reply count)', () => {
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

  it('left-aligns with the sender avatar + name when someone else authored the original', () => {
    // Alignment keys off the ORIGINAL message's author (the approved spec):
    // someone else wrote it → left, showing their avatar + name.
    const { getByTestId, getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Who's bringing snacks?"
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
        senderProfilePhoto="https://example.com/samuel.jpg"
      />,
    );

    // Avatar + sender name are shown for other-authored previews (the mock's
    // left-aligned treatment). The own-authored test asserts the inverse.
    expect(getByText('Samuel Baker')).toBeTruthy();
    expect(getByTestId('ghost-avatar')).toBeTruthy();
  });

  it('right-aligns with no avatar/name when the current user authored the original', () => {
    // I wrote the original → right side, no avatar/name (like my own message
    // rows). This is the inverse of the other-authored case above.
    const { queryByTestId, queryByText, getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Can we move it to 7:30 instead?"
        originalSenderId={ME}
        senderName="Me"
      />,
    );

    // The text still shows…
    expect(getByText('Can we move it to 7:30 instead?')).toBeTruthy();
    // …but there's no avatar and no sender-name label for your own message.
    expect(queryByTestId('ghost-avatar')).toBeNull();
    expect(queryByText('Me')).toBeNull();
  });

  it('renders a muted "Original message" label so the echo reads as a reference, not a duplicate', () => {
    const { getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Who's bringing snacks?"
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
      />,
    );

    // The label is uppercased at render time via textTransform, so match the
    // source casing (not the on-screen glyphs).
    expect(getByText('↪ Original message')).toBeTruthy();
  });

  it('shows the "Original message" label even for own-authored (right-aligned) echoes', () => {
    const { getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent="Can we move it to 7:30 instead?"
        originalSenderId={ME}
        senderName="Me"
      />,
    );

    expect(getByText('↪ Original message')).toBeTruthy();
  });

  it('keeps the label on a deleted original (label sits alongside the deleted treatment)', () => {
    const { getByText } = render(
      <GhostThreadPointer
        {...baseProps}
        originalContent=""
        originalSenderId={SOMEONE_ELSE}
        senderName="Samuel Baker"
        isDeleted
      />,
    );

    expect(getByText('↪ Original message')).toBeTruthy();
    expect(getByText('This message was deleted')).toBeTruthy();
  });

  it('shows a placeholder for an image-only original', () => {
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
