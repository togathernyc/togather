/**
 * BillingScreen - Billing management for existing communities.
 *
 * URL: /billing/:communityId
 *
 * Requires authentication and admin role. Shows subscription status for
 * communities with billing, or a setup form for communities without.
 * Handles Stripe checkout success/canceled URL params.
 */
import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(amount: number | null | undefined): string {
  if (amount == null) return "--";
  return `$${amount.toLocaleString()}`;
}

type StatusStyle = {
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  label: string;
};

function getStatusStyle(
  status: string | null,
  colors: ReturnType<typeof useTheme>["colors"]
): StatusStyle {
  switch (status) {
    case "active":
      return {
        backgroundColor: colors.success + "1A",
        textColor: colors.success,
        borderColor: colors.success + "40",
        label: "Active",
      };
    case "past_due":
      return {
        backgroundColor: colors.warning + "1A",
        textColor: colors.warning,
        borderColor: colors.warning + "40",
        label: "Past Due",
      };
    case "canceled":
      return {
        backgroundColor: colors.error + "1A",
        textColor: colors.error,
        borderColor: colors.error + "40",
        label: "Canceled",
      };
    case "unpaid":
      return {
        backgroundColor: colors.error + "1A",
        textColor: colors.error,
        borderColor: colors.error + "40",
        label: "Unpaid",
      };
    case "trialing":
      return {
        backgroundColor: colors.link + "1A",
        textColor: colors.link,
        borderColor: colors.link + "40",
        label: "Trialing",
      };
    case "incomplete":
      return {
        backgroundColor: colors.warning + "1A",
        textColor: colors.warning,
        borderColor: colors.warning + "40",
        label: "Incomplete",
      };
    default:
      return {
        backgroundColor: colors.surfaceSecondary,
        textColor: colors.textSecondary,
        borderColor: colors.border,
        label: status ?? "Unknown",
      };
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
  colors,
}: {
  status: string | null;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const style = getStatusStyle(status, colors);
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
        },
      ]}
    >
      <Text style={[styles.badgeText, { color: style.textColor }]}>
        {style.label}
      </Text>
    </View>
  );
}

