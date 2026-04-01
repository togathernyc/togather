import React, { useState, useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Avatar, AppImage } from "@components/ui";
import { getGroupTypeLabel } from "@features/groups/utils";
import { useAuth } from "@providers/AuthProvider";
import { Group, GroupMember } from "@features/groups/types";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuthenticatedMutation } from "@services/api/convex";
import { api } from "@services/api/convex";

interface GroupPreviewCardProps {
  group: Group;
}

type JoinState = "idle" | "joined" | "requested";

export function GroupPreviewCard({ group }: GroupPreviewCardProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const createJoinRequest = useAuthenticatedMutation(api.functions.groupMembers.createJoinRequest);

  // Determine initial join state from group data
  const getInitialJoinState = (): JoinState => {
    if (group.is_member || group.user_role) return "joined";
    if (group.has_pending_request) return "requested";
    return "idle";
  };

  const [joinState, setJoinState] = useState<JoinState>(getInitialJoinState);
  const [isJoining, setIsJoining] = useState(false);
  const hadServerPendingRequestRef = useRef(false);

  // Keep local state in sync when Convex refreshes membership (e.g. auto-approve after join).
  // Only reset to "idle" after a server-confirmed pending request clears (decline); not while
  // optimistic "requested" is ahead of has_pending_request on the wire.
  useEffect(() => {
    if (group.has_pending_request) {
      hadServerPendingRequestRef.current = true;
    }
    if (group.is_member || group.user_role) {
      setJoinState("joined");
    } else if (group.has_pending_request) {
      setJoinState("requested");
    } else if (
      !isJoining &&
      joinState === "requested" &&
      hadServerPendingRequestRef.current
    ) {
      setJoinState("idle");
      hadServerPendingRequestRef.current = false;
    }
  }, [
    group.is_member,
    group.user_role,
    group.has_pending_request,
    isJoining,
    joinState,
  ]);

  // Prefer group_type_name from API, fallback to ID lookup
  const typeLabel = getGroupTypeLabel(group.group_type_name ?? group.group_type ?? group.type ?? 1, user);
  const previewUrl = group.preview || group.image_url;
  const hasImage = !!previewUrl;
  const groupName = group.title || group.name || "Untitled Group";

  const members: GroupMember[] = group.members || [];
  const membersCount = group.members_count || members.length;
  const maxVisibleAvatars = 4;
  const visibleMembers = members.slice(0, maxVisibleAvatars);
  const remainingCount = membersCount > maxVisibleAvatars ? membersCount - maxVisibleAvatars : 0;

  // Get location string
  const getLocationString = () => {
    if (group.city && group.state) {
      return `${group.city}, ${group.state}`;
    }
    if (group.location) {
      return group.location;
    }
    if (group.full_address) {
      return group.full_address;
    }
    return null;
  };

  const locationString = getLocationString();

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

  // Use Convex _id for navigation, fallback to legacy id
  const groupId = group._id || group.id;

  const handleViewDetails = () => {
    router.push(`/groups/${groupId}`);
  };

  const handleJoin = useCallback(async () => {
    if (joinState !== "idle" || isJoining) return;

    setIsJoining(true);
    try {
      await createJoinRequest({ groupId: group._id as any });
      // All groups use the request flow — show "Requested" optimistically.
      // If the group is open and auto-approves, the server will resolve it
      // and the next query refresh will show "Member".
      setJoinState("requested");
    } catch (error: any) {
      if (error?.message?.includes("already a member")) {
        setJoinState("joined");
      } else if (error?.message?.includes("already have a pending")) {
        setJoinState("requested");
      }
      // For other errors, remain in idle state so the user can retry
    } finally {
      setIsJoining(false);
    }
  }, [joinState, isJoining, createJoinRequest, group._id]);

  const getJoinButtonLabel = () => {
    if (isJoining) return "";
    switch (joinState) {
      case "joined": return "Member";
      case "requested": return "Requested";
      default: return "Join";
    }
  };

  const getJoinButtonStyle = () => {
    switch (joinState) {
      case "joined":
        return { backgroundColor: `${primaryColor}15`, borderWidth: 1.5, borderColor: primaryColor };
      case "requested":
        return { backgroundColor: "#F5F5F5", borderWidth: 1.5, borderColor: "#E5E5E5" };
      default:
        return { backgroundColor: primaryColor };
    }
  };

  const getJoinButtonTextStyle = () => {
    switch (joinState) {
      case "joined":
        return { color: primaryColor };
      case "requested":
        return { color: "#666" };
      default:
        return { color: "#fff" };
    }
  };

  return (
    <View style={styles.container}>
      {/* Group Image */}
      <View style={styles.imageContainer}>
        <AppImage
          source={previewUrl}
          style={styles.groupImage}
          resizeMode="cover"
          optimizedWidth={400}
          placeholder={{
            type: "initials",
            name: groupName,
            backgroundColor: getPlaceholderColor(),
          }}
        />
      </View>

      {/* Group Info */}
      <View style={styles.infoSection}>
        {/* Type Badge */}
        {typeLabel && (
          <View style={[styles.typeBadge, { backgroundColor: `${primaryColor}15` }]}>
            <Text style={[styles.typeText, { color: primaryColor }]}>{typeLabel}</Text>
          </View>
        )}

        {/* Group Name */}
        <Text style={styles.groupName} numberOfLines={2}>
          {groupName}
        </Text>

        {/* Location */}
        {locationString && (
          <View style={styles.locationRow}>
            <Text style={styles.locationIcon}>📍</Text>
            <Text style={styles.locationText} numberOfLines={1}>
              {locationString}
            </Text>
          </View>
        )}

        {/* Members */}
        {membersCount > 0 && (
          <View style={styles.membersSection}>
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
                <View style={[styles.avatarWrapper, styles.avatarWrapperOverlap, styles.countBadge]}>
                  <Text style={styles.countText}>+{remainingCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.membersCount}>
              {membersCount} {membersCount === 1 ? "member" : "members"}
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={handleViewDetails}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryButtonText}>View Details</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, getJoinButtonStyle()]}
            onPress={joinState === "idle" ? handleJoin : undefined}
            activeOpacity={joinState === "idle" ? 0.7 : 1}
            disabled={joinState !== "idle" || isJoining}
          >
            {isJoining ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[styles.primaryButtonText, getJoinButtonTextStyle()]}>
                {getJoinButtonLabel()}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    ...Platform.select({
      web: {
        boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.1)",
      },
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
        elevation: 3,
      },
    }),
  },
  imageContainer: {
    width: "100%",
    height: 200,
    backgroundColor: "#f5f5f5",
  },
  groupImage: {
    width: "100%",
    height: "100%",
  },
  placeholderImage: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderText: {
    fontSize: 48,
    fontWeight: "600",
    color: "#fff",
  },
  infoSection: {
    padding: 16,
  },
  typeBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 12,
  },
  typeText: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  groupName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
    marginBottom: 12,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  locationIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  locationText: {
    fontSize: 14,
    color: "#666",
    flex: 1,
  },
  membersSection: {
    marginBottom: 20,
  },
  membersRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
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
    backgroundColor: "#f5f5f5",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  countText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#666",
  },
  membersCount: {
    fontSize: 13,
    color: "#666",
    fontWeight: "500",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButton: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#E5E5E5",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});
