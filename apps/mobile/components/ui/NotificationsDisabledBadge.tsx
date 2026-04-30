import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';

interface NotificationsDisabledBadgeProps {
  /**
   * Diameter of the parent avatar in pixels. The badge scales relative to it
   * so the slashed-bell stays legible on tiny stacked previews and on the
   * large profile-header avatar.
   */
  avatarSize: number;
  /**
   * Optional style override — used to position the badge against a parent
   * container.
   */
  style?: StyleProp<ViewStyle>;
  /**
   * Color used for the badge ring/contrast border. Defaults to
   * `theme.surface`. Pass the actual surface the avatar sits on so the badge
   * reads as an overlay rather than a free-floating dot.
   */
  ringColor?: string;
}

/**
 * Slashed-bell badge overlaid on a user avatar to signal that the user has
 * push notifications disabled. Renders nothing visual on its own — callsites
 * mount it inside a `position: relative` parent (typically Avatar) so it sits
 * over the bottom-right corner of the avatar.
 *
 * Sizing: badge diameter ~38% of the avatar (clamped to 14–24px). Icon takes
 * ~62% of the badge so the slash is visible at small sizes.
 */
export function NotificationsDisabledBadge({
  avatarSize,
  style,
  ringColor,
}: NotificationsDisabledBadgeProps) {
  const { colors } = useTheme();
  const sizes = useMemo(() => {
    const raw = Math.round(avatarSize * 0.42);
    const badge = Math.max(11, Math.min(raw, 26));
    const icon = Math.max(7, Math.round(badge * 0.65));
    const border = badge >= 18 ? 1.5 : 1;
    return { badge, icon, border };
  }, [avatarSize]);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.badge,
        {
          width: sizes.badge,
          height: sizes.badge,
          borderRadius: sizes.badge / 2,
          backgroundColor: colors.textSecondary,
          borderColor: ringColor ?? colors.surface,
          borderWidth: sizes.border,
        },
        style,
      ]}
    >
      <Ionicons
        name="notifications-off"
        size={sizes.icon}
        color={colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
