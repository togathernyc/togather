import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { GroupHeader } from "./GroupHeader";
import { MembersRow } from "./MembersRow";
import { HighlightsGrid } from "./HighlightsGrid";
import { GroupMapSection } from "./GroupMapSection";
import { JoinGroupButton } from "./JoinGroupButton";
import { GroupOptionsModal } from "./GroupOptionsModal";
import { Group } from "../types";
import { ImageViewerManager } from "@/providers/ImageViewerProvider";
import { useAuth } from "@providers/AuthProvider";
import { useArchiveGroup } from "../hooks";

interface GroupNonMemberViewProps {
  group: Group;
  onJoinPress: () => void;
  onWithdrawPress?: () => void;
  isJoining?: boolean;
  isWithdrawing?: boolean;
}

export function GroupNonMemberView({
  group,
  onJoinPress,
  onWithdrawPress,
  isJoining = false,
  isWithdrawing = false,
}: GroupNonMemberViewProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const [showOptionsModal, setShowOptionsModal] = useState(false);

  // Check if user is a community admin - admins should see the menu even if not a member
  const isAdmin = user?.is_admin === true;

  // Archive group mutation (for admins)
  const groupIdentifier = group?._id;
  const archiveGroupMutation = useArchiveGroup(groupIdentifier);

  // Handle archive group (for admins)
  const handleArchiveGroup = () => {
    Alert.alert(
      "Archive Group",
      `Are you sure you want to archive "${
        group?.name || "this group"
      }"? This will hide the group from all members. This action can be undone by a community admin.`,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => setShowOptionsModal(false),
        },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            await archiveGroupMutation.mutate();
          },
        },
      ]
    );
  };

  // Navigate to members page (for admins) - use Convex _id for navigation
  const handleMembersPress = () => {
    if (!group._id) return;
    router.push(`/leader-tools/${group._id}/members`);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header with image, name, and cadence */}
        {/* Show 3-dots menu for everyone (Share Group) and admins (Edit, Archive, etc.) */}
        <GroupHeader
          group={group}
          showMenu={true}
          onMenuPress={() => setShowOptionsModal(true)}
        />

        {/* Description */}
        <View style={[styles.descriptionContainer, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {group.description || "No description available."}
          </Text>
        </View>

        {/* Map Section - Only shown to admins for non-members
            SECURITY: Location data should not be shown to non-members */}
        {isAdmin && <GroupMapSection group={group} />}

        {/* Members Section */}
        {/* Admins can see full member list and navigate to members page */}
        {/* Non-admins see only member count with join prompt */}
        {isAdmin ? (
          ((group.members && group.members.length > 0) ||
           (group.leaders && group.leaders.length > 0)) ? (
            <TouchableOpacity onPress={handleMembersPress} activeOpacity={0.7}>
              <MembersRow members={group.members} leaders={group.leaders} />
              <View style={[styles.viewMembersHint, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.viewMembersText, { color: colors.link }]}>View all members</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.link} />
              </View>
            </TouchableOpacity>
          ) : null
        ) : (
          // Non-admins: show member preview avatars with count
          // Use member_preview if available, otherwise fall back to count
          (group.members_count && group.members_count > 0) ||
          ((group as any).member_preview?.length > 0) ? (
            group.user_request_status === "pending" ? (
              // User has pending request - show preview but non-interactive
              <View>
                {(group as any).member_preview?.length > 0 ? (
                  <MembersRow
                    members={(group as any).member_preview}
                    leaders={[]}
                    maxVisible={5}
                    totalCount={group.members_count || 0}
                  />
                ) : (
                  <View style={[styles.nonMemberMembersContainer, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[styles.nonMemberMembersTitle, { color: colors.text }]}>MEMBERS</Text>
                    <View style={styles.nonMemberMembersRow}>
                      <View style={[styles.nonMemberCountCircle, { backgroundColor: colors.border }]}>
                        <Ionicons name="people" size={24} color={colors.textSecondary} />
                      </View>
                      <Text style={[styles.nonMemberMembersCount, { color: colors.text }]}>
                        {group.members_count} members
                      </Text>
                    </View>
                  </View>
                )}
                <View style={[styles.nonMemberHintContainer, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.nonMemberPendingHint, { color: colors.textSecondary }]}>Request pending - you'll see all members once approved</Text>
                </View>
              </View>
            ) : (
              // User can join - show preview, tap shows info alert
              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    "Members",
                    "Join this group to see all members. Use the button below to request to join."
                  );
                }}
                activeOpacity={0.7}
              >
                {(group as any).member_preview?.length > 0 ? (
                  <MembersRow
                    members={(group as any).member_preview}
                    leaders={[]}
                    maxVisible={5}
                    totalCount={group.members_count || 0}
                  />
                ) : (
                  <View style={[styles.nonMemberMembersContainer, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[styles.nonMemberMembersTitle, { color: colors.text }]}>MEMBERS</Text>
                    <View style={styles.nonMemberMembersRow}>
                      <View style={[styles.nonMemberCountCircle, { backgroundColor: colors.border }]}>
                        <Ionicons name="people" size={24} color={colors.textSecondary} />
                      </View>
                      <Text style={styles.nonMemberMembersCount}>
                        {group.members_count} members
                      </Text>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            )
          ) : null
        )}

        {/* Highlights */}
        {group.highlights && group.highlights.length > 0 && (
          <HighlightsGrid
            highlights={group.highlights as any}
            onImagePress={(clickedHighlight) => {
              const imageUrls = (group.highlights ?? [])
                .map((h: any) => h.image_url)
                .filter(Boolean) as string[];

              const index = (group.highlights ?? []).findIndex(
                (h: any) => h.id === clickedHighlight.id
              );

              ImageViewerManager.show(imageUrls, Math.max(0, index));
            }}
          />
        )}

        {/* Spacer for fixed button */}
        <View style={styles.spacer} />
      </ScrollView>

      {/* Join Button - Fixed at bottom */}
      <JoinGroupButton
        onPress={onJoinPress}
        onWithdraw={onWithdrawPress}
        isPending={isJoining || isWithdrawing}
        group={group}
        requestStatus={
          group.user_request_status as "pending" | "accepted" | "declined" | null
        }
      />

      {/* Options Modal - Share Group for everyone, Edit/Archive for admins */}
      <GroupOptionsModal
        visible={showOptionsModal}
        group={group}
        onClose={() => setShowOptionsModal(false)}
        onLeaveGroup={() => {}} // No-op since user is not a member
        onArchiveGroup={handleArchiveGroup}
        isLeaving={false}
        isArchiving={archiveGroupMutation.isPending}
        isMember={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100, // Space for fixed button
  },
  descriptionContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginTop: 0,
  },
  description: {
    fontSize: 16,
    lineHeight: 24,
  },
  spacer: {
    height: 20,
  },
  viewMembersHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    marginTop: -8,
    paddingBottom: 16,
  },
  viewMembersText: {
    fontSize: 14,
    fontWeight: "500",
    marginRight: 4,
  },
  // Non-member members section styles
  nonMemberMembersContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  nonMemberMembersTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  nonMemberMembersRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  nonMemberCountCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  nonMemberMembersCount: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  nonMemberJoinHint: {
    fontSize: 13,
    textAlign: "center",
  },
  nonMemberPendingHint: {
    fontSize: 13,
    textAlign: "center",
    fontStyle: "italic",
  },
  nonMemberHintContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: -8,
  },
});

