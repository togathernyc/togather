/**
 * RosteringCrossTeamScreen — the Cross-team tab of the Rostering hub.
 *
 * Cross-team channels are not teams: they own no roster, they aggregate
 * membership from role assignments across several serving teams. They live
 * here — after Teams in the hub — because they can only be built once teams
 * exist. See ADR-024.
 *
 * Backend: scheduling.crossTeamChannels.listCrossTeamChannels.
 */
import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { EmptyState } from "@components/ui/EmptyState";
import { useAuthenticatedQuery } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { listCrossTeamChannelsRef, type CrossTeamChannel } from "../api/crossTeamChannels";
import { CenteredColumn } from "./CenteredColumn";
import { RosteringBackHeader } from "./RosteringBackHeader";

export function RosteringCrossTeamScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  const channels = useAuthenticatedQuery(
    listCrossTeamChannelsRef,
    groupId ? { groupId } : "skip",
  ) as CrossTeamChannel[] | undefined;

  // Interim: route to the existing channel-create screen. A dedicated
  // create-cross-team flow replaces this in a follow-up (ADR-024 Phase A).
  const handleNew = useCallback(() => {
    router.push(`/inbox/${groupId}/create` as never);
  }, [router, groupId]);

  // Tap a channel → its Channel Info screen, where the existing
  // "Edit synced roles" control reopens the selector picker and saves via
  // updateCrossTeamChannel. Reuses the shared channel-info route; no new editor.
  const handleOpenChannel = useCallback(
    (slug?: string) => {
      if (!slug) return;
      router.push(`/inbox/${groupId}/${slug}/info` as never);
    },
    [router, groupId],
  );

  if (channels === undefined) {
    return (
      <View style={[styles.root, { backgroundColor: colors.surface }]}>
        <RosteringBackHeader title="Cross-team" />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.surface }]}>
      <RosteringBackHeader title="Cross-team" />
    <ScrollView
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 24 },
      ]}
    >
      <CenteredColumn style={styles.column}>
      <Pressable
        onPress={handleNew}
        style={[styles.newRow, { borderColor: primaryColor }]}
        accessibilityRole="button"
      >
        <Ionicons name="add" size={20} color={primaryColor} />
        <Text style={[styles.newLabel, { color: primaryColor }]}>
          New cross-team channel
        </Text>
      </Pressable>

      {channels.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="git-merge-outline"
            title="No cross-team channels"
            message="A cross-team channel auto-syncs members rostered for chosen roles across several teams."
          />
        </View>
      ) : (
        channels.map((channel) => (
          <Pressable
            key={channel._id}
            onPress={() => handleOpenChannel(channel.slug)}
            style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}
            accessibilityRole="button"
          >
            <View style={styles.cardTop}>
              <Ionicons
                name="git-merge-outline"
                size={18}
                color={colors.textSecondary}
              />
              <Text
                style={[styles.cardTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {channel.name}
              </Text>
              <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                {channel.memberCount}{" "}
                {channel.memberCount === 1 ? "member" : "members"}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textTertiary}
              />
            </View>
            <Text
              style={[styles.cardSub, { color: colors.textTertiary }]}
              numberOfLines={2}
            >
              {channel.selectors.length}{" "}
              {channel.selectors.length === 1 ? "synced role" : "synced roles"}
              {channel.selectors.length > 0
                ? ` · ${channel.selectors
                    .map(
                      (s) =>
                        `${s.sourceTeamName} (${s.roleName ?? "Any role"})`,
                    )
                    .join(", ")}`
                : ""}
            </Text>
          </Pressable>
        ))
      )}
      </CenteredColumn>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
    gap: 12,
  },
  // On desktop, content children live inside CenteredColumn, so the row gap
  // must live here too (the contentContainer then has a single child). On
  // mobile CenteredColumn is a pass-through and `content`'s gap applies.
  column: {
    gap: 12,
  },
  newRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 14,
  },
  newLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  card: {
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  cardMeta: {
    fontSize: 13,
  },
  cardSub: {
    fontSize: 13,
    lineHeight: 18,
  },
});
