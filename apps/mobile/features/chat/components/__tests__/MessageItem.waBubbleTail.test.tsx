/**
 * MessageItem — the legacy CSS-triangle bubble tail must not survive flag-on.
 *
 * Regression suite for the "broken arrow" defect (owner device screenshots,
 * 2026-07-30): a small triangle rendered *detached* beside bubbles on BOTH
 * sides, mid-timeline. Root cause: the legacy tail is a zero-sized View with
 * transparent top/bottom borders parked 5pt OUTSIDE the bubble edge
 * (`styles.ownMessageTail` / `styles.otherMessageTail`), and its render was
 * gated only on `!isImageOnlyMessage` — never on the shell flag. Flag-on the
 * §5 bubble already expresses its tail as the SQUARED corner radius, so the
 * two treatments stacked; the rounder flag-on corner (and the fully rounded
 * corner on a grouped continuation bubble) left the triangle floating free.
 *
 * The tail is legacy chrome that must stay EXACTLY as-is flag-off, so every
 * shape is asserted in both states.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

let mockShellEnabled = true;

jest.mock('@features/chat/hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({ readByCount: 0, totalMembers: 0, isLoading: false }),
}));
jest.mock('@features/chat/hooks/useReactions', () => ({
  useReactions: () => ({ reactions: [], toggleReaction: jest.fn(), isLoading: false }),
}));
jest.mock('@features/chat/hooks/useLinkPreview', () => ({
  useLinkPreview: () => ({ preview: null, loading: false }),
}));
jest.mock('@services/api/convex', () => ({ api: {} }));
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockShellEnabled,
  useWhatsappShellState: () => ({ enabled: mockShellEnabled, loaded: true }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../EventLinkCard', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return { EventLinkCard: () => ReactLocal.createElement(View, { testID: 'event-card' }) };
});
jest.mock('../LinkPreviewCard', () => ({ LinkPreviewCard: () => null }));
jest.mock('../FileAttachment', () => ({ FileAttachment: () => null }));
jest.mock('../AudioPlayer', () => ({ AudioPlayer: () => null }));
jest.mock('../VideoPlayer', () => ({ VideoPlayer: () => null }));
jest.mock('../ImageAttachmentsGrid', () => ({ ImageAttachmentsGrid: () => null }));
jest.mock('../ThreadReplies', () => ({ ThreadReplies: () => null }));
jest.mock('../ReactionDetailsModal', () => ({ ReactionDetailsModal: () => null }));
jest.mock('../TaskCardFromMessage', () => ({ TaskCardFromMessage: () => null }));
jest.mock('../PollCardFromMessage', () => ({ PollCardFromMessage: () => null }));
jest.mock('../BugCardFromMessage', () => ({ BugCardFromMessage: () => null }));
jest.mock('../AvailabilityRequestCardFromMessage', () => ({
  AvailabilityRequestCardFromMessage: () => null,
}));
jest.mock('@components/ui', () => ({ AppImage: () => null, ImageViewer: () => null }));
jest.mock('@/utils/media', () => ({ getMediaUrl: (url: string) => url }));

import { MessageItem } from '../MessageItem';

const EVENT_URL = 'https://togather.nyc/e/evt123';

const base = {
  _id: 'msg-1' as any,
  channelId: 'ch-1' as any,
  senderId: 'user-2' as any,
  content: 'Hey there',
  contentType: 'text',
  createdAt: Date.now(),
  isDeleted: false,
  senderName: 'Ada Nwosu',
};

const replyQuote = {
  parentMessageId: 'msg-0' as any,
  parentDeleted: false,
  parentSenderId: 'user-3' as any,
  parentSenderName: 'Bo Adeyemi',
  parentContent: 'the original',
};

/**
 * Finds the tail by its GEOMETRY rather than its testID, so the assertion
 * still bites if the element is ever re-implemented or renamed: a CSS
 * triangle is a zero-sized box with one solid side border and transparent
 * top/bottom borders.
 */
