import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Avatar } from "@components/ui";
import { GroupMember } from "../types";
import { useCommunityTheme } from "@hooks/useCommunityTheme";

interface MembersRowProps {
  members?: GroupMember[];
  leaders?: GroupMember[];
  maxVisible?: number;
  totalCount?: number; // Optional total count for preview mode (when we only have partial data)
}

export function MembersRow({
  members = [],
  leaders = [],
  maxVisible = 10,
  totalCount,
}: MembersRowProps) {
  const { primaryColor } = useCommunityTheme();

  // Merge leaders and members, ensuring leaders appear first and aren't duplicated
  const mergedMembers = useMemo(() => {
    const leaderIds = new Set(leaders.map((leader) => leader.id));
    // Filter out members who are also leaders to avoid duplicates
    const nonLeaderMembers = members.filter(
      (member) => !leaderIds.has(member.id)
    );
    // Leaders first, then regular members
    return [...leaders, ...nonLeaderMembers];
  }, [members, leaders]);

  if (mergedMembers.length === 0) {
    return null;
  }

  const leaderIds = new Set(leaders.map((leader) => leader.id));
  const visibleMembers = mergedMembers.slice(0, maxVisible);
  // Use provided totalCount if available (for preview mode), otherwise calculate from array
  const actualTotal = totalCount ?? mergedMembers.length;
  const remainingCount = actualTotal - Math.min(maxVisible, mergedMembers.length);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>MEMBERS</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {visibleMembers.map((member, index) => {
          const isLeader = leaderIds.has(member.id);
          return (
            <View
              key={member.id || index}
              style={styles.avatarContainer}
            >
              {isLeader ? (
                <View style={[styles.leaderWrapper, { borderColor: primaryColor }]}>
                  <Avatar
                    name={`${member.first_name || ""} ${member.last_name || ""}`.trim()}
                    imageUrl={member.profile_photo}
                    size={56}
                  />
                  <View style={[styles.leaderBadge, { backgroundColor: primaryColor }]} />
                </View>
              ) : (
                <Avatar
                  name={`${member.first_name || ""} ${member.last_name || ""}`.trim()}
                  imageUrl={member.profile_photo}
                  size={56}
                />
              )}
            </View>
          );
        })}
        {remainingCount > 0 && (
          <View style={styles.countContainer}>
            <View style={styles.countCircle}>
              <Text style={styles.countText}>+{remainingCount}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 0,
  },
  header: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarContainer: {
    marginRight: 0,
    position: "relative",
  },
  leaderWrapper: {
    position: "relative",
    borderRadius: 30,
    borderWidth: 3,
    // borderColor set dynamically via style prop
    padding: 2,
  },
  leaderBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    // backgroundColor set dynamically via style prop
    borderWidth: 2,
    borderColor: "#FFFFFF",
    zIndex: 1,
  },
  countContainer: {
    marginLeft: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  countCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#E0E0E0",
    justifyContent: "center",
    alignItems: "center",
  },
  countText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
});

