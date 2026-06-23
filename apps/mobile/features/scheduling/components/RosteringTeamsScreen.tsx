/**
 * RosteringTeamsScreen — the Teams tab of the Rostering hub.
 *
 * Lists the campus group's first-class serving teams (ADR-025). Each team
 * shows its member count, or — for a channel-less team — a subtle "no chat
 * channel" hint. Tapping a team opens its detail screen; "+ New team" starts
 * the create-team flow. See ADR-024.
 *
 * Backend: scheduling.teams.listTeams.
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
import { CenteredColumn } from "./CenteredColumn";

type TeamRow = {
  _id: Id<"teams">;
  name: string;
  description?: string;
  channelId: Id<"chatChannels"> | null;
  hasChannel: boolean;
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
    api.functions.scheduling.teams.listTeams,
    groupId ? { groupId } : "skip",
  ) as TeamRow[] | undefined;

  const handleNewTeam = useCallback(() => {
    router.push(`/rostering/${groupId}/team/new` as never);
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
      <CenteredColumn style={styles.column}>
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
              {team.hasChannel ? (
                <Text style={[styles.cardMeta, { color: colors.textSecondary }]}>
                  {team.memberCount}{" "}
                  {team.memberCount === 1 ? "member" : "members"}
                </Text>
              ) : (
                <View style={styles.noChannelRow}>
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={12}
                    color={colors.textTertiary}
                  />
                  <Text
                    style={[styles.cardMeta, { color: colors.textTertiary }]}
                  >
                    No chat channel
                  </Text>
                </View>
              )}
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textTertiary}
            />
          </Pressable>
        ))
      )}
      </CenteredColumn>
    </ScrollView>
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
  noChannelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
});
