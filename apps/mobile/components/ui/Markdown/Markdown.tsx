import React from 'react';
import { Text } from 'react-native';

interface MarkdownProps {
  source: string;
}

/**
 * Renders markdown source.
 *
 * NOTE: This is a stub that renders `source` as plain text. Real rich markdown
 * rendering (via `react-native-markdown-display`) lands in Agent B's pass.
 */
export function Markdown({ source }: MarkdownProps) {
  return <Text>{source}</Text>;
}
