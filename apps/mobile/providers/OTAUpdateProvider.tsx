/**
 * OTAUpdateProvider - OTA update provider with silent + forced delivery
 *
 * Checks for updates on mount and every time the app returns to the
 * foreground. Whether an available update is applied silently or forced is
 * decided by a monotonic "forced floor" serial stamped into every update's
 * manifest at publish time (extra.otaForcedSerial, set by the Deploy to
 * Production workflow). It is bumped only on a forced deploy and carried
 * forward unchanged on silent deploys.
 *
 *   - incoming serial <= running serial → SILENT: download the bundle in the
 *     background and let expo-updates apply it on the next cold start. No
 *     modal, no reload. The right behavior for routine frontend changes —
 *     users stop seeing the "Updating" modal on every deploy.
 *   - incoming serial  > running serial → FORCED: a forced release has shipped
 *     that this bundle predates. Download now behind the blocking
 *     OTAUpdateModal and reloadAsync immediately. Reserved for breaking
 *     frontend<->backend contract changes and big features.
 *
 * Because the floor is sticky (a later silent release still carries the last
 * forced serial), a device that missed the forced window force-reloads on its
 * next check even if a silent release has since superseded the forced one.
 *
 * A missing/garbled serial reads as 0, so it can never accidentally exceed the
 * running serial and surprise users with a forced reload.
 *
 * Check failures (including offline) are silent: status returns to 'idle' and
 * the user keeps using the current build.
 *
 * State machine:
 *   idle -> checking -> (downloading -> ready -> reload)   // forced
 *                     | (staging -> idle)                  // silent
 *                     | idle                               // nothing to do
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

// 'downloading' and 'ready' belong to the forced flow and drive the visible
// OTAUpdateModal. 'staging' is the silent flow's background download — it must
// NOT show the modal, so the modal deliberately excludes it.
type OTAStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'staging' | 'error';

interface OTAUpdateContextType {
  status: OTAStatus;
  errorMessage: string | null;
}

/**
 * Read the forced-floor serial off a manifest. EAS Update nests the app config
 * under manifest.extra.expoClient, so our value lives at
 * extra.expoClient.extra.otaForcedSerial. Any missing or non-numeric value
 * reads as 0 — the lowest possible floor — so it can never spuriously exceed a
 * running serial and trigger an unwanted forced reload.
 */
export function readForcedSerial(manifest: unknown): number {
  const raw = (manifest as any)?.extra?.expoClient?.extra?.otaForcedSerial;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : 0;
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

  // The id of the silent update already downloaded this session, if any. We
  // keep re-checking (a later deploy may be forced and must still win), but
  // skip re-downloading this exact bundle on every foreground.
  const stagedSilentUpdateIdRef = useRef<string | null>(null);

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

      const manifest = (checkResult as any).manifest;
      const updateId: string | null = manifest?.id ?? null;

      // Forced iff the incoming update carries a higher forced-floor serial than
      // the bundle we're running. A forced release bumps the floor; silent
      // releases carry it forward, so this stays true for a device that missed
      // the forced window even when a later silent release supersedes it.
      const incomingForcedSerial = readForcedSerial(manifest);
      const runningForcedSerial = readForcedSerial((Updates as any).manifest);
      const isForced = incomingForcedSerial > runningForcedSerial;

      if (!isForced) {
        // Already downloaded this exact bundle this session — it's waiting for
        // the next cold start. Skip the redundant re-fetch, but note we did NOT
        // bail before checkForUpdateAsync: a later forced deploy carries a
        // higher serial and still gets handled below.
        if (updateId && updateId === stagedSilentUpdateIdRef.current) {
          crumb('OTA silent update already staged, skipping re-fetch', { updateId });
          setStatus('idle');
          return;
        }

        // Background download, no UI. expo-updates launches the most recently
        // downloaded bundle on the next cold start, so staging it is enough —
        // we never reload mid-session.
        crumb('OTA silent update available, staging in background', {
          incomingForcedSerial,
          runningForcedSerial,
        });
        setStatus('staging');
        const fetchResult = await Updates.fetchUpdateAsync();

        if (fetchResult.isNew) {
          stagedSilentUpdateIdRef.current = updateId;
          crumb('OTA staged silently; will apply on next launch', { updateId });
        } else {
          crumb('OTA silent fetch returned no new bundle');
        }
        setStatus('idle');
        return;
      }

      crumb('OTA forced update available, downloading', {
        incomingForcedSerial,
        runningForcedSerial,
      });
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

  // Re-check on real background -> active transitions only. iOS reports
  // 'inactive' for transient system UI (Notification Center, incoming
  // calls, Control Center, Face ID, share sheets) — the app never
  // actually suspends and the previous state goes active -> inactive ->
  // active. Treating those as resumes would trigger a destructive
  // reloadAsync over a still-live UI. Only an actual 'background' state
  // (the OS marked the app as suspended) qualifies.
  useEffect(() => {
    if (__DEV__) return;

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const previousAppState = previousAppStateRef.current;
      previousAppStateRef.current = nextAppState;

      const cameFromBackground = previousAppState === 'background';
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
