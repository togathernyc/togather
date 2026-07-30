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
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { useIsDesktopWeb } from "../../../hooks/useIsDesktopWeb";
import { Ionicons } from "@expo/vector-icons";
import { ResourceIcon } from "@components/ui/ResourceIcon";
import { useAuth } from "@providers/AuthProvider";
import { AppImage } from "@components/ui";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import {
  WaAvatar,
  WaBadge,
  WA_LIST_AVATAR,
  WA_LIST_SEPARATOR_INSET,
  formatWaListTimestamp,
  waNeutralAvatarPalette,
} from "@components/wa";
import { getGroupTypeColorScheme } from "../../../constants/groupTypes";
import type { Id } from "@services/api/convex";
import { useAwaitPrefetch, useTriggerPrefetch } from "../hooks/usePrefetchChannel";
import { selectMainChannel } from "../utils/selectMainChannel";

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
  isEnabled?: boolean;
  meetingId?: Id<"meetings">;
  meetingScheduledAt?: number | null;
  /**
   * Whether the current user has muted this channel
   * (`chatChannelMembers.isMuted`, surfaced additively by `getInboxChannels`).
   * Drives the flag-gated Channel hygiene rules below — muted channels never
   * occupy a sub-row slot and are excluded from the aggregated unread badge.
   * See docs/plans/church-migration-ui-redesign/README.md, "Channel hygiene".
   */
  isMuted?: boolean;
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

// Inbox-flagged resources shown under a group (from getInboxResourcesForUser).
interface InboxResourceData {
  _id: Id<"groupResources">;
  title: string;
  icon?: string;
  linkUrl?: string;
}

export interface GroupedInboxItemProps {
  group: GroupData;
  channels: ChannelData[];
  userRole: "leader" | "member";
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  activeGroupId?: string;
  activeChannelSlug?: string;
  /** Resources flagged to show under this group in the inbox. */
  resources?: InboxResourceData[];
  /**
   * Serving mode flattens each of a team's channels into its own inbox row, so
   * they'd otherwise all render with the same team name (e.g. three "Worship
   * Team" rows). When true, the row title becomes a distinguishing
   * `#team-channel` label derived from the channel's identity instead.
   */
  servingMode?: boolean;
}

/**
 * Turn a slug-ish string into a readable, title-cased label
 * (e.g. "worship-team" → "Worship Team").
 */
