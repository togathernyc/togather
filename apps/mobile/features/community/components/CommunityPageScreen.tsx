/**
 * CommunityPageScreen
 *
 * The WhatsApp "community info" analog (docs/plans/church-migration-ui-redesign
 * /README.md, "W2 — Community page"). A pushed screen — not a tab — opened
 * from the Chats list header when the whatsapp-shell flag is on. Read-only v1:
 * centered hero (branded identity + "Community · N groups"), quick-action
 * row, Community/Announcements segmented control, Announcements entry,
 * Groups you're in, Groups you can join (+ "Find your group"), This week's
 * events, and role-gated Prayer/Admin cells.
 *
 * Styled to WHATSAPP-DESIGN-SYSTEM.md §1/§3/§4/§6/§8 ("Community page"
 * checklist) fidelity using the `components/wa/*` foundation kit — see that
 * doc for the anatomy each section below implements.
 *
 * Quick-action row (§3.2/§6/§8) maps to real destinations only — this
 * screen has no "Add Members"/"Add Groups" mutation to launch a sheet for,
 * so only Invite (`/(user)/invite`) and Search (`/(tabs)/search`) render,
 * per the design-system contract's "skip actions with no destination" rule.
 *
 * The Community/Announcements segmented control (§3.2, "Tab-style segmented
 * control") is the simplest faithful reading of the spec: "Community" is
 * always the active/rendered state (this screen's own sections, below);
 * tapping "Announcements" navigates straight to the announcement channel —
 * the same destination the Announcements row further down opens — rather
 * than building a second in-screen feed.
 *
 * Route: /(user)/community
 *
 * Backend (all pre-existing, no new Convex functions added):
 * - messaging.channels.getInboxChannels — resolves the Announcements group's
 *   main channel, same lookup ChatInboxScreen/GroupedInboxItem use. Also
 *   supplies the preview/timestamp/unread data for the Announcements row and
 *   gates whether the segmented control renders (no channel = no control).
 * - groups.queries.listForUser — "Groups you're in".
 * - groupSearch.searchGroupsWithMembership — "Groups you can join" (community
 *   explore defaults applied, same as GroupsScreen). This endpoint doesn't
 *   return a join-type/approval field, so rows stay chevron-only navigation
 *   (no Join/Request pill) per the design-system contract — no new mutation
 *   added this pass.
 * - admin.settings.getExploreDefaults — community's default group-type filter.
 * - meetings.explore.communityEvents (via useCommunityEvents) — "This week".
 *
 * Data not available to this screen (rendered without, per contract):
 * - Total community group/member count for the identity subtitle — falls
 *   back to the count of groups the user is in ("Community · N groups"),
 *   since that's the only group count already fetched here.
 * - Admin adoption/pending counts — the Admin cell has no value label.
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
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
import { AppImage } from "@components/ui/AppImage";
import { useGroupSearchQuery } from "@features/groups/hooks/useGroups";
import { useCommunityEvents } from "@features/events/hooks/useCommunityEvents";
import { selectMainChannel } from "@features/chat/utils/selectMainChannel";
import {
  WaRow,
  WaInsetGroup,
  WaCell,
  WaSectionLabel,
  WA_GROUP_MARGIN,
  WA_GROUP_SPACING,
  WA_AVATAR_LG,
  WA_AVATAR_SQUIRCLE_RADIUS,
  WA_AVATAR_PROFILE,
  WA_QUICK_ACTION_CIRCLE,
  WA_SEGMENTED_HEIGHT,
} from "@components/wa";

const MAX_SUGGESTED_GROUPS = 3;
const MAX_THIS_WEEK_EVENTS = 8;

/** Hero identity avatar — the profile-hero scale (§6) built from the same
 * squircle-radius ratio as the §3.1 list avatar (56pt → 18pt radius) so it
 * scales proportionally rather than using an arbitrary size. */
