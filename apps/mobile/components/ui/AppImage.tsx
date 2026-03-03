/**
 * AppImage - Centralized image component with error handling and placeholder support
 *
 * Features:
 * - Single URL source
 * - Loading state with optional indicator
 * - Error handling with graceful degradation to placeholder
 * - Supports placeholder content (icon, initials, custom component)
 * - Optional Cloudflare image optimization via optimizedWidth/optimizedHeight
 */
import React, { memo, useState, useCallback, useMemo, ReactNode } from 'react';
import {
  Image,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ImageStyle,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { getMediaUrl, getMediaUrlWithTransform } from '@/utils/media';

type PlaceholderType = 'icon' | 'initials' | 'color' | 'custom';

interface PlaceholderConfig {
  type: PlaceholderType;
  /** Icon name for 'icon' type (Ionicons) */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Icon size (default: 48) */
  iconSize?: number;
  /** Icon color (default: '#ccc') */
  iconColor?: string;
  /** Name to generate initials from for 'initials' type */
  name?: string;
  /** Background color for placeholder */
  backgroundColor?: string;
  /** Custom render function for 'custom' type */
  render?: () => ReactNode;
}

interface AppImageProps {
  /** Single image URL or r2: storage path */
  source: string | null | undefined;
  /** Style for the image/container */
  style?: StyleProp<ImageStyle>;
  /** Resize mode (default: 'cover') */
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  /** Show loading indicator while image loads */
  showLoadingIndicator?: boolean;
  /** Placeholder configuration when no image available or load fails */
  placeholder?: PlaceholderConfig;
  /** Callback when image loads successfully */
  onLoad?: () => void;
  /** Callback when image fails to load */
  onError?: () => void;
  /** Test ID for testing */
  testID?: string;
  /**
   * Request optimized image width via Cloudflare transforms.
   * Tip: Use 2x display size for retina (e.g., 200 for 100px display).
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

/**
 * Get initials from a name
 */
function getInitials(name?: string): string {
  if (!name || typeof name !== 'string') return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(' ').filter((p) => p.length > 0);
  if (parts.length >= 2) {
    const first = parts[0][0] || '?';
    const second = parts[1][0] || '';
    return `${first}${second}`.toUpperCase();
  }
  return trimmed[0]?.toUpperCase() || '?';
}

/**
 * Get deterministic color from name
 */
function getColorFromName(name?: string): string {
  if (!name || typeof name !== 'string') return DEFAULT_PRIMARY_COLOR;
  const trimmed = name.trim();
  if (!trimmed) return DEFAULT_PRIMARY_COLOR;
  const colorPalette = [DEFAULT_PRIMARY_COLOR, DEFAULT_PRIMARY_COLOR, '#0A84FF', '#66D440', '#F56848'];
  const index = trimmed.charCodeAt(0) % colorPalette.length;
  return colorPalette[index];
}

export const AppImage = memo(function AppImage({
  source,
  style,
  resizeMode = 'cover',
  showLoadingIndicator = false,
  placeholder,
  onLoad,
  onError,
  testID,
  optimizedWidth,
  optimizedHeight,
  optimizedQuality,
}: AppImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Apply Cloudflare image transforms if optimization params provided
  const optimizedSource = useMemo(() => {
    if (!source || typeof source !== 'string') return source;
    if (!optimizedWidth && !optimizedHeight) return getMediaUrl(source) ?? source;

    return getMediaUrlWithTransform(source, {
      width: optimizedWidth,
      height: optimizedHeight,
      quality: optimizedQuality ?? 85,
      fit: resizeMode === 'contain' ? 'contain' : 'cover',
    });
  }, [source, optimizedWidth, optimizedHeight, optimizedQuality, resizeMode]);

  const hasValidUrl = optimizedSource && typeof optimizedSource === 'string' && optimizedSource.trim();

  const handleLoadStart = useCallback(() => {
    setIsLoading(true);
  }, []);

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
    onError?.();
  }, [onError]);

  // Extract dimensions from style for placeholder sizing
  const flatStyle = StyleSheet.flatten(style) || {};
  const width = flatStyle.width;
  const height = flatStyle.height;

  // Render placeholder
  const renderPlaceholder = () => {
    if (!placeholder) {
      // Default placeholder - gray background
      return (
        <View
          style={[
            styles.placeholder,
            { backgroundColor: '#f0f0f0' },
            style as ViewStyle,
          ]}
          testID={testID ? `${testID}-placeholder` : undefined}
        />
      );
    }

    const bgColor =
      placeholder.backgroundColor ||
      (placeholder.type === 'initials'
        ? getColorFromName(placeholder.name)
        : '#f0f0f0');

    return (
      <View
        style={[
          styles.placeholder,
          { backgroundColor: bgColor },
          style as ViewStyle,
        ]}
        testID={testID ? `${testID}-placeholder` : undefined}
      >
        {placeholder.type === 'icon' && (
          <Ionicons
            name={placeholder.icon || 'image-outline'}
            size={placeholder.iconSize || 48}
            color={placeholder.iconColor || '#ccc'}
          />
        )}
        {placeholder.type === 'initials' && (
          <Text
            style={[
              styles.initialsText,
              {
                fontSize: Math.min(
                  (typeof width === 'number' ? width : 48) * 0.4,
                  (typeof height === 'number' ? height : 48) * 0.4
                ),
              },
            ]}
          >
            {getInitials(placeholder.name)}
          </Text>
        )}
        {placeholder.type === 'custom' && placeholder.render?.()}
      </View>
    );
  };

  // No valid URL - show placeholder
  if (!hasValidUrl || hasError) {
    return renderPlaceholder();
  }

  return (
    <View style={[style as ViewStyle, styles.imageContainer]}>
      <Image
        source={{ uri: hasValidUrl }}
        style={{ width: '100%', height: '100%' }}
        resizeMode={resizeMode}
        onLoadStart={handleLoadStart}
        onLoad={handleLoad}
        onError={handleError}
        testID={testID}
      />
      {showLoadingIndicator && isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  imageContainer: {
    overflow: 'hidden',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  initialsText: {
    color: '#fff',
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
});
