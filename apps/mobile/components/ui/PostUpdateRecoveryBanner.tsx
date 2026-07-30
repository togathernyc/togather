/**
 * PostUpdateRecoveryBanner
 *
 * Renders a small, unobtrusive "toast" pill the first time the app boots
 * onto a new OTA bundle. By the time this component runs the new bundle is
 * already live (OTA updates apply only on a cold start / refresh), so the
 * pill simply reassures the user that the app updated: it shows a brief
 * spinner + "Updating…", settles on a green check + "Updated," then fades
 * away on its own. It never blocks interaction and carries no "force-close"
 * or "refresh" copy — the update has already been installed.
 *
 * Detection (unchanged one-shot-per-bundle logic): bail entirely on embedded
 * launches (Updates.isEmbeddedLaunch = true — fresh installs, App Store
 * updates, emergency fallback to the embedded bundle). On OTA bundles,
 * compare Updates.updateId against the value persisted to AsyncStorage from
 * the previous OTA launch and show the pill if it's absent (first OTA launch
 * with this code on the device, or first OTA after a native install) or
 * different (a real OTA transition). The current id is then persisted so the
 * pill is one-shot per bundle. Fails open (no pill) if storage throws.
 *
 * Presentation timeline (all cosmetic): fade in → "Updating…" for
 * UPDATING_PHASE_MS → swap to "Updated" → hold UPDATED_HOLD_MS → fade out.
 * Auto-dismisses with no user action (the whole point — silent); there is no
 * manual dismiss control.
 */
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_KEY = '@togather/last_seen_update_id';

// Cosmetic timing — see the timeline note above.
export const UPDATING_PHASE_MS = 1_000; // spinner + "Updating…" beat
export const UPDATED_HOLD_MS = 2_000; // hold on the "Updated" check
export const FADE_MS = 300; // fade in / fade out duration

type Phase = 'updating' | 'updated';

export function PostUpdateRecoveryBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('updating');
  const opacity = useRef(new Animated.Value(0)).current;
  // Floats over the top safe-area so it clears the status bar / notch without
  // pushing screen content down.
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (__DEV__) return;

    let cancelled = false;

    (async () => {
      // Bail out on embedded launches BEFORE touching storage. The embedded
      // bundle's updateId changes with every native (App Store) update;
      // reading and overwriting our stored OTA id here would falsely flag a
      // native install as an OTA transition AND corrupt the baseline for
      // detecting the next *real* OTA.
      if (Updates.isEmbeddedLaunch) return;

      const currentUpdateId = Updates.updateId;
      if (!currentUpdateId) return;

      let stored: string | null = null;
      try {
        stored = await AsyncStorage.getItem(STORAGE_KEY);
      } catch {
        // AsyncStorage unavailable — fail open, no pill.
        return;
      }

      if (cancelled) return;

      // Persist the current id so the pill is one-shot per bundle.
      try {
        await AsyncStorage.setItem(STORAGE_KEY, currentUpdateId);
      } catch {
        // Best effort — if the write fails we may show the pill again next
        // launch. Acceptable.
      }

      // We're on an OTA bundle. Show the pill when we have no prior record
      // (first launch with this code on the device, or first OTA after a
      // native install) or when the stored id differs from the current one
      // (a tracked OTA transition).
      const isTransition = !stored || stored !== currentUpdateId;
      if (!isTransition) return;

      setIsVisible(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Presentation timeline. Runs once the pill becomes visible; drives the
  // fade in, the phase swap, the hold, and the fade-out + unmount. All of it
  // fires on timers so it completes with no user interaction.
  useEffect(() => {
    if (!isVisible) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start();

    timers.push(
      setTimeout(() => setPhase('updated'), UPDATING_PHASE_MS),
    );

    timers.push(
      setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          useNativeDriver: true,
        }).start();
      }, UPDATING_PHASE_MS + UPDATED_HOLD_MS),
    );

    // Unmount on its own timer rather than the fade's completion callback so
    // the pill always tears down even if the animation callback never fires.
    timers.push(
      setTimeout(
        () => setIsVisible(false),
        UPDATING_PHASE_MS + UPDATED_HOLD_MS + FADE_MS,
      ),
    );

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [isVisible, opacity]);

  if (!isVisible) return null;

  const isUpdated = phase === 'updated';
  const label = isUpdated ? 'Updated' : 'Updating…';

  return (
    // pointerEvents="none" so the pill never captures taps meant for the
    // screen beneath it — the update is silent and non-blocking.
    <View
      testID="post-update-pill-overlay"
      style={[styles.overlay, { top: 8 + insets.top }]}
      pointerEvents="none"
    >
      <Animated.View
        style={[styles.pill, { opacity }]}
        accessibilityRole="text"
        accessibilityLabel={label}
      >
        {isUpdated ? (
          <Ionicons
            name="checkmark-circle"
            size={16}
            color="#34D399"
            style={styles.icon}
          />
        ) : (
          <ActivityIndicator size="small" color="#fff" style={styles.icon} />
        )}
        <Text style={styles.text}>{label}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    // Absolutely positioned and centered so the pill floats over the top
    // safe-area instead of pushing screen content down. `top` is applied
    // inline together with the top safe-area inset.
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1000,
    elevation: 1000,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    // Dark translucent background reads on both light and dark screens.
    backgroundColor: 'rgba(31, 41, 55, 0.92)',
    ...Platform.select({
      web: {
        boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.25)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 6,
      },
    }),
  },
  icon: {
    marginRight: 8,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
