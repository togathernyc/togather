/**
 * ReplyQuoteBlock — WhatsApp's in-bubble reply quote
 * (WHATSAPP-DESIGN-SYSTEM.md §5 "Reply-quote bar").
 *
 * A reply is a NORMAL bubble in the timeline; the message it answers is quoted
 * *inside* that bubble, above the reply's own text. Anatomy, leading edge in:
 *
 *   ┌─────────────────────────────────┐
 *   │▍ Dara Peters              [img] │  ← 4pt accent strip, name in the
 *   │▍ Who is bringing the chairs?    │    quoted sender's own hue, snippet
 *   └─────────────────────────────────┘    13pt gray, one line, ellipsized
 *   I've got them              10:42 AM
 *
 * Two deliberate details:
 *
 * - The strip and the name take the QUOTED sender's `waSenderColor` hue, the
 *   same one their bubbles use for their own name line, so the quote points
 *   back at a person you can already recognise by color.
 * - The fill is an alpha mix, not a solid token, because it has to read as
 *   recessed on the white incoming bubble AND on the mint outgoing one, in
 *   light and dark.
 *
 * Tapping the block scrolls the timeline to the quoted message and flashes it
 * (the same anchor machinery inbox search uses).
 *
 * Flag-on only: `MessageItem` renders this exclusively under
 * `whatsappShellEnabled`, and `MessageList` only supplies the data when the
 * flag is on.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { AppImage } from '@components/ui';
import type { Id } from '@services/api/convex';
import {
  WA_REPLY_QUOTE_BORDER_WIDTH,
  WA_REPLY_QUOTE_THUMB_SIZE,
} from '@components/wa/metrics';
import {
  WA_REPLY_QUOTE_FILL_DARK,
  WA_REPLY_QUOTE_FILL_LIGHT,
  WA_REPLY_QUOTE_RADIUS,
  WA_REPLY_QUOTE_SNIPPET_DARK,
  WA_REPLY_QUOTE_SNIPPET_LIGHT,
  WA_REPLY_QUOTE_TEXT_SIZE,
  waSenderColor,
} from '../waChatChrome';

/**
 * The quoted-parent context, denormalized by `getMessages({ waReplies: true })`
 * onto every reply it admits to the timeline. Denormalized rather than looked
 * up client-side precisely so a reply can render its quote when the parent is
 * far above the loaded page — the job the old floating "ghost" pointer existed
 * to do.
 */
export interface ReplyQuote {
  parentMessageId: Id<'chatMessages'>;
  /** Parent was soft-deleted (or hard-gone) — WhatsApp quotes it as deleted. */
  parentDeleted?: boolean;
  parentSenderId?: Id<'users'>;
  parentSenderName?: string;
  parentContent?: string;
  /** `type` of the parent's first attachment, when it had one. */
  parentAttachmentType?: string;
  /** Thumbnail for a media parent, when the URL is already in hand. */
  parentThumbnailUrl?: string;
}

interface ReplyQuoteBlockProps {
  quote: ReplyQuote;
  /** Own (outgoing) bubbles have a tinted fill — snippet ink shifts for it. */
  isOwnBubble: boolean;
  /** Tap → scroll the timeline to the quoted message and flash it. */
  onPress?: (parentMessageId: Id<'chatMessages'>) => void;
}

/** The glyph + label WhatsApp shows for a media parent with no caption. */
const MEDIA_LABELS: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  image: { icon: 'camera', label: 'Photo' },
  video: { icon: 'videocam', label: 'Video' },
  audio: { icon: 'mic', label: 'Voice message' },
  document: { icon: 'document-text', label: 'Document' },
};

/**
 * What the snippet line says. Text wins; a caption-less media parent falls back
 * to its glyph + noun; a deleted parent gets WhatsApp's own copy. Never blank —
 * an empty snippet would collapse the block into a bare colored strip.
 */
