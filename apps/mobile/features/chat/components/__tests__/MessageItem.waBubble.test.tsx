/**
 * WhatsApp-shell bubble anatomy (WA-VISUAL-DELTAS.md §S4.2).
 *
 * Flag-ON rendering only — `MessageItem.imageBubble`/`.status` cover the
 * flag-off baseline. Asserts the pieces that are invisible to a snapshot but
 * are exactly what "reads as WhatsApp": bubble fills, 16px body, the in-bubble
 * sender name in a per-sender hue, the 11px timestamp, and the drop shadow.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
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

  it('gives the bubble the 18pt radius and a soft drop shadow', () => {
    const { getByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    const style = bubbleStyleOf(getByText('Peace be with you'));
    expect(style.borderRadius).toBe(18);
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
    const { getByText } = render(
      <MessageItem message={incoming} currentUserId={'user-1' as any} />
    );
    expect(textStyleOf(getByText(TIME_RE)).fontSize).toBe(11);
  });
});
