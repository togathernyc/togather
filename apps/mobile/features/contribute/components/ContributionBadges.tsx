/**
 * Small shared badges for contribution cards and the detail screen:
 * status chip, kind pill (Bug/Feature), risk badge, and "From chat" tag.
 */
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { Contribution, ContributionKind, RiskLevel } from "../types";
import {
  kindPresentation,
  riskPresentation,
  statusPresentation,
} from "../utils/status";

export function StatusChip({
  contribution,
}: {
  contribution: Pick<
    Contribution,
    "status" | "spec" | "specApprovedAt" | "scope" | "verifyOnStaging" | "stagingVerifiedAt"
  >;
}) {
  const { label, color, icon } = statusPresentation(contribution);
  return (
    <View style={[styles.badge, { backgroundColor: `${color}20` }]}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function KindPill({ kind }: { kind: ContributionKind | undefined }) {
  const { label, color, icon } = kindPresentation(kind);
  return (
    <View style={[styles.badge, { backgroundColor: `${color}20` }]}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const { label, color } = riskPresentation(risk);
  return (
    <View style={[styles.badge, { backgroundColor: `${color}20` }]}>
      <View style={[styles.riskDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function FromChatTag() {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: colors.surfaceSecondary }]}>
      <Ionicons name="chatbubble-outline" size={13} color={colors.textSecondary} />
      <Text style={[styles.badgeText, { color: colors.textSecondary }]}>From chat</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
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
  riskDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
