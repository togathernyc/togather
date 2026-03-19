/**
 * ImageAttachmentsGrid - WhatsApp-style image grid for chat messages
 *
 * Layout rules:
 * - 1 image: Full width (250x200)
 * - 2 images: Side by side (123x123 each)
 * - 3 images: 2 on top, 1 spanning bottom
 * - 4+ images: 2x2 grid, 4th image has "+N" overlay if more
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { AppImage } from '@components/ui';
import { getMediaUrl } from '@/utils/media';
import { useTheme } from '@hooks/useTheme';

interface ImageAttachment {
  url: string;
  name?: string;
}

interface ImageAttachmentsGridProps {
  images: ImageAttachment[];
  onImagePress: (index: number) => void;
  maxWidth?: number;
}

// Grid constants
const GRID_GAP = 4;
const BORDER_RADIUS = 8;
const MAX_GRID_WIDTH = 250;

// Single image dimensions
const SINGLE_WIDTH = MAX_GRID_WIDTH;
const SINGLE_HEIGHT = 200;

// Cell size for 2+ images (accounting for gap)
const CELL_SIZE = Math.floor((MAX_GRID_WIDTH - GRID_GAP) / 2);

export function ImageAttachmentsGrid({
  images,
  onImagePress,
  maxWidth = MAX_GRID_WIDTH,
}: ImageAttachmentsGridProps) {
  const { colors, isDark } = useTheme();

  if (!images || images.length === 0) {
    return null;
  }

  const count = images.length;
  const displayImages = images.slice(0, 4);
  const extraCount = count > 4 ? count - 4 : 0;
  const placeholderBg = isDark ? colors.surfaceSecondary : '#f0f0f0';

  // Single image - full width
  if (count === 1) {
    return (
      <Pressable onPress={() => onImagePress(0)}>
        <AppImage
          source={getMediaUrl(images[0].url)}
          style={[styles.singleImage, { maxWidth }]}
          resizeMode="cover"
          optimizedWidth={400}
          placeholder={{
            type: 'icon',
            icon: 'image-outline',
            backgroundColor: placeholderBg,
          }}
        />
      </Pressable>
    );
  }

  // Two images - side by side
  if (count === 2) {
    return (
      <View style={[styles.row, { maxWidth }]}>
        {displayImages.map((image, index) => (
          <Pressable key={index} onPress={() => onImagePress(index)}>
            <AppImage
              source={getMediaUrl(image.url)}
              style={styles.cellImage}
              resizeMode="cover"
              optimizedWidth={300}
              placeholder={{
                type: 'icon',
                icon: 'image-outline',
                backgroundColor: placeholderBg,
              }}
            />
          </Pressable>
        ))}
      </View>
    );
  }

  // Three images - 2 on top, 1 spanning bottom
  if (count === 3) {
    return (
      <View style={[styles.gridContainer, { maxWidth }]}>
        <View style={styles.row}>
          {displayImages.slice(0, 2).map((image, index) => (
            <Pressable key={index} onPress={() => onImagePress(index)}>
              <AppImage
                source={getMediaUrl(image.url)}
                style={styles.cellImage}
                resizeMode="cover"
                optimizedWidth={300}
                placeholder={{
                  type: 'icon',
                  icon: 'image-outline',
                  backgroundColor: placeholderBg,
                }}
              />
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => onImagePress(2)}>
          <AppImage
            source={getMediaUrl(images[2].url)}
            style={styles.bottomSpanImage}
            resizeMode="cover"
            optimizedWidth={400}
            placeholder={{
              type: 'icon',
              icon: 'image-outline',
              backgroundColor: placeholderBg,
            }}
          />
        </Pressable>
      </View>
    );
  }

  // 4+ images - 2x2 grid with optional "+N" overlay
  return (
    <View style={[styles.gridContainer, { maxWidth }]}>
      <View style={styles.row}>
        {displayImages.slice(0, 2).map((image, index) => (
          <Pressable key={index} onPress={() => onImagePress(index)}>
            <AppImage
              source={getMediaUrl(image.url)}
              style={styles.cellImage}
              resizeMode="cover"
              optimizedWidth={300}
              placeholder={{
                type: 'icon',
                icon: 'image-outline',
                backgroundColor: placeholderBg,
              }}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Pressable onPress={() => onImagePress(2)}>
          <AppImage
            source={getMediaUrl(displayImages[2].url)}
            style={styles.cellImage}
            resizeMode="cover"
            optimizedWidth={300}
            placeholder={{
              type: 'icon',
              icon: 'image-outline',
              backgroundColor: placeholderBg,
            }}
          />
        </Pressable>
        <Pressable onPress={() => onImagePress(3)}>
          <View>
            <AppImage
              source={getMediaUrl(displayImages[3].url)}
              style={styles.cellImage}
              resizeMode="cover"
              optimizedWidth={300}
              placeholder={{
                type: 'icon',
                icon: 'image-outline',
                backgroundColor: placeholderBg,
              }}
            />
            {extraCount > 0 && (
              <View style={styles.overlay}>
                <Text style={styles.overlayText}>+{extraCount}</Text>
              </View>
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  gridContainer: {
    gap: GRID_GAP,
  },
  row: {
    flexDirection: 'row',
    gap: GRID_GAP,
  },
  singleImage: {
    width: SINGLE_WIDTH,
    height: SINGLE_HEIGHT,
    borderRadius: BORDER_RADIUS,
  },
  cellImage: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: BORDER_RADIUS,
  },
  bottomSpanImage: {
    width: MAX_GRID_WIDTH,
    height: CELL_SIZE,
    borderRadius: BORDER_RADIUS,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: BORDER_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
});
