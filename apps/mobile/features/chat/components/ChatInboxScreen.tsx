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
  ScrollView,
  Pressable,
  Linking,
  Platform,
  Alert,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, usePathname } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@providers/AuthProvider";
import { useConnectionStatus } from "@providers/ConnectionProvider";
import { useQuery, api, useStoredAuthToken } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { AppImage, SearchBar } from "@components/ui";
import { InboxSearchResults } from "./InboxSearchResults";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { GroupedInboxItem } from "./GroupedInboxItem";
import { selectMainChannel } from "../utils/selectMainChannel";
import { useExpandedGroups } from "../hooks/useExpandedGroups";
import { useInboxCache } from "../../../stores/inboxCache";
import { Avatar } from "@components/ui/Avatar";
import { StackedMemberAvatars } from "./StackedMemberAvatars";
import { EnableNotificationsBanner } from "@features/notifications/components/EnableNotificationsBanner";
import { useEventModeStore } from "@/stores/eventModeStore";
import { useCachedServingPlans } from "@features/serving/hooks/useCachedServingPlans";

// Inbox event visibility is now driven server-side by
// `INBOX_EVENT_HIDE_AFTER_MS` in apps/convex/functions/messaging/channels.ts
// (channels without a first message or quiet for >2 days are omitted from
// the payload), so the client no longer duplicates that constant.

// Minimum query length before the inbox search query runs. Mirrors the
// MIN_QUERY_LENGTH guard in the backend `searchMessages` query.
const MIN_SEARCH_LENGTH = 2;

// WhatsApp-style collapsing header geometry. The large title shares the nav row
// with the compose button (it's overlaid there, not given its own row), so only
// the search bar block occupies extra vertical space. COLLAPSE_DISTANCE is the
// scroll distance (px) over which the large title fades into the small centered
// title and the search bar collapses away.
const NAV_ROW_HEIGHT = 44;
const SEARCH_BLOCK_HEIGHT = 64;
const COLLAPSE_DISTANCE = NAV_ROW_HEIGHT + SEARCH_BLOCK_HEIGHT;

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

