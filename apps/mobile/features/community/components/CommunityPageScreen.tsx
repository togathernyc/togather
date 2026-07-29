/**
 * CommunityPageScreen
 *
 * WhatsApp's community **landing** screen (WA-VISUAL-DELTAS.md §5). A pushed
 * screen — not a tab — opened from the Chats list header when the
 * whatsapp-shell flag is on.
 *
 * Anatomy, per §5 (which supersedes WHATSAPP-DESIGN-SYSTEM.md where they
 * disagree — the deltas were derived from real WhatsApp iOS screenshots):
 * floating back circle + ⋯ circle over the content (S1, no nav bar), a
 * LEFT-aligned identity block (56pt squircle avatar · name 22pt bold ·
 * "Community" 15pt gray), an Announcements row, then "Groups you're in" /
 * "Groups you can join" sections — all as WHITE FULL-BLEED rows with
 * text-column-inset separators, under ~20pt sentence-case gray section
 * headers. A single floating green pill CTA sits at the bottom.
 *
 * Deliberately REMOVED this pass (§5.6/§5.7): the centered hero, the
 * Community/Announcements segmented control, and the circular Invite/Search
 * quick-action row. The hero and segmented control belong to the community
 * **info** screen; Invite and Search fold into the ⋯ menu, so no navigation
 * target was lost.
 *
 * Colors follow S5: the only green on this screen is the bottom CTA pill,
 * unread badges/timestamps, and the accent-tinted Announcements glyph that
 * §5.2 calls for explicitly. Photo-less group avatars use muted per-entity
 * hues (the `components/wa` kit's `waAvatarColor`), never the brand accent —
 * that all-green wall is on S5.2's kill list.
 *
 * Route: /(user)/community
 *
 * Backend (all pre-existing, no new Convex functions added):
 * - messaging.channels.getInboxChannels — resolves the Announcements group's
 *   main channel (same lookup ChatInboxScreen/GroupedInboxItem use) and
 *   supplies preview/timestamp/unread for the Announcements row AND for the
 *   "Groups you're in" rows (§5.4: member rows show a last-message preview).
 * - groups.queries.listForUser — "Groups you're in".
 * - groupSearch.searchGroupsWithMembership — "Groups you can join".
 * - admin.settings.getExploreDefaults — community's default group-type filter.
 * - meetings.explore.communityEvents (via useCommunityEvents) — "This week".
 *
 * Data not available to this screen (rendered without, per contract):
 * - A group-creation mutation. The bottom CTA keeps this screen's existing
 *   affordance — "Find your group" → community search — rather than being
 *   relabelled "Add group", which would promise a create flow that doesn't
 *   exist here.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { format, toZonedTime } from "date-fns-tz";
import { formatTimeWithTimezone } from "@togather/shared";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { waAccentPalette } from "@utils/waPalette";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useGroupSearchQuery } from "@features/groups/hooks/useGroups";
import { useCommunityEvents } from "@features/events/hooks/useCommunityEvents";
import { selectMainChannel } from "@features/chat/utils/selectMainChannel";
import {
  WaRow,
  WaCell,
  WaAvatar,
  WaSeparator,
  WaSubScreenHeader,
  WA_GROUP_MARGIN,
  WA_AVATAR_LG,
  WA_AVATAR_SQUIRCLE_RADIUS,
  WA_SEPARATOR_INSET,
  WA_TYPE_HEADER_BLOCK,
  WA_TYPE_SECTION_HEADER,
  WA_TYPE_SUBTITLE,
  WA_TYPE_ROW_TITLE,
  WA_WEIGHT_BOLD,
  WA_WEIGHT_SEMIBOLD,
  WA_FLOATING_SHADOW,
} from "@components/wa";

const MAX_SUGGESTED_GROUPS = 3;
const MAX_THIS_WEEK_EVENTS = 8;

/** §5.1 identity block — the 56pt squircle, same shape/radius ratio the list
 * avatars use for community-level entities (S6.4). */
const IDENTITY_AVATAR_SIZE = WA_AVATAR_LG;
const IDENTITY_AVATAR_RADIUS = WA_AVATAR_SQUIRCLE_RADIUS;

