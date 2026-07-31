/**
 * FinanceOnboardingStatusView — the community admin's onboarding checklist
 * (ADR-032 §2 step 4: Church details / Identity verification / Bank
 * accounts). Plain props only, no Convex — see
 * FinanceOnboardingStatusScreen.tsx for the data wrapper, which relies on
 * Convex reactivity to auto-refresh this as webhooks land.
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { Badge, Button, Skeleton } from "@components/ui";
import type { OnboardingStatus } from "./types";

export type ChecklistItemState = "done" | "in_progress" | "blocked";

interface ChecklistItem {
  key: string;
  title: string;
  description: string;
  state: ChecklistItemState;
  blockedReason?: string | null;
}

export interface FinanceOnboardingStatusViewProps {
  isLoading: boolean;
  formSubmitted: boolean;
  /** True once provisionProviders has created the Stripe connected account —
   * before that, "Continue identity verification" can't work (there's no
   * account to link to), so the view shows a setting-up state instead. */
  providersReady: boolean;
  paymentsVerified: boolean;
  bankAccountsReady: boolean;
  onboardingStatus: OnboardingStatus;
  blockedReason?: string | null;
  /** Human-readable provider error when provisioning itself failed —
   * distinguishes "our setup call broke, retry it" from a webhook-driven
   * blocked state (which the hosted Stripe flow resolves). */
  provisioningError?: string | null;
  /** Error from the last "Continue identity verification" attempt — shown
   * inline (toasts don't render on web). */
  linkError?: string | null;
  isLoadingLink: boolean;
  isRetrying: boolean;
  onStartForm: () => void;
  onContinueIdentityVerification: () => void;
  onRetryProvisioning: () => void;
}

