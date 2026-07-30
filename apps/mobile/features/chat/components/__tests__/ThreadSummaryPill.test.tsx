/**
 * The single collapsed-thread affordance: contents, avatar stacking, and the
 * relative-time formatter.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('@components/ui', () => {
  const { View } = require('react-native');
  return {
    AppImage: ({ placeholder }: any) => (
      <View testID="pill-avatar" accessibilityLabel={placeholder?.name} />
    ),
  };
});

import { ThreadSummaryPill, formatLastReply } from '../ThreadSummaryPill';

const summary = {
  replyCount: 3,
  lastReplyAt: Date.now() - 5 * 60_000,
  repliers: [
    { userId: 'u1' as any, name: 'Dara Peters' },
    { userId: 'u2' as any, name: 'Ada Nwosu' },
  ],
};

describe('ThreadSummaryPill', () => {
  test('shows count, last-reply time and a chevron', () => {
    const { getByTestId } = render(<ThreadSummaryPill summary={summary} />);
    expect(getByTestId('wa-thread-summary-count').props.children).toBe(
      '3 replies',
    );
    expect(getByTestId('wa-thread-summary-time').props.children).toBe('5m ago');
  });

  test('singularises a one-reply count', () => {
    // Not a state the timeline produces (one reply renders inline), but the
    // copy must not read "1 replies" if it ever does.
    const { getByTestId } = render(
      <ThreadSummaryPill summary={{ ...summary, replyCount: 1 }} />,
    );
    expect(getByTestId('wa-thread-summary-count').props.children).toBe(
      '1 reply',
    );
  });

  test('a capped count reads "50+ replies", never a bare number', () => {
    // Past the backend's bounded count the number is a floor, so the pill must
    // not claim an exact figure it never read.
    const { getByTestId } = render(
      <ThreadSummaryPill
        summary={{ ...summary, replyCount: 50, replyCountCapped: true }}
      />,
    );
    expect(getByTestId('wa-thread-summary-count').props.children).toBe(
      '50+ replies',
    );
  });

  test('stacks up to three replier avatars with a negative overlap', () => {
    const many = {
      ...summary,
      repliers: [
        { userId: 'u1' as any, name: 'A' },
        { userId: 'u2' as any, name: 'B' },
        { userId: 'u3' as any, name: 'C' },
        { userId: 'u4' as any, name: 'D' },
      ],
    };
    const { getAllByTestId } = render(<ThreadSummaryPill summary={many} />);
    const avatars = getAllByTestId('pill-avatar');
    expect(avatars).toHaveLength(3);
    expect(avatars.map((a) => a.props.accessibilityLabel)).toEqual(['A', 'B', 'C']);

    // The rings, not the images, carry the overlap.
    const rings = getAllByTestId('wa-thread-summary-avatar');
    const margins = rings.map((r) => StyleSheet.flatten(r.props.style).marginLeft);
    expect(margins[0]).toBe(0);
    expect(margins[1]).toBeLessThan(0);
    expect(margins[2]).toBeLessThan(0);
  });

  test('renders the unread dot only when there is unread activity', () => {
    const read = render(<ThreadSummaryPill summary={summary} />);
    expect(read.queryByTestId('wa-thread-summary-unread')).toBeNull();

    const unread = render(
      <ThreadSummaryPill summary={{ ...summary, hasUnread: true }} />,
    );
    expect(unread.queryByTestId('wa-thread-summary-unread')).not.toBeNull();
  });

  test('opens the thread on press', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <ThreadSummaryPill summary={summary} onPress={onPress} />,
    );
    fireEvent.press(getByTestId('wa-thread-summary-pill'));
    expect(onPress).toHaveBeenCalled();
  });

  test('renders nothing for a zero count', () => {
    const { queryByTestId } = render(
      <ThreadSummaryPill summary={{ ...summary, replyCount: 0 }} />,
    );
    expect(queryByTestId('wa-thread-summary-pill')).toBeNull();
  });
});

describe('formatLastReply', () => {
  const now = 1_700_000_000_000;
  const ago = (ms: number) => formatLastReply(now - ms, now);

  test.each([
    [30 * 1000, 'now'],
    [5 * 60_000, '5m ago'],
    [3 * 3_600_000, '3h ago'],
    [26 * 3_600_000, 'yesterday'],
    [3 * 86_400_000, '3d ago'],
    [20 * 86_400_000, '2w ago'],
  ])('%i ms ago → %s', (ms, expected) => {
    expect(ago(ms as number)).toBe(expected);
  });

  test('clamps a clock-skewed future timestamp to "now"', () => {
    expect(formatLastReply(now + 60_000, now)).toBe('now');
  });
});
