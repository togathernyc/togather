/**
 * Channel Members Management Route
 *
 * Route: /inbox/[groupId]/[channelSlug]/members
 *
 * Allows channel owners and group leaders to manage channel membership.
 * Features:
 * - View all channel members with owner badge
 * - Add members from group (with search/picker)
 * - Remove members (with confirmation)
 * - Archive channel (with confirmation, for owner/leader only)
 * - Share channel with other groups (for primary group leaders)
 * - Accept/decline channel invitations (for secondary group leaders)
 * - Remove group link (for secondary group leaders or primary leaders)
 *
 * Access Control:
 * - Only channel owner OR group leader/admin can manage
 * - Read-only view for regular members
 */
import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  ActionSheetIOS,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { MemberSearch } from "@components/ui/MemberSearch";
import { AppImage } from "@components/ui";
import type { CommunityMember } from "@/types/community";
import { AutoChannelSettings } from "@features/channels";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";

import { ChannelMember, UnsyncedPerson } from "@/utils/channel-members";
import {
  SyncedMemberRowContent,
  UnsyncedPersonRowContent,
} from "@/components/ui/ChannelMemberRows";

// Helper to format relative time for pending requests
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// Unified list item type
type ListItem =
  | { type: "synced"; data: ChannelMember }
  | { type: "unsynced"; data: UnsyncedPerson }
  | { type: "pending-header" }
  | { type: "pending-request"; data: { _id: string; userId: string; displayName: string; profilePhoto?: string; requestedAt: number } };

// Shared group entry type (matches backend schema)
interface SharedGroupEntry {
  groupId: Id<"groups">;
  status: string;
  invitedById: Id<"users">;
  invitedAt: number;
  respondedById?: Id<"users">;
  respondedAt?: number;
  sortOrder?: number;
}

