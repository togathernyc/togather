/**
 * Markdown - Dependency-free markdown renderer for the togather app.
 *
 * A small, line-by-line block parser plus an inline tokenizer, built only from
 * React Native primitives (`Text`, `View`, `Pressable`, `Linking`) and the
 * app's existing components. It intentionally covers the subset of markdown the
 * app produces rather than being a spec-complete engine.
 *
 * ── MEDIA / VIDEO CONVENTIONS ────────────────────────────────────────────────
 *
 * Images:
 *   Standard markdown image syntax, but the URL may be an `r2:` storage path so
 *   Cloudflare transforms work through `AppImage`:
 *
 *       ![alt text](r2:chat/uuid-photo.jpg)
 *       ![alt text](https://example.com/photo.jpg)
 *
 * Videos:
 *   Use the `!video[...](...)` extension. It looks like an image token with a
 *   `!video` marker instead of `!`. The URL is an `r2:` path or an http(s) URL:
 *
 *       !video[caption](r2:chat/uuid-clip.mp4)
 *
 *   The MarkdownEditor emits this token when you insert a video. Any image whose
 *   src is `video:`-prefixed or ends in a video extension (.mp4/.mov/.m4v/.webm)
 *   is also routed to `VideoPlayer`.
 *
 * Task lists:
 *   GitHub-style task list items render as read-only checkbox rows:
 *
 *       - [ ] not done
 *       - [x] done
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
import React, { useMemo } from 'react';
import { View, Text, Linking, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import type { ThemeColors } from '@/theme/colors';
import { AppImage } from '@components/ui/AppImage';
import { VideoPlayer } from '@features/chat/components/VideoPlayer';
import { ImageViewerManager } from '@/providers/ImageViewerProvider';
import { getMediaUrl } from '@/utils/media';

interface MarkdownProps {
  source: string;
}

// ============================================================================
// Media helpers
// ============================================================================

/**
 * A source path counts as a video when it uses the `!video[]()` extension
 * (normalized to a `video:` prefix) or points at a recognizable video file.
 */
export function isVideoSource(src: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(src) || src.startsWith('video:');
}

/** Normalize a `video:`-prefixed token back to its underlying media path. */
function normalizeVideoSrc(src: string): string {
  return src.startsWith('video:') ? src.slice('video:'.length) : src;
}

// ============================================================================
// Block parsing
// ============================================================================

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'blockquote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }
  | { kind: 'bullet'; items: string[] }
  | { kind: 'ordered'; items: string[] }
  | { kind: 'tasks'; items: { checked: boolean; label: string }[] }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'video'; caption: string; src: string };

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+\.\s+(.*)$/;
const TASK_RE = /^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
const VIDEO_RE = /^!video\[([^\]]*)\]\(([^)]+)\)\s*$/;

/**
 * Parse markdown `source` into a flat list of blocks. A deliberately simple,
 * line-by-line parser: robust and easy to reason about over spec-complete.
 */
function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code block ``` ... ```
    if (/^\s*```/.test(line)) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // consume closing fence (if present)
      blocks.push({ kind: 'code', text: codeLines.join('\n') });
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(line)) {
      blocks.push({ kind: 'hr' });
      i += 1;
      continue;
    }

    // Heading
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: heading[2].trim() });
      i += 1;
      continue;
    }

    // Video extension: !video[caption](url)
    const video = VIDEO_RE.exec(line.trim());
    if (video) {
      blocks.push({ kind: 'video', caption: video[1], src: video[2].trim() });
      i += 1;
      continue;
    }

    // Image: ![alt](url) — may be a video by src.
    const image = IMAGE_RE.exec(line.trim());
    if (image) {
      const src = image[2].trim();
      if (isVideoSource(src)) {
        blocks.push({
          kind: 'video',
          caption: image[1],
          src: normalizeVideoSrc(src),
        });
      } else {
        blocks.push({ kind: 'image', alt: image[1], src });
      }
      i += 1;
      continue;
    }

    // Blockquote (consume consecutive quoted lines)
    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && BLOCKQUOTE_RE.test(lines[i])) {
        quoteLines.push(BLOCKQUOTE_RE.exec(lines[i])![1]);
        i += 1;
      }
      blocks.push({ kind: 'blockquote', text: quoteLines.join('\n') });
      continue;
    }

    // Task list (consume consecutive task items)
    if (TASK_RE.test(line)) {
      const items: { checked: boolean; label: string }[] = [];
      while (i < lines.length && TASK_RE.test(lines[i])) {
        const m = TASK_RE.exec(lines[i])!;
        items.push({ checked: m[1].toLowerCase() === 'x', label: m[2].trim() });
        i += 1;
      }
      blocks.push({ kind: 'tasks', items });
      continue;
    }

    // Bulleted list (consume consecutive bullets that are not tasks)
    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (
        i < lines.length &&
        BULLET_RE.test(lines[i]) &&
        !TASK_RE.test(lines[i])
      ) {
        items.push(BULLET_RE.exec(lines[i])![1].trim());
        i += 1;
      }
      blocks.push({ kind: 'bullet', items });
      continue;
    }

    // Numbered list
    if (ORDERED_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        items.push(ORDERED_RE.exec(lines[i])![1].trim());
        i += 1;
      }
      blocks.push({ kind: 'ordered', items });
      continue;
    }

    // Paragraph (consume consecutive plain lines until a blank line or a line
    // that starts a new block type).
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      const l = lines[i];
      if (
        HEADING_RE.test(l) ||
        HR_RE.test(l) ||
        BULLET_RE.test(l) ||
        ORDERED_RE.test(l) ||
        BLOCKQUOTE_RE.test(l) ||
        /^\s*```/.test(l) ||
        VIDEO_RE.test(l.trim()) ||
        IMAGE_RE.test(l.trim())
      ) {
        break;
      }
      paraLines.push(l.trim());
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ kind: 'paragraph', text: paraLines.join(' ') });
    }
  }

  return blocks;
}

