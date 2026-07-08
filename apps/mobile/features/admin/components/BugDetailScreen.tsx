/**
 * BugDetailScreen
 *
 * Dev-assistant bug review screen. Mirrors PersonDetailScreen's structure:
 * reads the bugId route param, loads the bug via the token-authed
 * getBugForReview query (staff-only — the query enforces it), and renders the
 * synthesized brief, status, screenshots, PR link, and staff actions
 * (reject / mark merged / retry dispatch).
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { formatError } from "@/utils/error-handling";

type BugStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "READY_FOR_IMPL"
  | "IN_PROGRESS"
  | "CODE_REVIEW"
  | "READY_TO_MERGE"
  | "MERGED"
  | "REJECTED";

function statusBadge(status: BugStatus): {
  label: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
} {
  switch (status) {
    case "READY_FOR_IMPL":
      return { label: "Ready for impl", color: "#5856D6", icon: "rocket-outline" };
    case "IN_PROGRESS":
      return { label: "In progress", color: "#FF9500", icon: "construct-outline" };
    case "CODE_REVIEW":
      return { label: "Code review", color: "#007AFF", icon: "git-pull-request-outline" };
    case "READY_TO_MERGE":
      return { label: "Ready to merge", color: "#34C759", icon: "git-merge-outline" };
    case "MERGED":
      return { label: "Merged", color: "#34C759", icon: "checkmark-circle-outline" };
    case "REJECTED":
      return { label: "Rejected", color: "#999999", icon: "close-circle-outline" };
    case "IN_REVIEW":
      return { label: "In review", color: "#FF9500", icon: "create-outline" };
    default:
      return { label: "Draft", color: "#999999", icon: "document-outline" };
  }
}

const TERMINAL: BugStatus[] = ["MERGED", "REJECTED"];

export function BugDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ bugId: string }>();
  const bugId = (params.bugId || null) as Id<"devBugs"> | null;
  const { user: currentUser, token } = useAuth();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const isStaff =
    currentUser?.is_superuser === true || currentUser?.is_staff === true;

  const bug = useQuery(
    api.functions.devAssistant.bugs.getBugForReview,
    token && bugId && isStaff ? { token, bugId } : "skip",
  );

  const rejectBug = useAuthenticatedMutation(
    api.functions.devAssistant.bugs.rejectBug,
  );
  const markBugMerged = useAuthenticatedMutation(
    api.functions.devAssistant.bugs.markBugMerged,
  );
  const retryDispatch = useAuthenticatedMutation(
    api.functions.devAssistant.bugs.retryDispatch,
  );

  const run = useCallback(
    async (
      fn: (args: { bugId: Id<"devBugs"> }) => Promise<unknown>,
      successMsg: string,
    ) => {
      if (!bugId) return;
      setBusy(true);
      try {
        await fn({ bugId });
        Alert.alert("Done", successMsg);
      } catch (error) {
        Alert.alert("Error", formatError(error));
      } finally {
        setBusy(false);
      }
    },
    [bugId],
  );

  const confirmReject = useCallback(() => {
    Alert.alert("Reject bug?", "This marks the bug rejected. It cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject",
        style: "destructive",
        onPress: () => run(rejectBug, "Bug rejected."),
      },
    ]);
  }, [run, rejectBug]);

  const confirmMerge = useCallback(() => {
    Alert.alert("Mark merged?", "This marks the bug merged (terminal).", [
      { text: "Cancel", style: "cancel" },
      { text: "Mark merged", onPress: () => run(markBugMerged, "Marked merged.") },
    ]);
  }, [run, markBugMerged]);

  if (!isStaff) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>
          You don't have access to this screen.
        </Text>
      </View>
    );
  }

  if (bug === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!bug) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.textSecondary }}>Bug not found.</Text>
      </View>
    );
  }

  const badge = statusBadge(bug.status as BugStatus);
  const isTerminal = TERMINAL.includes(bug.status as BugStatus);
  const canRetry =
    (bug.status === "IN_PROGRESS" || bug.status === "READY_FOR_IMPL") &&
    !!bug.lastError;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Bug review</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.badge, { backgroundColor: `${badge.color}20` }]}>
          <Ionicons name={badge.icon} size={14} color={badge.color} />
          <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>{bug.title}</Text>
        <Text style={[styles.meta, { color: colors.textTertiary }]}>
          Opened by {bug.originatorName}
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Brief</Text>
        <Text style={[styles.body, { color: colors.text }]}>{bug.body}</Text>

        {bug.repro ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Repro</Text>
            <Text style={[styles.body, { color: colors.text }]}>{bug.repro}</Text>
          </>
        ) : null}

        {bug.screenshotUrls && bug.screenshotUrls.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
              Screenshots
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {bug.screenshotUrls.map((url) => (
                <Image key={url} source={{ uri: url }} style={styles.screenshot} />
              ))}
            </ScrollView>
          </>
        ) : null}

        {bug.prUrl ? (
          <TouchableOpacity
            style={[styles.linkRow, { borderColor: colors.border }]}
            onPress={() => Linking.openURL(bug.prUrl as string)}
          >
            <Ionicons name="git-pull-request-outline" size={18} color={colors.text} />
            <Text style={[styles.linkText, { color: colors.text }]} numberOfLines={1}>
              {bug.prUrl}
            </Text>
          </TouchableOpacity>
        ) : null}

        {bug.lastError ? (
          <Text style={[styles.error, { color: colors.error }]}>
            Last error: {bug.lastError}
          </Text>
        ) : null}

        {!isTerminal ? (
          <View style={styles.actions}>
            {canRetry ? (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.surfaceSecondary }]}
                disabled={busy}
                onPress={() => run(retryDispatch, "Re-dispatched.")}
              >
                <Text style={[styles.actionText, { color: colors.text }]}>
                  Retry dispatch
                </Text>
              </TouchableOpacity>
            ) : null}
            {(bug.status === "READY_TO_MERGE" ||
              bug.status === "CODE_REVIEW") &&
            bug.prUrl ? (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: "#34C75920" }]}
                disabled={busy}
                onPress={confirmMerge}
              >
                <Text style={[styles.actionText, { color: "#34C759" }]}>Mark merged</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: `${colors.error}20` }]}
              disabled={busy}
              onPress={confirmReject}
            >
              <Text style={[styles.actionText, { color: colors.error }]}>Reject</Text>
            </TouchableOpacity>
          </View>
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
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", marginTop: 12 },
  meta: { fontSize: 13, marginTop: 4 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 20,
    marginBottom: 6,
  },
  body: { fontSize: 15, lineHeight: 22 },
  screenshot: {
    width: 160,
    height: 280,
    borderRadius: 10,
    marginRight: 10,
    backgroundColor: "#00000010",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 20,
  },
  linkText: { fontSize: 14, flexShrink: 1 },
  error: { fontSize: 13, marginTop: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 28 },
  actionBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  actionText: { fontSize: 14, fontWeight: "600" },
});
