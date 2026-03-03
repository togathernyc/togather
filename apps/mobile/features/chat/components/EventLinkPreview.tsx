/**
 * EventLinkPreview - Compact event preview for composer
 *
 * Shows inline card preview when event link is detected in composer.
 * Displays event title, date, and small image thumbnail with dismiss button.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import { useQuery, api } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import { AppImage } from '@components/ui/AppImage';
import { DEFAULT_PRIMARY_COLOR } from '@utils/styles';

interface EventLinkPreviewProps {
  shortId: string;
  onDismiss: () => void;
}

export function EventLinkPreview({ shortId, onDismiss }: EventLinkPreviewProps) {
  const [imageHeight, setImageHeight] = useState<number | undefined>(undefined);
  const { token } = useAuth();

  // Fetch event by short ID using Convex
  const eventData = useQuery(api.functions.meetings.index.getByShortId, token ? { shortId, token } : { shortId });
  const isLoading = eventData === undefined;
  const error = eventData === null;

  // Normalize the event data to a common structure
  const event = React.useMemo(() => {
    if (!eventData) return null;

    // Cast to access the full properties (they exist when hasAccess is true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = eventData as any;
    return {
      id: data.id,
      shortId: data.shortId,
      title: data.title,
      scheduledAt: data.scheduledAt,
      coverImage: data.coverImage as string | null,
      displayCoverImage: data.coverImage as string | null,
      hasAccess: data.hasAccess,
    };
  }, [eventData]);

  // Calculate image height to preserve aspect ratio
  useEffect(() => {
    const imageUrl = event?.displayCoverImage;
    if (imageUrl) {
      const isNetworkUrl = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');

      if (!isNetworkUrl) {
        setImageHeight(undefined);
        return;
      }

      Image.getSize(
        imageUrl,
        (width, height) => {
          const containerWidth = 80; // Small thumbnail size
          const ratio = height / width;
          setImageHeight(containerWidth * ratio);
        },
        () => {
          setImageHeight(undefined);
        }
      );
    } else {
      setImageHeight(undefined);
    }
  }, [event?.displayCoverImage]);

  // Format date
  const formatEventDate = (dateString: string | undefined): string => {
    if (!dateString) return '';
    try {
      const date = parseISO(dateString);
      return format(date, "MMM d 'at' h:mm a");
    } catch {
      return dateString;
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={DEFAULT_PRIMARY_COLOR} />
          <Text style={styles.loadingText}>Loading preview...</Text>
        </View>
        <TouchableOpacity onPress={onDismiss} style={styles.dismissButton}>
          <Ionicons name="close" size={20} color="#666" />
        </TouchableOpacity>
      </View>
    );
  }

  // Error state or no event - hide the preview
  if (error || !event) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Event thumbnail */}
      {event.displayCoverImage ? (
        <AppImage
          source={event.coverImage}
          style={[styles.thumbnail, imageHeight ? { height: imageHeight } : {}]}
          resizeMode="cover"
          placeholder={{ type: 'icon', icon: 'calendar-outline', iconSize: 32, iconColor: '#ccc' }}
        />
      ) : (
        <View style={styles.thumbnailPlaceholder}>
          <Ionicons name="calendar" size={32} color="#ccc" />
        </View>
      )}

      {/* Event info */}
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {event.title || 'Event'}
        </Text>
        <Text style={styles.eventDate} numberOfLines={1}>
          {formatEventDate(event.scheduledAt)}
        </Text>
      </View>

      {/* Dismiss button */}
      <TouchableOpacity onPress={onDismiss} style={styles.dismissButton}>
        <Ionicons name="close" size={20} color="#666" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    padding: 8,
    marginHorizontal: 8,
    marginBottom: 8,
    gap: 12,
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
  },
  thumbnailPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  eventInfo: {
    flex: 1,
    gap: 4,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  eventDate: {
    fontSize: 12,
    color: '#666',
  },
  dismissButton: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
  },
});
