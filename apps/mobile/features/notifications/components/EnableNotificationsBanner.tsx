/**
 * Persistent inbox CTA prompting users to enable push notifications.
 *
 * Visibility rules:
 *  - Hidden on web, simulator, or while expo-notifications can't load
 *  - Hidden while preferences are loading
 *  - Hidden if push is fully working (OS-granted AND token registered server-side)
 *  - Hidden if the user soft-dismissed it within the last 7 days
 *
 * Tapping "Turn on" delegates to `useEnableNotificationsFlow`, which routes
 * to a soft-ask sheet, the OS prompt, or a Settings hand-off depending on
 * the current permission state.
 *
 * Auto-recovery: when the app foregrounds and the OS now reports granted
 * (e.g. user just flipped the toggle in iOS Settings) but our DB token is
 * missing, we silently re-register the token. This closes the gap where a
 * user comes back from Settings expecting things to "just work".
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  AppStateStatus,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { api, useQuery, useStoredAuthToken } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import {
  useNotifications,
  type PushPermissionStatus,
} from "@providers/NotificationProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useEnableNotificationsFlow } from "../hooks/useEnableNotificationsFlow";

const SNOOZE_KEY_PREFIX = "enable_notifications_banner_snoozed_until:";
const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function snoozeKey(userId: string | undefined): string | null {
  if (!userId) return null;
  return `${SNOOZE_KEY_PREFIX}${userId}`;
}

export function EnableNotificationsBanner() {
  const { user } = useAuth();
  const token = useStoredAuthToken();
  const { primaryColor } = useCommunityTheme();
  const { getPermissionStatus, enableNotifications } = useNotifications();
  const { start, flowElements } = useEnableNotificationsFlow();

  const userId = user?.id ? String(user.id) : undefined;

  // Server-side notifications-enabled flag (true iff push token exists).
  const preferences = useQuery(
    api.functions.notifications.preferences.preferences,
    token ? { token } : "skip",
  );

  const [osStatus, setOsStatus] = useState<PushPermissionStatus | null>(null);
  const [snoozeChecked, setSnoozeChecked] = useState(false);
  const [isSnoozed, setIsSnoozed] = useState(false);
  // Track previous OS status across app-state changes so we can detect the
  // "user just granted in Settings" transition and silently register the token.
  const lastOsStatusRef = useRef<PushPermissionStatus | null>(null);

  const refreshOsStatus = useCallback(async () => {
    const status = await getPermissionStatus();
    setOsStatus(status);

    // Auto-recover: OS-granted now but token missing → register quietly.
    const previous = lastOsStatusRef.current;
    lastOsStatusRef.current = status;
    if (
      previous !== null &&
      previous !== "granted" &&
      status === "granted" &&
      preferences?.notificationsEnabled === false
    ) {
      void enableNotifications();
    }
  }, [enableNotifications, getPermissionStatus, preferences?.notificationsEnabled]);

  // Initial OS-status read.
  useEffect(() => {
    void refreshOsStatus();
  }, [refreshOsStatus]);

  // Re-read OS status when the app foregrounds (handles return-from-Settings).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        void refreshOsStatus();
      }
    });
    return () => sub.remove();
  }, [refreshOsStatus]);

  // Read snooze flag from storage.
  useEffect(() => {
    let cancelled = false;
    const key = snoozeKey(userId);
    if (!key) {
      setSnoozeChecked(true);
      setIsSnoozed(false);
      return;
    }
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled) return;
        const until = raw ? Number(raw) : 0;
        setIsSnoozed(Number.isFinite(until) && until > Date.now());
        setSnoozeChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        setIsSnoozed(false);
        setSnoozeChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleDismiss = useCallback(() => {
    setIsSnoozed(true);
    const key = snoozeKey(userId);
    if (!key) return;
    void AsyncStorage.setItem(key, String(Date.now() + SNOOZE_DURATION_MS));
  }, [userId]);

  const handleTurnOn = useCallback(async () => {
    const result = await start();
    // If user successfully enabled, the preferences query will reactively
    // flip and the banner will hide on its own. If they cancelled or denied,
    // the banner stays — that's the persistence the product needs.
    if (result === "enabled") {
      // Belt-and-suspenders: clear any stale snooze so the banner doesn't
      // come back on the next session if the user re-disables.
      const key = snoozeKey(userId);
      if (key) {
        void AsyncStorage.removeItem(key);
      }
    }
  }, [start, userId]);

  // Visibility gating. We render `flowElements` even when the banner is
  // hidden so any in-flight sheet/toast can finish animating out.
  const shouldShow = (() => {
    if (Platform.OS === "web") return false;
    if (osStatus === null) return false; // initial load
    if (osStatus === "unsupported") return false; // simulator, missing module
    if (preferences === undefined) return false; // query loading
    if (!snoozeChecked) return false;
    if (isSnoozed) return false;
    // Banner shows if push isn't fully working: either OS not granted, or
    // OS granted but no token in our DB (user previously toggled off).
    const tokenRegistered = preferences.notificationsEnabled === true;
    if (osStatus === "granted" && tokenRegistered) return false;
    return true;
  })();

  if (!shouldShow) {
    return flowElements;
  }

  return (
    <>
      <View style={[styles.container, { backgroundColor: primaryColor }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Turn on notifications"
          onPress={handleTurnOn}
          style={styles.content}
        >
          <View style={styles.iconWrap}>
            <Ionicons name="notifications" size={20} color="#fff" />
          </View>
          <View style={styles.text}>
            <Text style={styles.title}>Stay in the loop with your community</Text>
            <Text style={styles.subtitle}>
              Turn on notifications to hear from your groups. You can mute
              individual groups or channels in Settings anytime.
            </Text>
          </View>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Turn on</Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss for 7 days"
          onPress={handleDismiss}
          style={styles.dismiss}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={16} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </View>
      {flowElements}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 12,
  },
  content: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    ...(Platform.OS === "web" ? { cursor: "pointer" as any } : {}),
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  text: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  subtitle: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  cta: {
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginRight: 4,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#000",
  },
  dismiss: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    ...(Platform.OS === "web" ? { cursor: "pointer" as any } : {}),
  },
});