// ============================================================================
// Inline formatting
// ============================================================================

type InlineToken =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'code'; content: string }
  | { type: 'link'; content: string; href: string };

// Ordered by precedence. `code` first so its contents are not further parsed.
const INLINE_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*]+\*)|(_[^_]+_)/;

/**
 * Split a string of inline markdown into tokens. Non-nested by design: the
 * first matching marker wins and its inner text is emitted verbatim.
 */
function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;

  while (rest.length > 0) {
    const match = INLINE_RE.exec(rest);
    if (!match || match.index === undefined) {
      tokens.push({ type: 'text', content: rest });
      break;
    }

    if (match.index > 0) {
      tokens.push({ type: 'text', content: rest.slice(0, match.index) });
    }

    const token = match[0];
    if (token.startsWith('`')) {
      tokens.push({ type: 'code', content: token.slice(1, -1) });
    } else if (token.startsWith('**')) {
      tokens.push({ type: 'bold', content: token.slice(2, -2) });
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        tokens.push({
          type: 'link',
          content: linkMatch[1],
          href: linkMatch[2].trim(),
        });
      } else {
        tokens.push({ type: 'text', content: token });
      }
    } else if (token.startsWith('*')) {
      tokens.push({ type: 'italic', content: token.slice(1, -1) });
    } else {
      // underscore italic
      tokens.push({ type: 'italic', content: token.slice(1, -1) });
    }

    rest = rest.slice(match.index + token.length);
  }

  return tokens;
}

/** Render inline tokens as themed `<Text>` children. */
function renderInline(
  text: string,
  colors: ThemeColors,
  styles: ReturnType<typeof createStyles>,
): React.ReactNode[] {
  return tokenizeInline(text).map((token, idx) => {
    switch (token.type) {
      case 'bold':
        return (
          <Text key={idx} style={styles.strong}>
            {token.content}
          </Text>
        );
      case 'italic':
        return (
          <Text key={idx} style={styles.em}>
            {token.content}
          </Text>
        );
      case 'code':
        return (
          <Text key={idx} style={styles.codeInline}>
            {token.content}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={idx}
            style={styles.link}
            onPress={() => {
              Linking.openURL(token.href).catch(() => {});
            }}
          >
            {token.content}
          </Text>
        );
      default:
        return <Text key={idx}>{token.content}</Text>;
    }
  });
}

// ============================================================================
// Block rendering
// ============================================================================

