/**
 * NotificationPreview - iOS-style notification banner preview
 *
 * A visual component that renders a notification preview similar to
 * how iOS displays notification banners. Useful for previewing
 * notifications before sending them.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface NotificationPreviewProps {
  /** Notification title (displayed in bold) */
  title: string;
  /** Notification body text */
  body: string;
  /** Callback when preview is tapped */
  onPress?: () => void;
  /** Optional app name override (defaults to "Togather") */
  appName?: string;
}

export function NotificationPreview({
  title,
  body,
  onPress,
  appName = 'Togather',
}: NotificationPreviewProps) {
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.9}
      disabled={!onPress}
    >
      <View style={styles.content}>
        {/* App Icon */}
        <View style={styles.iconContainer}>
          <Ionicons name="people" size={24} color="#fff" />
        </View>

        {/* Notification Content */}
        <View style={styles.textContainer}>
          {/* Header Row: App Name + Timestamp */}
          <View style={styles.headerRow}>
            <Text style={styles.appName}>{appName}</Text>
            <Text style={styles.timestamp}>now</Text>
          </View>

          {/* Title */}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          {/* Body */}
          <Text style={styles.body} numberOfLines={2}>
            {body}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f2f2f7',
    borderRadius: 20,
    marginHorizontal: 8,
    marginVertical: 4,
    ...Platform.select({
      web: {
        boxShadow: '0px 4px 16px rgba(0, 0, 0, 0.15)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 5,
      },
    }),
  },
  content: {
    flexDirection: 'row',
    padding: 12,
    alignItems: 'flex-start',
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  appName: {
    fontSize: 13,
    color: '#8e8e93',
    fontWeight: '500',
  },
  timestamp: {
    fontSize: 12,
    color: '#8e8e93',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
    marginBottom: 2,
  },
  body: {
    fontSize: 15,
    color: '#3c3c43',
    lineHeight: 20,
  },
});

export default NotificationPreview;
