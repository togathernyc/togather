/**
 * WaBadge — the unread-count capsule.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.1: "filled `accent` capsule/circle, min 20pt
 * diameter (grows horizontally past 2 digits, min 8pt horizontal padding),
 * white bold 12pt numeral." §1.3: the fill is always brand-mapped — pass the
 * resolved accent (e.g. from `utils/waPalette.ts`'s `waAccentPalette()`) via
 * the `color` prop; this component never reads community theme itself.
 *
 * WA-VISUAL-DELTAS.md S6.3 adds one variant: rows that stand for a
 * *container* of chats (a community, a group parent with channels under it)
 * put the disclosure chevron **inside** the same capsule as the count — one
 * green pill reading "7 ›" — instead of a badge with a separate gray chevron
 * beside it. Pass `showChevron` for those rows only.
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
  /** S6.3: draw a chevron inside the capsule after the count ("7 ›") — group-parent rows only. */
  showChevron?: boolean;
}

export function WaBadge({
  count,
  color = WA_DEFAULT_ACCENT,
  textColor = '#FFFFFF',
  showChevron = false,
}: WaBadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={[styles.text, { color: textColor }]} numberOfLines={1}>
        {count > 99 ? '99+' : count}
      </Text>
      {showChevron ? (
        // A text glyph rather than an Ionicon: it inherits the numeral's
        // baseline and optical weight, so the capsule reads as one token
        // ("7 ›") instead of a number with an icon parked next to it.
        <Text style={[styles.chevron, { color: textColor }]} numberOfLines={1}>
          ›
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
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
  chevron: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 3,
    // Nudges the glyph off its own overshooting baseline so it centers
    // against the numeral rather than sitting low in the capsule.
    marginTop: -1,
  },
});
