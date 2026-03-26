/**
 * useVoiceRecorder - Voice memo recording hook
 *
 * Supports both native (expo-audio, with expo-av fallback) and web (MediaRecorder API).
 * WhatsApp-inspired recording with live waveform, pause/resume, and preview.
 *
 * State machine: IDLE -> RECORDING <-> PAUSED -> PREVIEW -> SENDING -> IDLE
 *
 * Gated: Uses dynamic require for expo-audio / expo-av on native. Add to check-native-imports allowlist.
 */

import { useState, useCallback, useRef, useEffect, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';
import { Platform } from 'react-native';
import { isAudioSupported, isAudioVideoSupported } from '../utils/fileTypes';

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

/**
 * Tracks which recording backend is in use so cleanup knows which API to call.
 * 'expo-audio' = new expo-audio AudioRecorder
 * 'expo-av'    = legacy expo-av Audio.Recording
 */
type RecordingBackend = 'expo-audio' | 'expo-av';

/**
 * Helper: reset iOS audio mode to playback (speaker, not earpiece).
 * Tries expo-audio first, falls back to expo-av.
 */
async function resetToPlaybackMode(): Promise<void> {
  try {
    if (isAudioSupported()) {
      const ExpoAudio = require('expo-audio');
      await ExpoAudio.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } else {
      const { Audio } = require('expo-av');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    }
  } catch {
    // best-effort
  }
}

/**
 * Helper: clear metering + timer intervals
 */
function clearIntervals(
  meteringRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
  timerRef: MutableRefObject<ReturnType<typeof setInterval> | null>
) {
  if (meteringRef.current) {
    clearInterval(meteringRef.current);
    meteringRef.current = null;
  }
  if (timerRef.current) {
    clearInterval(timerRef.current);
    timerRef.current = null;
  }
}

/**
 * Start metering + duration polling intervals for expo-audio recorder.
 * Returns cleanup function. The recorder uses getStatus() which returns RecorderState.
 */
function startExpoAudioIntervals(
  recorderRef: MutableRefObject<any>,
  meteringIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
  timerRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
  setMeteringData: Dispatch<SetStateAction<number[]>>,
  setDurationMs: Dispatch<SetStateAction<number>>,
  setFileUri: Dispatch<SetStateAction<string | null>>,
  setState: Dispatch<SetStateAction<VoiceRecorderState>>,
  onAutoStop: () => void
) {
  // Metering: poll getStatus() for metering values
  meteringIntervalRef.current = setInterval(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      const status = rec.getStatus();
      if (status.isRecording && status.metering !== undefined) {
        const normalized = Math.max(0, Math.min(1, (status.metering + 60) / 60));
        setMeteringData((prev) => {
          const next = [...prev, normalized];
          return next.slice(-WAVEFORM_BAR_COUNT);
        });
      }
      // Also update duration from status
      if (status.isRecording && status.durationMillis !== undefined) {
        setDurationMs(status.durationMillis);
      }
    } catch {
      // ignore
    }
  }, METERING_INTERVAL_MS);

  // Max duration check
  timerRef.current = setInterval(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      const status = rec.getStatus();
      if (status.isRecording && status.durationMillis >= MAX_DURATION_MS) {
        await rec.stop();
        const uri = rec.uri;
        setFileUri(uri);
        setState('preview');
        await resetToPlaybackMode();
        onAutoStop();
      }
    } catch {
      // ignore
    }
  }, 500);
}

/**
 * Start metering + duration polling intervals for expo-av recorder (fallback).
 */
function startExpoAvIntervals(
  recorderRef: MutableRefObject<any>,
  meteringIntervalRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
  timerRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
  setMeteringData: Dispatch<SetStateAction<number[]>>,
  setFileUri: Dispatch<SetStateAction<string | null>>,
  setState: Dispatch<SetStateAction<VoiceRecorderState>>,
  onAutoStop: () => void
) {
  meteringIntervalRef.current = setInterval(async () => {
    const rec = recorderRef.current;
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
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      const status = await rec.getStatusAsync();
      if (status.isRecording && status.durationMillis !== undefined) {
        if (status.durationMillis >= MAX_DURATION_MS) {
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          setFileUri(uri);
          setState('preview');
          await resetToPlaybackMode();
          onAutoStop();
        }
      }
    } catch {
      // ignore
    }
  }, 500);
}

