import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
import { useRouter } from "expo-router";
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
import { useTheme } from "@hooks/useTheme";

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
  isEnabled?: boolean;
}

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

export function Members({ groupId, onMemberAction, canManageMembers = false }: MembersProps) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [showActionsModal, setShowActionsModal] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [accumulatedSyncedMembers, setAccumulatedSyncedMembers] = useState<ChannelMember[]>([]);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const processedPageKeyRef = useRef<string | null>(null);

  // Fetch all channels for this group
  const channels = useAuthenticatedQuery(
    api.functions.messaging.channels.listGroupChannels,
    { groupId: groupId as Id<"groups"> }
  );

  // Filter to relevant channels (exclude DMs, include shared)
  const visibleChannels = useMemo((): Channel[] => {
    if (!channels) return [];
    return channels.filter(
      (ch: Channel) =>
        ch.channelType !== "dm" &&
        ch.channelType !== "reach_out" &&
        ch.isEnabled !== false
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

  // Debounce member search before sending to backend.
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const backendSearchQuery = debouncedSearchQuery.length >= 2 ? debouncedSearchQuery : "";

  // Reset pagination when channel or backend search query changes.
  useEffect(() => {
    setCursor(undefined);
    setAccumulatedSyncedMembers([]);
    setIsFetchingNextPage(false);
    processedPageKeyRef.current = null;
  }, [activeChannelId, backendSearchQuery]);

  // Fetch paginated channel members for the selected channel.
  const membersData = useAuthenticatedQuery(
    api.functions.messaging.channels.getChannelMembers as any,
    activeChannelId
      ? ({
          channelId: activeChannelId as Id<"chatChannels">,
          limit: PAGE_SIZE,
          cursor,
          search: backendSearchQuery || undefined,
        } as any)
      : "skip"
  );

  // Apply page results to accumulated member state.
  const pageRequestKey = `${activeChannelId ?? "none"}::${backendSearchQuery}::${cursor ?? "root"}`;
  useEffect(() => {
    if (!membersData || !activeChannelId) return;
    if (processedPageKeyRef.current === pageRequestKey) return;
    processedPageKeyRef.current = pageRequestKey;

    const pageMembers = (membersData.members ?? []) as ChannelMember[];
    if (cursor) {
      setAccumulatedSyncedMembers((prev) => {
        const seen = new Set(prev.map((member) => member.userId));
        const nextPageMembers = pageMembers.filter((member) => !seen.has(member.userId));
        return [...prev, ...nextPageMembers];
      });
    } else {
      setAccumulatedSyncedMembers(pageMembers);
    }
    setIsFetchingNextPage(false);
  }, [membersData, activeChannelId, cursor, pageRequestKey]);

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
    const syncedItems: ListItem[] = accumulatedSyncedMembers.map((m: ChannelMember) => ({
      type: "synced" as const,
      data: m,
    }));
    const unsyncedItems: ListItem[] =
      backendSearchQuery.length === 0
        ? unsyncedPeople.map((p: UnsyncedPerson) => ({
            type: "unsynced" as const,
            data: p,
          }))
        : [];
    return [...syncedItems, ...unsyncedItems];
  }, [accumulatedSyncedMembers, unsyncedPeople, backendSearchQuery.length]);

  const totalMemberCount = useMemo(() => {
    const syncedCount = membersData?.totalCount ?? accumulatedSyncedMembers.length;
    const unsyncedCount = backendSearchQuery.length === 0 ? unsyncedPeople.length : 0;
    return syncedCount + unsyncedCount;
  }, [membersData?.totalCount, accumulatedSyncedMembers.length, unsyncedPeople.length, backendSearchQuery.length]);

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

  const hasNextPage = !!membersData?.nextCursor;

  const handleLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || !membersData?.nextCursor) {
      return;
    }
    setIsFetchingNextPage(true);
    setCursor(membersData.nextCursor);
  }, [hasNextPage, isFetchingNextPage, membersData?.nextCursor]);

  const renderListItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "synced") {
        const member = item.data;
        const isCurrentUser = member.userId === user?.id;

        return (
          <TouchableOpacity
            style={[styles.memberItem, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={() => handleMemberPress(member)}
          >
            <SyncedMemberRowContent
              member={member}
              primaryColor={primaryColor}
              isCurrentUser={isCurrentUser}
              rightContent={<Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />}
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
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading members...</Text>
      </View>
    );
  }

  // No channels available
  if (visibleChannels.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={[styles.emptyStateText, { color: colors.textTertiary }]}>No channels found for this group</Text>
      </View>
    );
  }

  const isLoadingMembers =
    !membersData && !!activeChannelId && accumulatedSyncedMembers.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      {/* Search Bar */}
      <View style={[styles.searchContainer, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <SearchBar
          placeholder="Search members..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Channel Chips */}
      <View style={[styles.filterSection, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
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
                style={[styles.filterChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }, isActive && activeChipStyle]}
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
                      color={isActive ? colors.textInverse : colors.link}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  {channel.channelType === "pco_services" && (
                    <Ionicons
                      name="sync"
                      size={12}
                      color={isActive ? colors.textInverse : colors.link}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: colors.textSecondary },
                      isActive && { color: colors.textInverse },
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
        <View style={[styles.memberCountSection, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[styles.memberCountText, { color: colors.textSecondary }]}>
            {totalMemberCount} member{totalMemberCount !== 1 ? "s" : ""}
            {unsyncedPeople.length > 0 && (
              <Text style={styles.unsyncedCountText}>
                {" "}({unsyncedPeople.length} unsynced)
              </Text>
            )}
          </Text>
          {isPcoChannel && (
            <View style={styles.pcoBadge}>
              <Ionicons name="sync" size={12} color={colors.link} />
              <Text style={styles.pcoBadgeText}>PCO Synced</Text>
            </View>
          )}
          {activeChannel.isShared && (
            <View style={styles.sharedBadge}>
              <Ionicons name="link" size={12} color={colors.link} />
              <Text style={styles.sharedBadgeText}>Shared</Text>
            </View>
          )}
        </View>
      )}

      {/* Members List */}
      {isLoadingMembers ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading channel members...</Text>
        </View>
      ) : (
        <FlatList
          data={unifiedList}
          renderItem={renderListItem}
          keyExtractor={(item: ListItem) =>
            item.type === "synced"
              ? item.data.userId
              : `unsynced-${item.data.pcoPersonId}`
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.35}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.paginationLoader}>
                <ActivityIndicator size="small" />
                <Text style={[styles.paginationLoaderText, { color: colors.textSecondary }]}>Loading more members...</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={[styles.emptyStateText, { color: colors.textTertiary }]}>
                {backendSearchQuery
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
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();

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

  // Visible to ANY caller — non-admin members can still view profiles.
  const handleViewProfile = () => {
    const userId = member?.id ?? member?._id ?? member?.user?.id;
    onClose();
    if (userId) {
      router.push(`/profile/${userId}` as any);
    }
  };

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
        <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {member?.first_name || ""} {member?.last_name || ""}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseButton}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalActions}>
            {/* View profile is always available — non-admins included. */}
            <TouchableOpacity
              style={[styles.modalActionButton, { borderBottomColor: colors.border }]}
              onPress={handleViewProfile}
            >
              <Ionicons name="person-circle-outline" size={20} color={colors.text} />
              <Text style={[styles.modalActionText, { color: colors.text }]}>
                View profile
              </Text>
            </TouchableOpacity>
            {canPromoteDemote && !isCurrentUser && (
              <>
                {isLeader ? (
                  <TouchableOpacity
                    style={[styles.modalActionButton, { borderBottomColor: colors.border }]}
                    onPress={() => onAction("demote")}
                  >
                    <Ionicons name="arrow-down" size={20} color={colors.text} />
                    <Text style={[styles.modalActionText, { color: colors.text }]}>Demote to Member</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.modalActionButton, { borderBottomColor: colors.border }]}
                    onPress={() => onAction("promote")}
                  >
                    <Ionicons name="arrow-up" size={20} color={colors.text} />
                    <Text style={[styles.modalActionText, { color: colors.text }]}>
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
                <Ionicons name="person-remove" size={20} color={colors.destructive} />
                <Text
                  style={[styles.modalActionText, { color: colors.destructive }]}
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
  },
  searchContainer: {
    padding: 16,
    borderBottomWidth: 1,
  },
  filterSection: {
    borderBottomWidth: 1,
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
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: "500",
  },
  filterChipTextActive: {},
  memberCountSection: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  memberCountText: {
    fontSize: 14,
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
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
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
  },
  paginationLoader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 8,
  },
  paginationLoaderText: {
    fontSize: 13,
  },
  emptyState: {
    padding: 40,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 16,
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
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
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
  },
  modalActionButtonDanger: {
    borderBottomWidth: 0,
  },
  modalActionText: {
    fontSize: 16,
    marginLeft: 12,
  },
  modalActionTextDanger: {},
});
