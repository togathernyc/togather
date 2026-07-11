import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { GhostThreadPointer } from '../GhostThreadPointer';

// Theme stub — GhostThreadPointer only reads a handful of color tokens.
jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      border: '#ccc',
      surfaceSecondary: '#eee',
      textTertiary: '#999',
      link: '#06c',
    },
  }),
}));

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

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

const PARENT_ID = 'msg_parent' as any;
const CHANNEL_ID = 'chan_1' as any;

describe('GhostThreadPointer', () => {
  it('is content-free: shows only the reply count, never the original message text', () => {
    const { queryByText, getByText } = render(
      <GhostThreadPointer
        parentMessageId={PARENT_ID}
        channelId={CHANNEL_ID}
        replyCount={2}
        onOpenThread={jest.fn()}
        onScrollToOriginal={jest.fn()}
      />,
    );

    // The count pill is present…
    expect(getByText('2 replies')).toBeTruthy();
    // …but the original message content must NOT leak into the ghost.
    expect(queryByText("Who's bringing snacks?")).toBeNull();
    expect(queryByText('replies to a message')).toBeNull();
  });

  it('tapping the "N replies" pill opens the thread (not scroll-to-original)', () => {
    const onOpenThread = jest.fn();
    const onScrollToOriginal = jest.fn();
    const { getByTestId } = render(
      <GhostThreadPointer
        parentMessageId={PARENT_ID}
        channelId={CHANNEL_ID}
        replyCount={3}
        onOpenThread={onOpenThread}
        onScrollToOriginal={onScrollToOriginal}
      />,
    );

    fireEvent.press(getByTestId('thread-replies-pill'));
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    expect(onScrollToOriginal).not.toHaveBeenCalled();
  });

  it('tapping the ghost body scrolls up to the original message', () => {
    const onOpenThread = jest.fn();
    const onScrollToOriginal = jest.fn();
    const { getByTestId } = render(
      <GhostThreadPointer
        parentMessageId={PARENT_ID}
        channelId={CHANNEL_ID}
        replyCount={1}
        onOpenThread={onOpenThread}
        onScrollToOriginal={onScrollToOriginal}
      />,
    );

    // The bubble body carries a stable testID derived from the parent id.
    fireEvent.press(getByTestId(`ghost-thread-${PARENT_ID}`));
    expect(onScrollToOriginal).toHaveBeenCalledTimes(1);
  });
});
