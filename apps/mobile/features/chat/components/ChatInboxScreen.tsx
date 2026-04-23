/**
 * Chat Inbox Screen using Convex messaging
 *
 * Lists all user's groups with their channels, using grouped display.
 * Shows channels grouped by group - single channels show simple row,
 * multiple channels (e.g., main + leaders) show group header with indented channel rows.
 *
 * In addition, collects event-channels (channelType === "event") across all
 * groups into a dedicated "Events" section pinned to the top of the list.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  ScrollView,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, api, useStoredAuthToken } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { AppImage } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { GroupedInboxItem } from "./GroupedInboxItem";
import { useExpandedGroups } from "../hooks/useExpandedGroups";
import { useInboxCache } from "../../../stores/inboxCache";

/**
 * How long after an event's scheduledAt AND lastMessageAt before the channel
 * is hidden from the inbox. Kept in sync with the backend source of truth at
 * `apps/convex/functions/messaging/eventChat.ts` (exported as HIDE_AFTER_MS).
 * Duplicated here (rather than imported across the mobile/convex package
 * boundary) so the mobile bundle doesn't pull in convex server code. If you
 * change one, change the other.
 */
const HIDE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

// Type for a channel as returned by getInboxChannels
type InboxChannel = {
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
  isEnabled?: boolean;
  meetingId?: Id<"meetings">;
  meetingScheduledAt?: number | null;
  /**
   * For event channels, the owning meeting's shortId. Used by event rows in
   * the inbox to navigate to `/e/{shortId}` (event page with inline Activity)
   * rather than the legacy standalone chat room.
   */
  meetingShortId?: string | null;
  /**
   * For event channels, the owning meeting's cover image URL. The row
   * renders this as the avatar so events look distinct from group channels.
   */
  meetingCoverImage?: string | null;
};

// Type for the grouped inbox data from getInboxChannels query
type InboxGroup = {
  group: {
    _id: Id<"groups">;
    name: string;
    preview: string | undefined;
    groupTypeId: Id<"groupTypes">;
    groupTypeName: string | undefined;
    groupTypeSlug: string | undefined;
    isAnnouncementGroup: boolean | undefined;
  };
  channels: InboxChannel[];
  userRole: "leader" | "member";
};

// An event row combines the channel with its owning group (for avatar + nav)
type EventInboxRow = {
  channel: InboxChannel;
  group: InboxGroup["group"];
  userRole: "leader" | "member";
};

interface ChatInboxScreenProps {
  sidebarMode?: boolean;
  activeGroupId?: string;
  activeChannelSlug?: string;
}