function Banner({
  type,
  message,
  colors,
}: {
  type: "success" | "warning";
  message: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const isSuccess = type === "success";
  const tint = isSuccess ? colors.success : colors.warning;
  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: tint + "10",
          borderColor: tint + "30",
        },
      ]}
    >
      <Ionicons
        name={isSuccess ? "checkmark-circle" : "information-circle"}
        size={20}
        color={tint}
        style={{ marginRight: 10 }}
      />
      <Text style={[styles.bannerText, { color: tint, flex: 1 }]}>
        {message}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function BillingScreen() {
  const { communityId, checkout } = useLocalSearchParams<{
    communityId?: string;
    checkout?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { isAuthenticated, token, isLoading } = useAuth();

  // ---- State ----
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");

  const [monthlyPrice, setMonthlyPrice] = useState("200");
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [subscribeError, setSubscribeError] = useState("");

  // ---- Data loading (hooks must be before early returns) ----
  const billing = useQuery(
    api.functions.ee.billing.getSubscriptionStatus,
    token && communityId && isAuthenticated
      ? { token, communityId: communityId as Id<"communities"> }
      : "skip"
  );

  const createPortalSession = useAction(
    api.functions.ee.billing.createPortalSession
  );

  const createSubscription = useAction(
    api.functions.ee.billing.createSubscriptionForCommunity
  );

  // ---- Auth guard (wait for auth to initialize) ----
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const redirectPath = `/billing/${communityId ?? ""}`;
      router.replace(`/(auth)/signin?redirect=${encodeURIComponent(redirectPath)}`);
    }
  }, [isLoading, isAuthenticated, communityId, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={colors.textSecondary} />
      </View>
    );
  }

  // ---- Handlers ----
  async function handleManageBilling() {
    if (!token || !communityId) return;

    setPortalLoading(true);
    setPortalError("");

    try {
      const result = await createPortalSession({ token, communityId });
      if (Platform.OS === "web") {
        window.location.href = result.url;
      } else {
        await Linking.openURL(result.url);
      }
    } catch (err) {
      setPortalError(
        err instanceof Error
          ? err.message
          : "Failed to open billing portal. Please try again."
      );
      setPortalLoading(false);
    }
  }

  async function handleSubscribe() {
    if (!token || !communityId || !monthlyPrice) return;

    setSubscribeLoading(true);
    setSubscribeError("");

    try {
      const result = await createSubscription({
        token,
        communityId,
        monthlyPrice: Number(monthlyPrice),
      });
      if (Platform.OS === "web") {
        window.location.href = result.url;
      } else {
        await Linking.openURL(result.url);
      }
    } catch (err) {
      setSubscribeError(
        err instanceof Error
          ? err.message
          : "Failed to create subscription. Please try again."
      );
      setSubscribeLoading(false);
    }
  }

  // ---- Checkout param banners ----
  const checkoutSuccess = checkout === "success";
  const checkoutCanceled = checkout === "canceled";

  const hasSubscription = billing != null && billing.subscriptionStatus != null;

  // ===========================================================================
  // Render
  // ===========================================================================

  return (
    <View
      style={[
        styles.page,
        {
          backgroundColor: colors.backgroundSecondary,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          {/* Back link */}
          <Pressable
            onPress={() => {
              if (Platform.OS === "web") {
                router.push("/");
              } else {
                router.back();
              }
            }}
            style={styles.backButton}
          >
            <Ionicons
              name="arrow-back"
              size={20}
              color={colors.textSecondary}
            />
            <Text
              style={[styles.backButtonText, { color: colors.textSecondary }]}
            >
              Back
            </Text>
          </Pressable>

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.heading, { color: colors.text }]}>
              Billing
            </Text>
            <Text
              style={[styles.subheading, { color: colors.textSecondary }]}
            >
              Manage your community's subscription and payment details.
            </Text>
          </View>

          {/* Loading */}
          {billing === undefined && (
            <View style={styles.centeredContent}>
              <ActivityIndicator size="large" color={colors.textSecondary} />
            </View>
          )}

          {billing !== undefined && (
            <>
              {/* Checkout banners */}
              {checkoutSuccess && (
                <Banner
                  type="success"
                  message="Subscription activated successfully!"
                  colors={colors}
                />
              )}
              {checkoutCanceled && (
                <Banner
                  type="warning"
                  message="Checkout was canceled. You can try again below."
                  colors={colors}
                />
              )}

              {/* Subscription card */}
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderLight,
                  },
                ]}
              >
                {/* Card header */}
                <View style={styles.cardHeader}>
                  <View
                    style={[
                      styles.cardIconCircle,
                      { backgroundColor: colors.surfaceSecondary },
                    ]}
                  >
                    <Ionicons
                      name="card-outline"
                      size={20}
                      color={colors.textSecondary}
                    />
                  </View>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    Subscription
                  </Text>
                </View>

                {hasSubscription ? (
                  <>
                    {/* Status row */}
                    <View style={styles.infoRow}>
                      <Text
                        style={[
                          styles.infoLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Status
                      </Text>
                      <StatusBadge
                        status={billing.subscriptionStatus}
                        colors={colors}
                      />
                    </View>

                    <View
                      style={[
                        styles.divider,
                        { backgroundColor: colors.borderLight },
                      ]}
                    />

                    {/* Price row */}
                    <View style={styles.infoRow}>
                      <Text
                        style={[
                          styles.infoLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Monthly Price
                      </Text>
                      <Text
                        style={[styles.infoValue, { color: colors.text }]}
                      >
                        {formatPrice(billing.subscriptionPriceMonthly)}/month
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.divider,
                        { backgroundColor: colors.borderLight },
                      ]}
                    />

                    {/* Manage billing button */}
                    <View style={styles.actionArea}>
                      <Pressable
                        onPress={handleManageBilling}
                        disabled={portalLoading}
                        style={[
                          styles.primaryButton,
                          {
                            backgroundColor: portalLoading
                              ? colors.buttonDisabled
                              : colors.buttonPrimary,
                          },
                        ]}
                      >
                        {portalLoading && (
                          <ActivityIndicator
                            size="small"
                            color={colors.buttonPrimaryText}
                            style={{ marginRight: 8 }}
                          />
                        )}
                        <Text
                          style={[
                            styles.primaryButtonText,
                            { color: colors.buttonPrimaryText },
                          ]}
                        >
                          {portalLoading
                            ? "Opening Billing Portal..."
                            : "Manage Billing"}
                        </Text>
                      </Pressable>

                      {portalError !== "" && (
                        <Text
                          style={[
                            styles.inlineError,
                            { color: colors.error },
                          ]}
                        >
                          {portalError}
                        </Text>
                      )}
                    </View>

                    {/* Info note */}
                    <Text
                      style={[styles.note, { color: colors.textTertiary }]}
                    >
                      Manage your payment method, view invoices, or cancel your
                      subscription through Stripe's secure billing portal.
                    </Text>

                    {/* Past due warning */}
                    {billing.subscriptionStatus === "past_due" && (
                      <View
                        style={[
                          styles.warningBox,
                          {
                            backgroundColor: colors.warning + "10",
                            borderColor: colors.warning + "30",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.warningText,
                            { color: colors.warning },
                          ]}
                        >
                          Payment past due. Please update your payment method to
                          keep your community active.
                        </Text>
                      </View>
                    )}

                    {/* Canceled warning */}
                    {billing.subscriptionStatus === "canceled" && (
                      <View
                        style={[
                          styles.warningBox,
                          {
                            backgroundColor: colors.error + "10",
                            borderColor: colors.error + "30",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.warningText,
                            { color: colors.error },
                          ]}
                        >
                          Subscription canceled. Your community may lose access
                          to certain features. Contact support to reactivate.
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    {/* No subscription — setup billing */}
                    <Text
                      style={[
                        styles.setupHeading,
                        { color: colors.text },
                      ]}
                    >
                      Set up billing
                    </Text>
                    <Text
                      style={[
                        styles.setupDescription,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Enter your monthly price to set up billing for this
                      community.
                    </Text>

                    {/* Price input */}
                    <View style={styles.priceInputGroup}>
                      <Text
                        style={[
                          styles.priceLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Monthly Price (USD)
                      </Text>
                      <View style={styles.priceInputRow}>
                        <Text
                          style={[
                            styles.priceDollar,
                            { color: colors.textTertiary },
                          ]}
                        >
                          $
                        </Text>
                        <TextInput
                          style={[
                            styles.priceInput,
                            {
                              backgroundColor: colors.inputBackground,
                              borderColor: colors.inputBorder,
                              color: colors.text,
                            },
                          ]}
                          value={monthlyPrice}
                          onChangeText={(t) =>
                            setMonthlyPrice(t.replace(/[^0-9]/g, ""))
                          }
                          placeholder="0"
                          placeholderTextColor={colors.inputPlaceholder}
                          keyboardType="numeric"
                        />
                      </View>
                    </View>

                    <Pressable
                      onPress={handleSubscribe}
                      disabled={
                        subscribeLoading ||
                        !monthlyPrice ||
                        Number(monthlyPrice) <= 0
                      }
                      style={[
                        styles.primaryButton,
                        {
                          backgroundColor:
                            subscribeLoading ||
                            !monthlyPrice ||
                            Number(monthlyPrice) <= 0
                              ? colors.buttonDisabled
                              : colors.buttonPrimary,
                        },
                      ]}
                    >
                      {subscribeLoading && (
                        <ActivityIndicator
                          size="small"
                          color={colors.buttonPrimaryText}
                          style={{ marginRight: 8 }}
                        />
                      )}
                      <Text
                        style={[
                          styles.primaryButtonText,
                          {
                            color:
                              subscribeLoading ||
                              !monthlyPrice ||
                              Number(monthlyPrice) <= 0
                                ? colors.buttonDisabledText
                                : colors.buttonPrimaryText,
                          },
                        ]}
                      >
                        {subscribeLoading
                          ? "Redirecting to Checkout..."
                          : "Start Subscription"}
                      </Text>
                    </Pressable>

                    {subscribeError !== "" && (
                      <Text
                        style={[
                          styles.inlineError,
                          { color: colors.error },
                        ]}
                      >
                        {subscribeError}
                      </Text>
                    )}

                    <Text
                      style={[styles.note, { color: colors.textTertiary }]}
                    >
                      Payment is securely handled by Stripe.
                    </Text>
                  </>
                )}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const MAX_WIDTH = 600;

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  container: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
    gap: 6,
  },
  backButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
  header: {
    marginBottom: 24,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  subheading: {
    fontSize: 16,
    lineHeight: 22,
  },
  centeredContent: {
    paddingVertical: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  bannerText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  cardIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  infoValue: {
    fontSize: 16,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    marginVertical: 14,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  actionArea: {
    marginTop: 20,
  },
  primaryButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  inlineError: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 10,
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 16,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  warningText: {
    fontSize: 14,
    lineHeight: 20,
  },
  setupHeading: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 4,
  },
  setupDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  priceInputGroup: {
    marginBottom: 16,
  },
  priceLabel: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
  },
  priceInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  priceDollar: {
    fontSize: 16,
    fontWeight: "500",
  },
  priceInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
});
