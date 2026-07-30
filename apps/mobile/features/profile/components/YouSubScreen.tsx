/**
 * YouSubScreen — the shared chrome for every leaf screen the WhatsApp-shell
 * "You" tab links to (`/(user)/you/*`).
 *
 * The You tab's settings IA regroup (README.md "W9 — You") splits the old
 * single "Notifications" row — which opened the entire 10-section legacy
 * `SettingsScreen` — and the single "Admin tools" row — which opened the whole
 * segmented `AdminScreen` — into one row per destination. Those destinations are
 * new *flag-on-only* routes that WRAP the existing section/content components
 * unchanged; the legacy screens keep working byte-identically for flag-off
 * users, who still reach them through `ProfileMenu`.
 *
 * So this component is deliberately thin — it owns only the three things every
 * one of those routes needs:
 *
 *   1. The flag guard (same shape as `app/(user)/invite.tsx`): wait for
 *      `loaded`, then `Redirect` to the legacy profile tab when the shell is
 *      off, so a deep link or stale navigation state can't strand a flag-off
 *      user on WhatsApp chrome. `allowed`/`gateReady` extend the same treatment
 *      to the admin routes' role gates.
 *   2. `WaSubScreenHeader` (S1.1: floating back circle + centered 17pt title)
 *      over the `backgroundGrouped` canvas.
 *   3. A body that either scrolls (`scroll`, for the settings sections, which
 *      are plain non-scrolling Views) or fills (`scroll={false}`, for the admin
 *      content components, which each already own a `flex: 1` ScrollView and
 *      would collapse inside another one).
 *
 * Restyling the wrapped components to the WA design system is follow-up work —
 * this change is the information architecture only, so they keep their own
 * internal styling for now.
 */
import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useWhatsappShellState } from "@hooks/useWhatsappShell";
import { WaSubScreenHeader, WA_GROUP_SPACING } from "@components/wa";

/** Where a disallowed visitor lands — the legacy profile tab, as `invite.tsx` does. */
const FALLBACK_ROUTE = "/(tabs)/profile";

export interface YouSubScreenProps {
  /** Centered 17pt nav title. */
  title: string;
  /**
   * False for children that scroll themselves (every `features/admin`
   * `*Content` component does). Default true.
   */
  scroll?: boolean;
  /**
   * Extra gate on top of the shell flag — the admin routes pass their role
   * predicate here so a deep link can't reach admin content.
   */
  allowed?: boolean;
  /** False while `allowed` is still resolving; renders nothing rather than bouncing. */
  gateReady?: boolean;
  children: React.ReactNode;
}

export function YouSubScreen({
  title,
  scroll = true,
  allowed = true,
  gateReady = true,
  children,
}: YouSubScreenProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const { enabled, loaded } = useWhatsappShellState();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(FALLBACK_ROUTE);
    }
  };

  if (!loaded || !gateReady) return null;
  if (!enabled || !allowed) return <Redirect href={FALLBACK_ROUTE} />;

  return (
    <View
      style={[styles.container, { backgroundColor: colors.backgroundGrouped }]}
      testID="you-sub-screen"
    >
      <WaSubScreenHeader title={title} onBack={handleBack} style={{ paddingTop: insets.top }} />
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + WA_GROUP_SPACING },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.fillBody}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: WA_GROUP_SPACING,
  },
  fillBody: {
    flex: 1,
  },
});
