/**
 * GoLiveScreen - Convert a demo community into a live, paid community.
 *
 * Route: /onboarding/go-live  (opened from the app-wide DemoBanner)
 *
 * Pricing is $1/month per active member: someone who opened the app in this
 * community within the past month (the same heuristic as the admin Stats
 * "Active Members" card) and hasn't been manually marked inactive by an
 * admin/leader.
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
                <Text style={[styles.cardBody, { color: colors.textSecondary }]}>
                  An active member is someone who opened the app in your
                  community within the past month — the same number as the
                  Active Members card on your admin Stats tab. Admins and
                  group leaders can also mark people as inactive so you're
                  never billed for them. Your bill adjusts automatically every
                  month.
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
