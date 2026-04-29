import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Avatar } from "@components/ui";
import { GroupMember } from "../types";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";

interface MembersRowProps {
  members?: GroupMember[];
  leaders?: GroupMember[];
  maxVisible?: number;
  totalCount?: number; // Optional total count for preview mode (when we only have partial data)
}

/**
 * Get initials from a member's name.
 *
 * Mirrors the AppImage helper but lives here so we can render initials inside
 * a neutral-gray circle on the group page (vs. AppImage's hashed-color
 * placeholder).
 */
function getMemberInitials(member: GroupMember): string {
  const first = (member.first_name || "").trim();
  const last = (member.last_name || "").trim();
  if (!first && !last) return "?";
  return ((first[0] || "") + (last[0] || "")).toUpperCase() || "?";
}

export function MembersRow({
  members = [],
  leaders = [],
  maxVisible = 10,
  totalCount,
}: MembersRowProps) {
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

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

  const AVATAR_SIZE = 56;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      <Text style={[styles.header, { color: colors.text }]}>MEMBERS</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {visibleMembers.map((member, index) => {
          const isLeader = leaderIds.has(member.id);
          const fullName = `${member.first_name || ""} ${member.last_name || ""}`.trim();
          // Render the avatar via Avatar when a photo is present so transforms
          // and loading states still work. When there's no photo we render a
          // neutral gray circle with initials so the row reads as a clean
          // member preview (no per-name colored placeholders).
          const renderAvatar = (size: number) =>
            member.profile_photo ? (
              <Avatar
                name={fullName}
                imageUrl={member.profile_photo}
                size={size}
              />
            ) : (
              // testID mirrors Avatar's so existing test queries that count
              // `getAllByTestId("avatar")` still see this member's slot.
              <View
                testID="avatar"
                style={[
                  styles.neutralAvatar,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.neutralAvatarInitials,
                    {
                      color: colors.textSecondary,
                      fontSize: size * 0.4,
                    },
                  ]}
                >
                  {getMemberInitials(member)}
                </Text>
              </View>
            );

          return (
            <View
              key={member.id || index}
              style={styles.avatarContainer}
            >
              {isLeader ? (
                <View style={[styles.leaderWrapper, { borderColor: primaryColor }]}>
                  {renderAvatar(AVATAR_SIZE)}
                  <View style={[styles.leaderBadge, { backgroundColor: primaryColor, borderColor: colors.surfaceSecondary }]} />
                </View>
              ) : (
                renderAvatar(AVATAR_SIZE)
              )}
            </View>
          );
        })}
        {remainingCount > 0 && (
          <View style={styles.countContainer}>
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
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 0,
  },
  header: {
    fontSize: 14,
    fontWeight: "600",
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
    // backgroundColor + borderColor set dynamically via style prop
    borderWidth: 2,
    zIndex: 1,
  },
  neutralAvatar: {
    justifyContent: "center",
    alignItems: "center",
  },
  neutralAvatarInitials: {
    fontWeight: "600",
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
    justifyContent: "center",
    alignItems: "center",
  },
  countText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
