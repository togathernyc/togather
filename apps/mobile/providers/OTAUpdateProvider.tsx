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
 *
 * Safety guards (to mitigate post-reload UI-freeze on iOS + Fabric):
 *   - STARTUP_GRACE_MS — refuse to reload until the JS session has been
 *     alive for this long. Protects the cold-start redirect window
 *     (Index -> /(tabs)/chat) and any opening animations.
 *   - MIN_RECHECK_INTERVAL_MS — throttle foreground re-checks. iOS fires
 *     'active' transitions for system permission/share-sheet dismissal that
 *     are not real user resumes; without a throttle the provider could
 *     re-enter checkAndApply on every one.
 *   - AppState previous-state guard — only re-check on a real
 *     background->active transition, not active->active re-entries.
 *   - PRE_RELOAD_SETTLE_MS — after fetch completes, hold on the 'ready'
 *     state (OTAUpdateModal full-screen) for a beat before calling
 *     reloadAsync. Gives any in-flight animations and touch responders
 *     a chance to drain before the JS context is recreated.
 *
 * Breadcrumbs are emitted at every transition so production behavior is
 * visible in Sentry — required because this flow is unreproducible in dev
 * (the __DEV__ short-circuit below means it never runs locally).
 */
import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
import { SentryUtils } from './SentryProvider';

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

// Tuning constants — exported for tests.
export const STARTUP_GRACE_MS = 30_000;
export const MIN_RECHECK_INTERVAL_MS = 5 * 60_000;
export const PRE_RELOAD_SETTLE_MS = 1_500;

export const OTAUpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<OTAStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const statusRef = useRef(status);
  statusRef.current = status;

  const sessionStartRef = useRef(Date.now());
  const lastCheckRef = useRef(0);
  const previousAppStateRef = useRef<AppStateStatus>(AppState.currentState);

  const crumb = (message: string, data?: Record<string, unknown>) => {
    SentryUtils.addBreadcrumb(message, 'ota-update', data);
  };

  const checkAndApply = useCallback(async (trigger: 'mount' | 'foreground') => {
    // Don't re-enter if a check / download / reload is already in flight.
    if (statusRef.current !== 'idle') {
      crumb('OTA check skipped: already in flight', { trigger, status: statusRef.current });
      return;
    }

    // Startup grace: don't reload during the cold-start window where Index
    // is still redirecting and the initial navigators are mounting. A
    // reloadAsync that lands here is the most likely cause of the post-
    // reload touch-handler wedge.
    const sessionAgeMs = Date.now() - sessionStartRef.current;
    if (sessionAgeMs < STARTUP_GRACE_MS) {
      crumb('OTA check skipped: startup grace', { trigger, sessionAgeMs });
      return;
    }

    // Throttle: iOS fires 'active' transitions for system dialogs / share
    // sheets / Face ID prompts. Without a throttle each one would re-run
    // checkAndApply, and a flapping system event could race with the
    // reload.
    const sinceLastCheckMs = Date.now() - lastCheckRef.current;
    if (lastCheckRef.current > 0 && sinceLastCheckMs < MIN_RECHECK_INTERVAL_MS) {
      crumb('OTA check skipped: throttled', { trigger, sinceLastCheckMs });
      return;
    }

    lastCheckRef.current = Date.now();
    crumb('OTA check started', { trigger });
    setStatus('checking');
    setErrorMessage(null);

    try {
      const checkResult = await Updates.checkForUpdateAsync();

      if (!checkResult.isAvailable) {
        crumb('OTA no update available');
        setStatus('idle');
        return;
      }

      crumb('OTA update available, downloading');
      setStatus('downloading');
      const fetchResult = await Updates.fetchUpdateAsync();

      if (!fetchResult.isNew) {
        crumb('OTA fetched but not new, staying idle');
        setStatus('idle');
        return;
      }

      crumb('OTA update ready, holding for settle', { settleMs: PRE_RELOAD_SETTLE_MS });
      setStatus('ready');

      // Hold on 'ready' (OTAUpdateModal full-screen) for a beat before
      // tearing down the JS context. Lets any in-flight animations and
      // touch responders drain. Calling reloadAsync immediately after
      // a state transition is the documented footgun.
      await new Promise((resolve) => setTimeout(resolve, PRE_RELOAD_SETTLE_MS));

      crumb('OTA reload starting');
      await Updates.reloadAsync();
    } catch (error: any) {
      // All failures — offline, disabled, server errors — are silent.
      // The user keeps using the current build; we'll try again next
      // qualifying foreground transition.
      crumb('OTA check failed (silent)', { error: error?.message ?? String(error) });
      setStatus('idle');
      setErrorMessage(null);
    }
  }, []);

  // Defer the initial mount check until after the startup grace window.
  // Firing immediately would self-skip via the grace guard inside
  // checkAndApply, and — if the user never backgrounds — no later
  // foreground transition would ever retry. That regresses the forced
  // auto-apply requirement (raised by codex on PR #392).
  useEffect(() => {
    if (__DEV__) {
      console.log('[OTAUpdate] Development mode - skipping update check');
      setStatus('idle');
      return;
    }

    const timeoutId = setTimeout(() => {
      checkAndApply('mount');
    }, STARTUP_GRACE_MS);

    return () => clearTimeout(timeoutId);
  }, [checkAndApply]);

  // Re-check on real background -> active transitions only. iOS fires
  // 'active' for transient system UI (Face ID, share sheets, permissions)
  // without backgrounding the app; those should not retrigger a check.
  useEffect(() => {
    if (__DEV__) return;

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const previousAppState = previousAppStateRef.current;
      previousAppStateRef.current = nextAppState;

      const cameFromBackground = !!previousAppState.match(/inactive|background/);
      if (nextAppState === 'active' && cameFromBackground) {
        checkAndApply('foreground');
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
