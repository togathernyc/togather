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
import { DOMAIN_CONFIG } from "@togather/shared/config";
import { useAuth } from "@providers/AuthProvider";
import {
  useAuthenticatedQuery,
  useAuthenticatedAction,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { formatError } from "@/utils/error-handling";
import { FinanceOnboardingStatusView } from "./FinanceOnboardingStatusView";

// An https universal link, NOT the custom "togather://" scheme: Stripe
// requires https return/refresh URLs for hosted onboarding (the backend's
// getStripeOnboardingLinkUrl enforces it too). DOMAIN_CONFIG keeps it
// environment-aware — a staging admin must bounce back to staging, not prod.
// Stripe just needs a URL to bounce back to; Convex reactivity (not the
// redirect itself) refreshes this screen.
const FINANCE_SETUP_DEEP_LINK = `${DOMAIN_CONFIG.appUrl}/finance-setup`;

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
  const retryProvisioning = useAuthenticatedMutation(
    api.functions.finance.onboarding.retryProvisioning,
  );

  const [isLoadingLink, setIsLoadingLink] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const handleContinueIdentityVerification = async () => {
    if (!community?.id || isLoadingLink) return;
    setIsLoadingLink(true);
    setLinkError(null);
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
      // Inline, not a toast — toasts don't render on web, and this error is
      // the difference between a working and dead-end screen.
      setLinkError(formatError(error, "Failed to open identity verification"));
    } finally {
      setIsLoadingLink(false);
    }
  };

  const handleRetryProvisioning = async () => {
    if (!community?.id || isRetrying) return;
    setIsRetrying(true);
    setLinkError(null);
    try {
      await retryProvisioning({
        communityId: community.id as Id<"communities">,
      });
    } catch (error) {
      setLinkError(formatError(error, "Couldn't retry setup. Please try again."));
    } finally {
      setIsRetrying(false);
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
        providersReady={!!status?.providersReady}
        paymentsVerified={!!status?.paymentsVerified}
        bankAccountsReady={!!status?.bankAccountsReady}
        onboardingStatus={status?.onboardingStatus ?? "collecting"}
        blockedReason={status?.blockedReason}
        provisioningError={status?.provisioningError}
        linkError={linkError}
        isLoadingLink={isLoadingLink}
        isRetrying={isRetrying}
        onStartForm={() => router.push("/finance-setup/intake")}
        onContinueIdentityVerification={handleContinueIdentityVerification}
        onRetryProvisioning={handleRetryProvisioning}
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
