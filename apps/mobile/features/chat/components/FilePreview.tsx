/**
 * FilePreview - Preview component for file attachments before sending
 *
 * Shows file icon, name, size, and remove button.
 * Used in MessageInput when a file is selected but not yet sent.
 */
import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getFileIcon, formatFileSize, type FileCategory } from '../utils/fileTypes';

// ============================================================================
// Types
// ============================================================================

interface FilePreviewProps {
  /** File name */
  name: string;
  /** File size in bytes */
  size: number;
  /** File category */
  category: FileCategory;
  /** Whether the file is currently uploading */
  uploading?: boolean;
  /** Upload progress (0-100) */
  progress?: number;
  /** Called when remove button is pressed */
  onRemove?: () => void;
  /** Disable the remove button */
  disabled?: boolean;
}

// ============================================================================
// Category Colors
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

export function FilePreview({
  name,
  size,
  category,
  uploading = false,
  progress = 0,
  onRemove,
  disabled = false,
}: FilePreviewProps) {
  const iconName = getFileIcon(name) as any;
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.unknown;

  // Truncate long filenames
  const displayName = name.length > 30
    ? name.slice(0, 15) + '...' + name.slice(-12)
    : name;

  return (
    <View style={styles.container}>
      {/* File Icon */}
      <View style={[styles.iconContainer, { backgroundColor: color + '20' }]}>
        <Ionicons name={iconName} size={24} color={color} />
      </View>

      {/* File Info */}
      <View style={styles.infoContainer}>
        <Text style={styles.fileName} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={styles.fileSize}>
          {uploading ? `Uploading... ${Math.round(progress)}%` : formatFileSize(size)}
        </Text>
      </View>

      {/* Upload Progress Indicator */}
      {uploading && (
        <View style={styles.progressContainer}>
          <ActivityIndicator size="small" color={color} />
        </View>
      )}

      {/* Remove Button */}
      {!uploading && onRemove && (
        <Pressable
          style={styles.removeButton}
          onPress={onRemove}
          disabled={disabled}
          hitSlop={8}
        >
          <Ionicons
            name="close-circle"
            size={24}
            color={disabled ? '#ccc' : '#666'}
          />
        </Pressable>
      )}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoContainer: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  fileSize: {
    fontSize: 12,
    color: '#666',
  },
  progressContainer: {
    marginRight: 8,
  },
  removeButton: {
    padding: 4,
  },
});
