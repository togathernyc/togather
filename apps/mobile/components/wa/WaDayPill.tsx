/**
 * WaDayPill — the floating date-separator capsule in a chat thread.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §5: "centered, floating capsule (13pt semibold
 * text, `bg.card`-ish translucent fill, ~6pt vertical/14pt horizontal
 * padding, fully rounded), sticky at the top of the viewport while its day's
 * messages are in view, otherwise inline between message groups." This
 * component renders the pill itself only — stickiness/positioning is the
 * chat-room screen's responsibility (scroll-driven, not presentational).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import { WA_DAY_PILL_PADDING_V, WA_DAY_PILL_PADDING_H } from './metrics';

export interface WaDayPillProps {
  /** e.g. "Friday", "Fri, Jul 17", "Sat, Jul 18" */
  label: string;
}

export function WaDayPill({ label }: WaDayPillProps) {
  const { colors, isDark } = useTheme();
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: isDark ? 'rgba(31, 44, 52, 0.85)' : 'rgba(255, 255, 255, 0.9)',
        },
      ]}
    >
      <Text style={[styles.text, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingVertical: WA_DAY_PILL_PADDING_V,
    paddingHorizontal: WA_DAY_PILL_PADDING_H,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
});
