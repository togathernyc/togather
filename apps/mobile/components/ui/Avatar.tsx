import React, { useMemo } from 'react';
import { StyleSheet, ImageStyle, StyleProp } from 'react-native';
import { AppImage } from './AppImage';
import { getMediaUrlWithTransform } from '@/utils/media';

interface AvatarProps {
  name?: string;
  /** Single image URL or r2: storage path */
  imageUrl?: string | null;
  size?: number;
  style?: StyleProp<ImageStyle>;
  /** Disable image optimization (for debugging) */
  disableOptimization?: boolean;
}

export function Avatar({
  name,
  imageUrl,
  size = 48,
  style,
  disableOptimization = false,
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

  return (
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
      }}
    />
  );
}

const styles = StyleSheet.create({
  avatar: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
