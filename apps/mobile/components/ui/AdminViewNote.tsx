import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';

interface AdminViewNoteProps {
  /** Disclaimer text. Keep short — one or two sentences, impersonal voice. */
  text: string;
  /**
   * `card` (default): inset rounded note that sits in a section's flow.
   * `banner`: full-bleed top banner with a hairline bottom border (use at
   * the top of a screen below the header).
   */
  variant?: 'card' | 'banner';
  style?: StyleProp<ViewStyle>;
}

/**
 * Small info note used to flag *asymmetric views* — when a community
 * admin or group leader sees content that a regular member doesn't.
 * Matches the existing pattern from `app/inbox/[groupId]/[channelSlug]/
 * members.tsx` and the active-state hint card: outline info icon +
 * `textSecondary` copy in a `surfaceSecondary` container.
 *
 * Voice convention (matches the codebase): impersonal, short, no period
 * for one-liners; period when there's a second sentence. Examples:
 *   - "Visible to community admins only"
 *   - "Members don't see this address until they join."
 */
export function AdminViewNote({
  text,
  variant = 'card',
  style,
}: AdminViewNoteProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        variant === 'card' ? styles.card : styles.banner,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <Ionicons
        name="information-circle-outline"
        size={16}
        color={colors.textSecondary}
        style={styles.icon}
      />
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    marginTop: 1,
    marginRight: 8,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
