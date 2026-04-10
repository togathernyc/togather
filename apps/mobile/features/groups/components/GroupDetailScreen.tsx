import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { GroupDetailSkeleton } from "./GroupDetailSkeleton";
import { useAuth } from "@providers/AuthProvider";
import {
  useGroupDetails,
  useLeaveGroup,
  useJoinGroup,
  useArchiveGroup,
} from "../hooks";
import { useWithdrawJoinRequest } from "../hooks/useWithdrawJoinRequest";
import { useMyPendingJoinRequests } from "../hooks/useMyPendingJoinRequests";
import { PendingRequestLimitModal } from "./PendingRequestLimitModal";
import { isGroupMember } from "../utils";
import { useUserData } from "@features/profile/hooks/useUserData";
import { RSVPModal } from "./RSVPModal";
import { GroupHeader } from "./GroupHeader";
import { GroupOptionsModal } from "./GroupOptionsModal";
import { NextEventSection } from "./NextEventSection";
import { MembersRow } from "./MembersRow";
import { HighlightsGrid } from "./HighlightsGrid";
import { GroupMapSection } from "./GroupMapSection";
import { GroupNonMemberView } from "./GroupNonMemberView";
import { ChannelsSection } from "./ChannelsSection";
import { Group } from "../types";
import { ImageViewerManager } from "@/providers/ImageViewerProvider";
import { getExternalChatInfo, openExternalChatLink } from "@features/chat/utils/externalChat";

