/**
 * useVoiceRecorder - Voice memo recording hook
 *
 * Supports both native (expo-av) and web (MediaRecorder API).
 * WhatsApp-inspired recording with live waveform, pause/resume, and preview.
 *
 * State machine: IDLE -> RECORDING <-> PAUSED -> PREVIEW -> SENDING -> IDLE
 *
 * Gated: Uses dynamic require for expo-av on native. Add to check-native-imports allowlist.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import { isAudioVideoSupported } from '../utils/fileTypes';

const MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const METERING_INTERVAL_MS = 100;
const WAVEFORM_BAR_COUNT = 40;

export type VoiceRecorderState = 'idle' | 'recording' | 'paused' | 'preview' | 'sending';

export interface VoiceRecorderResult {
  state: VoiceRecorderState;
  durationMs: number;
  meteringData: number[];
  fileUri: string | null;
  mimeType: string;
  fileName: string;
  error: string | null;
  startRecording: () => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  deleteRecording: () => void;
  sendRecording: (onSend: (file: { uri: string; name: string; size: number; mimeType: string; waveform: number[]; durationMs: number }) => Promise<void>) => Promise<boolean>;
}

function useVoiceRecorderWeb(): VoiceRecorderResult {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [meteringData, setMeteringData] = useState<number[]>([]);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingActiveRef = useRef(false);

  // Prefer MP4 for cross-platform compatibility (plays natively on iOS)
  const preferMp4 = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/mp4');
  const mimeType = preferMp4 ? 'audio/mp4' : 'audio/webm';
  const fileName = preferMp4 ? 'voice-memo.m4a' : 'voice-memo.webm';

  const cleanup = useCallback(() => {
    isRecordingActiveRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  const deleteRecording = useCallback(() => {
    cleanup();
    if (fileUri) {
      URL.revokeObjectURL(fileUri);
    }
    setState('idle');
    setDurationMs(0);
    setMeteringData([]);
    setFileUri(null);
    setError(null);
  }, [cleanup, fileUri]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorderMimeType = MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: recorderMimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        isRecordingActiveRef.current = false;
        const blob = new Blob(chunksRef.current, { type: recorderMimeType.split(';')[0] });
        const uri = URL.createObjectURL(blob);
        setFileUri(uri);
        setState('preview');
      };

      recorder.start(100);
      startTimeRef.current = Date.now();
      elapsedBeforePauseRef.current = 0;
      isRecordingActiveRef.current = true;
      setState('recording');
      setMeteringData([]);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMetering = () => {
        if (analyserRef.current && isRecordingActiveRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const normalized = Math.min(1, avg / 128);
          setMeteringData((prev) => {
            const next = [...prev, normalized];
            return next.slice(-WAVEFORM_BAR_COUNT);
          });
        }
        animationFrameRef.current = requestAnimationFrame(updateMetering);
      };
      animationFrameRef.current = requestAnimationFrame(updateMetering);

      timerRef.current = setInterval(() => {
        const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
        setDurationMs(elapsed);
        if (elapsed >= MAX_DURATION_MS) {
          recorder.stop();
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }, 100);
    } catch (err) {
      console.error('[useVoiceRecorder] Web start error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      setState('idle');
    }
  }, []);

  const pauseRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && state === 'recording') {
      recorder.pause();
      isRecordingActiveRef.current = false;
      elapsedBeforePauseRef.current += Date.now() - startTimeRef.current;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setState('paused');
    }
  }, [state]);

  const resumeRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && state === 'paused') {
      recorder.resume();
      isRecordingActiveRef.current = true;
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current);
        setDurationMs(elapsed);
        if (elapsed >= MAX_DURATION_MS) {
          recorder.stop();
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      }, 100);
      setState('recording');
    }
  }, [state]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && (state === 'recording' || state === 'paused')) {
      recorder.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      cleanup();
    }
  }, [state, cleanup]);

  const sendRecording = useCallback(
    async (onSend: (file: { uri: string; name: string; size: number; mimeType: string; waveform: number[]; durationMs: number }) => Promise<void>): Promise<boolean> => {
      if (!fileUri || state !== 'preview') return false;
      setState('sending');
      try {
        const response = await fetch(fileUri);
        const blob = await response.blob();
        await onSend({
          uri: fileUri,
          name: fileName,
          size: blob.size,
          mimeType: mimeType,
          waveform: meteringData,
          durationMs: durationMs,
        });
        deleteRecording();
        return true;
      } catch (err) {
        console.error('[useVoiceRecorder] Send error:', err);
        setError(err instanceof Error ? err.message : 'Failed to send');
        setState('preview');
        return false;
      }
    },
    [fileUri, state, deleteRecording, mimeType, meteringData, durationMs]
  );

  useEffect(() => () => cleanup(), [cleanup]);

  return {
    state,
    durationMs,
    meteringData,
    fileUri,
    mimeType,
    fileName,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    deleteRecording,
    sendRecording,
  };
}

function useVoiceRecorderNative(): VoiceRecorderResult {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [meteringData, setMeteringData] = useState<number[]>([]);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recordingRef = useRef<any>(null);
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);

  const mimeType = 'audio/mp4';
  const fileName = 'voice-memo.m4a';

  const cleanup = useCallback(async () => {
    if (meteringIntervalRef.current) {
      clearInterval(meteringIntervalRef.current);
      meteringIntervalRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const rec = recordingRef.current;
    if (rec) {
      try {
        const status = await rec.getStatusAsync();
        if (status.canRecord) {
          await rec.stopAndUnloadAsync();
        }
      } catch {
        // ignore
      }
      recordingRef.current = null;
    }
  }, []);

  const deleteRecording = useCallback(() => {
    cleanup();
    setState('idle');
    setDurationMs(0);
    setMeteringData([]);
    setFileUri(null);
    setError(null);
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    if (!isAudioVideoSupported()) {
      setError('Voice recording not available');
      return;
    }
    setError(null);
    try {
      const { Audio } = require('expo-av');
      await Audio.requestPermissionsAsync();
      const { granted } = await Audio.getPermissionsAsync();
      if (!granted) {
        setError('Microphone permission denied');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { recording } = await Audio.Recording.createAsync(
        {
          android: {
            extension: '.m4a',
            outputFormat: Audio.AndroidOutputFormat.MPEG_4,
            audioEncoder: Audio.AndroidAudioEncoder.AAC,
            sampleRate: 22050,
            numberOfChannels: 1,
            bitRate: 32000,
          },
          ios: {
            extension: '.m4a',
            outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
            audioQuality: Audio.IOSAudioQuality.LOW,
            sampleRate: 22050,
            numberOfChannels: 1,
            bitRate: 32000,
          },
          web: {
            mimeType: 'audio/webm',
            bitsPerSecond: 32000,
          },
        },
        (status) => {
          if (status.isRecording && status.durationMillis !== undefined) {
            setDurationMs(status.durationMillis);
          }
        },
        100
      );

      recordingRef.current = recording;
      startTimeRef.current = Date.now();
      elapsedBeforePauseRef.current = 0;
      setState('recording');
      setMeteringData([]);

      meteringIntervalRef.current = setInterval(async () => {
        const rec = recordingRef.current;
        if (!rec) return;
        try {
          const status = await rec.getStatusAsync();
          if (status.isRecording && status.metering !== undefined) {
            const normalized = Math.max(0, Math.min(1, (status.metering + 60) / 60));
            setMeteringData((prev) => {
              const next = [...prev, normalized];
              return next.slice(-WAVEFORM_BAR_COUNT);
            });
          }
        } catch {
          // ignore
        }
      }, METERING_INTERVAL_MS);

      timerRef.current = setInterval(async () => {
        const rec = recordingRef.current;
        if (!rec) return;
        try {
          const status = await rec.getStatusAsync();
          if (status.isRecording && status.durationMillis !== undefined) {
            if (status.durationMillis >= MAX_DURATION_MS) {
              await rec.stopAndUnloadAsync();
              const uri = rec.getURI();
              setFileUri(uri);
              setState('preview');
              if (meteringIntervalRef.current) {
                clearInterval(meteringIntervalRef.current);
                meteringIntervalRef.current = null;
              }
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }
            }
          }
        } catch {
          // ignore
        }
      }, 500);
    } catch (err) {
      console.error('[useVoiceRecorder] Native start error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      setState('idle');
    }
  }, []);

  const pauseRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (rec && state === 'recording') {
      await rec.pauseAsync();
      elapsedBeforePauseRef.current = durationMs;
      if (meteringIntervalRef.current) {
        clearInterval(meteringIntervalRef.current);
        meteringIntervalRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setState('paused');
    }
  }, [state, durationMs]);

  const resumeRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (rec && state === 'paused') {
      await rec.startAsync();
      startTimeRef.current = Date.now();
      meteringIntervalRef.current = setInterval(async () => {
        const r = recordingRef.current;
        if (!r) return;
        try {
          const status = await r.getStatusAsync();
          if (status.isRecording && status.metering !== undefined) {
            const normalized = Math.max(0, Math.min(1, (status.metering + 60) / 60));
            setMeteringData((prev) => {
              const next = [...prev, normalized];
              return next.slice(-WAVEFORM_BAR_COUNT);
            });
          }
        } catch {
          // ignore
        }
      }, METERING_INTERVAL_MS);
      timerRef.current = setInterval(async () => {
        const r = recordingRef.current;
        if (!r) return;
        try {
          const status = await r.getStatusAsync();
          if (status.isRecording && status.durationMillis !== undefined) {
            if (status.durationMillis >= MAX_DURATION_MS) {
              await r.stopAndUnloadAsync();
              const uri = r.getURI();
              setFileUri(uri);
              setState('preview');
              if (meteringIntervalRef.current) {
                clearInterval(meteringIntervalRef.current);
                meteringIntervalRef.current = null;
              }
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }
            }
          }
        } catch {
          // ignore
        }
      }, 500);
      setState('recording');
    }
  }, [state]);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (rec && (state === 'recording' || state === 'paused')) {
      try {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        setFileUri(uri);
        setState('preview');
      } catch (err) {
        console.error('[useVoiceRecorder] Stop error:', err);
        setError(err instanceof Error ? err.message : 'Failed to stop');
        setState('idle');
      }
      if (meteringIntervalRef.current) {
        clearInterval(meteringIntervalRef.current);
        meteringIntervalRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      recordingRef.current = null;
    }
  }, [state]);

  const sendRecording = useCallback(
    async (onSend: (file: { uri: string; name: string; size: number; mimeType: string; waveform: number[]; durationMs: number }) => Promise<void>): Promise<boolean> => {
      if (!fileUri || state !== 'preview') return false;
      setState('sending');
      try {
        let size = 0;
        try {
          const FileSystem = require('expo-file-system/legacy');
          const info = await FileSystem.getInfoAsync(fileUri, { size: true });
          if (info.exists && 'size' in info) {
            size = info.size;
          }
        } catch {
          // Fallback to 0 if we can't get size
        }
        await onSend({
          uri: fileUri,
          name: fileName,
          size,
          mimeType: 'audio/mp4',
          waveform: meteringData,
          durationMs: durationMs,
        });
        deleteRecording();
        return true;
      } catch (err) {
        console.error('[useVoiceRecorder] Send error:', err);
        setError(err instanceof Error ? err.message : 'Failed to send');
        setState('preview');
        return false;
      }
    },
    [fileUri, state, deleteRecording, meteringData, durationMs]
  );

  useEffect(() => () => {
    cleanup();
  }, [cleanup]);

  return {
    state,
    durationMs,
    meteringData,
    fileUri,
    mimeType,
    fileName,
    error,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    deleteRecording,
    sendRecording,
  };
}

export function useVoiceRecorder(): VoiceRecorderResult {
  const isWeb = Platform.OS === 'web';
  const webResult = useVoiceRecorderWeb();
  const nativeResult = useVoiceRecorderNative();
  return isWeb ? webResult : nativeResult;
}
