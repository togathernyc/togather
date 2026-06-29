/**
 * ChannelsSection (clean, DM-style)
 *
 * Single CHANNELS card on the group page. Each row is icon + name +
 * subtitle + chevron — no toggles, no trailing icon clusters. Per-channel
 * configuration (active/disabled state, share-with-groups, archive,
 * leave) lives on the per-channel info screen at
 * `/inbox/[groupId]/[channelSlug]/info`.
 *
 * Order:
 *   1. CHANNELS card (general → leaders → reach_out → pco → custom)
 *   2. Solid "Create Channel" affordance (leaders only)
 *   3. SHARED CHANNEL INVITATIONS card (leaders only, when present)
 *
 * Navigation:
 *   - Every channel (including General / channelType === "main"):
 *     → /inbox/{groupId}/{slug}/info
 *
 * The Pin Channels / Toolbar Settings buttons that used to float at the
 * bottom of this section now live in GROUP ACTIONS on
 * GroupDetailScreen.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useQuery,
  api,
  useAuthenticatedMutation,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useGroupChannels } from "../hooks/useGroupChannels";
import { ChannelJoinRequestsBanner } from "./ChannelJoinRequestsBanner";

interface ChannelsSectionProps {
  groupId: string;
  userRole?: string | null; // 'member', 'leader', or 'admin'
}

interface Channel {
  _id: Id<"chatChannels">;
  slug: string;
  channelType: string;
  name: string;
  description?: string;
  memberCount: number;
  isArchived: boolean;
  isMember: boolean;
  role?: string;
  unreadCount: number;
  isPinned: boolean;
  lastMessageAt?: number;
  isShared?: boolean;
  /** false when leader hid channel; memberships stay (see Convex isEnabled). */
  isEnabled: boolean;
}

