/**
 * OTAUpdateProvider - Non-blocking OTA update provider
 *
 * Replaces the old blocking OTAUpdateGate. Always renders children
 * immediately and checks for updates in the background.
 *
 * State machine:
 *   idle -> checking -> downloading -> ready | error | idle
 *
 * When an update is ready and the app is backgrounded for 30+ seconds,
 * it will auto-apply the update on next foreground via Updates.reloadAsync().
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';

type OTAStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

interface OTAUpdateContextType {
  status: OTAStatus;
  errorMessage: string | null;
}

const OTAUpdateContext = createContext<OTAUpdateContextType>({
  status: 'idle',
  errorMessage: null,
});

export const useOTAUpdateStatus = () => useContext(OTAUpdateContext);

/** Error codes that should skip the error state and go straight to idle */
const SILENT_ERROR_CODES = [
  'ERR_NOT_COMPATIBLE',
  'ERR_UPDATES_DISABLED',
  'ERR_UPDATES_NOT_INITIALIZED',
];

function isSilentError(error: any): boolean {
  if (SILENT_ERROR_CODES.includes(error?.code)) return true;
  const message = error?.message ?? '';
  if (message.includes('not supported') || message.includes('Updates is not enabled')) return true;
  return false;
}

const BACKGROUND_RELOAD_DELAY_MS = 30_000;

export const OTAUpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<OTAStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const backgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReloadOnForegroundRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  // --- Background update check ---
  const checkForUpdates = useCallback(async () => {
    console.log('[OTAUpdate] Starting update check (v3)...');
    setStatus('checking');
    setErrorMessage(null);

    try {
      console.log('[OTAUpdate] Calling checkForUpdateAsync...');
      const checkResult = await Updates.checkForUpdateAsync();
      console.log('[OTAUpdate] Check result:', checkResult);

      if (checkResult.isAvailable) {
        console.log('[OTAUpdate] Update available, downloading...');
        setStatus('downloading');

        const fetchResult = await Updates.fetchUpdateAsync();
        console.log('[OTAUpdate] Fetch result:', fetchResult);

        if (fetchResult.isNew) {
          console.log('[OTAUpdate] Update downloaded and ready');
          setStatus('ready');
          return;
        }
      }

      console.log('[OTAUpdate] No update needed');
      setStatus('idle');
    } catch (error: any) {
      console.error('[OTAUpdate] Update check failed:', error);

      if (isSilentError(error)) {
        console.log('[OTAUpdate] Known non-critical error, proceeding normally');
        setStatus('idle');
        return;
      }

      const message = error?.message || 'Failed to check for updates';
      console.log('[OTAUpdate] Showing error state:', message);
      setStatus('error');
      setErrorMessage(message);

      // Auto-dismiss error after 5 seconds
      setTimeout(() => {
        setStatus((current) => (current === 'error' ? 'idle' : current));
        setErrorMessage((current) => (current ? null : current));
      }, 5000);
    }
  }, []);

  // --- Mount: check for updates (skip in dev) ---
  useEffect(() => {
    if (__DEV__) {
      console.log('[OTAUpdate] Development mode - skipping update check');
      setStatus('idle');
      return;
    }

    checkForUpdates();
  }, [checkForUpdates]);

  // --- Auto-apply on background ---
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: string) => {
      if (nextAppState === 'background' && statusRef.current === 'ready') {
        console.log('[OTAUpdate] App backgrounded with update ready, starting 30s timer');
        backgroundTimerRef.current = setTimeout(() => {
          console.log('[OTAUpdate] 30s passed in background, will reload on foreground');
          shouldReloadOnForegroundRef.current = true;
          backgroundTimerRef.current = null;
        }, BACKGROUND_RELOAD_DELAY_MS);
      } else if (nextAppState === 'active') {
        // Cancel timer if user returns before 30s
        if (backgroundTimerRef.current) {
          console.log('[OTAUpdate] Returned to foreground before 30s, cancelling timer');
          clearTimeout(backgroundTimerRef.current);
          backgroundTimerRef.current = null;
        }

        // Reload if flag was set
        if (shouldReloadOnForegroundRef.current) {
          console.log('[OTAUpdate] Reloading app with new update');
          shouldReloadOnForegroundRef.current = false;
          Updates.reloadAsync();
        }
      }
    });

    return () => {
      subscription.remove();
      if (backgroundTimerRef.current) {
        clearTimeout(backgroundTimerRef.current);
      }
    };
  }, []);

  return (
    <OTAUpdateContext.Provider value={{ status, errorMessage }}>
      {children}
    </OTAUpdateContext.Provider>
  );
};