export function FinanceOnboardingStatusView({
  isLoading,
  formSubmitted,
  providersReady,
  paymentsVerified,
  bankAccountsReady,
  onboardingStatus,
  blockedReason,
  provisioningError,
  linkError,
  isLoadingLink,
  isRetrying,
  onStartForm,
  onContinueIdentityVerification,
  onRetryProvisioning,
}: FinanceOnboardingStatusViewProps) {
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.surfaceSecondary }]}>
        <Skeleton width="100%" height={72} />
        <Skeleton width="100%" height={72} style={{ marginTop: 12 }} />
        <Skeleton width="100%" height={72} style={{ marginTop: 12 }} />
      </View>
    );
  }

  const provisioningFailed = !!provisioningError;
  const provisioning = formSubmitted && !providersReady && !provisioningFailed;

  // blockedReason arrives as the raw status enum when there's no stored
  // provider error (webhook-driven blocks carry no message today) — map it
  // to human copy instead of leaking "stripe_blocked" to a church admin.
  // For a Stripe block the actionable fix IS the identity flow below.
  const friendlyBlockedReason =
    blockedReason === "stripe_blocked"
      ? "Stripe needs more information — continue identity verification below."
      : blockedReason === "increase_blocked"
        ? "Our banking partner needs more information. We're on it — check back soon."
        : blockedReason;

  const identityState: ChecklistItemState = paymentsVerified
    ? "done"
    : onboardingStatus === "stripe_blocked"
      ? "blocked"
      : "in_progress";
  const bankState: ChecklistItemState = bankAccountsReady
    ? "done"
    : onboardingStatus === "increase_blocked"
      ? "blocked"
      : "in_progress";

  const items: ChecklistItem[] = [
    {
      key: "details",
      title: "Church details",
      description: "Legal name, EIN, and address",
      state: formSubmitted ? "done" : "in_progress",
    },
    {
      key: "identity",
      title: "Identity verification",
      description: "Stripe verifies your representative's identity",
      state: identityState,
      blockedReason: identityState === "blocked" ? (provisioningError ?? friendlyBlockedReason) : null,
    },
    {
      key: "bank",
      title: "Bank accounts",
      description: "Receiving and general accounts for your community",
      state: bankState,
      blockedReason: bankState === "blocked" ? (provisioningError ?? friendlyBlockedReason) : null,
    },
  ];

  const isLive = onboardingStatus === "live";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}
      contentContainerStyle={styles.content}
    >
      {isLive && (
        <View style={[styles.liveBanner, { backgroundColor: colors.success + "20", borderColor: colors.success }]}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={[styles.liveBannerText, { color: colors.success }]}>Giving is live for your community!</Text>
        </View>
      )}

      <View style={styles.list}>
        {items.map((item) => (
          <View
            key={item.key}
            style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}
            testID={`onboarding-item-${item.key}`}
          >
            <View style={styles.itemHeader}>
              <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
              <StateBadge state={item.state} />
            </View>
            <Text style={[styles.itemDescription, { color: colors.textSecondary }]}>{item.description}</Text>
            {item.blockedReason ? (
              <Text style={[styles.blockedReason, { color: colors.error }]}>{item.blockedReason}</Text>
            ) : null}
          </View>
        ))}
      </View>

      {!formSubmitted ? (
        <Button variant="primary" onPress={onStartForm} style={styles.actionButton}>
          Get started
        </Button>
      ) : provisioningFailed && !providersReady ? (
        <>
          <Button
            variant="primary"
            onPress={onRetryProvisioning}
            loading={isRetrying}
            style={styles.actionButton}
          >
            Try again
          </Button>
          {/* Escape hatch when the failure is the DATA (a provider rejecting
              a field): "Try again" resubmits the same stored details, so a
              deterministic rejection needs the form. Reuses onStartForm —
              the intake screen prefills nothing but startOnboarding upserts,
              so resubmitting corrected details is the recovery path. */}
          <Button variant="secondary" onPress={onStartForm} style={styles.editButton}>
            Edit church details
          </Button>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Something went wrong creating your accounts. Retrying is safe — no
            duplicates will be created. If the error points at your church
            details, edit and resubmit them instead.
          </Text>
          {linkError ? (
            <Text style={[styles.linkError, { color: colors.error }]}>{linkError}</Text>
          ) : null}
        </>
      ) : provisioning ? (
        // Deliberately NOT a loading Button — the shared Button hides its
        // label while `loading`, and this state's whole job is the label.
        <>
          <Button variant="primary" disabled style={styles.actionButton} onPress={() => {}}>
            Setting up your accounts…
          </Button>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            We're creating your payment and banking accounts. This usually
            takes a few seconds — this screen updates automatically.
          </Text>
        </>
      ) : !paymentsVerified ? (
        <>
          <Button
            variant="primary"
            onPress={onContinueIdentityVerification}
            loading={isLoadingLink}
            style={styles.actionButton}
          >
            Continue identity verification
          </Button>
          {linkError ? (
            <Text style={[styles.linkError, { color: colors.error }]}>{linkError}</Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function StateBadge({ state }: { state: ChecklistItemState }) {
  if (state === "done") {
    return (
      <Badge variant="success" size="small">
        Done
      </Badge>
    );
  }
  if (state === "blocked") {
    return (
      <Badge variant="danger" size="small">
        Blocked
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" size="small">
      In progress
    </Badge>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    padding: 16,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  liveBannerText: {
    fontSize: 15,
    fontWeight: "600",
  },
  list: {
    gap: 12,
  },
  item: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  itemDescription: {
    fontSize: 13,
    marginTop: 4,
  },
  blockedReason: {
    fontSize: 13,
    marginTop: 8,
    fontWeight: "500",
  },
  actionButton: {
    marginTop: 20,
  },
  editButton: {
    marginTop: 10,
  },
  helperText: {
    fontSize: 13,
    marginTop: 10,
    textAlign: "center",
    lineHeight: 18,
  },
  linkError: {
    fontSize: 13,
    marginTop: 10,
    textAlign: "center",
    fontWeight: "500",
  },
});
