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

  it('starts with minimum height of 40', () => {
    const { getByPlaceholderText } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    const input = getByPlaceholderText('Message...');
    const style = input.props.style;
    const flatStyle = Array.isArray(style)
      ? Object.assign({}, ...style.filter(Boolean))
      : style;
    expect(flatStyle.height).toBeGreaterThanOrEqual(40);
  });

  describe('height calculation (anti-oscillation)', () => {
    it('does NOT add extra padding to the explicit height style', () => {
      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 60 } },
        });
      });

      const style = input.props.style;
      const flatStyle = Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : style;

      // Height should be the contentSize value directly, NOT contentSize + padding
      // The old buggy code added INPUT_PADDING_VERTICAL * 2 (20) which caused oscillation
      expect(flatStyle.height).toBeLessThanOrEqual(60);
      expect(flatStyle.height).not.toBe(60 + INPUT_PADDING_VERTICAL * 2);
    });

    it('ignores height changes smaller than threshold to prevent oscillation', () => {
      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 60 } },
        });
      });

      const styleAfterFirst = input.props.style;
      const flatFirst = Array.isArray(styleAfterFirst)
        ? Object.assign({}, ...styleAfterFirst.filter(Boolean))
        : styleAfterFirst;
      const heightAfterFirst = flatFirst.height;

      // Fire again with a tiny change (1px) — should be ignored
      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 61 } },
        });
      });

      const styleAfterSecond = input.props.style;
      const flatSecond = Array.isArray(styleAfterSecond)
        ? Object.assign({}, ...styleAfterSecond.filter(Boolean))
        : styleAfterSecond;

      expect(flatSecond.height).toBe(heightAfterFirst);
    });

    it('applies height changes larger than threshold', () => {
      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 60 } },
        });
      });

      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 80 } },
        });
      });

      const style = input.props.style;
      const flat = Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : style;

      expect(flat.height).toBe(80);
    });

    it('clamps height at max input height', () => {
      const maxHeight = LINE_HEIGHT * MAX_INPUT_LINES + INPUT_PADDING_VERTICAL * 2;

      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 500 } },
        });
      });

      const style = input.props.style;
      const flat = Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : style;

      expect(flat.height).toBeLessThanOrEqual(maxHeight);
    });

    it('enables scrolling only after reaching max height', () => {
      const maxHeight = LINE_HEIGHT * MAX_INPUT_LINES + INPUT_PADDING_VERTICAL * 2;

      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      // Below max — scrolling should be disabled
      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: 60 } },
        });
      });

      expect(input.props.scrollEnabled).toBe(false);

      // At/above max — scrolling should be enabled
      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: maxHeight + 10 } },
        });
      });

      expect(input.props.scrollEnabled).toBe(true);
    });

    it('reaches max height even when current height is within threshold of max (dead zone fix)', () => {
      const maxHeight = LINE_HEIGHT * MAX_INPUT_LINES + INPUT_PADDING_VERTICAL * 2; // 180

      const { getByPlaceholderText } = render(
        <MessageInput channelId={'test-channel' as any} />
      );
      const input = getByPlaceholderText('Message...');

      // Set height to just below maxHeight (within the 2px threshold)
      const nearMaxHeight = maxHeight - 1.5; // 178.5
      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: nearMaxHeight } },
        });
      });

      const styleAfterFirst = input.props.style;
      const flatFirst = Array.isArray(styleAfterFirst)
        ? Object.assign({}, ...styleAfterFirst.filter(Boolean))
        : styleAfterFirst;
      expect(flatFirst.height).toBe(nearMaxHeight);
      expect(input.props.scrollEnabled).toBe(false);

      // Now content grows beyond max - should clamp to maxHeight and enable scrolling
      // The difference (180 - 178.5 = 1.5) is within threshold, but since clamped >= maxHeight,
      // the fix ensures inputHeight updates to maxHeight anyway
      act(() => {
        fireEvent(input, 'contentSizeChange', {
          nativeEvent: { contentSize: { width: 300, height: maxHeight + 50 } },
        });
      });

      const styleAfterSecond = input.props.style;
      const flatSecond = Array.isArray(styleAfterSecond)
        ? Object.assign({}, ...styleAfterSecond.filter(Boolean))
        : styleAfterSecond;

      // Input height should reach exactly maxHeight (not stuck at 178.5)
      expect(flatSecond.height).toBe(maxHeight);
      // Scrolling should now be enabled
      expect(input.props.scrollEnabled).toBe(true);
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