const HERO_AVATAR_SIZE = WA_AVATAR_PROFILE;
const HERO_AVATAR_RADIUS = HERO_AVATAR_SIZE * (WA_AVATAR_SQUIRCLE_RADIUS / WA_AVATAR_LG);

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

/** §7 "leading small circular icon" — a plain circular icon bubble matching
 * avatar geometry, used sparingly (one per row-type, not one per row). */
function WaIconAvatar({
  icon,
  tint,
  background,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  background: string;
}) {
  return (
    <View
      style={[
        styles.iconAvatar,
        { width: WA_AVATAR_LG, height: WA_AVATAR_LG, borderRadius: WA_AVATAR_LG / 2, backgroundColor: background },
      ]}
    >
      <Ionicons name={icon} size={22} color={tint} />
    </View>
  );
}

/** §3.2/§6/§8 quick-action row button — accent-tinted circular icon
 * (`WA_QUICK_ACTION_CIRCLE`), no fill, with a 13pt label below, no card
 * container (floats directly on `bg.grouped`). */
function WaQuickAction({
  icon,
  label,
  accent,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={styles.quickAction} hitSlop={8}>
      <View
        style={[
          styles.quickActionCircle,
          { width: WA_QUICK_ACTION_CIRCLE, height: WA_QUICK_ACTION_CIRCLE },
        ]}
      >
        <Ionicons name={icon} size={22} color={accent} />
      </View>
      <Text style={[styles.quickActionLabel, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

type GroupRowData = {
  id: string;
  name: string;
  imageUrl?: string | null;
  subtitle?: string | null;
};

/** Shared anatomy for "Groups you're in" / "Groups you can join" — a
 * WaSectionLabel + inset group of WaRows (§3.2), with a header-only fallback
 * (no empty white card) while loading or when there's nothing to show. */
function GroupsSection({
  header,
  isLoading,
  emptyMessage,
  groups,
  accent,
  onPressGroup,
}: {
  header: string;
  isLoading: boolean;
  emptyMessage: string;
  groups: GroupRowData[];
  accent: string;
  onPressGroup: (id: string) => void;
}) {
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View>
        <WaSectionLabel>{header}</WaSectionLabel>
        <ActivityIndicator size="small" color={colors.textSecondary} style={styles.sectionLoading} />
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <View>
        <WaSectionLabel>{header}</WaSectionLabel>
        <WaSectionLabel variant="footer">{emptyMessage}</WaSectionLabel>
      </View>
    );
  }

  return (
    <WaInsetGroup header={header}>
      {groups.map((group) => (
        <WaRow
          key={group.id}
          avatar={{ imageUrl: group.imageUrl, label: group.name, backgroundColor: accent }}
          title={group.name}
          subtitle={group.subtitle ?? undefined}
          showChevron
          onPress={() => onPressGroup(group.id)}
        />
      ))}
    </WaInsetGroup>
  );
}

export function CommunityPageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { primaryColor, accentLight } = useCommunityTheme();
  const { user, community } = useAuth();
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
  const yourGroupItems: GroupRowData[] = useMemo(
    () =>
      yourGroups.map((g: any) => ({
        id: g._id,
        name: g.name,
        imageUrl: g.preview,
        subtitle: g.groupType?.name ?? null,
      })),
    [yourGroups]
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

  const goToGroup = (groupId: string) => router.push(`/groups/${groupId}` as any);
  const goToEvent = (shortId: string | null) => {
    if (!shortId) return;
    router.push(`/e/${shortId}?source=app` as any);
  };

  const groupCount = myGroups !== undefined ? yourGroups.length : undefined;
  const identitySubtitle =
    groupCount !== undefined
      ? `Community · ${groupCount} ${groupCount === 1 ? "group" : "groups"}`
      : "Community";

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.backgroundGrouped },
      ]}
    >
      <View style={styles.navBar}>
        <Pressable onPress={handleBack} hitSlop={12} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Community identity — centered squircle hero avatar (§6, the one
            squircle in the system, profile-hero scale per §8), name,
            "Community · N groups" hero subtitle (§2). */}
        <View style={styles.identityRow}>
          <AppImage
            source={community?.logo}
            style={{
              width: HERO_AVATAR_SIZE,
              height: HERO_AVATAR_SIZE,
              borderRadius: HERO_AVATAR_RADIUS,
            }}
            optimizedWidth={HERO_AVATAR_SIZE * 2}
            placeholder={{
              type: "initials",
              name: community?.name || "Community",
              backgroundColor: waAccent,
            }}
          />
          <Text style={[styles.identityName, { color: colors.text }]} numberOfLines={2}>
            {community?.name || "Your Community"}
          </Text>
          <Text style={[styles.identitySubtitle, { color: colors.textSecondary }]}>
            {identitySubtitle}
          </Text>
        </View>

        {/* Quick-action row (§3.2/§6/§8) — accent-icon-only circular
            buttons, no fill. Mapped to real destinations only: this
            screen has no "Add Members"/"Add Groups" mutation to launch, so
            only Invite/Search render (see report). */}
        <View style={styles.quickActionRow}>
          <WaQuickAction
            icon="person-add-outline"
            label="Invite"
            accent={waAccent}
            onPress={() => router.push("/(user)/invite" as any)}
          />
          <WaQuickAction
            icon="search-outline"
            label="Search"
            accent={waAccent}
            onPress={() => router.push("/(tabs)/search" as any)}
          />
        </View>

        {/* Community/Announcements segmented control (§3.2/§8) —
            "Community" shows this screen's existing sections below (no
            second feed built, per contract); "Announcements" navigates
            straight to the announcement channel, the same destination the
            Announcements row further down opens. */}
        {announcementGroup && announcementChannel ? (
          // Deliberate deviation from §3.2's bg.grouped track: this screen
          // itself sits on backgroundGrouped, which would make the track
          // invisible — separator gives it the visible recessed fill.
          <View style={[styles.segmentedTrack, { backgroundColor: colors.separator }]}>
            <View style={[styles.segmentedPill, { backgroundColor: colors.surfaceGrouped }]}>
              <Text style={[styles.segmentedLabel, styles.segmentedLabelSelected, { color: colors.text }]}>
                Community
              </Text>
            </View>
            <Pressable
              onPress={openAnnouncements}
              style={styles.segmentedPill}
              accessibilityRole="button"
              accessibilityLabel="Open Announcements"
            >
              <Text style={[styles.segmentedLabel, { color: colors.textSecondary }]}>
                Announcements
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Announcements — WaRow inside an inset group (§3.2), megaphone
            icon-bubble avatar, latest preview line, timestamp + unread badge. */}
        {announcementGroup && announcementChannel ? (
          <View style={styles.section}>
            <WaInsetGroup>
              <WaRow
                avatar={<WaIconAvatar icon="megaphone" tint={waAccent} background={accentLight} />}
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
                showChevron
                accent={waAccent}
                onPress={openAnnouncements}
              />
            </WaInsetGroup>
          </View>
        ) : null}

        {/* Groups you're in */}
        <View style={styles.section}>
          <GroupsSection
            header="Groups you're in"
            isLoading={myGroups === undefined}
            emptyMessage="You haven't joined any groups yet."
            groups={yourGroupItems}
            accent={waAccent}
            onPressGroup={goToGroup}
          />
        </View>

        {/* Groups you can join + "Find your group" — the WhatsApp "Add
            group" pill (§1.3: brand-mapped, accent-filled) at the section
            bottom. No Join/Request pill on individual rows: this screen's
            data has no join-type/approval field to key it off (see file
            header), so rows stay chevron-only navigation, unchanged from
            before. */}
        <View style={styles.section}>
          <GroupsSection
            header="Groups you can join"
            isLoading={suggestedGroupsLoading}
            emptyMessage="No groups to join right now."
            groups={suggestedGroupItems}
            accent={waAccent}
            onPressGroup={goToGroup}
          />
          <Pressable
            onPress={() => router.push("/(tabs)/search" as any)}
            style={({ pressed }) => [
              styles.addGroupPill,
              { backgroundColor: waAccent, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.addGroupPillText}>Find your group</Text>
          </Pressable>
        </View>

        {/* This week — inset group of WaRows (calendar icon-bubble, event
            title, time subtitle), replacing the old horizontal card strip. */}
        {!eventsLoading && thisWeekEvents.length > 0 ? (
          <View style={styles.section}>
            <WaInsetGroup header="This week">
              {thisWeekEvents.map((event: any) => {
                const zonedDate = toZonedTime(new Date(event.scheduledAt), userTimezone);
                const dateLabel = format(zonedDate, "EEE, M/d", { timeZone: userTimezone });
                const timeLabel = formatTimeWithTimezone(new Date(event.scheduledAt), userTimezone);
                return (
                  <WaRow
                    key={event.id}
                    avatar={<WaIconAvatar icon="calendar" tint={waAccent} background={accentLight} />}
                    title={event.title || "Untitled Event"}
                    subtitle={`${dateLabel} · ${timeLabel}`}
                    showChevron
                    onPress={() => goToEvent(event.shortId)}
                  />
                );
              })}
            </WaInsetGroup>
          </View>
        ) : null}

        {/* Togather-plus utility rows — inset-grouped cells (§3.2/§7), not
            custom cards: plain monochrome glyphs, no colored icon chips. */}
        {prayerEnabled || isAdmin ? (
          <View style={styles.section}>
            <WaInsetGroup>
              {prayerEnabled ? (
                <WaCell
                  icon="heart-outline"
                  title="Prayer"
                  onPress={() => router.push("/(tabs)/prayer" as any)}
                />
              ) : null}
              {isAdmin ? (
                <WaCell
                  icon="shield-checkmark-outline"
                  title="Admin"
                  onPress={() => router.push("/(tabs)/admin" as any)}
                />
              ) : null}
            </WaInsetGroup>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    paddingHorizontal: 8,
  },
  backButton: {
    padding: 4,
  },
  identityRow: {
    alignItems: "center",
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingTop: 12,
    paddingBottom: 20,
  },
  identityName: {
    fontSize: 22,
    fontWeight: "700",
    marginTop: 12,
    textAlign: "center",
  },
  identitySubtitle: {
    fontSize: 15,
    marginTop: 2,
    textAlign: "center",
  },
  quickActionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 40,
    paddingBottom: 20,
  },
  quickAction: {
    alignItems: "center",
    width: 72,
  },
  quickActionCircle: {
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionLabel: {
    fontSize: 13,
    marginTop: 4,
  },
  segmentedTrack: {
    flexDirection: "row",
    marginHorizontal: WA_GROUP_MARGIN,
    marginBottom: WA_GROUP_SPACING,
    height: WA_SEGMENTED_HEIGHT,
    borderRadius: WA_SEGMENTED_HEIGHT / 2,
    padding: 2,
  },
  segmentedPill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: (WA_SEGMENTED_HEIGHT - 4) / 2,
  },
  segmentedLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  segmentedLabelSelected: {
    fontWeight: "600",
  },
  section: {
    marginTop: WA_GROUP_SPACING,
  },
  sectionLoading: {
    marginTop: 12,
  },
  iconAvatar: {
    alignItems: "center",
    justifyContent: "center",
  },
  addGroupPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: WA_GROUP_MARGIN,
    marginTop: 12,
    height: 44,
    borderRadius: 22,
  },
  addGroupPillText: {
    fontSize: 17,
    fontWeight: "600",
    color: "#FFFFFF",
  },
});
