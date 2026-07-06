/**
 * ContributeListScreen — "My contributions" (ADR-029 Phase 1).
 *
 * The contributor's home: everything they've reported (dashboard submissions
 * and chat-originated items alike), newest first, with friendly status chips,
 * plus the primary "Report a bug or idea" CTA. Access is gated on the
 * dev-assistant maintainer check (useDevAccess).
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { format } from "date-fns";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useDevAccess } from "../hooks/useDevAccess";
import { useMyContributions } from "../hooks/useMyContributions";
import { isFromChat } from "../utils/status";
import { FromChatTag, KindPill, RiskBadge, StatusChip } from "./ContributionBadges";
import type { Contribution } from "../types";

export function ContributeListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { hasAccess, isLoading: accessLoading } = useDevAccess();
  const { contributions, isLoading } = useMyContributions();

  const renderItem = ({ item }: { item: Contribution }) => (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => router.push(`/(user)/contribute/${item._id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.iconSecondary} />
      </View>
      <View style={styles.badgeRow}>
        <KindPill kind={item.kind} />
        <StatusChip contribution={item} />
        {item.riskLevel ? <RiskBadge risk={item.riskLevel} /> : null}
        {isFromChat(item) ? <FromChatTag /> : null}
      </View>
      <Text style={[styles.cardDate, { color: colors.textTertiary }]}>
        {format(new Date(item.createdAt), "MMM d, yyyy")}
      </Text>
    </TouchableOpacity>
  );

  const renderBody = () => {
    if (accessLoading || (hasAccess && isLoading)) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      );
    }

    if (!hasAccess) {
      return (
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.iconSecondary} />
          <Text style={[styles.lockedText, { color: colors.textSecondary }]}>
            This area is for Togather contributors. Ask the team to invite you if
            you'd like to help build the app.
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={contributions ?? []}
        keyExtractor={(item) => item._id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <TouchableOpacity
            style={[styles.reportButton, { backgroundColor: primaryColor }]}
            onPress={() => router.push("/(user)/contribute/submit")}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={20} color="#ffffff" />
            <Text style={styles.reportButtonText}>Report a bug or idea</Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="sparkles-outline" size={40} color={colors.iconSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              Nothing here yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              Spotted something broken, or have an idea to make Togather better?
              Report it and we'll take it from there — you'll see every step as
              it gets built and shipped.
            </Text>
          </View>
        }
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My contributions</Text>
        <View style={styles.backBtn} />
      </View>
      {renderBody()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
  },
  lockedText: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  listContent: { padding: 16, paddingBottom: 48 },
  reportButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 16,
  },
  reportButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "600", flex: 1 },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  cardDate: { fontSize: 12, marginTop: 10 },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 16,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: "600", marginTop: 8 },
  emptyText: { fontSize: 14, lineHeight: 21, textAlign: "center" },
});
