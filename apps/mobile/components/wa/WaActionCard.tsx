/**
 * WaActionCard — one button in the action row that sits between an info
 * screen's hero and its first grouped card.
 *
 * WA-VISUAL-DELTAS.md per-screen §3.3: "Action-button row (white rounded
 * cards w/ green glyph + label) where actions exist (Invite / Search / Mute)",
 * and S5.2's kill-list entry "green circle Invite/Search glyphs on community
 * page (WA uses white button cards)". So: a card-fill rounded rect ~76pt tall,
 * accent line glyph over a 15pt DARK label — the accent lives in the glyph
 * only, never in the fill or the label (S5.1 keeps green to CTA pills, badges,
 * action-link text, and outgoing bubbles).
 *
 * Presentational only: reads `useTheme()` for the card fill and label ink;
 * the brand accent is an explicit prop, never read from community theme here.
 * Compose several inside a `WaActionCardRow`.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import {
  WA_ACTION_CARD_HEIGHT,
  WA_ACTION_CARD_RADIUS,
  WA_ACTION_CARD_GAP,
  WA_ACTION_CARD_ICON_SIZE,
  WA_ACTION_CARD_LABEL_SIZE,
  WA_GROUP_MARGIN,
  WA_DEFAULT_ACCENT,
} from './metrics';

export interface WaActionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** Accent for the glyph. Falls back to WhatsApp's own default green. */
  accent?: string;
  disabled?: boolean;
  testID?: string;
}

export function WaActionCard({
  icon,
  label,
  onPress,
  accent = WA_DEFAULT_ACCENT,
  disabled,
  testID,
}: WaActionCardProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.surfaceGrouped },
        pressed && styles.cardPressed,
        disabled && styles.cardDisabled,
      ]}
    >
      <Ionicons name={icon} size={WA_ACTION_CARD_ICON_SIZE} color={accent} />
      <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The row wrapper — equal-width cards, screen-margin aligned with the cards below. */
export function WaActionCardRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: WA_ACTION_CARD_GAP,
    paddingHorizontal: WA_GROUP_MARGIN,
  },
  card: {
    flex: 1,
    height: WA_ACTION_CARD_HEIGHT,
    borderRadius: WA_ACTION_CARD_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: WA_ACTION_CARD_LABEL_SIZE,
    fontWeight: '400',
  },
});
