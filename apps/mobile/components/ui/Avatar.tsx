import React, { useMemo } from 'react';
import { StyleSheet, View, ImageStyle, StyleProp } from 'react-native';
import { AppImage } from './AppImage';
import { NotificationsDisabledBadge } from './NotificationsDisabledBadge';
import { getMediaUrlWithTransform } from '@/utils/media';

interface AvatarProps {
  name?: string;
  /** Single image URL or r2: storage path */
  imageUrl?: string | null;
  size?: number;
  style?: StyleProp<ImageStyle>;
  /** Disable image optimization (for debugging) */
  disableOptimization?: boolean;
  /** Background color for the initials placeholder. Defaults to a hashed
   *  color tied to the name. Pass a flat color (e.g. theme `border`) for
   *  contexts that want a neutral preview row. */
  placeholderBackgroundColor?: string;
  /**
   * When true, overlays a slashed-bell badge in the bottom-right corner to
   * signal that this user has push notifications disabled (no push tokens
   * for the current environment). Senders use this to set expectations
   * before sending a message.
   */
  notificationsDisabled?: boolean;
  /**
   * Surface color the avatar sits on, passed through to the badge so its
   * contrast border blends with the row/card background. Falls back to the
   * theme `surface` when omitted.
   */
  notificationsBadgeRingColor?: string;
}

export function Avatar({
  name,
  imageUrl,
  size = 48,
  style,
  disableOptimization = false,
  placeholderBackgroundColor,
  notificationsDisabled,
  notificationsBadgeRingColor,
}: AvatarProps) {
  const safeSize = size && size > 0 ? size : 48;

  // Request 2x size for retina displays, capped at 400px
  const optimizedUrl = useMemo(() => {
    if (!imageUrl || disableOptimization) return imageUrl;

    const requestSize = Math.min(safeSize * 2, 400);
    return getMediaUrlWithTransform(imageUrl, {
      width: requestSize,
      height: requestSize,
      fit: 'cover',
    });
  }, [imageUrl, safeSize, disableOptimization]);

  const image = (
    <AppImage
      source={optimizedUrl}
      style={[
        styles.avatar,
        { width: safeSize, height: safeSize, borderRadius: safeSize / 2 },
        style,
      ]}
      placeholder={{
        type: 'initials',
        name: name,
        ...(placeholderBackgroundColor ? { backgroundColor: placeholderBackgroundColor } : {}),
      }}
    />
  );

  if (!notificationsDisabled) {
    return image;
  }

  // Wrap so the badge can be absolutely positioned over the avatar's corner.
  return (
    <View style={[styles.wrapper, { width: safeSize, height: safeSize }]}>
      {image}
      <NotificationsDisabledBadge
        avatarSize={safeSize}
        ringColor={notificationsBadgeRingColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
