/**
 * Tests for MessageItem status indicators (optimistic messages)
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { MessageItem } from '../MessageItem';

// Mock all heavy dependencies
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
jest.mock('../EventLinkCard', () => ({
  EventLinkCard: () => null,
}));
jest.mock('../LinkPreviewCard', () => ({
  LinkPreviewCard: () => null,
}));
jest.mock('../FileAttachment', () => ({
  FileAttachment: () => null,
}));
jest.mock('../AudioPlayer', () => ({
  AudioPlayer: () => null,
}));
jest.mock('../VideoPlayer', () => ({
  VideoPlayer: () => null,
}));
jest.mock('../ImageAttachmentsGrid', () => ({
  ImageAttachmentsGrid: () => null,
}));
jest.mock('../ThreadReplies', () => ({
  ThreadReplies: () => null,
}));
jest.mock('../ReactionDetailsModal', () => ({
  ReactionDetailsModal: () => null,
}));
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
  senderId: 'user-1' as any,
  content: 'Hello!',
  contentType: 'text',
  createdAt: Date.now(),
  isDeleted: false,
  senderName: 'Test User',
};

describe('MessageItem status indicators', () => {
  it('renders ActivityIndicator when isOptimistic=true and optimisticStatus=sending', () => {
    const { getByTestId } = render(
      <MessageItem
        message={baseMessage}
        currentUserId={'user-1' as any}
        isOptimistic={true}
        optimisticStatus="sending"
      />
    );
    expect(getByTestId('optimistic-sending')).toBeTruthy();
  });

  it('renders clock icon and "Queued" when optimisticStatus=queued', () => {
    const { getByText, getByTestId } = render(
      <MessageItem
        message={baseMessage}
        currentUserId={'user-1' as any}
        isOptimistic={true}
        optimisticStatus="queued"
      />
    );
    expect(getByTestId('optimistic-queued')).toBeTruthy();
    expect(getByText('Queued')).toBeTruthy();
  });

  it('renders alert icon and "Tap to retry" when optimisticStatus=error', () => {
    const { getByText, getByTestId } = render(
      <MessageItem
        message={baseMessage}
        currentUserId={'user-1' as any}
        isOptimistic={true}
        optimisticStatus="error"
      />
    );
    expect(getByTestId('optimistic-error')).toBeTruthy();
    expect(getByText('Tap to retry')).toBeTruthy();
  });

  it('calls onRetry when error status message is tapped', () => {
    const onRetry = jest.fn();
    const { getByTestId } = render(
      <MessageItem
        message={baseMessage}
        currentUserId={'user-1' as any}
        isOptimistic={true}
        optimisticStatus="error"
        onRetry={onRetry}
      />
    );
    fireEvent.press(getByTestId('optimistic-error'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('does NOT render read receipts when isOptimistic=true', () => {
    const { queryByText } = render(
      <MessageItem
        message={baseMessage}
        currentUserId={'user-1' as any}
        isOptimistic={true}
        optimisticStatus="sending"
      />
    );
    // Read receipts show checkmark symbols - should not be present
    expect(queryByText('\u2713')).toBeNull();
  });
});
