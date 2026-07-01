/**
 * markdownRules - Themed render rules for `react-native-markdown-display`.
 *
 * Builds the StyleSheet (from the app theme tokens) and the custom render
 * rules used by both the Markdown renderer and the MarkdownEditor preview.
 *
 * Custom behavior beyond the library defaults:
 * - Images render through `AppImage` so `r2:` storage paths + Cloudflare
 *   transforms work (the default renderer uses raw <Image> and can't resolve
 *   `r2:` paths).
 * - The `!video[alt](r2:... | .mp4 url)` extension renders through `VideoPlayer`.
 * - GitHub-style task list items (`- [ ]` / `- [x]`) render as read-only
 *   checkbox rows.
 *
 * See the doc block in `Markdown.tsx` for the full media/video conventions.
 */
import React from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  renderRules as defaultRules,
  type RenderRules,
  type ASTNode,
} from 'react-native-markdown-display';
import type { ThemeColors } from '@/theme/colors';
import { AppImage } from '@components/ui/AppImage';
import { VideoPlayer } from '@features/chat/components/VideoPlayer';

/**
 * A source path counts as a video when it uses the `!video[]()` extension
 * (handled during preprocessing) or points at a recognizable video file.
 */
export function isVideoSource(src: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?.*)?$/i.test(src) || src.startsWith('video:');
}

/**
 * Normalize a `video:`-prefixed token back to its underlying media path.
 */
function normalizeVideoSrc(src: string): string {
  return src.startsWith('video:') ? src.slice('video:'.length) : src;
}

/**
 * Collect all leaf text content under an AST node in document order.
 */
function collectText(node: ASTNode): string {
  if (node.type === 'text') return node.content ?? '';
  if (!node.children || node.children.length === 0) return '';
  return node.children.map(collectText).join('');
}

/**
 * Pull the leading task-list marker off a list item, if present.
 *
 * markdown-it leaves `[ ]` / `[x]` as literal text at the start of the item's
 * first paragraph, so we inspect the AST rather than adding a parser plugin.
 * Returns the checked state plus the remaining (marker-stripped) label text, or
 * `null` when the item is a normal bullet. Task items are treated as
 * plain-text labels, which covers the GitHub task-list convention.
 */
function extractTaskMarker(
  node: ASTNode,
): { checked: boolean; label: string } | null {
  const raw = collectText(node);
  const match = /^\[( |x|X)\]\s+([\s\S]*)$/.exec(raw);
  if (!match) return null;
  return { checked: match[1].toLowerCase() === 'x', label: match[2].trim() };
}

/**
 * Build render rules bound to the current theme colors.
 *
 * @param colors - Theme color tokens from `useTheme()`.
 */
export function createMarkdownRules(colors: ThemeColors): RenderRules {
  return {
    // Images: route through AppImage so r2: paths + transforms resolve.
    image: (node) => {
      const src: string = node.attributes?.src ?? '';
      const alt: string | undefined = node.attributes?.alt || undefined;

      if (isVideoSource(src)) {
        return (
          <View key={node.key} style={styles.mediaBlock}>
            <VideoPlayer url={normalizeVideoSrc(src)} name={alt} />
          </View>
        );
      }

      return (
        <View key={node.key} style={styles.mediaBlock}>
          <AppImage
            source={src}
            style={styles.image}
            resizeMode="cover"
            showLoadingIndicator
            optimizedWidth={1200}
            placeholder={{ type: 'icon', icon: 'image-outline' }}
          />
        </View>
      );
    },

    // Task list items render as read-only checkbox rows; everything else falls
    // back to the library's default bullet/ordered rendering.
    list_item: (node, children, parent, defaultStyles, inheritedStyles = {}) => {
      const task = extractTaskMarker(node);
      if (!task) {
        return defaultRules.list_item?.(
          node,
          children,
          parent,
          defaultStyles,
          inheritedStyles,
        );
      }
      return (
        <View key={node.key} style={styles.taskRow}>
          <Ionicons
            name={task.checked ? 'checkbox' : 'square-outline'}
            size={20}
            color={task.checked ? colors.success : colors.iconSecondary}
            style={styles.taskCheckbox}
          />
          <Text
            style={[
              styles.taskLabel,
              { color: colors.text },
              task.checked && styles.taskLabelChecked,
              task.checked && { color: colors.textSecondary },
            ]}
          >
            {task.label}
          </Text>
        </View>
      );
    },

    // Links open externally; styled with the theme link color.
    link: (node, children) => (
      <Text
        key={node.key}
        style={styles.link}
        onPress={() => {
          const href = node.attributes?.href;
          if (href) Linking.openURL(href).catch(() => {});
        }}
      >
        {children}
      </Text>
    ),
  };
}

/**
 * Build the themed StyleSheet passed to `<Markdown style={...}>`.
 *
 * The keys map to the library's style slots (heading1..6, strong, em, etc).
 */
export function createMarkdownStyles(colors: ThemeColors) {
  return StyleSheet.create({
    body: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 24,
    },
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
    heading4: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
      marginTop: 10,
      marginBottom: 4,
    },
    heading5: {
      color: colors.textSecondary,
      fontSize: 15,
      fontWeight: '600',
      marginTop: 8,
    },
    heading6: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 8,
    },
    strong: { fontWeight: '700', color: colors.text },
    em: { fontStyle: 'italic' },
    s: { textDecorationLine: 'line-through', color: colors.textSecondary },
    link: { color: colors.link, textDecorationLine: 'underline' },
    blockquote: {
      backgroundColor: colors.surfaceSecondary,
      borderLeftWidth: 4,
      borderLeftColor: colors.border,
      paddingHorizontal: 12,
      paddingVertical: 6,
      marginVertical: 6,
      borderRadius: 4,
    },
    bullet_list: { marginVertical: 4 },
    ordered_list: { marginVertical: 4 },
    list_item: { marginVertical: 2, flexDirection: 'row' },
    bullet_list_icon: { color: colors.text },
    ordered_list_icon: { color: colors.text },
    code_inline: {
      backgroundColor: colors.surfaceSecondary,
      color: colors.text,
      borderRadius: 4,
      paddingHorizontal: 4,
      fontFamily: 'Courier',
      fontSize: 14,
    },
    code_block: {
      backgroundColor: colors.surfaceSecondary,
      color: colors.text,
      borderRadius: 8,
      padding: 12,
      fontFamily: 'Courier',
      fontSize: 14,
      marginVertical: 6,
    },
    fence: {
      backgroundColor: colors.surfaceSecondary,
      color: colors.text,
      borderRadius: 8,
      padding: 12,
      fontFamily: 'Courier',
      fontSize: 14,
      marginVertical: 6,
    },
    hr: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth * 2,
      marginVertical: 12,
    },
    table: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      marginVertical: 6,
    },
    thead: { backgroundColor: colors.surfaceSecondary },
    th: { padding: 6, color: colors.text },
    tr: { borderColor: colors.border },
    td: { padding: 6, color: colors.text },
    paragraph: { marginTop: 4, marginBottom: 4, color: colors.text },
  });
}

const styles = StyleSheet.create({
  mediaBlock: {
    marginVertical: 8,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
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
    fontSize: 16,
    lineHeight: 24,
  },
  taskLabelChecked: {
    textDecorationLine: 'line-through',
  },
  link: {
    textDecorationLine: 'underline',
  },
});
