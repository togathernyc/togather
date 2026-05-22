/**
 * RosteringTeamsScreen — the Teams tab of the Rostering hub.
 *
 * Lists the campus group's serving teams, each badged by schedule source
 * (Native rostering vs. Planning Center). Tapping a team opens its detail
 * screen; "+ New team" starts team creation. See ADR-024.
 *
 * Backend: scheduling.teams.listTeamChannels.
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
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

type TeamRow = {
  _id: Id<"chatChannels">;
  name: string;
  channelType: string;
  memberCount: number;
};

export function RosteringTeamsScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  const teams = useAuthenticatedQuery(
    api.functions.scheduling.teams.listTeamChannels,
    groupId ? { groupId } : "skip",
  ) as TeamRow[] | undefined;

  // Interim: route to the existing channel-create screen. A dedicated
  // create-team flow replaces this in a follow-up (ADR-024 Phase A).
  const handleNewTeam = useCallback(() => {
    router.push(`/inbox/${groupId}/create` as never);
  }, [router, groupId]);

  if (teams === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.surface }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + 24 },
      ]}
    >
      <Pressable
        onPress={handleNewTeam}
        style={[styles.newRow, { borderColor: primaryColor }]}
        accessibilityRole="button"
      >
        <Ionicons name="add" size={20} color={primaryColor} />
        <Text style={[styles.newLabel, { color: primaryColor }]}>New team</Text>
      </Pressable>

      {teams.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="people-outline"
            title="No serving teams yet"
            message="Create a team to start rostering volunteers for it."
          />
        </View>
      ) : (
        teams.map((team) => (
          <Pressable
            key={team._id}
            onPress={() =>
              router.push(`/rostering/${groupId}/team/${team._id}` as never)
            }
            style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}
          >
            <View style={styles.cardMain}>
              <Text
                style={[styles.cardTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {team.name}
              </Text>
              <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                {team.memberCount}{" "}
                {team.memberCount === 1 ? "member" : "members"}
              </Text>
            </View>
            <SourceBadge
              isPco={team.channelType === "pco_services"}
              colors={colors}
            />
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textTertiary}
            />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

/** A pill marking a team's schedule source — Native rostering or Planning Center. */
function SourceBadge({
  isPco,
  colors,
}: {
  isPco: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: isPco ? colors.border : colors.success + "22" },
      ]}
    >
      <Text
        style={[
          styles.badgeText,
          { color: isPco ? colors.textSecondary : colors.success },
        ]}
      >
        {isPco ? "Planning Center" : "Native"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    padding: 14,
  },
  cardMain: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  cardMeta: {
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
});
