/**
 * Tests for edge-to-edge image-only message bubbles.
 *
 * An image with no caption renders like iMessage: the photo fills the bubble with
 * no surrounding blue/gray color, and no inline timestamp footer. A captioned image
 * (or any other content) keeps the normal bubble + timestamp.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { MessageItem } from '../MessageItem';

// Mock all heavy dependencies (mirrors MessageItem.status.test.tsx)
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
jest.mock('../ImageAttachmentsGrid', () => ({ ImageAttachmentsGrid: () => null }));
jest.mock('../ThreadReplies', () => ({ ThreadReplies: () => null }));
jest.mock('../ReactionDetailsModal', () => ({ ReactionDetailsModal: () => null }));
jest.mock('../TaskCardFromMessage', () => ({ TaskCardFromMessage: () => null }));
jest.mock('@components/ui', () => ({ AppImage: () => null, ImageViewer: () => null }));
jest.mock('@/utils/media', () => ({ getMediaUrl: (url: string) => url }));

// Matches the "today" timestamp formatMessageTime renders inside the bubble footer
// (e.g. "3:07 PM"). Captions like "Nice shot" never match this pattern.
const TIME_RE = /\d{1,2}:\d{2} (AM|PM)/;

const baseMessage = {
  _id: 'msg-1' as any,
  channelId: 'ch-1' as any,
  senderId: 'user-1' as any,
  content: '',
  contentType: 'text',
  createdAt: Date.now(),
  isDeleted: false,
  senderName: 'Test User',
  attachments: [{ type: 'image', url: 'https://images.togather.nyc/chat/photo.jpg' }],
};

describe('MessageItem image-only bubble', () => {
  it('hides the inline timestamp footer for an image with no caption', () => {
    const { queryByText } = render(
      <MessageItem message={baseMessage} currentUserId={'user-1' as any} />
    );
    // Edge-to-edge image-only bubble shows no inline timestamp (iMessage-style).
    expect(queryByText(TIME_RE)).toBeNull();
  });

  it('keeps the timestamp footer when the image has a caption', () => {
    const { queryByText } = render(
      <MessageItem
        message={{ ...baseMessage, content: 'Nice shot' }}
        currentUserId={'user-1' as any}
      />
    );
    // Caption means a normal text+image bubble, which keeps the timestamp.
    expect(queryByText(TIME_RE)).toBeTruthy();
  });

  it('keeps the timestamp footer for a plain text message', () => {
    const { queryByText } = render(
      <MessageItem
        message={{ ...baseMessage, content: 'Hello!', attachments: [] }}
        currentUserId={'user-1' as any}
      />
    );
    expect(queryByText(TIME_RE)).toBeTruthy();
  });
});