/** Height reserved under the scroll content so the last row clears the
 * floating CTA pill (which is absolutely positioned and takes no layout). */
const CTA_PILL_HEIGHT = 50;
const CTA_PILL_CLEARANCE = CTA_PILL_HEIGHT + 24;

/** Row-rail timestamp, matching §2's "12:52 PM" (today) / "Sunday" (this
 * week) / short-date (older) convention. Local to this screen — see the
 * file header's "self-contained" note. */
function formatRowTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  const isSameCalendarDay = date.toDateString() === now.toDateString();
  if (isSameCalendarDay) return format(date, "h:mm a");
  if (diffDays < 7) return format(date, "EEEE");
  return format(date, "M/d/yy");
}

/**
 * §5.3 section header — ~20pt sentence-case gray semibold, sitting directly
 * on the white list (NOT `WaSectionLabel`, whose 13pt ALL-CAPS rendering is
 * exactly what S3.5 flags as "reads as iOS-15, not WA"). Local to this
 * screen so the shared kit stays untouched.
 */
function LandingSectionHeader({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{children}</Text>
  );
}

/**
 * §5.2 Announcements avatar — a rounded SQUARE (not the circle used for
 * people/groups) with a megaphone glyph. The reference is pale-green on
 * dark-green; Togather brand-maps green to the community accent
 * (WHATSAPP-DESIGN-SYSTEM.md §1), so the pair here is accentLight on the
 * dark-mode-corrected accent.
 */
function AnnouncementsAvatar({ tint, background }: { tint: string; background: string }) {
  return (
    <View
      style={[
        styles.announcementsAvatar,
        {
          width: WA_AVATAR_LG,
          height: WA_AVATAR_LG,
          borderRadius: WA_AVATAR_SQUIRCLE_RADIUS,
          backgroundColor: background,
        },
      ]}
    >
      <Ionicons name="megaphone" size={26} color={tint} />
    </View>
  );
}

/** Neutral icon disc for the "This week" event rows — monochrome, never
 * accent-filled (S5.1: green is reserved for the CTA/badges/links). */
function EventAvatar({ background, tint }: { background: string; tint: string }) {
  return (
    <View
      style={[
        styles.eventAvatar,
        {
          width: WA_AVATAR_LG,
          height: WA_AVATAR_LG,
          borderRadius: WA_AVATAR_LG / 2,
          backgroundColor: background,
        },
      ]}
    >
      <Ionicons name="calendar-outline" size={24} color={tint} />
    </View>
  );
}

type GroupRowData = {
  id: string;
  name: string;
  imageUrl?: string | null;
  subtitle?: string | null;
  timestamp?: string;
  unreadCount?: number;
  isMuted?: boolean;
};

/**
 * Shared anatomy for "Groups you're in" / "Groups you can join" (§5.3–§5.4):
 * a sentence-case section header over white full-bleed `WaRow`s with
 * text-column-inset hairlines. Header-only fallback while loading or empty —
 * no empty white card.
 */
function GroupsSection({
  header,
  isLoading,
  emptyMessage,
  groups,
  accent,
  showChevron,
  onPressGroup,
}: {
  header: string;
  isLoading: boolean;
  emptyMessage: string;
  groups: GroupRowData[];
  accent: string;
  /** §5.4: chevrons on joinable rows only — member rows carry time/badge instead. */
  showChevron: boolean;
  onPressGroup: (id: string) => void;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.section}>
      <LandingSectionHeader>{header}</LandingSectionHeader>
      {isLoading ? (
        <ActivityIndicator size="small" color={colors.textSecondary} style={styles.sectionLoading} />
      ) : groups.length === 0 ? (
        <Text style={[styles.sectionEmpty, { color: colors.textTertiary }]}>{emptyMessage}</Text>
      ) : (
        groups.map((group, index) => (
          <View key={group.id}>
            <WaRow
              avatar={{
                imageUrl: group.imageUrl,
                label: group.name,
                // S5.2: the muted per-entity pastel, hashed off the stable
                // group id so a rename doesn't re-color the disc. The kit
                // owns the palette — no flat fill is passed here.
                seed: group.id,
              }}
              title={group.name}
              subtitle={group.subtitle ?? undefined}
              isUnread={(group.unreadCount ?? 0) > 0}
              timestamp={group.timestamp}
              unreadCount={group.unreadCount}
              showMutedDot={group.isMuted && !group.unreadCount}
              showChevron={showChevron}
              accent={accent}
              onPress={() => onPressGroup(group.id)}
            />
            {index < groups.length - 1 ? <WaSeparator inset={WA_SEPARATOR_INSET} /> : null}
          </View>
        ))
      )}
    </View>
  );
}

