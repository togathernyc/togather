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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  ScrollView,
  Pressable,
  Linking,
  Platform,
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

// Inbox event visibility is now driven server-side by
// `INBOX_EVENT_HIDE_AFTER_MS` in apps/convex/functions/messaging/channels.ts
// (channels without a first message or quiet for >2 days are omitted from
// the payload), so the client no longer duplicates that constant.

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
  /**
   * For event channels, the meeting's free-form location (address or place
   * name). Drives the Maps shortcut on the row.
   */
  meetingLocation?: string | null;
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

  // Inbox list entries are either a grouped item (group + its channels) or a
  // standalone event row. They're interleaved so activity, not type, drives
  // recency — a group with a fresh message sits above an event with a
  // week-old one (and vice versa). Announcement group stays pinned on top.
  type InboxListItem =
    | { kind: "group"; item: InboxGroup }
    | { kind: "event"; item: EventInboxRow };

  // Render a single inbox row (group or event)
  const renderItem = useCallback(
    ({ item }: { item: InboxListItem }) => {
      if (item.kind === "event") {
        return (
          <EventInboxRowItem
            row={item.item}
            isActive={Boolean(
              sidebarMode && activeChannelSlug === item.item.channel.slug,
            )}
          />
        );
      }
      return (
        <GroupedInboxItem
          group={item.item.group}
          channels={item.item.channels}
          userRole={item.item.userRole}
          isExpanded={isGroupExpanded(item.item.group._id)}
          onToggleExpand={() => toggleGroupExpanded(item.item.group._id)}
          activeGroupId={sidebarMode ? activeGroupId : undefined}
          activeChannelSlug={sidebarMode ? activeChannelSlug : undefined}
        />
      );
    },
    [isGroupExpanded, toggleGroupExpanded, sidebarMode, activeGroupId, activeChannelSlug]
  );

  // Key extractor for FlatList
  const keyExtractor = useCallback((item: InboxListItem) => {
    return item.kind === "event"
      ? `event:${item.item.channel._id}`
      : `group:${item.item.group._id}`;
  }, []);

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

  // Interleave group and event rows by recency. Server already hides event
  // channels without a first message and those quiet for >2 days (see
  // INBOX_EVENT_HIDE_AFTER_MS in channels.ts), so the client just splits the
  // events off their owning-group entries and drops them back into the list
  // sorted by lastMessageAt. Announcement group stays pinned on top.
  const listItems = useMemo<InboxListItem[]>(() => {
    if (!displayChannels) return [];

    const groupItems: InboxListItem[] = [];
    const eventItems: InboxListItem[] = [];

    for (const g of displayChannels) {
      const nonEventChannels: InboxChannel[] = [];
      for (const ch of g.channels) {
        // Hide disabled channels entirely (no muted label — keeps the inbox clean).
        if (ch.isEnabled === false) continue;

        if (ch.channelType === "event") {
          eventItems.push({
            kind: "event",
            item: { channel: ch, group: g.group, userRole: g.userRole },
          });
        } else {
          nonEventChannels.push(ch);
        }
      }

      if (nonEventChannels.length > 0) {
        groupItems.push({
          kind: "group",
          item: { ...g, channels: nonEventChannels },
        });
      }
    }

    const effectiveTime = (entry: InboxListItem): number => {
      if (entry.kind === "event") {
        return (
          entry.item.channel.lastMessageAt ??
          entry.item.channel.meetingScheduledAt ??
          0
        );
      }
      return Math.max(
        0,
        ...entry.item.channels.map((c) => c.lastMessageAt ?? 0),
      );
    };

    const combined = [...groupItems, ...eventItems];
    combined.sort((a, b) => {
      // Announcement groups anchor the top regardless of activity.
      const aAnnouncement =
        a.kind === "group" && a.item.group.isAnnouncementGroup;
      const bAnnouncement =
        b.kind === "group" && b.item.group.isAnnouncementGroup;
      if (aAnnouncement && !bAnnouncement) return -1;
      if (!aAnnouncement && bAnnouncement) return 1;

      // Otherwise newest activity wins. Ties fall through to a stable order.
      return effectiveTime(b) - effectiveTime(a);
    });

    return combined;
  }, [displayChannels]);
  const hasInboxItems = listItems.length > 0;

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

  if (!hasInboxItems) {
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
          data={listItems}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContainer}
          style={styles.list}
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

/**
 * Imminence tiers drive the row's visual treatment (accent bar color, tag
 * pill visibility, muted styling). Kept as a small enum so the styling logic
 * below can switch on it without re-deriving from raw ms deltas.
 */