export function ChatInboxScreen({
  sidebarMode,
  activeGroupId,
  activeChannelSlug,
}: ChatInboxScreenProps = {}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { user, community } = useAuth();
  const token = useStoredAuthToken();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const hasCommunity = !!community?.id;
  const { isGroupExpanded, toggleGroupExpanded } = useExpandedGroups();
  const { getInboxChannels, setInboxChannels } = useInboxCache();
  const hasAutoSelected = useRef(false);

  // Get Convex IDs from auth context
  const userId = user?.id as Id<"users"> | undefined;
  const communityId = community?.id as Id<"communities"> | undefined;

  // Debug logging for chat loading issues (dev only)
  if (__DEV__) {
    console.log("[ChatInboxScreen] Auth state:", {
      hasUser: !!user,
      userId,
      hasCommunity: !!community,
      communityId,
      hasToken: !!token,
      tokenPreview: token ? `${token.substring(0, 20)}...` : null,
    });
  }

  // Fetch inbox channels using the new grouped query
  const inboxQueryArgs = useMemo(() => {
    if (!userId || !communityId || !token) {
      return "skip" as const;
    }
    return { token, communityId };
  }, [userId, communityId, token]);

  const inboxChannels = useQuery(
    api.functions.messaging.channels.getInboxChannels,
    inboxQueryArgs
  );

  // Cache inbox data for offline use
  useEffect(() => {
    if (inboxChannels && inboxChannels.length > 0 && communityId) {
      setInboxChannels(communityId, inboxChannels);
    }
  }, [inboxChannels, communityId, setInboxChannels]);

  // Render a single grouped inbox item
  const renderItem = useCallback(
    ({ item }: { item: InboxGroup }) => (
      <GroupedInboxItem
        group={item.group}
        channels={item.channels}
        userRole={item.userRole}
        isExpanded={isGroupExpanded(item.group._id)}
        onToggleExpand={() => toggleGroupExpanded(item.group._id)}
        activeGroupId={sidebarMode ? activeGroupId : undefined}
        activeChannelSlug={sidebarMode ? activeChannelSlug : undefined}
      />
    ),
    [isGroupExpanded, toggleGroupExpanded, sidebarMode, activeGroupId, activeChannelSlug]
  );

  // Key extractor for FlatList
  const keyExtractor = useCallback(
    (item: InboxGroup) => item.group._id,
    []
  );

  const Wrapper = React.Fragment;
  const headerPaddingTop = sidebarMode ? 16 : insets.top + 16;

  // Auto-select first conversation when in sidebar mode and no conversation is active
  useEffect(() => {
    if (!sidebarMode || hasAutoSelected.current) return;
    if (!inboxChannels || inboxChannels.length === 0) return;
    // Only auto-select if we're on the bare /inbox/ route
    if (pathname !== "/inbox" && pathname !== "/inbox/") return;

    const firstGroup = inboxChannels[0];
    const firstChannel = firstGroup.channels[0];
    if (!firstGroup || !firstChannel) return;

    hasAutoSelected.current = true;
    router.replace({
      pathname: `/inbox/${firstGroup.group._id}/${firstChannel.slug}` as any,
      params: {
        groupName: firstGroup.group.name,
        groupType: firstGroup.group.groupTypeName || "",
        groupTypeId: firstGroup.group.groupTypeId,
        imageUrl: firstGroup.group.preview || "",
        isLeader: firstGroup.userRole === "leader" ? "1" : "0",
        isAnnouncementGroup: firstGroup.group.isAnnouncementGroup ? "1" : "0",
        channelId: firstChannel._id,
      },
    });
  }, [sidebarMode, inboxChannels, pathname, router]);

  // Resolve which channels we'll actually render. Use stale cached data while
  // the live query is loading (stale-while-revalidate).
  const isLoading = inboxChannels === undefined;
  let displayChannels: InboxGroup[] | undefined = inboxChannels as
    | InboxGroup[]
    | undefined;
  let isStale = false;
  if (isLoading && communityId) {
    const cached = getInboxChannels(communityId) as InboxGroup[] | undefined;
    if (cached && cached.length > 0) {
      displayChannels = cached;
      isStale = true;
    }
  }

  // Partition inbox channels into a flat "Events" list and the normal groups
  // list. This must run before any early returns to keep hook order stable.
  const now = Date.now();
  const { eventRows, groupsForList } = useMemo(() => {
    const eventRowsAcc: EventInboxRow[] = [];
    const groupsAcc: InboxGroup[] = [];

    if (!displayChannels) {
      return { eventRows: eventRowsAcc, groupsForList: groupsAcc };
    }

    for (const g of displayChannels) {
      const nonEventChannels: InboxChannel[] = [];
      for (const ch of g.channels) {
        // Hide disabled channels entirely (no muted label — keeps the inbox clean).
        if (ch.isEnabled === false) continue;

        if (ch.channelType === "event") {
          // Hide stale event channels: both the event is >2d past AND the chat
          // has been quiet for >2d. A new message bumps lastMessageAt and the
          // row reappears automatically.
          const scheduledAt = ch.meetingScheduledAt ?? 0;
          const lastMessageAt = ch.lastMessageAt ?? 0;
          const eventIsStale = scheduledAt + HIDE_AFTER_MS < now;
          const chatIsStale = lastMessageAt + HIDE_AFTER_MS < now;
          if (eventIsStale && chatIsStale) continue;

          eventRowsAcc.push({
            channel: ch,
            group: g.group,
            userRole: g.userRole,
          });
        } else {
          nonEventChannels.push(ch);
        }
      }

      if (nonEventChannels.length > 0) {
        groupsAcc.push({ ...g, channels: nonEventChannels });
      }
    }

    // Sort events by lastMessageAt desc; if neither side has a last message,
    // fall back to meeting scheduledAt; no-data rows sink to the bottom.
    eventRowsAcc.sort((a, b) => {
      const aTime =
        a.channel.lastMessageAt ?? a.channel.meetingScheduledAt ?? 0;
      const bTime =
        b.channel.lastMessageAt ?? b.channel.meetingScheduledAt ?? 0;
      return bTime - aTime;
    });

    return { eventRows: eventRowsAcc, groupsForList: groupsAcc };
  }, [displayChannels, now]);

  // Show message when user has no community context
  if (!hasCommunity) {
    return (
      <Wrapper>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
          </View>
          <View style={styles.centered}>
            <Ionicons
              name="chatbubbles-outline"
              size={48}
              color={colors.iconSecondary}
              style={{ marginBottom: 16 }}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Community Selected</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Join a community to access group chats
            </Text>
          </View>
        </View>
      </Wrapper>
    );
  }

  const showLoadingSpinner = isLoading && !isStale;

  if (showLoadingSpinner) {
    return (
      <Wrapper>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
          </View>
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading your chats...</Text>
          </View>
        </View>
      </Wrapper>
    );
  }

  const hasAnyContent = eventRows.length > 0 || groupsForList.length > 0;

  if (!hasAnyContent) {
    return (
      <Wrapper>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
          </View>
          <ScrollView contentContainerStyle={styles.centeredScrollContent}>
            <Ionicons
              name="chatbubbles-outline"
              size={48}
              color={colors.iconSecondary}
              style={{ marginBottom: 16 }}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Groups Yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
              Join a group to start chatting
            </Text>
          </ScrollView>
        </View>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
        </View>
        <FlatList
          data={groupsForList}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContainer}
          style={styles.list}
          ListHeaderComponent={
            eventRows.length > 0 ? (
              <EventsSection
                rows={eventRows}
                activeChannelSlug={sidebarMode ? activeChannelSlug : undefined}
              />
            ) : null
          }
        />
      </View>
    </Wrapper>
  );
}

