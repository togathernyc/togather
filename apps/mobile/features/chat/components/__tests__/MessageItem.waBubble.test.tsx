/**
 * WhatsApp-shell bubble anatomy (WA-VISUAL-DELTAS.md §S4.2).
 *
 * Flag-ON rendering only — `MessageItem.imageBubble`/`.status` cover the
 * flag-off baseline. Asserts the pieces that are invisible to a snapshot but
 * are exactly what "reads as WhatsApp": bubble fills, 16px body, the in-bubble
 * sender name in a per-sender hue, the 11px timestamp, and the drop shadow.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
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
// This suite is the flag-ON counterpart to the other MessageItem suites.
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => true,
  useWhatsappShellState: () => ({ enabled: true, loaded: true }),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../EventLinkCard', () => ({ EventLinkCard: () => null }));
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

const TIME_RE = /\d{1,2}:\d{2} (AM|PM)/;
/** The same time inside the reservation slug, where every space is a NBSP. */
const TIME_RE_NBSP = /\d{1,2}:\d{2}\u00A0(AM|PM)/;

const incoming = {
  _id: 'msg-1' as any,
  channelId: 'ch-1' as any,
  senderId: 'user-2' as any,
  content: 'Peace be with you',
  contentType: 'text',
  createdAt: Date.now(),
  isDeleted: false,
  senderName: 'Ada Nwosu',
};

/**
 * Body copy is rendered as nested `<Text>` runs (mentions/links/plain), so the
 * matched node is often an unstyled inner run — walk up to the styled one.
 */
function textStyleOf(node: any): any {
  let current = node;
  while (current) {
    const style = StyleSheet.flatten(current.props?.style);
    if (style?.fontSize) return style;
    current = current.parent;
  }
  throw new Error('no ancestor text style with a fontSize');
}

/** Every string rendered under `node`, in document order. */
function flatTextOf(node: any): string {
  const children = node?.children ?? [];
  return children
    .map((child: any) => (typeof child === 'string' ? child : flatTextOf(child)))
    .join('');
}

/** Walks up from an inline run to the styled body `<Text>` that contains it. */
function bodyTextOf(node: any): any {
  let current = node.parent;
  while (current) {
    if (StyleSheet.flatten(current.props?.style)?.fontSize === 16) return current;
    current = current.parent;
  }
  throw new Error('no 16pt body text ancestor');
}

/** Walks up from a text node to the bubble View that carries the fill. */
function bubbleStyleOf(node: any): any {
  let current = node.parent;
  while (current) {
    const style = StyleSheet.flatten(current.props?.style);
    if (style?.backgroundColor && style.borderRadius) return style;
    current = current.parent;
  }
  throw new Error('no bubble ancestor with a background fill');
}