export default function ChannelMembersScreen() {
  const { groupId, channelSlug } = useLocalSearchParams<{
    groupId: string;
    channelSlug: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, user, community } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors, isDark } = useTheme();

  // State
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAutoChannelSettings, setShowAutoChannelSettings] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<Id<"users"> | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [isBulkApproving, setIsBulkApproving] = useState(false);

  // Query channel info by slug
  const channelData = useQuery(
    api.functions.messaging.channels.getChannelBySlug,
    token && groupId && channelSlug
      ? {
          token,
          groupId: groupId as Id<"groups">,
          slug: channelSlug,
        }
      : "skip"
  );

  // Query channel members
  const membersData = useQuery(
    api.functions.messaging.channels.getChannelMembers,
    token && channelData?._id
      ? {
          token,
          channelId: channelData._id,
        }
      : "skip"
  );

  // Query group data to get communityId for auto channel settings
  const groupData = useQuery(
    api.functions.groups.index.getById,
    token && groupId
      ? { groupId: groupId as Id<"groups">, token }
      : "skip"
  );

  // Query auto channel config for PCO channels (to show unmatched people)
  const autoChannelConfig = useQuery(
    api.functions.pcoServices.queries.getAutoChannelConfigByChannel,
    token && channelData?._id && channelData?.channelType === "pco_services"
      ? { token, channelId: channelData._id }
      : "skip"
  );

  // Query invite link info for custom channels
  const inviteInfo = useQuery(
    api.functions.messaging.channelInvites.getInviteInfo,
    token && channelData?._id && channelData?.channelType === "custom"
      ? { token, channelId: channelData._id }
      : "skip"
  );

  // Query pending join requests (leaders only, custom channels with approval mode)
  const pendingRequests = useQuery(
    api.functions.messaging.channelInvites.getPendingRequests,
    token && channelData?._id && channelData?.channelType === "custom"
      ? { token, channelId: channelData._id }
      : "skip"
  );

  // Mutations
  const addMembersMutation = useMutation(api.functions.messaging.channels.addChannelMembers);
  const removeMemberMutation = useMutation(api.functions.messaging.channels.removeChannelMember);
  const archiveCustomChannelMutation = useMutation(api.functions.messaging.channels.archiveCustomChannel);
  const archivePcoChannelMutation = useMutation(api.functions.messaging.channels.archivePcoChannel);
  const removeGroupMutation = useMutation(api.functions.messaging.sharedChannels.removeGroupFromChannel);
  const enableInviteLinkMutation = useMutation(api.functions.messaging.channelInvites.enableInviteLink);
  const updateJoinModeMutation = useMutation(api.functions.messaging.channelInvites.updateJoinMode);
  const approveMutation = useMutation(api.functions.messaging.channelInvites.approveJoinRequest);
  const declineMutation = useMutation(api.functions.messaging.channelInvites.declineJoinRequest);
  const bulkApproveMutation = useMutation(api.functions.messaging.channelInvites.bulkApproveRequests);

  // Shared channel state
  const isSharedChannel = !!channelData?.isShared;
  const sharedGroups: SharedGroupEntry[] = (channelData?.sharedGroups as SharedGroupEntry[] | undefined) ?? [];
  const acceptedSharedGroupIds = useMemo(
    () => sharedGroups.filter((sg) => sg.status === "accepted").map((sg) => sg.groupId),
    [sharedGroups]
  );
  const sharedEligibleGroupIds = useMemo(() => {
    if (!channelData || !isSharedChannel) return [];
    return [channelData.groupId as Id<"groups">, ...acceptedSharedGroupIds];
  }, [channelData, isSharedChannel, acceptedSharedGroupIds]);

  // Is the current URL group the primary (owner) group?
  const isPrimaryGroup = channelData ? channelData.groupId === groupId : false;
  // Is this a secondary group viewing the channel?
  const isSecondaryGroup = isSharedChannel && !isPrimaryGroup;

  // Check if user can manage this channel
  const canManage = useMemo(() => {
    if (!channelData || !user) return false;
    const isOwner = channelData.role === "owner";
    const isGroupLeader = channelData.userGroupRole === "leader" || channelData.userGroupRole === "admin";
    return isOwner || isGroupLeader;
  }, [channelData, user]);

  // Can the user share this channel (primary leader only, custom/pco channels)
  const canShare = canManage && isPrimaryGroup && (channelData?.channelType === "custom" || channelData?.channelType === "pco_services");

  // Check if this is a custom channel
  const isCustomChannel = useMemo(() => {
    if (!channelData) return false;
    return channelData.channelType === "custom";
  }, [channelData]);

  // Check if this is a PCO auto channel
  const isPcoAutoChannel = useMemo(() => {
    if (!channelData) return false;
    return channelData.channelType === "pco_services";
  }, [channelData]);

  // Get current channel member user IDs for exclusion in picker
  const existingMemberIds = useMemo(() => {
    if (!membersData?.members) return [];
    return membersData.members.map((m) => m.userId);
  }, [membersData]);

  // Get unsynced people from auto channel config
  const unsyncedPeople = useMemo(() => {
    if (!autoChannelConfig?.lastSyncResults?.unmatchedPeople) return [];
    return autoChannelConfig.lastSyncResults.unmatchedPeople;
  }, [autoChannelConfig]);

  // Create unified list with pending requests first, then synced members, then unsynced at bottom
  const unifiedList = useMemo((): ListItem[] => {
    const items: ListItem[] = [];

    // Add pending requests section (leaders only, when there are pending requests)
    if (canManage && pendingRequests && pendingRequests.length > 0) {
      items.push({ type: "pending-header" as const });
      for (const req of pendingRequests) {
        items.push({
          type: "pending-request" as const,
          data: {
            _id: req._id,
            userId: req.userId,
            displayName: req.displayName,
            profilePhoto: req.profilePhoto,
            requestedAt: req.requestedAt,
          },
        });
      }
    }

    // Add synced members
    const syncedItems: ListItem[] = (membersData?.members || []).map((m) => ({
      type: "synced" as const,
      data: m,
    }));

    // Add unsynced people
    const unsyncedItems: ListItem[] = unsyncedPeople.map((p) => ({
      type: "unsynced" as const,
      data: p,
    }));

    return [...items, ...syncedItems, ...unsyncedItems];
  }, [canManage, pendingRequests, membersData?.members, unsyncedPeople]);

  // Total member count including unsynced
  const totalMemberCount = useMemo(() => {
    const syncedCount = membersData?.totalCount ?? 0;
    const unsyncedCount = unsyncedPeople.length;
    return syncedCount + unsyncedCount;
  }, [membersData?.totalCount, unsyncedPeople.length]);

  const showLeaveSharedChannelAction = isSecondaryGroup && canManage;
  const showArchiveChannelAction =
    canManage && isPrimaryGroup && (isCustomChannel || isPcoAutoChannel);
  const hasBottomActions = showLeaveSharedChannelAction || showArchiveChannelAction || canShare;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/${channelSlug}`);
    }
  };

  const handleAddMembers = useCallback(
    async (selectedMembers: CommunityMember[]) => {
      if (!token || !channelData?._id || selectedMembers.length === 0) return;

      setIsAddingMembers(true);
      try {
        const userIds = selectedMembers.map((m) => m.user_id as Id<"users">);
        await addMembersMutation({
          token,
          channelId: channelData._id,
          userIds,
        });
        setShowAddMemberModal(false);
        Alert.alert(
          "Members Added",
          `Successfully added ${selectedMembers.length} member${selectedMembers.length > 1 ? "s" : ""} to the channel.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to add members. Please try again.";
        Alert.alert("Error", message);
      } finally {
        setIsAddingMembers(false);
      }
    },
    [token, channelData, addMembersMutation]
  );

  const handleRemoveMember = useCallback(
    async (member: ChannelMember) => {
      if (!token || !channelData?._id) return;

      if (member.role === "owner" && membersData && membersData.members.length <= 1) {
        Alert.alert(
          "Cannot Remove Owner",
          "You are the only member. To leave, archive the channel instead."
        );
        return;
      }

      Alert.alert(
        "Remove Member",
        `Are you sure you want to remove ${member.displayName} from this channel?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              setRemovingMemberId(member.userId);
              try {
                await removeMemberMutation({
                  token,
                  channelId: channelData._id,
                  userId: member.userId,
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : "Failed to remove member. Please try again.";
                Alert.alert("Error", message);
              } finally {
                setRemovingMemberId(null);
              }
            },
          },
        ]
      );
    },
    [token, channelData, membersData, removeMemberMutation]
  );

  const handleArchiveChannel = useCallback(async () => {
    if (!token || !channelData?._id) return;

    const isPco = channelData.channelType === "pco_services";
    const confirmMessage = isPco
      ? `Are you sure you want to archive "${channelData.name}"? This will disable PCO syncing, remove all members, and hide the channel. This action cannot be undone.`
      : `Are you sure you want to archive "${channelData.name}"? This will remove all members and hide the channel. This action cannot be undone.`;

    Alert.alert(
      "Archive Channel",
      confirmMessage,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            setIsArchiving(true);
            try {
              if (isPco) {
                await archivePcoChannelMutation({
                  token,
                  channelId: channelData._id,
                });
              } else {
                await archiveCustomChannelMutation({
                  token,
                  channelId: channelData._id,
                });
              }
              Alert.alert("Channel Archived", "The channel has been archived.", [
                {
                  text: "OK",
                  onPress: () => {
                    router.replace(`/inbox/${groupId}/general`);
                  },
                },
              ]);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Failed to archive channel. Please try again.";
              Alert.alert("Error", message);
              setIsArchiving(false);
            }
          },
        },
      ]
    );
  }, [token, channelData, archiveCustomChannelMutation, archivePcoChannelMutation, router, groupId]);

  const handleShareInviteLink = useCallback(async () => {
    if (!token || !channelData?._id) return;

    try {
      const result = await enableInviteLinkMutation({
        token,
        channelId: channelData._id,
      });

      const url = DOMAIN_CONFIG.channelInviteUrl(result.shortId);

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Copy Link", "Share Link"],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await Clipboard.setStringAsync(url);
              Alert.alert("Copied!", "Invite link copied to clipboard.");
            } else if (buttonIndex === 2) {
              Share.share({ url, message: `Join #${channelData.name}: ${url}` });
            }
          }
        );
      } else {
        // Android: use Share directly
        Share.share({ message: `Join #${channelData.name}: ${url}` });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate invite link.";
      Alert.alert("Error", message);
    }
  }, [token, channelData, enableInviteLinkMutation]);

  const handleUpdateJoinMode = useCallback(async (newMode: "open" | "approval_required") => {
    if (!token || !channelData?._id) return;
    try {
      await updateJoinModeMutation({
        token,
        channelId: channelData._id,
        joinMode: newMode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update join mode.";
      Alert.alert("Error", message);
    }
  }, [token, channelData, updateJoinModeMutation]);

  const handleApproveRequest = useCallback(async (requestId: string) => {
    if (!token) return;
    setProcessingRequestId(requestId);
    try {
      await approveMutation({ token, requestId: requestId as Id<"channelJoinRequests"> });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to approve request.";
      Alert.alert("Error", message);
    } finally {
      setProcessingRequestId(null);
    }
  }, [token, approveMutation]);

  const handleDeclineRequest = useCallback(async (requestId: string) => {
    if (!token) return;
    Alert.alert(
      "Decline Request",
      "Are you sure you want to decline this request?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            setProcessingRequestId(requestId);
            try {
              await declineMutation({ token, requestId: requestId as Id<"channelJoinRequests"> });
            } catch (error) {
              const message = error instanceof Error ? error.message : "Failed to decline request.";
              Alert.alert("Error", message);
            } finally {
              setProcessingRequestId(null);
            }
          },
        },
      ]
    );
  }, [token, declineMutation]);

  const handleBulkApprove = useCallback(async () => {
    if (!token || !channelData?._id) return;
    Alert.alert(
      "Approve All",
      `Approve all ${pendingRequests?.length || 0} pending requests?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve All",
          onPress: async () => {
            setIsBulkApproving(true);
            try {
              const result = await bulkApproveMutation({ token, channelId: channelData._id });
              Alert.alert("Done", `Approved ${result.approvedCount} request${result.approvedCount !== 1 ? "s" : ""}.`);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Failed to approve requests.";
              Alert.alert("Error", message);
            } finally {
              setIsBulkApproving(false);
            }
          },
        },
      ]
    );
  }, [token, channelData, pendingRequests, bulkApproveMutation]);

  // Handle removing a group from the shared channel
  const handleRemoveGroup = useCallback(
    async (targetGroupId: Id<"groups">, targetGroupName?: string) => {
      if (!token || !channelData?._id) return;

      const isSelf = targetGroupId === groupId;
      const title = isSelf ? "Leave Shared Channel" : "Remove Group";
      const message = isSelf
        ? "Are you sure you want to remove your group from this shared channel? Members only in your group will lose access."
        : `Are you sure you want to remove ${targetGroupName || "this group"} from the channel? Members only in that group will lose access.`;

      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        {
          text: isSelf ? "Leave" : "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeGroupMutation({
                token,
                channelId: channelData._id,
                groupId: targetGroupId,
              });
              if (isSelf) {
                router.replace(`/inbox/${groupId}/general`);
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : "Failed to remove group.";
              Alert.alert("Error", message);
            }
          },
        },
      ]);
    },
    [token, channelData, groupId, removeGroupMutation, router]
  );

  // Render unified list item (synced, unsynced, or pending request)
  const renderListItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "pending-header") {
        return (
          <View style={[styles.pendingHeader, { backgroundColor: isDark ? 'rgba(255,152,0,0.1)' : '#FFF8E1' }]}>
            <View style={styles.pendingHeaderContent}>
              <Ionicons name="time-outline" size={18} color="#F57C00" />
              <Text style={[styles.pendingHeaderText, { color: isDark ? '#FFB74D' : '#E65100' }]}>
                Pending Requests ({pendingRequests?.length || 0})
              </Text>
            </View>
            {(pendingRequests?.length || 0) > 1 && (
              <TouchableOpacity
                onPress={handleBulkApprove}
                disabled={isBulkApproving}
                style={[styles.bulkApproveButton, { backgroundColor: primaryColor }]}
              >
                {isBulkApproving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.bulkApproveText}>Approve All</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        );
      }

      if (item.type === "pending-request") {
        const req = item.data;
        const isProcessing = processingRequestId === req._id;
        return (
          <View style={[styles.memberItem, styles.pendingRequestItem, { backgroundColor: isDark ? 'rgba(255,152,0,0.05)' : '#FFFDE7' }]}>
            <View style={styles.pendingRequestRow}>
              {req.profilePhoto ? (
                <View style={styles.memberAvatar}>
                  <AppImage
                    source={req.profilePhoto}
                    style={styles.memberAvatarImage}
                  />
                </View>
              ) : (
                <View style={[styles.memberAvatar, styles.memberAvatarFallback, { backgroundColor: primaryColor + "20" }]}>
                  <Text style={[styles.memberAvatarText, { color: primaryColor }]}>
                    {req.displayName?.charAt(0)?.toUpperCase() || "?"}
                  </Text>
                </View>
              )}
              <View style={styles.memberInfo}>
                <Text style={[styles.memberName, { color: colors.text }]}>{req.displayName}</Text>
                <Text style={[styles.memberRole, { color: colors.textTertiary }]}>
                  Requested {formatRelativeTime(req.requestedAt)}
                </Text>
              </View>
              <View style={styles.pendingActions}>
                <TouchableOpacity
                  style={[styles.pendingActionButton, { backgroundColor: primaryColor }]}
                  onPress={() => handleApproveRequest(req._id)}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pendingActionButton, styles.pendingDeclineButton, { borderColor: colors.destructive }]}
                  onPress={() => handleDeclineRequest(req._id)}
                  disabled={isProcessing}
                >
                  <Ionicons name="close" size={18} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      }

      if (item.type === "synced") {
        const member = item.data;
        const isOwner = member.role === "owner";
        const isCurrentUser = member.userId === user?.id;
        const isRemoving = removingMemberId === member.userId;
        const showRemoveButton =
          canManage && isCustomChannel && (!isSharedChannel || isPrimaryGroup) && !(isOwner && isCurrentUser);

        return (
          <View style={[styles.memberItem, { backgroundColor: colors.surface }]}>
            <SyncedMemberRowContent
              member={member}
              primaryColor={primaryColor}
              isCurrentUser={isCurrentUser}
              rightContent={
                showRemoveButton ? (
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => handleRemoveMember(member)}
                    disabled={isRemoving}
                  >
                    {isRemoving ? (
                      <ActivityIndicator size="small" color={colors.destructive} />
                    ) : (
                      <Ionicons name="remove-circle-outline" size={24} color={colors.destructive} />
                    )}
                  </TouchableOpacity>
                ) : undefined
              }
            />
          </View>
        );
      } else {
        const person = item.data;

        return (
          <View
            style={[
              styles.memberItem,
              { backgroundColor: colors.surface },
              styles.unsyncedMemberItem,
              { backgroundColor: isDark ? 'rgba(255,215,0,0.1)' : '#FFF8E6' },
            ]}
            testID={`unsynced-member-${person.pcoPersonId}`}
          >
            <UnsyncedPersonRowContent person={person} />
          </View>
        );
      }
    },
    [canManage, isCustomChannel, isSharedChannel, isPrimaryGroup, user, removingMemberId, primaryColor, handleRemoveMember, colors, isDark, pendingRequests, handleBulkApprove, isBulkApproving, processingRequestId, handleApproveRequest, handleDeclineRequest]
  );

  // Loading state
  if (!channelData || !membersData) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Channel Members</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading members...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {channelData.name}
        </Text>
        {canManage && isCustomChannel && (!isSharedChannel || isPrimaryGroup) ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity
              style={styles.addButton}
              onPress={handleShareInviteLink}
            >
              <Ionicons name="share-outline" size={22} color={primaryColor} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowAddMemberModal(true)}
            >
              <Ionicons name="person-add-outline" size={22} color={primaryColor} />
            </TouchableOpacity>
          </View>
        ) : canManage && isPcoAutoChannel && (!isSharedChannel || isPrimaryGroup) ? (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAutoChannelSettings(true)}
          >
            <Ionicons name="settings-outline" size={22} color={primaryColor} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerRight} />
        )}
      </View>

      {/* Shared channel info banner */}
      {isSharedChannel && (
        <View style={[styles.sharedBanner, {
          backgroundColor: isDark ? 'rgba(124,58,237,0.1)' : '#F5F0FF',
          borderBottomColor: isDark ? 'rgba(124,58,237,0.2)' : '#E0D6F5',
        }]}>
          <Ionicons name="link" size={16} color="#8B5CF6" />
          <View style={styles.sharedBannerContent}>
            <Text style={[styles.sharedBannerTitle, { color: isDark ? '#c4b5fd' : '#5B21B6' }]}>
              Shared Channel{isPrimaryGroup ? " (Owner)" : ""}
            </Text>
            <Text style={styles.sharedBannerText}>
              {sharedGroups.filter((sg) => sg.status === "accepted").length} group
              {sharedGroups.filter((sg) => sg.status === "accepted").length !== 1 ? "s" : ""} connected
              {sharedGroups.some((sg) => sg.status === "pending") &&
                ` + ${sharedGroups.filter((sg) => sg.status === "pending").length} pending`}
            </Text>
          </View>
          {canShare && (
            <TouchableOpacity onPress={() => setShowShareModal(true)}>
              <Ionicons name="add-circle-outline" size={24} color="#8B5CF6" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Join mode info (custom channels, leaders only) */}
      {canManage && isCustomChannel && inviteInfo && (
        <View style={[styles.sharedBanner, {
          backgroundColor: isDark ? 'rgba(0,188,212,0.1)' : '#E0F7FA',
          borderBottomColor: isDark ? 'rgba(0,188,212,0.2)' : '#B2EBF2',
        }]}>
          <Ionicons name="link" size={16} color="#00BCD4" />
          <View style={styles.sharedBannerContent}>
            <Text style={[styles.sharedBannerTitle, { color: isDark ? '#80DEEA' : '#006064' }]}>
              Invite Link {inviteInfo.inviteEnabled ? "Active" : "Disabled"}
            </Text>
            <Text style={[styles.sharedBannerText, { color: colors.textSecondary }]}>
              Join mode: {(inviteInfo.joinMode || "open") === "open" ? "Open" : "Approval Required"}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              const currentMode = inviteInfo.joinMode || "open";
              const newMode = currentMode === "open" ? "approval_required" : "open";
              handleUpdateJoinMode(newMode);
            }}
          >
            <Ionicons name="swap-horizontal" size={20} color="#00BCD4" />
          </TouchableOpacity>
        </View>
      )}

      {/* Member count */}
      <View style={[styles.memberCount, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.memberCountText, { color: colors.textSecondary }]}>
          {totalMemberCount} member{totalMemberCount !== 1 ? "s" : ""}
          {unsyncedPeople.length > 0 && (
            <Text style={styles.unsyncedCountText}> ({unsyncedPeople.length} unsynced)</Text>
          )}
        </Text>
      </View>

      {/* Auto channel info banner */}
      {isPcoAutoChannel && (!isSharedChannel || isPrimaryGroup) && (
        <TouchableOpacity
          style={[styles.autoChannelBanner, {
            backgroundColor: isDark ? 'rgba(33,150,243,0.1)' : '#F0F7FF',
            borderBottomColor: colors.border,
          }]}
          onPress={() => setShowAutoChannelSettings(true)}
        >
          <Ionicons name="sync" size={16} color={primaryColor} />
          <View style={styles.autoChannelBannerContent}>
            <Text style={[styles.autoChannelBannerTitle, { color: colors.text }]}>PCO Auto Channel</Text>
            <Text style={[styles.autoChannelBannerText, { color: colors.textSecondary }]}>
              Members are automatically synced from Planning Center Services
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
        </TouchableOpacity>
      )}

      {/* Members list (unified: synced members first, unsynced at bottom) */}
      {unifiedList.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={64} color={colors.textTertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Members</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            This channel has no members yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={unifiedList}
          renderItem={renderListItem}
          keyExtractor={(item) => {
            if (item.type === "pending-header") return "pending-header";
            if (item.type === "pending-request") return `pending-${item.data._id}`;
            if (item.type === "synced") return item.data.userId;
            return `unsynced-${item.data.pcoPersonId}`;
          }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Bottom actions */}
      {hasBottomActions && (
        <View
          testID="bottom-actions"
          style={[styles.bottomActions, {
            paddingBottom: insets.bottom + 16,
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          }]}
        >
          {/* Remove Group / Leave button for secondary group leaders */}
          {showLeaveSharedChannelAction && (
            <TouchableOpacity
              style={[styles.removeGroupButton, { borderColor: colors.warning }]}
              onPress={() => handleRemoveGroup(groupId as Id<"groups">)}
            >
              <Ionicons name="exit-outline" size={20} color={colors.warning} />
              <Text style={[styles.removeGroupButtonText, { color: colors.warning }]}>Leave Shared Channel</Text>
            </TouchableOpacity>
          )}

          {/* Share with Groups button (for primary group leaders) */}
          {canShare && (
            <TouchableOpacity
              style={[styles.shareButton, { borderColor: '#8B5CF6' }]}
              onPress={() => setShowShareModal(true)}
            >
              <Ionicons name="people-outline" size={20} color="#8B5CF6" />
              <Text style={[styles.shareButtonText, { color: '#8B5CF6' }]}>Share with Groups</Text>
            </TouchableOpacity>
          )}

          {/* Archive button (for primary group, custom/PCO channels) */}
          {showArchiveChannelAction && (
            <TouchableOpacity
              style={[styles.archiveButton, { borderColor: colors.destructive }]}
              onPress={handleArchiveChannel}
              disabled={isArchiving}
            >
              {isArchiving ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <>
                  <Ionicons name="archive-outline" size={20} color={colors.destructive} />
                  <Text style={[styles.archiveButtonText, { color: colors.destructive }]}>Archive Channel</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Add Member Modal */}
      <Modal
        visible={showAddMemberModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAddMemberModal(false)}
      >
        <AddMemberModalContent
          groupId={groupId as Id<"groups">}
          existingMemberIds={existingMemberIds}
          isSharedChannel={isSharedChannel}
          eligibleGroupIds={sharedEligibleGroupIds}
          onAddMembers={handleAddMembers}
          onClose={() => setShowAddMemberModal(false)}
          isLoading={isAddingMembers}
          primaryColor={primaryColor}
        />
      </Modal>

      {/* Share with Group Modal */}
      <Modal
        visible={showShareModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowShareModal(false)}
      >
        {channelData && (
          <ShareWithGroupModal
            channelId={channelData._id}
            channelName={channelData.name}
            primaryGroupId={channelData.groupId}
            sharedGroups={sharedGroups}
            communityId={groupData?.communityId || (community?.id as Id<"communities"> | undefined)}
            onClose={() => setShowShareModal(false)}
            primaryColor={primaryColor}
            isPrimaryLeader={canManage && isPrimaryGroup}
            onRemoveGroup={handleRemoveGroup}
          />
        )}
      </Modal>

      {/* Auto Channel Settings Modal */}
      <Modal
        visible={showAutoChannelSettings}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAutoChannelSettings(false)}
      >
        {channelData && groupData?.communityId && (
          <AutoChannelSettings
            channelId={channelData._id}
            groupId={groupId as Id<"groups">}
            communityId={groupData.communityId}
            canEdit={canManage}
            onClose={() => setShowAutoChannelSettings(false)}
          />
        )}
      </Modal>
    </View>
  );
}

// Separate component for the modal content
function AddMemberModalContent({
  groupId,
  existingMemberIds,
  isSharedChannel,
  eligibleGroupIds,
  onAddMembers,
  onClose,
  isLoading,
  primaryColor,
}: {
  groupId: Id<"groups">;
  existingMemberIds: Id<"users">[];
  isSharedChannel: boolean;
  eligibleGroupIds: Id<"groups">[];
  onAddMembers: (members: CommunityMember[]) => void;
  onClose: () => void;
  isLoading: boolean;
  primaryColor: string;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [selectedMembers, setSelectedMembers] = useState<CommunityMember[]>([]);

  const handleConfirmAdd = () => {
    if (selectedMembers.length > 0) {
      onAddMembers(selectedMembers);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.modalContainer, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Modal Header */}
      <View style={[styles.modalHeader, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
          <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[styles.modalTitle, { color: colors.text }]}>Add Members</Text>
        <TouchableOpacity
          onPress={handleConfirmAdd}
          style={styles.modalAddButton}
          disabled={selectedMembers.length === 0 || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={primaryColor} />
          ) : (
            <Text
              style={[
                styles.modalAddText,
                { color: selectedMembers.length > 0 ? primaryColor : colors.textTertiary },
              ]}
            >
              Add ({selectedMembers.length})
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Info note about non-group members */}
      <View style={[styles.infoNote, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border }]}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
        <Text style={[styles.infoNoteText, { color: colors.textSecondary }]}>
          {isSharedChannel
            ? "Only primary + connected group members appear here. Adding someone from a connected group adds them to this channel only, not to the primary group."
            : "People not in this group will be automatically added when you add them to this channel."}
        </Text>
      </View>

      {/* Selected Members Preview */}
      {selectedMembers.length > 0 && (
        <View style={[styles.selectedPreview, { backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border }]}>
          <Text style={[styles.selectedPreviewText, { color: colors.textSecondary }]}>
            Selected: {selectedMembers.map((m) => `${m.first_name} ${m.last_name}`.trim()).join(", ")}
          </Text>
        </View>
      )}

      {/* Member Search */}
      <View style={styles.searchContainer}>
        <MemberSearch
          mode="multi"
          groupId={groupId}
          includeGroupIds={isSharedChannel ? eligibleGroupIds : undefined}
          excludeUserIds={existingMemberIds}
          selectedMembers={selectedMembers}
          onMultiSelect={setSelectedMembers}
          placeholder={isSharedChannel ? "Search primary + connected group members..." : "Search group members to add..."}
          showEmptyState
          showActionButton
          actionIcon="add-circle-outline"
          clearOnSelect={false}
          includeSelf
        />
      </View>
    </KeyboardAvoidingView>
  );
}

// Share with Group modal - shows community groups for invitation
function ShareWithGroupModal({
  channelId,
  channelName,
  primaryGroupId,
  sharedGroups,
  communityId,
  onClose,
  primaryColor,
  isPrimaryLeader,
  onRemoveGroup,
}: {
  channelId: Id<"chatChannels">;
  channelName: string;
  primaryGroupId: Id<"groups">;
  sharedGroups: SharedGroupEntry[];
  communityId?: Id<"communities">;
  onClose: () => void;
  primaryColor: string;
  isPrimaryLeader: boolean;
  onRemoveGroup: (groupId: Id<"groups">, groupName?: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { colors, isDark } = useTheme();
  const [isInviting, setIsInviting] = useState<Id<"groups"> | null>(null);
  const [searchText, setSearchText] = useState("");
  const [isCancelling, setIsCancelling] = useState<Id<"groups"> | null>(null);

  const inviteGroupMutation = useMutation(api.functions.messaging.sharedChannels.inviteGroupToChannel);
  const cancelInviteMutation = useMutation(api.functions.messaging.sharedChannels.cancelChannelInvite);

  // Query all groups in the community (pass high limit to avoid truncation)
  const allGroups = useQuery(
    api.functions.groups.queries.listByCommunity,
    communityId
      ? { communityId, includePrivate: true, limit: 500 }
      : "skip"
  );

  // Build shared group status map
  const sharedGroupStatus = useMemo(() => {
    const map = new Map<string, string>();
    for (const sg of sharedGroups) {
      map.set(sg.groupId, sg.status);
    }
    return map;
  }, [sharedGroups]);

  // Filter groups: exclude primary group, sort by status then name
  const availableGroups = useMemo(() => {
    if (!allGroups) return [];
    return allGroups
      .filter((g) => g._id !== primaryGroupId)
      .sort((a, b) => {
        const statusA = sharedGroupStatus.get(a._id) || "";
        const statusB = sharedGroupStatus.get(b._id) || "";
        // Already-shared groups first, then alphabetical
        if (statusA && !statusB) return -1;
        if (!statusA && statusB) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [allGroups, primaryGroupId, sharedGroupStatus]);

  const filteredGroups = useMemo(() => {
    if (!searchText.trim()) return availableGroups;
    const lower = searchText.toLowerCase();
    return availableGroups.filter((g) => g.name.toLowerCase().includes(lower));
  }, [availableGroups, searchText]);

  const handleInviteGroup = useCallback(
    async (targetGroupId: Id<"groups">) => {
      if (!token) return;

      setIsInviting(targetGroupId);
      try {
        await inviteGroupMutation({
          token,
          channelId,
          groupId: targetGroupId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to invite group.";
        Alert.alert("Error", message);
      } finally {
        setIsInviting(null);
      }
    },
    [token, channelId, inviteGroupMutation]
  );

  const handleCancelInvite = useCallback(
    async (targetGroupId: Id<"groups">) => {
      if (!token) return;
      setIsCancelling(targetGroupId);
      try {
        await cancelInviteMutation({
          token,
          channelId,
          groupId: targetGroupId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to cancel invite.";
        Alert.alert("Error", message);
      } finally {
        setIsCancelling(null);
      }
    },
    [token, channelId, cancelInviteMutation]
  );

  return (
    <View style={[styles.modalContainer, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.shareModalHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
          <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Done</Text>
        </TouchableOpacity>
        <Text style={[styles.modalTitle, { color: colors.text }]}>Share Channel</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={[styles.shareModalSubheader, {
        backgroundColor: isDark ? 'rgba(124,58,237,0.1)' : '#F5F0FF',
        borderBottomColor: isDark ? 'rgba(124,58,237,0.2)' : '#E0D6F5',
      }]}>
        <Ionicons name="link" size={14} color="#8B5CF6" />
        <Text style={styles.shareModalSubheaderText}>
          Invite groups to join "{channelName}"
        </Text>
      </View>

      {/* Search bar */}
      <View style={[styles.shareSearchContainer, {
        backgroundColor: colors.surfaceSecondary,
        borderBottomColor: colors.border,
      }]}>
        <Ionicons name="search" size={18} color={colors.textTertiary} />
        <TextInput
          style={[styles.shareSearchInput, { color: colors.text }]}
          placeholder="Search groups..."
          placeholderTextColor={colors.inputPlaceholder}
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText("")}>
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Group list */}
      {!allGroups ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
        </View>
      ) : (
        <ScrollView style={styles.shareGroupList} contentContainerStyle={{ paddingBottom: 40 }}>
          {filteredGroups.map((group) => {
            const status = sharedGroupStatus.get(group._id);
            const isInvitingThis = isInviting === group._id;

            return (
              <View key={group._id} style={[styles.shareGroupItem, { borderBottomColor: colors.borderLight }]}>
                <View style={styles.shareGroupInfo}>
                  <Text style={[styles.shareGroupName, { color: colors.text }]} numberOfLines={1}>
                    {group.name}
                  </Text>
                  {status && (
                    <View
                      style={[
                        styles.shareGroupStatusBadge,
                        status === "accepted"
                          ? styles.shareGroupStatusAccepted
                          : styles.shareGroupStatusPending,
                      ]}
                    >
                      <Text
                        style={[
                          styles.shareGroupStatusText,
                          status === "accepted"
                            ? styles.shareGroupStatusAcceptedText
                            : styles.shareGroupStatusPendingText,
                        ]}
                      >
                        {status === "accepted" ? "Connected" : "Pending"}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Action button */}
                {!status ? (
                  <TouchableOpacity
                    style={[styles.shareInviteButton, { borderColor: primaryColor }]}
                    onPress={() => handleInviteGroup(group._id)}
                    disabled={!!isInviting}
                  >
                    {isInvitingThis ? (
                      <ActivityIndicator size="small" color={primaryColor} />
                    ) : (
                      <Text style={[styles.shareInviteButtonText, { color: primaryColor }]}>
                        Invite
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : isPrimaryLeader && status === "pending" ? (
                  <TouchableOpacity
                    style={[styles.shareCancelButton, { borderColor: colors.warning }]}
                    onPress={() => handleCancelInvite(group._id)}
                    disabled={!!isCancelling}
                  >
                    {isCancelling === group._id ? (
                      <ActivityIndicator size="small" color={colors.warning} />
                    ) : (
                      <Text style={[styles.shareCancelButtonText, { color: colors.warning }]}>Cancel</Text>
                    )}
                  </TouchableOpacity>
                ) : isPrimaryLeader && status === "accepted" ? (
                  <TouchableOpacity
                    style={styles.shareRemoveButton}
                    onPress={() => onRemoveGroup(group._id, group.name)}
                  >
                    <Ionicons name="close-circle-outline" size={22} color={colors.destructive} />
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}

          {filteredGroups.length === 0 && (
            <View style={styles.shareEmptyState}>
              <Text style={[styles.shareEmptyStateText, { color: colors.textTertiary }]}>
                {searchText.trim()
                  ? "No groups match your search."
                  : "No other groups found in this community."}
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginHorizontal: 8,
  },
  headerRight: {
    width: 40,
  },
  addButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },

  // Shared channel banner
  sharedBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  sharedBannerContent: {
    flex: 1,
  },
  sharedBannerTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  sharedBannerText: {
    fontSize: 12,
    color: "#7C3AED",
  },

  memberCount: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  memberCountText: {
    fontSize: 14,
  },
  autoChannelBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    gap: 12,
  },
  autoChannelBannerContent: {
    flex: 1,
  },
  autoChannelBannerTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 2,
  },
  autoChannelBannerText: {
    fontSize: 12,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
    marginRight: 12,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitials: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#fff",
  },
  memberInfo: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  memberName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    flexShrink: 1,
  },
  youBadge: {
    fontSize: 13,
    color: "#888",
  },
  ownerBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
  },
  ownerBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  syncMetadataRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  syncBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#2196F320",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  syncBadgeText: {
    fontSize: 11,
    color: "#2196F3",
    fontWeight: "500",
  },
  memberAvatarImage: {
    width: "100%",
    height: "100%",
  },
  memberAvatarFallback: {
    justifyContent: "center",
    alignItems: "center",
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  memberRole: {
    fontSize: 13,
    marginTop: 2,
  },
  // Pending requests styles
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,152,0,0.2)",
  },
  pendingHeaderContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pendingHeaderText: {
    fontSize: 14,
    fontWeight: "600",
  },
  bulkApproveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  bulkApproveText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  pendingRequestItem: {
    borderLeftWidth: 3,
    borderLeftColor: "#FF9800",
  },
  pendingRequestRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pendingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pendingActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  pendingDeclineButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  // Unsynced member styles
  unsyncedMemberItem: {
    borderWidth: 1,
    borderColor: "#FFE0A3",
  },
  unsyncedAvatarPlaceholder: {
    backgroundColor: "#FFD666",
  },
  unsyncedAvatarInitials: {
    color: "#7A5200",
  },
  unsyncedReasonText: {
    fontSize: 12,
    color: "#B25000",
    marginTop: 4,
    fontStyle: "italic",
  },
  unsyncedCountText: {
    color: "#B25000",
  },
  removeButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },

  // Bottom actions
  bottomActions: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: 1,
    gap: 8,
  },
  removeGroupButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  removeGroupButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  archiveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  archiveButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },

  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalCloseButton: {
    width: 60,
  },
  modalCancelText: {
    fontSize: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  modalAddButton: {
    width: 80,
    alignItems: "flex-end",
  },
  modalAddText: {
    fontSize: 16,
    fontWeight: "600",
  },
  selectedPreview: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  selectedPreviewText: {
    fontSize: 14,
  },
  searchContainer: {
    flex: 1,
    padding: 8,
  },
  infoNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  infoNoteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },

  // Share modal styles
  shareModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  shareModalSubheader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  shareModalSubheaderText: {
    fontSize: 13,
    color: "#7C3AED",
    fontWeight: "500",
  },
  shareGroupList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  shareGroupItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  shareGroupInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  shareGroupName: {
    fontSize: 16,
    fontWeight: "500",
    flexShrink: 1,
  },
  shareGroupStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  shareGroupStatusAccepted: {
    backgroundColor: "#DCFCE7",
  },
  shareGroupStatusPending: {
    backgroundColor: "#FEF3C7",
  },
  shareGroupStatusText: {
    fontSize: 11,
    fontWeight: "600",
  },
  shareGroupStatusAcceptedText: {
    color: "#166534",
  },
  shareGroupStatusPendingText: {
    color: "#92400E",
  },
  shareInviteButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 70,
    alignItems: "center",
  },
  shareInviteButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  shareRemoveButton: {
    padding: 4,
  },
  shareSearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    gap: 8,
  },
  shareSearchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 8,
  },
  shareCancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 70,
    alignItems: "center",
  },
  shareCancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  shareEmptyState: {
    paddingVertical: 40,
    alignItems: "center",
  },
  shareEmptyStateText: {
    fontSize: 14,
  },
});