function useVoiceRecorderNative(): VoiceRecorderResult {
  const [state, setState] = useState<VoiceRecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [meteringData, setMeteringData] = useState<number[]>([]);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recordingRef = useRef<any>(null);
  const backendRef = useRef<RecordingBackend>('expo-audio');
  const meteringIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedBeforePauseRef = useRef<number>(0);

  const mimeType = 'audio/mp4';
  const fileName = 'voice-memo.m4a';

  const clearTimers = useCallback(() => {
    clearIntervals(meteringIntervalRef, timerRef);
  }, []);

  const cleanup = useCallback(async () => {
    clearTimers();
    const rec = recordingRef.current;
    if (rec) {
      try {
        if (backendRef.current === 'expo-audio') {
          // expo-audio: stop() returns a promise
          const status = rec.getStatus();
          if (status.isRecording || status.canRecord) {
            await rec.stop();
          }
        } else {
          // expo-av fallback
          const status = await rec.getStatusAsync();
          if (status.canRecord) {
            await rec.stopAndUnloadAsync();
          }
        }
      } catch {
        // ignore
      }
      recordingRef.current = null;
      await resetToPlaybackMode();
    }
  }, [clearTimers]);

  const deleteRecording = useCallback(() => {
    cleanup();
    setState('idle');
    setDurationMs(0);
    setMeteringData([]);
    setFileUri(null);
    setError(null);
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    const useExpoAudio = isAudioSupported();
    const useExpoAv = !useExpoAudio && isAudioVideoSupported();

    if (!useExpoAudio && !useExpoAv) {
      setError('Voice recording not available');
      return;
    }
    setError(null);

    if (useExpoAudio) {
      backendRef.current = 'expo-audio';
      try {
        const ExpoAudio = require('expo-audio');

        await ExpoAudio.requestRecordingPermissionsAsync();
        const { granted } = await ExpoAudio.getRecordingPermissionsAsync();
        if (!granted) {
          setError('Microphone permission denied');
          return;
        }

        // Retry setup with backoff for iOS post-permission-dialog background state
        let recorder: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await ExpoAudio.setAudioModeAsync({
              allowsRecording: true,
              playsInSilentMode: true,
              shouldPlayInBackground: false,
              interruptionMode: 'duckOthers' as const,
              shouldRouteThroughEarpiece: false,
            });

            // Create recorder and prepare with our voice memo config.
            // Pass recording options to prepareToRecordAsync which handles
            // platform-specific option flattening internally.
            const recordingOptions = {
              isMeteringEnabled: true,
              extension: '.m4a',
              sampleRate: 22050,
              numberOfChannels: 1,
              bitRate: 32000,
              android: {
                outputFormat: 'mpeg4' as const,
                audioEncoder: 'aac' as const,
              },
              ios: {
                outputFormat: ExpoAudio.IOSOutputFormat.MPEG4AAC,
                audioQuality: ExpoAudio.AudioQuality.LOW,
              },
              web: {
                mimeType: 'audio/webm',
                bitsPerSecond: 32000,
              },
            };
            recorder = new ExpoAudio.AudioRecorder(recordingOptions);
            await recorder.prepareToRecordAsync(recordingOptions);
            recorder.record();
            break;
          } catch (setupErr: any) {
            const isBgError = setupErr?.message?.includes('background') ||
              setupErr?.message?.includes('audio session could not be activated');
            if (isBgError && attempt < 4) {
              await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
            } else {
              throw setupErr;
            }
          }
        }
        if (!recorder) return;

        recordingRef.current = recorder;
        startTimeRef.current = Date.now();
        elapsedBeforePauseRef.current = 0;
        setState('recording');
        setMeteringData([]);

        startExpoAudioIntervals(
          recordingRef,
          meteringIntervalRef,
          timerRef,
          setMeteringData,
          setDurationMs,
          setFileUri,
          setState,
          clearTimers
        );
      } catch (err) {
        console.error('[useVoiceRecorder] expo-audio start error:', err);
        setError(err instanceof Error ? err.message : 'Failed to start recording');
        setState('idle');
      }
    } else {
      // expo-av fallback
      backendRef.current = 'expo-av';
      try {
        const { Audio } = require('expo-av');
        await Audio.requestPermissionsAsync();
        const { granted } = await Audio.getPermissionsAsync();
        if (!granted) {
          setError('Microphone permission denied');
          return;
        }

        let recording: any = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await Audio.setAudioModeAsync({
              allowsRecordingIOS: true,
              playsInSilentModeIOS: true,
              staysActiveInBackground: false,
              shouldDuckAndroid: true,
              playThroughEarpieceAndroid: false,
            });

            const result = await Audio.Recording.createAsync(
              {
                isMeteringEnabled: true,
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
              (status: any) => {
                if (status.isRecording && status.durationMillis !== undefined) {
                  setDurationMs(status.durationMillis);
                }
              },
              100
            );
            recording = result.recording;
            break;
          } catch (setupErr: any) {
            const isBgError = setupErr?.message?.includes('background') ||
              setupErr?.message?.includes('audio session could not be activated');
            if (isBgError && attempt < 4) {
              await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
            } else {
              throw setupErr;
            }
          }
        }
        if (!recording) return;

        recordingRef.current = recording;
        startTimeRef.current = Date.now();
        elapsedBeforePauseRef.current = 0;
        setState('recording');
        setMeteringData([]);

        startExpoAvIntervals(
          recordingRef,
          meteringIntervalRef,
          timerRef,
          setMeteringData,
          setFileUri,
          setState,
          clearTimers
        );
      } catch (err) {
        console.error('[useVoiceRecorder] expo-av start error:', err);
        setError(err instanceof Error ? err.message : 'Failed to start recording');
        setState('idle');
      }
    }
  }, [clearTimers]);

  const pauseRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (rec && state === 'recording') {
      if (backendRef.current === 'expo-audio') {
        rec.pause();
      } else {
        await rec.pauseAsync();
      }
      elapsedBeforePauseRef.current = durationMs;
      clearTimers();
      setState('paused');
    }
  }, [state, durationMs, clearTimers]);

  const resumeRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (rec && state === 'paused') {
      if (backendRef.current === 'expo-audio') {
        rec.record();
        startTimeRef.current = Date.now();
        startExpoAudioIntervals(
          recordingRef,
          meteringIntervalRef,
          timerRef,
          setMeteringData,
          setDurationMs,
          setFileUri,
          setState,
          clearTimers
        );
      } else {
        await rec.startAsync();
        startTimeRef.current = Date.now();
        startExpoAvIntervals(
          recordingRef,
          meteringIntervalRef,
          timerRef,
          setMeteringData,
          setFileUri,
          setState,
          clearTimers
        );
      }
      setState('recording');
    }
  }, [state, clearTimers]);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (rec && (state === 'recording' || state === 'paused')) {
      try {
        if (backendRef.current === 'expo-audio') {
          await rec.stop();
          const uri = rec.uri;
          setFileUri(uri);
        } else {
          await rec.stopAndUnloadAsync();
          const uri = rec.getURI();
          setFileUri(uri);
        }
        setState('preview');

        // Switch back to playback mode so audio plays through the speaker
        // instead of the earpiece. Without this, all playback after recording
        // is routed to the earpiece and sounds inaudible.
        await resetToPlaybackMode();
      } catch (err) {
        console.error('[useVoiceRecorder] Stop error:', err);
        setError(err instanceof Error ? err.message : 'Failed to stop');
        setState('idle');
      }
      clearTimers();
      recordingRef.current = null;
    }
  }, [state, clearTimers]);

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
