/**
 * AudioPlayer - Inline audio player for chat messages
 *
 * Platform-aware audio playback (priority order):
 * 1. Web: HTML5 Audio API (plays all formats including WebM)
 * 2. Native + expo-audio: expo-audio hooks API (preferred native player)
 * 3. Native + expo-av: expo-av Sound API (legacy fallback)
 * 4. Native without audio libs: Download fallback (OTA update scenario)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isAudioSupported, isAudioVideoSupported } from '../utils/fileTypes';
import { getMediaUrl } from '@/utils/media';
import { useTheme } from '@hooks/useTheme';
import { WaveformBars } from './WaveformBars';

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
  /** Stored waveform data (normalized 0-1 bar heights) */
  waveform?: number[];
  /** Stored duration in ms */
  duration?: number;
}

// ============================================================================
// Fallback Component (when no audio API available)
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

export function AudioPlayer({ url, name, isOwnMessage = false, waveform, duration: storedDuration }: AudioPlayerProps) {
  if (Platform.OS === 'web') {
    return <AudioPlayerWeb url={url} name={name} isOwnMessage={isOwnMessage} waveform={waveform} storedDuration={storedDuration} />;
  }

  if (isAudioSupported()) {
    return <AudioPlayerExpoAudio url={url} name={name} isOwnMessage={isOwnMessage} waveform={waveform} storedDuration={storedDuration} />;
  }

  if (isAudioVideoSupported()) {
    return <AudioPlayerInner url={url} name={name} isOwnMessage={isOwnMessage} waveform={waveform} storedDuration={storedDuration} />;
  }

  return <AudioDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
}

// ============================================================================
// Web Component (HTML5 Audio API)
// ============================================================================