// ============================================================================
// Events section
// ============================================================================

interface EventsSectionProps {
  rows: EventInboxRow[];
  activeChannelSlug?: string;
}

function EventsSection({ rows, activeChannelSlug }: EventsSectionProps) {
  // No section header — event rows sit alongside group rows, differentiated by
  // the small calendar badge on the avatar. A header made everything above it
  // look generically "event-y" and confused the mix with group rows below.
  return (
    <View>
      {rows.map((row) => (
        <EventInboxRowItem
          key={row.channel._id}
          row={row}
          isActive={activeChannelSlug === row.channel.slug}
        />
      ))}
    </View>
  );
}

interface EventInboxRowItemProps {
  row: EventInboxRow;
  isActive: boolean;
}

function EventInboxRowItem({ row, isActive }: EventInboxRowItemProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const userId = user?.id as Id<"users"> | undefined;

  const { channel, group, userRole } = row;
  const hasUnread = channel.unreadCount > 0;

  // Event rows route to the event page with inline Activity (Partiful-style).
  // The `/inbox/{groupId}/event-{slug}` standalone room was removed — chat
  // now lives on `/e/{shortId}`. If a channel somehow lacks meetingShortId
  // (legacy data), fall back to the old route so the row still opens.
  const handlePress = useCallback(() => {
    if (channel.meetingShortId) {
      router.push(`/e/${channel.meetingShortId}?source=app` as any);
      return;
    }
    router.push({
      pathname: `/inbox/${group._id}/${channel.slug}` as any,
      params: {
        groupName: group.name,
        groupType: group.groupTypeName || "",
        groupTypeId: group.groupTypeId,
        imageUrl: group.preview || "",
        isLeader: userRole === "leader" ? "1" : "0",
        isAnnouncementGroup: group.isAnnouncementGroup ? "1" : "0",
        channelId: channel._id,
      },
    });
  }, [router, group, channel, userRole]);

  const messagePreview = (() => {
    if (!channel.lastMessagePreview) return "No messages yet";
    const isOwn = userId && channel.lastMessageSenderId === userId;
    const prefix = isOwn ? "Me" : channel.lastMessageSenderName;
    return prefix ? `${prefix}: ${channel.lastMessagePreview}` : channel.lastMessagePreview;
  })();

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.eventRow,
        { backgroundColor: colors.surface },
        hasUnread && { backgroundColor: isDark ? colors.surfaceSecondary : "#F0F7FF" },
        pressed && { backgroundColor: colors.surfaceSecondary },
        isActive && { backgroundColor: colors.surfaceSecondary },
      ]}
    >
      <View style={styles.eventAvatarContainer}>
        <AppImage
          source={channel.meetingCoverImage || group.preview}
          style={styles.eventAvatarImage}
          optimizedWidth={150}
          placeholder={{
            type: "initials",
            name: channel.name,
            backgroundColor: isDark ? "#333" : "#E5E5E5",
          }}
        />
        {/* Small calendar badge differentiates event rows from group rows
            now that the Events section header is gone. */}
        <View
          style={[
            styles.eventIconBadge,
            { backgroundColor: primaryColor, borderColor: colors.surface },
          ]}
        >
          <Ionicons name="calendar" size={12} color="#fff" />
        </View>
      </View>

      <View style={styles.eventContent}>
        <View style={styles.eventTopRow}>
          <Text
            style={[
              styles.eventName,
              { color: colors.text },
              hasUnread && styles.eventNameUnread,
            ]}
            numberOfLines={1}
          >
            {group.name}: {channel.name}
          </Text>
        </View>
        <View style={styles.eventBottomRow}>
          <Text
            style={[
              styles.eventPreview,
              { color: colors.textSecondary },
              hasUnread && { fontWeight: "600", color: colors.text },
            ]}
            numberOfLines={1}
          >
            {messagePreview}
          </Text>
        </View>
      </View>

      {hasUnread ? (
        <View style={[styles.eventUnreadBadge, { backgroundColor: primaryColor }]}>
          <Text style={styles.eventUnreadBadgeText}>
            {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  centeredScrollContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 16,
    textAlign: "center",
  },
  list: {
    flex: 1,
  },
  listContainer: {
    paddingVertical: 8,
  },

  // Events section
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  eventAvatarContainer: {
    position: "relative",
    marginRight: 12,
  },
  eventAvatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  eventIconBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
  },
  eventContent: {
    flex: 1,
    justifyContent: "center",
  },
  eventTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  eventName: {
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
    marginRight: 8,
  },
  eventNameUnread: {
    fontWeight: "700",
  },
  eventPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  eventPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  eventBottomRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  eventPreview: {
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  eventUnreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  eventUnreadBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
