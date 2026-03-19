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
  Modal,
  Pressable,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useQuery, useAction, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";

import { ChannelMember, UnsyncedPerson } from "@/utils/channel-members";
import {
  SyncedMemberRowContent,
  UnsyncedPersonRowContent,
} from "@/components/ui/ChannelMemberRows";

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
  const { colors, isDark } = useTheme();

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

  // Render member item - memoized to prevent FlatList re-renders
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      if (item.type === "section-header") {
        return (
          <View style={styles.sectionHeader}>
            <View style={[styles.sectionHeaderLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.sectionHeaderText, { color: isDark ? '#FFD60A' : '#B25000' }]}>{item.title}</Text>
            <View style={[styles.sectionHeaderLine, { backgroundColor: colors.border }]} />
          </View>
        );
      }

      if (item.type === "unsynced") {
        const person = item.data;

        return (
          <View style={[styles.memberItem, styles.unsyncedItem, { backgroundColor: isDark ? '#332b00' : '#FFF8E1', borderBottomColor: colors.border }]}>
            <UnsyncedPersonRowContent person={person} />
          </View>
        );
      }

      // Synced member
      const member = item.data;
      const isCurrentUser = member.userId === user?.id;

      return (
        <View style={[styles.memberItem, { borderBottomColor: colors.border }]}>
          <SyncedMemberRowContent
            member={member}
            primaryColor={primaryColor}
            isCurrentUser={isCurrentUser}
          />
        </View>
      );
    },
    [user?.id, primaryColor]
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
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
        <View style={styles.backdropInner} />
      </Pressable>

      <View style={[styles.modalContainer, { paddingBottom: insets.bottom + 16, backgroundColor: colors.modalBackground }]}>
        {/* Handle bar */}
        <View style={[styles.handleBar, { backgroundColor: colors.iconSecondary }]} />

        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerTop}>
            <View style={styles.headerTitleContainer}>
              <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                {channelName}
              </Text>
              <Text style={[styles.memberCountText, { color: colors.textSecondary }]}>
                {memberCount} member{memberCount !== 1 ? "s" : ""}
                {unsyncedCount > 0 && (
                  <Text style={[styles.unsyncedCountText, { color: isDark ? '#FFD60A' : '#B25000' }]}>
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
                  <Ionicons name="settings-outline" size={22} color={colors.icon} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onClose}
                style={styles.headerActionButton}
                accessibilityLabel="Close members modal"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={24} color={colors.icon} />
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
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading members...</Text>
          </View>
        ) : listData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={48} color={colors.iconSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Members</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
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
    justifyContent: "flex-end",
  },
  backdropInner: {
    flex: 1,
  },
  modalContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    minHeight: 300,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
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
  },
  memberCountText: {
    fontSize: 14,
    marginTop: 4,
  },
  unsyncedCountText: {
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
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 14,
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
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  unsyncedItem: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 4,
  },
});
