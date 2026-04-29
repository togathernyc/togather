import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Avatar } from "@components/ui";
import { GroupMember } from "../types";
import { useTheme } from "@hooks/useTheme";

interface MembersRowProps {
  members?: GroupMember[];
  leaders?: GroupMember[];
  maxVisible?: number;
  totalCount?: number;
}

/**
 * Horizontal avatar preview for the MEMBERS card on the group page.
 * Initials avatars now use neutral gray (theme-aware) — the previous
 * red/green community-tinted leader rings have been retired in favour of
 * the cleaner DM-info aesthetic. Leaders are still surfaced via a
 * subtle dark dot in the corner.
 */
export function MembersRow({
  members = [],
  leaders = [],
  maxVisible = 10,
  totalCount,
}: MembersRowProps) {
  const { colors } = useTheme();

  const mergedMembers = useMemo(() => {
    const leaderIds = new Set(leaders.map((leader) => leader.id));
    const nonLeaderMembers = members.filter(
      (member) => !leaderIds.has(member.id),
    );
    return [...leaders, ...nonLeaderMembers];
  }, [members, leaders]);

  if (mergedMembers.length === 0) {
    return null;
  }

  const leaderIds = new Set(leaders.map((leader) => leader.id));
  const visibleMembers = mergedMembers.slice(0, maxVisible);
  const actualTotal = totalCount ?? mergedMembers.length;
  const remainingCount = actualTotal - Math.min(maxVisible, mergedMembers.length);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {visibleMembers.map((member, index) => {
          const isLeader = leaderIds.has(member.id);
          return (
            <View key={member.id || index} style={styles.avatarContainer}>
              <Avatar
                name={`${member.first_name || ""} ${member.last_name || ""}`.trim()}
                imageUrl={member.profile_photo}
                size={48}
                placeholderBackgroundColor={colors.border}
              />
              {isLeader && (
                <View
                  style={[
                    styles.leaderBadge,
                    {
                      backgroundColor: colors.text,
                      borderColor: colors.surfaceSecondary,
                    },
                  ]}
                />
              )}
            </View>
          );
        })}
        {remainingCount > 0 && (
          <View
            style={[
              styles.countCircle,
              { backgroundColor: colors.border },
            ]}
          >
            <Text style={[styles.countText, { color: colors.textSecondary }]}>
              +{remainingCount}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatarContainer: {
    position: "relative",
  },
  leaderBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  countCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  countText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
