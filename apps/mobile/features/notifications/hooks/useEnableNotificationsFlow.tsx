/**
 * Single source of truth for the push-notification opt-in flow.
 *
 * Two surfaces drive opt-in (the inbox banner and the Settings master toggle)
 * and both need identical behavior across all four permission states. This
 * hook owns the sheet visibility state, the success toast, the routing
 * logic, AND the auto-recovery on app foreground after a Settings hand-off
 * (so any consumer of the hook gets the recovery behavior, not just the
 * banner).
 *
 * Routing:
 *  - granted (app-disabled in our DB) → register token + success toast
 *  - undetermined / denied-with-canAskAgain → show soft-ask sheet → on confirm, OS prompt
 *  - denied-permanent → show coaching sheet → on confirm, Linking.openSettings()
 *  - unsupported (web/sim) → no-op; the surfaces should already hide
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import { useNotifications } from "@providers/NotificationProvider";
import { Toast } from "@components/ui/Toast";
import { NotificationSoftAskSheet } from "../components/NotificationSoftAskSheet";
import { NotificationOpenSettingsSheet } from "../components/NotificationOpenSettingsSheet";
import { openNotificationSettings } from "../utils/openNotificationSettings";

export type EnableFlowResult =
  | "enabled"
  | "denied"
  | "denied-permanent"
  | "unsupported"
  | "cancelled";

interface UseEnableNotificationsFlowReturn {
  /** Kick off the flow. Resolves once the sheet (if any) is dismissed. */
  start: () => Promise<EnableFlowResult>;
  /** Render at the root of the consuming component to mount sheets + toast. */
  flowElements: React.ReactElement;
}

const SUCCESS_TOAST_MESSAGE =
  "Notifications on. Mute individual groups or channels in Settings → Notifications.";

export function useEnableNotificationsFlow(): UseEnableNotificationsFlowReturn {
  const { enableNotifications, getPermissionStatus } = useNotifications();

  const [softAskVisible, setSoftAskVisible] = useState(false);
  const [openSettingsVisible, setOpenSettingsVisible] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  // Stash the resolver so a sheet's button can complete the start() promise.
  const [pendingResolve, setPendingResolve] = useState<
    ((value: EnableFlowResult) => void) | null
  >(null);

  const resolveAndClear = useCallback(
    (value: EnableFlowResult) => {
      pendingResolve?.(value);
      setPendingResolve(null);
    },
    [pendingResolve],
  );

  const start = useCallback(async (): Promise<EnableFlowResult> => {
    const status = await getPermissionStatus();

    if (status === "unsupported") {
      return "unsupported";
    }

    if (status === "granted") {
      // OS already allows; user just needs a token registered (re-enables
      // server-side `notificationsEnabled` since that's derived from token
      // existence).
      const outcome = await enableNotifications();
      if (outcome === "enabled") {
        setToastVisible(true);
        return "enabled";
      }
      return outcome;
    }

    if (status === "denied-permanent") {
      // iOS one-shot already burned. Hand off to Settings via coaching sheet.
      return new Promise<EnableFlowResult>((resolve) => {
        setPendingResolve(() => resolve);
        setOpenSettingsVisible(true);
      });
    }

    // undetermined or denied-with-canAskAgain — soft-ask first.
    return new Promise<EnableFlowResult>((resolve) => {
      setPendingResolve(() => resolve);
      setSoftAskVisible(true);
    });
  }, [enableNotifications, getPermissionStatus]);

  const onSoftAskConfirm = useCallback(async () => {
    setSoftAskVisible(false);
    const outcome = await enableNotifications();
    if (outcome === "enabled") {
      setToastVisible(true);
      resolveAndClear("enabled");
      return;
    }
    if (outcome === "denied-permanent") {
      // User denied at the OS prompt. canAskAgain is now false on iOS — the
      // banner will still be there, but for this turn we don't auto-open
      // Settings (they just made an explicit choice). Just resolve.
      resolveAndClear("denied-permanent");
      return;
    }
    resolveAndClear(outcome);
  }, [enableNotifications, resolveAndClear]);

  const onSoftAskClose = useCallback(() => {
    setSoftAskVisible(false);
    resolveAndClear("cancelled");
  }, [resolveAndClear]);

  // Track whether the user just handed off to OS Settings, so when they
  // foreground the app again we know to re-attempt token registration.
  // Without this, the Settings screen (which uses this hook but doesn't
  // mount its own AppState listener) silently strands users who grant in
  // iOS Settings: status flips to granted but nothing re-registers the
  // token, so `notificationsEnabled` stays false until they manually toggle.
  const handedOffToSettingsRef = useRef(false);

  const onOpenSettings = useCallback(() => {
    setOpenSettingsVisible(false);
    handedOffToSettingsRef.current = true;
    void openNotificationSettings();
    resolveAndClear("denied-permanent");
  }, [resolveAndClear]);

  // Re-check OS state when the app foregrounds. If permission flipped to
  // granted (typical when the user just turned it on in Settings) and the
  // user previously handed off via this flow, silently re-register the
  // token + show the success toast so the opt-in completes without another
  // tap. The check is gated on `handedOffToSettingsRef` to avoid running
  // on every foreground for users who never opened Settings via this hook.
  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      async (next: AppStateStatus) => {
        if (next !== "active") return;
        if (!handedOffToSettingsRef.current) return;
        const status = await getPermissionStatus();
        if (status === "granted") {
          handedOffToSettingsRef.current = false;
          const outcome = await enableNotifications();
          if (outcome === "enabled") {
            setToastVisible(true);
          }
        }
      },
    );
    return () => sub.remove();
  }, [enableNotifications, getPermissionStatus]);

  const onOpenSettingsClose = useCallback(() => {
    setOpenSettingsVisible(false);
    resolveAndClear("cancelled");
  }, [resolveAndClear]);

  const flowElements = (
    <>
      <NotificationSoftAskSheet
        visible={softAskVisible}
        onClose={onSoftAskClose}
        onConfirm={onSoftAskConfirm}
      />
      <NotificationOpenSettingsSheet
        visible={openSettingsVisible}
        onClose={onOpenSettingsClose}
        onOpenSettings={onOpenSettings}
      />
      <Toast
        visible={toastVisible}
        message={SUCCESS_TOAST_MESSAGE}
        type="success"
        duration={5000}
        position="top"
        onClose={() => setToastVisible(false)}
      />
    </>
  );

  return { start, flowElements };
}
