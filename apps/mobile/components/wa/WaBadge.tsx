/**
 * WaBadge — the unread-count capsule.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.1: "filled `accent` capsule/circle, min 20pt
 * diameter (grows horizontally past 2 digits, min 8pt horizontal padding),
 * white bold 12pt numeral." §1.3: the fill is always brand-mapped — pass the
 * resolved accent (e.g. from `utils/waPalette.ts`'s `waAccentPalette()`) via
 * the `color` prop; this component never reads community theme itself.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  WA_BADGE_MIN_DIAMETER,
  WA_BADGE_MIN_H_PADDING,
  WA_DEFAULT_ACCENT,
} from './metrics';

export interface WaBadgeProps {
  /** Unread count. Renders "99+" past 99 per common WhatsApp/iOS convention. */
  count: number;
  /** Badge fill — pass the caller's resolved brand accent. Falls back to WhatsApp's own default green. */
  color?: string;
  /** Numeral color. Defaults to white per spec. */
  textColor?: string;
}

export function WaBadge({ count, color = WA_DEFAULT_ACCENT, textColor = '#FFFFFF' }: WaBadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={[styles.text, { color: textColor }]} numberOfLines={1}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: WA_BADGE_MIN_DIAMETER,
    height: WA_BADGE_MIN_DIAMETER,
    borderRadius: WA_BADGE_MIN_DIAMETER / 2,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: WA_BADGE_MIN_H_PADDING,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
