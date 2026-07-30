/**
 * WaFloatingCta — the ONE floating call-to-action a flag-on top-level screen is
 * allowed (WA-VISUAL-DELTAS.md S5.1: "one green thing per screen").
 *
 * Before this existed, Events and Groups each hand-rolled their own: Events'
 * "Create Event" was a centered auto-width pill with a heavy 8pt drop shadow
 * and a 15pt label; Groups' "Add group" was a full-width bar inset 16pt from
 * each edge with a 17pt label. Two geometries for the same idea. The owner
 * asked (2026-07-29) for one design, so this component is the single
 * definition and both screens render it:
 *
 *   - centered, auto-width — hugs its label like WhatsApp's own "+ Add group",
 *     never a full-bleed bar;
 *   - `WA_FLOATING_CTA_HEIGHT` (50pt), fully rounded;
 *   - accent fill with a white 17pt semibold label and a white leading glyph —
 *     the screen's single accent element;
 *   - `WA_FLOATING_SHADOW`, the same "lifted paper" shadow every other piece of
 *     floating chrome uses (`WaFloatingButton`, the tab island). Not the
 *     material card shadow §7 bans.
 *
 * **Clearance.** The pill positions its own bottom edge at
 * `waFloatingCtaBottomOffset(bottomInset)` above the SCREEN bottom, so it
 * always floats clear of the tab island. That is measured from the screen and
 * not from the parent's content box on purpose: Yoga lays an absolutely
 * positioned child out against its parent's border box and ignores the
 * parent's padding, so the old `bottom: 0` + `paddingBottom` pairing landed the
 * pill ON the island once the container reserved `waTabBarStripHeight` (the
 * owner's dark-mode screenshot). Scroll surfaces underneath must pad by
 * `WA_FLOATING_CTA_CONTENT_CLEARANCE` so the last row clears both.
 *
 * Presentational: reads `useTheme()` for nothing but consistency with the kit —
 * the accent hex is an explicit prop, so this never reaches for
 * `useCommunityTheme()` itself.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  WA_FLOATING_CTA_HEIGHT,
  WA_FLOATING_CTA_ICON_SIZE,
  WA_FLOATING_CTA_LABEL_GAP,
  WA_FLOATING_CTA_PADDING_H,
  WA_FLOATING_SHADOW,
  WA_TYPE_ROW_TITLE,
  WA_WEIGHT_SEMIBOLD,
  WA_DEFAULT_ACCENT,
  waFloatingCtaBottomOffset,
} from './metrics';

export interface WaFloatingCtaProps {
  /** Pill label — sentence case, e.g. "Create event" / "Add group". */
  label: string;
  /** Leading Ionicons glyph. Omit for a label-only pill. */
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  /** Brand fill. Falls back to WhatsApp's own green. */
  accent?: string;
  /** `useSafeAreaInsets().bottom` — drives the clearance above the tab island. */
  bottomInset: number;
  /** Defaults to `label`. */
  accessibilityLabel?: string;
  testID?: string;
  /** Extra style for the absolute wrapper (rarely needed). */
  style?: StyleProp<ViewStyle>;
}

export function WaFloatingCta({
  label,
  icon,
  onPress,
  accent = WA_DEFAULT_ACCENT,
  bottomInset,
  accessibilityLabel,
  testID,
  style,
}: WaFloatingCtaProps) {
  return (
    <View
      style={[styles.wrap, { bottom: waFloatingCtaBottomOffset(bottomInset) }, style]}
      pointerEvents="box-none"
      testID={testID ? `${testID}-wrap` : undefined}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        testID={testID}
        style={({ pressed }) => [
          styles.pill,
          WA_FLOATING_SHADOW,
          { backgroundColor: accent },
          pressed && styles.pressed,
        ]}
      >
        {icon ? <Ionicons name={icon} size={WA_FLOATING_CTA_ICON_SIZE} color="#FFFFFF" /> : null}
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: WA_FLOATING_CTA_LABEL_GAP,
    height: WA_FLOATING_CTA_HEIGHT,
    borderRadius: WA_FLOATING_CTA_HEIGHT / 2,
    paddingHorizontal: WA_FLOATING_CTA_PADDING_H,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    color: '#FFFFFF',
  },
});