function renderBlock(
  block: Block,
  key: number,
  colors: ThemeColors,
  styles: ReturnType<typeof createStyles>,
  // All image URLs in the document (resolved) + this block's position among
  // them, so tapping an image opens the viewer with swipe-through paging.
  imageUrls: string[],
  imageOrdinal: number,
): React.ReactNode {
  switch (block.kind) {
    case 'heading': {
      const headingStyle =
        block.level === 1
          ? styles.heading1
          : block.level === 2
            ? styles.heading2
            : styles.heading3;
      return (
        <Text key={key} style={headingStyle}>
          {renderInline(block.text, colors, styles)}
        </Text>
      );
    }

    case 'paragraph':
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInline(block.text, colors, styles)}
        </Text>
      );

    case 'blockquote':
      return (
        <View key={key} style={styles.blockquote}>
          <Text style={styles.paragraph}>
            {renderInline(block.text, colors, styles)}
          </Text>
        </View>
      );

    case 'code':
      return (
        <View key={key} style={styles.codeBlock}>
          <Text style={styles.codeBlockText}>{block.text}</Text>
        </View>
      );

    case 'hr':
      return <View key={key} style={styles.hr} />;

    case 'bullet':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, idx) => (
            <View key={idx} style={styles.listRow}>
              <Text style={styles.bulletMarker}>{'•'}</Text>
              <Text style={styles.listItemText}>
                {renderInline(item, colors, styles)}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'ordered':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, idx) => (
            <View key={idx} style={styles.listRow}>
              <Text style={styles.orderedMarker}>{`${idx + 1}.`}</Text>
              <Text style={styles.listItemText}>
                {renderInline(item, colors, styles)}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'tasks':
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, idx) => (
            <View key={idx} style={styles.taskRow}>
              <Ionicons
                name={item.checked ? 'checkbox' : 'square-outline'}
                size={20}
                color={item.checked ? colors.success : colors.iconSecondary}
                style={styles.taskCheckbox}
              />
              <Text
                style={[
                  styles.taskLabel,
                  item.checked && styles.taskLabelChecked,
                  item.checked && { color: colors.textSecondary },
                ]}
              >
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      );

    case 'image':
      return (
        <Pressable
          key={key}
          style={styles.mediaBlock}
          onPress={() => ImageViewerManager.show(imageUrls, imageOrdinal)}
          accessibilityRole="imagebutton"
          accessibilityLabel={
            block.alt ? `${block.alt} — tap to view full screen` : 'Image — tap to view full screen'
          }
        >
          <AppImage
            source={block.src}
            style={styles.image}
            resizeMode="cover"
            showLoadingIndicator
            optimizedWidth={1200}
            placeholder={{ type: 'icon', icon: 'image-outline' }}
          />
        </Pressable>
      );

    case 'video':
      return (
        <View key={key} style={styles.mediaBlock}>
          <VideoPlayer url={block.src} name={block.caption || undefined} />
        </View>
      );

    default:
      return null;
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders markdown `source` with the app theme and custom media handling.
 */
export function Markdown({ source }: MarkdownProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const blocks = useMemo(() => parseBlocks(source ?? ''), [source]);

  // Every image in the document, resolved to a fetchable URL, so a tapped
  // image opens the full-screen viewer at its own slide with paging through
  // the rest.
  const imageUrls = useMemo(
    () =>
      blocks
        .filter((b): b is Extract<Block, { kind: 'image' }> => b.kind === 'image')
        .map((b) => getMediaUrl(b.src) ?? b.src),
    [blocks],
  );

  if (blocks.length === 0) return null;

  let imageOrdinal = -1;
  return (
    <View>
      {blocks.map((block, idx) => {
        if (block.kind === 'image') imageOrdinal += 1;
        return renderBlock(block, idx, colors, styles, imageUrls, imageOrdinal);
      })}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    heading1: {
      color: colors.text,
      fontSize: 26,
      fontWeight: '700',
      marginTop: 16,
      marginBottom: 8,
    },
    heading2: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
      marginTop: 14,
      marginBottom: 6,
    },
    heading3: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '600',
      marginTop: 12,
      marginBottom: 4,
    },
    paragraph: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
      marginTop: 4,
      marginBottom: 4,
    },
    strong: { fontWeight: '700', color: colors.text },
    em: { fontStyle: 'italic', color: colors.text },
    link: { color: colors.link, textDecorationLine: 'underline' },
    codeInline: {
      backgroundColor: colors.surfaceSecondary,
      color: colors.text,
      fontFamily: 'Courier',
      fontSize: 14,
    },
    codeBlock: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 8,
      padding: 12,
      marginVertical: 6,
    },
    codeBlockText: {
      color: colors.text,
      fontFamily: 'Courier',
      fontSize: 14,
    },
    blockquote: {
      backgroundColor: colors.surfaceSecondary,
      borderLeftWidth: 4,
      borderLeftColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 6,
      marginVertical: 6,
      borderRadius: 4,
    },
    hr: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth * 2,
      marginVertical: 12,
    },
    list: { marginVertical: 4 },
    listRow: {
      flexDirection: 'row',
      marginVertical: 2,
    },
    bulletMarker: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
      marginRight: 8,
    },
    orderedMarker: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
      marginRight: 8,
    },
    listItemText: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
    },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginVertical: 2,
    },
    taskCheckbox: {
      marginTop: 1,
      marginRight: 8,
    },
    taskLabel: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
    },
    taskLabelChecked: {
      textDecorationLine: 'line-through',
    },
    mediaBlock: {
      marginVertical: 8,
    },
    image: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 8,
    },
  });
}
