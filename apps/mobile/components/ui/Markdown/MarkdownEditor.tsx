/**
 * MarkdownEditor - Controlled block editor over a markdown source string.
 *
 * The editor is a markdown-source `TextInput` plus an insert toolbar and a live
 * `Markdown` preview pane. Toolbar buttons splice markdown tokens at the current
 * cursor/selection. Robust and simple by design: everything is plain markdown
 * text, so there is no hidden document model to keep in sync.
 *
 * Media flow: Image/Video buttons open the library picker, upload the file to
 * R2 via `useImageUpload`, and insert an `r2:` reference (`![](r2:...)` for
 * images, the `!video[](...)` extension for videos — see Markdown.tsx for the
 * conventions).
 *
 * Prop contract (consumed by downstream Agent C — do not change):
 *   MarkdownEditor({ value, onChange }: { value: string; onChange: (next) => void })
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@hooks/useTheme';
import { useImageUpload } from '@features/chat/hooks/useImageUpload';
import { useFileUpload } from '@features/chat/hooks/useFileUpload';
import { Markdown } from './Markdown';
import { MarkdownToolbar, type MarkdownAction } from './MarkdownToolbar';

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
}

interface Selection {
  start: number;
  end: number;
}

/** Result of a splice: the new source plus where the caret should land. */
interface SpliceResult {
  next: string;
  selection: Selection;
}

/**
 * Insert `text` at the current selection, replacing whatever is selected.
 */
function replaceSelection(
  source: string,
  sel: Selection,
  text: string,
): SpliceResult {
  const before = source.slice(0, sel.start);
  const after = source.slice(sel.end);
  const next = before + text + after;
  const caret = sel.start + text.length;
  return { next, selection: { start: caret, end: caret } };
}

/**
 * Wrap the current selection with `left`/`right` markers (e.g. bold/italic).
 * When nothing is selected, inserts the markers with the caret between them.
 */
function wrapSelection(
  source: string,
  sel: Selection,
  left: string,
  right: string,
  placeholder: string,
): SpliceResult {
  const selected = source.slice(sel.start, sel.end) || placeholder;
  const before = source.slice(0, sel.start);
  const after = source.slice(sel.end);
  const next = before + left + selected + right + after;
  const caretStart = sel.start + left.length;
  return {
    next,
    selection: { start: caretStart, end: caretStart + selected.length },
  };
}

/**
 * Ensure `token` starts on its own line: prefix a newline unless we are already
 * at the start of the source or immediately after a line break.
 */
