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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { MemberSearch } from "@components/ui/MemberSearch";
import type { CommunityMember } from "@/types/community";
import { AutoChannelSettings } from "@features/channels";

import { ChannelMember, UnsyncedPerson } from "@/utils/channel-members";
import {
  SyncedMemberRowContent,
  UnsyncedPersonRowContent,
} from "@/components/ui/ChannelMemberRows";

// Unified list item type
type ListItem =
  | { type: "synced"; data: ChannelMember }
  | { type: "unsynced"; data: UnsyncedPerson };

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

  // State
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showAutoChannelSettings, setShowAutoChannelSettings] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<Id<"users"> | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isAddingMembers, setIsAddingMembers] = useState(false);

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

  // Mutations
  const addMembersMutation = useMutation(api.functions.messaging.channels.addChannelMembers);
  const removeMemberMutation = useMutation(api.functions.messaging.channels.removeChannelMember);
  const archiveCustomChannelMutation = useMutation(api.functions.messaging.channels.archiveCustomChannel);
  const archivePcoChannelMutation = useMutation(api.functions.messaging.channels.archivePcoChannel);
  const removeGroupMutation = useMutation(api.functions.messaging.sharedChannels.removeGroupFromChannel);

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

  // Create unified list with synced members first, then unsynced at bottom
  const unifiedList = useMemo((): ListItem[] => {
    const syncedItems: ListItem[] = (membersData?.members || []).map((m) => ({
      type: "synced" as const,
      data: m,
    }));
    const unsyncedItems: ListItem[] = unsyncedPeople.map((p) => ({
      type: "unsynced" as const,
      data: p,
    }));
    return [...syncedItems, ...unsyncedItems];
  }, [membersData?.members, unsyncedPeople]);

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

  // Render unified list item (synced or unsynced)
  const renderListItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "synced") {
        const member = item.data;
        const isOwner = member.role === "owner";
        const isCurrentUser = member.userId === user?.id;
        const isRemoving = removingMemberId === member.userId;
        const showRemoveButton =
          canManage && isCustomChannel && (!isSharedChannel || isPrimaryGroup) && !(isOwner && isCurrentUser);

        return (
          <View style={styles.memberItem}>
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
                      <ActivityIndicator size="small" color="#FF3B30" />
                    ) : (
                      <Ionicons name="remove-circle-outline" size={24} color="#FF3B30" />
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
            style={[styles.memberItem, styles.unsyncedMemberItem]}
            testID={`unsynced-member-${person.pcoPersonId}`}
          >
            <UnsyncedPersonRowContent person={person} />
          </View>
        );
      }
    },
    [canManage, isCustomChannel, isSharedChannel, isPrimaryGroup, user, removingMemberId, primaryColor, handleRemoveMember]
  );

  // Loading state
  if (!channelData || !membersData) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Channel Members</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <Text style={styles.loadingText}>Loading members...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {channelData.name}
        </Text>
        {canManage && isCustomChannel && (!isSharedChannel || isPrimaryGroup) ? (
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddMemberModal(true)}
          >
            <Ionicons name="person-add-outline" size={22} color={primaryColor} />
          </TouchableOpacity>
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
        <View style={styles.sharedBanner}>
          <Ionicons name="link" size={16} color="#8B5CF6" />
          <View style={styles.sharedBannerContent}>
            <Text style={styles.sharedBannerTitle}>
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

      {/* Member count */}
      <View style={styles.memberCount}>
        <Text style={styles.memberCountText}>
          {totalMemberCount} member{totalMemberCount !== 1 ? "s" : ""}
          {unsyncedPeople.length > 0 && (
            <Text style={styles.unsyncedCountText}> ({unsyncedPeople.length} unsynced)</Text>
          )}
        </Text>
      </View>

      {/* Auto channel info banner */}
      {isPcoAutoChannel && (!isSharedChannel || isPrimaryGroup) && (
        <TouchableOpacity
          style={styles.autoChannelBanner}
          onPress={() => setShowAutoChannelSettings(true)}
        >
          <Ionicons name="sync" size={16} color={primaryColor} />
          <View style={styles.autoChannelBannerContent}>
            <Text style={styles.autoChannelBannerTitle}>PCO Auto Channel</Text>
            <Text style={styles.autoChannelBannerText}>
              Members are automatically synced from Planning Center Services
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </TouchableOpacity>
      )}

      {/* Members list (unified: synced members first, unsynced at bottom) */}
      {unifiedList.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="people-outline" size={64} color="#ccc" />
          <Text style={styles.emptyTitle}>No Members</Text>
          <Text style={styles.emptySubtitle}>
            This channel has no members yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={unifiedList}
          renderItem={renderListItem}
          keyExtractor={(item) =>
            item.type === "synced" ? item.data.userId : `unsynced-${item.data.pcoPersonId}`
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Bottom actions */}
      {hasBottomActions && (
        <View
          testID="bottom-actions"
          style={[styles.bottomActions, { paddingBottom: insets.bottom + 16 }]}
        >
          {/* Remove Group / Leave button for secondary group leaders */}
          {showLeaveSharedChannelAction && (
            <TouchableOpacity
              style={styles.removeGroupButton}
              onPress={() => handleRemoveGroup(groupId as Id<"groups">)}
            >
              <Ionicons name="exit-outline" size={20} color="#FF9500" />
              <Text style={styles.removeGroupButtonText}>Leave Shared Channel</Text>
            </TouchableOpacity>
          )}

          {/* Share with Groups button (for primary group leaders) */}
          {canShare && (
            <TouchableOpacity
              style={styles.shareButton}
              onPress={() => setShowShareModal(true)}
            >
              <Ionicons name="people-outline" size={20} color="#8B5CF6" />
              <Text style={styles.shareButtonText}>Share with Groups</Text>
            </TouchableOpacity>
          )}

          {/* Archive button (for primary group, custom/PCO channels) */}
          {showArchiveChannelAction && (
            <TouchableOpacity
              style={styles.archiveButton}
              onPress={handleArchiveChannel}
              disabled={isArchiving}
            >
              {isArchiving ? (
                <ActivityIndicator size="small" color="#FF3B30" />
              ) : (
                <>
                  <Ionicons name="archive-outline" size={20} color="#FF3B30" />
                  <Text style={styles.archiveButtonText}>Archive Channel</Text>
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
  const [selectedMembers, setSelectedMembers] = useState<CommunityMember[]>([]);

  const handleConfirmAdd = () => {
    if (selectedMembers.length > 0) {
      onAddMembers(selectedMembers);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.modalContainer}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Modal Header */}
      <View style={[styles.modalHeader, { paddingTop: insets.top + 16 }]}>
        <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
          <Text style={styles.modalCancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Add Members</Text>
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
                { color: selectedMembers.length > 0 ? primaryColor : "#ccc" },
              ]}
            >
              Add ({selectedMembers.length})
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Info note about non-group members */}
      <View style={styles.infoNote}>
        <Ionicons name="information-circle-outline" size={16} color="#666" />
        <Text style={styles.infoNoteText}>
          {isSharedChannel
            ? "Only primary + connected group members appear here. Adding someone from a connected group adds them to this channel only, not to the primary group."
            : "People not in this group will be automatically added when you add them to this channel."}
        </Text>
      </View>

      {/* Selected Members Preview */}
      {selectedMembers.length > 0 && (
        <View style={styles.selectedPreview}>
          <Text style={styles.selectedPreviewText}>
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
    <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.shareModalHeader}>
        <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
          <Text style={styles.modalCancelText}>Done</Text>
        </TouchableOpacity>
        <Text style={styles.modalTitle}>Share Channel</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.shareModalSubheader}>
        <Ionicons name="link" size={14} color="#8B5CF6" />
        <Text style={styles.shareModalSubheaderText}>
          Invite groups to join "{channelName}"
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.shareSearchContainer}>
        <Ionicons name="search" size={18} color="#999" />
        <TextInput
          style={styles.shareSearchInput}
          placeholder="Search groups..."
          placeholderTextColor="#999"
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText("")}>
            <Ionicons name="close-circle" size={18} color="#999" />
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
              <View key={group._id} style={styles.shareGroupItem}>
                <View style={styles.shareGroupInfo}>
                  <Text style={styles.shareGroupName} numberOfLines={1}>
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
                    style={styles.shareCancelButton}
                    onPress={() => handleCancelInvite(group._id)}
                    disabled={!!isCancelling}
                  >
                    {isCancelling === group._id ? (
                      <ActivityIndicator size="small" color="#FF9500" />
                    ) : (
                      <Text style={styles.shareCancelButtonText}>Cancel</Text>
                    )}
                  </TouchableOpacity>
                ) : isPrimaryLeader && status === "accepted" ? (
                  <TouchableOpacity
                    style={styles.shareRemoveButton}
                    onPress={() => onRemoveGroup(group._id, group.name)}
                  >
                    <Ionicons name="close-circle-outline" size={22} color="#FF3B30" />
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}

          {filteredGroups.length === 0 && (
            <View style={styles.shareEmptyState}>
              <Text style={styles.shareEmptyStateText}>
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
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
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
    color: "#000",
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
    backgroundColor: "#F5F0FF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0D6F5",
    gap: 12,
  },
  sharedBannerContent: {
    flex: 1,
  },
  sharedBannerTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#5B21B6",
    marginBottom: 2,
  },
  sharedBannerText: {
    fontSize: 12,
    color: "#7C3AED",
  },

  memberCount: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#F5F5F5",
  },
  memberCountText: {
    fontSize: 14,
    color: "#666",
  },
  autoChannelBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingHorizontal: 16,
    backgroundColor: "#F0F7FF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
    gap: 12,
  },
  autoChannelBannerContent: {
    flex: 1,
  },
  autoChannelBannerTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 2,
  },
  autoChannelBannerText: {
    fontSize: 12,
    color: "#666",
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
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
  // Unsynced member styles
  unsyncedMemberItem: {
    backgroundColor: "#FFF8E6",
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
    color: "#666",
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
    color: "#333",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
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
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    gap: 8,
  },
  removeGroupButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FF9500",
    gap: 8,
  },
  removeGroupButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FF9500",
  },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#8B5CF6",
    gap: 8,
  },
  shareButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#8B5CF6",
  },
  archiveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FF3B30",
    gap: 8,
  },
  archiveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FF3B30",
  },

  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  modalCloseButton: {
    width: 60,
  },
  modalCancelText: {
    fontSize: 16,
    color: "#666",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
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
    backgroundColor: "#F5F5F5",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  selectedPreviewText: {
    fontSize: 14,
    color: "#666",
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
    backgroundColor: "#F5F5F5",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
    gap: 8,
  },
  infoNoteText: {
    flex: 1,
    fontSize: 13,
    color: "#666",
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
    borderBottomColor: "#E0E0E0",
  },
  shareModalSubheader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#F5F0FF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0D6F5",
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
    borderBottomColor: "#F0F0F0",
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
    color: "#333",
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
    backgroundColor: "#F5F5F5",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
    gap: 8,
  },
  shareSearchInput: {
    flex: 1,
    fontSize: 16,
    color: "#333",
    paddingVertical: 8,
  },
  shareCancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FF9500",
    minWidth: 70,
    alignItems: "center",
  },
  shareCancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FF9500",
  },
  shareEmptyState: {
    paddingVertical: 40,
    alignItems: "center",
  },
  shareEmptyStateText: {
    fontSize: 14,
    color: "#999",
  },
});
