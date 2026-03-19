import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useLeaderGroups } from "../hooks/useLeaderGroups";
import { useLeaderGroupMemberCounts } from "../hooks/useLeaderGroupMemberCounts";
import { useTheme } from "@hooks/useTheme";

interface LeaderGroupsListProps {
  onGroupPress?: (groupId: number) => void;
}

export function LeaderGroupsList({ onGroupPress }: LeaderGroupsListProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const { leaderGroups, isLoading } = useLeaderGroups();

  // Fetch member counts for each group (optimized to fetch in parallel)
  const groupIds = leaderGroups
    .map((g: any) => g.group?.id || g.id)
    .filter(Boolean);
  const groupMemberCounts = useLeaderGroupMemberCounts(groupIds);

  const handleGroupPress = (group: any) => {
    // Prefer Convex _id for navigation, fallback to legacy IDs
    const groupId = group.group?._id || group._id || group.group?.id || group.id;
    if (onGroupPress) {
      onGroupPress(groupId);
    } else {
      router.push(`/(user)/leader-tools/${groupId}`);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: colors.textTertiary }]}>Loading groups...</Text>
      </View>
    );
  }

  if (leaderGroups.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
          You're not a leader of any groups yet.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.groupsContainer}>
      {leaderGroups.map((group: any, index: number) => {
        // For member count lookup, use the group ID (legacy) since that's what the API uses
        const legacyGroupId = group.group?.id || group.id;
        // Try to get member count from various sources
        const count =
          groupMemberCounts.data?.[legacyGroupId] ||
          group.group?.members_count ||
          group.members_count ||
          group.group?.members?.length ||
          group.members?.length ||
          0;

        return (
          <TouchableOpacity
            key={index}
            style={[styles.groupCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => handleGroupPress(group)}
          >
            <Ionicons name="people" size={24} color={colors.link} />
            <View style={styles.cardContent}>
              <Text style={[styles.groupTitle, { color: colors.text }]}>
                {group.group?.title ||
                  group.title ||
                  `Group ${index + 1}`}
              </Text>
              <Text style={[styles.groupInfo, { color: colors.textSecondary }]}>
                {count} {count === 1 ? "member" : "members"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  groupsContainer: {
    gap: 12,
  },
  groupCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  cardContent: {
    flex: 1,
    marginLeft: 12,
  },
  groupTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  groupInfo: {
    fontSize: 14,
  },
  emptyContainer: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    textAlign: "center",
  },
});

