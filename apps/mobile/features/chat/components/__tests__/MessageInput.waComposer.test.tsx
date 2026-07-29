/**
 * WhatsApp-shell composer anatomy (WA-VISUAL-DELTAS.md S4.6).
 *
 * Flag-ON counterpart to `MessageInput.test.tsx` (which covers the flag-off
 * row). Asserts the restyle only - every handler is the flag-off one, so the
 * behavioral suite next door still owns send/paste/scroll.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import { MessageInput } from '../MessageInput';

jest.mock('../../hooks/useImageUpload', () => ({
  useImageUpload: () => ({
    uploadImage: jest.fn(() => Promise.resolve({ url: 'r2:chat/pasted.png' })),
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
  useSendMessage: () => ({
    sendMessage: jest.fn(),
    isSending: false,
  }),
}));

jest.mock('@providers/ConnectionProvider', () => ({
  useConnectionStatus: () => ({ isEffectivelyOffline: false }),
}));

jest.mock('../../hooks/useTypingIndicators', () => ({
  useTypingIndicators: () => ({
    setTyping: jest.fn(),
    typingUsers: [],
  }),
}));

jest.mock('../../hooks/useChannelMembers', () => ({
  useChannelMembers: () => ({
    members: [],
  }),
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

jest.mock('../LinkPreviewCard', () => ({
  LinkPreviewCard: () => null,
}));

jest.mock('../FilePreview', () => ({
  FilePreview: () => null,
}));

jest.mock('../VoiceRecorderBar', () => ({
  VoiceRecorderBar: () => null,
}));

jest.mock('../AttachmentPanel', () => ({
  AttachmentPanel: () => null,
}));

jest.mock('../GifPicker', () => ({
  GifPicker: () => null,
}));

// Dev-assistant @Togather mention deps (added to MessageInput). The global
// convex mock exposes `api: {}`, so provide the devAssistant path used here and
// stub the auth/flag hooks (the bot mention is gated off in this test).
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

// This suite renders the flag-ON composer.
jest.mock('@hooks/useWhatsappShell', () => ({
  useWhatsappShell: () => true,
  useWhatsappShellState: () => ({ enabled: true, loaded: true }),
}));

jest.mock('@hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      surface: '#fff',
      border: '#e0e0e0',
      link: '#007AFF',
      text: '#000',
      textSecondary: '#666',
      textTertiary: '#999',
      textDisabled: '#ccc',
      inputBackground: '#f9f9f9',
      surfaceSecondary: '#f5f5f5',
      chatWallpaper: '#ECE5DD',
      separator: '#e0e0e0',
      icon: '#3B4A54',
    },
    isDark: false,
  }),
}));

const WA_FIELD_HEIGHT = 44;

/** Is `candidate` an ancestor of `node` in the rendered tree? */
function isInside(node: any, candidate: any): boolean {
  let current: any = node;
  while (current) {
    if (current === candidate) return true;
    current = current.parent;
  }
  return false;
}

describe('MessageInput WhatsApp composer (flag-on)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
  });

  it('wraps the text field in a fully-rounded ~44px white pill', () => {
    const { getByTestId } = render(<MessageInput channelId={'test-channel' as any} />);
    const style = StyleSheet.flatten(getByTestId('wa-composer-field').props.style);
    expect(style.backgroundColor).toBe('#FFFFFF');
    expect(style.minHeight).toBe(WA_FIELD_HEIGHT);
    expect(style.borderRadius).toBe(WA_FIELD_HEIGHT / 2);
  });

  it("strips the TextInput's own border and fill (the pill owns them)", () => {
    const { getByPlaceholderText } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    const style = StyleSheet.flatten(getByPlaceholderText('Message...').props.style);
    expect(style.borderWidth).toBe(0);
    expect(style.backgroundColor).toBe('transparent');
    expect(style.minHeight).toBe(WA_FIELD_HEIGHT);
  });

  it('puts a sticker/emoji glyph inside the field, not beside it', () => {
    // The glyph only exists when the GIF backend is configured (documented
    // degradation without a key: "GIF picker hidden").
    process.env.EXPO_PUBLIC_KLIPY_API_KEY = 'test-key';
    try {
      const { getByLabelText, getByTestId } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      expect(isInside(getByLabelText('Stickers and GIFs'), getByTestId('wa-composer-field'))).toBe(true);
    } finally {
      delete process.env.EXPO_PUBLIC_KLIPY_API_KEY;
    }
  });

  it('hides the sticker/emoji glyph when no GIF backend is configured', () => {
    delete process.env.EXPO_PUBLIC_KLIPY_API_KEY;
    const { queryByLabelText } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    expect(queryByLabelText('Stickers and GIFs')).toBeNull();
  });

  it('floats the bar on the wallpaper: translucent fill, no hairline', () => {
    const { getByPlaceholderText } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    // Walk up from the input to the outermost composer container.
    let node: any = getByPlaceholderText('Message...');
    let barStyle: any = null;
    while (node) {
      const style = StyleSheet.flatten(node.props?.style);
      if (style && 'borderTopWidth' in style) barStyle = style;
      node = node.parent;
    }
    expect(barStyle.borderTopWidth).toBe(0);
    expect(String(barStyle.backgroundColor)).toMatch(/^rgba\(/);
  });

  it('keeps the attachment (+) affordance', () => {
    const { getByText } = render(<MessageInput channelId={'test-channel' as any} />);
    expect(getByText('add')).toBeTruthy();
  });

  it('hides the in-field sticker glyph while a DM request is pending', () => {
    const { queryByLabelText } = render(
      <MessageInput channelId={'test-channel' as any} recipientPending />
    );
    expect(queryByLabelText('Stickers and GIFs')).toBeNull();
  });
});
