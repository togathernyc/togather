/**
 * MarkdownToolbar - Insert toolbar for the MarkdownEditor.
 *
 * Presents one button per supported block/inline action. Each button reports
 * its action to the parent, which applies the corresponding token splice to the
 * markdown source. Media buttons show a spinner while an upload is in flight.
 */
import React from 'react';
import {
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

export type MarkdownAction =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'bulletList'
  | 'checklist'
  | 'link'
  | 'image'
  | 'video';

interface ToolbarButton {
  action: MarkdownAction;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}

const BUTTONS: ToolbarButton[] = [
  { action: 'heading', icon: 'text', label: 'Heading' },
  { action: 'bold', icon: 'text-outline', label: 'Bold' },
  { action: 'italic', icon: 'trending-up', label: 'Italic' },
  { action: 'bulletList', icon: 'list', label: 'List' },
  { action: 'checklist', icon: 'checkbox-outline', label: 'Checklist' },
  { action: 'link', icon: 'link', label: 'Link' },
  { action: 'image', icon: 'image-outline', label: 'Image' },
  { action: 'video', icon: 'videocam-outline', label: 'Video' },
];

interface MarkdownToolbarProps {
  onAction: (action: MarkdownAction) => void;
  /** When set, shows a spinner over the matching media button and disables it. */
  busyAction?: MarkdownAction | null;
}

export function MarkdownToolbar({ onAction, busyAction }: MarkdownToolbarProps) {
  const { colors } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={[styles.container, { borderColor: colors.border }]}
      contentContainerStyle={styles.content}
    >
      {BUTTONS.map((btn) => {
        const busy = busyAction === btn.action;
        return (
          <Pressable
            key={btn.action}
            onPress={() => onAction(btn.action)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={btn.label}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.surfaceSecondary },
              pressed && { backgroundColor: colors.selectedBackground },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.icon} />
            ) : (
              <Ionicons name={btn.icon} size={18} color={colors.icon} />
            )}
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              {btn.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  content: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