function AudioPlayerWeb({ url, name, isOwnMessage = false, waveform, storedDuration }: AudioPlayerProps & { storedDuration?: number }) {
  const { colors, isDark } = useTheme();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [duration, setDuration] = useState(storedDuration || 0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<View | null>(null);
  const resolvedUrl = getMediaUrl(url);

  useEffect(() => {
    if (!resolvedUrl) {
      setError('Invalid audio URL');
      setIsLoading(false);
      return;
    }

    const audio = new Audio(resolvedUrl);
    audioRef.current = audio;

    let seekingForDuration = false;

    const updateDuration = () => {
      const dur = audio.duration;
      if (dur && isFinite(dur)) {
        setDuration(dur * 1000);
      }
    };

    audio.onloadedmetadata = () => {
      setIsLoading(false);
      if (isFinite(audio.duration)) {
        updateDuration();
      } else {
        seekingForDuration = true;
        audio.currentTime = 1e10;
      }
    };

    audio.onseeked = () => {
      if (seekingForDuration) {
        seekingForDuration = false;
        updateDuration();
        audio.currentTime = 0;
      }
    };

    audio.ondurationchange = () => {
      updateDuration();
    };

    audio.ontimeupdate = () => {
      setPosition(audio.currentTime * 1000);
      updateDuration();
    };

    audio.onended = () => {
      setIsPlaying(false);
      setPosition(0);
      audio.currentTime = 0;
    };

    audio.onerror = () => {
      console.error('[AudioPlayerWeb] Load error for:', resolvedUrl);
      setError('Failed to load audio');
      setIsLoading(false);
    };

    audio.preload = 'auto';

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, [resolvedUrl]);

  const togglePlayPause = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        await audio.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error('[AudioPlayerWeb] Play/pause error:', err);
    }
  }, [isPlaying]);

  const handleWaveformPress = useCallback((event: any) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;

    const nativeEvent = event.nativeEvent;
    const locationX = nativeEvent.locationX ?? nativeEvent.offsetX ?? 0;
    const layoutWidth = nativeEvent.target?.clientWidth || nativeEvent.target?.offsetWidth || 1;
    const fraction = Math.max(0, Math.min(1, locationX / layoutWidth));
    const seekTime = (fraction * duration) / 1000;
    audio.currentTime = seekTime;
    setPosition(fraction * duration);
  }, [duration]);

  const formatTime = (millis: number): string => {
    if (!isFinite(millis) || millis < 0) return '0:00';
    const seconds = Math.floor(millis / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const playedFraction = duration > 0 ? position / duration : 0;
  const displayDuration = duration || storedDuration || 0;
  const accentColor = isOwnMessage
    ? (isDark ? '#fff' : 'rgba(0,0,0,0.55)')
    : (isDark ? '#aaa' : '#333');

  if (error) {
    return <AudioDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
  }

  return (
    <View style={styles.container}>
      <Pressable
        style={[styles.playButton, { backgroundColor: isOwnMessage ? (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)') : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)') }]}
        onPress={togglePlayPause}
        disabled={isLoading}
      >
        {isLoading ? (
          <View style={styles.loadingIndicator} />
        ) : (
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={isOwnMessage ? (isDark ? '#fff' : 'rgba(0,0,0,0.6)') : colors.text}
          />
        )}
      </Pressable>

      <Pressable style={styles.waveformContainer} onPress={handleWaveformPress} ref={waveformRef}>
        <WaveformBars
          meteringData={waveform || []}
          playedFraction={playedFraction}
          barCount={30}
          accentColor={accentColor}
          height={24}
        />
      </Pressable>

      <Text style={[styles.time, { color: isOwnMessage ? (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)') : colors.textSecondary }]}>
        {formatTime(isPlaying ? position : displayDuration)}
      </Text>
    </View>
  );
}

// ============================================================================
// Native Component (expo-audio) — preferred
// ============================================================================

function AudioPlayerExpoAudio({ url, name, isOwnMessage = false, waveform, storedDuration }: AudioPlayerProps & { storedDuration?: number }) {
  // Dynamic require — expo-audio is a gated native dependency.
  // This component is only rendered when isAudioSupported() is true,
  // so the require will succeed. Hooks must be called unconditionally.
  const ExpoAudio = require('expo-audio');
  const { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } = ExpoAudio as {
    useAudioPlayer: (source?: any, options?: any) => any;
    useAudioPlayerStatus: (player: any) => any;
    setAudioModeAsync: (mode: any) => Promise<void>;
  };

  const { colors, isDark } = useTheme();
  const resolvedUrl = getMediaUrl(url);
  const [error, setError] = useState<string | null>(null);
  const hasSetAudioMode = useRef(false);

  // Create audio source — must be stable across renders for the hook
  const audioSource = React.useMemo(
    () => (resolvedUrl ? { uri: resolvedUrl } : null),
    [resolvedUrl],
  );

  // useAudioPlayer is a React hook — called unconditionally at top level
  const player = useAudioPlayer(audioSource, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);

  // Set audio mode for iOS (play through speaker, not earpiece)
  useEffect(() => {
    if (hasSetAudioMode.current) return;
    hasSetAudioMode.current = true;
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    }).catch((err: any) => {
      console.warn('[AudioPlayerExpoAudio] Failed to set audio mode:', err);
    });
  }, [setAudioModeAsync]);

  // Detect load errors
  useEffect(() => {
    if (!resolvedUrl) {
      setError('Invalid audio URL');
    }
  }, [resolvedUrl]);

  // Reset position when playback finishes
  useEffect(() => {
    if (status.didJustFinish) {
      player.seekTo(0).catch(() => {});
    }
  }, [status.didJustFinish, player]);

  const togglePlayPause = useCallback(async () => {
    try {
      // Re-set audio mode before playing — critical after recording voice messages
      // where the iOS audio session may still be in recording mode (earpiece).
      if (!status.playing) {
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
          shouldRouteThroughEarpiece: false,
        });
        player.play();
      } else {
        player.pause();
      }
    } catch (err) {
      console.error('[AudioPlayerExpoAudio] Play/pause error:', err);
    }
  }, [status.playing, player, setAudioModeAsync]);

  const handleWaveformPress = useCallback(async (event: any) => {
    // expo-audio duration is in seconds
    const durationMs = status.duration * 1000;
    if (!durationMs) return;

    const nativeEvent = event.nativeEvent;
    const locationX = nativeEvent.locationX ?? 0;
    const layoutWidth = nativeEvent.layout?.width || 200;
    const fraction = Math.max(0, Math.min(1, locationX / layoutWidth));
    const seekSeconds = fraction * status.duration;

    try {
      await player.seekTo(seekSeconds);
    } catch (err) {
      console.error('[AudioPlayerExpoAudio] Seek error:', err);
    }
  }, [status.duration, player]);

  const formatTime = (millis: number): string => {
    if (!isFinite(millis) || millis < 0) return '0:00';
    const seconds = Math.floor(millis / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Convert expo-audio seconds to milliseconds for UI consistency
  const positionMs = status.currentTime * 1000;
  const durationMs = status.duration * 1000;
  const displayDuration = durationMs || storedDuration || 0;
  const playedFraction = durationMs > 0 ? positionMs / durationMs : 0;
  const isLoading = !status.isLoaded && !error;
  const accentColor = isOwnMessage
    ? (isDark ? '#fff' : 'rgba(0,0,0,0.55)')
    : (isDark ? '#aaa' : '#333');

  if (error) {
    return <AudioDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
  }

  return (
    <View style={styles.container}>
      <Pressable
        style={[styles.playButton, { backgroundColor: isOwnMessage ? (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)') : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)') }]}
        onPress={togglePlayPause}
        disabled={isLoading}
      >
        {isLoading ? (
          <View style={styles.loadingIndicator} />
        ) : (
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={18}
            color={isOwnMessage ? (isDark ? '#fff' : 'rgba(0,0,0,0.6)') : colors.text}
          />
        )}
      </Pressable>

      <Pressable
        style={styles.waveformContainer}
        onPress={handleWaveformPress}
        onLayout={() => {
          // Layout measured for seek calculations via nativeEvent
        }}
      >
        <WaveformBars
          meteringData={waveform || []}
          playedFraction={playedFraction}
          barCount={30}
          accentColor={accentColor}
          height={24}
        />
      </Pressable>

      <Text style={[styles.time, { color: isOwnMessage ? (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)') : colors.textSecondary }]}>
        {formatTime(status.playing ? positionMs : displayDuration)}
      </Text>
    </View>
  );
}

// ============================================================================
// Native Component (expo-av) — legacy fallback
// ============================================================================

function AudioPlayerInner({ url, name, isOwnMessage = false, waveform, storedDuration }: AudioPlayerProps & { storedDuration?: number }) {
  const { colors, isDark } = useTheme();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [duration, setDuration] = useState(storedDuration || 0);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const soundRef = useRef<any>(null);
  const resolvedUrl = getMediaUrl(url);

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

        // On iOS, the audio session can remain in recording mode (earpiece) after
        // recording voice messages. Set playback mode before loading so audio
        // plays through the speaker. Must be called immediately before createAsync.
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

        const { sound, status } = await Audio.Sound.createAsync(
          { uri: resolvedUrl },
          { shouldPlay: false },
          (playbackStatus: any) => {
            if (!isMounted) return;
            if (playbackStatus.isLoaded) {
              setDuration(playbackStatus.durationMillis || 0);
              setPosition(playbackStatus.positionMillis || 0);
              setIsPlaying(playbackStatus.isPlaying);

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
        // Ensure iOS audio session is in playback mode (speaker) before playing.
        // Critical for sent voice messages where session may still be in recording mode.
        const { Audio } = require('expo-av');
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
        await soundRef.current.playAsync();
      }
    } catch (err) {
      console.error('[AudioPlayer] Play/pause error:', err);
    }
  }, [isPlaying]);

  const handleWaveformPress = useCallback(async (event: any) => {
    const sound = soundRef.current;
    if (!sound || !duration) return;

    const nativeEvent = event.nativeEvent;
    const locationX = nativeEvent.locationX ?? 0;
    const layoutWidth = nativeEvent.layout?.width || 200;
    const fraction = Math.max(0, Math.min(1, locationX / layoutWidth));
    const seekPosition = fraction * duration;

    try {
      await sound.setPositionAsync(seekPosition);
      setPosition(seekPosition);
    } catch (err) {
      console.error('[AudioPlayer] Seek error:', err);
    }
  }, [duration]);

  const formatTime = (millis: number): string => {
    const seconds = Math.floor(millis / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const playedFraction = duration > 0 ? position / duration : 0;
  const displayDuration = duration || storedDuration || 0;
  const accentColor = isOwnMessage
    ? (isDark ? '#fff' : 'rgba(0,0,0,0.55)')
    : (isDark ? '#aaa' : '#333');

  if (error) {
    return <AudioDownloadFallback url={url} name={name} isOwnMessage={isOwnMessage} />;
  }

  return (
    <View style={styles.container}>
      <Pressable
        style={[styles.playButton, { backgroundColor: isOwnMessage ? (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)') : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)') }]}
        onPress={togglePlayPause}
        disabled={isLoading}
      >
        {isLoading ? (
          <View style={styles.loadingIndicator} />
        ) : (
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={isOwnMessage ? (isDark ? '#fff' : 'rgba(0,0,0,0.6)') : colors.text}
          />
        )}
      </Pressable>

      <Pressable
        style={styles.waveformContainer}
        onPress={handleWaveformPress}
        onLayout={(e) => {
          // Store layout width for seek calculations
        }}
      >
        <WaveformBars
          meteringData={waveform || []}
          playedFraction={playedFraction}
          barCount={30}
          accentColor={accentColor}
          height={24}
        />
      </Pressable>

      <Text style={[styles.time, { color: isOwnMessage ? (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)') : colors.textSecondary }]}>
        {formatTime(isPlaying ? position : displayDuration)}
      </Text>
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
    paddingVertical: 4,
    minWidth: 200,
    gap: 8,
  },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#999',
    borderTopColor: 'transparent',
  },
  waveformContainer: {
    flex: 1,
  },
  time: {
    fontSize: 11,
    fontWeight: '500',
    minWidth: 30,
    textAlign: 'right',
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
