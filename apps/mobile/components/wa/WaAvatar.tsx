/**
 * WaAvatar — the list-row avatar: a photo when there is one, a **muted
 * per-entity pastel disc with same-hue initials** when there isn't
 * (WA-VISUAL-DELTAS.md S5.2), in either of the system's two shapes —
 * `circle` for people and plain chats, `squircle` for community-level
 * entities and group parents (S6.4).
 *
 * Why not `AppImage`'s / `Avatar`'s built-in initials placeholder: that one
 * hashes to a 5-color palette that is 2/5 brand green and always paints the
 * initials **white**, which is unreadable on a pastel fill. So the fallback is
 * rendered here via `AppImage`'s `custom` placeholder slot, with colors from
 * `waAvatarColor.ts`.
 *
 * Presentational only; reads `useTheme()` for light/dark, takes everything
 * else as props.
 */
import React from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { AppImage } from '@components/ui/AppImage';
import { NotificationsDisabledBadge } from '@components/ui/NotificationsDisabledBadge';
import { useTheme } from '@hooks/useTheme';
import { waAvatarPalette, waAvatarInitials } from './waAvatarColor';

/** Squircle corner radius as a fraction of the avatar's size (S6.4: "~40%"). */
export const WA_AVATAR_SQUIRCLE_RATIO = 0.38;

export interface WaAvatarProps {
  /** Photo URL or `r2:` storage path. Falls back to the pastel initials disc. */
  imageUrl?: string | null;
  /** Display name — the source of the fallback initials. */
  label: string;
  /**
   * Stable identity the fallback hue is derived from. Prefer a Convex id, so
   * a rename doesn't re-color the avatar. Defaults to `label`.
   */
  seed?: string;
  /** `circle` for people/plain chats; `squircle` for communities/group parents (S6.4). */
  shape?: 'circle' | 'squircle';
  size: number;
  /** Slashed-bell overlay for a user with push disabled (mirrors `Avatar`). */
  notificationsDisabled?: boolean;
  /** Surface the avatar sits on, so the badge's contrast ring blends in. */
  notificationsBadgeRingColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function WaAvatar({
  imageUrl,
  label,
  seed,
  shape = 'circle',
  size,
  notificationsDisabled,
  notificationsBadgeRingColor,
  style,
  testID,
}: WaAvatarProps) {
  const { isDark } = useTheme();
  const palette = waAvatarPalette(seed ?? label, isDark);
  const radius = shape === 'squircle' ? size * WA_AVATAR_SQUIRCLE_RATIO : size / 2;

  const image = (
    <AppImage
      source={imageUrl}
      style={[{ width: size, height: size, borderRadius: radius }, style as any]}
      optimizedWidth={Math.min(size * 2, 400)}
      testID={testID}
      placeholder={{
        type: 'custom',
        backgroundColor: palette.background,
        render: () => (
          <Text
            style={[
              styles.initials,
              { color: palette.foreground, fontSize: Math.round(size * 0.38) },
            ]}
            numberOfLines={1}
          >
            {waAvatarInitials(label)}
          </Text>
        ),
      }}
    />
  );

  if (!notificationsDisabled) return image;

  return (
    <View style={{ width: size, height: size }}>
      {image}
      <NotificationsDisabledBadge avatarSize={size} ringColor={notificationsBadgeRingColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  initials: {
    fontWeight: '600',
  },
});
