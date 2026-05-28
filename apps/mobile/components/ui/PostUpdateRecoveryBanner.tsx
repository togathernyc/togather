/**
 * PostUpdateRecoveryBanner
 *
 * Renders a one-shot informational banner the first time the app boots
 * onto a new OTA bundle. Backstop for the iOS + Fabric touch-reattach
 * race that can wedge the UI after a foreground reloadAsync: the JS
 * thread keeps running so this banner still appears, telling the user
 * how to recover (force-close + reopen) even when taps are dead.
 *
 * Detection: bail entirely on embedded launches (Updates.isEmbeddedLaunch
 * = true — fresh installs, App Store updates, emergency fallback to the
 * embedded bundle); none of those carry a reloadAsync race. On OTA
 * bundles, compare Updates.updateId against the value persisted to
 * AsyncStorage from the previous OTA launch and show the banner if it's
 * absent (first OTA launch with the banner code on this user's device,
 * or first OTA after a native install) or different (a real OTA
 * transition). The current id is then persisted so the banner is
 * one-shot per bundle.
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
export const AUTO_DISMISS_MS = 5_000;

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
      // Bail out on embedded launches BEFORE touching storage. The
      // embedded bundle's updateId changes with every native (App Store)
      // update; reading and overwriting our stored OTA id here would
      // falsely flag a native install as an OTA transition AND would
      // corrupt the baseline for detecting the next *real* OTA. Native
      // installs carry no reloadAsync race; nothing to recover from.
      if (Updates.isEmbeddedLaunch) return;

      const currentUpdateId = Updates.updateId;
      if (!currentUpdateId) return;

      let stored: string | null = null;
      try {
        stored = await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        // AsyncStorage unavailable — fail open, no banner.
        return;
      }

      if (cancelled) return;

      // Persist the current id so the banner is one-shot per bundle.
      try {
        await AsyncStorage.setItem(STORAGE_KEY, currentUpdateId);
      } catch {
        // Best effort — if the write fails, we may show the banner again
        // next launch. Acceptable.
      }

      // We're on an OTA bundle. Show the banner when we have no prior
      // record (first launch with the banner code on this user's
      // device, or first OTA after a native install) or when the stored
      // id differs from the current one (a tracked OTA transition).
      const isTransition = !stored || stored !== currentUpdateId;
      if (!isTransition) return;

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
    // Absolutely positioned so the banner overlays the screen's empty top
    // safe-area instead of pushing every screen's content down by ~85pt
    // for the entire time it's visible.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
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