export function ChannelsSection({ groupId, userRole }: ChannelsSectionProps) {
  const router = useRouter();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  // Archived/disabled channels are folded away under a single collapsible
  // "Archived" row so a long tail of turned-off channels doesn't clutter the
  // list. Collapsed by default; only leaders ever have archived rows since
  // members never receive disabled channels from the query.
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  // The legacy `groupMembers.role === "admin"` enum is no longer assigned
  // by the backend (only "member" / "leader" exist). The defensive `||
  // "admin"` checks scattered through the app are dead — drop them as we
  // touch each surface.
  const isLeader = userRole === "leader";

  const pendingInvites = useQuery(
    api.functions.messaging.sharedChannels.listPendingInvitesForGroup,
    token && isLeader ? { token, groupId: groupId as Id<"groups"> } : "skip"
  );

  const { channels: rawChannels } = useGroupChannels(groupId, {
    includeArchived: isLeader,
  });

  const channels = useMemo(() => {
    if (rawChannels === undefined) return undefined;
    if (isLeader) return rawChannels;
    return rawChannels.filter((c: Channel) => c.isEnabled !== false);
  }, [rawChannels, isLeader]);

  const mainChannel = channels?.find((c: Channel) => c.channelType === "main");
  const leadersChannel = channels?.find((c: Channel) => c.channelType === "leaders");
  const reachOutChannel = channels?.find((c: Channel) => c.channelType === "reach_out");
  const announcementsChannel = channels?.find(
    (c: Channel) => c.channelType === "announcements"
  );
  const pcoSyncedChannels = channels?.filter((c: Channel) => c.channelType === "pco_services") ?? [];
  const customChannels = channels?.filter((c: Channel) => c.channelType === "custom") ?? [];

  // A channel is inactive if it's archived OR a leader hid it (isEnabled ===
  // false) — the backend active-state checks treat either flag as inactive,
  // so both must fold under Archived and read as "Disabled". Undefined
  // isEnabled means enabled (memberships intact).
  const leadersEnabled =
    !!leadersChannel && !leadersChannel.isArchived && leadersChannel.isEnabled !== false;
  const mainEnabled =
    !!mainChannel && !mainChannel.isArchived && mainChannel.isEnabled !== false;
  const reachOutEnabled =
    !!reachOutChannel && !reachOutChannel.isArchived && reachOutChannel.isEnabled !== false;
  const announcementsEnabled =
    !!announcementsChannel &&
    !announcementsChannel.isArchived &&
    announcementsChannel.isEnabled !== false;

  const toggleAnnouncementsChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.toggleAnnouncementsChannel
  );
  const [enablingAnnouncements, setEnablingAnnouncements] = useState(false);

  const handleEnableAnnouncements = useCallback(async () => {
    if (enablingAnnouncements) return;
    setEnablingAnnouncements(true);
    try {
      await toggleAnnouncementsChannelMutation({
        groupId: groupId as Id<"groups">,
        enabled: true,
      });
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to enable Announcements");
    } finally {
      setEnablingAnnouncements(false);
    }
  }, [enablingAnnouncements, groupId, toggleAnnouncementsChannelMutation]);

  const navigateToChannelInfo = useCallback(
    (slug: string) => router.push(`/inbox/${groupId}/${slug}/info` as any),
    [router, groupId]
  );

  const handleCreateChannel = useCallback(() => {
    router.push(`/inbox/${groupId}/create` as any);
  }, [router, groupId]);

  if (channels === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.header, { color: colors.textSecondary }]}>CHANNELS</Text>
        <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={primaryColor} />
          </View>
        </View>
      </View>
    );
  }

  if (channels.length === 0) {
    return null;
  }

  // Build the row list in canonical order so renderers don't have to think
  // about dividers — we draw a hairline between rows by index.
  type Row = {
    key: string;
    icon: React.ComponentProps<typeof Ionicons>["name"];
    iconColor: string;
    iconBg: string;
    name: string;
    subtitle: string;
    enabled: boolean;
    /** Omit for placeholder rows (e.g. Leaders/Reach Out shown to a leader
     *  before the channel record exists). When set, the row is tappable —
     *  even if `enabled === false`, since "tap a disabled channel to
     *  re-enable" is the primary recovery path. */
    onPress?: () => void;
    unreadCount?: number;
    pinned?: boolean;
    /** True when this row is backed by a real channel record that is
     *  disabled/archived. Such rows fold into the collapsible "Archived"
     *  section. Placeholder/CTA rows (no record yet) are never archived. */
    archived?: boolean;
  };

  const rows: Row[] = [];

  if (mainChannel) {
    rows.push({
      key: mainChannel._id,
      icon: "chatbubbles",
      iconColor: primaryColor,
      iconBg: primaryColor + "15",
      name: "General",
      subtitle: mainEnabled ? "All members" : "Disabled",
      enabled: mainEnabled,
      // General opens its info page like every other channel — that's where
      // a leader reaches Active state to disable/re-enable it.
      onPress: () => navigateToChannelInfo(mainChannel.slug),
      unreadCount: mainChannel.unreadCount,
      pinned: mainChannel.isPinned,
      archived: !mainEnabled,
    });
  }

  if (leadersChannel || isLeader) {
    rows.push({
      key: leadersChannel?._id ?? "leaders-placeholder",
      icon: "star",
      iconColor: "#FFA500",
      iconBg: "#FFA50015",
      name: "Leaders",
      subtitle: leadersChannel
        ? leadersEnabled
          ? `${leadersChannel.memberCount} leader${leadersChannel.memberCount !== 1 ? "s" : ""}`
          : "Disabled"
        : "Disabled",
      enabled: !!leadersChannel && leadersEnabled,
      onPress: leadersChannel
        ? () => navigateToChannelInfo(leadersChannel.slug)
        : undefined,
      unreadCount: leadersChannel?.unreadCount,
      pinned: leadersChannel?.isPinned,
      // Fold only a real, disabled Leaders channel — never the "create"
      // placeholder shown to leaders before the record exists.
      archived: !!leadersChannel && !leadersEnabled,
    });
  }

  // Announcements: opt-in leader-broadcast channel. Leaders see the row
  // even before the channel exists so they can enable it; members only see
  // it once a leader has turned it on.
  if (announcementsChannel || isLeader) {
    const hasAnnouncementsRecord = !!announcementsChannel;
    rows.push({
      key: announcementsChannel?._id ?? "announcements-placeholder",
      icon: "megaphone",
      iconColor: "#E11D48",
      iconBg: "#E11D4815",
      name: "Announcements",
      subtitle: hasAnnouncementsRecord
        ? announcementsEnabled
          ? `${announcementsChannel!.memberCount} member${announcementsChannel!.memberCount !== 1 ? "s" : ""} · Leaders post`
          : "Disabled"
        : enablingAnnouncements
          ? "Enabling…"
          : "Tap to enable — leaders post, members read",
      enabled: announcementsEnabled,
      // Placeholder (no record yet) tap → lazy-create via mutation.
      // Existing record tap → channel info screen for further toggling.
      onPress: hasAnnouncementsRecord
        ? () => navigateToChannelInfo(announcementsChannel!.slug)
        : isLeader
          ? handleEnableAnnouncements
          : undefined,
      unreadCount: announcementsChannel?.unreadCount,
      pinned: announcementsChannel?.isPinned,
      // Keep the "Tap to enable" CTA (no record) in the main list; fold only
      // an existing-but-disabled Announcements channel.
      archived: !!announcementsChannel && !announcementsEnabled,
    });
  }

  if (isLeader) {
    rows.push({
      key: reachOutChannel?._id ?? "reach-out-placeholder",
      icon: "hand-left",
      iconColor: "#8E44AD",
      iconBg: "#8E44AD15",
      name: "Reach Out",
      subtitle: !leadersEnabled
        ? "Requires Leaders channel"
        : reachOutChannel && reachOutEnabled
          ? `${reachOutChannel.memberCount} member${reachOutChannel.memberCount !== 1 ? "s" : ""}`
          : "Disabled",
      enabled: !!reachOutChannel && reachOutEnabled && leadersEnabled,
      onPress: reachOutChannel
        ? () => navigateToChannelInfo(reachOutChannel.slug)
        : undefined,
      unreadCount: reachOutChannel?.unreadCount,
      pinned: reachOutChannel?.isPinned,
      // Fold a real, disabled Reach Out channel. The "Requires Leaders
      // channel" / create-placeholder states (no record) stay in the main
      // list as actionable affordances.
      archived: !!reachOutChannel && !reachOutEnabled,
    });
  }

  pcoSyncedChannels.forEach((channel: Channel) => {
    const enabled = channel.isEnabled && !channel.isArchived;
    rows.push({
      key: channel._id,
      icon: "sync",
      iconColor: "#2196F3",
      iconBg: "#2196F315",
      name: channel.name,
      subtitle: enabled
        ? `${channel.memberCount} member${channel.memberCount !== 1 ? "s" : ""} · PCO Synced`
        : "Disabled",
      enabled,
      onPress: () => navigateToChannelInfo(channel.slug),
      unreadCount: channel.unreadCount,
      pinned: channel.isPinned,
      archived: !enabled,
    });
  });

  customChannels.forEach((channel: Channel) => {
    const enabled = channel.isEnabled && !channel.isArchived;
    rows.push({
      key: channel._id,
      icon: "chatbubble",
      iconColor: "#00BCD4",
      iconBg: "#00BCD415",
      name: channel.name,
      subtitle: enabled
        ? `${channel.memberCount} member${channel.memberCount !== 1 ? "s" : ""}`
        : "Hidden — visible to leaders",
      enabled,
      onPress: () => navigateToChannelInfo(channel.slug),
      unreadCount: channel.unreadCount,
      pinned: channel.isPinned,
      archived: !enabled,
    });
  });

  const activeRows = rows.filter((r) => !r.archived);
  const archivedRows = rows.filter((r) => r.archived);

  const renderRow = (row: Row, idx: number) => {
    const isFirst = idx === 0;
    const dimmed = !row.enabled;
    // Disabled channels stay tappable so a leader can re-enable from the info
    // screen's Active state. Placeholder rows with no onPress fall through to
    // disabled.
    const tappable = !!row.onPress;
    return (
      <TouchableOpacity
        key={row.key}
        activeOpacity={0.7}
        onPress={row.onPress}
        disabled={!tappable}
        style={[
          styles.row,
          !isFirst && {
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
          },
        ]}
      >
        <View style={[styles.iconContainer, { backgroundColor: row.iconBg }]}>
          <Ionicons name={row.icon} size={20} color={row.iconColor} />
        </View>
        <View style={styles.rowInfo}>
          <View style={styles.rowNameLine}>
            <Text
              style={[
                styles.rowName,
                { color: dimmed ? colors.textTertiary : colors.text },
              ]}
              numberOfLines={1}
            >
              {row.name}
            </Text>
            {row.pinned && (
              <Ionicons
                name="pin"
                size={13}
                color={colors.iconSecondary}
                style={styles.pinIcon}
              />
            )}
          </View>
          <Text
            style={[styles.rowSubtitle, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {row.subtitle}
          </Text>
        </View>
        {row.enabled && row.unreadCount && row.unreadCount > 0 ? (
          <View style={[styles.unreadBadge, { backgroundColor: row.iconColor }]}>
            <Text style={styles.unreadText}>
              {row.unreadCount > 99 ? "99+" : row.unreadCount}
            </Text>
          </View>
        ) : null}
        {tappable && (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textTertiary}
          />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.header, { color: colors.textSecondary }]}>CHANNELS</Text>
      {activeRows.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
          {activeRows.map((row, idx) => renderRow(row, idx))}
        </View>
      )}

      {/* Archived/disabled channels fold into one collapsible group so they
          don't clutter the active list. Leaders only — members never receive
          disabled channels, so archivedRows is empty for them. */}
      {archivedRows.length > 0 && (
        <>
          <TouchableOpacity
            style={[styles.archivedToggle, { backgroundColor: colors.surfaceSecondary }]}
            onPress={() => setArchivedExpanded((v) => !v)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.iconContainer,
                { backgroundColor: colors.textTertiary + "15" },
              ]}
            >
              <Ionicons name="archive-outline" size={20} color={colors.textSecondary} />
            </View>
            <View style={styles.rowInfo}>
              <Text style={[styles.rowName, { color: colors.text }]}>Archived</Text>
              <Text
                style={[styles.rowSubtitle, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {archivedRows.length} channel{archivedRows.length !== 1 ? "s" : ""} ·
                hidden from members
              </Text>
            </View>
            <Ionicons
              name={archivedExpanded ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.textTertiary}
            />
          </TouchableOpacity>
          {archivedExpanded && (
            <View
              style={[
                styles.card,
                styles.archivedCard,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              {archivedRows.map((row, idx) => renderRow(row, idx))}
            </View>
          )}
        </>
      )}

      {/* Solid Create Channel affordance — matches the DM "Add people"
          card. Replaces the dashed-border button. */}
      {isLeader && (
        <TouchableOpacity
          style={[styles.createCard, { backgroundColor: colors.surfaceSecondary }]}
          onPress={handleCreateChannel}
          activeOpacity={0.7}
        >
          <View style={[styles.createIcon, { backgroundColor: primaryColor + "15" }]}>
            <Ionicons name="add" size={20} color={primaryColor} />
          </View>
          <Text style={[styles.createLabel, { color: colors.text }]}>
            Create Channel
          </Text>
        </TouchableOpacity>
      )}

      {/* Shared channel requests — pending invites from other groups. Each is
          a tappable row that opens the channel's info screen, where the leader
          reviews and accepts/declines. (The accept/decline buttons used to live
          inline here; they now live on the channel info screen.) */}
      {isLeader && pendingInvites && pendingInvites.length > 0 && (
        <>
          <Text style={[styles.header, styles.subSectionHeader, { color: colors.textSecondary }]}>
            SHARED CHANNEL REQUESTS
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
            {pendingInvites.map((invite, idx) => (
              <TouchableOpacity
                key={invite.channelId}
                activeOpacity={0.7}
                onPress={() => navigateToChannelInfo(invite.channelSlug)}
                style={[
                  styles.row,
                  idx > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  },
                ]}
              >
                <View style={[styles.iconContainer, { backgroundColor: "#8B5CF615" }]}>
                  <Ionicons name="link" size={20} color="#8B5CF6" />
                </View>
                <View style={styles.rowInfo}>
                  <Text style={[styles.rowName, { color: colors.text }]}>
                    #{invite.channelName}
                  </Text>
                  <Text style={[styles.rowSubtitle, { color: colors.textSecondary }]}>
                    From {invite.primaryGroupName}
                  </Text>
                  <Text style={[styles.rowNote, { color: colors.textTertiary }]}>
                    Tap to review · invited by {invite.invitedByName}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {isLeader && <ChannelJoinRequestsBanner groupId={groupId} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
  },
  header: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  subSectionHeader: {
    marginTop: 24,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  loadingContainer: {
    paddingVertical: 24,
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 56,
    gap: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowNameLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
  },
  pinIcon: {
    marginLeft: 6,
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: 13,
  },
  rowNote: {
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 2,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
    marginRight: 4,
  },
  unreadText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
  },
  createCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 48,
  },
  archivedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 56,
  },
  archivedCard: {
    marginTop: 8,
  },
  createIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  createLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
});
