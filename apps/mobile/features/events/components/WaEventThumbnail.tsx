/**
 * WaEventThumbnail — the flag-on fallback thumbnail for an event row with no
 * cover image: a neutral rounded-square tile with a monochrome calendar glyph,
 * filling the same 58pt box (S6 "generous thumbnails") a real cover photo does.
 *
 * Deliberately NOT accent-tinted: WA-VISUAL-DELTAS.md S5.1 keeps green for the
 * CTA pill, action links and unread signals only, and a tinted disc on every
 * image-less row was the loudest color leak on the Events surface. Square
 * rather than circular so it reads as the same media slot as a cover photo
 * (circles stay for people/groups, per S6.4).
 *
 * Shared by the Events tab list and the community-wide children sheet so the
 * two can't drift.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import { WA_LIST_AVATAR, WA_AVATAR_SQUIRCLE_RATIO } from '@components/wa';

export function WaEventThumbnail() {
  const { colors, isDark } = useTheme();
  return (
    <View
      style={[styles.thumbnail, { backgroundColor: isDark ? '#2A3942' : '#EFEFEF' }]}
      testID="wa-event-thumbnail"
    >
      <Ionicons name="calendar-outline" size={24} color={colors.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  thumbnail: {
    width: WA_LIST_AVATAR,
    height: WA_LIST_AVATAR,
    borderRadius: WA_LIST_AVATAR * WA_AVATAR_SQUIRCLE_RATIO,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