describe('MessageItem WhatsApp bubbles (flag-on)', () => {
  it('fills an incoming bubble with the incoming (white) token, not the flag-off gray', () => {
    const { getByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    expect(bubbleStyleOf(getByText('Peace be with you')).backgroundColor).toBe('#FFFFFF');
  });

  it('fills an outgoing bubble with the pale-tint outgoing fill', () => {
    const { getByText } = render(
      <MessageItem
        message={{ ...incoming, senderId: 'user-1' as any }}
        currentUserId={'user-1' as any}
      />
    );
    const fill = bubbleStyleOf(getByText('Peace be with you')).backgroundColor;
    expect(fill).not.toBe('#FFFFFF');
    // §1.6: a light tint over white, never the full-saturation brand color.
    expect(fill).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('gives the bubble the 12pt radius and a soft drop shadow', () => {
    const { getByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    const style = bubbleStyleOf(getByText('Peace be with you'));
    // Calibrated pixel pass (2026-07-29): 12, not the spec prose's 18.
    expect(style.borderRadius).toBe(12);
    expect(style.shadowOpacity).toBeGreaterThan(0);
    // iOS clips shadows on `overflow: hidden`, so a text bubble must not clip.
    expect(style.overflow).toBe('visible');
  });

  it('renders body copy at 16px', () => {
    const { getByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    expect(textStyleOf(getByText('Peace be with you')).fontSize).toBe(16);
  });

  it('renders the sender name inside the bubble at 15pt semibold in a per-sender hue', () => {
    const { getByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    const nameStyle = textStyleOf(getByText('Ada Nwosu'));
    expect(nameStyle.fontSize).toBe(15);
    expect(nameStyle.fontWeight).toBe('600');
    // Deterministic per-sender color — never the neutral secondary gray.
    expect(nameStyle.color).toBe('#C77900');
    // …and it lives inside the bubble, not on a line above it.
    expect(bubbleStyleOf(getByText('Ada Nwosu')).backgroundColor).toBe('#FFFFFF');
  });

  it('hides the sender name on continuation bubbles in a run', () => {
    const { queryByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} isFirstInGroup={false} />
    );
    expect(queryByText('Ada Nwosu')).toBeNull();
  });

  it('never labels the sender on an outgoing bubble', () => {
    const { queryByText } = render(
      <MessageItem
        message={{ ...incoming, senderId: 'user-1' as any }}
        currentUserId={'user-1' as any}
      />
    );
    expect(queryByText('Ada Nwosu')).toBeNull();
  });

  it('renders the in-bubble timestamp at 11px', () => {
    const { getByTestId } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    // Two nodes carry the time now (see the inline-timestamp suite below), so
    // read the visible one out of its anchor rather than by text.
    // `includeHiddenElements` because the anchor is deliberately hidden from
    // accessibility — the reservation already voices the time.
    const visible = getByTestId('wa-bubble-footer', {
      includeHiddenElements: true,
    }).findByType(Text as any);
    expect(StyleSheet.flatten(visible.props.style).fontSize).toBe(11);
  });
});

/**
 * §5 "Bubble timestamp + ticks placement" — WhatsApp's inline timestamp.
 *
 * The timestamp is NOT a row under the text. An invisible slug is appended to
 * the end of the text flow and the real timestamp is painted absolutely in the
 * bubble's bottom-right corner, so short messages get the time beside their
 * last line (~15pt of bubble height back per message). These assertions pin
 * the three things that make that work — the reservation exists, it is the LAST
 * inline child, and the visible cluster is out of flow — plus the content
 * shapes that must fall back to the footer row.
 */
describe('MessageItem inline timestamp (flag-on)', () => {
  it('appends an invisible reservation carrying the same time as the visible stamp', () => {
    const { getByTestId } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    const reservation = getByTestId('wa-timestamp-reservation');
    const style = StyleSheet.flatten(reservation.props.style);
    expect(style.opacity).toBe(0);
    expect(style.color).toBe('transparent');
    // Same 11pt as the visible stamp, so the slug is never too narrow.
    expect(style.fontSize).toBe(11);
    // Non-breaking spaces only: the slug may wrap as a unit, never mid-way.
    const text: string = reservation.props.children;
    expect(text).toMatch(TIME_RE_NBSP);
    expect(text).not.toMatch(/ /);
    expect(text.startsWith('\u00A0\u00A0')).toBe(true);
  });

  it('places the reservation as the LAST inline child, after mention runs', () => {
    const { getByTestId } = render(
      <MessageItem
        message={{ ...incoming, content: 'ping @[Ada Nwosu] and see' }}
        currentUserId={'user-1' as any}
      />
    );
    // Rich text is several sibling runs (plain / mention / plain). The property
    // that matters is document order: the slug must come after ALL of them, or
    // the timestamp would reserve space mid-sentence.
    const reservation = getByTestId('wa-timestamp-reservation');
    const body = flatTextOf(bodyTextOf(reservation));
    expect(body).toContain('ping ');
    expect(body).toContain('@Ada Nwosu');
    expect(body).toContain(' and see');
    expect(body.endsWith(flatTextOf(reservation))).toBe(true);
  });

  it('lifts the visible timestamp out of flow into the bubble corner', () => {
    const { getByTestId } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    const style = StyleSheet.flatten(
      getByTestId('wa-bubble-footer', { includeHiddenElements: true }).props.style
    );
    expect(style.position).toBe('absolute');
    // Hidden from screen readers: the reservation already carries the time in
    // the body Text's label, so voicing this copy would stutter it.
    expect(
      getByTestId('wa-bubble-footer', { includeHiddenElements: true }).props
        .accessibilityElementsHidden
    ).toBe(true);
    // right: WA_BUBBLE_PADDING_H, bottom: WA_BUBBLE_PADDING_V - 1.
    expect(style.right).toBe(12);
    expect(style.bottom).toBe(6);
    // The flow paddings/margins it inherits must not offset the anchor.
    expect(style.paddingHorizontal).toBe(0);
    expect(style.paddingBottom).toBe(0);
    expect(style.marginTop).toBe(0);
  });

  it('moves the bubble bottom padding onto the text block', () => {
    const { getByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    // The footer used to own paddingBottom; with it out of flow the text block
    // has to, or the copy would run into the bubble's bottom edge.
    let node: any = getByText('Peace be with you');
    let paddingBottom: number | undefined;
    while (node) {
      const style = StyleSheet.flatten(node.props?.style);
      if (style?.paddingBottom !== undefined) {
        paddingBottom = style.paddingBottom;
        break;
      }
      node = node.parent;
    }
    expect(paddingBottom).toBe(7);
  });

  it('joins the edited badge to the reservation', () => {
    const { getByTestId } = render(
      <MessageItem
        message={{ ...incoming, editedAt: Date.now() }}
        currentUserId={'user-1' as any}
      />
    );
    expect(getByTestId('wa-timestamp-reservation').props.children).toContain('(edited)');
  });

  it('keeps the footer row when the bubble ends in media, not text', () => {
    const { getByTestId } = render(
      <MessageItem
        message={{
          ...incoming,
          attachments: [{ type: 'image', url: 'https://example.test/a.jpg' }],
        }}
        currentUserId={'user-1' as any}
      />
    );
    // An absolute bottom-right stamp would land on top of the photo.
    expect(StyleSheet.flatten(getByTestId('wa-bubble-footer').props.style).position).toBeUndefined();
  });

  it('keeps the footer row when the SMS-blast badge sits below the text', () => {
    const { getByTestId } = render(
      <MessageItem
        message={{ ...incoming, blastId: 'blast-1' as any }}
        currentUserId={'user-1' as any}
      />
    );
    expect(StyleSheet.flatten(getByTestId('wa-bubble-footer').props.style).position).toBeUndefined();
  });

  it('still reserves on a deleted message, whose tombstone is the text flow', () => {
    const { getByTestId } = render(
      <MessageItem
        message={{ ...incoming, isDeleted: true }}
        currentUserId={'user-1' as any}
      />
    );
    expect(getByTestId('wa-timestamp-reservation')).toBeTruthy();
  });
});
