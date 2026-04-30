/**
 * Single source of truth for the push-notification opt-in flow.
 *
 * Two surfaces drive opt-in (the inbox banner and the Settings master toggle)
 * and both need identical behavior across all four permission states. This
 * hook owns the sheet visibility state, the success toast, and the routing
 * logic; the surfaces just call `start()` and render `<>{flowElements}</>`.
 *
 * Routing:
 *  - granted (app-disabled in our DB) → register token + success toast
 *  - undetermined / denied-with-canAskAgain → show soft-ask sheet → on confirm, OS prompt
 *  - denied-permanent → show coaching sheet → on confirm, Linking.openSettings()
 *  - unsupported (web/sim) → no-op; the surfaces should already hide
 */
import React, { useCallback, useState } from "react";
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

  const onOpenSettings = useCallback(() => {
    setOpenSettingsVisible(false);
    void openNotificationSettings();
    resolveAndClear("denied-permanent");
  }, [resolveAndClear]);

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
