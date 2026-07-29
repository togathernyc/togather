/**
 * WaSeparator — hairline row/card divider.
 *
 * WHATSAPP-DESIGN-SYSTEM.md §3.1: "0.5-1px hairline, inset to align with the
 * text column" for full-bleed chat rows (pass
 * `inset={WA_LIST_SEPARATOR_INSET}` — the 84pt from `WaRow`, which starts the
 * hairline at the title's x-position), and §3.2's card-internal hairlines
 * (pass `inset={0}` or omit).
 *
 * The hairline also stops 16pt short of the RIGHT edge: WhatsApp's row
 * dividers are inset on both sides, and running ours to the screen edge was
 * one of the "chrome is inflated" tells in the calibrated pixel pass
 * (2026-07-29).
 *
 * WA-VISUAL-DELTAS.md S6/§1.6: an inset hairline is the **only** thing that
 * separates rows in the reference — there are no heavier seams, gaps, or
 * card edges between groups of rows, so a full-bleed separator should be
 * reserved for a genuine structural break, never used to fence off a cluster.
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
    marginRight: 16,
  },
});
