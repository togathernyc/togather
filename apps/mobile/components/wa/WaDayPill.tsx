/**
 * WaDayPill — the floating date-separator capsule in a chat thread.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §5: "centered, floating capsule (13pt semibold
 * text, `bg.card`-ish translucent fill, ~6pt vertical/14pt horizontal
 * padding, fully rounded), sticky at the top of the viewport while its day's
 * messages are in view, otherwise inline between message groups." This
 * component renders the pill itself only — stickiness/positioning is the
 * chat-room screen's responsibility (scroll-driven, not presentational).
 *
 * WA-VISUAL-DELTAS.md §S4.3 revises the fill: against the doodle wallpaper a
 * translucent capsule washed out, so the pill is a *solid* white (light) /
 * slate (dark) capsule with a soft shadow — "floating white capsules", crisp
 * against the pattern.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@hooks/useTheme';
import { WA_DAY_PILL_PADDING_V, WA_DAY_PILL_PADDING_H } from './metrics';

/** §S4.3 solid capsule fills — deliberately not `colors.surface`, which is
 *  pure white/near-black and would lose the pill's edge in dark mode. */
const WA_DAY_PILL_FILL_LIGHT = '#FFFFFF';
const WA_DAY_PILL_FILL_DARK = '#1F2C34';
const WA_DAY_PILL_TEXT_DARK = 'rgba(255, 255, 255, 0.75)';

export interface WaDayPillProps {
  /** e.g. "Friday", "Fri, Jul 17", "Sat, Jul 18" */
  label: string;
}

export function WaDayPill({ label }: WaDayPillProps) {
  const { colors, isDark } = useTheme();
  return (
    <View
      testID="wa-day-pill"
      style={[
        styles.pill,
        { backgroundColor: isDark ? WA_DAY_PILL_FILL_DARK : WA_DAY_PILL_FILL_LIGHT },
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: isDark ? WA_DAY_PILL_TEXT_DARK : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingVertical: WA_DAY_PILL_PADDING_V,
    paddingHorizontal: WA_DAY_PILL_PADDING_H,
    // §S4.3 "subtle shadow" — lifts the capsule off the patterned wallpaper.
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  text: {
    // §S7: day pills are 13pt; medium weight reads crisper on the solid fill
    // than the previous semibold.
    fontSize: 13,
    fontWeight: '500',
  },
});
