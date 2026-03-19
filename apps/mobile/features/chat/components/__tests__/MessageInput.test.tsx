import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { MessageInput } from '../MessageInput';

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
    },
  }),
}));

const LINE_HEIGHT = 20;
const MAX_INPUT_LINES = 8;
const INPUT_PADDING_VERTICAL = 10;

describe('MessageInput', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
  });

  it('renders without crashing', () => {
    const { getByPlaceholderText } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    expect(getByPlaceholderText('Message...')).toBeTruthy();
  });

  it('uses native auto-grow with minHeight on iOS (no explicit height)', () => {
    const { getByPlaceholderText } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    const input = getByPlaceholderText('Message...');
    const style = input.props.style;
    const flatStyle = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;

    // Should have minHeight for minimum size, not an explicit height
    expect(flatStyle.minHeight).toBe(40);
    // maxHeight should cap expansion
    expect(flatStyle.maxHeight).toBe(LINE_HEIGHT * MAX_INPUT_LINES + INPUT_PADDING_VERTICAL * 2);
  });

  describe('scroll behavior', () => {
    it('disables scrolling when content is below max height', () => {
      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 60 } },
        });
      });

      expect(input.props.scrollEnabled).toBe(false);
    });

    it('enables scrolling when content reaches max height', () => {
      const maxContentHeight = LINE_HEIGHT * MAX_INPUT_LINES;

      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: maxContentHeight + 10 } },
        });
      });

      expect(input.props.scrollEnabled).toBe(true);
    });

    it('disables scrolling again when content shrinks below max', () => {
      const maxContentHeight = LINE_HEIGHT * MAX_INPUT_LINES;

      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      // First, grow beyond max
      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: maxContentHeight + 50 } },
        });
      });
      expect(input.props.scrollEnabled).toBe(true);

      // Then shrink below max
      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 60 } },
        });
      });
      expect(input.props.scrollEnabled).toBe(false);
    });
  });

  describe('web platform', () => {
    beforeEach(() => {
      Platform.OS = 'web';
    });

    it('uses auto height on web instead of explicit height', () => {
      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');
      const style = input.props.style;
      const flatStyle = Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : style;

      expect(flatStyle.height).toBe('auto');
      expect(flatStyle.minHeight).toBe(40);
    });

    it('always enables scrolling on web', () => {
      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');
      expect(input.props.scrollEnabled).toBe(true);
    });
  });
});
