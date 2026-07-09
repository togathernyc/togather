/**
 * GoLiveScreen - Convert a demo community into a live, paid community.
 *
 * Route: /onboarding/go-live  (opened from the app-wide DemoBanner)
 *
 * Pricing is $1/month per active member: someone who opened the app in this
 * community within the past month (the same heuristic as the admin Stats
 * "Active Members" card). It is entirely automatic — there is no manual
 * override.
 * The screen shows the current billable count and starts a Stripe checkout
 * (functions/ee/billing.convertDemoToLive). When the webhook confirms
 * payment, the community leaves demo mode and its 100 seeded demo members
 * are removed — groups, branding, settings, and staff accounts stay.
 */
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import {
  api,
  Id,
  useAuthenticatedQuery,
  useAuthenticatedAction,
} from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";

/** Congregation sizes offered in the "estimate your bill" picker. */
const SIZE_PRESETS = [100, 250, 500, 1000, 2500] as const;

/**
 * Rule of thumb for the estimator: only about a third of a congregation opens
 * the app in a given month, so churches pay for far fewer people than their
 * full roster (a 1,000-member church lands around $300/month, not $1,000).
 */
const ACTIVE_SHARE = 1 / 3;

/** Static facts about how billing works, shown as an icon list. */
const BILL_FACTS: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
}[] = [
  {
    icon: "calendar-outline",
    title: "Counted on the 28th, charged on the 1st",
    body: "You're billed in advance for the month ahead. A few days before, we email you the exact amount — so there are never surprises.",
  },
  {
    icon: "pulse-outline",
    title: "Watch it live",
    body: "Your active-member count updates in real time on the admin Stats → Active Members card — the same number you're billed for.",
  },
  {
    icon: "receipt-outline",
    title: "Just $1 per member, plus tax",
    body: "Card processing is included in the $1. Only applicable sales tax is added on top, where it applies.",
  },
];

