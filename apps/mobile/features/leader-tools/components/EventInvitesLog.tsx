import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";

interface EventInvitesLogProps {
  meetingId: string;
}

/**
 * Per-recipient invite status, visible to hosts/leaders on the event detail.
 * Renders nothing if there are no invites yet — keeps the page clean before
 * the host has sent any.
 */
export function EventInvitesLog({ meetingId }: EventInvitesLogProps) {
  const { colors } = useTheme();
  const invites = useAuthenticatedQuery(api.functions.eventInvites.list, {
    meetingId: meetingId as Id<"meetings">,
  });

  if (invites === undefined) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }
  if (invites.length === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.headerRow}>
        <Ionicons name="mail-outline" size={16} color={colors.text} />
        <Text style={[styles.heading, { color: colors.text }]}>
          {`Invites (${invites.length})`}
        </Text>
      </View>
      {invites.slice(0, 20).map((inv) => (
        <View key={inv._id} style={styles.row}>
          <Text
            style={[styles.name, { color: colors.text }]}
            numberOfLines={1}
          >
            {inv.recipientName}
          </Text>
          <StatusBadge status={inv.status} smsStatus={inv.smsStatus} />
        </View>
      ))}
      {invites.length > 20 && (
        <Text style={[styles.more, { color: colors.textSecondary }]}>
          {`+${invites.length - 20} more`}
        </Text>
      )}
    </View>
  );
}

function StatusBadge({
  status,
  smsStatus,
}: {
  status: string;
  smsStatus: string | null;
}) {
  const { colors } = useTheme();
  let label = "Sent";
  let color = colors.textSecondary;
  let icon: "checkmark-circle" | "alert-circle" | "time-outline" =
    "checkmark-circle";

  if (status === "pending") {
    label = "Sending…";
    icon = "time-outline";
  } else if (status === "failed") {
    label = smsStatus === "skipped" ? "No phone" : "Failed";
    color = "#DC2626";
    icon = "alert-circle";
  } else if (status === "partial") {
    label = "Partial";
    color = "#D97706";
    icon = "alert-circle";
  } else if (status === "sent") {
    label = "Delivered";
    color = "#16A34A";
    icon = "checkmark-circle";
  }

  return (
    <View style={styles.badgeRow}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  heading: { fontSize: 14, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  name: { fontSize: 14, flex: 1, marginRight: 8 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  badgeText: { fontSize: 12, fontWeight: "500" },
  more: { fontSize: 12, marginTop: 6, textAlign: "center" },
});
