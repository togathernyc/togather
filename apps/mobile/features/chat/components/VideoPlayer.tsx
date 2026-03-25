/**
 * VideoPlayer - Thumbnail-to-fullscreen video player for chat messages
 *
 * Rendering strategy (in priority order):
 *   1. Web: HTML5 <video> element
 *   2. Native + react-native-webview available: WebView with HTML5 <video>
 *      (works reliably on Fabric, unlike expo-av's native view)
 *   3. Native + expo-av available: expo-av Video (wrapped in error boundary
 *      in case the Fabric view adapter crashes)
 *   4. Download fallback: tap to open in system player
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
  Platform,
  GestureResponderEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isAudioVideoSupported, isWebViewSupported } from '../utils/fileTypes';
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
// Error Boundary — catches Fabric ViewManagerAdapter crashes
// ============================================================================

interface VideoErrorBoundaryState {
  hasError: boolean;
}

class VideoErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  VideoErrorBoundaryState
> {
  state: VideoErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): VideoErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('[VideoPlayer] Native view crashed, using fallback:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// ============================================================================
// Fallback Component (when no player available or view crashes)
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
// Web Video Player (uses HTML5 <video>)
// ============================================================================

function WebVideoPlayer({ url, name, isOwnMessage = false, onLongPress }: VideoPlayerProps) {
  const resolvedUrl = getMediaUrl(url);
  const fileName = name || url.split('/').pop()?.split('?')[0] || 'Video';
  const displayName = fileName.length > 20
    ? fileName.slice(0, 10) + '...' + fileName.slice(-8)
    : fileName;

  return (
    <View style={styles.container}>
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <video
          src={resolvedUrl || ''}
          controls
          playsInline
          preload="metadata"
          style={{
            width: '100%',
            maxWidth: VIDEO_MAX_WIDTH,
            borderRadius: 8,
            backgroundColor: '#000',
            display: 'block',
          }}
        />
      </Pressable>
      <Text style={[styles.fileName, isOwnMessage && styles.ownMessageText]} numberOfLines={1}>
        {displayName}
      </Text>
    </View>
  );
}

// ============================================================================
// WebView Video Player (native — uses react-native-webview with HTML5 <video>)
// ============================================================================

function WebViewVideoPlayer({ url, name, isOwnMessage = false, onLongPress }: VideoPlayerProps) {
  const resolvedUrl = getMediaUrl(url);
  const fileName = name || url.split('/').pop()?.split('?')[0] || 'Video';
  const displayName = fileName.length > 20
    ? fileName.slice(0, 10) + '...' + fileName.slice(-8)
    : fileName;

  const { WebView } = require('react-native-webview');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #000; display: flex; align-items: center; justify-content: center; }
        video { width: 100%; display: block; background: #000; }
      </style>
    </head>
    <body>
      <video
        src="${resolvedUrl || ''}"
        controls
        playsinline
        preload="metadata"
        poster=""
      ></video>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <Pressable onLongPress={onLongPress} delayLongPress={300}>
        <View style={[styles.webviewWrapper, { aspectRatio: VIDEO_ASPECT_RATIO }]}>
          <WebView
            source={{ html }}
            style={styles.webview}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            scrollEnabled={false}
            bounces={false}
            javaScriptEnabled={true}
            allowsFullscreenVideo={true}
          />
        </View>
      </Pressable>
      <Text style={[styles.fileName, isOwnMessage && styles.ownMessageText]} numberOfLines={1}>
        {displayName}
      </Text>
    </View>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function VideoPlayer({ url, name, isOwnMessage = false, onLongPress }: VideoPlayerProps) {
  // Web: use native HTML5 video element
  if (Platform.OS === 'web') {
    return <WebVideoPlayer url={url} name={name} isOwnMessage={isOwnMessage} onLongPress={onLongPress} />;
  }

  // Native priority 1: WebView with HTML5 video (reliable on Fabric)
  if (isWebViewSupported()) {
    return <WebViewVideoPlayer url={url} name={name} isOwnMessage={isOwnMessage} onLongPress={onLongPress} />;
  }

  // Native priority 2: expo-av Video (may crash on Fabric, wrapped in error boundary)
  if (isAudioVideoSupported()) {
    const fallback = <VideoDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
    return (
      <VideoErrorBoundary fallback={fallback}>
        <VideoPlayerInner url={url} name={name} isOwnMessage={isOwnMessage} onLongPress={onLongPress} />
      </VideoErrorBoundary>
    );
  }

  // Native priority 3: download fallback
  return <VideoDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
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
        {visible && (
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
        )}

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

        <View style={styles.controlsOverlay}>
          <View style={styles.playButtonLarge}>
            <Ionicons name="play" size={32} color="#fff" />
          </View>
        </View>
      </Pressable>

      <Text style={[styles.fileName, isOwnMessage && styles.ownMessageText]} numberOfLines={1}>
        {displayName}
      </Text>

      <FullscreenVideoModal
        visible={modalVisible}
        videoUrl={resolvedUrl || ''}
        onClose={handleClose}
      />
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
  webviewWrapper: {
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
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
