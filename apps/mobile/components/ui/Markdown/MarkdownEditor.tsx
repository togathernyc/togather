import React from 'react';
import { TextInput } from 'react-native';

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
}

/**
 * A controlled multiline editor for markdown source.
 *
 * NOTE: This is a stub rendering a plain multiline `TextInput`. A richer editing
 * experience (toolbar, preview) lands in Agent B's pass.
 */
export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      multiline
    />
  );
}
