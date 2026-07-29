/**
 * FinanceOnboardingStatusScreen — data wrapper for the community finance
 * onboarding checklist (ADR-032 §2 step 4). Convex reactivity keeps
 * `getOnboardingStatus` fresh as Stripe/Increase webhooks land, so this
 * screen needs no manual polling.
 */
import React, { useState } from "react";
import { View, StyleSheet, TouchableOpacity, Text, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import { useAuth } from "@providers/AuthProvider";
import { useAuthenticatedQuery, useAuthenticatedAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { ToastManager } from "@components/ui";
import { formatError } from "@/utils/error-handling";
import { FinanceOnboardingStatusView } from "./FinanceOnboardingStatusView";

// Mirrors the deep-link scheme used for the Planning Center OAuth callback
// (see features/integrations/hooks/usePlanningCenterAuth.ts) — the app's
// registered scheme is "togather" (app.json `expo.scheme`). Stripe's hosted
// onboarding just needs a URL to bounce back to; Convex reactivity (not the
// redirect itself) is what refreshes this screen's status.
const FINANCE_SETUP_DEEP_LINK = "togather://leader-tools/finance-setup";

export function FinanceOnboardingStatusScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { community } = useAuth();

  const status = useAuthenticatedQuery(
    api.functions.finance.onboarding.getOnboardingStatus,
    community?.id ? { communityId: community.id as Id<"communities"> } : "skip",
  );

  const getStripeOnboardingLinkUrl = useAuthenticatedAction(
    api.functions.finance.onboarding.getStripeOnboardingLinkUrl,
  );

  const [isLoadingLink, setIsLoadingLink] = useState(false);

  const handleContinueIdentityVerification = async () => {
    if (!community?.id || isLoadingLink) return;
    setIsLoadingLink(true);
    try {
      const { url } = await getStripeOnboardingLinkUrl({
        communityId: community.id as Id<"communities">,
        returnUrl: FINANCE_SETUP_DEEP_LINK,
        refreshUrl: FINANCE_SETUP_DEEP_LINK,
      });
      if (Platform.OS === "web") {
        window.location.href = url;
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch (error) {
      ToastManager.error(formatError(error, "Failed to open identity verification"));
    } finally {
      setIsLoadingLink(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} testID="back-button">
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Community Finance</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Set up giving</Text>
        </View>
      </View>

      <FinanceOnboardingStatusView
        isLoading={status === undefined}
        formSubmitted={!!status?.formSubmitted}
        paymentsVerified={!!status?.paymentsVerified}
        bankAccountsReady={!!status?.bankAccountsReady}
        onboardingStatus={status?.onboardingStatus ?? "collecting"}
        blockedReason={status?.blockedReason}
        isLoadingLink={isLoadingLink}
        onStartForm={() => router.push("/(user)/leader-tools/finance-setup/intake")}
        onContinueIdentityVerification={handleContinueIdentityVerification}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
});
