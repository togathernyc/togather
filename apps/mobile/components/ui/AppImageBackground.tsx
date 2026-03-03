/**
 * AppImageBackground - Centralized ImageBackground component with error handling
 *
 * Features:
 * - Single URL source
 * - Error handling with graceful degradation to placeholder
 * - Supports children rendered on top of the image
 * - Optional Cloudflare image optimization via optimizedWidth/optimizedHeight
 */
import React, { memo, useState, useCallback, useMemo, ReactNode } from 'react';
import {
  ImageBackground,
  View,
  StyleSheet,
  ImageStyle,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { getMediaUrlWithTransform } from '@/utils/media';

interface AppImageBackgroundProps {
  /** Single image URL or r2: storage path */
  source: string | null | undefined;
  /** Style for the container */
  style?: StyleProp<ViewStyle>;
  /** Style for the image itself */
  imageStyle?: StyleProp<ImageStyle>;
  /** Resize mode (default: 'cover') */
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  /** Children to render on top of the image */
  children?: ReactNode;
  /** Callback when image fails to load */
  onError?: () => void;
  /** Test ID for testing */
  testID?: string;
  /**
   * Request optimized image width via Cloudflare transforms.
   * Tip: Use 2x display size for retina (e.g., 800 for 400px display).
   * Only works for R2 images (r2: paths or image CDN URLs).
   */
  optimizedWidth?: number;
  /**
   * Request optimized image height via Cloudflare transforms.
   * If only width is provided, height will be auto-calculated.
   */
  optimizedHeight?: number;
  /**
   * Image quality (1-100) for Cloudflare transforms.
   * Default: 85 when optimization is enabled.
   */
  optimizedQuality?: number;
}

export const AppImageBackground = memo(function AppImageBackground({
  source,
  style,
  imageStyle,
  resizeMode = 'cover',
  children,
  onError,
  testID,
  optimizedWidth,
  optimizedHeight,
  optimizedQuality,
}: AppImageBackgroundProps) {
  const [hasError, setHasError] = useState(false);

  // Apply Cloudflare image transforms if optimization params provided
  const optimizedSource = useMemo(() => {
    if (!source || typeof source !== 'string') return source;
    if (!optimizedWidth && !optimizedHeight) return source;

    return getMediaUrlWithTransform(source, {
      width: optimizedWidth,
      height: optimizedHeight,
      quality: optimizedQuality ?? 85,
      fit: resizeMode === 'contain' ? 'contain' : 'cover',
    });
  }, [source, optimizedWidth, optimizedHeight, optimizedQuality, resizeMode]);

  const hasValidUrl = optimizedSource && typeof optimizedSource === 'string' && optimizedSource.trim();

  const handleError = useCallback(() => {
    setHasError(true);
    onError?.();
  }, [onError]);

  // No valid URL or all failed - show placeholder
  if (!hasValidUrl || hasError) {
    return (
      <View
        style={[styles.placeholder, style]}
        testID={testID ? `${testID}-placeholder` : undefined}
      >
        {children}
      </View>
    );
  }

  return (
    <ImageBackground
      source={{ uri: hasValidUrl as string }}
      style={style}
      imageStyle={imageStyle}
      resizeMode={resizeMode}
      onError={handleError}
      testID={testID}
    >
      {children}
    </ImageBackground>
  );
});

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#f0f0f0',
  },
});