export function GoLiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { community, isAuthenticated } = useAuth();
  const { checkout } = useLocalSearchParams<{ checkout?: string }>();

  const communityId = community?.id as Id<"communities"> | undefined;
  const demoStatus = useAuthenticatedQuery(
    api.functions.demo.getDemoStatus,
    isAuthenticated && communityId ? { communityId } : "skip",
  );
  const billing = useAuthenticatedQuery(
    api.functions.memberActivity.getBillableSummary,
    isAuthenticated && communityId ? { communityId } : "skip",
  );
  const progress = useAuthenticatedQuery(
    api.functions.demo.getDemoProgress,
    isAuthenticated && communityId ? { communityId } : "skip",
  );

  const convertDemoToLive = useAuthenticatedAction(
    api.functions.ee.billing.convertDemoToLive,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estSize, setEstSize] = useState<(typeof SIZE_PRESETS)[number]>(500);
  const estActive = Math.round(estSize * ACTIVE_SHARE);

  async function handleGoLive() {
    if (!communityId || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const { url } = await convertDemoToLive({ communityId });
      if (Platform.OS === "web") {
        window.location.href = url;
      } else {
        await Linking.openURL(url);
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setSubmitting(false);
    }
  }

  const loading = demoStatus === undefined;
  const isDemo = demoStatus?.isDemo === true;
  const monthlyPrice = billing?.monthlyPriceUsd ?? null;

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
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
            <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
          </Pressable>

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.textSecondary} />
            </View>
          ) : !isDemo ? (
            // Live already (e.g. returning from a successful checkout).
            <View style={styles.centered}>
              <View style={[styles.iconCircle, { backgroundColor: colors.success + "1A" }]}>
                <Ionicons name="checkmark-circle" size={32} color={colors.success} />
              </View>
              <Text style={[styles.title, { color: colors.text }]}>
                {community?.name ?? "Your community"} is live!
              </Text>
              <Text style={[styles.message, { color: colors.textSecondary }]}>
                Demo mode is off and the seeded demo members have been removed.
                Time to invite your congregation.
              </Text>
            </View>
          ) : (
            <>
              {checkout === "canceled" && (
                <View
                  style={[
                    styles.notice,
                    { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight },
                  ]}
                >
                  <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
                    Checkout was canceled — your demo is untouched. You can go
                    live whenever you're ready.
                  </Text>
                </View>
              )}
              {checkout === "success" && (
                <View
                  style={[
                    styles.notice,
                    { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderLight },
                  ]}
                >
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                  <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
                    Payment received — activating your community…
                  </Text>
                </View>
              )}

              <Text style={[styles.title, { color: colors.text }]}>
                Take {community?.name ?? "your community"} live
              </Text>
              <Text style={[styles.message, { color: colors.textSecondary }]}>
                Going live keeps everything you've set up — your name, branding,
                groups, and the teammates you've invited — and removes the {" "}
                seeded demo members and their conversations, so you start clean
                with your real congregation.
              </Text>

              {/* Pricing headline */}
              <View
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
              >
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Simple pricing
                </Text>
                <View style={styles.priceRow}>
                  <Text style={[styles.priceBig, { color: colors.text }]}>$1</Text>
                  <Text style={[styles.priceUnit, { color: colors.textSecondary }]}>
                    / month per active member
                  </Text>
                </View>
                <Text style={[styles.tagline, { color: colors.text }]}>
                  We only grow as you grow.
                </Text>
                <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
                  An active member is anyone who's opened the app in the last 30
                  days — the same count on your admin Stats tab.
                </Text>
                {monthlyPrice !== null && (
                  <View style={[styles.estimate, { borderTopColor: colors.borderLight }]}>
                    <Text style={[styles.estimateLabel, { color: colors.textSecondary }]}>
                      Today: {billing!.billableActiveUsers} active member
                      {billing!.billableActiveUsers === 1 ? "" : "s"}
                    </Text>
                    <Text style={[styles.estimateValue, { color: colors.text }]}>
                      ${monthlyPrice}/month
                    </Text>
                  </View>
                )}
                {billing?.billableActiveUsers === 1 && (
                  <Text style={[styles.hint, { color: colors.textTertiary }]}>
                    Go live for just $1 today, then invite your congregation —
                    your bill grows only as they start using it.
                  </Text>
                )}
              </View>

              {/* Estimate your bill */}
              <View
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
              >
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Estimate your bill
                </Text>
                <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
                  We've generally seen around a third of a congregation active
                  in a given month — though it depends on how often your church
                  uses the app. Pick your size to estimate:
                </Text>
                <View style={styles.chipRow}>
                  {SIZE_PRESETS.map((size) => {
                    const selected = size === estSize;
                    return (
                      <Pressable
                        key={size}
                        onPress={() => setEstSize(size)}
                        style={[
                          styles.chip,
                          {
                            borderColor: selected ? colors.buttonPrimary : colors.borderLight,
                            backgroundColor: selected ? colors.buttonPrimary : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: selected ? colors.buttonPrimaryText : colors.textSecondary },
                          ]}
                        >
                          {size.toLocaleString()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={[styles.estimate, { borderTopColor: colors.borderLight }]}>
                  <Text style={[styles.estimateLabel, { color: colors.textSecondary }]}>
                    ~{estActive.toLocaleString()} active members
                  </Text>
                  <Text style={[styles.estimateValue, { color: colors.text }]}>
                    ≈ ${estActive.toLocaleString()}/month
                  </Text>
                </View>
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  A realistic estimate — your actual number depends on how your
                  church uses the app.
                </Text>
              </View>

              {/* How your bill works */}
              <View
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
              >
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  How your bill works
                </Text>
                {BILL_FACTS.map((fact) => (
                  <View key={fact.title} style={styles.factRow}>
                    <View style={[styles.factIcon, { backgroundColor: colors.surfaceSecondary }]}>
                      <Ionicons name={fact.icon} size={16} color={colors.textSecondary} />
                    </View>
                    <View style={styles.factText}>
                      <Text style={[styles.factTitle, { color: colors.text }]}>
                        {fact.title}
                      </Text>
                      <Text style={[styles.factBody, { color: colors.textSecondary }]}>
                        {fact.body}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Beta pricing lock-in */}
              <View
                style={[
                  styles.lockInCard,
                  { backgroundColor: colors.warning + "14", borderColor: colors.warning + "40" },
                ]}
              >
                <View style={styles.lockInHeader}>
                  <Ionicons name="lock-closed" size={17} color={colors.warning} />
                  <Text style={[styles.lockInTitle, { color: colors.text }]}>
                    Lock in beta pricing
                  </Text>
                </View>
                <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
                  $1 per active member is our beta price. As Togather grows,
                  prices will rise — but start now and you keep $1/member for as
                  long as your subscription stays active.
                </Text>
              </View>

              {progress && (
                <View
                  style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
                >
                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    While you explore · {progress.completed}/{progress.total}
                  </Text>
                  {progress.missions.map((mission) => (
                    <View key={mission.key} style={styles.missionRow}>
                      <Ionicons
                        name={mission.done ? "checkmark-circle" : "ellipse-outline"}
                        size={20}
                        color={mission.done ? colors.success : colors.textTertiary}
                      />
                      <Text
                        style={[
                          styles.missionText,
                          {
                            color: mission.done ? colors.textSecondary : colors.text,
                            textDecorationLine: mission.done ? "line-through" : "none",
                          },
                        ]}
                      >
                        {mission.title}
                      </Text>
                    </View>
                  ))}
                  <Text style={[styles.missionHint, { color: colors.textTertiary }]}>
                    The 🎓 Getting Started conversation in your inbox walks
                    through each one.
                  </Text>
                </View>
              )}

              {error && (
                <View
                  style={[
                    styles.errorBanner,
                    { backgroundColor: colors.error + "10", borderColor: colors.error + "30" },
                  ]}
                >
                  <Ionicons name="alert-circle" size={20} color={colors.error} style={{ marginRight: 10 }} />
                  <Text style={[styles.errorText, { color: colors.error, flex: 1 }]}>{error}</Text>
                </View>
              )}

              {demoStatus?.isAdmin ? (
                <>
                  <Pressable
                    onPress={handleGoLive}
                    disabled={submitting}
                    style={[
                      styles.submitButton,
                      { backgroundColor: submitting ? colors.buttonDisabled : colors.buttonPrimary },
                    ]}
                  >
                    {submitting && (
                      <ActivityIndicator
                        size="small"
                        color={colors.buttonPrimaryText}
                        style={{ marginRight: 8 }}
                      />
                    )}
                    <Text style={[styles.submitButtonText, { color: colors.buttonPrimaryText }]}>
                      Add payment & go live
                    </Text>
                  </Pressable>
                  <Text style={[styles.footnote, { color: colors.textTertiary }]}>
                    Payment is securely handled by Stripe. Your community goes
                    live automatically once checkout completes.
                  </Text>
                </>
              ) : (
                <Text style={[styles.footnote, { color: colors.textTertiary }]}>
                  Only community admins can take a demo live. Ask the person
                  who created this demo.
                </Text>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  container: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    alignSelf: "flex-start",
  },
  backText: {
    fontSize: 16,
    fontWeight: "500",
  },
  centered: {
    alignItems: "center",
    paddingVertical: 64,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 10,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "600",
    marginBottom: 12,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginBottom: 10,
  },
  priceBig: {
    fontSize: 36,
    fontWeight: "800",
    lineHeight: 40,
  },
  priceUnit: {
    fontSize: 15,
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  tagline: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 10,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
  },
  factRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: 14,
  },
  factIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  factText: {
    flex: 1,
  },
  factTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  factBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  lockInCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    marginBottom: 20,
  },
  lockInHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  lockInTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  estimate: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  estimateLabel: {
    fontSize: 14,
  },
  estimateValue: {
    fontSize: 16,
    fontWeight: "700",
  },
  missionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  missionText: {
    fontSize: 14,
    flex: 1,
  },
  missionHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
  },
  submitButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  footnote: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },
});
