/**
 * VoiceRecorderBar - WhatsApp-inspired voice memo recording UI
 *
 * Replaces the message input row during recording. Shows:
 * - Recording: Delete, waveform, timer, Pause/Resume, Stop
 * - Preview: Delete, Play, waveform, timer, Send
 * - 7-day auto-delete disclaimer
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WaveformBars } from './WaveformBars';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { isAudioVideoSupported } from '../utils/fileTypes';

const DISCLAIMER_TEXT = 'Voice messages delete after 7 days';

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface VoiceRecorderBarProps {
  onSend: (file: { uri: string; name: string; size: number; mimeType: string; waveform: number[]; durationMs: number }) => Promise<void>;
  onCancel: () => void;
}

export function VoiceRecorderBar({ onSend, onCancel }: VoiceRecorderBarProps) {
  const {
    state,
    durationMs,
    meteringData,
    fileUri,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    deleteRecording,
    sendRecording,
  } = useVoiceRecorder();

  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewPlayedFraction, setPreviewPlayedFraction] = useState(0);
  const soundRef = useRef<any>(null);

  const handleDelete = useCallback(() => {
    if (state === 'recording' || state === 'paused') {
      Alert.alert(
        'Delete Recording',
        'Are you sure you want to delete this recording?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => { deleteRecording(); onCancel(); } },
        ]
      );
    } else {
      deleteRecording();
      onCancel();
    }
  }, [state, deleteRecording, onCancel]);

  const handleSend = useCallback(async () => {
    const success = await sendRecording(async (file) => {
      await onSend(file);
    });
    if (success) {
      onCancel();
    }
  }, [sendRecording, onSend, onCancel]);

  const handlePreviewPlayPause = useCallback(async () => {
    if (Platform.OS === 'web') {
      if (!fileUri) return;
      const audio = soundRef.current as HTMLAudioElement | null;
      if (!audio) {
        const el = new Audio(fileUri);
        soundRef.current = el;
        el.onended = () => {
          setPreviewPlaying(false);
          setPreviewPlayedFraction(1);
        };
        el.ontimeupdate = () => {
          if (el.duration) setPreviewPlayedFraction(el.currentTime / el.duration);
        };
        await el.play();
        setPreviewPlaying(true);
      } else {
        if (audio.paused) {
          await audio.play();
          setPreviewPlaying(true);
        } else {
          audio.pause();
          setPreviewPlaying(false);
        }
      }
      return;
    }
    if (!isAudioVideoSupported() || !fileUri) return;
    try {
      const { Audio } = require('expo-av');
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri: fileUri },
          { shouldPlay: true },
          (status: any) => {
            if (status.isLoaded && status.durationMillis) {
              setPreviewPlayedFraction(status.positionMillis / status.durationMillis);
              if (status.didJustFinish) {
                setPreviewPlaying(false);
                setPreviewPlayedFraction(1);
              }
            }
          }
        );
        soundRef.current = sound;
        setPreviewPlaying(true);
      } else {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (status.isPlaying) {
            await soundRef.current.pauseAsync();
            setPreviewPlaying(false);
          } else {
            await soundRef.current.playAsync();
            setPreviewPlaying(true);
          }
        }
      }
    } catch (err) {
      console.error('[VoiceRecorderBar] Preview play error:', err);
    }
  }, [fileUri]);

  useEffect(() => {
    if (state === 'idle') {
      startRecording();
    }
  }, []);

  useEffect(() => {
    return () => {
      const sound = soundRef.current;
      if (sound) {
        if (Platform.OS === 'web') {
          const audio = sound as HTMLAudioElement;
          audio.pause();
          audio.src = '';
        } else {
          sound.unloadAsync?.().catch(() => {});
        }
        soundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (error) {
      Alert.alert(
        'Voice Recording',
        error,
        [
          { text: 'OK', onPress: onCancel },
          ...(Platform.OS !== 'web' ? [{ text: 'Open Settings', onPress: () => Linking.openSettings?.() }] : []),
        ]
      );
    }
  }, [error, onCancel]);

  if (state === 'sending') {
    return (
      <View style={styles.container}>
        <View style={styles.row}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.sendingText}>Sending...</Text>
        </View>
      </View>
    );
  }

  const isRecording = state === 'recording' || state === 'paused';
  const isPreview = state === 'preview';

  return (
    <View style={styles.container}>
      <Text style={styles.disclaimer}>{DISCLAIMER_TEXT}</Text>

      <View style={styles.row}>
        {/* Delete */}
        <Pressable style={styles.iconButton} onPress={handleDelete}>
          <Ionicons name="trash-outline" size={22} color="#e74c3c" />
        </Pressable>

        {/* Waveform */}
        <View style={styles.waveformContainer}>
          <WaveformBars
            meteringData={meteringData}
            playedFraction={isPreview ? previewPlayedFraction : 1}
          />
        </View>

        {/* Timer */}
        <Text style={styles.timer}>{formatDuration(durationMs)}</Text>

        {isRecording && (
          <>
            {/* Pause/Resume */}
            <Pressable
              style={styles.iconButton}
              onPress={state === 'recording' ? pauseRecording : resumeRecording}
            >
              <Ionicons
                name={state === 'recording' ? 'pause' : 'play'}
                size={24}
                color="#007AFF"
              />
            </Pressable>
            {/* Stop */}
            <Pressable style={styles.iconButton} onPress={stopRecording}>
              <Ionicons name="stop" size={24} color="#007AFF" />
            </Pressable>
          </>
        )}

        {isPreview && (
          <>
            {/* Play preview */}
            <Pressable style={styles.iconButton} onPress={handlePreviewPlayPause}>
              <Ionicons
                name={previewPlaying ? 'pause' : 'play'}
                size={24}
                color="#007AFF"
              />
            </Pressable>
            {/* Send */}
            <Pressable style={[styles.iconButton, styles.sendButton]} onPress={handleSend}>
              <Ionicons name="send" size={20} color="#fff" />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  disclaimer: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    backgroundColor: '#007AFF',
  },
  waveformContainer: {
    flex: 1,
    maxWidth: 200,
  },
  timer: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    minWidth: 36,
    textAlign: 'center',
  },
  sendingText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
});