type EventUrgency =
  | "live" // scheduled start is within +/- 5 min, or event is in-progress
  | "imminent" // starts in < 60 min
  | "today" // same calendar day, > 60 min away
  | "soon" // within 7 days
  | "later" // more than 7 days away
  | "past"; // scheduledAt has passed (and we're still in the 2-day grace window)

/**
 * Format the event's scheduled time for the inbox row.
 *   - `when`: short absolute — "Today 5:30 PM", "Tomorrow 5:30 PM",
 *     "Sat 5:30 PM" (this week), "Apr 28 5:30 PM" (same year), or
 *     "Apr 28, 2026" (other year).
 *   - `relative`: compact hint like "in 28 min", "in 3h", "2d ago". Undefined
 *     when the absolute label is already precise enough (>14 days out/past).
 *   - `urgency`: tier used by the row to pick its visual treatment.
 */
function formatEventWhen(
  scheduledAt: number,
  now: number,
): { when: string; relative?: string; urgency: EventUrgency } {
  const diffMs = scheduledAt - now;
  const diffMin = Math.round(diffMs / 60_000);
  const diffHour = Math.round(diffMs / 3_600_000);
  const diffDay = Math.round(diffMs / 86_400_000);

  const scheduled = new Date(scheduledAt);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfScheduled = new Date(
    scheduled.getFullYear(),
    scheduled.getMonth(),
    scheduled.getDate(),
  ).getTime();
  const dayDelta = Math.round((startOfScheduled - startOfToday) / 86_400_000);

  const timeStr = scheduled.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  let when: string;
  if (dayDelta === 0) when = `Today ${timeStr}`;
  else if (dayDelta === 1) when = `Tomorrow ${timeStr}`;
  else if (dayDelta === -1) when = `Yesterday ${timeStr}`;
  else if (dayDelta > 1 && dayDelta < 7) {
    when = `${scheduled.toLocaleDateString(undefined, { weekday: "short" })} ${timeStr}`;
  } else if (scheduled.getFullYear() === today.getFullYear()) {
    when = `${scheduled.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${timeStr}`;
  } else {
    when = scheduled.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  // Relative — only when the absolute phrasing doesn't already convey it.
  let relative: string | undefined;
  if (Math.abs(diffMin) < 5) relative = undefined; // "Live" takes over the slot
  else if (diffMin > 0 && diffMin < 60) relative = `in ${diffMin} min`;
  else if (diffMin < 0 && diffMin > -60) relative = `${-diffMin} min ago`;
  else if (diffHour > 0 && diffHour < 24) relative = `in ${diffHour}h`;
  else if (diffHour < 0 && diffHour > -24) relative = `${-diffHour}h ago`;
  else if (diffDay > 1 && diffDay <= 14) relative = `in ${diffDay}d`;
  else if (diffDay < -1 && diffDay >= -14) relative = `${-diffDay}d ago`;

  // Urgency — broad buckets chosen so the row's styling stays stable for at
  // least a few minutes at a time (no flashing as the clock ticks).
  let urgency: EventUrgency;
  if (Math.abs(diffMin) < 5) urgency = "live";
  else if (diffMin > 0 && diffMin < 60) urgency = "imminent";
  else if (dayDelta === 0) urgency = "today";
  else if (diffMs < 0) urgency = "past";
  else if (diffDay >= 0 && diffDay <= 7) urgency = "soon";
  else urgency = "later";

  return { when, relative, urgency };
}

function openMapsForLocation(location: string) {
  const q = encodeURIComponent(location);
  const url =
    Platform.OS === "ios"
      ? `http://maps.apple.com/?q=${q}`
      : `https://maps.google.com/?q=${q}`;
  Linking.openURL(url).catch(() => {
    // Fallback to Google Maps web if the native handler refuses.
    Linking.openURL(`https://maps.google.com/?q=${q}`);
  });
}

/**
 * Compress a free-form address into something that fits on the meta line.
 * e.g. "123 Main St, Springfield, IL 62701, USA" -> "123 Main St, Springfield".
 * The event page shows the full address; this is just a scanning aid.
 */
function shortLocation(loc: string): string {
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return loc.trim();
  return `${parts[0]}, ${parts[1]}`;
}

interface DirectionsButtonProps {
  label: string;
  location: string;
  isPast: boolean;
  isDark: boolean;
  primaryColor: string;
  borderColor: string;
  surfaceSecondary: string;
  textTertiary: string;
  onOpenMaps: (location: string) => void;
}

// Small inner Pressable. Layout lives on the inner View because
// Pressable's function-style `style` is silently dropped on RN Web —
// see the pressed-state comment in EventInboxRowItem.
function DirectionsButton({
  label,
  location,
  isPast,
  isDark,
  primaryColor,
  borderColor,
  surfaceSecondary,
  textTertiary,
  onOpenMaps,
}: DirectionsButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${location} in Maps`}
      onPress={(e) => {
        e.stopPropagation?.();
        onOpenMaps(location);
      }}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      hitSlop={6}
    >
      <View
        style={[
          styles.directionsButton,
          {
            backgroundColor: isPast
              ? surfaceSecondary
              : isDark
                ? primaryColor + "22"
                : primaryColor + "14",
            borderColor: isPast
              ? borderColor
              : isDark
                ? primaryColor + "44"
                : primaryColor + "33",
          },
          isPressed && { opacity: 0.65 },
        ]}
      >
        <Ionicons
          name="navigate"
          size={14}
          color={isPast ? textTertiary : primaryColor}
        />
        <Text
          style={[
            styles.directionsButtonText,
            { color: isPast ? textTertiary : primaryColor },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function EventInboxRowItem({ row, isActive }: EventInboxRowItemProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const { channel, group, userRole } = row;
  const hasUnread = channel.unreadCount > 0;
  const userId = user?.id as Id<"users"> | undefined;

  // Last message preview in the same "Sender: text" shape group rows use, so
  // event rows slot naturally into the mixed list.
  const messagePreview = (() => {
    if (!channel.lastMessagePreview) return "No messages yet";
    const isOwn = userId && channel.lastMessageSenderId === userId;
    const prefix = isOwn ? "Me" : channel.lastMessageSenderName;
    return prefix ? `${prefix}: ${channel.lastMessagePreview}` : channel.lastMessagePreview;
  })();

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

  // Compute time + urgency. Undefined only for legacy rows with no scheduledAt.
  const eventWhen =
    typeof channel.meetingScheduledAt === "number"
      ? formatEventWhen(channel.meetingScheduledAt, Date.now())
      : null;

  const urgency: EventUrgency = eventWhen?.urgency ?? "later";
  const isPast = urgency === "past";
  const isLive = urgency === "live";
  const isImminent = urgency === "imminent";

  // Accent bar color: strong primary for live/imminent, soft primary for
  // "today", barely-there border tint for soon/later, fully invisible for past.
  const accentColor = (() => {
    if (isPast) return "transparent";
    if (isLive || isImminent) return primaryColor;
    if (urgency === "today") return primaryColor + "66"; // ~40% alpha
    return "transparent";
  })();

  // Right-side relative tag: only rendered when the imminence is the point.
  // For "soon"/"later"/"past" the absolute `when` string already tells the
  // full story, so we don't pile on extra chrome.
  const showRelativeTag = isLive || isImminent || urgency === "today";
  const relativeTagLabel = isLive ? "Live now" : eventWhen?.relative;

  const locationShort = channel.meetingLocation
    ? shortLocation(channel.meetingLocation)
    : null;

  // Background: unread tint (as before), active (sidebar) tint, or surface.
  // Past events get no tint — we want them to recede, not attract.
  const rowBackground = (() => {
    if (isActive) return colors.surfaceSecondary;
    if (hasUnread && !isPast) return isDark ? colors.surfaceSecondary : "#F0F7FF";
    return colors.surface;
  })();

  // Track pressed state manually. We can't use Pressable's function-form
  // `style` prop because RN Web silently drops layout styles (padding,
  // flexDirection, gap) returned from that function — the row would collapse
  // on web. Instead, layout lives on the inner View and we flip the bg via
  // state + onPressIn/Out.
  const [isPressed, setIsPressed] = useState(false);

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${group.name} — ${channel.name}${
        eventWhen ? `, ${eventWhen.when}` : ""
      }${hasUnread ? `, ${channel.unreadCount} unread` : ""}`}
    >
      <View
        style={[
          styles.eventRow,
          { backgroundColor: isPressed ? colors.surfaceSecondary : rowBackground },
        ]}
      >
      {/* Left accent bar — the primary imminence signal. Hidden for past rows
          and for events more than a week out; those rows read as "regular". */}
      <View
        style={[
          styles.eventAccentBar,
          { backgroundColor: accentColor },
        ]}
        pointerEvents="none"
      />

      <View style={styles.eventAvatarContainer}>
        <AppImage
          source={channel.meetingCoverImage || group.preview}
          style={[
            styles.eventAvatarImage,
            isPast && styles.eventAvatarMuted,
          ]}
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
            {
              backgroundColor: isPast ? colors.textTertiary : primaryColor,
              borderColor: colors.surface,
            },
          ]}
        >
          <Ionicons name="calendar" size={12} color="#fff" />
        </View>
      </View>

      <View style={styles.eventContent}>
        {/* Line 1: "Group name: Event name" title + right-side urgency tag. */}
        <View style={styles.eventTopRow}>
          <Text
            style={[
              styles.eventName,
              { color: isPast ? colors.textSecondary : colors.text },
              hasUnread && !isPast && styles.eventNameUnread,
            ]}
            numberOfLines={1}
          >
            {group.name}: {channel.name}
          </Text>
          {showRelativeTag && relativeTagLabel ? (
            <View
              style={[
                styles.eventUrgencyTag,
                isLive
                  ? { backgroundColor: primaryColor }
                  : {
                      backgroundColor: isDark
                        ? primaryColor + "22"
                        : primaryColor + "14",
                    },
              ]}
            >
              {isLive ? <View style={styles.eventLiveDot} /> : null}
              <Text
                style={[
                  styles.eventUrgencyTagText,
                  { color: isLive ? "#fff" : primaryColor },
                ]}
              >
                {relativeTagLabel}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Line 2: last message preview — same vertical slot as group rows so
            the list reads uniformly. */}
        <Text
          style={[
            styles.eventPreview,
            { color: isPast ? colors.textTertiary : colors.textSecondary },
            hasUnread && !isPast && { fontWeight: "600", color: colors.text },
          ]}
          numberOfLines={1}
        >
          {messagePreview}
        </Text>

        {/* Line 3: muted time + prominent Directions button. */}
        <View style={styles.eventMetaRow}>
          <Text
            style={[
              styles.eventMetaText,
              { color: isPast ? colors.textTertiary : colors.textSecondary },
            ]}
            numberOfLines={1}
          >
            {eventWhen ? eventWhen.when : "Scheduled"}
          </Text>
          {locationShort ? (
            <DirectionsButton
              label={locationShort}
              location={channel.meetingLocation!}
              isPast={isPast}
              isDark={isDark}
              primaryColor={primaryColor}
              borderColor={colors.border}
              surfaceSecondary={colors.surfaceSecondary}
              textTertiary={colors.textTertiary}
              onOpenMaps={openMapsForLocation}
            />
          ) : null}
        </View>
      </View>

      {hasUnread ? (
        <View
          style={[
            styles.eventUnreadBadge,
            { backgroundColor: isPast ? colors.textTertiary : primaryColor },
          ]}
        >
          <Text style={styles.eventUnreadBadgeText}>
            {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
          </Text>
        </View>
      ) : null}
      </View>
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
    // Left padding is slightly reduced (13 vs 16) to make room for the 3px
    // accent bar so overall row padding still reads as 16. Group rows use
    // 16 — the delta here is negligible (~1–2px) and keeps the avatar's
    // horizontal position aligned with the group rows above/below.
    paddingLeft: 13,
    paddingRight: 16,
    paddingVertical: 12,
  },
  // Thin left accent bar — the primary imminence signal.
  eventAccentBar: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    marginRight: 10,
    // When there's no accent color the bar still occupies space so avatars
    // stay aligned with accented siblings.
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
  eventAvatarMuted: {
    opacity: 0.55,
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
  // Small muted group-name caption above the event title.
  eventGroupCaption: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  eventTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 3,
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
  // Urgency pill — rendered only for live/imminent/today events.
  eventUrgencyTag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 5,
  },
  eventUrgencyTagText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  // "Live" pulsing-looking dot. No actual animation — animating on every
  // visible row in the inbox is overkill; the solid dot + "Live now" label
  // reads clearly enough.
  eventLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  eventBottomRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  eventPreview: {
    fontSize: 14,
    marginTop: 2,
  },
  eventMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 10,
  },
  eventMetaText: {
    fontSize: 12,
    flexShrink: 0,
  },
  eventMetaSeparator: {
    fontSize: 12,
    marginHorizontal: 6,
  },
  // Prominent filled pill next to the time — reads as a CTA. Primary-tinted
  // background so it doesn't blend into the surrounding muted row.
  directionsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
  },
  directionsButtonText: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  // Inline location chip — no border, no background, just icon + text tinted
  // with primary color. Reads as "tappable" via the primary tint.
  locationChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flexShrink: 1,
    // Compensate for the small icon by keeping a healthy top/bottom hit area
    // (see hitSlop on the Pressable).
    paddingVertical: 2,
  },
  locationChipText: {
    fontSize: 13,
    fontWeight: "500",
    flexShrink: 1,
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
