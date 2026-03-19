/**
 * FileAttachment - Render document attachments in chat messages
 *
 * Displays file icon, name, and a download/open button.
 * Handles opening files via the system file handler.
 */
import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getFileIcon,
  getFileCategoryFromFilename,
  type FileCategory,
} from '../utils/fileTypes';
import { getMediaUrl } from '@/utils/media';
import { useTheme } from '@hooks/useTheme';

// ============================================================================
// Types
// ============================================================================

interface FileAttachmentProps {
  /** The storage path or URL of the file */
  url: string;
  /** The file name */
  name?: string;
  /** Whether this appears in the sender's own message */
  isOwnMessage?: boolean;
}

// ============================================================================
// Category Colors (branded, kept as-is)
// ============================================================================

const CATEGORY_COLORS: Record<FileCategory, string> = {
  document: '#4285F4', // Blue
  audio: '#9C27B0',    // Purple
  video: '#F44336',    // Red
  image: '#4CAF50',    // Green
  unknown: '#757575',  // Gray
};

// ============================================================================
// Component
// ============================================================================

export function FileAttachment({
  url,
  name,
  isOwnMessage = false,
}: FileAttachmentProps) {
  const { colors, isDark } = useTheme();

  // Resolve the URL from storage path
  const resolvedUrl = getMediaUrl(url);

  // Extract filename from URL if not provided
  const fileName = name || url.split('/').pop()?.split('?')[0] || 'File';

  // Get file info
  const category = getFileCategoryFromFilename(fileName);
  const iconName = getFileIcon(fileName) as any;
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.unknown;

  // Truncate long filenames
  const displayName = fileName.length > 25
    ? fileName.slice(0, 12) + '...' + fileName.slice(-10)
    : fileName;

  const handlePress = useCallback(async () => {
    if (!resolvedUrl) {
      Alert.alert('Error', 'Unable to open file. Please try again.');
      return;
    }

    try {
      const canOpen = await Linking.canOpenURL(resolvedUrl);
      if (canOpen) {
        await Linking.openURL(resolvedUrl);
      } else {
        Alert.alert(
          'Cannot Open File',
          'Your device cannot open this file type. The file will be downloaded in your browser.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open in Browser', onPress: () => Linking.openURL(resolvedUrl) },
          ]
        );
      }
    } catch (error) {
      console.error('[FileAttachment] Error opening file:', error);
      Alert.alert('Error', 'Failed to open file. Please try again.');
    }
  }, [resolvedUrl]);

  return (
    <Pressable style={[styles.container, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' }]} onPress={handlePress}>
      {/* File Icon */}
      <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={iconName} size={20} color={color} />
      </View>

      {/* File Info */}
      <View style={styles.infoContainer}>
        <Text
          style={[styles.fileName, { color: colors.text }]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <Text style={[styles.fileType, { color: colors.textSecondary }]}>
          Tap to open
        </Text>
      </View>

      {/* Download Icon */}
      <View style={styles.downloadIcon}>
        <Ionicons
          name="download-outline"
          size={20}
          color={colors.textTertiary}
        />
      </View>
    </Pressable>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    minWidth: 180,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  infoContainer: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  fileType: {
    fontSize: 11,
  },
  downloadIcon: {
    padding: 4,
  },
});