function humanize(value: string): string {
  return value
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Build a readable DISPLAY NAME for a serving-mode inbox row.
 *
 * Serving mode flattens each of a team's channels into its own row, so the
 * title must distinguish them without ever falling back to a raw `#slug`.
 * Always prefer the channel's own name; for the well-known system channels
 * (which rarely surface in serving mode) fall back to a humanized team-scoped
 * label.
 */
function getServingChannelLabel(teamName: string, channel: ChannelData): string {
  const name = channel.name?.trim();
  switch (channel.channelType) {
    case "main":
      return name || `${humanize(teamName)} General`;
    case "leaders":
      return name || `${humanize(teamName)} Leaders`;
    case "announcements":
      return name || `${humanize(teamName)} Announcements`;
    case "cross_team":
      // Cross-team channels always carry a distinct 1-50 char name; prefer it.
      return name || humanize(teamName);
    default:
      // Custom / pco_services channels carry their own distinct
      // name from the backend — prefer it since it's already meaningful.
      return name || humanize(teamName);
  }
}

// Channel hygiene cluster cap (flag-gated, whatsapp-shell only): the main
// channel plus at most this many sub-rows. See docs/plans/church-migration
// -ui-redesign/README.md, "Channel hygiene".
const MAX_SECONDARY_CHANNELS = 2;

// --- WhatsApp-shell row anatomy (flag-gated) --------------------------------
// Flat, full-bleed rows matching WhatsApp's Chats list: avatar, title + gray
// preview line, a top-aligned right column with timestamp above the unread
// badge, and hairline separators instead of card gaps. Only used when
// `whatsappShellEnabled` — the flag-off layout above is untouched.
//
// Density comes from the kit (WA-VISUAL-DELTAS.md S6.1: ~58pt avatar, ~78pt
// row) rather than being re-typed here, so this list and every other flat
// WaRow list share one rhythm. Sub-rows stay deliberately smaller — the
// channel cluster is an intentional Togather divergence (per-screen §1.5) and
// the size step is what reads as "nested under the row above".
const WA_MAIN_AVATAR_SIZE = WA_LIST_AVATAR; // 56
const WA_SUB_AVATAR_SIZE = 44;
// Separator inset so the hairline starts at the title's x-position.
const WA_SEPARATOR_INSET_MAIN = WA_LIST_SEPARATOR_INSET; // 86
const WA_SEPARATOR_INSET_SUB = 16 + WA_SUB_AVATAR_SIZE + 12; // 72
// "Archived"-style utility row (per-screen §1.5): a small icon *well* rather
// than an avatar, so the row reads as a control, not as another chat.
const WA_UTILITY_ICON_WELL = 36;

/**
 * Avatar for a channel sub-row: the PARENT GROUP's avatar (photo when it has
 * one, otherwise the group's pastel initials disc), rendered muted, with the
 * channel's own glyph as a small corner badge.
 *
 * Owner directive (2026-07-29). The previous neutral "#" disc gave every
 * cluster's sub-rows the same anonymous gray blob, so a scan of the list
 * couldn't tell which group a sub-row belonged to. Reusing the parent's
 * avatar makes the cluster read as one family; the ~55% opacity plus the
 * smaller size step is what keeps it subordinate to the cluster header
 * directly above rather than competing with it.
 *
 * The badge deliberately stays at FULL opacity — it's the row's identity
 * ("this is a channel, not the group itself"), and muting it too made it
 * illegible at this size. It's also visually distinct from the slashed-bell
 * mute badge `WaAvatar` renders (bottom-right ring vs. this filled disc), so a
 * muted row still reads as muted.
 */
function WaChannelAvatar({
  channelType,
  size,
  isDark,
  group,
  surfaceColor,
}: {
  channelType: string;
  size: number;
  isDark: boolean;
  group: { _id: string; name: string; preview?: string | null };
  surfaceColor: string;
}) {
  const palette = waNeutralAvatarPalette(isDark);
  const badgeSize = Math.round(size * 0.41); // 18 at the 44pt sub-row avatar
  return (
    <View style={[styles.waSubAvatarWrap, { width: size, height: size }]}>
      <View style={styles.waSubAvatarMuted}>
        <WaAvatar
          imageUrl={group.preview}
          label={group.name}
          seed={group._id}
          shape="circle"
          size={size}
        />
      </View>
      <View
        style={[
          styles.waChannelBadge,
          {
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeSize / 2,
            backgroundColor: palette.background,
            borderColor: surfaceColor,
          },
        ]}
      >
        {channelType === "announcements" ? (
          <Ionicons name="megaphone" size={badgeSize * 0.55} color={palette.foreground} />
        ) : (
          <Text
            style={[
              styles.waIconGlyph,
              { color: palette.foreground, fontSize: badgeSize * 0.62 },
            ]}
          >
            #
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * WhatsApp-anatomy right column: timestamp (accent-colored when the row has
 * unread activity) stacked above the unread badge / muted dot / spinner.
 *
 * `badgeChevron` (S6.3) folds the disclosure chevron *inside* the unread
 * capsule ("7 ›") for rows that stand for a container of chats — the group
 * parent of a channel cluster, and announcement groups.
 */
function WaRightColumn({
  timestamp,
  hasUnread,
  unreadCount,
  showMutedDot,
  isLoading,
  badgeChevron,
  primaryColor,
  colors,
}: {
  timestamp?: string;
  hasUnread: boolean;
  unreadCount?: number;
  showMutedDot?: boolean;
  isLoading?: boolean;
  badgeChevron?: boolean;
  primaryColor: string;
  colors: { textTertiary: string };
}) {
  return (
    <View style={styles.waRightColumn}>
      {timestamp ? (
        <Text
          style={[styles.waTimestamp, { color: hasUnread ? primaryColor : colors.textTertiary }]}
          numberOfLines={1}
        >
          {timestamp}
        </Text>
      ) : null}
      {isLoading ? (
        <ActivityIndicator size="small" color={primaryColor} style={styles.waRightColumnSpacer} />
      ) : hasUnread && unreadCount ? (
        <View style={styles.waBadgeSlot}>
          <WaBadge count={unreadCount} color={primaryColor} showChevron={badgeChevron} />
        </View>
      ) : showMutedDot ? (
        <View style={[styles.waMutedDot, { backgroundColor: colors.textTertiary }]} />
      ) : null}
    </View>
  );
}

/** Hairline row separator, inset so it starts at the text column. */
function WaSeparator({ inset, borderColor }: { inset: number; borderColor: string }) {
  return <View style={[styles.waSeparator, { marginLeft: inset, backgroundColor: borderColor }]} />;
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
  resources,
  servingMode = false,
}: GroupedInboxItemProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const isDesktopWeb = useIsDesktopWeb();
  // Chats-list hygiene (cluster caps, muted sink, N-more collapse) — flag-gated
  // per docs/plans/church-migration-ui-redesign/README.md, "Channel hygiene".
  // Flag off leaves every behavior below byte-identical to before.
  const whatsappShellEnabled = useWhatsappShell();
  const userId = user?.id as Id<"users"> | undefined;
  const isLeader = userRole === "leader";
  const badgeColors = getBadgeColors(group.groupTypeId);
  const isActiveGroup = activeGroupId === group._id;
  // S6.4 (flag-on only): the squircle is the system's one shape-based
  // semantic — it marks a row that *parents* other chats rather than being a
  // chat itself. Here that's the community's announcement group; the
  // multi-channel cluster header below takes it too. Everything else (single
  // groups, people, DMs) stays a circle.
  const isAnnouncementGroup = group.isAnnouncementGroup === true;

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

  // Calculate total unread count for the group. Flag on: muted channels are
  // excluded from the aggregate (Channel hygiene rule 2) — a muted channel's
  // unread never bumps the group's number.
  const totalUnread = useMemo(() => {
    if (!whatsappShellEnabled) {
      return channels.reduce((sum, ch) => sum + ch.unreadCount, 0);
    }
    return channels.reduce(
      (sum, ch) => sum + (ch.isMuted ? 0 : ch.unreadCount),
      0
    );
  }, [channels, whatsappShellEnabled]);

  // True only when every channel with unread activity is muted — the badge
  // above hides that unread, so a quiet dot signals "something happened here"
  // without a number, rather than the row looking fully caught-up.
  const hasMutedOnlyUnread = useMemo(
    () =>
      whatsappShellEnabled &&
      totalUnread === 0 &&
      channels.some((ch) => ch.isMuted && ch.unreadCount > 0),
    [whatsappShellEnabled, totalUnread, channels]
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

  // Open a resource shown under the group: redirect to its link if it has one,
  // otherwise open the resource detail page.
  const handleResourcePress = useCallback(
    (resource: InboxResourceData) => {
      if (resource.linkUrl) {
        Linking.openURL(resource.linkUrl).catch((err) => {
          console.error("[GroupedInboxItem] Failed to open resource link:", err);
        });
        return;
      }
      router.push(`/(user)/group/${group._id}/resource/${resource._id}` as any);
    },
    [router, group._id]
  );

  // NOTE: there is deliberately no flag-on resource ROW. Under the whatsapp
  // shell, inbox resources are lifted out of the list entirely and rendered as
  // a horizontal chip row under the search pill in `ChatInboxScreen`'s header
  // (owner directive, 2026-07-29): a full 76pt chat-anatomy row for "Giving" or
  // "Bulletin" made a static link look like an unread conversation, and one
  // per group meant they interleaved through the list instead of reading as one
  // set of shortcuts. `resources` is still accepted here — the flag-off layout
  // below is unchanged.

  // Resource sub-rows rendered under the group, styled like sub-channels with
  // the same L-connector. Shared between the single- and multi-channel layouts.
  const resourceRows =
    resources && resources.length > 0 ? (
      <View>
        {resources.map((resource) => (
          <View key={resource._id} style={styles.subChannelContainer}>
            <View style={styles.connectorContainer}>
              <View style={[styles.connectorVertical, { backgroundColor: colors.border }]} />
              <View style={[styles.connectorHorizontal, { backgroundColor: colors.border }]} />
            </View>
            <Pressable
              onPress={() => handleResourcePress(resource)}
              style={({ pressed }) => [
                styles.subChannelCard,
                { backgroundColor: colors.surfaceSecondary, borderColor: "transparent" },
                pressed && { backgroundColor: isDark ? colors.border : "#E8E8E8" },
              ]}
            >
              <ResourceIcon name={resource.icon} size={16} color={colors.textSecondary} />
              <Text
                style={[styles.resourceRowTitle, { color: colors.text }]}
                numberOfLines={1}
              >
                {resource.title}
              </Text>
              <Ionicons
                name={resource.linkUrl ? "open-outline" : "chevron-forward"}
                size={14}
                color={colors.textTertiary}
              />
            </Pressable>
          </View>
        ))}
      </View>
    ) : null;

  // Get the most recent channel for single-channel display
  const primaryChannel = channels[0];

  // Single channel display - simple row (same layout as original ChatInboxScreen)
  if (isSingleChannel && primaryChannel) {
    // Under the whatsapp shell, a muted channel's unread doesn't light up the
    // row or show a numeric badge — a quiet dot marks the activity instead
    // (hygiene rule 2), mirroring the multi-channel cluster path below.
    const primaryMuted =
      whatsappShellEnabled && primaryChannel.isMuted === true;
    const hasUnread = primaryChannel.unreadCount > 0 && !primaryMuted;
    const hasMutedUnread = primaryMuted && primaryChannel.unreadCount > 0;
    const isActive = isActiveGroup && activeChannelSlug === primaryChannel.slug;
    // In serving mode a team's channels are flattened into separate rows, so
    // title each by its own `#team-channel` identity rather than the shared
    // team name. Normal mode keeps the team name unchanged.
    const rowTitle = servingMode
      ? getServingChannelLabel(group.name, primaryChannel)
      : group.name;
    // Cross-team channels aren't "Team" rooms — badge them as "Cross-team".
    // Key on channelType, not the isShared heuristic: same-campus cross-team
    // channels have isShared=false but should still read "Cross-team".
    const badgeLabel =
      primaryChannel.channelType === "cross_team" ? "Cross-team" : group.groupTypeName;

    // When the group has inbox resources, wrap the row + resource sub-rows in a
    // container so they read as one inbox item.
    const SingleWrapper = resourceRows ? View : React.Fragment;
    const singleWrapperProps = resourceRows
      ? { style: [styles.groupedContainer, { backgroundColor: colors.surface }] }
      : {};

    // WhatsApp-shell flat row anatomy — see the constant block above. Only
    // active when the flag is on; the flag-off return below is unchanged.
    if (whatsappShellEnabled) {
      const timestamp = primaryChannel.lastMessageAt
        ? formatWaListTimestamp(primaryChannel.lastMessageAt)
        : undefined;
      return (
        <View style={{ backgroundColor: colors.surface }}>
          <Pressable
            onPress={() => handleChannelPress(primaryChannel)}
            style={({ pressed }) => [
              styles.waRow,
              { backgroundColor: colors.surface },
              pressed && { backgroundColor: colors.surfaceSecondary },
              isActive && { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <WaAvatar
              imageUrl={group.preview}
              label={group.name}
              seed={group._id}
              shape={isAnnouncementGroup ? "squircle" : "circle"}
              size={WA_MAIN_AVATAR_SIZE}
              style={styles.waAvatarGap}
            />
            <View style={styles.waContent}>
              <Text style={[styles.waTitle, { color: colors.text }]} numberOfLines={1}>
                {rowTitle}
              </Text>
              {servingMode && (
                <Text
                  style={[styles.waSubtext, { color: colors.textTertiary }]}
                  numberOfLines={1}
                >
                  in {group.name}
                </Text>
              )}
              <Text
                style={[
                  styles.waPreview,
                  { color: colors.textSecondary },
                  hasUnread && { fontWeight: "600", color: colors.text },
                ]}
                numberOfLines={2}
              >
                {getMessagePreview(primaryChannel)}
              </Text>
            </View>
            <WaRightColumn
              timestamp={timestamp}
              hasUnread={hasUnread}
              unreadCount={primaryChannel.unreadCount}
              showMutedDot={hasMutedUnread}
              isLoading={loadingChannelId === primaryChannel._id}
              badgeChevron={isAnnouncementGroup}
              primaryColor={primaryColor}
              colors={colors}
            />
          </Pressable>
        </View>
      );
    }

    return (
      <SingleWrapper {...(singleWrapperProps as any)}>
      <Pressable
        onPress={() => handleChannelPress(primaryChannel)}
        style={({ pressed }) => [
          styles.groupItem,
          { backgroundColor: colors.surface },
          hasUnread && { backgroundColor: isDark ? colors.surfaceSecondary : "#F0F7FF" },
          pressed && { backgroundColor: colors.surfaceSecondary },
          isActive && { backgroundColor: colors.surfaceSecondary },
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
              backgroundColor: isDark ? "#333" : "#E5E5E5",
            }}
          />
          {isLeader && (
            <View style={[styles.leaderBadge, { backgroundColor: primaryColor, borderColor: colors.surface }]}>
              <Ionicons name="shield" size={12} color="#fff" />
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.groupContent}>
          {/* Top row: Name + Badge */}
          <View style={styles.topRow}>
            <Text style={[styles.groupName, { color: colors.text }, hasUnread && styles.groupNameUnread]} numberOfLines={1}>
              {rowTitle}
            </Text>
            {primaryChannel.isShared && (
              <Ionicons name="link" size={14} color="#8B5CF6" style={styles.sharedIcon} />
            )}
            <View style={[styles.badge, { backgroundColor: badgeColors.bg }]}>
              <Text style={[styles.badgeText, { color: badgeColors.text }]}>
                {badgeLabel}
              </Text>
            </View>
          </View>

          {/* Serving mode: the title is the channel name, so name the parent
              group underneath to keep flattened team rows distinguishable. */}
          {servingMode && (
            <Text
              style={[styles.groupSubtext, { color: colors.textTertiary }]}
              numberOfLines={1}
            >
              in {group.name}
            </Text>
          )}

          {/* Bottom row: Last message preview */}
          <View style={styles.bottomRow}>
            <Text
              style={[styles.lastMessage, { color: colors.textSecondary }, hasUnread && { fontWeight: "600", color: colors.text }]}
              numberOfLines={1}
            >
              {getMessagePreview(primaryChannel)}
            </Text>
            {primaryChannel.lastMessageAt && (
              <Text style={[styles.timestamp, { color: colors.textTertiary }, hasUnread && { color: colors.link, fontWeight: "600" }]}>
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
        ) : hasMutedUnread ? (
          <View
            style={[styles.mutedUnreadDot, { backgroundColor: colors.textTertiary }]}
          />
        ) : null}
      </Pressable>
      {resourceRows}
      </SingleWrapper>
    );
  }

  // Multiple channels display - main channel as full card, sub-channels below with L-connector
  // The main spot follows updates: a channel with unread messages takes it, and the
  // General channel reclaims it whenever it has its own update (see selectMainChannel).
  const mainChannel = selectMainChannel(channels);

  // Guard against empty channels array (shouldn't happen, but be safe)
  if (!mainChannel) {
    return null;
  }

  // Secondary (sub-row) channel selection.
  //
  // Flag off: show secondary channels if expanded, if they have unread
  // messages, or if one is the channel the user is currently viewing. The
  // active check keeps the selected channel visible when another channel is
  // promoted into the main spot, so the currently-open channel never
  // silently disappears from the row. Unchanged from before this slice.
  //
  // Flag on: Channel hygiene rule 1 (cluster caps) — the main channel plus at
  // most MAX_SECONDARY_CHANNELS more, chosen unread-first then most-recent
  // activity. Rule 2 (muted sink) — a muted channel never occupies a sub-row
  // slot. Anything not shown (cap overflow or muted) is counted for the
  // "N more channels" row below.
  let secondaryChannels: ChannelData[];
  let hiddenChannelCount = 0;
  if (whatsappShellEnabled) {
    const others = channels.filter((ch) => ch._id !== mainChannel._id);
    const unmutedCandidates = others.filter((ch) => !ch.isMuted);
    const ranked = [...unmutedCandidates].sort((a, b) => {
      const aUnread = a.unreadCount > 0 ? 1 : 0;
      const bUnread = b.unreadCount > 0 ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
    });
    secondaryChannels = ranked.slice(0, MAX_SECONDARY_CHANNELS);
    const shownIds = new Set(secondaryChannels.map((c) => c._id));
    hiddenChannelCount = others.filter((ch) => !shownIds.has(ch._id)).length;
  } else {
    secondaryChannels = channels.filter(
      (ch) =>
        ch._id !== mainChannel._id &&
        (isExpanded || ch.unreadCount > 0 || (isActiveGroup && activeChannelSlug === ch.slug))
    );
  }
  // Under the whatsapp shell a muted main channel's unread must not bold or
  // highlight the row (hygiene rule 2) — the quiet dot below covers it.
  const mainHasUnread =
    mainChannel.unreadCount > 0 &&
    !(whatsappShellEnabled && mainChannel.isMuted === true);

  // WhatsApp-shell flat cluster: main row + visible sub-rows + "N more" +
  // resources, each a flat full-bleed row separated by hairlines (no cards,
  // no connector lines, no gaps). Only active when the flag is on; the
  // flag-off cluster below is unchanged.
  if (whatsappShellEnabled) {
    // Cluster header timestamp: most recent activity across the rows this
    // cluster actually renders (main + visible secondaries), so the header
    // reflects what's visible rather than channels hidden by the cap/mute.
    const mostRecentTimestamp = Math.max(
      mainChannel.lastMessageAt ?? 0,
      ...secondaryChannels.map((c) => c.lastMessageAt ?? 0)
    );
    const clusterHasUnread = mainHasUnread || totalUnread > 0;

    // Sub-rows below the main row: secondary channels, then the "N more"
    // row — one flat list, hairline-separated. (Resources are NOT here
    // flag-on; see the note above `resourceRows`.)
    const subRows: React.ReactNode[] = [];
    secondaryChannels.forEach((channel) => {
      const channelHasUnread = channel.unreadCount > 0;
      subRows.push(
        <Pressable
          key={channel._id}
          onPress={() => handleChannelPress(channel)}
          style={({ pressed }) => [
            styles.waRow,
            { backgroundColor: colors.surface },
            pressed && { backgroundColor: colors.surfaceSecondary },
            isActiveGroup && activeChannelSlug === channel.slug && { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          <WaChannelAvatar
            channelType={channel.channelType}
            size={WA_SUB_AVATAR_SIZE}
            isDark={isDark}
            group={group}
            surfaceColor={colors.surface}
          />
          <View style={styles.waContent}>
            <Text
              style={[styles.waTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {channel.name}
            </Text>
            <Text
              style={[
                styles.waPreview,
                { color: colors.textSecondary },
                channelHasUnread && { fontWeight: "600", color: colors.text },
              ]}
              numberOfLines={2}
            >
              {getMessagePreview(channel)}
            </Text>
          </View>
          <WaRightColumn
            timestamp={channel.lastMessageAt ? formatWaListTimestamp(channel.lastMessageAt) : undefined}
            hasUnread={channelHasUnread}
            unreadCount={channel.unreadCount}
            isLoading={loadingChannelId === channel._id}
            primaryColor={primaryColor}
            colors={colors}
          />
        </Pressable>
      );
    });

    if (hiddenChannelCount > 0) {
      subRows.push(
        <Pressable
          key="more"
          onPress={() => router.push(`/inbox/${group._id}/channels` as any)}
          style={({ pressed }) => [
            styles.waRow,
            { backgroundColor: colors.surface },
            pressed && { backgroundColor: colors.surfaceSecondary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`${hiddenChannelCount} more channel${hiddenChannelCount === 1 ? "" : "s"}`}
        >
          {/* Styled as WhatsApp's "Archived" utility row (per-screen §1.5):
              a bare 36pt icon well — no avatar disc, no fill — with a 17pt
              gray label and a trailing chevron. It's a control that opens a
              list, so it deliberately doesn't wear chat-row clothes. */}
          <View style={styles.waUtilityIconWell}>
            <Ionicons name="chatbubbles-outline" size={22} color={colors.textSecondary} />
          </View>
          <Text style={[styles.waUtilityLabel, { color: colors.textSecondary, flex: 1 }]} numberOfLines={1}>
            {hiddenChannelCount} more channel{hiddenChannelCount === 1 ? "" : "s"}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>
      );
    }

    return (
      <View style={{ backgroundColor: colors.surface }}>
        <Pressable
          onPress={() => handleChannelPress(mainChannel)}
          onLongPress={handleLongPress}
          delayLongPress={300}
          // @ts-expect-error - onContextMenu is a web-only prop
          onContextMenu={handleContextMenu}
          style={({ pressed }) => [
            styles.waRow,
            { backgroundColor: colors.surface },
            pressed && { backgroundColor: colors.surfaceSecondary },
            isActiveGroup && activeChannelSlug === mainChannel.slug && { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          {/* Cluster header: a group *parent*, so squircle + chevron-in-badge
              (S6.4/S6.3) — the two signals that separate "a container of
              chats" from "a chat" in the reference. */}
          <WaAvatar
            imageUrl={group.preview}
            label={group.name}
            seed={group._id}
            shape="squircle"
            size={WA_MAIN_AVATAR_SIZE}
            style={styles.waAvatarGap}
          />
          <View style={styles.waContent}>
            <Text
              style={[styles.waTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {group.name}
            </Text>
            <Text
              style={[
                styles.waPreview,
                { color: colors.textSecondary },
                mainHasUnread && { fontWeight: "600", color: colors.text },
              ]}
              numberOfLines={2}
            >
              {getMessagePreview(mainChannel)}
            </Text>
          </View>
          <WaRightColumn
            timestamp={mostRecentTimestamp ? formatWaListTimestamp(mostRecentTimestamp) : undefined}
            hasUnread={clusterHasUnread}
            unreadCount={totalUnread}
            showMutedDot={hasMutedOnlyUnread}
            isLoading={loadingChannelId === mainChannel._id}
            badgeChevron
            primaryColor={primaryColor}
            colors={colors}
          />
        </Pressable>

        {subRows.length > 0 && (
          <WaSeparator inset={WA_SEPARATOR_INSET_MAIN} borderColor={colors.border} />
        )}
        {subRows.map((row, i) => (
          <React.Fragment key={i}>
            {row}
            {i < subRows.length - 1 && (
              <WaSeparator inset={WA_SEPARATOR_INSET_SUB} borderColor={colors.border} />
            )}
          </React.Fragment>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.groupedContainer, { backgroundColor: colors.surface }]}>
      {/* Main channel - renders like a full single-channel card */}
      <Pressable
        onPress={() => handleChannelPress(mainChannel)}
        onLongPress={handleLongPress}
        delayLongPress={300}
        // @ts-expect-error - onContextMenu is a web-only prop
        onContextMenu={handleContextMenu}
        style={({ pressed }) => [
          styles.groupItem,
          { backgroundColor: colors.surface },
          (mainHasUnread || totalUnread > 0) && { backgroundColor: isDark ? colors.surfaceSecondary : "#F0F7FF" },
          pressed && { backgroundColor: colors.surfaceSecondary },
          isActiveGroup && activeChannelSlug === mainChannel.slug && { backgroundColor: colors.surfaceSecondary },
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
              backgroundColor: isDark ? "#333" : "#E5E5E5",
            }}
          />
          {isLeader && (
            <View style={[styles.leaderBadge, { backgroundColor: primaryColor, borderColor: colors.surface }]}>
              <Ionicons name="shield" size={12} color="#fff" />
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.groupContent}>
          {/* Top row: Name + Badge */}
          <View style={styles.topRow}>
            <Text style={[styles.groupName, { color: colors.text }, (mainHasUnread || totalUnread > 0) && styles.groupNameUnread]} numberOfLines={1}>
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
              style={[styles.lastMessage, { color: colors.textSecondary }, mainHasUnread && { fontWeight: "600", color: colors.text }]}
              numberOfLines={1}
            >
              {getMessagePreview(mainChannel)}
            </Text>
            {mainChannel.lastMessageAt && (
              <Text style={[styles.timestamp, { color: colors.textTertiary }, mainHasUnread && { color: colors.link, fontWeight: "600" }]}>
                {formatRelativeTime(mainChannel.lastMessageAt)}
              </Text>
            )}
          </View>
        </View>

        {/* Loading or Unread indicator. When hygiene is on and every unread
            channel is muted, show a quiet dot instead of a numeric badge
            (Channel hygiene rule 2) rather than looking fully caught-up. */}
        {loadingChannelId === mainChannel._id ? (
          <ActivityIndicator size="small" color={primaryColor} style={styles.loadingIndicator} />
        ) : totalUnread > 0 ? (
          <View style={[styles.unreadBadgeCount, { backgroundColor: primaryColor }]}>
            <Text style={styles.unreadBadgeCountText}>
              {totalUnread > 99 ? "99+" : totalUnread}
            </Text>
          </View>
        ) : hasMutedOnlyUnread ? (
          <View
            style={[styles.mutedUnreadDot, { backgroundColor: colors.textTertiary }]}
            accessibilityLabel="Muted unread activity"
          />
        ) : null}
      </Pressable>

      {/* Secondary channels with L-connector */}
      {secondaryChannels.map((channel) => {
        const hasUnread = channel.unreadCount > 0;

        return (
          <View key={channel._id} style={styles.subChannelContainer}>
            {/* L-shaped connector */}
            <View style={styles.connectorContainer}>
              <View style={[styles.connectorVertical, { backgroundColor: colors.border }]} />
              <View style={[styles.connectorHorizontal, { backgroundColor: colors.border }]} />
            </View>

            {/* Sub-channel card */}
            <Pressable
              onPress={() => handleChannelPress(channel)}
              style={({ pressed }) => [
                styles.subChannelCard,
                { backgroundColor: colors.surfaceSecondary, borderColor: "transparent" },
                hasUnread && { backgroundColor: isDark ? colors.surfaceSecondary : "#EBF3FF", borderColor: isDark ? colors.border : "#D0E2FF" },
                pressed && { backgroundColor: isDark ? colors.border : "#E8E8E8" },
                isActiveGroup && activeChannelSlug === channel.slug && { backgroundColor: isDark ? colors.border : "#E8E8E8" },
              ]}
            >
              {channel.isShared && (
                <Ionicons name="link" size={12} color="#8B5CF6" style={styles.subChannelSharedIcon} />
              )}
              <Text style={[styles.subChannelName, { color: colors.text }, hasUnread && styles.subChannelNameUnread]}>{channel.name}</Text>
              <Text
                style={[styles.subChannelPreview, { color: colors.textSecondary }, hasUnread && { fontWeight: "500", color: colors.text }]}
                numberOfLines={1}
              >
                {getMessagePreview(channel)}
              </Text>
              {channel.lastMessageAt && (
                <Text style={[styles.subChannelTimestamp, { color: colors.textTertiary }, hasUnread && { color: colors.link, fontWeight: "600" }]}>
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

      {/* "N more channels" collapse row — Channel hygiene rule: whatever the
          cap/mute rules above hid still needs a way out, to the channel
          directory (W17). Flag-gated; never renders when off. */}
      {whatsappShellEnabled && hiddenChannelCount > 0 && (
        <View style={styles.subChannelContainer}>
          <View style={styles.connectorContainer}>
            <View style={[styles.connectorVertical, { backgroundColor: colors.border }]} />
            <View style={[styles.connectorHorizontal, { backgroundColor: colors.border }]} />
          </View>
          <Pressable
            onPress={() => router.push(`/inbox/${group._id}/channels` as any)}
            style={({ pressed }) => [
              styles.subChannelCard,
              { backgroundColor: colors.surfaceSecondary, borderColor: "transparent" },
              pressed && { backgroundColor: isDark ? colors.border : "#E8E8E8" },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${hiddenChannelCount} more channel${hiddenChannelCount === 1 ? "" : "s"}`}
          >
            <Text
              style={[styles.subChannelPreview, { color: colors.textSecondary, flex: 1 }]}
              numberOfLines={1}
            >
              {hiddenChannelCount} more channel{hiddenChannelCount === 1 ? "" : "s"}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}

      {/* Resource sub-rows */}
      {resourceRows}
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
    flex: 1,
    marginRight: 8,
  },
  groupNameUnread: {
    fontWeight: "700",
  },
  groupSubtext: {
    fontSize: 12,
    marginTop: 1,
    marginBottom: 2,
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
    flex: 1,
    marginRight: 8,
  },
  timestamp: {
    fontSize: 12,
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
  // Muted-unread indicator (Channel hygiene rule 2): a quiet dot in place of
  // the numeric badge when only muted channels have unread activity.
  mutedUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },

  // Grouped styles (multiple channels)
  groupedContainer: {
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
  channelText: {
    flex: 1,
    fontSize: 13,
  },
  channelName: {
    fontWeight: "500",
  },
  channelSeparator: {
  },
  channelPreview: {
  },
  channelTimestamp: {
    fontSize: 11,
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
  },
  connectorHorizontal: {
    position: "absolute",
    left: 28,
    top: 20,
    width: 12,
    height: 1.5,
  },
  subChannelCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 16,
    marginBottom: 8,
    marginTop: 4,
    borderWidth: 1,
  },
  subChannelName: {
    fontSize: 13,
    fontWeight: "600",
    marginRight: 8,
  },
  resourceRowTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 8,
    marginRight: 8,
  },
  subChannelNameUnread: {
    fontWeight: "700",
  },
  subChannelPreview: {
    flex: 1,
    fontSize: 13,
  },
  subChannelTimestamp: {
    fontSize: 11,
    marginLeft: 8,
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

  // --- WhatsApp-shell flat row anatomy (flag-gated) -------------------------
  // A single row shape reused by main rows, sub-rows, "N more", and resource
  // rows — differing only in avatar size/content. No card background, no
  // border radius, no margins; hairline separators (below) do the dividing.
  // S6.1 density: the row is exactly as tall as a 58pt avatar plus its
  // breathing room (~78pt); the vertical padding only comes into play when a
  // 2-line preview outgrows that.
  waRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  waAvatarGap: {
    marginRight: 12,
  },
  waIconCircle: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  waIconGlyph: {
    fontWeight: "700",
  },
  // Channel sub-row avatar: same 12pt gap to the text column every other
  // WaRow avatar uses, so sub-rows still align with the cluster header.
  waSubAvatarWrap: {
    marginRight: 12,
  },
  // The parent group's avatar, dimmed so the sub-row reads as subordinate to
  // the cluster header above it rather than as a second full chat row.
  waSubAvatarMuted: {
    opacity: 0.55,
  },
  // Channel glyph badge riding the avatar's bottom-right corner. Full opacity
  // (it's the row's identity marker) with a surface-colored ring so it stays
  // legible against a photo.
  waChannelBadge: {
    position: "absolute",
    right: -1,
    bottom: -1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  // "Archived"-style utility row: an icon well, not a disc — no fill.
  waUtilityIconWell: {
    width: WA_UTILITY_ICON_WELL,
    height: WA_UTILITY_ICON_WELL,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: (WA_MAIN_AVATAR_SIZE - WA_UTILITY_ICON_WELL) / 2,
    marginRight: 12 + (WA_MAIN_AVATAR_SIZE - WA_UTILITY_ICON_WELL) / 2,
  },
  waUtilityLabel: {
    fontSize: 17,
  },
  waContent: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  waTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  waSubtext: {
    fontSize: 13,
    marginTop: 1,
  },
  waPreview: {
    fontSize: 15,
    marginTop: 2,
  },
  // Right column: timestamp stacked above the badge/dot, top-aligned like
  // WhatsApp (not vertically centered against the two-line content block).
  waRightColumn: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
    marginLeft: 8,
    alignSelf: "stretch",
    paddingTop: 1,
  },
  waTimestamp: {
    // S6.1/S6.2: 15pt — a peer of the preview line, not a caption.
    fontSize: 15,
  },
  waRightColumnSpacer: {
    marginTop: 4,
  },
  waBadgeSlot: {
    marginTop: 4,
  },
  waMutedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  waSeparator: {
    height: StyleSheet.hairlineWidth,
  },
});
