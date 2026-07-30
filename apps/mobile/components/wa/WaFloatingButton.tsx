/**
 * WaFloatingButton — the 44pt circular button that current WhatsApp iOS floats
 * over its scrolling content instead of docking into a nav bar.
 *
 * WA-VISUAL-DELTAS.md S1.1: "No opaque nav bars on any WA screen. Top-level
 * screens: floating white circular buttons (44px, subtle shadow) over the
 * scrolling content." Two variants only:
 *
 *   - `plain` (default) — white/`surface` fill, black line glyph. Every circle
 *     in the app chrome is this one, including the back button on sub-screens
 *     and the community-avatar divergence on Chats (pass the avatar as
 *     `children` instead of an `icon`).
 *   - `accent` — solid brand fill, white glyph. Reserved for the Chats compose
 *     "+", the ONLY green circle in the chrome (S5.1).
 *
 * Presentational: reads `useTheme()` for the neutral fill/ink; the accent hex
 * is an explicit prop so the component never reaches for `useCommunityTheme()`.
 */
import React from 'react';
import { View, Pressable, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@hooks/useTheme';
import {
  WA_HEADER_CIRCLE_SIZE,
  WA_HEADER_ICON_SIZE,
  WA_FLOATING_SHADOW,
  WA_DEFAULT_ACCENT,
} from './metrics';

export type WaFloatingButtonVariant = 'plain' | 'accent';

export interface WaFloatingButtonProps {
  /** Ionicons glyph name. Omit and pass `children` for an image-filled circle (avatars). */
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  /** `accent` = the one solid-brand circle per screen (Chats compose). Default `plain`. */
  variant?: WaFloatingButtonVariant;
  /** Brand fill for `variant="accent"`. Falls back to WhatsApp's own green. */
  accent?: string;
  /** Diameter. Default 44 (`WA_HEADER_CIRCLE_SIZE`). */
  size?: number;
  /** Glyph size. Defaults to `WA_HEADER_ICON_SIZE`, scaled if `size` is overridden. */
  iconSize?: number;
  accessibilityLabel?: string;
  /** For toggle-style circles (List/Map): exposes `accessibilityState={{selected}}`. */
  selected?: boolean;
  /** Content rendered instead of `icon` — e.g. an `<Avatar />`. Clipped to the circle. */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function WaFloatingButton({
  icon,
  onPress,
  variant = 'plain',
  accent = WA_DEFAULT_ACCENT,
  size = WA_HEADER_CIRCLE_SIZE,
  iconSize,
  accessibilityLabel,
  selected,
  children,
  style,
}: WaFloatingButtonProps) {
  const { colors } = useTheme();
  const isAccent = variant === 'accent';
  const glyphSize =
    iconSize ?? Math.round(WA_HEADER_ICON_SIZE * (size / WA_HEADER_CIRCLE_SIZE));

  // Two layers on purpose: the outer one carries the shadow (iOS drops a
  // shadow entirely when the same view sets `overflow: hidden`), the inner
  // one clips avatar children to the circle.
  const circle: StyleProp<ViewStyle> = [
    WA_FLOATING_SHADOW,
    {
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: isAccent ? accent : colors.surface,
    },
    style,
  ];

  const content = (
    <View style={[styles.clip, { borderRadius: size / 2 }]}>
      {children ??
        (icon ? (
          <Ionicons name={icon} size={glyphSize} color={isAccent ? '#FFFFFF' : colors.text} />
        ) : null)}
    </View>
  );

  if (!onPress) {
    return <View style={circle}>{content}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={8}
      style={({ pressed }) => [circle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  clip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.7,
  },
});
