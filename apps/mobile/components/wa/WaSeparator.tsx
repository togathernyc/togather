/**
 * WaSeparator — hairline row/card divider.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.1: "0.5-1px hairline, inset to align with the
 * text column" for full-bleed chat rows (pass `inset={WA_SEPARATOR_INSET}`),
 * and §3.2's card-internal hairlines (pass `inset={0}` or omit). Full-width
 * separators (no inset) also precede section-starting utility rows like
 * "Archived."
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@hooks/useTheme';

export interface WaSeparatorProps {
  /** Left margin so the hairline starts at the text column, not the avatar. Default 0 (full-bleed). */
  inset?: number;
  /** Overrides the theme's `separator` token. */
  color?: string;
}

export function WaSeparator({ inset = 0, color }: WaSeparatorProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.separator,
        { marginLeft: inset, backgroundColor: color ?? colors.separator },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
  },
});