function atLineStartPrefix(source: string, pos: number): string {
  if (pos === 0) return '';
  return source[pos - 1] === '\n' ? '' : '\n';
}

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const { colors } = useTheme();
  const { uploadImage } = useImageUpload();
  const { uploadFile } = useFileUpload();
  const inputRef = useRef<TextInput>(null);

  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [busyAction, setBusyAction] = useState<MarkdownAction | null>(null);

  // Link modal state
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const onSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setSelection(e.nativeEvent.selection);
    },
    [],
  );

  /** Apply a splice result: push to parent and move the caret. */
  const applySplice = useCallback(
    (result: SpliceResult) => {
      onChange(result.next);
      setSelection(result.selection);
    },
    [onChange],
  );

  const insertBlock = useCallback(
    (token: string) => {
      const prefix = atLineStartPrefix(value, selection.start);
      applySplice(replaceSelection(value, selection, prefix + token));
    },
    [value, selection, applySplice],
  );

  const pickAndUpload = useCallback(
    async (action: 'image' | 'video') => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission needed',
          'Allow photo library access to insert media.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes:
          action === 'video'
            ? ImagePicker.MediaTypeOptions.Videos
            : ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setBusyAction(action);
      try {
        // Images go through the image uploader; videos must use the general
        // file uploader (the image path forces an `image/*` content type, which
        // the R2 backend rejects for video files).
        let url: string | undefined;
        let error: string | undefined;
        if (action === 'video') {
          const res = await uploadFile({
            uri: asset.uri,
            name: asset.fileName ?? 'video.mp4',
            size: asset.fileSize ?? 0,
            mimeType: asset.mimeType ?? 'video/mp4',
          });
          url = res.storagePath;
          error = res.error;
        } else {
          const res = await uploadImage(asset.uri);
          url = res.url;
          error = res.error;
        }
        if (error || !url) {
          Alert.alert('Upload failed', error || 'Please try again.');
          return;
        }
        const token =
          action === 'video' ? `!video[](${url})` : `![](${url})`;
        const prefix = atLineStartPrefix(value, selection.start);
        applySplice(
          replaceSelection(value, selection, `${prefix}${token}\n`),
        );
      } finally {
        setBusyAction(null);
      }
    },
    [uploadImage, uploadFile, value, selection, applySplice],
  );

  const handleAction = useCallback(
    (action: MarkdownAction) => {
      switch (action) {
        case 'heading':
          insertBlock('## ');
          break;
        case 'bold':
          applySplice(wrapSelection(value, selection, '**', '**', 'bold text'));
          break;
        case 'italic':
          applySplice(wrapSelection(value, selection, '_', '_', 'italic text'));
          break;
        case 'bulletList':
          insertBlock('- ');
          break;
        case 'checklist':
          insertBlock('- [ ] ');
          break;
        case 'link': {
          const selected = value.slice(selection.start, selection.end);
          setLinkText(selected);
          setLinkUrl('');
          setLinkModalVisible(true);
          break;
        }
        case 'image':
          void pickAndUpload('image');
          break;
        case 'video':
          void pickAndUpload('video');
          break;
      }
    },
    [insertBlock, applySplice, value, selection, pickAndUpload],
  );

  const confirmLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) {
      setLinkModalVisible(false);
      return;
    }
    const label = linkText.trim() || url;
    applySplice(replaceSelection(value, selection, `[${label}](${url})`));
    setLinkModalVisible(false);
    setLinkText('');
    setLinkUrl('');
  }, [linkUrl, linkText, value, selection, applySplice]);

  return (
    <View style={styles.container}>
      <MarkdownToolbar onAction={handleAction} busyAction={busyAction} />

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        onSelectionChange={onSelectionChange}
        selection={
          // Controlled selection so token splices land the caret correctly.
          // On web the controlled selection can fight the browser caret, so we
          // leave it uncontrolled there.
          Platform.OS === 'web' ? undefined : selection
        }
        multiline
        placeholder="Write in markdown…"
        placeholderTextColor={colors.inputPlaceholder}
        textAlignVertical="top"
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
          },
        ]}
      />

      <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>
        PREVIEW
      </Text>
      <ScrollView
        style={[styles.preview, { borderColor: colors.border }]}
        contentContainerStyle={styles.previewContent}
      >
        {value.trim() ? (
          <Markdown source={value} />
        ) : (
          <Text style={{ color: colors.textTertiary }}>
            Nothing to preview yet.
          </Text>
        )}
      </ScrollView>

      {/* Link insertion modal (prompts for text + url) */}
      <Modal
        visible={linkModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLinkModalVisible(false)}
      >
        <Pressable
          style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}
          onPress={() => setLinkModalVisible(false)}
        >
          <Pressable
            style={[styles.modalCard, { backgroundColor: colors.surface }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Insert link
            </Text>
            <TextInput
              value={linkText}
              onChangeText={setLinkText}
              placeholder="Link text"
              placeholderTextColor={colors.inputPlaceholder}
              style={[
                styles.modalInput,
                {
                  color: colors.text,
                  borderColor: colors.inputBorder,
                  backgroundColor: colors.inputBackground,
                },
              ]}
            />
            <TextInput
              value={linkUrl}
              onChangeText={setLinkUrl}
              placeholder="https://…"
              placeholderTextColor={colors.inputPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[
                styles.modalInput,
                {
                  color: colors.text,
                  borderColor: colors.inputBorder,
                  backgroundColor: colors.inputBackground,
                },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setLinkModalVisible(false)}
                style={styles.modalButton}
              >
                <Text style={{ color: colors.textSecondary }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmLink} style={styles.modalButton}>
                <Text style={{ color: colors.link, fontWeight: '700' }}>
                  Insert
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  input: {
    minHeight: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    lineHeight: 22,
    margin: 8,
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 4,
  },
  preview: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    margin: 8,
    marginTop: 0,
  },
  previewContent: {
    padding: 12,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    borderRadius: 12,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 4,
  },
  modalButton: {
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
});
