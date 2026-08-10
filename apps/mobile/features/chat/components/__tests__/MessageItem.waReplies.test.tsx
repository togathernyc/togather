/**
 * How a reply and a collapsed thread render on a bubble — flag-on AND the
 * flag-off twin.
 *
 * The load-bearing claims:
 *  - the quote block sits INSIDE the bubble, above the body, and it does not
 *    disturb the in-flight inline-timestamp pattern (the invisible reservation
 *    must stay the last inline child of the body text);
 *  - a photo reply keeps its bubble instead of going edge-to-edge, or the quote
 *    would float on a transparent fill;
 *  - flag-on the thread affordance is the new pill and appears ONLY for a
 *    collapsed thread; flag-off it is still the old ThreadReplies indicator,
 *    driven off `threadReplyCount`, and no quote renders at all.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../EventLinkCard', () => ({ EventLinkCard: () => null }));
jest.mock('../LinkPreviewCard', () => ({ LinkPreviewCard: () => null }));
jest.mock('../FileAttachment', () => ({ FileAttachment: () => null }));
jest.mock('../AudioPlayer', () => ({ AudioPlayer: () => null }));
jest.mock('../VideoPlayer', () => ({ VideoPlayer: () => null }));
jest.mock('../ImageAttachmentsGrid', () => {
  const { View } = require('react-native');
  return { ImageAttachmentsGrid: () => <View testID="image-grid" /> };
});
jest.mock('../ReactionDetailsModal', () => ({ ReactionDetailsModal: () => null }));
jest.mock('../TaskCardFromMessage', () => ({ TaskCardFromMessage: () => null }));
jest.mock('@components/ui', () => {
  const { View } = require('react-native');
  return { AppImage: () => <View />, ImageViewer: () => null };
});
jest.mock('@/utils/media', () => ({ getMediaUrl: (url: string) => url }));

// The flag-off thread indicator, marked so we can prove which one rendered.
jest.mock('../ThreadReplies', () => {
  const { View } = require('react-native');
  return { ThreadReplies: () => <View testID="legacy-thread-replies" /> };
});

// Flipped per-suite via the shared mock below.
let mockShellEnabled = true;
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockShellEnabled,
  useWhatsappShellState: () => ({ enabled: mockShellEnabled, loaded: true }),
}));

import { MessageItem } from '../MessageItem';

const CURRENT_USER = 'user-1' as any;

const reply = {
  _id: 'msg-reply' as any,
  channelId: 'ch-1' as any,
  senderId: 'user-1' as any,
  content: "I've got them",
  contentType: 'text',
  createdAt: Date.now(),
  isDeleted: false,
  senderName: 'Ada Nwosu',
};

const quote = {
  parentMessageId: 'msg-parent' as any,
  parentSenderId: 'user-2' as any,
  parentSenderName: 'Dara Peters',
  parentContent: 'Who is bringing the chairs?',
};

const summary = {
  replyCount: 3,
  lastReplyAt: Date.now() - 60_000,
  repliers: [{ userId: 'user-2' as any, name: 'Dara Peters' }],
};

describe('MessageItem — flag-on replies', () => {
  beforeEach(() => {
    mockShellEnabled = true;
  });

  test('a reply renders the quote inside its bubble, above the body', () => {
    const { getByTestId, getByText } = render(
      <MessageItem message={reply} currentUserId={CURRENT_USER} replyQuote={quote} />,
    );

    const quoteNode = getByTestId('wa-reply-quote-msg-parent');
    const body = getByText("I've got them");

    // Shared ancestry: the quote and the body sit under one common container
    // (the bubble), so the quote is IN the bubble, not a row above it.
    const quoteAncestors = new Set<any>();
    for (let n = quoteNode.parent; n; n = n.parent) quoteAncestors.add(n);
    let shared: any = body.parent;
    while (shared && !quoteAncestors.has(shared)) shared = shared.parent;
    expect(shared).not.toBeNull();

    // Document order: the quote precedes the body.
    const order = (root: any, target: any): number => {
      let index = -1;
      let seen = 0;
      const walk = (n: any) => {
        if (n === target) index = seen;
        seen += 1;
        (n.children ?? []).forEach((c: any) => typeof c !== 'string' && walk(c));
      };
      walk(root);
      return index;
    };
    expect(order(shared, quoteNode)).toBeLessThan(order(shared, body));
  });

  test('the inline-timestamp reservation stays the LAST inline child of the body', () => {
    const { getByTestId } = render(
      <MessageItem message={reply} currentUserId={CURRENT_USER} replyQuote={quote} />,
    );
    const reservation = getByTestId('wa-timestamp-reservation');
    const bodyText = reservation.parent;
    const inlineChildren = (bodyText?.children ?? []).filter(
      (c: any) => typeof c !== 'string',
    );
    expect(inlineChildren[inlineChildren.length - 1]).toBe(reservation);
  });

  test('a photo reply keeps its bubble rather than going edge-to-edge', () => {
    const photoReply = {
      ...reply,
      content: '',
      attachments: [{ type: 'image', url: 'https://cdn.test/a.jpg' }],
    };
    const withQuote = render(
      <MessageItem
        message={photoReply}
        currentUserId={CURRENT_USER}
        replyQuote={quote}
      />,
    );
    // The quote renders, which it could not do on a transparent image-only
    // bubble — and the footer (suppressed on image-only bubbles) is back.
    expect(withQuote.queryByTestId('wa-reply-quote-msg-parent')).not.toBeNull();
    expect(withQuote.queryByTestId('wa-bubble-footer')).not.toBeNull();

    // Without a quote the same message is still edge-to-edge.
    const plain = render(
      <MessageItem message={photoReply} currentUserId={CURRENT_USER} />,
    );
    expect(plain.queryByTestId('wa-bubble-footer')).toBeNull();
  });

  test('the pill appears only for a collapsed thread', () => {
    const noSummary = render(
      <MessageItem
        message={{ ...reply, _id: 'msg-parent' as any, threadReplyCount: 1 }}
        currentUserId={CURRENT_USER}
      />,
    );
    // One reply is not a thread: no pill, and never the legacy indicator.
    expect(noSummary.queryByTestId('wa-thread-summary-pill')).toBeNull();
    expect(noSummary.queryByTestId('legacy-thread-replies')).toBeNull();

    const collapsed = render(
      <MessageItem
        message={{ ...reply, _id: 'msg-parent' as any, threadReplyCount: 3 }}
        currentUserId={CURRENT_USER}
        threadSummary={summary}
      />,
    );
    expect(collapsed.queryByTestId('wa-thread-summary-pill')).not.toBeNull();
    expect(collapsed.queryByTestId('legacy-thread-replies')).toBeNull();
  });

  test('the collapsed thread shows its count and repliers, not just a pill', () => {
    // The owner's report was "it completely hides the thread": the replies left
    // the timeline and nothing took their place. A pill that renders but says
    // nothing is the same failure, so assert what it actually reads.
    const { getByTestId, getAllByTestId } = render(
      <MessageItem
        message={{ ...reply, _id: 'msg-parent' as any, threadReplyCount: 2 }}
        currentUserId={CURRENT_USER}
        threadSummary={{
          replyCount: 2,
          lastReplyAt: Date.now() - 5 * 60_000,
          repliers: [
            { userId: 'user-2' as any, name: 'Dara Peters' },
            { userId: 'user-3' as any, name: 'Tunde Bello' },
          ],
        }}
      />,
    );
    expect(getByTestId('wa-thread-summary-count').props.children).toBe('2 replies');
    expect(getByTestId('wa-thread-summary-time').props.children).toBe('5m ago');
    expect(getAllByTestId('wa-thread-summary-avatar')).toHaveLength(2);
  });

  test('a media parent still gets the pill — the bubble shape does not gate it', () => {
    // The thread that triggered the report hung off a video, so pin that the
    // affordance is not tangled up in the media/edge-to-edge bubble branches.
    const { queryByTestId } = render(
      <MessageItem
        message={{
          ...reply,
          _id: 'msg-parent' as any,
          content: '',
          threadReplyCount: 2,
          attachments: [{ type: 'video', url: 'https://cdn.test/a.mp4' }],
        }}
        currentUserId={CURRENT_USER}
        threadSummary={summary}
      />,
    );
    expect(queryByTestId('wa-thread-summary-pill')).not.toBeNull();
  });
});

describe('MessageItem — flag-off twin', () => {
  beforeEach(() => {
    mockShellEnabled = false;
  });

  test('no quote block renders even when the data is supplied', () => {
    const { queryByTestId } = render(
      <MessageItem message={reply} currentUserId={CURRENT_USER} replyQuote={quote} />,
    );
    expect(queryByTestId('wa-reply-quote-msg-parent')).toBeNull();
  });

  test('the old ThreadReplies indicator still drives off threadReplyCount', () => {
    const { queryByTestId } = render(
      <MessageItem
        message={{ ...reply, threadReplyCount: 1 }}
        currentUserId={CURRENT_USER}
        // Even if a summary were somehow present, flag-off ignores it.
        threadSummary={summary}
      />,
    );
    expect(queryByTestId('legacy-thread-replies')).not.toBeNull();
    expect(queryByTestId('wa-thread-summary-pill')).toBeNull();
  });

  test('no thread indicator at all without a reply count', () => {
    const { queryByTestId } = render(
      <MessageItem message={reply} currentUserId={CURRENT_USER} />,
    );
    expect(queryByTestId('legacy-thread-replies')).toBeNull();
  });
});
