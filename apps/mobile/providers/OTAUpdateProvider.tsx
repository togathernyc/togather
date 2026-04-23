/**
 * OTAUpdateProvider - Auto-applying OTA update provider
 *
 * Checks for updates on mount and every time the app returns to the
 * foreground. If an update exists, downloads it and auto-applies it via
 * Updates.reloadAsync — no user action required. Check failures (including
 * offline) are silent: status returns to 'idle' and the user keeps using the
 * current build.
 *
 * State machine:
 *   idle -> checking -> (downloading -> ready -> reload) | idle
 */
import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from 'react';
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

export const OTAUpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<OTAStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const statusRef = useRef(status);
  statusRef.current = status;

  const checkAndApply = useCallback(async () => {
    // Don't re-enter if a check / download / reload is already in flight.
    if (statusRef.current !== 'idle') return;

    console.log('[OTAUpdate] Starting update check...');
    setStatus('checking');
    setErrorMessage(null);

    try {
      const checkResult = await Updates.checkForUpdateAsync();

      if (!checkResult.isAvailable) {
        console.log('[OTAUpdate] No update available');
        setStatus('idle');
        return;
      }

      console.log('[OTAUpdate] Update available, downloading...');
      setStatus('downloading');
      const fetchResult = await Updates.fetchUpdateAsync();

      if (!fetchResult.isNew) {
        console.log('[OTAUpdate] Fetched, but not new — staying idle');
        setStatus('idle');
        return;
      }

      console.log('[OTAUpdate] Update ready, auto-applying');
      setStatus('ready');
      await Updates.reloadAsync();
    } catch (error: any) {
      // All failures — offline, disabled, server errors — are silent.
      // The user keeps using the current build; we'll try again next foreground.
      console.log('[OTAUpdate] Update check/apply failed (silent):', error?.message ?? error);
      setStatus('idle');
      setErrorMessage(null);
    }
  }, []);

  // Run on mount.
  useEffect(() => {
    if (__DEV__) {
      console.log('[OTAUpdate] Development mode - skipping update check');
      setStatus('idle');
      return;
    }

    checkAndApply();
  }, [checkAndApply]);

  // Re-check every time the app returns to foreground.
  useEffect(() => {
    if (__DEV__) return;

    const subscription = AppState.addEventListener('change', (nextAppState: string) => {
      if (nextAppState === 'active') {
        checkAndApply();
      }
    });

    return () => subscription.remove();
  }, [checkAndApply]);

  const contextValue = useMemo(
    () => ({ status, errorMessage }),
    [status, errorMessage]
  );

  return (
    <OTAUpdateContext.Provider value={contextValue}>
      {children}
    </OTAUpdateContext.Provider>
  );
};
