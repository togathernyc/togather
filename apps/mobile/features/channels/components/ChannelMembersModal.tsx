/**
 * ChannelMembersModal
 *
 * A bottom sheet modal that displays channel members when triggered by long-press.
 * Reuses the existing getChannelMembers query pattern.
 *
 * Features:
 * - Shows member avatars, names, and role badges
 * - Displays PCO sync metadata (team badge in blue, position badge in orange)
 * - Shows unsynced PCO people with warning indicator
 * - Loading and empty states
 * - Swipe-to-dismiss gesture support
 */
import React, { memo, useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useQuery, useAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

// Types for channel member
interface ChannelMember {
  id: string;
  userId: Id<"users">;
  displayName: string;
  profilePhoto?: string;
  role: string;
  syncSource?: string;
  syncMetadata?: {
    serviceTypeName?: string;
    teamName?: string;
    position?: string;
    serviceDate?: number;
    serviceName?: string;
  };
}

// Type for unsynced PCO people
interface UnsyncedPerson {
  pcoPersonId: string;
  pcoName: string;
  pcoPhone?: string;
  pcoEmail?: string;
  serviceTypeName?: string;
  teamName?: string;
  position?: string;
  reason: string;
}

// Unified list item type
type ListItem =
  | { type: "synced"; data: ChannelMember }
  | { type: "section-header"; title: string }
  | { type: "unsynced"; data: UnsyncedPerson };

interface ChannelMembersModalProps {
  visible: boolean;
  onClose: () => void;
  channelId: Id<"chatChannels"> | undefined;
  channelName: string;
  groupId?: string;
  channelSlug?: string;
}

export const ChannelMembersModal = memo(function ChannelMembersModal({
  visible,
  onClose,
  channelId,
  channelName,
  groupId,
  channelSlug,
}: ChannelMembersModalProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, user } = useAuth();
  const { primaryColor } = useCommunityTheme();

  // Query channel members - only fetch when modal is visible to prevent memory leaks
  const membersData = useQuery(
    api.functions.messaging.channels.getChannelMembers,
    visible && token && channelId
      ? {
          token,
          channelId,
        }
      : "skip"
  );

  // Query auto channel config to get unsynced people
  const autoChannelConfig = useQuery(
    api.functions.pcoServices.queries.getAutoChannelConfigByChannel,
    visible && token && channelId
      ? {
          token,
          channelId,
        }
      : "skip"
  );

  // Sync action
  const triggerSync = useAction(api.functions.pcoServices.actions.triggerChannelSync);
  const [isSyncing, setIsSyncing] = useState(false);

  // Handle sync button press
  const handleSync = useCallback(async () => {
    if (!token || !channelId || isSyncing) return;

    setIsSyncing(true);
    try {
      const result = await triggerSync({ token, channelId });
      if (result.status === "success") {
        Alert.alert(
          "Sync Complete",
          `Added ${result.addedCount || 0} member(s), removed ${result.removedCount || 0} member(s).`
        );
      } else {
        Alert.alert("Sync Info", result.reason || "No changes needed.");
      }
    } catch (error) {
      Alert.alert(
        "Sync Failed",
        error instanceof Error ? error.message : "An error occurred during sync."
      );
    } finally {
      setIsSyncing(false);
    }
  }, [token, channelId, isSyncing, triggerSync]);

  // Check if this is a PCO auto channel
  const isPcoAutoChannel = autoChannelConfig?.integrationType === "pco_services";

  // Handle settings button press - navigate to channel members page
  const handleSettings = useCallback(() => {
    if (!groupId || !channelSlug) return;
    onClose();
    router.push(`/inbox/${groupId}/${channelSlug}/members`);
  }, [groupId, channelSlug, onClose, router]);

  // Get unsynced people from the config
  const unsyncedPeople = useMemo(() => {
    return autoChannelConfig?.lastSyncResults?.unmatchedPeople || [];
  }, [autoChannelConfig]);

  // Combine members and unsynced people into a single list
  const listData = useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];

    // Add synced members
    if (membersData?.members) {
      for (const member of membersData.members) {
        items.push({ type: "synced", data: member });
      }
    }

    // Add unsynced section if there are unsynced people
    if (unsyncedPeople.length > 0) {
      items.push({
        type: "section-header",
        title: `Unsynced (${unsyncedPeople.length})`,
      });
      for (const person of unsyncedPeople) {
        items.push({ type: "unsynced", data: person });
      }
    }

    return items;
  }, [membersData, unsyncedPeople]);

  // Helper to format debug reason text (must be defined before renderItem uses it)
  const getDebugReasonText = useCallback((reason: string, person: UnsyncedPerson) => {
    switch (reason) {
      case "not_in_group":
        return "In community but not in this group";
      case "not_in_community":
        return "Not in this community";
      case "no_contact_info":
        return "No contact info in PCO";
      case "phone_mismatch":
        return `Phone ${person.pcoPhone || "unknown"} not found`;
      case "email_mismatch":
        return `Email ${person.pcoEmail || "unknown"} not found`;
      default:
        return "Unknown issue";
    }
  }, []);

  // Render member item - memoized to prevent FlatList re-renders
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "section-header") {
        return (
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLine} />
            <Text style={styles.sectionHeaderText}>{item.title}</Text>
            <View style={styles.sectionHeaderLine} />
          </View>
        );
      }

      if (item.type === "unsynced") {
        const person = item.data;
        const initials =
          person.pcoName
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2) || "?";

        return (
          <View style={[styles.memberItem, styles.unsyncedItem]}>
            {/* Avatar */}
            <View style={styles.memberAvatar}>
              <View style={[styles.avatarPlaceholder, styles.unsyncedAvatar]}>
                <Text style={[styles.avatarInitials, styles.unsyncedInitials]}>
                  {initials}
                </Text>
              </View>
            </View>

            {/* Name and badges */}
            <View style={styles.memberInfo}>
              <View style={styles.memberNameRow}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {person.pcoName}
                </Text>
                <Ionicons
                  name="warning"
                  size={14}
                  color="#B25000"
                  style={{ marginLeft: 4 }}
                />
              </View>
              <View style={styles.badgeRow}>
                {person.teamName && (
                  <View style={styles.syncBadge}>
                    <Ionicons name="people" size={10} color="#2196F3" />
                    <Text style={styles.syncBadgeText}>
                      {person.serviceTypeName
                        ? `${person.serviceTypeName} > ${person.teamName}`
                        : person.teamName}
                    </Text>
                  </View>
                )}
                {person.position && (
                  <View style={[styles.syncBadge, styles.positionBadge]}>
                    <Ionicons name="musical-notes" size={10} color="#FF9800" />
                    <Text style={[styles.syncBadgeText, styles.positionBadgeText]}>
                      {person.position}
                    </Text>
                  </View>
                )}
              </View>
              {/* Show reason */}
              <Text style={styles.unsyncedReason}>
                {getDebugReasonText(person.reason, person)}
              </Text>
            </View>
          </View>
        );
      }

      // Synced member
      const member = item.data;
      const isOwner = member.role === "owner";
      const isAdmin = member.role === "admin";
      const isCurrentUser = member.userId === user?.id;
      const isPcoSynced = member.syncSource === "pco_services";
      const initials =
        member.displayName
          .split(" ")
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2) || "?";

      return (
        <View style={styles.memberItem}>
          {/* Avatar */}
          <View style={styles.memberAvatar}>
            {member.profilePhoto ? (
              <Image
                source={{ uri: member.profilePhoto }}
                style={styles.avatarImage}
              />
            ) : (
              <View
                style={[styles.avatarPlaceholder, { backgroundColor: primaryColor }]}
              >
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
          </View>

          {/* Name and badges */}
          <View style={styles.memberInfo}>
            <View style={styles.memberNameRow}>
              <Text style={styles.memberName} numberOfLines={1}>
                {member.displayName}
              </Text>
              {isCurrentUser && <Text style={styles.youBadge}>(you)</Text>}
            </View>
            <View style={styles.badgeRow}>
              {isOwner && (
                <View
                  style={[styles.roleBadge, { backgroundColor: `${primaryColor}20` }]}
                >
                  <Text style={[styles.roleBadgeText, { color: primaryColor }]}>
                    Owner
                  </Text>
                </View>
              )}
              {isAdmin && !isOwner && (
                <View
                  style={[styles.roleBadge, { backgroundColor: `${primaryColor}20` }]}
                >
                  <Text style={[styles.roleBadgeText, { color: primaryColor }]}>
                    Admin
                  </Text>
                </View>
              )}
              {/* PCO sync metadata - team and position */}
              {isPcoSynced && member.syncMetadata && (
                <>
                  {member.syncMetadata.teamName && (
                    <View style={styles.syncBadge}>
                      <Ionicons name="people" size={10} color="#2196F3" />
                      <Text style={styles.syncBadgeText}>
                        {member.syncMetadata.serviceTypeName
                          ? `${member.syncMetadata.serviceTypeName} > ${member.syncMetadata.teamName}`
                          : member.syncMetadata.teamName}
                      </Text>
                    </View>
                  )}
                  {member.syncMetadata.position && (
                    <View style={[styles.syncBadge, styles.positionBadge]}>
                      <Ionicons name="musical-notes" size={10} color="#FF9800" />
                      <Text style={[styles.syncBadgeText, styles.positionBadgeText]}>
                        {member.syncMetadata.position}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </View>
      );
    },
    [user?.id, primaryColor, getDebugReasonText]
  );

  const keyExtractor = useCallback((item: ListItem, index: number) => {
    if (item.type === "synced") return `synced-${item.data.userId}`;
    if (item.type === "unsynced") return `unsynced-${item.data.pcoPersonId}`;
    return `header-${index}`;
  }, []);

  const memberCount = membersData?.totalCount ?? 0;
  const unsyncedCount = unsyncedPeople.length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.backdropInner} />
      </Pressable>

      <View style={[styles.modalContainer, { paddingBottom: insets.bottom + 16 }]}>
        {/* Handle bar */}
        <View style={styles.handleBar} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.headerTitleContainer}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {channelName}
              </Text>
              <Text style={styles.memberCountText}>
                {memberCount} member{memberCount !== 1 ? "s" : ""}
                {unsyncedCount > 0 && (
                  <Text style={styles.unsyncedCountText}>
                    {" "}
                    ({unsyncedCount} unsynced)
                  </Text>
                )}
              </Text>
            </View>
            <View style={styles.headerActions}>
              {/* Settings button - navigate to full members page */}
              {groupId && channelSlug && (
                <TouchableOpacity
                  onPress={handleSettings}
                  style={styles.headerActionButton}
                  accessibilityLabel="Manage members"
                  accessibilityRole="button"
                >
                  <Ionicons name="settings-outline" size={22} color="#666" />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onClose}
                style={styles.headerActionButton}
                accessibilityLabel="Close members modal"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
          </View>
          {/* Sync button - only show for PCO auto channels */}
          {isPcoAutoChannel && (
            <TouchableOpacity
              onPress={handleSync}
              style={[styles.syncButton, { borderColor: primaryColor }]}
              disabled={isSyncing}
              accessibilityLabel="Sync members from Planning Center"
              accessibilityRole="button"
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : (
                <Ionicons name="sync" size={16} color={primaryColor} />
              )}
              <Text style={[styles.syncButtonText, { color: primaryColor }]}>
                {isSyncing ? "Syncing..." : "Sync from PCO"}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Content */}
        {!membersData ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={styles.loadingText}>Loading members...</Text>
          </View>
        ) : listData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color="#ccc" />
            <Text style={styles.emptyTitle}>No Members</Text>
            <Text style={styles.emptySubtitle}>
              This channel has no members yet.
            </Text>
          </View>
        ) : (
          <FlatList
            data={listData}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "flex-end",
  },
  backdropInner: {
    flex: 1,
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    minHeight: 300,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: "#DDD",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerTitleContainer: {
    flex: 1,
    paddingRight: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#000",
  },
  memberCountText: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  unsyncedCountText: {
    color: "#B25000",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  headerActionButton: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
  },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  syncButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
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
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 4,
  },
  listContent: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    gap: 12,
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E0E0E0",
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#B25000",
    textTransform: "uppercase",
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
  },
  unsyncedItem: {
    backgroundColor: "#FFF8E1",
    marginHorizontal: -16,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 4,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  unsyncedAvatar: {
    backgroundColor: "#FFB74D",
  },
  avatarInitials: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#fff",
  },
  unsyncedInitials: {
    color: "#5D4037",
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
    fontWeight: "500",
    color: "#333",
    flexShrink: 1,
  },
  youBadge: {
    fontSize: 13,
    color: "#888",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "600",
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
  positionBadge: {
    backgroundColor: "#FF980020",
  },
  positionBadgeText: {
    color: "#FF9800",
  },
  unsyncedReason: {
    fontSize: 12,
    color: "#B25000",
    marginTop: 2,
  },
});
