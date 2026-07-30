/**
 * MessageList background (WA-VISUAL-DELTAS.md §S4.1).
 *
 * Regression guard for the bug this pass fixed: flag-on the list painted
 * `themeColors.surface` over the chat wallpaper, so white bubbles sat on a
 * white list on a cream wallpaper and the whole WhatsApp treatment was
 * invisible. All three render branches (populated, loading, empty) must be
 * transparent flag-on and keep `surface` flag-off.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

let mockShellEnabled = false;
let mockMessagesResult: any = { messages: [], isLoading: false, hasMore: false, loadMore: jest.fn() };

jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => mockShellEnabled,
  useWhatsappShellState: () => ({ enabled: mockShellEnabled, loaded: true }),
}));
jest.mock('../../hooks/useMessages', () => ({
  useMessages: () => mockMessagesResult,
}));
jest.mock('../../context/ChatPrefetchContext', () => ({
  useChatPrefetch: () => null,
}));
jest.mock('../../context/ReactionsContext', () => ({
  ReactionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../MessageItem', () => ({ MessageItem: () => null }));
jest.mock('../GhostThreadPointer', () => ({ GhostThreadPointer: () => null }));
jest.mock('@services/api/convex', () => ({ api: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { MessageList } from '../MessageList';

const message = {
  _id: 'msg-1',
  _creationTime: Date.now(),
  channelId: 'ch-1',
  senderId: 'user-1',
  content: 'Hello',
  contentType: 'text',
  createdAt: Date.now(),
  isDeleted: false,
  senderName: 'Test User',
};

function renderList() {
  return render(
    <MessageList channelId={'ch-1' as any} currentUserId={'user-1' as any} />
  );
}

function backgroundOf(node: any): unknown {
  return StyleSheet.flatten(node.props.style).backgroundColor;
}

describe('MessageList background', () => {
  beforeEach(() => {
    mockShellEnabled = false;
    mockMessagesResult = {
      messages: [message],
      isLoading: false,
      hasMore: false,
      loadMore: jest.fn(),
    };
  });

  it('keeps the opaque surface fill when the shell flag is off', () => {
    const { getByTestId } = renderList();
    expect(backgroundOf(getByTestId('message-list-container'))).toBe('#ffffff');
  });

  it('is transparent flag-on so the chat wallpaper shows through', () => {
    mockShellEnabled = true;
    const { getByTestId } = renderList();
    expect(backgroundOf(getByTestId('message-list-container'))).toBe('transparent');
  });

  it('is transparent flag-on while messages are still loading', () => {
    mockShellEnabled = true;
    mockMessagesResult = { messages: [], isLoading: true, hasMore: false, loadMore: jest.fn() };
    const { getByTestId } = renderList();
    expect(backgroundOf(getByTestId('message-list-container'))).toBe('transparent');
  });

  it('keeps the surface fill while loading when the flag is off', () => {
    mockMessagesResult = { messages: [], isLoading: true, hasMore: false, loadMore: jest.fn() };
    const { getByTestId } = renderList();
    expect(backgroundOf(getByTestId('message-list-container'))).toBe('#ffffff');
  });
});
