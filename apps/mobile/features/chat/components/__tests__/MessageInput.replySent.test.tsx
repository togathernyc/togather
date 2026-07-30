/**
 * `onReplySent` — the hook the chat room uses to follow a sender into the
 * thread their reply just created.
 *
 * It must fire exactly once, with the parent, after a SUCCESSFUL send, and
 * never for an ordinary message. ThreadPage does not pass the callback, so
 * sends from inside a thread can never navigate anywhere.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('../../hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    uploadImage: jest.fn(),
    uploading: false,
    progress: 0,
    reset: jest.fn(),
  }),
}));
jest.mock('../../hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadFile: jest.fn(),
    uploading: false,
    progress: 0,
    reset: jest.fn(),
    isAvailable: false,
  }),
}));
jest.mock('../../hooks/useConvexSendMessage', () => ({
  useSendMessage: () => ({ sendMessage: jest.fn(), isSending: false }),
}));
jest.mock('@providers/ConnectionProvider', () => ({
  useConnectionStatus: () => ({ isEffectivelyOffline: false }),
}));
jest.mock('../../hooks/useTypingIndicators', () => ({
  useTypingIndicators: () => ({ setTyping: jest.fn(), typingUsers: [] }),
}));
jest.mock('../../hooks/useChannelMembers', () => ({
  useChannelMembers: () => ({ members: [] }),
}));
jest.mock('../../hooks/useLinkPreview', () => ({
  useLinkPreview: () => ({
    preview: null,
    loading: false,
    dismiss: jest.fn(),
    isDismissed: false,
  }),
}));
jest.mock('../../utils/eventLinkUtils', () => ({
  extractFirstExternalUrl: () => null,
}));
jest.mock('../../utils/fileTypes', () => ({
  isDocumentPickerSupported: () => false,
  isVoiceRecordingSupported: () => false,
  SUPPORTED_MIME_TYPES: [],
  MAX_FILE_SIZE_BYTES: 10000000,
  MAX_FILE_SIZE_MB: 10,
  getFileCategoryFromFilename: () => 'document',
}));
jest.mock('../../../../stores/draftStore', () => ({
  useDraftStore: () => ({
    getDraft: jest.fn(() => ''),
    setDraft: jest.fn(),
    clearDraft: jest.fn(),
  }),
}));
jest.mock('../LinkPreviewCard', () => ({ LinkPreviewCard: () => null }));
jest.mock('../FilePreview', () => ({ FilePreview: () => null }));
jest.mock('../VoiceRecorderBar', () => ({ VoiceRecorderBar: () => null }));
jest.mock('../AttachmentPanel', () => ({ AttachmentPanel: () => null }));
jest.mock('../GifPicker', () => ({ GifPicker: () => null }));
jest.mock('@services/api/convex', () => ({
  useQuery: jest.fn(),
  api: {
    functions: {
      devAssistant: {
        index: { getBotUserId: 'getBotUserId' },
        maintainers: { myAccess: 'myAccess' },
      },
    },
  },
}));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: null, token: 'mock-auth-token' }),
}));
jest.mock('@hooks/useConvexFeatureFlag', () => ({
  useConvexFeatureFlag: () => ({ enabled: false, loaded: true }),
}));
// The feature is flag-on only, so drive the flag-on composer.
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => true,
  useWhatsappShellState: () => ({ enabled: true, loaded: true }),
}));

import { MessageInput } from '../MessageInput';

const replyTo = {
  _id: 'msg-parent' as any,
  content: 'Who is bringing the chairs?',
  senderName: 'Dara Peters',
};

function renderInput(props: Record<string, unknown>) {
  return render(
    <MessageInput channelId={'ch-1' as any} externalIsSending={false} {...props} />,
  );
}

async function type(getByTestId: any, value: string) {
  fireEvent.changeText(getByTestId('wa-composer-input'), value);
  await waitFor(() => getByTestId('wa-composer-send'));
}

describe('MessageInput onReplySent', () => {
  test('fires once with the parent after a reply is sent', async () => {
    const externalSendMessage = jest.fn().mockResolvedValue(undefined);
    const onReplySent = jest.fn();
    const onCancelReply = jest.fn();

    const { getByTestId } = renderInput({
      replyToMessage: replyTo,
      onReplySent,
      onCancelReply,
      externalSendMessage,
    });

    await type(getByTestId, "I've got them");
    fireEvent.press(getByTestId('wa-composer-send'));

    await waitFor(() => expect(onReplySent).toHaveBeenCalledWith('msg-parent'));
    expect(onReplySent).toHaveBeenCalledTimes(1);
    expect(externalSendMessage).toHaveBeenCalledWith(
      "I've got them",
      expect.objectContaining({ parentMessageId: 'msg-parent' }),
    );
    // Clearing the composer's reply state still happens — navigation is additive.
    expect(onCancelReply).toHaveBeenCalled();
  });

  test('does not fire for an ordinary message', async () => {
    const externalSendMessage = jest.fn().mockResolvedValue(undefined);
    const onReplySent = jest.fn();

    const { getByTestId } = renderInput({
      replyToMessage: null,
      onReplySent,
      externalSendMessage,
    });

    await type(getByTestId, 'just a message');
    fireEvent.press(getByTestId('wa-composer-send'));

    await waitFor(() => expect(externalSendMessage).toHaveBeenCalled());
    expect(onReplySent).not.toHaveBeenCalled();
  });

  test('does not fire when the send fails', async () => {
    const externalSendMessage = jest.fn().mockRejectedValue(new Error('offline'));
    const onReplySent = jest.fn();

    const { getByTestId } = renderInput({
      replyToMessage: replyTo,
      onReplySent,
      externalSendMessage,
    });

    await type(getByTestId, "I've got them");
    fireEvent.press(getByTestId('wa-composer-send'));

    await waitFor(() => expect(externalSendMessage).toHaveBeenCalled());
    expect(onReplySent).not.toHaveBeenCalled();
  });
});
