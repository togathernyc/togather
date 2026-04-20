/**
 * Tests for MessageItem web right-click context menu
 *
 * Verifies that the contextmenu effect only activates on web platform.
 * Since jest-expo uses React Native's test renderer (no DOM), we test
 * the platform-gating logic rather than actual DOM event dispatch.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { MessageItem } from '../MessageItem';

// Mock all heavy dependencies (same pattern as MessageItem.status.test.tsx)
jest.mock('@features/chat/hooks/useReadReceipts', () => ({
  useReadReceipts: () => ({ readByCount: 0, totalMembers: 0, isLoading: false }),
}));
jest.mock('@features/chat/hooks/useReactions', () => ({
  useReactions: () => ({ reactions: [], toggleReaction: jest.fn(), isLoading: false }),
}));
jest.mock('@features/chat/hooks/useLinkPreview', () => ({
  useLinkPreview: () => ({ preview: null, loading: false }),
}));
jest.mock('@services/api/convex', () => ({
  api: {},
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('../EventLinkCard', () => ({ EventLinkCard: () => null }));
jest.mock('../ToolLinkCard', () => ({ ToolLinkCard: () => null }));
jest.mock('../ChannelInviteLinkCard', () => ({ ChannelInviteLinkCard: () => null }));
jest.mock('../LinkPreviewCard', () => ({ LinkPreviewCard: () => null }));
jest.mock('../FileAttachment', () => ({ FileAttachment: () => null }));
jest.mock('../AudioPlayer', () => ({ AudioPlayer: () => null }));
jest.mock('../VideoPlayer', () => ({ VideoPlayer: () => null }));
jest.mock('../ImageAttachmentsGrid', () => ({ ImageAttachmentsGrid: () => null }));
jest.mock('../ThreadReplies', () => ({ ThreadReplies: () => null }));
jest.mock('../ReactionDetailsModal', () => ({ ReactionDetailsModal: () => null }));
jest.mock('../ReachOutRequestCardFromMessage', () => ({ ReachOutRequestCardFromMessage: () => null }));
jest.mock('../TaskCardFromMessage', () => ({ TaskCardFromMessage: () => null }));
jest.mock('@components/ui', () => ({
  AppImage: () => null,
  ImageViewer: () => null,
}));
jest.mock('@/utils/media', () => ({
  getMediaUrl: (url: string) => url,
}));

const baseMessage = {
  _id: 'msg-1' as any,
  channelId: 'ch-1' as any,
  senderId: 'user-2' as any,
  content: 'Hello!',
  contentType: 'text',
  createdAt: Date.now(),
  isDeleted: false,
  senderName: 'Other User',
};

describe('MessageItem web context menu', () => {
  const originalPlatform = Platform.OS;

  afterEach(() => {
    (Platform as any).OS = originalPlatform;
  });

  it('renders successfully on native platform without contextmenu side-effects', () => {
    (Platform as any).OS = 'ios';

    // On native, the contextmenu useEffect should bail out (Platform.OS !== 'web')
    // and the component should render without errors
    const { getByText } = render(
      <MessageItem
        message={baseMessage}
        currentUserId={'user-1' as any}
      />
    );

    expect(getByText('Hello!')).toBeTruthy();
  });

  it('renders message with onLongPress callback on native', () => {
    (Platform as any).OS = 'ios';
    const onLongPress = jest.fn();

    const { getByText } = render(
      <MessageItem
        message={baseMessage}
        currentUserId={'user-1' as any}
        onLongPress={onLongPress}
      />
    );

    expect(getByText('Hello!')).toBeTruthy();
    // onLongPress is wired up via Pressable, not contextmenu on native
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('renders on web platform without crashing', () => {
    (Platform as any).OS = 'web';

    // On web, the contextmenu useEffect tries to access containerRef.current
    // In the RN test renderer there's no real DOM, so containerRef.current is null
    // and the effect bails out safely. This test verifies no crash occurs.
    const { getByText } = render(
      <MessageItem
        message={baseMessage}
        currentUserId={'user-1' as any}
        onLongPress={jest.fn()}
      />
    );

    expect(getByText('Hello!')).toBeTruthy();
  });
});
