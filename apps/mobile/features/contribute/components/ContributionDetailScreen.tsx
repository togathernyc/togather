/**
 * ContributionDetailScreen — one contribution's journey (ADR-029 Phase 1).
 *
 * Shows a friendly vertical timeline through the build pipeline, the original
 * report, the AI-drafted spec (when it exists) with the contributor's
 * "Approve spec" product review, the explicit "Start build" step for approved
 * medium/high-risk items, and link-outs to the GitHub issue/PR.
 *
 * Chat-originated items land here too — they may have no spec or risk level
 * yet, and everything renders gracefully without them.
 */
import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Linking,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Markdown } from "@components/ui/Markdown";
import { formatError } from "@/utils/error-handling";
import type { Id } from "@services/api/convex";
import { useContribution } from "../hooks/useContribution";
import { useApproveSpec, useStartBuild } from "../hooks/useContributionMutations";
import { isFromChat, PIPELINE_STEPS, pipelineIndex } from "../utils/status";
import { FromChatTag, KindPill, RiskBadge, StatusChip } from "./ContributionBadges";
import type { Contribution } from "../types";

const SUCCESS = "#34C759";
const REJECTED_COLOR = "#999999";

function Timeline({ contribution }: { contribution: Contribution }) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const rejected = contribution.status === "REJECTED";
  const activeIndex = rejected ? -1 : pipelineIndex(contribution.status);

  const steps = PIPELINE_STEPS.map((step, index) => {
    const done = !rejected && index < activeIndex;
    const active = !rejected && index === activeIndex;
    return { ...step, done, active };
  });

  return (
    <View>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1 && !rejected;
        const dotColor = step.done
          ? SUCCESS
          : step.active
            ? step.status === "MERGED"
              ? SUCCESS
              : primaryColor
            : colors.borderLight;
        return (
          <View key={step.status} style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, { backgroundColor: dotColor }]}>
                {step.done ? (
                  <Ionicons name="checkmark" size={12} color="#ffffff" />
                ) : null}
              </View>
              {!isLast ? (
                <View
                  style={[
                    styles.timelineLine,
                    { backgroundColor: step.done ? SUCCESS : colors.borderLight },
                  ]}
                />
              ) : null}
            </View>
            <View style={styles.timelineContent}>
              <Text
                style={[
                  styles.timelineLabel,
                  {
                    color: step.active
                      ? colors.text
                      : step.done
                        ? colors.textSecondary
                        : colors.textTertiary,
                  },
                  step.active && styles.timelineLabelActive,
                ]}
              >
                {step.label}
              </Text>
              {step.active ? (
                <Text style={[styles.timelineDescription, { color: colors.textSecondary }]}>
                  {step.description}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {rejected ? (
        <View style={styles.timelineRow}>
          <View style={styles.timelineRail}>
            <View style={[styles.timelineDot, { backgroundColor: REJECTED_COLOR }]}>
              <Ionicons name="close" size={12} color="#ffffff" />
            </View>
          </View>
          <View style={styles.timelineContent}>
            <Text style={[styles.timelineLabel, styles.timelineLabelActive, { color: colors.text }]}>
              Not planned
            </Text>
            <Text style={[styles.timelineDescription, { color: colors.textSecondary }]}>
              Thanks for the report — we decided not to take this one forward.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function ContributionDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const id = (params.id || null) as Id<"devBugs"> | null;

  const { contribution } = useContribution(id);
  const approveSpec = useApproveSpec();
  const startBuild = useStartBuild();
  const [busy, setBusy] = useState(false);

  const handleApprove = useCallback(() => {
    if (!id) return;
    Alert.alert(
      "Approve this plan?",
      "You're confirming the plan describes what you meant. Building starts after approval.",
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setBusy(true);
            try {
              await approveSpec({ id });
            } catch (error) {
              Alert.alert("Couldn't approve", formatError(error));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [id, approveSpec]);

  const handleStartBuild = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    try {
      await startBuild({ id });
    } catch (error) {
      Alert.alert("Couldn't start the build", formatError(error));
    } finally {
      setBusy(false);
    }
  }, [id, startBuild]);

  if (contribution === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!contribution) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>
          We couldn't find this contribution.
        </Text>
      </View>
    );
  }

  const showApproveSpec =
    contribution.status === "IN_REVIEW" &&
    !!contribution.spec &&
    !contribution.specApprovedAt;
  const showStartBuild =
    !!contribution.specApprovedAt && contribution.status === "IN_REVIEW";
  const awaitingSpec = contribution.status === "IN_REVIEW" && !contribution.spec;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Contribution</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.badgeRow}>
          <KindPill kind={contribution.kind} />
          <StatusChip contribution={contribution} />
          {contribution.riskLevel ? <RiskBadge risk={contribution.riskLevel} /> : null}
          {isFromChat(contribution) ? <FromChatTag /> : null}
        </View>

        <Text style={[styles.title, { color: colors.text }]}>{contribution.title}</Text>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Progress</Text>
        <Timeline contribution={contribution} />

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Your report</Text>
        <Text style={[styles.body, { color: colors.text }]}>{contribution.body}</Text>

        {contribution.repro ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              How to see it
            </Text>
            <Text style={[styles.body, { color: colors.text }]}>{contribution.repro}</Text>
          </>
        ) : null}

        {contribution.screenshotUrls && contribution.screenshotUrls.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              Screenshots
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {contribution.screenshotUrls.map((url) => (
                <Image key={url} source={{ uri: url }} style={styles.screenshot} />
              ))}
            </ScrollView>
          </>
        ) : null}

        {contribution.spec ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>The plan</Text>
            <View
              style={[
                styles.specCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Markdown source={contribution.spec} />
            </View>
          </>
        ) : awaitingSpec ? (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            The AI is drafting a plan for this change. We'll let you know when
            it's ready for your review.
          </Text>
        ) : null}

        {showApproveSpec ? (
          <View style={styles.actionBlock}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              This is a product review, not a code review: read the plan and
              confirm it describes what you meant. If something's off, tell the
              team before approving.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: primaryColor }, busy && styles.buttonDisabled]}
              onPress={handleApprove}
              disabled={busy}
              activeOpacity={0.8}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>Approve spec</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {showStartBuild ? (
          <View style={styles.actionBlock}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              You've approved the plan. Because this change touches more of the
              app, it needs an explicit go-ahead to start building.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: primaryColor }, busy && styles.buttonDisabled]}
              onPress={handleStartBuild}
              disabled={busy}
              activeOpacity={0.8}
            >
              {busy ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="rocket-outline" size={20} color="#ffffff" />
                  <Text style={styles.primaryButtonText}>Start build</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {contribution.githubIssueUrl ? (
          <TouchableOpacity
            style={[styles.linkRow, { borderColor: colors.border }]}
            onPress={() => Linking.openURL(contribution.githubIssueUrl as string)}
          >
            <Ionicons name="logo-github" size={18} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]} numberOfLines={1}>
              View the GitHub issue
            </Text>
            <Ionicons name="open-outline" size={16} color={colors.iconSecondary} />
          </TouchableOpacity>
        ) : null}

        {contribution.prUrl ? (
          <TouchableOpacity
            style={[styles.linkRow, { borderColor: colors.border }]}
            onPress={() => Linking.openURL(contribution.prUrl as string)}
          >
            <Ionicons name="git-pull-request-outline" size={18} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]} numberOfLines={1}>
              View the code change on GitHub
            </Text>
            <Ionicons name="open-outline" size={16} color={colors.iconSecondary} />
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  scroll: { padding: 16, paddingBottom: 48 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  title: { fontSize: 22, fontWeight: "700", marginTop: 12 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 10,
  },
  body: { fontSize: 15, lineHeight: 22 },
  screenshot: {
    width: 160,
    height: 280,
    borderRadius: 10,
    marginRight: 10,
    backgroundColor: "#00000010",
  },
  specCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  hint: { fontSize: 13, lineHeight: 19 },
  actionBlock: { marginTop: 20, gap: 12 },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
  },
  linkText: { fontSize: 14, flex: 1 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start" },
  timelineRail: { width: 24, alignItems: "center" },
  timelineDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineLine: { width: 2, flex: 1, minHeight: 16, marginVertical: 2 },
  timelineContent: { flex: 1, paddingLeft: 10, paddingBottom: 18 },
  timelineLabel: { fontSize: 14, fontWeight: "500", marginTop: 1 },
  timelineLabelActive: { fontSize: 15, fontWeight: "700" },
  timelineDescription: { fontSize: 13, lineHeight: 18, marginTop: 3 },
});
