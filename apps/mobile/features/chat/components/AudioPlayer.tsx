/**
 * AudioPlayer - Inline audio player for chat messages
 *
 * Displays an audio player with play/pause controls and progress.
 * Falls back to a download button if expo-av is not available (OTA update scenario).
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isAudioVideoSupported } from '../utils/fileTypes';
import { getMediaUrl } from '@/utils/media';
import { useTheme } from '@hooks/useTheme';

// ============================================================================
// Types
// ============================================================================

interface AudioPlayerProps {
  /** The storage path or URL of the audio file */
  url: string;
  /** The file name */
  name?: string;
  /** Whether this appears in the sender's own message */
  isOwnMessage?: boolean;
}

// ============================================================================
// Fallback Component (when expo-av not available)
// ============================================================================

function AudioDownloadFallback({ url, name, isOwnMessage }: AudioPlayerProps) {
  const { colors, isDark } = useTheme();
  const resolvedUrl = getMediaUrl(url);
  const fileName = name || url.split('/').pop()?.split('?')[0] || 'Audio';

  const displayName = fileName.length > 20
    ? fileName.slice(0, 10) + '...' + fileName.slice(-8)
    : fileName;

  const handleDownload = useCallback(async () => {
    if (!resolvedUrl) {
      Alert.alert('Error', 'Unable to download audio. Please try again.');
      return;
    }

    try {
      await Linking.openURL(resolvedUrl);
    } catch (error) {
      console.error('[AudioPlayer] Error downloading:', error);
      Alert.alert('Error', 'Failed to download audio. Please try again.');
    }
  }, [resolvedUrl]);

  return (
    <Pressable style={[styles.fallbackContainer, { backgroundColor: isDark ? 'rgba(156, 39, 176, 0.2)' : 'rgba(156, 39, 176, 0.1)' }]} onPress={handleDownload}>
      <View style={[styles.fallbackIconContainer, { backgroundColor: isDark ? 'rgba(156, 39, 176, 0.3)' : 'rgba(156, 39, 176, 0.2)' }]}>
        <Ionicons name="musical-notes" size={20} color="#9C27B0" />
      </View>
      <View style={styles.fallbackInfo}>
        <Text style={[styles.fallbackName, { color: colors.text }, isOwnMessage && { color: colors.text }]} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={[styles.fallbackHint, { color: colors.textSecondary }, isOwnMessage && { color: colors.textSecondary }]}>
          Tap to download
        </Text>
      </View>
      <Ionicons name="download-outline" size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AudioPlayer({ url, name, isOwnMessage = false }: AudioPlayerProps) {
  // Check if expo-av is available
  if (!isAudioVideoSupported()) {
    return <AudioDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
  }

  // Dynamic import for expo-av (only if available)
  return <AudioPlayerInner url={url} name={name} isOwnMessage={isOwnMessage} />;
}

// ============================================================================
// Inner Component (with expo-av)
// ============================================================================

function AudioPlayerInner({ url, name, isOwnMessage = false }: AudioPlayerProps) {
  const { colors, isDark } = useTheme();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const soundRef = useRef<any>(null);
  const resolvedUrl = getMediaUrl(url);

  const fileName = name || url.split('/').pop()?.split('?')[0] || 'Audio';
  const displayName = fileName.length > 20
    ? fileName.slice(0, 10) + '...' + fileName.slice(-8)
    : fileName;

  // Load audio on mount
  useEffect(() => {
    let isMounted = true;

    const loadAudio = async () => {
      if (!resolvedUrl) {
        setError('Invalid audio URL');
        return;
      }

      try {
        setIsLoading(true);
        const { Audio } = require('expo-av');

        const { sound, status } = await Audio.Sound.createAsync(
          { uri: resolvedUrl },
          { shouldPlay: false },
          (playbackStatus: any) => {
            if (!isMounted) return;
            if (playbackStatus.isLoaded) {
              setDuration(playbackStatus.durationMillis || 0);
              setPosition(playbackStatus.positionMillis || 0);
              setIsPlaying(playbackStatus.isPlaying);

              // Reset when finished
              if (playbackStatus.didJustFinish) {
                setIsPlaying(false);
                setPosition(0);
                sound.setPositionAsync(0);
              }
            }
          }
        );

        if (isMounted) {
          soundRef.current = sound;
          if (status.isLoaded) {
            setDuration(status.durationMillis || 0);
          }
        } else {
          // Component unmounted during load - clean up the orphaned sound
          await sound.unloadAsync();
        }
      } catch (err) {
        console.error('[AudioPlayer] Load error:', err);
        if (isMounted) {
          setError('Failed to load audio');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadAudio();

    return () => {
      isMounted = false;
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, [resolvedUrl]);

  const togglePlayPause = useCallback(async () => {
    if (!soundRef.current) return;

    try {
      if (isPlaying) {
        await soundRef.current.pauseAsync();
      } else {
        await soundRef.current.playAsync();
      }
    } catch (err) {
      console.error('[AudioPlayer] Play/pause error:', err);
    }
  }, [isPlaying]);

  // Format time as mm:ss
  const formatTime = (millis: number): string => {
    const seconds = Math.floor(millis / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage
  const progressPercent = duration > 0 ? (position / duration) * 100 : 0;

  if (error) {
    return <AudioDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
  }

  return (
    <View style={[styles.container, { backgroundColor: isDark ? 'rgba(156, 39, 176, 0.2)' : 'rgba(156, 39, 176, 0.1)' }]}>
      {/* Play/Pause Button */}
      <Pressable
        style={styles.playButton}
        onPress={togglePlayPause}
        disabled={isLoading}
      >
        {isLoading ? (
          <View style={styles.loadingIndicator} />
        ) : (
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={24}
            color="#fff"
          />
        )}
      </Pressable>

      {/* Progress and Info */}
      <View style={styles.progressContainer}>
        <Text style={[styles.fileName, { color: colors.text }, isOwnMessage && { color: colors.text }]} numberOfLines={1}>
          {displayName}
        </Text>

        {/* Progress Bar */}
        <View style={[styles.progressBarBackground, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }]}>
          <View
            style={[styles.progressBar, { width: `${progressPercent}%` }]}
          />
        </View>

        {/* Time */}
        <View style={styles.timeContainer}>
          <Text style={[styles.time, { color: colors.textSecondary }]}>
            {formatTime(position)}
          </Text>
          <Text style={[styles.time, { color: colors.textSecondary }]}>
            {formatTime(duration)}
          </Text>
        </View>
      </View>
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
    borderRadius: 12,
    padding: 10,
    marginTop: 6,
    minWidth: 200,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#9C27B0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  loadingIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#fff',
    borderTopColor: 'transparent',
  },
  progressContainer: {
    flex: 1,
  },
  fileName: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  progressBarBackground: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#9C27B0',
    borderRadius: 2,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  time: {
    fontSize: 10,
  },
  // Fallback styles
  fallbackContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    minWidth: 180,
  },
  fallbackIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  fallbackInfo: {
    flex: 1,
    marginRight: 8,
  },
  fallbackName: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  fallbackHint: {
    fontSize: 11,
  },
});
