import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/hooks/useTheme';

/**
 * The birthday accent — deliberately the same in light and dark.
 *
 * A celebration doesn't change meaning in the dark, and white-on-rose clears
 * 4.6:1 on either ground. It is also kept clear of the palette's existing
 * meanings: brand green is "leader", grey is "muted", red is "destructive".
 */
export const BIRTHDAY_COLOR = '#D6336C';

interface BirthdayBadgeProps {
  /**
   * Diameter of the parent avatar in pixels. The badge scales relative to it
   * so the gift stays legible on tiny stacked previews and on the large
   * profile-header avatar.
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
  testID?: string;
}

/**
 * Gift badge overlaid on a user avatar on their birthday. Renders nothing
 * visual on its own — callsites mount it inside a `position: relative` parent
 * (typically an Avatar) so it sits over the corner of the avatar.
 *
 * Sits in the **top-right** corner, unlike `NotificationsDisabledBadge` and the
 * inbox's leader shield, which both own the bottom-right. Someone can be a
 * leader with notifications off on their birthday, so the corners can't clash.
 *
 * The gift glyph matches how Togather already talks about birthdays — it's the
 * same icon the profile's details card uses for the date itself.
 *
 * Sizing mirrors `NotificationsDisabledBadge` exactly, so when both badges are
 * on one avatar they are the same size.
 */
export function BirthdayBadge({
  avatarSize,
  style,
  ringColor,
  testID = 'birthday-badge',
}: BirthdayBadgeProps) {
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
      testID={testID}
      style={[
        styles.badge,
        {
          width: sizes.badge,
          height: sizes.badge,
          borderRadius: sizes.badge / 2,
          backgroundColor: BIRTHDAY_COLOR,
          borderColor: ringColor ?? colors.surface,
          borderWidth: sizes.border,
        },
        style,
      ]}
    >
      <Ionicons name="gift" size={sizes.icon} color="#FFFFFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