// A "coming soon" serving channel the user will be added to but isn't yet a
// member of. Returned by getServingUpcomingChannels; rendered as a ghost card.
type UpcomingChannel = {
  channelId: Id<"chatChannels">;
  name: string;
  kind: "team" | "cross_team";
  availableAt: number;
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
  // Device network state. Drives the loading strategy: online we hold for a
  // complete first paint; with no network we fall back to cached channels.
  const { isNetworkAvailable } = useConnectionStatus();
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

  // Serving mode: when active, the inbox spans EVERY plan the user is serving
  // today — the union of all eligible plans' serving channels (returned FLAT),
  // which the client groups into a section per owning group.
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  // The serving-mode flag is persisted and rehydrates from AsyncStorage
  // asynchronously. Until this is true it holds its default, so we hold the
  // inbox on its loading state rather than rendering the full regular inbox and
  // then stripping it down to the serving-mode view a beat later.
  const eventModeHydrated = useEventModeStore((s) => s.hasHydrated);
  const enterServingMode = useEventModeStore((s) => s.enter);
  const autoEnterBlocked = useEventModeStore((s) => s.autoEnterBlocked);
  const eventTasksEnabled =
    (community?.churchFeatures as { eventTasksEnabled?: boolean } | undefined)
      ?.eventTasksEnabled === true;
  // Only enter serving mode when the feature is actually enabled — a stale
  // persisted serving flag (feature since disabled for this community) must not
  // leave the normal inbox filtered, since the serving tabs/Exit are hidden.
  const inServingMode = isServingMode && eventTasksEnabled;

  // The plans the user is serving today drive the serving inbox's sections and
  // the re-entry chip. The query runs whenever the feature is on (even when not
  // serving) so the chip can appear; its plans[] are cached for offline access.
  const servingEligibility = useQuery(
    api.functions.scheduling.serving.getServingEligibility,
    token && eventTasksEnabled ? { token } : "skip",
  ) as
    | {
        eligible: boolean;
        autoEnter: boolean;
        plans: Array<{
          planId: string;
          groupId: string;
          title: string;
          startsAt: number;
          endsAt: number;
        }>;
      }
    | undefined;
  const eligiblePlans = useCachedServingPlans(servingEligibility?.plans);
  const eligiblePlanIds = useMemo(
    () => eligiblePlans.map((p) => p.planId as Id<"eventPlans">),
    [eligiblePlans],
  );

  // Fetch inbox channels. In serving mode, restrict to the union of every
  // eligible plan's serving channels. Hold the query until the plan ids are
  // known (online) so we don't flash the full — or an empty — inbox first;
  // offline, `eligiblePlanIds` comes from cache so the stale inbox still shows.
  const inboxQueryArgs = useMemo(() => {
    if (!userId || !communityId || !token) {
      return "skip" as const;
    }
    if (inServingMode) {
      if (servingEligibility === undefined && eligiblePlanIds.length === 0) {
        return "skip" as const;
      }
      return { token, communityId, servingPlanIds: eligiblePlanIds };
    }
    return { token, communityId };
  }, [
    userId,
    communityId,
    token,
    inServingMode,
    servingEligibility,
    eligiblePlanIds,
  ]);

  const inboxChannels = useQuery(
    api.functions.messaging.channels.getInboxChannels,
    inboxQueryArgs
  );

  // Direct-message inbox is a separate subscription so the existing
  // `getInboxChannels` query (and its 4222-line file) stays untouched. Convex
  // multi-subscription cost is negligible.
  const directInbox = useQuery(
    api.functions.messaging.directMessages.getDirectInbox,
    token && communityId ? { token, communityId } : "skip",
  );
  const chatRequests = useQuery(
    api.functions.messaging.directMessages.listChatRequests,
    token && communityId ? { token, communityId } : "skip",
  );

  // Summary for the synthetic "Notifications" inbox row: the latest
  // notification (preview + sort timestamp) and unread count. The row is
  // hidden entirely when the user has zero notifications.
  const notificationSummary = useQuery(
    api.functions.notifications.queries.inboxSummary,
    token ? { token } : "skip",
  );

  // Serving mode focuses the inbox on the plans being served: their channels
  // stay pinned on top (filtered server-side via `servingPlanIds`, above), DMs
  // are narrowed to those created on a serving day, and the Notifications row is
  // hidden. The DM-day windows are derived from the eligible plans' start times.

  // Serving mode "coming soon" channels: across ALL eligible plans, the team +
  // cross-team channels the user WILL be added to (via the rotation engine) but
  // isn't yet a member of, so they don't appear as real rows. Rendered as
  // non-tappable ghost cards at the bottom of the serving inbox.
  const upcomingChannels = useQuery(
    api.functions.scheduling.serving.getServingUpcomingChannels,
    inServingMode && eligiblePlanIds.length > 0 && token
      ? { token, planIds: eligiblePlanIds }
      : "skip",
  ) as UpcomingChannel[] | undefined;

  // Event-day windows (device-local day of each eligible plan's start), used to
  // narrow DMs to those created on a serving day. One window per distinct day
  // across all plans the user is serving.
  const servingDmWindows = useMemo<{ start: number; end: number }[]>(() => {
    if (!inServingMode) return [];
    const seen = new Set<number>();
    const windows: { start: number; end: number }[] = [];
    for (const plan of eligiblePlans) {
      const d = new Date(plan.startsAt);
      const start = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
      ).getTime();
      if (seen.has(start)) continue;
      seen.add(start);
      windows.push({ start, end: start + 24 * 60 * 60 * 1000 });
    }
    return windows;
  }, [inServingMode, eligiblePlans]);

  // Resources flagged to show under their group in the inbox. One batched
  // subscription returns them grouped by groupId; we index into it per row.
  const inboxResources = useQuery(
    api.functions.groupResources.index.getInboxResourcesForUser,
    token && communityId ? { token, communityId } : "skip",
  );
  const resourcesByGroup = useMemo(() => {
    const map = new Map<string, NonNullable<typeof inboxResources>[number]["resources"]>();
    for (const entry of inboxResources ?? []) {
      map.set(entry.groupId, entry.resources);
    }
    return map;
  }, [inboxResources]);

  // Serving mode re-entry. When the community has the Event Tasks feature and
  // the user is eligible to serve today, offer a chip to (re)enter serving mode.
  // `autoEnter` lets the backend jump the user straight in — but only once per
  // session and never if they manually exited this session, so a volunteer who
  // intentionally left isn't yanked back in.
  useEffect(() => {
    if (!servingEligibility?.eligible) return;
    // Already in serving mode → nothing to do.
    if (isServingMode) return;
    // Auto-enter only when the backend asks for it and the user hasn't manually
    // exited this session. `autoEnterBlocked` lives in the store (not a
    // component ref) so it survives the tab-navigator remount that exiting
    // triggers — a ref would reset on that remount and immediately re-enter,
    // making the Exit button appear broken.
    if (servingEligibility.autoEnter && !autoEnterBlocked) {
      enterServingMode();
    }
  }, [servingEligibility, isServingMode, enterServingMode, autoEnterBlocked]);

  // Show the manual re-entry chip when eligible but not currently serving.
  const showServingChip = !!servingEligibility?.eligible && !isServingMode;

  // Inbox message search. SearchBar debounces input, so `searchTerm` only
  // updates after the user pauses typing — keeping the reactive query from
  // firing on every keystroke. A search is only run once the term is long
  // enough to be meaningful (see MIN_SEARCH_LENGTH).
  const [searchTerm, setSearchTerm] = useState("");
  const trimmedSearch = searchTerm.trim();
  const isSearching = trimmedSearch.length >= MIN_SEARCH_LENGTH;
  const searchResults = useQuery(
    api.functions.messaging.search.searchMessages,
    isSearching && token && communityId
      ? { token, communityId, query: trimmedSearch }
      : "skip",
  );

  // Offline cache key. Serving mode returns a *different* (plan-filtered) set of
  // channels than the regular inbox, so it must not share a cache slot with it —
  // otherwise the stale-while-revalidate fallback could serve the full regular
  // inbox while the serving query loads, flashing it before it strips down.
  const inboxCacheKey = useMemo(() => {
    if (!communityId) return null;
    return inServingMode ? `${communityId}:serving` : communityId;
  }, [communityId, inServingMode]);

  // Cache inbox data for offline use
  useEffect(() => {
    if (inboxChannels && inboxChannels.length > 0 && inboxCacheKey) {
      setInboxChannels(inboxCacheKey, inboxChannels);
    }
  }, [inboxChannels, inboxCacheKey, setInboxChannels]);

  // Inbox list entries are a grouped item (group + its channels), an event row,
  // a direct-message row, or the requests-link header. Groups, events, and DMs
  // all blend into a single inbox stream — no section divider — so the surface
  // reads like iMessage rather than a categorized list. Announcement group
  // stays pinned on top of the groups+events block.
  type DirectInboxRow = NonNullable<typeof directInbox>[number];
  // The synthetic Notifications row carries its own sort timestamp (the latest
  // notification's createdAt) so it competes naturally with channels'
  // lastMessageAt — it is not pinned.
  type NotificationsRow = {
    sortTime: number;
    previewTitle: string;
    unreadCount: number;
  };
  type InboxListItem =
    | { kind: "group"; item: InboxGroup }
    | { kind: "event"; item: EventInboxRow }
    | { kind: "dm"; item: DirectInboxRow }
    | { kind: "notifications"; item: NotificationsRow }
    | { kind: "ghost"; item: UpcomingChannel }
    // Serving-mode only: a pinned link to the "who's serving" Team grid.
    | { kind: "team-link" }
    // Serving-mode only: a section header labeling the owning group of the
    // channel rows that follow it (one per group the user is serving).
    | { kind: "section-header"; id: string; title: string }
    | { kind: "requests-link"; count: number };

  // Render a single inbox row (group, event, dm, section header, or
  // requests-link). The requests-link is always a single tappable row that
  // navigates to the dedicated requests inbox — keeping pending senders out
  // of the active conversation list is the whole point of the Message
  // Request flow, so we deliberately do NOT interleave them.
  const renderItem = useCallback(
    ({ item }: { item: InboxListItem }) => {
      if (item.kind === "section-header") {
        return (
          <View style={styles.servingSectionHeader}>
            <Text
              style={[styles.servingSectionHeaderText, { color: colors.text }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
          </View>
        );
      }
      if (item.kind === "team-link") {
        return (
          <Pressable
            onPress={() => router.push("/serving/team" as any)}
            style={styles.requestsLinkRow}
            accessibilityRole="button"
            accessibilityLabel="Team — who's serving"
          >
            <View
              style={[styles.requestsLinkIcon, { backgroundColor: primaryColor }]}
            >
              <Ionicons name="people" size={20} color="#ffffff" />
            </View>
            <View style={styles.requestsLinkContent}>
              <Text style={[styles.requestsLinkTitle, { color: colors.text }]}>
                Team
              </Text>
              <Text
                style={[
                  styles.requestsLinkSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                See who&apos;s serving
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>
        );
      }
      if (item.kind === "requests-link") {
        return (
          <Pressable
            onPress={() => router.push("/inbox/requests" as any)}
            style={styles.requestsLinkRow}
            accessibilityRole="button"
            accessibilityLabel={`${item.count} message request${item.count === 1 ? "" : "s"}`}
          >
            <View
              style={[
                styles.requestsLinkIcon,
                { backgroundColor: primaryColor },
              ]}
            >
              <Ionicons name="mail-unread-outline" size={20} color="#ffffff" />
            </View>
            <View style={styles.requestsLinkContent}>
              <Text style={[styles.requestsLinkTitle, { color: colors.text }]}>
                Message Requests
              </Text>
              <Text
                style={[
                  styles.requestsLinkSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                {item.count} pending
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textSecondary}
            />
          </Pressable>
        );
      }
      if (item.kind === "notifications") {
        return (
          <NotificationsInboxRow
            row={item.item}
            primaryColor={primaryColor}
            colors={colors}
            onPress={() => router.push("/notifications" as any)}
          />
        );
      }
      if (item.kind === "dm") {
        return (
          <DirectMessageRow
            row={item.item}
            primaryColor={primaryColor}
            colors={colors}
          />
        );
      }
      if (item.kind === "ghost") {
        return <GhostChannelCard channel={item.item} />;
      }
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
          resources={resourcesByGroup.get(item.item.group._id)}
          servingMode={inServingMode}
        />
      );
    },
    [isGroupExpanded, toggleGroupExpanded, sidebarMode, activeGroupId, activeChannelSlug, primaryColor, colors, router, resourcesByGroup, inServingMode]
  );

  // Key extractor for FlatList
  const keyExtractor = useCallback((item: InboxListItem) => {
    if (item.kind === "section-header") return `section:${item.id}`;
    if (item.kind === "team-link") return "team-link";
    if (item.kind === "requests-link") return "requests-link";
    if (item.kind === "notifications") return "notifications";
    if (item.kind === "ghost") return `ghost:${item.item.channelId}`;
    if (item.kind === "dm") return `dm:${item.item.channelId}`;
    return item.kind === "event"
      ? `event:${item.item.channel._id}`
      : `group:${item.item.group._id}`;
  }, []);

  const Wrapper = React.Fragment;
  const headerPaddingTop = sidebarMode ? 16 : insets.top + 16;

  // --- WhatsApp-style collapsing header -------------------------------------
  // The large title + search bar live *above* the list (not inside it) so the
  // single SearchBar instance stays mounted when the list swaps to search
  // results below — typing and keyboard focus are never interrupted. Collapse
  // is driven off the list's scroll offset and disabled while searching, so the
  // search field is always reachable in that mode.
  const scrollY = useSharedValue(0);
  const onListScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });
  const collapseEnabled = !isSearching;

  // Reset to the expanded state whenever we leave search mode: the list below
  // remounts scrolled to the top, so the cached scroll offset would otherwise
  // leave the header stuck in its collapsed state.
  useEffect(() => {
    if (!isSearching) scrollY.value = 0;
  }, [isSearching, scrollY]);

  const largeTitleStyle = useAnimatedStyle(() => {
    const p = collapseEnabled
      ? interpolate(scrollY.value, [0, COLLAPSE_DISTANCE], [0, 1], Extrapolation.CLAMP)
      : 0;
    // The large title is overlaid in the nav row, so it just fades and lifts on
    // scroll — it has no flow height to collapse.
    return {
      opacity: interpolate(p, [0, 0.7], [1, 0], Extrapolation.CLAMP),
      transform: [{ translateY: interpolate(p, [0, 1], [0, -8]) }],
    };
  });

  const searchStyle = useAnimatedStyle(() => {
    const p = collapseEnabled
      ? interpolate(scrollY.value, [0, COLLAPSE_DISTANCE], [0, 1], Extrapolation.CLAMP)
      : 0;
    return {
      height: interpolate(p, [0, 1], [SEARCH_BLOCK_HEIGHT, 0]),
      opacity: interpolate(p, [0, 0.6], [1, 0], Extrapolation.CLAMP),
    };
  });

  const smallTitleStyle = useAnimatedStyle(() => {
    const p = collapseEnabled
      ? interpolate(scrollY.value, [0, COLLAPSE_DISTANCE], [0, 1], Extrapolation.CLAMP)
      : 0;
    // Fade the centered nav title in over the back half of the collapse so it
    // hands off cleanly from the large title fading out.
    return { opacity: interpolate(p, [0.4, 1], [0, 1], Extrapolation.CLAMP) };
  });

  const hairlineStyle = useAnimatedStyle(() => {
    const p = collapseEnabled
      ? interpolate(scrollY.value, [0, COLLAPSE_DISTANCE], [0, 1], Extrapolation.CLAMP)
      : 0;
    return { opacity: interpolate(p, [0, 1], [0, 1]) };
  });

  // Collapsing header for the populated inbox view. The large title and compose
  // button share a single nav row (like the static header) — the large title is
  // overlaid on the left and morphs into the centered small title on scroll,
  // while the search bar below collapses away. Keeping the title and compose on
  // one row avoids a wasteful empty nav row above the title.
  const renderCollapsingHeader = () => (
    <Animated.View style={[styles.collapsingHeader, { paddingTop: headerPaddingTop }]}>
      <View style={styles.navRow}>
        <Animated.View
          style={[styles.largeTitleWrap, largeTitleStyle]}
          pointerEvents="none"
        >
          <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
        </Animated.View>
        <Animated.Text
          style={[styles.smallTitle, { color: colors.text }, smallTitleStyle]}
          numberOfLines={1}
          pointerEvents="none"
        >
          Inbox
        </Animated.Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          onPress={() => router.push("/inbox/new" as any)}
          style={styles.headerActionButton}
          hitSlop={12}
        >
          <Ionicons name="create-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      <Animated.View style={[styles.searchWrap, searchStyle]}>
        <SearchBar
          placeholder="Search messages"
          onSearch={setSearchTerm}
          onClear={() => setSearchTerm("")}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[styles.headerHairline, { backgroundColor: colors.border }, hairlineStyle]}
      />
    </Animated.View>
  );

  // The same header is rendered above the list and the three empty/loading
  // states below; centralizing it here keeps the "+" button placement (and the
  // tap target that opens the new-chat picker) in one place. Hidden in the
  // "no community" empty state since the picker has nothing to search.
  const renderHeader = (showCompose: boolean) => (
    <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Inbox</Text>
      {showCompose && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
          onPress={() => router.push("/inbox/new" as any)}
          style={styles.headerActionButton}
          hitSlop={12}
        >
          <Ionicons
            name="create-outline"
            size={24}
            color={colors.text}
          />
        </Pressable>
      )}
    </View>
  );

  // Auto-select first conversation when in sidebar mode and no conversation is active
  useEffect(() => {
    if (!sidebarMode || hasAutoSelected.current) return;
    if (!inboxChannels || inboxChannels.length === 0) return;
    // Only auto-select if we're on the bare /inbox/ route
    if (pathname !== "/inbox" && pathname !== "/inbox/") return;

    // Auto-select the main-spot channel of the first group that actually renders a
    // row. The inbox splits event channels into their own rows and hides disabled
    // ones (see listItems below), so we match that set (enabled, non-event) and run
    // the same selectMainChannel used by the row. We scan rather than only checking
    // inboxChannels[0] because the first backend group may contain only event/disabled
    // channels — in that case it renders no main row, and the pane should fall through
    // to the next group with a visible conversation instead of staying blank.
    let firstGroup: (typeof inboxChannels)[number] | undefined;
    let firstChannel: (typeof inboxChannels)[number]["channels"][number] | undefined;
    for (const group of inboxChannels) {
      const candidate = selectMainChannel(
        group.channels.filter(
          (ch) => ch.isEnabled !== false && ch.channelType !== "event"
        )
      );
      if (candidate) {
        firstGroup = group;
        firstChannel = candidate;
        break;
      }
    }
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
  // Wait for the serving-mode flag to hydrate before serving stale channels —
  // `inboxCacheKey` depends on it, so before hydration we'd risk handing back the
  // regular inbox for what turns out to be a serving session.
  if (isLoading && inboxCacheKey && eventModeHydrated) {
    const cached = getInboxChannels(inboxCacheKey) as InboxGroup[] | undefined;
    if (cached && cached.length > 0) {
      displayChannels = cached;
      isStale = true;
    }
  }

  // The inbox is assembled from several independent subscriptions beyond the
  // channel backbone: resources shown under each group, DMs, pending requests,
  // the Notifications summary, and — in serving mode — the plan's DM window and
  // "coming soon" channels. If we paint as soon as `getInboxChannels` resolves,
  // each of these pops in a beat later (and DMs/notifications re-sort the list
  // as they land). So hold the first paint until every *active* subscription has
  // resolved once. A Convex query only returns `undefined` before its first
  // result — skipped queries stay `undefined` forever — so each is awaited only
  // when its inputs make it live.
  const hasChatContext = !!token && !!communityId;
  const auxDataLoading =
    (hasChatContext && inboxResources === undefined) || // resources under items
    (!!token && notificationSummary === undefined) || // Notifications row
    (hasChatContext &&
      (directInbox === undefined || chatRequests === undefined)) || // DMs + requests
    // Serving mode appends the "coming soon" channels the focused inbox shows.
    (inServingMode &&
      eligiblePlanIds.length > 0 &&
      !!token &&
      upcomingChannels === undefined);

  // Interleave group and event rows by recency. Server already hides event
  // channels without a first message and those quiet for >2 days (see
  // INBOX_EVENT_HIDE_AFTER_MS in channels.ts), so the client just splits the
  // events off their owning-group entries and drops them back into the list
  // sorted by lastMessageAt. Announcement group stays pinned on top.
  const listItems = useMemo<InboxListItem[]>(() => {
    if (!displayChannels) return [];

    type GroupOrEventItem =
      | { kind: "group"; item: InboxGroup }
      | { kind: "event"; item: EventInboxRow };
    const groupItems: GroupOrEventItem[] = [];
    const eventItems: GroupOrEventItem[] = [];

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

    const effectiveTime = (entry: GroupOrEventItem): number => {
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

  // Blend direct messages into the same inbox stream as groups + events so the
  // surface reads like iMessage — no category divider, no "Direct messages"
  // header. Pending requests still surface as a single tappable row pinned at
  // the very top (above the announcement group) so unaccepted senders can't
  // sneak into the active chat list.
  const dmRows = directInbox ?? [];
  const requestCount = chatRequests?.length ?? 0;
  // Synthetic Notifications entry — present only when the user actually has
  // notifications. It carries its latest notification's createdAt as a sort
  // key so it interleaves by recency with channels/events/DMs (not pinned).
  const notificationsItem = useMemo<InboxListItem | null>(() => {
    const latest = notificationSummary?.latest;
    if (!latest) return null;
    return {
      kind: "notifications" as const,
      item: {
        sortTime: latest.createdAt,
        previewTitle: latest.title,
        unreadCount: notificationSummary?.unreadCount ?? 0,
      },
    };
  }, [notificationSummary]);

  const listItemsWithDm = useMemo<InboxListItem[]>(() => {
    // Serving mode: a focused inbox. `listItems` is already restricted to the
    // eligible plans' serving channels (server-filtered via `servingPlanIds`),
    // so section them by owning group and append only the DMs created on a
    // serving day. No Notifications row and no requests-link — everything
    // unrelated is hidden.
    if (inServingMode) {
      // Group the flat serving channel rows into a section per owning group.
      // The backend unions channels across every plan the user is serving and
      // dedupes a shared channel to a single row, so grouping by owning group
      // here yields one labeled section per group (and never a duplicate chat).
      const sectionOrder: string[] = [];
      const sections = new Map<
        string,
        { title: string; items: InboxListItem[] }
      >();
      for (const li of listItems) {
        if (li.kind !== "group" && li.kind !== "event") continue;
        const g = li.item.group;
        const gid = g._id as string;
        let section = sections.get(gid);
        if (!section) {
          section = { title: g.name, items: [] };
          sections.set(gid, section);
          sectionOrder.push(gid);
        }
        section.items.push(li);
      }
      const sectioned: InboxListItem[] = [];
      for (const gid of sectionOrder) {
        const section = sections.get(gid)!;
        sectioned.push({
          kind: "section-header" as const,
          id: gid,
          title: section.title,
        });
        sectioned.push(...section.items);
      }
      // DMs created on any serving day (across all eligible plans). An empty
      // window list (still loading / no plans) shows no DMs rather than falling
      // open to every DM.
      const dayDmItems: InboxListItem[] = dmRows
        .filter((row) =>
          servingDmWindows.some(
            (w) => row.createdAt >= w.start && row.createdAt < w.end,
          ),
        )
        .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
        .map((row) => ({ kind: "dm" as const, item: row }));
      // "Coming soon" ghost cards, grouped together at the bottom. Past-due
      // ghosts (availableAt already elapsed but the user still isn't a member —
      // a rotation edge case) are hidden to keep the list clean.
      const now = Date.now();
      const ghostItems: InboxListItem[] = (upcomingChannels ?? [])
        .filter((c) => c.availableAt > now)
        .sort((a, b) => a.availableAt - b.availableAt)
        .map((c) => ({ kind: "ghost" as const, item: c }));
      // A pinned "Team" card leads the serving inbox — the who's-serving grid.
      return [
        { kind: "team-link" as const },
        ...sectioned,
        ...dayDmItems,
        ...ghostItems,
      ];
    }

    const dmItems: InboxListItem[] = dmRows.map((row) => ({
      kind: "dm" as const,
      item: row,
    }));

    // Recency-sort DMs against groups + events. Announcement-group ordering
    // (already enforced inside `listItems`) is preserved by treating that
    // entry as a fixed top anchor and only sorting the rest.
    const dmTime = (entry: { kind: "dm"; item: DirectInboxRow }) =>
      entry.item.lastMessageAt ?? 0;
    const otherTime = (entry: InboxListItem) => {
      if (entry.kind === "event") {
        return (
          entry.item.channel.lastMessageAt ??
          entry.item.channel.meetingScheduledAt ??
          0
        );
      }
      if (entry.kind === "group") {
        return Math.max(
          0,
          ...entry.item.channels.map((c) => c.lastMessageAt ?? 0),
        );
      }
      if (entry.kind === "notifications") {
        return entry.item.sortTime;
      }
      return 0;
    };

    // Pull the pinned announcement group off the front (if present) so DMs
    // can't displace it.
    const pinned: InboxListItem[] = [];
    const rest: InboxListItem[] = [];
    for (const entry of listItems) {
      if (
        entry.kind === "group" &&
        entry.item.group.isAnnouncementGroup &&
        pinned.length === 0
      ) {
        pinned.push(entry);
      } else {
        rest.push(entry);
      }
    }

    // The Notifications row joins the same recency-sorted pool — not pinned.
    const merged: InboxListItem[] = [...rest, ...dmItems];
    if (notificationsItem) merged.push(notificationsItem);
    merged.sort((a, b) => {
      const aT = a.kind === "dm" ? dmTime(a) : otherTime(a);
      const bT = b.kind === "dm" ? dmTime(b) : otherTime(b);
      return bT - aT;
    });

    const items: InboxListItem[] = [];
    if (requestCount > 0) {
      items.push({ kind: "requests-link", count: requestCount });
    }
    items.push(...pinned, ...merged);
    return items;
  }, [
    requestCount,
    dmRows,
    listItems,
    notificationsItem,
    inServingMode,
    servingDmWindows,
    upcomingChannels,
  ]);
  const hasInboxItems = listItemsWithDm.length > 0;

  // Show message when user has no community context
  if (!hasCommunity) {
    return (
      <Wrapper>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          {renderHeader(false)}
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

  // Hold the loading state until the whole first paint is ready: the persisted
  // serving-mode flag has hydrated (so we know which inbox to build), the channel
  // backbone has loaded, and every active auxiliary subscription (resources, DMs,
  // requests, notifications, serving extras) has resolved once. Waiting for all of
  // them means the inbox appears complete instead of having rows, resources, and
  // DMs pop in and re-sort piecemeal.
  const firstPaintComplete =
    eventModeHydrated && !isLoading && !auxDataLoading;
  // Offline is the one exception: the live queries can never resolve, so rather
  // than spin forever we fall back to whatever channels are cached (once the
  // serving-mode flag has hydrated, so the cache key is correct). Web always
  // reports a network, so it always waits for the complete paint.
  const offlineStaleFallback =
    !isNetworkAvailable && eventModeHydrated && isStale;
  const showLoadingSpinner = !firstPaintComplete && !offlineStaleFallback;

  if (showLoadingSpinner) {
    return (
      <Wrapper>
        <View style={[styles.container, { backgroundColor: colors.surface }]}>
          {renderHeader(true)}
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
          {renderHeader(true)}
          <EnableNotificationsBanner />
          <ScrollView contentContainerStyle={styles.centeredScrollContent}>
            <Ionicons
              name="chatbubbles-outline"
              size={48}
              color={colors.iconSecondary}
              style={{ marginBottom: 16 }}
            />
            {/* Serving mode always pins the Team card, so the inbox is never
                empty there — this branch only renders outside serving mode. */}
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
        {renderCollapsingHeader()}
        {isSearching ? (
          <InboxSearchResults
            query={trimmedSearch}
            results={searchResults?.results}
            truncated={searchResults?.truncated}
          />
        ) : (
          <>
            {showServingChip ? (
              <Pressable
                onPress={() => enterServingMode()}
                style={[
                  styles.servingChip,
                  { backgroundColor: primaryColor + "14", borderColor: primaryColor },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Enter serving mode"
              >
                <Ionicons name="rocket-outline" size={18} color={primaryColor} />
                <Text style={[styles.servingChipText, { color: primaryColor }]}>
                  Enter serving mode
                </Text>
              </Pressable>
            ) : null}
            <EnableNotificationsBanner />
            <Animated.FlatList
              data={listItemsWithDm}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              contentContainerStyle={styles.listContainer}
              style={styles.list}
              onScroll={onListScroll}
              scrollEventThrottle={16}
            />
          </>
        )}
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
      // `flexShrink: 1, minWidth: 0` on the Pressable itself — this is the
      // actual flex item in the row. Without it the inner View's
      // flexShrink:1 can't kick in and the address text overflows past the
      // right edge instead of truncating with ellipsis.
      style={styles.directionsButtonPressable}
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

// ============================================================================
// Direct Messages section
// ============================================================================

type DirectInboxRowData = {
  channelId: Id<"chatChannels">;
  channelType: "dm" | "group_dm";
  channelName: string;
  memberCount: number;
  otherMembers: Array<{
    userId: Id<"users">;
    displayName: string;
    profilePhoto: string | null;
    notificationsDisabled: boolean;
  }>;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  lastMessageSenderName: string | null;
  lastMessageSenderId: Id<"users"> | null;
  lastMessageSenderNotificationsDisabled: boolean;
  unreadCount: number;
  isMuted: boolean;
};

interface DirectMessageRowProps {
  row: DirectInboxRowData;
  primaryColor: string;
  colors: {
    text: string;
    textSecondary: string;
    surface: string;
  };
}


function DirectMessageRow({ row, primaryColor, colors }: DirectMessageRowProps) {
  const router = useRouter();

  // Display name: for 1:1, the other member; for group_dm, the channel name
  // (or a comma-separated member list as a fallback when no name is set —
  // group_dm with empty name renders client-side from the member list).
  // "Chat" — not "Group chat" — is the fallback when no members are present:
  // the product surface drops "group" language; multi-recipient threads are
  // just chats with more people.
  const isOneOnOne = row.channelType === "dm";
  const headerName = isOneOnOne
    ? row.otherMembers[0]?.displayName ?? "Conversation"
    : row.channelName.trim().length > 0
      ? row.channelName
      : row.otherMembers
          .slice(0, 3)
          .map((m) => m.displayName.split(" ")[0])
          .filter(Boolean)
          .join(", ") || "Chat";

  // Stack avatars when this is a true multi-member group_dm with at least two
  // visible others. The cluster scales 2/3/4+ — see `StackedMemberAvatars`.
  const useStackedAvatars = !isOneOnOne && row.otherMembers.length >= 2;
  const primaryAvatar = row.otherMembers[0];

  // Compose preview line.
  const preview = row.lastMessagePreview ?? "No messages yet";
  const previewWithSender =
    isOneOnOne || !row.lastMessageSenderName
      ? preview
      : `${row.lastMessageSenderName.split(" ")[0]}: ${preview}`;

  const onPress = () => {
    router.push({
      pathname: `/inbox/dm/${row.channelId}` as any,
      params: {
        groupName: headerName,
        imageUrl: primaryAvatar?.profilePhoto ?? "",
      },
    });
  };

  return (
    <Pressable onPress={onPress} style={styles.dmRow}>
      {useStackedAvatars ? (
        <StackedMemberAvatars
          members={row.otherMembers.map((m) => ({
            name: m.displayName,
            imageUrl: m.profilePhoto,
          }))}
          surfaceColor={colors.surface}
        />
      ) : (
        <Avatar
          name={primaryAvatar?.displayName ?? headerName}
          imageUrl={primaryAvatar?.profilePhoto ?? undefined}
          size={56}
          notificationsDisabled={primaryAvatar?.notificationsDisabled ?? false}
          notificationsBadgeRingColor={colors.surface}
        />
      )}
      <View style={styles.dmRowContent}>
        <View style={styles.dmRowTopLine}>
          <Text
            numberOfLines={1}
            style={[styles.dmRowName, { color: colors.text }]}
          >
            {headerName}
          </Text>
          {row.unreadCount > 0 && (
            <View style={[styles.dmUnreadBadge, { backgroundColor: primaryColor }]}>
              <Text style={styles.dmUnreadBadgeText}>
                {row.unreadCount > 99 ? "99+" : row.unreadCount}
              </Text>
            </View>
          )}
        </View>
        <Text
          numberOfLines={1}
          style={[styles.dmRowPreview, { color: colors.textSecondary }]}
        >
          {previewWithSender}
        </Text>
      </View>
    </Pressable>
  );
}

// ============================================================================
// Notifications row
// ============================================================================

interface NotificationsInboxRowProps {
  row: { sortTime: number; previewTitle: string; unreadCount: number };
  primaryColor: string;
  colors: {
    text: string;
    textSecondary: string;
    surface: string;
  };
  onPress: () => void;
}

/**
 * Synthetic inbox row that opens the in-app Notifications feed. Renders like a
 * normal channel/group row — a bell icon in place of an avatar, the latest
 * notification's title as the preview line, and an unread-count badge.
 */
function NotificationsInboxRow({
  row,
  primaryColor,
  colors,
  onPress,
}: NotificationsInboxRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.dmRow}
      accessibilityRole="button"
      accessibilityLabel={`Notifications${
        row.unreadCount > 0 ? `, ${row.unreadCount} unread` : ""
      }`}
    >
      <View
        style={[styles.notificationsIcon, { backgroundColor: primaryColor }]}
      >
        <Ionicons name="notifications" size={26} color="#ffffff" />
      </View>
      <View style={styles.dmRowContent}>
        <View style={styles.dmRowTopLine}>
          <Text
            numberOfLines={1}
            style={[styles.dmRowName, { color: colors.text }]}
          >
            Notifications
          </Text>
          {row.unreadCount > 0 && (
            <View
              style={[styles.dmUnreadBadge, { backgroundColor: primaryColor }]}
            >
              <Text style={styles.dmUnreadBadgeText}>
                {row.unreadCount > 99 ? "99+" : row.unreadCount}
              </Text>
            </View>
          )}
        </View>
        <Text
          numberOfLines={1}
          style={[styles.dmRowPreview, { color: colors.textSecondary }]}
        >
          {row.previewTitle}
        </Text>
      </View>
    </Pressable>
  );
}

// ============================================================================
// Ghost (coming-soon) channel card
// ============================================================================

/**
 * Format a channel's `availableAt` as "Mon, Aug 26 · 7:00 AM" — the app's
 * standard weekday + date + time shape.
 */
function formatOpensAt(ts: number): string {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

/**
 * A non-tappable "coming soon" inbox card for a serving channel the user will
 * be added to but isn't a member of yet. Rendered muted/greyed with a dashed
 * lock avatar and a "Opens {date}" subtitle; tapping just explains when it
 * opens rather than navigating (there's nothing to open yet).
 */
function GhostChannelCard({ channel }: { channel: UpcomingChannel }) {
  const { colors } = useTheme();
  const opensLabel = formatOpensAt(channel.availableAt);
  const tagLabel = channel.kind === "cross_team" ? "Cross-team" : "Team";

  return (
    <Pressable
      onPress={() =>
        Alert.alert(
          "Not open yet",
          `${channel.name} opens ${opensLabel}.`,
        )
      }
      style={[styles.ghostRow, { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={`${channel.name}, ${tagLabel} channel, opens ${opensLabel}`}
    >
      <View style={[styles.ghostAvatar, { borderColor: colors.border }]}>
        <Ionicons name="lock-closed" size={22} color={colors.textTertiary} />
      </View>
      <View style={styles.ghostContent}>
        <View style={styles.ghostTopLine}>
          <Text
            numberOfLines={1}
            style={[styles.ghostName, { color: colors.textSecondary }]}
          >
            {channel.name}
          </Text>
          <View
            style={[styles.ghostTag, { backgroundColor: colors.surfaceSecondary }]}
          >
            <Text style={[styles.ghostTagText, { color: colors.textTertiary }]}>
              {tagLabel}
            </Text>
          </View>
        </View>
        <View style={styles.ghostSubtitleRow}>
          <Ionicons name="time-outline" size={13} color={colors.textTertiary} />
          <Text
            numberOfLines={1}
            style={[styles.ghostSubtitle, { color: colors.textTertiary }]}
          >
            Opens {opensLabel}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // "Enter serving mode" re-entry chip shown above the inbox list when the
  // user is eligible to serve but not currently in serving mode.
  servingChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  servingChipText: {
    fontSize: 15,
    fontWeight: "600",
  },
  // Serving-inbox section header labeling each group's channel rows.
  servingSectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 6,
  },
  servingSectionHeaderText: {
    fontSize: 15,
    fontWeight: "700",
  },
  // Bell-icon avatar for the synthetic Notifications row — sized to match the
  // 56pt avatars used by DM / event rows so it lines up in the mixed list.
  notificationsIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
  },
  headerActionButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  // --- Collapsing (WhatsApp-style) header ---
  collapsingHeader: {
    paddingBottom: 8,
  },
  // Nav row holding the compose button at the trailing edge. The large title is
  // overlaid on the left and the centered small title fades in on scroll; both
  // are absolutely positioned so they share this row instead of adding rows.
  navRow: {
    height: NAV_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
  },
  smallTitle: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
  },
  largeTitleWrap: {
    position: "absolute",
    left: 16,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  searchWrap: {
    height: SEARCH_BLOCK_HEIGHT,
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  headerHairline: {
    height: StyleSheet.hairlineWidth,
  },
  requestsLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  requestsLinkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  requestsLinkContent: {
    flex: 1,
    marginLeft: 12,
  },
  requestsLinkTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  requestsLinkSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  dmRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    // 12pt vertical padding matches GroupedInboxItem.groupItem so DMs and
    // group rows share the same vertical rhythm in the blended inbox.
    paddingVertical: 12,
  },
  dmRowContent: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  dmRowTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dmRowName: {
    fontSize: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
  dmRowTimestamp: {
    fontSize: 12,
    marginLeft: 8,
  },
  dmRowPreview: {
    fontSize: 14,
    marginTop: 2,
  },
  dmUnreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  dmUnreadBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
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
    // Match DM rows + group rows exactly — 16 left, 16 right — so avatars
    // line up vertically across the mixed inbox. The accent bar is
    // absolutely positioned over the leading edge instead of taking
    // horizontal space.
    paddingLeft: 16,
    paddingRight: 16,
    paddingVertical: 12,
    position: "relative",
  },
  // Thin left accent bar — pinned to the row's left edge as an overlay so
  // it doesn't push the avatar out of alignment with neighboring DM /
  // group rows. Hidden via `transparent` background when there's nothing
  // urgent to signal.
  eventAccentBar: {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
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
  // Wraps the directions button. minWidth:0 + flexShrink:1 are necessary
  // for the inner button + its `numberOfLines={1}` text to actually
  // truncate when the row is narrow — without this the address overflows
  // past the row's right edge.
  directionsButtonPressable: {
    flexShrink: 1,
    minWidth: 0,
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

  // --- Ghost (coming-soon) channel card ---
  ghostRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // Dashed, empty circle with a lock icon — signals "not yet available".
  ghostAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  ghostContent: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  ghostTopLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  ghostName: {
    fontSize: 16,
    fontWeight: "600",
    flexShrink: 1,
  },
  ghostTag: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  ghostTagText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  ghostSubtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 3,
  },
  ghostSubtitle: {
    fontSize: 13,
    flexShrink: 1,
  },
});