export function GroupDetailScreen() {
  const params = useLocalSearchParams<{ group_id: string }>();
  const group_id = params.group_id;
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [showRSVPModal, setShowRSVPModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showJoinSuccessModal, setShowJoinSuccessModal] = useState(false);
  const [showPendingLimitModal, setShowPendingLimitModal] = useState(false);

  // Pending join request cap (frontend stopgap — backend allows unlimited).
  // When the user already has 2 pending requests in the active community we
  // surface a friction modal instead of submitting another request.
  // We also track loading: until the query has resolved, isAtLimit is false
  // by default (empty list), which would let an at-cap user slip through.
  // The Join button is disabled and handleJoinGroup returns early until the
  // count is known.
  const {
    isAtLimit: isAtPendingLimit,
    isLoading: isPendingLimitLoading,
  } = useMyPendingJoinRequests();

  const { data: group, isLoading, error, refetch, isRefetching } = useGroupDetails(group_id);
  const { data: userData } = useUserData(!!user);

  // Use Convex _id for navigation, fallback to group_id for legacy
  const groupIdentifier = group?._id || group_id;

  // Mutations for group actions
  const leaveGroupMutation = useLeaveGroup();
  const joinGroupMutation = useJoinGroup(groupIdentifier);
  const withdrawMutation = useWithdrawJoinRequest(groupIdentifier);
  const archiveGroupMutation = useArchiveGroup(groupIdentifier);

  // Handle pull-to-refresh - must be before any early returns to satisfy Rules of Hooks
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Check if current user is a member of the group
  // Use the API's user_request_status field as the source of truth
  // 'accepted' means the user is a member, 'pending' means waiting for approval, null/'declined' means not a member
  const isMember = useMemo(() => {
    if (!group || !user?.id) {
      return false;
    }

    // Primary check: user_request_status from API (most reliable)
    if (group.user_request_status === "accepted") {
      return true;
    }

    // Secondary check: user_role indicates membership (includes leaders and admins)
    if (group.user_role && group.user_role !== null) {
      return true;
    }

    // Fallback check: user in group.members array
    const memberCheck = isGroupMember(group, user.id);
    if (memberCheck) {
      return true;
    }

    // Final fallback: user's group_memberships contains this group
    if (
      userData?.group_memberships &&
      Array.isArray(userData.group_memberships)
    ) {
      const hasMembership = userData.group_memberships.some(
        (membership: any) => membership.group?._id === group._id
      );
      if (hasMembership) {
        return true;
      }
    }

    return false;
  }, [group, user?.id, userData?.group_memberships]);

  // Check if user is a community admin
  const isAdmin = user?.is_admin === true;

  // Navigate to members page - use Convex _id for navigation
  const handleMembersPress = () => {
    if (!group?._id) return;
    router.push(`/leader-tools/${group._id}/members`);
  };

  const handleLeaveGroup = () => {
    Alert.alert(
      "Leave Group",
      `Are you sure you want to leave ${
        group?.title || group?.name || "this group"
      }? You will need to re-join if you want to participate again.`,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => setShowOptionsModal(false),
        },
        {
          text: "Leave Group",
          style: "destructive",
          onPress: () => {
            if (user?.id) {
              leaveGroupMutation.mutate({ groupId: groupIdentifier, userId: String(user.id) });
            }
            setShowOptionsModal(false);
          },
        },
      ]
    );
  };

  const handleJoinGroup = async () => {
    if (!user?.id) {
      Alert.alert("Error", "Please log in to join a group.");
      return;
    }

    if (!group?._id && !group?.id) {
      Alert.alert("Error", "Group information is missing. Please try again.");
      return;
    }

    // Frontend stopgap: if the user already has the maximum number of pending
    // join requests in this community, show the limit modal instead of
    // submitting another request. The cap exists to keep leaders from getting
    // overwhelmed with requests from people who join 3+ groups and ghost.
    //
    // Defensive guard: if the pending-requests query hasn't resolved yet,
    // refuse the submission. Without this an at-cap user could slip through
    // during the loading window (isAtLimit defaults to false on empty data).
    // The Join button is also disabled below while loading, but we double
    // gate here in case anything else triggers handleJoinGroup.
    if (isPendingLimitLoading) {
      return;
    }
    if (isAtPendingLimit) {
      setShowPendingLimitModal(true);
      return;
    }

    try {
      await joinGroupMutation.mutateAsync();
      setShowJoinSuccessModal(true);
    } catch (error) {
      // Error alert is already handled in the hook
      console.error("Join group error:", error);
    }
  };

  const handleWithdrawRequest = () => {
    Alert.alert(
      "Withdraw Request",
      "Are you sure you want to withdraw your join request?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () => {
            withdrawMutation.mutate();
          },
        },
      ]
    );
  };

  const handleArchiveGroup = () => {
    Alert.alert(
      "Archive Group",
      `Are you sure you want to archive "${
        group?.title || group?.name || "this group"
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

  if (isLoading) {
    return (
      <>
        <GroupDetailSkeleton />
      </>
    );
  }

  if (error || !group) {
    return (
      <>
        <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>Group not found</Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.link }]}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/groups");
              }
            }}
          >
            <Text style={[styles.buttonText, { color: colors.textInverse }]}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  // Show non-member view if user is not a member.
  // Non-member admins should also see this view so they can join the group,
  // but the GroupNonMemberView provides admin-specific features (menu, member list access).
  if (!isMember) {
    return (
      <>
        <GroupNonMemberView
          group={group}
          onJoinPress={handleJoinGroup}
          onWithdrawPress={handleWithdrawRequest}
          isJoining={joinGroupMutation.isPending || isPendingLimitLoading}
          isWithdrawing={withdrawMutation.isPending}
        />

        {/* Pending request limit modal — fires when the user is already at
            the cap and tries to request to join another group. */}
        <PendingRequestLimitModal
          visible={showPendingLimitModal}
          onDismiss={() => setShowPendingLimitModal(false)}
          onViewRequests={() => {
            setShowPendingLimitModal(false);
            router.push("/(tabs)/profile");
          }}
        />

        {/* Join Success Modal */}
        <Modal
          visible={showJoinSuccessModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setShowJoinSuccessModal(false);
            if (router.canGoBack()) {
              router.back();
            }
          }}
        >
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.modalContent, { backgroundColor: colors.modalBackground }]}>
              <View style={styles.modalHeader}>
                <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                <Text style={[styles.modalTitle, { color: colors.text }]}>Request Submitted!</Text>
              </View>
              <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
                Your request to join this group has been sent to the group leaders for approval.
              </Text>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.link }]}
                onPress={() => {
                  setShowJoinSuccessModal(false);
                  if (router.canGoBack()) {
                    router.back();
                  }
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.modalButtonText, { color: colors.textInverse }]}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  // Debug: Log group data to help diagnose missing sections
  if (__DEV__) {
    console.log("GroupDetailScreen - Group data:", {
      _id: group._id,
      hasDate: !!(group as any).date,
      hasNextMeetingDate: !!(group as any).next_meeting_date,
      hasSchedule: !!(group as any).group_schedule_details,
      membersCount: group.members?.length || 0,
      leadersCount: group.leaders?.length || 0,
      members_count: group.members_count,
      highlightsCount: group.highlights?.length || 0,
      hasHighlights: !!group.highlights,
      // Membership detection fields
      user_request_status: group.user_request_status,
      user_role: group.user_role,
      isMember: isMember,
    });
  }

  // Show member view
  return (
    <>
      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: insets.top }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.link}
          />
        }
      >
        {/* Header with image, name, and cadence */}
        <GroupHeader
          group={group}
          onMenuPress={() => setShowOptionsModal(true)}
          showMenu={true}
        />

        {/* Description */}
        <View style={[styles.descriptionContainer, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {group.description || "No description available."}
          </Text>
        </View>

        {/* Chat Section - Link to group chat */}
        {(group as any).main_channel_id && (
          <View style={[styles.chatSection, { backgroundColor: colors.surfaceSecondary }]}>
            <TouchableOpacity
              style={[styles.chatCard, { backgroundColor: colors.surface }]}
              onPress={() => {
                const mainChannelId = (group as any).main_channel_id;
                const leadersChannelId = (group as any).leaders_channel_id;
                router.push({
                  pathname: `/inbox/${mainChannelId}`,
                  params: {
                    groupId: group._id,
                    groupName: group.title || group.name || "",
                    groupType: group.group_type_name || "",
                    groupTypeSlug: (group as any).group_type_slug || "",
                    groupTypeId: String(group.group_type || 3),
                    imageUrl: group.preview || "",
                    isLeader: (group.user_role === "leader" || group.user_role === "admin") ? "1" : "0",
                    leadersChannelId: leadersChannelId || "",
                    isAnnouncementGroup: (group as any).is_announcement_group ? "1" : "0",
                    externalChatLink: (group as any).externalChatLink || "",
                  },
                });
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.chatIconContainer, { backgroundColor: colors.link + "15" }]}>
                <Ionicons name="chatbubbles" size={24} color={colors.link} />
              </View>
              <View style={styles.chatInfo}>
                <Text style={[styles.chatTitle, { color: colors.text }]}>Group Chat</Text>
                <Text style={[styles.chatSubtitle, { color: colors.textSecondary }]}>Message your group members</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.link} />
            </TouchableOpacity>
          </View>
        )}

        {/* External Chat Section */}
        {(group as any).externalChatLink && (() => {
          const externalChatInfo = getExternalChatInfo((group as any).externalChatLink);
          return (
            <View style={[styles.externalChatSection, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>EXTERNAL CHAT</Text>
              <TouchableOpacity
                style={[styles.externalChatCard, { backgroundColor: colors.surface }]}
                onPress={() => openExternalChatLink((group as any).externalChatLink)}
                activeOpacity={0.7}
              >
                <View style={[styles.externalChatIconContainer, { backgroundColor: externalChatInfo.color + "15" }]}>
                  <Ionicons
                    name={externalChatInfo.iconName as any}
                    size={24}
                    color={externalChatInfo.color}
                  />
                </View>
                <View style={styles.externalChatInfo}>
                  <Text style={[styles.externalChatTitle, { color: colors.text }]}>
                    Join on {externalChatInfo.name}
                  </Text>
                  <Text style={[styles.externalChatSubtitle, { color: colors.textSecondary }]}>
                    This group also chats on {externalChatInfo.name}
                  </Text>
                </View>
                <Ionicons name="open-outline" size={20} color={externalChatInfo.color} />
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* Channels Section - Shows all channels with management options */}
        {group._id && (
          <ChannelsSection
            groupId={group._id}
            userRole={group.user_role}
          />
        )}

        {/* Map Section */}
        <GroupMapSection group={group} />

        {/* Next Event - Always show if group has date info */}
        <NextEventSection group={group} currentRSVP={null} />

        {/* Members - Show if members or leaders exist, or if members_count > 0 */}
        {/* Clickable for admins/leaders to navigate to members page */}
        {/* Note: Non-members are handled by GroupNonMemberView (early return above) */}
        {(group.members && group.members.length > 0) ||
        (group.leaders && group.leaders.length > 0) ||
        (group.members_count && group.members_count > 0) ? (
          isAdmin ||
          group.user_role === "leader" ||
          group.user_role === "admin" ? (
            <TouchableOpacity onPress={handleMembersPress} activeOpacity={0.7}>
              <MembersRow members={group.members} leaders={group.leaders} />
              <View style={[styles.viewMembersHint, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={[styles.viewMembersText, { color: colors.link }]}>View all members</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.link} />
              </View>
            </TouchableOpacity>
          ) : (
            <MembersRow members={group.members} leaders={group.leaders} />
          )
        ) : null}

        {/* Highlights - Show if highlights exist */}
        {group.highlights && group.highlights.length > 0 && (
          <HighlightsGrid
            highlights={group.highlights as any}
            onImagePress={(clickedHighlight) => {
              const imageUrls = (group.highlights as any)
                .map((h: any) => h.image_url)
                .filter(Boolean);

              const index = (group.highlights as any).findIndex(
                (h: any) => h.id === clickedHighlight.id
              );

              ImageViewerManager.show(imageUrls, Math.max(0, index));
            }}
          />
        )}
      </ScrollView>

      {/* Options Modal */}
      <GroupOptionsModal
        visible={showOptionsModal}
        group={group}
        onClose={() => setShowOptionsModal(false)}
        onLeaveGroup={handleLeaveGroup}
        onArchiveGroup={handleArchiveGroup}
        isLeaving={leaveGroupMutation.isPending}
        isArchiving={archiveGroupMutation.isPending}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: "center",
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
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
  // External Chat Section styles
  externalChatSection: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  externalChatCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  externalChatIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  externalChatInfo: {
    flex: 1,
  },
  externalChatTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  externalChatSubtitle: {
    fontSize: 13,
  },
  // Chat Section styles
  chatSection: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  chatCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  chatIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  chatInfo: {
    flex: 1,
  },
  chatTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  chatSubtitle: {
    fontSize: 13,
  },
  // Join Success Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 12,
  },
  modalMessage: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
    minWidth: 120,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});
