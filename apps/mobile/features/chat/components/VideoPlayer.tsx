/**
 * VideoPlayer - Thumbnail-to-fullscreen video player for chat messages
 *
 * Displays a thumbnail with a play button. Tapping opens a fullscreen modal
 * with native video controls.
 * Falls back to a download button if expo-av is not available (OTA update scenario).
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Alert,
  Dimensions,
  Modal,
  GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  /** Long press handler (e.g. for reactions) */
  onLongPress?: (event: GestureResponderEvent) => void;
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

export function VideoPlayer({ url, name, isOwnMessage = false, onLongPress }: VideoPlayerProps) {
  // Check if expo-av is available
  if (!isAudioVideoSupported()) {
    return <VideoDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
  }

  return <VideoPlayerInner url={url} name={name} isOwnMessage={isOwnMessage} onLongPress={onLongPress} />;
}

// ============================================================================
// Fullscreen Modal Component
// ============================================================================

function FullscreenVideoModal({
  visible,
  videoUrl,
  onClose,
}: {
  visible: boolean;
  videoUrl: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { Video, ResizeMode } = require('expo-av');

  return (
    <Modal
      visible={visible}
      animationType="fade"
      supportedOrientations={['portrait', 'landscape']}
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <Video
          source={{ uri: videoUrl }}
          style={styles.modalVideo}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls={true}
          shouldPlay={true}
          isLooping={false}
          onError={(error: any) => {
            console.error('[VideoPlayer] Modal playback error:', error);
          }}
        />

        {/* Close button */}
        <Pressable
          style={[styles.closeButton, { top: insets.top + 12, right: 16 }]}
          onPress={onClose}
          hitSlop={12}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

// ============================================================================
// Inner Component (with expo-av)
// ============================================================================

function VideoPlayerInner({ url, name, isOwnMessage = false, onLongPress }: VideoPlayerProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(VIDEO_ASPECT_RATIO);

  const { Video, ResizeMode } = require('expo-av');

  const resolvedUrl = getMediaUrl(url);

  const fileName = name || url.split('/').pop()?.split('?')[0] || 'Video';
  const displayName = fileName.length > 20
    ? fileName.slice(0, 10) + '...' + fileName.slice(-8)
    : fileName;

  const handleOpen = useCallback(() => {
    setModalVisible(true);
  }, []);

  const handleClose = useCallback(() => {
    setModalVisible(false);
  }, []);

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handleOpen}
        onLongPress={onLongPress}
        delayLongPress={300}
        style={[styles.thumbnailWrapper, { aspectRatio }]}
      >
        {/* Paused video showing first frame as thumbnail */}
        <Video
          source={{ uri: resolvedUrl || '' }}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          shouldPlay={false}
          isMuted={true}
          onReadyForDisplay={(event: any) => {
            const { width, height } = event.naturalSize;
            if (width && height) {
              setAspectRatio(width / height);
            }
          }}
        />

        {/* Dark overlay with play button */}
        <View style={styles.controlsOverlay}>
          <View style={styles.playButtonLarge}>
            <Ionicons name="play" size={32} color="#fff" />
          </View>
        </View>
      </Pressable>

      {/* File name */}
      <Text style={[styles.fileName, isOwnMessage && styles.ownMessageText]} numberOfLines={1}>
        {displayName}
      </Text>

      {/* Fullscreen modal */}
      {modalVisible && (
        <FullscreenVideoModal
          visible={modalVisible}
          videoUrl={resolvedUrl || ''}
          onClose={handleClose}
        />
      )}
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
  thumbnailWrapper: {
    width: '100%',
    backgroundColor: '#000',
    position: 'relative',
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
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalVideo: {
    width: '100%',
    height: '100%',
  },
  closeButton: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
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