function cssTriangleNodes(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  const found = (node.children ?? []).flatMap((child: any) => cssTriangleNodes(child));
  const style: any = StyleSheet.flatten(node.props?.style) ?? {};
  const isTriangle =
    style.width === 0 &&
    style.height === 0 &&
    (style.borderLeftWidth > 0 || style.borderRightWidth > 0) &&
    style.borderTopColor === 'transparent' &&
    style.borderBottomColor === 'transparent';
  return isTriangle ? [node, ...found] : found;
}

/** Every content shape a bubble can take, so no render path leaks the tail. */
const shapes: Array<{ name: string; props: Record<string, any> }> = [
  { name: 'plain text', props: { message: base } },
  {
    name: 'grouped continuation (fully rounded corner — where it floated free)',
    props: { message: base, isFirstInGroup: false },
  },
  { name: 'reply quote', props: { message: base, replyQuote } },
  { name: 'event-card-only', props: { message: { ...base, content: EVENT_URL } } },
  {
    name: 'text beside an event card',
    props: { message: { ...base, content: `Join us! ${EVENT_URL}` } },
  },
  { name: 'poll card', props: { message: { ...base, contentType: 'poll', pollId: 'poll-1' } } },
  {
    name: 'task card',
    props: { message: { ...base, contentType: 'task_card', taskId: 'task-1' } },
  },
  {
    name: 'image-only bubble',
    props: {
      message: {
        ...base,
        content: '',
        attachments: [{ type: 'image', url: 'https://images.togather.nyc/chat/p.jpg' }],
      },
    },
  },
  {
    name: 'captioned image bubble',
    props: {
      message: {
        ...base,
        attachments: [{ type: 'image', url: 'https://images.togather.nyc/chat/p.jpg' }],
      },
    },
  },
  { name: 'deleted message', props: { message: { ...base, isDeleted: true } } },
];

describe.each([
  ['incoming', 'user-1'],
  ['outgoing', 'user-2'],
])('no drawn tail flag-on (%s)', (_side, currentUserId) => {
  beforeEach(() => {
    mockShellEnabled = true;
  });

  it.each(shapes.map((s) => [s.name, s.props] as const))('%s', (_name, props) => {
    const { toJSON, queryByTestId } = render(
      <MessageItem {...(props as any)} currentUserId={currentUserId as any} />
    );

    expect(queryByTestId('legacy-bubble-tail')).toBeNull();
    expect(cssTriangleNodes(toJSON())).toHaveLength(0);
  });
});

describe('flag-off keeps the legacy tail exactly as it was', () => {
  beforeEach(() => {
    mockShellEnabled = false;
  });

  it('draws the left-pointing triangle on an incoming bubble', () => {
    const { getByTestId, toJSON } = render(
      <MessageItem message={base} currentUserId={'user-1' as any} />
    );

    const style: any = StyleSheet.flatten(getByTestId('legacy-bubble-tail').props.style);
    expect(style.position).toBe('absolute');
    expect(style.left).toBe(-5);
    expect(style.borderRightWidth).toBe(6);
    expect(cssTriangleNodes(toJSON())).toHaveLength(1);
  });

  it('draws the right-pointing triangle on an outgoing bubble', () => {
    const { getByTestId } = render(
      <MessageItem message={base} currentUserId={'user-2' as any} />
    );

    const style: any = StyleSheet.flatten(getByTestId('legacy-bubble-tail').props.style);
    expect(style.right).toBe(-5);
    expect(style.borderLeftWidth).toBe(6);
  });

  it('still draws it on a grouped continuation — flag-off does not group', () => {
    const { getByTestId } = render(
      <MessageItem message={base} currentUserId={'user-1' as any} isFirstInGroup={false} />
    );
    expect(getByTestId('legacy-bubble-tail')).toBeTruthy();
  });

  it('still omits it on an edge-to-edge image-only bubble', () => {
    const { queryByTestId } = render(
      <MessageItem
        message={{
          ...base,
          content: '',
          attachments: [{ type: 'image', url: 'https://images.togather.nyc/chat/p.jpg' }],
        }}
        currentUserId={'user-1' as any}
      />
    );
    expect(queryByTestId('legacy-bubble-tail')).toBeNull();
  });
});
