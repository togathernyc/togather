import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SearchBar } from "@components/ui/SearchBar";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { MembershipRole } from "@/constants/membership";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

interface MembersProps {
  groupId: string;
  onMemberAction?: (member: any, action: string) => void;
  /** Whether the current user can manage members (add/remove) */
  canManageMembers?: boolean;
}

import { ChannelMember, UnsyncedPerson } from "@/utils/channel-members";
import {
  SyncedMemberRowContent,
  UnsyncedPersonRowContent,
} from "@/components/ui/ChannelMemberRows";

type ListItem =
  | { type: "synced"; data: ChannelMember }
  | { type: "unsynced"; data: UnsyncedPerson };

interface Channel {
  _id: string;
  slug: string;
  channelType: string;
  name: string;
  memberCount: number;
  isShared?: boolean;
}

export function Members({ groupId, onMemberAction, canManageMembers = false }: MembersProps) {
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [showActionsModal, setShowActionsModal] = useState(false);

  // Fetch all channels for this group
  const channels = useAuthenticatedQuery(
    api.functions.messaging.channels.listGroupChannels,
    { groupId: groupId as Id<"groups"> }
  );

  // Filter to relevant channels (exclude DMs, include shared)
  const visibleChannels = useMemo((): Channel[] => {
    if (!channels) return [];
    return channels.filter(
      (ch: Channel) => ch.channelType !== "dm" && ch.channelType !== "reach_out"
    );
  }, [channels]);

  // Default to first channel when channels load
  const activeChannelId = useMemo(() => {
    if (selectedChannelId && visibleChannels.some((ch: Channel) => ch._id === selectedChannelId)) {
      return selectedChannelId;
    }
    return visibleChannels[0]?._id ?? null;
  }, [selectedChannelId, visibleChannels]);

  const activeChannel = useMemo(
    () => visibleChannels.find((ch: Channel) => ch._id === activeChannelId),
    [visibleChannels, activeChannelId]
  );

  // Fetch channel members for selected channel
  const membersData = useAuthenticatedQuery(
    api.functions.messaging.channels.getChannelMembers,
    activeChannelId
      ? { channelId: activeChannelId as Id<"chatChannels"> }
      : "skip"
  );

  // Fetch Leaders channel members to determine group role.
  // Leaders channel membership is always in sync with group leadership,
  // so presence in the Leaders channel = leader role.
  const leadersChannel = useMemo(
    () => visibleChannels.find((ch: Channel) => ch.channelType === "leaders"),
    [visibleChannels]
  );
  const leadersData = useAuthenticatedQuery(
    api.functions.messaging.channels.getChannelMembers,
    leadersChannel?._id
      ? { channelId: leadersChannel._id as Id<"chatChannels">, limit: 500 }
      : "skip"
  );
  const leaderUserIds = useMemo(() => {
    if (!leadersData?.members) return new Set<string>();
    return new Set(leadersData.members.map((m: any) => m.userId));
  }, [leadersData?.members]);

  // For PCO channels, fetch auto channel config (for unsynced people)
  const isPcoChannel = activeChannel?.channelType === "pco_services";
  const autoChannelConfig = useAuthenticatedQuery(
    api.functions.pcoServices.queries.getAutoChannelConfigByChannel,
    activeChannelId && isPcoChannel
      ? { channelId: activeChannelId as Id<"chatChannels"> }
      : "skip"
  );

  // Get unsynced people from auto channel config
  const unsyncedPeople = useMemo((): UnsyncedPerson[] => {
    if (!autoChannelConfig?.lastSyncResults?.unmatchedPeople) return [];
    return autoChannelConfig.lastSyncResults.unmatchedPeople;
  }, [autoChannelConfig]);

  // Build unified list: synced members + unsynced PCO people
  const unifiedList = useMemo((): ListItem[] => {
    const syncedItems: ListItem[] = (membersData?.members || []).map((m: any) => ({
      type: "synced" as const,
      data: m as ChannelMember,
    }));
    const unsyncedItems: ListItem[] = unsyncedPeople.map((p: UnsyncedPerson) => ({
      type: "unsynced" as const,
      data: p,
    }));
    return [...syncedItems, ...unsyncedItems];
  }, [membersData?.members, unsyncedPeople]);

  // Apply search filter
  const filteredList = useMemo(() => {
    if (!searchQuery.trim()) return unifiedList;
    const q = searchQuery.toLowerCase().trim();
    return unifiedList.filter((item: ListItem) => {
      if (item.type === "synced") {
        const displayName = item.data.displayName || "";
        return displayName.toLowerCase().includes(q);
      } else {
        const pcoName = item.data.pcoName || "";
        return pcoName.toLowerCase().includes(q);
      }
    });
  }, [unifiedList, searchQuery]);

  const totalMemberCount = useMemo(() => {
    const syncedCount = membersData?.totalCount ?? 0;
    const unsyncedCount = unsyncedPeople.length;
    return syncedCount + unsyncedCount;
  }, [membersData?.totalCount, unsyncedPeople.length]);

  const handleMemberPress = useCallback((member: ChannelMember) => {
    if (!member) return;
    // Map channel member to the format expected by onMemberAction
    // Derive group role from Leaders channel membership (always in sync with group roles)
    // Fallback to "member" when leaders data isn't available yet so promotion
    // actions remain usable even if leader-role metadata is delayed/unavailable.
    const groupRole = leadersChannel && leadersData
      ? (leaderUserIds.has(member.userId) ? "leader" : "member")
      : "member";
    setSelectedMember({
      id: member.userId,
      _id: member.userId,
      user: { id: member.userId },
      first_name: member.displayName.split(" ")[0] || "",
      last_name: member.displayName.split(" ").slice(1).join(" ") || "",
      profile_photo: member.profilePhoto,
      role: groupRole,
    });
    setShowActionsModal(true);
  }, [leadersChannel, leadersData, leaderUserIds]);

  const handleAction = (action: string) => {
    if (onMemberAction && selectedMember) {
      onMemberAction(selectedMember, action);
    }
    setShowActionsModal(false);
    setSelectedMember(null);
  };

  const renderListItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "synced") {
        const member = item.data;
        const isCurrentUser = member.userId === user?.id;

        return (
          <TouchableOpacity
            style={styles.memberItem}
            onPress={() => handleMemberPress(member)}
          >
            <SyncedMemberRowContent
              member={member}
              primaryColor={primaryColor}
              isCurrentUser={isCurrentUser}
              rightContent={<Ionicons name="chevron-forward" size={20} color="#999" />}
            />
          </TouchableOpacity>
        );
      } else {
        const person = item.data;

        return (
          <View style={[styles.memberItem, styles.unsyncedMemberItem]}>
            <UnsyncedPersonRowContent person={person} />
          </View>
        );
      }
    },
    [user, primaryColor, handleMemberPress]
  );

  // Loading state - channels not loaded yet
  if (!channels) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading members...</Text>
      </View>
    );
  }

  // No channels available
  if (visibleChannels.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>No channels found for this group</Text>
      </View>
    );
  }

  const isLoadingMembers = !membersData && !!activeChannelId;

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <SearchBar
          placeholder="Search members..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Channel Chips */}
      <View style={styles.filterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChips}
        >
          {visibleChannels.map((channel: Channel) => {
            const isActive = channel._id === activeChannelId;
            const activeChipStyle = { backgroundColor: primaryColor, borderColor: primaryColor };
            return (
              <TouchableOpacity
                key={channel._id}
                style={[styles.filterChip, isActive && activeChipStyle]}
                onPress={() => {
                  setSelectedChannelId(channel._id);
                  setSearchQuery("");
                }}
                activeOpacity={0.7}
              >
                <View style={styles.chipContent}>
                  {channel.isShared && (
                    <Ionicons
                      name="link"
                      size={12}
                      color={isActive ? "#fff" : "#8B5CF6"}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  {channel.channelType === "pco_services" && (
                    <Ionicons
                      name="sync"
                      size={12}
                      color={isActive ? "#fff" : "#2196F3"}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <Text
                    style={[
                      styles.filterChipText,
                      isActive && styles.filterChipTextActive,
                    ]}
                  >
                    {channel.name}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Member Count & Channel Info */}
      {activeChannel && (
        <View style={styles.memberCountSection}>
          <Text style={styles.memberCountText}>
            {totalMemberCount} member{totalMemberCount !== 1 ? "s" : ""}
            {unsyncedPeople.length > 0 && (
              <Text style={styles.unsyncedCountText}>
                {" "}({unsyncedPeople.length} unsynced)
              </Text>
            )}
          </Text>
          {isPcoChannel && (
            <View style={styles.pcoBadge}>
              <Ionicons name="sync" size={12} color="#2196F3" />
              <Text style={styles.pcoBadgeText}>PCO Synced</Text>
            </View>
          )}
          {activeChannel.isShared && (
            <View style={styles.sharedBadge}>
              <Ionicons name="link" size={12} color="#8B5CF6" />
              <Text style={styles.sharedBadgeText}>Shared</Text>
            </View>
          )}
        </View>
      )}

      {/* Members List */}
      {isLoadingMembers ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading channel members...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredList}
          renderItem={renderListItem}
          keyExtractor={(item: ListItem) =>
            item.type === "synced"
              ? item.data.userId
              : `unsynced-${item.data.pcoPersonId}`
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                {searchQuery
                  ? "No members found matching your search"
                  : "No members in this channel"}
              </Text>
            </View>
          }
        />
      )}

      {/* Member Actions Modal */}
      <MemberActionsModal
        visible={showActionsModal && !!selectedMember}
        member={selectedMember}
        onClose={() => {
          setShowActionsModal(false);
          setSelectedMember(null);
        }}
        onAction={handleAction}
        canManageMembers={canManageMembers}
      />
    </View>
  );
}

interface MemberActionsModalProps {
  visible: boolean;
  member: any;
  onClose: () => void;
  onAction: (action: string) => void;
  canManageMembers?: boolean;
}

function MemberActionsModal({
  visible,
  member,
  onClose,
  onAction,
  canManageMembers = false,
}: MemberActionsModalProps) {
  const { user } = useAuth();

  if (!member || !visible) {
    return null;
  }

  const memberRole = member?.role;
  const isLeader =
    memberRole === "leader" ||
    memberRole === MembershipRole.LEADER ||
    memberRole === 2;
  const isCurrentUser = user?.id === member?.id;
  // Show promote/demote if user can manage members AND we have group role data
  const canPromoteDemote = canManageMembers && memberRole !== undefined;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {member?.first_name || ""} {member?.last_name || ""}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
              <Ionicons name="close" size={24} color="#333" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalActions}>
            {canPromoteDemote && !isCurrentUser && (
              <>
                {isLeader ? (
                  <TouchableOpacity
                    style={styles.modalActionButton}
                    onPress={() => onAction("demote")}
                  >
                    <Ionicons name="arrow-down" size={20} color="#333" />
                    <Text style={styles.modalActionText}>Demote to Member</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.modalActionButton}
                    onPress={() => onAction("promote")}
                  >
                    <Ionicons name="arrow-up" size={20} color="#333" />
                    <Text style={styles.modalActionText}>
                      Promote to Leader
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
            {canManageMembers && !isCurrentUser && (
              <TouchableOpacity
                style={[
                  styles.modalActionButton,
                  styles.modalActionButtonDanger,
                ]}
                onPress={() => onAction("remove")}
              >
                <Ionicons name="person-remove" size={20} color="#e74c3c" />
                <Text
                  style={[styles.modalActionText, styles.modalActionTextDanger]}
                >
                  Remove from Group
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  searchContainer: {
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  filterSection: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    paddingVertical: 12,
  },
  filterChips: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  chipContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  filterChipText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  filterChipTextActive: {
    color: "#fff",
  },
  memberCountSection: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#f5f5f5",
    gap: 8,
  },
  memberCountText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  unsyncedCountText: {
    color: "#B25000",
  },
  pcoBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  pcoBadgeText: {
    fontSize: 11,
    color: "#2196F3",
    fontWeight: "600",
  },
  sharedBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3E8FF",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  sharedBadgeText: {
    fontSize: 11,
    color: "#8B5CF6",
    fontWeight: "600",
  },
  listContent: {
    padding: 16,
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  unsyncedMemberItem: {
    backgroundColor: "#FFF8F0",
    borderColor: "#FFE0B2",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
  },
  emptyState: {
    padding: 40,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: "50%",
    zIndex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  modalCloseButton: {
    padding: 4,
  },
  modalActions: {
    paddingTop: 20,
  },
  modalActionButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  modalActionButtonDanger: {
    borderBottomWidth: 0,
  },
  modalActionText: {
    fontSize: 16,
    color: "#333",
    marginLeft: 12,
  },
  modalActionTextDanger: {
    color: "#e74c3c",
  },
});
