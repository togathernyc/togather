import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { Avatar, AppImage } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { getGroupTypeLabel } from "../utils";
import { formatCadence } from "../utils/formatCadence";
import { Group, GroupMember } from "../types";

interface GroupSearchItemProps {
  group: Group;
}

export function GroupSearchItem({ group }: GroupSearchItemProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  const typeLabel = getGroupTypeLabel(group.type || 1, user);
  const schedule = formatCadence(group);
  const previewUrl = group.preview || group.image_url;
  const hasImage = !!previewUrl;
  const groupName = group.title || group.name || "Untitled Group";
  
  // Get members from group (could be members, or members_count)
  const members: GroupMember[] = group.members || [];
  const membersCount = group.members_count || members.length;
  const maxVisibleAvatars = 6;
  const visibleMembers = members.slice(0, maxVisibleAvatars);
  const remainingCount = membersCount > maxVisibleAvatars ? membersCount - maxVisibleAvatars : 0;

  // Get initials for placeholder image
  const getInitials = () => {
    const name = groupName.trim();
    if (!name) return "G";
    const parts = name.split(" ").filter(p => p.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name[0]?.toUpperCase() || "G";
  };

  // Get color for placeholder
  const getPlaceholderColor = () => {
    const placeholderColors = [primaryColor, primaryColor, "#0A84FF", "#66D440", "#F56848"];
    const index = groupName.charCodeAt(0) % placeholderColors.length;
    return placeholderColors[index];
  };

  // Use Convex _id for navigation
  const groupId = group._id;

  return (
    <TouchableOpacity
      style={[styles.groupItem, { backgroundColor: colors.surface }]}
      onPress={() => router.push(`/groups/${groupId}`)}
      activeOpacity={0.7}
    >
      <View style={styles.groupContent}>
        {/* Left side: Group image */}
        <View style={styles.imageContainer}>
          <AppImage
            source={previewUrl}
            style={styles.groupImage}
            resizeMode="cover"
            optimizedWidth={200}
            placeholder={{
              type: "initials",
              name: groupName,
              backgroundColor: getPlaceholderColor(),
            }}
          />
        </View>

        {/* Right side: Group information */}
        <View style={styles.infoContainer}>
          {/* Category label */}
          {typeLabel && (
            <Text style={[styles.categoryLabel, { color: colors.textTertiary }]}>{typeLabel}</Text>
          )}

          {/* Group name */}
          <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={1}>
            {groupName}
          </Text>

          {/* Schedule */}
          {schedule && (
            <Text style={[styles.schedule, { color: colors.textTertiary }]} numberOfLines={1}>
              {schedule}
            </Text>
          )}
          
          {/* Member avatars row */}
          {membersCount > 0 && (
            <View style={styles.membersRow}>
              {visibleMembers.map((member, index) => (
                <View
                  key={member.id || index}
                  style={[
                    styles.avatarWrapper,
                    index > 0 && styles.avatarWrapperOverlap,
                  ]}
                >
                  <Avatar
                    name={`${member.first_name || ""} ${member.last_name || ""}`.trim()}
                    imageUrl={member.profile_photo}
                    size={32}
                  />
                </View>
              ))}
              {remainingCount > 0 && (
                <View style={[styles.avatarWrapper, styles.avatarWrapperOverlap, styles.countBadge, { backgroundColor: colors.surfaceSecondary, borderColor: colors.surface }]}>
                  <Text style={[styles.countText, { color: colors.textSecondary }]}>+{remainingCount}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  groupItem: {
    borderRadius: 12,
    marginBottom: 12,
    ...Platform.select({
      web: {
        boxShadow: "0px 2px 8px rgba(0, 0, 0, 0.1)",
      },
      default: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
        elevation: 2,
      },
    }),
  },
  groupContent: {
    flexDirection: "row",
    padding: 12,
  },
  imageContainer: {
    marginRight: 12,
  },
  groupImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  placeholderImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    fontSize: 24,
    fontWeight: "600",
  },
  infoContainer: {
    flex: 1,
    justifyContent: "space-between",
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: "500",
    textTransform: "uppercase",
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  schedule: {
    fontSize: 12,
    marginBottom: 8,
  },
  membersRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  avatarWrapper: {
    marginRight: -8,
    zIndex: 1,
  },
  avatarWrapperOverlap: {
    marginLeft: 0,
  },
  countBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },
  countText: {
    fontSize: 10,
    fontWeight: "600",
  },
});
