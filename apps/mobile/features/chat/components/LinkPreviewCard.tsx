/**
 * LinkPreviewCard - External link preview card for chat messages
 *
 * Displays Open Graph metadata for external URLs with image, title, and description.
 * Similar style to EventLinkCard for visual consistency.
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppImage } from '@components/ui/AppImage';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';
import { useTheme } from '@hooks/useTheme';
import type { LinkPreviewData } from '../hooks/useLinkPreview';

// ============================================================================
// Types
// ============================================================================

interface LinkPreviewCardProps {
  /** The preview data to display */
  preview: LinkPreviewData;
  /** Whether this card appears in the sender's own message */
  isMyMessage?: boolean;
  /** When true, removes self-alignment and margins (for use inside MessageItem) */
  embedded?: boolean;
  /** Show dismiss button (for composer preview) */
  showDismiss?: boolean;
  /** Called when dismiss button is pressed */
  onDismiss?: () => void;
  /** Show loading indicator */
  loading?: boolean;
  /** Compact mode - hides image and description for smaller footprint */
  compact?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function LinkPreviewCard({
  preview,
  isMyMessage = true,
  embedded = false,
  showDismiss = false,
  onDismiss,
  loading = false,
  compact = false,
}: LinkPreviewCardProps) {
  const { colors, isDark } = useTheme();

  const handlePress = useCallback(() => {
    if (preview.url) {
      Linking.openURL(preview.url).catch((err) => {
        console.error('[LinkPreviewCard] Failed to open URL:', err);
      });
    }
  }, [preview.url]);

  const handleDismiss = useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

  // Extract hostname for display
  const hostname = React.useMemo(() => {
    try {
      const url = new URL(preview.url);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return preview.siteName || '';
    }
  }, [preview.url, preview.siteName]);

  const placeholderBg = isDark ? colors.surfaceSecondary : '#f0f0f0';
  const skeletonBg = isDark ? colors.surfaceSecondary : '#E5E5E5';

  if (loading) {
    // Compact mode: minimal loading indicator (already correct size)
    if (compact) {
      return (
        <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }, !isMyMessage && styles.containerLeft, embedded && styles.containerEmbedded, styles.containerCompact]}>
          <View style={[styles.loadingContainer, styles.loadingContainerCompact]}>
            <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading...</Text>
          </View>
        </View>
      );
    }

    // Full mode: skeleton placeholder that reserves space for the final preview
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }, !isMyMessage && styles.containerLeft, embedded && styles.containerEmbedded]}>
        {/* Image skeleton */}
        <View style={[styles.skeletonImage, { backgroundColor: skeletonBg }]} />

        {/* Content skeleton */}
        <View style={styles.content}>
          {/* Site name skeleton */}
          <View style={styles.siteRow}>
            <View style={[styles.skeletonFavicon, { backgroundColor: skeletonBg }]} />
            <View style={[styles.skeletonSiteName, { backgroundColor: skeletonBg }]} />
          </View>

          {/* Title skeleton (2 lines) */}
          <View style={[styles.skeletonTitleLine1, { backgroundColor: skeletonBg }]} />
          <View style={[styles.skeletonTitleLine2, { backgroundColor: skeletonBg }]} />

        </View>
      </View>
    );
  }

  // Compact mode: single row with favicon, title, and dismiss button
  if (compact) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.surface, borderColor: colors.border },
          !isMyMessage && styles.containerLeft,
          embedded && styles.containerEmbedded,
          styles.containerCompact,
        ]}
      >
        <Pressable style={styles.compactRow} onPress={handlePress}>
          {preview.favicon && (
            <AppImage
              source={preview.favicon}
              style={styles.favicon}
              resizeMode="contain"
              placeholder={{ type: 'color', backgroundColor: placeholderBg }}
            />
          )}
          <View style={styles.compactContent}>
            <Text style={[styles.compactTitle, { color: colors.text }]} numberOfLines={1}>
              {preview.title || hostname}
            </Text>
          </View>
        </Pressable>
        {showDismiss && (
          <Pressable style={styles.compactDismissButton} onPress={handleDismiss} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <Pressable
      style={[
        styles.container,
        { backgroundColor: colors.surface, borderColor: colors.border },
        !isMyMessage && styles.containerLeft,
        embedded && styles.containerEmbedded,
      ]}
      onPress={handlePress}
    >
      {/* Dismiss button */}
      {showDismiss && (
        <Pressable style={[styles.dismissButton, { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.9)' }]} onPress={handleDismiss} hitSlop={8}>
          <Ionicons name="close-circle" size={24} color={colors.textSecondary} />
        </Pressable>
      )}

      {/* Image - only render when an image is available */}
      {preview.image && (
        <View style={[styles.imageContainer, { backgroundColor: colors.surfaceSecondary }]}>
          <AppImage
            source={preview.image}
            style={styles.image}
            resizeMode="cover"
            placeholder={{ type: 'color', backgroundColor: placeholderBg }}
          />
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        {/* Site name / hostname */}
        <View style={styles.siteRow}>
          {preview.favicon && (
            <AppImage
              source={preview.favicon}
              style={styles.favicon}
              resizeMode="contain"
              placeholder={{ type: 'color', backgroundColor: placeholderBg }}
            />
          )}
          <Text style={[styles.siteName, { color: colors.textSecondary }]} numberOfLines={1}>
            {preview.siteName || hostname}
          </Text>
        </View>

        {/* Title */}
        {preview.title && (
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {preview.title}
          </Text>
        )}

      </View>
    </Pressable>
  );
}

// ============================================================================
// Styles
// ============================================================================

const CARD_MAX_WIDTH = Dimensions.get('window').width * 0.8;

const styles = StyleSheet.create({
  container: {
    maxWidth: CARD_MAX_WIDTH,
    alignSelf: 'flex-end',
    marginVertical: 4,
    marginRight: 4,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
  },
  containerLeft: {
    alignSelf: 'flex-start',
    marginRight: 0,
    marginLeft: 4,
  },
  containerEmbedded: {
    maxWidth: '100%',
    alignSelf: 'stretch',
    marginVertical: 0,
    marginRight: 0,
    marginLeft: 0,
  },
  containerCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 8,
  },
  loadingContainerCompact: {
    paddingVertical: 8,
    justifyContent: 'flex-start',
  },
  loadingText: {
    fontSize: 14,
  },
  compactRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactContent: {
    flex: 1,
    justifyContent: 'center',
  },
  compactTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  compactDismissButton: {
    marginLeft: 8,
    padding: 2,
  },
  dismissButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
    borderRadius: 12,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 1.91, // Standard OG image ratio - fixed height prevents layout shifts
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  content: {
    padding: 12,
    gap: 4,
  },
  siteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  favicon: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  siteName: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  // Skeleton loading styles
  skeletonImage: {
    width: '100%',
    aspectRatio: 1.91, // Match the actual image container ratio
  },
  skeletonFavicon: {
    width: 16,
    height: 16,
    borderRadius: 2,
  },
  skeletonSiteName: {
    width: 80,
    height: 14,
    borderRadius: 2,
  },
  skeletonTitleLine1: {
    width: '100%',
    height: 20,
    borderRadius: 2,
    marginTop: 4,
  },
  skeletonTitleLine2: {
    width: '70%',
    height: 20,
    borderRadius: 2,
    marginTop: 4,
  },
});
