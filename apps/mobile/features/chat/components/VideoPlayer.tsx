/**
 * VideoPlayer - Inline video player for chat messages
 *
 * Displays a video player with playback controls.
 * Falls back to a download button if expo-av is not available (OTA update scenario).
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isAudioVideoSupported } from '../utils/fileTypes';
import { getMediaUrl } from '@/utils/media';

// ============================================================================
// Types
// ============================================================================

interface VideoPlayerProps {
  /** The storage path or URL of the video file */
  url: string;
  /** The file name */
  name?: string;
  /** Whether this appears in the sender's own message */
  isOwnMessage?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const VIDEO_MAX_WIDTH = Dimensions.get('window').width * 0.65;
const VIDEO_ASPECT_RATIO = 16 / 9;

// ============================================================================
// Fallback Component (when expo-av not available)
// ============================================================================

function VideoDownloadFallback({ url, name, isOwnMessage }: VideoPlayerProps) {
  const resolvedUrl = getMediaUrl(url);
  const fileName = name || url.split('/').pop()?.split('?')[0] || 'Video';

  const displayName = fileName.length > 20
    ? fileName.slice(0, 10) + '...' + fileName.slice(-8)
    : fileName;

  const handleDownload = useCallback(async () => {
    if (!resolvedUrl) {
      Alert.alert('Error', 'Unable to download video. Please try again.');
      return;
    }

    try {
      await Linking.openURL(resolvedUrl);
    } catch (error) {
      console.error('[VideoPlayer] Error downloading:', error);
      Alert.alert('Error', 'Failed to download video. Please try again.');
    }
  }, [resolvedUrl]);

  return (
    <Pressable style={styles.fallbackContainer} onPress={handleDownload}>
      <View style={styles.fallbackThumbnail}>
        <Ionicons name="videocam" size={32} color="#F44336" />
        <View style={styles.fallbackPlayIcon}>
          <Ionicons name="play" size={20} color="#fff" />
        </View>
      </View>
      <View style={styles.fallbackInfo}>
        <Text style={[styles.fallbackName, isOwnMessage && styles.ownMessageText]} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={styles.fallbackAction}>
          <Ionicons name="download-outline" size={14} color="#666" />
          <Text style={[styles.fallbackHint, isOwnMessage && styles.ownMessageMeta]}>
            Tap to download
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function VideoPlayer({ url, name, isOwnMessage = false }: VideoPlayerProps) {
  // Check if expo-av is available
  if (!isAudioVideoSupported()) {
    return <VideoDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
  }

  // Dynamic import for expo-av (only if available)
  return <VideoPlayerInner url={url} name={name} isOwnMessage={isOwnMessage} />;
}

// ============================================================================
// Inner Component (with expo-av)
// ============================================================================

function VideoPlayerInner({ url, name, isOwnMessage = false }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);

  const videoRef = useRef<any>(null);
  const resolvedUrl = getMediaUrl(url);

  const fileName = name || url.split('/').pop()?.split('?')[0] || 'Video';
  const displayName = fileName.length > 20
    ? fileName.slice(0, 10) + '...' + fileName.slice(-8)
    : fileName;

  const handlePlaybackStatusUpdate = useCallback((status: any) => {
    if (status.isLoaded) {
      setIsLoading(false);
      setIsPlaying(status.isPlaying);

      if (status.didJustFinish) {
        setIsPlaying(false);
        setShowControls(true);
        videoRef.current?.setPositionAsync(0);
      }
    } else if (status.error) {
      console.error('[VideoPlayer] Playback error:', status.error);
      setError('Failed to play video');
      setIsLoading(false);
    }
  }, []);

  const togglePlayPause = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
        setShowControls(true);
      } else {
        await videoRef.current.playAsync();
        // Hide controls after starting
        setTimeout(() => setShowControls(false), 2000);
      }
    } catch (err) {
      console.error('[VideoPlayer] Play/pause error:', err);
    }
  }, [isPlaying]);

  const handleVideoPress = useCallback(() => {
    if (isPlaying) {
      setShowControls(!showControls);
      // Auto-hide controls after 3 seconds
      if (!showControls) {
        setTimeout(() => setShowControls(false), 3000);
      }
    } else {
      togglePlayPause();
    }
  }, [isPlaying, showControls, togglePlayPause]);

  if (error) {
    return <VideoDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
  }

  // Dynamic require for expo-av
  const { Video, ResizeMode } = require('expo-av');

  return (
    <View style={styles.container}>
      <Pressable onPress={handleVideoPress} style={styles.videoWrapper}>
        <Video
          ref={videoRef}
          source={{ uri: resolvedUrl || '' }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls={false}
          isLooping={false}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          onError={(error: any) => {
            console.error('[VideoPlayer] Video error:', error);
            setError('Failed to load video');
          }}
        />

        {/* Play/Pause Overlay */}
        {(showControls || !isPlaying) && (
          <View style={styles.controlsOverlay}>
            <View style={styles.playButtonLarge}>
              {isLoading ? (
                <View style={styles.loadingIndicator} />
              ) : (
                <Ionicons
                  name={isPlaying ? 'pause' : 'play'}
                  size={32}
                  color="#fff"
                />
              )}
            </View>
          </View>
        )}
      </Pressable>

      {/* File name */}
      <Text style={[styles.fileName, isOwnMessage && styles.ownMessageText]} numberOfLines={1}>
        {displayName}
      </Text>
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    maxWidth: VIDEO_MAX_WIDTH,
  },
  videoWrapper: {
    width: '100%',
    aspectRatio: VIDEO_ASPECT_RATIO,
    backgroundColor: '#000',
    position: 'relative',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonLarge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(244, 67, 54, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#fff',
    borderTopColor: 'transparent',
  },
  fileName: {
    fontSize: 11,
    color: '#999',
    padding: 8,
    backgroundColor: '#1a1a1a',
  },
  ownMessageText: {
    color: '#ccc',
  },
  ownMessageMeta: {
    color: '#666',
  },
  // Fallback styles
  fallbackContainer: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 6,
    maxWidth: VIDEO_MAX_WIDTH,
  },
  fallbackThumbnail: {
    width: '100%',
    aspectRatio: VIDEO_ASPECT_RATIO,
    backgroundColor: 'rgba(244, 67, 54, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  fallbackPlayIcon: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(244, 67, 54, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackInfo: {
    padding: 10,
  },
  fallbackName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  fallbackAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fallbackHint: {
    fontSize: 11,
    color: '#666',
  },
});
