/**
 * CommunityPageScreen
 *
 * The WhatsApp "community info" analog (docs/plans/church-migration-ui-redesign
 * /README.md, "W2 — Community page"). A pushed screen — not a tab — opened
 * from the Chats list header when the whatsapp-shell flag is on. Read-only v1:
 * branded header, Announcements entry, Your groups, Groups you can join (+
 * "Find your group"), This week's events, and role-gated Prayer/Admin cards.
 *
 * Route: /(user)/community
 *
 * Backend (all pre-existing, no new Convex functions added):
 * - messaging.channels.getInboxChannels — resolves the Announcements group's
 *   main channel, same lookup ChatInboxScreen/GroupedInboxItem use.
 * - groups.queries.listForUser — "Your groups".
 * - groupSearch.searchGroupsWithMembership — "Groups you can join" (community
 *   explore defaults applied, same as GroupsScreen).
 * - admin.settings.getExploreDefaults — community's default group-type filter.
 * - meetings.explore.communityEvents (via useCommunityEvents) — "This week".
 */
import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { Avatar } from "@components/ui";
import { useGroupSearchQuery } from "@features/groups/hooks/useGroups";
import { useCommunityEvents } from "@features/events/hooks/useCommunityEvents";
import { EventCardRow } from "@features/events/components/EventCardRow";
import { selectMainChannel } from "@features/chat/utils/selectMainChannel";

const MAX_SUGGESTED_GROUPS = 3;
const MAX_THIS_WEEK_EVENTS = 8;

export function CommunityPageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { primaryColor, accentLight } = useCommunityTheme();
  const { user, community } = useAuth();

  const communityId = community?.id as Id<"communities"> | undefined;
  const isAdmin = user?.is_admin === true;
  const prayerEnabled = community?.churchFeatures?.prayerEnabled === true;

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

  // --- Your groups ---
  const myGroups = useAuthenticatedQuery(
    api.functions.groups.queries.listForUser,
    communityId ? { communityId } : "skip"
  );
  const yourGroups = useMemo(
    () => (myGroups ?? []).filter((g: any) => !g.isAnnouncementGroup),
    [myGroups]
  );

  // --- Groups you can join (community explore defaults, same as GroupsScreen) ---
  const exploreDefaults = useAuthenticatedQuery(
    api.functions.admin.settings.getExploreDefaults,
    communityId ? { communityId } : "skip"
  );
  const { data: searchResults } = useGroupSearchQuery({
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

  // --- This week ---
  const { data: eventsData, isLoading: eventsLoading } = useCommunityEvents({
    dateFilter: "this_week",
    hostingGroups: [],
  });
  const thisWeekEvents = (eventsData?.events ?? []).slice(0, MAX_THIS_WEEK_EVENTS);

  const goToGroup = (groupId: string) => router.push(`/groups/${groupId}` as any);

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text
          style={[styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          Community
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Branded header band */}
        <View style={[styles.brandBand, { backgroundColor: accentLight }]}>
          <Avatar
            name={community?.name || "Community"}
            imageUrl={community?.logo ?? null}
            size={64}
          />
          <Text style={[styles.brandName, { color: colors.text }]} numberOfLines={2}>
            {community?.name || "Your Community"}
          </Text>
        </View>

        {/* Announcements */}
        {announcementGroup && announcementChannel && (
          <TouchableOpacity
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={openAnnouncements}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.iconBubble,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <Ionicons name="megaphone" size={20} color={primaryColor} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>
                Announcements
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                Only leaders can post here
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}

        {/* Your groups */}
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
          YOUR GROUPS
        </Text>
        {myGroups === undefined ? (
          <ActivityIndicator
            size="small"
            color={colors.text}
            style={styles.sectionLoading}
          />
        ) : yourGroups.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            You haven't joined any groups yet.
          </Text>
        ) : (
          yourGroups.map((group: any) => (
            <GroupRow
              key={group._id}
              name={group.name}
              imageUrl={group.preview}
              subtitle={group.groupType?.name}
              onPress={() => goToGroup(group._id)}
            />
          ))
        )}

        {/* Groups you can join */}
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
          GROUPS YOU CAN JOIN
        </Text>
        {suggestedGroups.map((group: any) => (
          <GroupRow
            key={group.id}
            name={group.name}
            imageUrl={group.preview}
            subtitle={
              group.memberCount === 1 ? "1 member" : `${group.memberCount} members`
            }
            onPress={() => goToGroup(group.id)}
          />
        ))}
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: colors.border }]}
          onPress={() => router.push("/(tabs)/search" as any)}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.iconBubble,
              { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <Ionicons name="compass" size={20} color={primaryColor} />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>
              Find your group
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>

        {/* This week */}
        {eventsLoading ? null : thisWeekEvents.length > 0 && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              THIS WEEK
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thisWeekScroll}
            >
              {thisWeekEvents.map((event: any) => (
                <View key={event.id} style={styles.thisWeekCard}>
                  <EventCardRow event={event} />
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {/* Prayer */}
        {prayerEnabled && (
          <TouchableOpacity
            style={[styles.row, { borderBottomColor: colors.border, marginTop: 8 }]}
            onPress={() => router.push("/(tabs)/prayer" as any)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.iconBubble,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <Ionicons name="heart" size={20} color={primaryColor} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Prayer</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}

        {/* Admin */}
        {isAdmin && (
          <TouchableOpacity
            style={[styles.row, { borderBottomColor: colors.border }]}
            onPress={() => router.push("/(tabs)/admin" as any)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.iconBubble,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <Ionicons name="shield-checkmark" size={20} color={primaryColor} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Admin</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

// Shared row shape for "Your groups" and "Groups you can join" — identical
// layout, only the subtitle source differs, so one small local component
// instead of duplicating the row twice.
function GroupRow({
  name,
  imageUrl,
  subtitle,
  onPress,
}: {
  name: string;
  imageUrl?: string | null;
  subtitle?: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Avatar name={name} imageUrl={imageUrl} size={44} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
        {subtitle && (
          <Text
            style={[styles.rowSubtitle, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  headerSpacer: {
    width: 36,
  },
  brandBand: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 10,
  },
  brandName: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionLoading: {
    paddingVertical: 12,
  },
  emptyText: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  rowSubtitle: {
    fontSize: 13,
  },
  thisWeekScroll: {
    paddingHorizontal: 12,
    gap: 12,
  },
  thisWeekCard: {
    width: 280,
  },
});
