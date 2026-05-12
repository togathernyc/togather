/**
 * PostUpdateRecoveryBanner
 *
 * Renders a one-shot informational banner the first time the app boots
 * onto a new OTA bundle. Backstop for the iOS + Fabric touch-reattach
 * race that can wedge the UI after a foreground reloadAsync: the JS
 * thread keeps running so this banner still appears, telling the user
 * how to recover (force-close + reopen) even when taps are dead.
 *
 * Detection: compare Updates.updateId against the last value we
 * persisted to AsyncStorage. If both are present and they differ, the
 * app just transitioned to a new bundle — show the banner. On the
 * very first launch (no stored value) we silently persist and skip
 * the banner, since there's nothing to recover from.
 *
 * Auto-dismisses after AUTO_DISMISS_MS (wedged users can't tap, but JS
 * setTimeout still fires). Tap-X works for non-wedged users.
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEY = '@togather/last_seen_update_id';
export const AUTO_DISMISS_MS = 60_000;

export function PostUpdateRecoveryBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // StatusBarAwareContainer only adds bottom inset padding; on iOS notched
  // devices and Android edge-to-edge builds the banner would otherwise sit
  // under the status bar, obscuring the recovery instruction in exactly the
  // post-update case it is meant to address (codex P2 on PR #393).
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (__DEV__) return;

    let cancelled = false;

    (async () => {
      const currentUpdateId = Updates.updateId;
      // Embedded launches have no updateId — there's no transition to
      // recover from.
      if (!currentUpdateId) return;

      let stored: string | null = null;
      try {
        stored = await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        // AsyncStorage unavailable — fail open, no banner.
        return;
      }

      if (cancelled) return;

      // Persist the current id either way so the banner is one-shot.
      try {
        await AsyncStorage.setItem(STORAGE_KEY, currentUpdateId);
      } catch {
        // Best effort — if the write fails, we may show the banner again
        // next launch. Acceptable.
      }

      // First-ever launch (or fresh install / cleared storage): nothing
      // to recover from. Silently seed the value and skip.
      if (!stored) return;

      // Same id: no transition happened.
      if (stored === currentUpdateId) return;

      // We just transitioned to a new bundle.
      setIsVisible(true);
      dismissTimerRef.current = setTimeout(() => {
        setIsVisible(false);
      }, AUTO_DISMISS_MS);
    })();

    return () => {
      cancelled = true;
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handleDismiss = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <View style={[styles.container, { paddingTop: 10 + insets.top }]}>
      <Ionicons name="information-circle" size={18} color="#fff" style={styles.icon} />
      <Text style={styles.text}>
        App just updated — if anything feels stuck, force-close and reopen.
      </Text>
      <Pressable
        style={styles.dismissButton}
        onPress={handleDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel="Dismiss update notice"
      >
        <Ionicons name="close" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    // paddingTop is applied inline together with the top safe-area inset.
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: '#1F2937',
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  dismissButton: {
    padding: 4,
    marginLeft: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : {}),
  },
});
