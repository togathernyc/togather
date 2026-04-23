/**
 * Shared text-parsing + linkified text rendering.
 *
 * Extracted from `features/chat/components/MessageItem.tsx` so profile
 * bios and any other user-generated text can share the same `@[mention]`
 * and URL parsing. Consumers should prefer the `<LinkifiedText>` wrapper
 * below; `parseMessageContent` is exported for cases (chat) where the
 * caller needs to interleave custom styling per part.
 */

import React from 'react';
import { Linking, StyleProp, Text, TextStyle } from 'react-native';

export type ContentPart = {
  type: 'text' | 'mention' | 'url';
  value: string;
  /** For mentions, the display string without brackets (e.g. `@John Smith`). */
  displayValue?: string;
};

/**
 * Parse a string and detect bracketed @mentions and http(s) URLs.
 *
 * Mentions use the bracketed format `@[Display Name]` so multi-word names
 * round-trip correctly. URLs must start with `http://` or `https://` and
 * terminate at the first whitespace character.
 */
export function parseMessageContent(content: string): ContentPart[] {
  const parts: ContentPart[] = [];

  const mentionRegex = /@\[([^\]]+)\]/g;
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  const allMatches: Array<{
    type: 'mention' | 'url';
    value: string;
    displayValue?: string;
    index: number;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(content)) !== null) {
    allMatches.push({
      type: 'mention',
      value: match[0],
      displayValue: `@${match[1]}`,
      index: match.index,
    });
  }
  while ((match = urlRegex.exec(content)) !== null) {
    allMatches.push({ type: 'url', value: match[0], index: match.index });
  }

  allMatches.sort((a, b) => a.index - b.index);

  let lastIndex = 0;
  for (const m of allMatches) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', value: content.substring(lastIndex, m.index) });
    }
    parts.push({
      type: m.type,
      value: m.value,
      displayValue: m.displayValue,
    });
    lastIndex = m.index + m.value.length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.substring(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', value: content });
  }

  return parts;
}

interface LinkifiedTextProps {
  content: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  mentionStyle?: StyleProp<TextStyle>;
  onUrlPress?: (url: string) => void;
  onMentionPress?: (mention: string) => void;
  numberOfLines?: number;
}

/**
 * Render a string with URLs and @mentions auto-linkified.
 *
 * Taps on URLs open in the OS browser by default; supply `onUrlPress` to
 * override. Mentions default to a no-op unless `onMentionPress` is given.
 */
export function LinkifiedText({
  content,
  style,
  linkStyle,
  mentionStyle,
  onUrlPress,
  onMentionPress,
  numberOfLines,
}: LinkifiedTextProps) {
  const parts = parseMessageContent(content);
  const handleUrlPress = (url: string) => {
    if (onUrlPress) {
      onUrlPress(url);
      return;
    }
    Linking.openURL(url).catch((err) => {
      // Swallow — opening external URLs failing is non-fatal and the user
      // will see the browser failure directly if anything escalates.
      console.warn('[LinkifiedText] Failed to open URL:', err);
    });
  };

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, index) => {
        if (part.type === 'url') {
          return (
            <Text
              key={index}
              style={linkStyle}
              onPress={() => handleUrlPress(part.value)}
            >
              {part.value}
            </Text>
          );
        }
        if (part.type === 'mention') {
          return (
            <Text
              key={index}
              style={mentionStyle}
              onPress={() => onMentionPress?.(part.value)}
            >
              {part.displayValue || part.value}
            </Text>
          );
        }
        return <Text key={index}>{part.value}</Text>;
      })}
    </Text>
  );
}