/**
 * §5.7 — the ⋯ menu the floating trailing circle opens. Holds the actions
 * the removed quick-action row used to expose (Invite, Search) so no
 * destination is lost. Green text is legal here (S5.1: "action-link text").
 */
function CommunityMoreMenu({
  visible,
  accent,
  onClose,
  onInvite,
  onSearch,
}: {
  visible: boolean;
  accent: string;
  onClose: () => void;
  onInvite: () => void;
  onSearch: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[styles.menuOverlay, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityLabel="Close menu"
      >
        <View
          style={[styles.menuCard, { backgroundColor: colors.surfaceGrouped }]}
          onStartShouldSetResponder={() => true}
        >
          <WaCell icon="person-add-outline" title="Invite people" accent={accent} onPress={onInvite} />
          <WaSeparator inset={0} />
          <WaCell icon="search-outline" title="Search" accent={accent} onPress={onSearch} />
        </View>
      </Pressable>
    </Modal>
  );
}

export function CommunityPageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { primaryColor, accentLight } = useCommunityTheme();
  const { user, community } = useAuth();
  const [menuVisible, setMenuVisible] = useState(false);
  // §1.2 dark-mode accent shift — never reuse the light-mode brand hex
  // verbatim in dark mode (see MessageItem/MessageInput/ConvexChatRoomScreen/
  // InviteKitScreen for the same pattern).
  const waAccent = useMemo(() => waAccentPalette(primaryColor, isDark).accent, [primaryColor, isDark]);

  const communityId = community?.id as Id<"communities"> | undefined;
  const isAdmin = user?.is_admin === true;
  const prayerEnabled = community?.churchFeatures?.prayerEnabled === true;
  const userTimezone = user?.timezone || "America/New_York";

  const handleBack = () => {
    if (router.canGoBack()) router.back();
  };

  // --- Announcements: resolve the announcement group's main channel the same
  // way the inbox does (GroupedInboxItem.handleChannelPress). ---
  const inboxChannels = useAuthenticatedQuery(
    api.functions.messaging.channels.getInboxChannels,
    communityId ? { communityId } : "skip"
  );
  const announcementGroup = inboxChannels?.find(
    (g: any) => g.group.isAnnouncementGroup === true
  );
  const announcementChannel = announcementGroup
    ? selectMainChannel(
        announcementGroup.channels.filter(
          (ch: any) => ch.isEnabled !== false && ch.channelType !== "event"
        )
      )
    : undefined;

  const announcementPreview = announcementChannel?.lastMessagePreview
    ? announcementChannel.lastMessageSenderName
      ? `${announcementChannel.lastMessageSenderName}: ${announcementChannel.lastMessagePreview}`
      : announcementChannel.lastMessagePreview
    : undefined;

  const openAnnouncements = () => {
    if (!announcementGroup || !announcementChannel) return;
    // `/inbox/...` is a root-stack card — see `pushOutOfModal` below.
    if (router.canDismiss?.()) router.dismissAll();
    router.push({
      pathname: `/inbox/${announcementGroup.group._id}/${announcementChannel.slug}` as any,
      params: {
        groupName: announcementGroup.group.name,
        groupType: announcementGroup.group.groupTypeName || "",
        groupTypeId: announcementGroup.group.groupTypeId,
        imageUrl: announcementGroup.group.preview || "",
        isLeader: announcementGroup.userRole === "leader" ? "1" : "0",
        isAnnouncementGroup: "1",
        channelId: announcementChannel._id,
      },
    });
  };

  // --- Groups you're in ---
  const myGroups = useAuthenticatedQuery(
    api.functions.groups.queries.listForUser,
    communityId ? { communityId } : "skip"
  );
  const yourGroups = useMemo(
    () => (myGroups ?? []).filter((g: any) => !g.isAnnouncementGroup),
    [myGroups]
  );

  // §5.4 "member rows: last message preview + time/badge". The inbox query
  // above already carries per-group channel metadata, so the preview comes
  // from the group's main channel rather than a second round-trip.
  const groupChatMeta = useMemo(() => {
    const map = new Map<
      string,
      { preview?: string; timestamp?: number; unreadCount?: number; isMuted?: boolean }
    >();
    for (const entry of inboxChannels ?? []) {
      // `selectMainChannel` is generic over its minimal `MainSpotChannel`
      // shape; instantiating it at `any` keeps the richer inbox fields
      // (preview/sender/muted) reachable, exactly as the announcements
      // lookup above does.
      const channel = selectMainChannel<any>(
        ((entry as any).channels as any[]).filter(
          (ch: any) => ch.isEnabled !== false && ch.channelType !== "event"
        )
      );
      if (!channel) continue;
      const preview = channel.lastMessagePreview
        ? channel.lastMessageSenderName
          ? `${channel.lastMessageSenderName}: ${channel.lastMessagePreview}`
          : channel.lastMessagePreview
        : undefined;
      map.set(String((entry as any).group._id), {
        preview,
        timestamp: channel.lastMessageAt,
        unreadCount: channel.unreadCount,
        isMuted: channel.isMuted,
      });
    }
    return map;
  }, [inboxChannels]);

  // §5.1: WhatsApp's floating back circle carries the total unread count
  // ("‹ 62"). Sum across every enabled channel the inbox already loaded.
  const totalUnread = useMemo(() => {
    let total = 0;
    for (const entry of inboxChannels ?? []) {
      for (const ch of ((entry as any).channels as any[]) ?? []) {
        if (ch.isEnabled === false) continue;
        total += ch.unreadCount ?? 0;
      }
    }
    return total;
  }, [inboxChannels]);

  const yourGroupItems: GroupRowData[] = useMemo(
    () =>
      yourGroups.map((g: any) => {
        const meta = groupChatMeta.get(String(g._id));
        return {
          id: g._id,
          name: g.name,
          imageUrl: g.preview,
          // Preview first (§5.4); group type is the fallback when the group
          // has no messages yet.
          subtitle: meta?.preview ?? g.groupType?.name ?? null,
          timestamp: meta?.timestamp ? formatRowTimestamp(meta.timestamp) : undefined,
          unreadCount: meta?.unreadCount,
          isMuted: meta?.isMuted,
        };
      }),
    [yourGroups, groupChatMeta]
  );

  // --- Groups you can join (community explore defaults, same as GroupsScreen) ---
  const exploreDefaults = useAuthenticatedQuery(
    api.functions.admin.settings.getExploreDefaults,
    communityId ? { communityId } : "skip"
  );
  const { data: searchResults, isLoading: suggestedGroupsLoading } = useGroupSearchQuery({
    groupTypeId: exploreDefaults?.groupTypes?.[0],
    limit: 20,
  });
  const suggestedGroups = useMemo(
    () =>
      (searchResults ?? [])
        .filter((g: any) => !g.isMember)
        .slice(0, MAX_SUGGESTED_GROUPS),
    [searchResults]
  );
  const suggestedGroupItems: GroupRowData[] = useMemo(
    () =>
      suggestedGroups.map((g: any) => ({
        id: g.id,
        name: g.name,
        imageUrl: g.preview,
        subtitle: g.memberCount === 1 ? "1 member" : `${g.memberCount} members`,
      })),
    [suggestedGroups]
  );

  // --- This week ---
  const { data: eventsData, isLoading: eventsLoading } = useCommunityEvents({
    dateFilter: "this_week",
    hostingGroups: [],
  });
  const thisWeekEvents = (eventsData?.events ?? []).slice(0, MAX_THIS_WEEK_EVENTS);

  /**
   * This screen renders inside the `(user)` route group, which `app/_layout.tsx`
   * declares `presentation: "modal"`. A native modal sits above EVERY navigator
   * screen, so pushing a root-stack route from here lands the destination
   * *behind* the still-open modal on iOS — the user taps a group and nothing
   * appears to happen. Dismiss the modal stack first, then push.
   *
   * Same pattern (and same comment) as `useStartDirectMessage`,
   * `NotificationFeedScreen` and `NativeRunSheetView`. Destinations that stay
   * INSIDE `(user)` (e.g. `/(user)/invite`) must NOT go through this — they
   * belong to the modal's own stack.
   */
  const pushOutOfModal = (push: () => void) => {
    if (router.canDismiss?.()) router.dismissAll();
    push();
  };

  const goToGroup = (groupId: string) =>
    pushOutOfModal(() => router.push(`/groups/${groupId}` as any));
  const goToEvent = (shortId: string | null) => {
    if (!shortId) return;
    pushOutOfModal(() => router.push(`/e/${shortId}?source=app` as any));
  };
  const goToInvite = () => {
    setMenuVisible(false);
    router.push("/(user)/invite" as any);
  };
  const goToSearch = () => {
    setMenuVisible(false);
    pushOutOfModal(() => router.push("/(tabs)/search" as any));
  };

  const showUtilityRows = prayerEnabled || isAdmin;

  return (
    <View
      style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}
    >
      {/* S1.1 floating chrome: back circle left, ⋯ circle right, no nav bar. */}
      <WaSubScreenHeader
        onBack={handleBack}
        backBadge={totalUnread > 0 ? (totalUnread > 99 ? "99+" : String(totalUnread)) : undefined}
        accent={waAccent}
        trailingButtons={[
          {
            icon: "ellipsis-horizontal",
            onPress: () => setMenuVisible(true),
            accessibilityLabel: "More options",
          },
        ]}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + CTA_PILL_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {/* §5.1 LEFT-aligned identity block — squircle avatar, 22pt bold
            name, 15pt gray "Community". No centered hero (that's the info
            screen, §5.6). */}
        <View style={styles.identityBlock}>
          <WaAvatar
            imageUrl={community?.logo}
            label={community?.name || "Community"}
            seed={communityId ?? community?.name ?? "community"}
            shape="squircle"
            size={IDENTITY_AVATAR_SIZE}
            // The kit's squircle ratio would give 21pt at this size; this block
            // sits directly above the Announcements avatar, which is drawn
            // locally at WA_AVATAR_SQUIRCLE_RADIUS, so pin the two corners equal.
            style={{ borderRadius: IDENTITY_AVATAR_RADIUS }}
          />
          <View style={styles.identityText}>
            <Text style={[styles.identityName, { color: colors.text }]} numberOfLines={2}>
              {community?.name || "Your Community"}
            </Text>
            <Text style={[styles.identitySubtitle, { color: colors.textSecondary }]}>
              Community
            </Text>
          </View>
        </View>

        {/* §5.2 Announcements — white full-bleed row (not an inset card),
            rounded-square accent avatar, preview + time/badge. */}
        {announcementGroup && announcementChannel ? (
          <View style={styles.announcementsSection}>
            <WaRow
              avatar={<AnnouncementsAvatar tint={waAccent} background={accentLight} />}
              title="Announcements"
              isUnread={(announcementChannel.unreadCount ?? 0) > 0}
              subtitle={announcementPreview}
              timestamp={
                announcementChannel.lastMessageAt
                  ? formatRowTimestamp(announcementChannel.lastMessageAt)
                  : undefined
              }
              unreadCount={announcementChannel.unreadCount}
              showMutedDot={announcementChannel.isMuted && !announcementChannel.unreadCount}
              accent={waAccent}
              onPress={openAnnouncements}
            />
          </View>
        ) : null}

        <GroupsSection
          header="Groups you're in"
          isLoading={myGroups === undefined}
          emptyMessage="You haven't joined any groups yet."
          groups={yourGroupItems}
          accent={waAccent}
          showChevron={false}
          onPressGroup={goToGroup}
        />

        <GroupsSection
          header="Groups you can join"
          isLoading={suggestedGroupsLoading}
          emptyMessage="No groups to join right now."
          groups={suggestedGroupItems}
          accent={waAccent}
          showChevron
          onPressGroup={goToGroup}
        />

        {/* This week — same white full-bleed row anatomy. */}
        {!eventsLoading && thisWeekEvents.length > 0 ? (
          <View style={styles.section}>
            <LandingSectionHeader>This week</LandingSectionHeader>
            {thisWeekEvents.map((event: any, index: number) => {
              const zonedDate = toZonedTime(new Date(event.scheduledAt), userTimezone);
              const dateLabel = format(zonedDate, "EEE, M/d", { timeZone: userTimezone });
              const timeLabel = formatTimeWithTimezone(new Date(event.scheduledAt), userTimezone);
              return (
                <View key={event.id}>
                  <WaRow
                    avatar={
                      <EventAvatar
                        background={isDark ? "#2A3942" : "#EFEFEF"}
                        tint={colors.textSecondary}
                      />
                    }
                    title={event.title || "Untitled Event"}
                    subtitle={`${dateLabel} · ${timeLabel}`}
                    showChevron
                    onPress={() => goToEvent(event.shortId)}
                  />
                  {index < thisWeekEvents.length - 1 ? (
                    <WaSeparator inset={WA_SEPARATOR_INSET} />
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Togather-plus utility rows — plain monochrome cells on the same
            white surface, no colored icon chips (§7). */}
        {showUtilityRows ? (
          <View style={styles.utilitySection}>
            {prayerEnabled ? (
              <WaCell
                icon="heart-outline"
                title="Prayer"
                onPress={() =>
                  pushOutOfModal(() => router.push("/(tabs)/prayer" as any))
                }
              />
            ) : null}
            {prayerEnabled && isAdmin ? <WaSeparator inset={WA_SEPARATOR_INSET} /> : null}
            {isAdmin ? (
              <WaCell
                icon="shield-checkmark-outline"
                title="Admin"
                onPress={() =>
                  pushOutOfModal(() => router.push("/(tabs)/admin" as any))
                }
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* §5.5 the screen's single green CTA — a floating full-width pill over
          the content. Labelled for the affordance that actually exists here
          (join/browse), not WA's "Add group" create flow. */}
      <View style={[styles.ctaWrap, { bottom: insets.bottom + 12 }]} pointerEvents="box-none">
        <Pressable
          onPress={goToSearch}
          accessibilityRole="button"
          accessibilityLabel="Find your group"
          style={({ pressed }) => [
            styles.ctaPill,
            WA_FLOATING_SHADOW,
            { backgroundColor: waAccent, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
          <Text style={styles.ctaPillText}>Find your group</Text>
        </Pressable>
      </View>

      <CommunityMoreMenu
        visible={menuVisible}
        accent={waAccent}
        onClose={() => setMenuVisible(false)}
        onInvite={goToInvite}
        onSearch={goToSearch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  identityBlock: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 12,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  identityName: {
    fontSize: WA_TYPE_HEADER_BLOCK,
    fontWeight: WA_WEIGHT_BOLD,
  },
  identitySubtitle: {
    fontSize: WA_TYPE_SUBTITLE,
    marginTop: 2,
  },
  announcementsSection: {
    marginBottom: 4,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    fontSize: WA_TYPE_SECTION_HEADER,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingBottom: 6,
  },
  sectionLoading: {
    marginTop: 12,
    alignSelf: "flex-start",
    marginLeft: WA_GROUP_MARGIN,
  },
  sectionEmpty: {
    fontSize: WA_TYPE_SUBTITLE,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 4,
  },
  utilitySection: {
    marginTop: 20,
  },
  announcementsAvatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  eventAvatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  ctaWrap: {
    position: "absolute",
    left: WA_GROUP_MARGIN,
    right: WA_GROUP_MARGIN,
  },
  ctaPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: CTA_PILL_HEIGHT,
    borderRadius: CTA_PILL_HEIGHT / 2,
  },
  ctaPillText: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    color: "#FFFFFF",
  },
  menuOverlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 96,
    paddingRight: WA_GROUP_MARGIN,
  },
  menuCard: {
    minWidth: 220,
    borderRadius: 14,
    overflow: "hidden",
  },
});
