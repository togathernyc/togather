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

jest.mock('../GifPicker', () => ({
  GifPicker: () => null,
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

  // ==========================================================================
  // recipientPending — ad-hoc DM where the other party hasn't accepted yet.
  //
  // Regression guard for the Sentry crash on 2026-04-29: a user sent a GIF
  // into a fresh DM, the backend rejected with `Cannot send attachments
  // until the recipient accepts the request`, and the failure path
  // ("composer holds onto staged GIF + optimistic-error row + user reopens
  // picker") cascaded into a "Maximum update depth exceeded" loop inside
  // the bottom-tab navigator.
  //
  // Hiding the trigger surface client-side is the cheapest fix: the user
  // never reaches the failure path, so the failure path can never crash
  // them.
  // ==========================================================================
  describe('recipientPending (DM not yet accepted)', () => {
    it('hides the attachment (+) button so users cannot stage attachments', () => {
      // The Pressable wrapping the "add" Ionicon is the only icon on the
      // input row that triggers the attachment panel. With
      // recipientPending=true it must not render at all (not just be
      // `disabled`) — a disabled button still makes the panel reachable
      // on web via keyboard, and the goal is to hard-strip the failure
      // path that previously cascaded into "Maximum update depth".
      const { UNSAFE_root, getByPlaceholderText } = render(
        <MessageInput
          channelId={'test-channel' as any}
          recipientPending
        />
      );
      const addIcons = UNSAFE_root.findAll(
        (n: any) => n.props && n.props.name === 'add',
      );
      expect(addIcons).toHaveLength(0);
      // Sanity: the text input still renders so plain-text sends remain
      // possible (backend allows them on pending DMs).
      expect(getByPlaceholderText('Message...')).toBeTruthy();
    });

    it('renders the attachment (+) button when recipientPending is false', () => {
      // Negative control: confirms the gate above is the toggle, not a
      // side effect of test setup. The attachment trigger is an Ionicon
      // rendered with name="add"; UNSAFE_root.findAll walks the test tree
      // looking for any node whose props match. (No testID exists on the
      // current button — the structural test is good enough as a guard.)
      const { UNSAFE_root } = render(
        <MessageInput
          channelId={'test-channel' as any}
          recipientPending={false}
        />
      );
      const addIcons = UNSAFE_root.findAll(
        (n: any) => n.props && n.props.name === 'add',
      );
      expect(addIcons.length).toBeGreaterThan(0);
    });

    it('shows the recipient-pending hint copy when prop is true', () => {
      const { queryByText } = render(
        <MessageInput
          channelId={'test-channel' as any}
          recipientPending
        />
      );
      expect(
        queryByText(/accept your chat request before you can send/i)
      ).toBeTruthy();
    });

    it('omits the recipient-pending hint when prop is false', () => {
      const { queryByText } = render(
        <MessageInput
          channelId={'test-channel' as any}
          recipientPending={false}
        />
      );
      expect(
        queryByText(/accept your chat request before you can send/i)
      ).toBeNull();
    });

    it('still allows sending plain text when recipient is pending', () => {
      // Backend permits text under 1000 chars to pending recipients — the
      // composer must NOT hide the text input or send button.
      const { getByPlaceholderText } = render(
        <MessageInput
          channelId={'test-channel' as any}
          recipientPending
        />
      );
      expect(getByPlaceholderText('Message...')).toBeTruthy();
    });
  });
});

