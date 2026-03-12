/**
 * GroupedInboxItem Component
 *
 * Displays a group's channels in the chat inbox.
 * - When a group has 1 channel: Shows a simple row (same as before)
 * - When a group has 2+ channels: Shows group header with indented channel sub-rows
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActionSheetIOS,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useIsDesktopWeb } from "../../../hooks/useIsDesktopWeb";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { AppImage } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { getGroupTypeColorScheme } from "../../../constants/groupTypes";
import type { Id } from "@services/api/convex";
import { useAwaitPrefetch, useTriggerPrefetch } from "../hooks/usePrefetchChannel";

// Type for channel data from getInboxChannels query
interface ChannelData {
  _id: Id<"chatChannels">;
  slug: string;
  channelType: string;
  name: string;
  lastMessagePreview: string | null;
  lastMessageAt: number | null;
  lastMessageSenderName: string | null;
  lastMessageSenderId: Id<"users"> | null;
  unreadCount: number;
  isShared?: boolean;
}

// Type for group data from getInboxChannels query
interface GroupData {
  _id: Id<"groups">;
  name: string;
  preview: string | undefined;
  groupTypeId: Id<"groupTypes">;
  groupTypeName: string | undefined;
  groupTypeSlug: string | undefined;
  isAnnouncementGroup: boolean | undefined;
}

export interface GroupedInboxItemProps {
  group: GroupData;
  channels: ChannelData[];
  userRole: "leader" | "member";
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  activeGroupId?: string;
  activeChannelSlug?: string;
}

// Helper to get badge colors dynamically for any group type ID
function getBadgeColors(typeId: string): { bg: string; text: string } {
  // Convert Convex ID to a numeric hash for color scheme lookup
  // Use a simple hash of the ID string to get a consistent number
  const hash = typeId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  // Use (hash % 10) + 1 to get 1-10, matching ConvexChatRoomScreen behavior
  const scheme = getGroupTypeColorScheme((hash % 10) + 1);
  return { bg: scheme.bg, text: scheme.color };
}

// Format relative time (e.g., "2h", "Yesterday", "Jan 15")
function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();

  if (date.getFullYear() !== now.getFullYear()) {
    return `${month} ${day}, ${date.getFullYear()}`;
  }

  return `${month} ${day}`;
}

function GroupedInboxItemInner({
  group,
  channels,
  userRole,
  isExpanded = false,
  onToggleExpand,
  activeGroupId,
  activeChannelSlug,
}: GroupedInboxItemProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const isDesktopWeb = useIsDesktopWeb();
  const userId = user?.id as Id<"users"> | undefined;
  const isLeader = userRole === "leader";
  const badgeColors = getBadgeColors(group.groupTypeId);
  const isActiveGroup = activeGroupId === group._id;

  // Get the prefetch functions
  const awaitPrefetch = useAwaitPrefetch();
  const triggerPrefetch = useTriggerPrefetch();

  // Track which channel is currently loading (for showing spinner on tap)
  const [loadingChannelId, setLoadingChannelId] = useState<string | null>(null);

  // Check if this is a simple (single channel) or grouped (multiple channels) display
  const isSingleChannel = channels.length === 1;

  // Navigate to a specific channel using URL-based slug routing
  // Waits for prefetch to complete before navigating (like iMessage)
  const handleChannelPress = useCallback(
    async (channel: ChannelData) => {
      // Guard against double-tap: if already loading, ignore
      if (loadingChannelId) return;

      // Show loading indicator on this item
      setLoadingChannelId(channel._id);

      try {
        // Wait for prefetch to complete (with 3000ms timeout)
        // This ensures ALL data is ready before navigation
        await awaitPrefetch(channel._id, 3000);

        // Use the channel's slug directly for navigation
        // Slugs: "general" (main channel), "leaders" (leaders channel), or custom slug
        const navArgs = {
          pathname: `/inbox/${group._id}/${channel.slug}` as any,
          params: {
            groupName: group.name,
            groupType: group.groupTypeName || "",
            groupTypeId: group.groupTypeId,
            imageUrl: group.preview || "",
            isLeader: isLeader ? "1" : "0",
            isAnnouncementGroup: group.isAnnouncementGroup ? "1" : "0",
            // Pass channelId directly so prefetched data can be used immediately
            channelId: channel._id,
          },
        };
        // On desktop web, replace to avoid deep navigation stack buildup in the right panel
        if (isDesktopWeb) {
          router.replace(navArgs);
        } else {
          router.push(navArgs);
        }

        // Smart prefetch: After navigating, prefetch sibling channels in the background
        // This makes switching between channels in the same group instant
        const siblingChannels = channels.filter((c) => c._id !== channel._id);
        for (const sibling of siblingChannels) {
          triggerPrefetch(sibling._id);
        }
      } finally {
        // Clear loading state after navigation (or if it fails)
        setLoadingChannelId(null);
      }
    },
    [router, group, isLeader, awaitPrefetch, triggerPrefetch, channels, loadingChannelId, isDesktopWeb]
  );

  // Format message preview with sender prefix
  const getMessagePreview = useCallback(
    (channel: ChannelData) => {
      if (!channel.lastMessagePreview) {
        return "No messages yet";
      }

      const isOwnMessage = userId && channel.lastMessageSenderId === userId;
      const senderPrefix = isOwnMessage ? "Me" : channel.lastMessageSenderName;
      if (senderPrefix) {
        return `${senderPrefix}: ${channel.lastMessagePreview}`;
      }
      return channel.lastMessagePreview;
    },
    [userId]
  );

  // Calculate total unread count for the group
  const totalUnread = useMemo(
    () => channels.reduce((sum, ch) => sum + ch.unreadCount, 0),
    [channels]
  );

  // Check if this group has multiple channels (can be expanded)
  const canExpand = channels.length > 1;

  // Handle long press to show expand/collapse action sheet
  const handleLongPress = useCallback(() => {
    if (!canExpand || !onToggleExpand) {
      return;
    }

    const actionLabel = isExpanded ? "Collapse" : "Expand";

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", actionLabel],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            onToggleExpand();
          }
        }
      );
    } else {
      // Android: Use Alert with buttons
      Alert.alert(
        "Channel Options",
        "",
        [
          { text: "Cancel", style: "cancel" },
          { text: actionLabel, onPress: onToggleExpand },
        ]
      );
    }
  }, [canExpand, isExpanded, onToggleExpand]);

  // Handle right-click for web (since long press doesn't work well on web)
  const handleContextMenu = useCallback(
    (e: any) => {
      if (Platform.OS !== "web" || !canExpand || !onToggleExpand) {
        return;
      }
      // Prevent default browser context menu
      e.preventDefault?.();
      // Toggle expansion directly on right-click (simpler UX for web)
      onToggleExpand();
    },
    [canExpand, onToggleExpand]
  );

  // Get the most recent channel for single-channel display
  const primaryChannel = channels[0];

  // Single channel display - simple row (same layout as original ChatInboxScreen)
  if (isSingleChannel && primaryChannel) {
    const hasUnread = primaryChannel.unreadCount > 0;
    const isActive = isActiveGroup && activeChannelSlug === primaryChannel.slug;

    return (
      <Pressable
        onPress={() => handleChannelPress(primaryChannel)}
        style={({ pressed }) => [
          styles.groupItem,
          hasUnread && styles.groupItemUnread,
          pressed && styles.groupItemPressed,
          isActive && styles.groupItemActive,
        ]}
      >
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          <AppImage
            source={group.preview}
            style={styles.avatarImage}
            optimizedWidth={150}
            placeholder={{
              type: "initials",
              name: group.name,
              backgroundColor: "#E5E5E5",
            }}
          />
          {isLeader && (
            <View style={[styles.leaderBadge, { backgroundColor: primaryColor }]}>
              <Ionicons name="shield" size={12} color="#fff" />
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.groupContent}>
          {/* Top row: Name + Badge */}
          <View style={styles.topRow}>
            <Text style={[styles.groupName, hasUnread && styles.groupNameUnread]} numberOfLines={1}>
              {group.name}
            </Text>
            {primaryChannel.isShared && (
              <Ionicons name="link" size={14} color="#8B5CF6" style={styles.sharedIcon} />
            )}
            <View style={[styles.badge, { backgroundColor: badgeColors.bg }]}>
              <Text style={[styles.badgeText, { color: badgeColors.text }]}>
                {group.groupTypeName}
              </Text>
            </View>
          </View>

          {/* Bottom row: Last message preview */}
          <View style={styles.bottomRow}>
            <Text
              style={[styles.lastMessage, hasUnread && styles.lastMessageUnread]}
              numberOfLines={1}
            >
              {getMessagePreview(primaryChannel)}
            </Text>
            {primaryChannel.lastMessageAt && (
              <Text style={[styles.timestamp, hasUnread && styles.timestampUnread]}>
                {formatRelativeTime(primaryChannel.lastMessageAt)}
              </Text>
            )}
          </View>
        </View>

        {/* Loading or Unread indicator */}
        {loadingChannelId === primaryChannel._id ? (
          <ActivityIndicator size="small" color={primaryColor} style={styles.loadingIndicator} />
        ) : hasUnread ? (
          <View style={[styles.unreadBadgeCount, { backgroundColor: primaryColor }]}>
            <Text style={styles.unreadBadgeCountText}>
              {primaryChannel.unreadCount > 99 ? "99+" : primaryChannel.unreadCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  // Multiple channels display - main channel as full card, sub-channels below with L-connector
  // Find the main channel and secondary channels (only show secondary if unread)
  const mainChannel = channels.find((ch) => ch.channelType === "main") || channels[0];

  // Guard against empty channels array (shouldn't happen, but be safe)
  if (!mainChannel) {
    return null;
  }

  // Show secondary channels if expanded OR if they have unread messages
  const secondaryChannels = channels.filter(
    (ch) => ch._id !== mainChannel._id && (isExpanded || ch.unreadCount > 0)
  );
  const mainHasUnread = mainChannel.unreadCount > 0;

  return (
    <View style={styles.groupedContainer}>
      {/* Main channel - renders like a full single-channel card */}
      <Pressable
        onPress={() => handleChannelPress(mainChannel)}
        onLongPress={handleLongPress}
        delayLongPress={300}
        // @ts-expect-error - onContextMenu is a web-only prop
        onContextMenu={handleContextMenu}
        style={({ pressed }) => [
          styles.groupItem,
          (mainHasUnread || totalUnread > 0) && styles.groupItemUnread,
          pressed && styles.groupItemPressed,
          isActiveGroup && activeChannelSlug === mainChannel.slug && styles.groupItemActive,
        ]}
      >
        {/* Avatar */}
        <View style={styles.avatarContainer}>
          <AppImage
            source={group.preview}
            style={styles.avatarImage}
            optimizedWidth={150}
            placeholder={{
              type: "initials",
              name: group.name,
              backgroundColor: "#E5E5E5",
            }}
          />
          {isLeader && (
            <View style={[styles.leaderBadge, { backgroundColor: primaryColor }]}>
              <Ionicons name="shield" size={12} color="#fff" />
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.groupContent}>
          {/* Top row: Name + Badge */}
          <View style={styles.topRow}>
            <Text style={[styles.groupName, (mainHasUnread || totalUnread > 0) && styles.groupNameUnread]} numberOfLines={1}>
              {group.name}
            </Text>
            <View style={[styles.badge, { backgroundColor: badgeColors.bg }]}>
              <Text style={[styles.badgeText, { color: badgeColors.text }]}>
                {group.groupTypeName}
              </Text>
            </View>
          </View>

          {/* Bottom row: Last message preview */}
          <View style={styles.bottomRow}>
            <Text
              style={[styles.lastMessage, mainHasUnread && styles.lastMessageUnread]}
              numberOfLines={1}
            >
              {getMessagePreview(mainChannel)}
            </Text>
            {mainChannel.lastMessageAt && (
              <Text style={[styles.timestamp, mainHasUnread && styles.timestampUnread]}>
                {formatRelativeTime(mainChannel.lastMessageAt)}
              </Text>
            )}
          </View>
        </View>

        {/* Loading or Unread indicator */}
        {loadingChannelId === mainChannel._id ? (
          <ActivityIndicator size="small" color={primaryColor} style={styles.loadingIndicator} />
        ) : totalUnread > 0 ? (
          <View style={[styles.unreadBadgeCount, { backgroundColor: primaryColor }]}>
            <Text style={styles.unreadBadgeCountText}>
              {totalUnread > 99 ? "99+" : totalUnread}
            </Text>
          </View>
        ) : null}
      </Pressable>

      {/* Secondary channels with L-connector */}
      {secondaryChannels.map((channel) => {
        const hasUnread = channel.unreadCount > 0;

        return (
          <View key={channel._id} style={styles.subChannelContainer}>
            {/* L-shaped connector */}
            <View style={styles.connectorContainer}>
              <View style={styles.connectorVertical} />
              <View style={styles.connectorHorizontal} />
            </View>

            {/* Sub-channel card */}
            <Pressable
              onPress={() => handleChannelPress(channel)}
              style={({ pressed }) => [
                styles.subChannelCard,
                hasUnread && styles.subChannelCardUnread,
                pressed && styles.subChannelCardPressed,
                isActiveGroup && activeChannelSlug === channel.slug && styles.subChannelCardActive,
              ]}
            >
              {channel.isShared && (
                <Ionicons name="link" size={12} color="#8B5CF6" style={styles.subChannelSharedIcon} />
              )}
              <Text style={[styles.subChannelName, hasUnread && styles.subChannelNameUnread]}>{channel.name}</Text>
              <Text
                style={[styles.subChannelPreview, hasUnread && styles.subChannelPreviewUnread]}
                numberOfLines={1}
              >
                {getMessagePreview(channel)}
              </Text>
              {channel.lastMessageAt && (
                <Text style={[styles.subChannelTimestamp, hasUnread && styles.subChannelTimestampUnread]}>
                  {formatRelativeTime(channel.lastMessageAt)}
                </Text>
              )}
              {loadingChannelId === channel._id ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : hasUnread ? (
                <View style={[styles.subChannelUnreadBadge, { backgroundColor: primaryColor }]}>
                  <Text style={styles.subChannelUnreadBadgeText}>
                    {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

export const GroupedInboxItem = React.memo(GroupedInboxItemInner);

const styles = StyleSheet.create({
  // Single channel styles (same as original)
  groupItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  groupItemUnread: {
    backgroundColor: "#F0F7FF",
  },
  groupItemPressed: {
    backgroundColor: "#F5F5F5",
  },
  groupItemActive: {
    backgroundColor: "#F0F0F0",
  },
  avatarContainer: {
    position: "relative",
    marginRight: 12,
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  leaderBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  groupContent: {
    flex: 1,
    justifyContent: "center",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  groupName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
    flex: 1,
    marginRight: 8,
  },
  groupNameUnread: {
    fontWeight: "700",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  lastMessage: {
    fontSize: 14,
    color: "#666",
    flex: 1,
    marginRight: 8,
  },
  lastMessageUnread: {
    fontWeight: "600",
    color: "#000",
  },
  timestamp: {
    fontSize: 12,
    color: "#999",
  },
  timestampUnread: {
    color: "#007AFF",
    fontWeight: "600",
  },
  unreadBadgeCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadBadgeCountText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  loadingIndicator: {
    marginLeft: 8,
  },

  // Grouped styles (multiple channels)
  groupedContainer: {
    backgroundColor: "#fff",
  },
  groupedRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  groupedContent: {
    flex: 1,
  },
  groupHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  groupHeaderName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
    marginRight: 8,
    flexShrink: 1,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },

  // Channel row styles - directly under title with breathing room
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  channelRowPressed: {
    backgroundColor: "#F5F5F5",
  },
  channelText: {
    flex: 1,
    fontSize: 13,
    color: "#666",
  },
  channelTextUnread: {
    color: "#333",
  },
  channelName: {
    fontWeight: "500",
    color: "#444",
  },
  channelSeparator: {
    color: "#999",
  },
  channelPreview: {
    color: "#666",
  },
  channelTimestamp: {
    fontSize: 11,
    color: "#999",
    marginLeft: 6,
  },
  channelUnreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
  },

  // Sub-channel styles (hierarchical display with L-connector)
  subChannelContainer: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingLeft: 16,
  },
  connectorContainer: {
    width: 40,
    alignItems: "flex-start",
    paddingTop: 0,
  },
  connectorVertical: {
    position: "absolute",
    left: 28,
    top: 0,
    width: 1.5,
    height: 20,
    backgroundColor: "#D1D5DB",
  },
  connectorHorizontal: {
    position: "absolute",
    left: 28,
    top: 20,
    width: 12,
    height: 1.5,
    backgroundColor: "#D1D5DB",
  },
  subChannelCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 16,
    marginBottom: 8,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "transparent",
  },
  subChannelCardUnread: {
    backgroundColor: "#EBF3FF",
    borderColor: "#D0E2FF",
  },
  subChannelCardPressed: {
    backgroundColor: "#E8E8E8",
  },
  subChannelCardActive: {
    backgroundColor: "#E8E8E8",
  },
  subChannelName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginRight: 8,
  },
  subChannelNameUnread: {
    fontWeight: "700",
    color: "#1F2937",
  },
  subChannelPreview: {
    flex: 1,
    fontSize: 13,
    color: "#6B7280",
  },
  subChannelPreviewUnread: {
    fontWeight: "500",
    color: "#374151",
  },
  subChannelTimestamp: {
    fontSize: 11,
    color: "#9CA3AF",
    marginLeft: 8,
  },
  subChannelTimestampUnread: {
    color: "#007AFF",
    fontWeight: "600",
  },
  subChannelUnreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 5,
    marginLeft: 8,
  },
  subChannelUnreadBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },

  // Shared channel icon styles
  sharedIcon: {
    marginRight: 6,
  },
  subChannelSharedIcon: {
    marginRight: 4,
  },
});