export function resolveQuoteSnippet(quote: ReplyQuote): {
  text: string;
  icon?: keyof typeof Ionicons.glyphMap;
  isPlaceholder: boolean;
} {
  if (quote.parentDeleted) {
    return { text: 'Original message was deleted', isPlaceholder: true };
  }
  const trimmed = (quote.parentContent ?? '').trim();
  if (trimmed.length > 0) {
    // Collapse newlines so a multi-line parent still occupies exactly one line.
    return { text: trimmed.replace(/\s*\n+\s*/g, ' '), isPlaceholder: false };
  }
  const media = quote.parentAttachmentType
    ? MEDIA_LABELS[quote.parentAttachmentType]
    : undefined;
  if (media) {
    return { text: media.label, icon: media.icon, isPlaceholder: true };
  }
  if (quote.parentAttachmentType) {
    return { text: 'Attachment', icon: 'attach', isPlaceholder: true };
  }
  return { text: 'Message', isPlaceholder: true };
}

export function ReplyQuoteBlock({ quote, isOwnBubble, onPress }: ReplyQuoteBlockProps) {
  const { colors, isDark } = useTheme();

  // A deleted parent keeps its author's hue when we still know who they were;
  // otherwise the strip goes neutral rather than picking an arbitrary color.
  const accent = quote.parentSenderId
    ? waSenderColor(quote.parentSenderId, isDark)
    : colors.textTertiary;

  const { text, icon, isPlaceholder } = resolveQuoteSnippet(quote);
  const snippetColor = isOwnBubble
    ? isDark
      ? WA_REPLY_QUOTE_SNIPPET_DARK
      : WA_REPLY_QUOTE_SNIPPET_LIGHT
    : colors.textSecondary;

  const showThumb =
    !quote.parentDeleted &&
    !!quote.parentThumbnailUrl &&
    (quote.parentAttachmentType === 'image' || quote.parentAttachmentType === 'video');

  return (
    <Pressable
      testID={`wa-reply-quote-${quote.parentMessageId}`}
      onPress={onPress ? () => onPress(quote.parentMessageId) : undefined}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Replying to ${quote.parentSenderName || 'a message'}: ${text}`}
      style={[
        styles.container,
        { backgroundColor: isDark ? WA_REPLY_QUOTE_FILL_DARK : WA_REPLY_QUOTE_FILL_LIGHT },
      ]}
    >
      {/* Leading accent strip — stretches the block's full height. */}
      <View testID="wa-reply-quote-bar" style={[styles.bar, { backgroundColor: accent }]} />

      <View style={styles.body}>
        {/* WhatsApp always names the quoted author, including on your own
            replies to yourself — it's how you tell one quote from another in a
            run of them. */}
        <Text
          testID="wa-reply-quote-name"
          style={[styles.name, { color: accent }]}
          numberOfLines={1}
        >
          {quote.parentSenderName || 'Unknown'}
        </Text>
        <View style={styles.snippetRow}>
          {icon && (
            <Ionicons
              name={icon}
              size={WA_REPLY_QUOTE_TEXT_SIZE}
              color={snippetColor}
              style={styles.snippetIcon}
            />
          )}
          <Text
            testID="wa-reply-quote-snippet"
            style={[
              styles.snippet,
              { color: snippetColor },
              isPlaceholder && styles.snippetPlaceholder,
            ]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {text}
          </Text>
        </View>
      </View>

      {showThumb && (
        <AppImage
          source={quote.parentThumbnailUrl}
          style={styles.thumb}
          optimizedWidth={WA_REPLY_QUOTE_THUMB_SIZE * 3}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: WA_REPLY_QUOTE_RADIUS,
    overflow: 'hidden',
    marginBottom: 4,
    // Own margins only — the bubble's horizontal padding already insets it, and
    // WhatsApp's quote block sits flush inside that padding.
  },
  bar: {
    width: WA_REPLY_QUOTE_BORDER_WIDTH,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    flexShrink: 1,
    paddingVertical: 4,
    paddingLeft: 6,
    paddingRight: 8,
  },
  name: {
    fontSize: WA_REPLY_QUOTE_TEXT_SIZE,
    fontWeight: '600',
    marginBottom: 1,
  },
  snippetRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  snippetIcon: {
    marginRight: 3,
  },
  snippet: {
    flexShrink: 1,
    fontSize: WA_REPLY_QUOTE_TEXT_SIZE,
  },
  snippetPlaceholder: {
    fontStyle: 'italic',
  },
  thumb: {
    width: WA_REPLY_QUOTE_THUMB_SIZE,
    height: WA_REPLY_QUOTE_THUMB_SIZE,
    alignSelf: 'center',
    marginRight: 4,
    borderRadius: 3,
  },
});
