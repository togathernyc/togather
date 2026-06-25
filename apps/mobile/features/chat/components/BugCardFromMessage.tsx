/**
 * BugCardFromMessage
 *
 * Inline chat card for a dev-assistant bug (contentType === "bug_card").
 * Mirrors TaskCardFromMessage/ReachOutTaskCard: queries the bug by id (staff
 * only — getBugForReview enforces it), renders a status badge, and offers
 * "Open review" + "View PR". Uses StyleSheet + TouchableOpacity for press
 * feedback (no NativeWind in this repo).
 */

import React from "react";
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { Id } from "@services/api/convex";
import { api, useQuery, useStoredAuthToken } from "@services/api/convex";
import { useAuth } from "@/providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";

interface BugCardFromMessageProps {
  bugId: Id<"devBugs">;
}

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
      return { label: "Ready", color: "#5856D6", icon: "rocket-outline" };
    case "IN_PROGRESS":
      return { label: "In progress", color: "#FF9500", icon: "construct-outline" };
    case "CODE_REVIEW":
      return { label: "In review", color: "#007AFF", icon: "git-pull-request-outline" };
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

export function BugCardFromMessage({ bugId }: BugCardFromMessageProps) {
  const router = useRouter();
  const token = useStoredAuthToken();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  // This is a staff-only card and getBugForReview throws for non-staff. In a
  // mixed channel every recipient renders this component, so gate the query on
  // the viewer's staff flag — non-staff just see nothing instead of a Convex
  // query error.
  const isStaff = user?.is_superuser === true || user?.is_staff === true;

  const bug = useQuery(
    api.functions.devAssistant.bugs.getBugForReview,
    token && isStaff ? { token, bugId } : "skip",
  );

  if (!isStaff) {
    return null;
  }
  if (bug === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={primaryColor} />
      </View>
    );
  }
  // Null when the bug is missing or the viewer isn't staff — render nothing.
  if (!bug) {
    return null;
  }

  const badge = statusBadge(bug.status as BugStatus);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderLeftColor: badge.color },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: `${badge.color}20` }]}>
          <Ionicons name={badge.icon} size={14} color={badge.color} />
          <Text style={[styles.badgeText, { color: badge.color }]}>
            {badge.label}
          </Text>
        </View>
        <Text style={[styles.tag, { color: colors.textTertiary }]}>🤖 Bug</Text>
      </View>

      <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
        {bug.title}
      </Text>
      {bug.body ? (
        <Text style={[styles.body, { color: colors.textSecondary }]} numberOfLines={3}>
          {bug.body}
        </Text>
      ) : null}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: `${primaryColor}20` }]}
          onPress={() => router.push(`/(user)/admin/bugs/${bugId}`)}
        >
          <Text style={[styles.buttonText, { color: primaryColor }]}>
            Open review
          </Text>
        </TouchableOpacity>
        {bug.prUrl ? (
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.surfaceSecondary }]}
            onPress={() => Linking.openURL(bug.prUrl as string)}
          >
            <Text style={[styles.buttonText, { color: colors.text }]}>View PR</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    padding: 16,
    alignItems: "center",
  },
  card: {
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  tag: {
    fontSize: 12,
    fontWeight: "600",
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 21,
  },
  body: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
