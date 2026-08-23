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

/** Calibrated pixel pass (2026-07-29): WA's empty field is 32pt, not 44. */
const WA_FIELD_HEIGHT = 32;

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

  it('wraps the text field in a fully-rounded 32pt white pill', () => {
    const { getByTestId } = render(<MessageInput channelId={'test-channel' as any} />);
    const style = StyleSheet.flatten(getByTestId('wa-composer-field').props.style);
    expect(style.backgroundColor).toBe('#FFFFFF');
    expect(style.minHeight).toBe(WA_FIELD_HEIGHT);
    expect(style.borderRadius).toBe(WA_FIELD_HEIGHT / 2);
  });

  it("strips the TextInput's own border and fill (the pill owns them)", () => {
    const { getByTestId } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    const style = StyleSheet.flatten(getByTestId('wa-composer-input').props.style);
    expect(style.borderWidth).toBe(0);
    expect(style.backgroundColor).toBe('transparent');
    expect(style.minHeight).toBe(WA_FIELD_HEIGHT);
  });

  it('sizes the input padding so one line lands exactly on the field height', () => {
    // Regression guard: `styles.input`'s own 10pt vertical padding puts a
    // one-line field at ~40pt, which would silently override the 32pt
    // `minHeight` and make WA_COMPOSER_FIELD_HEIGHT decorative.
    const { getByTestId } = render(<MessageInput channelId={'test-channel' as any} />);
    const style = StyleSheet.flatten(getByTestId('wa-composer-input').props.style);
    // 20pt line box + 2x padding === the field height.
    expect(style.paddingVertical * 2 + 20).toBe(WA_FIELD_HEIGHT);
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
    const { getByTestId } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    // Walk up from the input to the outermost composer container.
    let node: any = getByTestId('wa-composer-input');
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

  /**
   * Android regression guard (device video, 2026-08-23: tapping the composer
   * never raised the keyboard, while '+' / camera / mic beside it all worked).
   *
   * Anything absolutely positioned over the pill is a hit target on Android
   * unless it is a <View> that opts out. `pointerEvents` on a <Text> does not
   * count: `Text.d.ts` declares the prop ("Similar to `View`'s"), so the broken
   * version typechecks and ships green, but Android reads it only off
   * `ReactViewGroup`. See the note at the hint in MessageInput.tsx.
   *
   * Runs under Android because the bug is Android-only and the composer does
   * render platform-dependently — under iOS a `Platform.OS === 'android'`
   * branch could reintroduce exactly this bug and still pass.
   *
   * Structural guard only: RNTL runs no hit test, so this proves tree shape,
   * never that a real tap focuses a real EditText. That needs a device. It also
   * only sees the default render state (empty field, no reply preview /
   * offline hint / pending request / GIF key).
   */
  it('keeps every overlay over the composer field tap-through (Android)', () => {
    Platform.OS = 'android';

    const { getByTestId } = render(
      <MessageInput channelId={'test-channel' as any} />
    );

    const field = getByTestId('wa-composer-field');
    const hint = getByTestId('wa-composer-hint');
    expect(hint.type).toBe('Text');
    expect(isInside(hint, field)).toBe(true);

    /** Element name, whether the node is a host string or a composite. */
    const nameOf = (node: any) =>
      typeof node.type === 'string'
        ? node.type
        : node.type?.displayName ?? node.type?.name ?? '';

    /** On Android only a View honors the opt-out — in prop or style form. */
    const optsOutOfTouches = (node: any) =>
      !/Text$/.test(nameOf(node)) &&
      (node.props?.pointerEvents === 'none' ||
        StyleSheet.flatten(node.props?.style)?.pointerEvents === 'none');

    // The hint specifically is shielded by such a View before the pill.
    let node: any = hint.parent;
    let shield: any = null;
    while (node && node !== field) {
      if (nameOf(node) === 'View' && optsOutOfTouches(node)) {
        shield = node;
        break;
      }
      node = node.parent;
    }
    expect(shield).not.toBeNull();

    // The general invariant, not just this node: every absolutely-positioned
    // child of the pill must be tap-through, or it steals the input's taps.
    // Guards the naive next overlay (a character counter, an edit badge...).
    for (const child of field.children) {
      if (typeof child === 'string') continue;
      const style = StyleSheet.flatten((child as any).props?.style);
      if (style?.position !== 'absolute') continue;
      expect(optsOutOfTouches(child)).toBe(true);
    }

    // No <Text> in the composer field relies on the prop Android drops.
    // Scoped to the field: Ionicons renders its glyphs as <Text>, so a
    // repo-wide sweep would fail on a vector-icons bump, not on this bug.
    for (const text of (field as any).findAllByType('Text')) {
      expect(text.props?.pointerEvents).toBeUndefined();
    }

    // Splitting one style entry into two must not move or restyle the hint.
    // `lineHeight` is what gives the box its height; `top`/`bottom` must stay
    // unset so waFieldWrap's `alignItems: 'flex-end'` seats it on the baseline.
    const box = StyleSheet.flatten(shield.props.style);
    expect(box.position).toBe('absolute');
    expect(box.left).toBe(16);
    expect(box.right).toBe(44);
    expect(box.top).toBeUndefined();
    expect(box.bottom).toBeUndefined();
    const line = StyleSheet.flatten(hint.props.style);
    expect(line.fontSize).toBe(14);
    expect(line.fontStyle).toBe('italic');
    expect(line.lineHeight).toBe(WA_FIELD_HEIGHT);
  });

  it('shows the hint only while the field is empty', () => {
    // If the hint ever stopped unmounting it would sit over the typed text.
    const { getByTestId, queryByTestId } = render(
      <MessageInput channelId={'test-channel' as any} />
    );
    expect(getByTestId('wa-composer-hint').props.children).toBe('Message...');

    fireEvent.changeText(getByTestId('wa-composer-input'), 'hello');
    expect(queryByTestId('wa-composer-hint')).toBeNull();
  });

  it('hides the in-field sticker glyph while a DM request is pending', () => {
    const { queryByLabelText } = render(
      <MessageInput channelId={'test-channel' as any} recipientPending />
    );
    expect(queryByLabelText('Stickers and GIFs')).toBeNull();
  });
});
