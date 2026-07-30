/**
 * MessageItem — the event card as the message's own bubble (§7).
 *
 * Regression suite for the defect found reviewing PR #665: flag-on, a message
 * whose entire content is one event URL has an EMPTY `displayText` once the
 * link is stripped, but the normal bubble still rendered — so the thread
 * showed a stub metadata-only bubble (sender name + timestamp + tail, no
 * body) stacked on top of the card's own bubble. The card has to be the sole
 * bubble, the way `isSpecialCardMessage` already makes poll/task/bug cards.
 *
 * Boundaries matter as much as the fix: a message with text *beside* the link
 * still needs its text bubble, and flag-off must not move at all.
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
// A marker, not `null` — this suite counts bubbles, so the card has to be
// distinguishable from the message bubble that must NOT be there.
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
jest.mock('@components/ui', () => ({ AppImage: () => null, ImageViewer: () => null }));
jest.mock('@/utils/media', () => ({ getMediaUrl: (url: string) => url }));

import { MessageItem } from '../MessageItem';

const EVENT_URL = 'https://togather.nyc/e/evt123';
const TIME_RE = /^\d{1,2}:\d{2} (AM|PM)$/;

const incoming = {
  _id: 'msg-1' as any,
  channelId: 'ch-1' as any,
  senderId: 'user-2' as any,
  content: EVENT_URL,
  contentType: 'text',
  createdAt: Date.now(),
  isDeleted: false,
  senderName: 'Ada Nwosu',
};

/**
 * Every filled, rounded container in the tree — the shape a chat bubble has.
 * The stub bubble this suite guards against is exactly such a node, so
 * counting them is the direct assertion of "the card is the only bubble".
 */
function bubbleLikeNodes(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  const children = (node.children ?? []).flatMap((child: any) => bubbleLikeNodes(child));
  const style = StyleSheet.flatten(node.props?.style);
  const isBubble = !!style?.backgroundColor && typeof style?.borderRadius === 'number';
  return isBubble ? [node, ...children] : children;
}

beforeEach(() => {
  mockShellEnabled = true;
});

describe('event-link-only message (flag-on)', () => {
  it('renders the card as the only bubble — no empty stub bubble above it', () => {
    const { getAllByTestId, toJSON } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );

    expect(getAllByTestId('event-card')).toHaveLength(1);
    // The card mock draws nothing, so any bubble-shaped container left in the
    // tree is the stub bubble the fix removes.
    expect(bubbleLikeNodes(toJSON())).toHaveLength(0);
  });

  it('puts the sender name on the line above the card, since there is no bubble to host it', () => {
    const { getByText, queryByTestId } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );

    expect(getByText('Ada Nwosu')).toBeTruthy();
    // §S4.2's in-bubble name needs a bubble; this one is the above-content line.
    expect(queryByTestId('wa-bubble-footer')).toBeNull();
  });

  it('follows §5 grouping: no repeated name on a continuation card', () => {
    const { queryByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} isFirstInGroup={false} />
    );
    expect(queryByText('Ada Nwosu')).toBeNull();
  });

  it('never labels the sender on an outgoing card', () => {
    const { queryByText } = render(
      <MessageItem
        message={{ ...incoming, senderId: 'user-1' as any }}
        currentUserId={'user-1' as any}
      />
    );
    expect(queryByText('Ada Nwosu')).toBeNull();
  });

  it('falls back to a timestamp row under the card', () => {
    const { getByTestId, queryByTestId } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );

    const footer = getByTestId('wa-card-footer');
    expect(footer).toBeTruthy();
    // The §5 inline stamp needs a text run to sit beside; there isn't one.
    expect(queryByTestId('wa-timestamp-reservation')).toBeNull();
    expect(footer.props.children[0].props.children).toMatch(TIME_RE);
  });
});

describe('messages that still need their own bubble (flag-on)', () => {
  it('keeps the text bubble when the link is sent alongside a message', () => {
    const { getByText, getByTestId, queryByTestId, toJSON } = render(
      <MessageItem
        message={{ ...incoming, content: `Join us! ${EVENT_URL}` }}
        currentUserId={'user-1' as any}
      />
    );

    expect(getByText('Join us!')).toBeTruthy();
    expect(getByTestId('event-card')).toBeTruthy();
    expect(bubbleLikeNodes(toJSON()).length).toBeGreaterThan(0);
    // Text present -> #655's inline stamp applies again, inside the bubble,
    // so there is nothing for the under-card fallback row to do.
    expect(getByTestId('wa-timestamp-reservation')).toBeTruthy();
    expect(queryByTestId('wa-card-footer')).toBeNull();
  });

  it('keeps the bubble for a multi-card message, where one name line would be ambiguous', () => {
    const { getAllByTestId, getByTestId, queryByTestId, toJSON } = render(
      <MessageItem
        message={{ ...incoming, content: `${EVENT_URL} https://togather.nyc/e/evt456` }}
        currentUserId={'user-1' as any}
      />
    );

    expect(getAllByTestId('event-card')).toHaveLength(2);
    expect(bubbleLikeNodes(toJSON()).length).toBeGreaterThan(0);
    expect(getByTestId('wa-bubble-footer')).toBeTruthy();
    expect(queryByTestId('wa-card-footer')).toBeNull();
  });

  it('keeps the bubble when the SMS-blast badge has to live somewhere', () => {
    const { queryByTestId, toJSON } = render(
      <MessageItem
        message={{ ...incoming, blastId: 'blast-1' as any }}
        currentUserId={'user-1' as any}
      />
    );

    expect(bubbleLikeNodes(toJSON()).length).toBeGreaterThan(0);
    expect(queryByTestId('wa-card-footer')).toBeNull();
  });
});

describe('flag-off twin', () => {
  it('still renders the bubble, its footer and the above-content name', () => {
    mockShellEnabled = false;

    const { getByText, getByTestId, queryByTestId, toJSON } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );

    expect(bubbleLikeNodes(toJSON()).length).toBeGreaterThan(0);
    expect(getByText('Ada Nwosu')).toBeTruthy();
    expect(getByTestId('wa-bubble-footer')).toBeTruthy();
    expect(queryByTestId('wa-card-footer')).toBeNull();
  });

  it('still labels the sender on a continuation message, which flag-off does not group', () => {
    mockShellEnabled = false;

    const { getByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} isFirstInGroup={false} />
    );
    expect(getByText('Ada Nwosu')).toBeTruthy();
  });
});
