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
 *   - General (channelType === "main"): → /inbox/{groupId}/{slug} (chat)
 *   - Everything else: → /inbox/{groupId}/{slug}/info
 *
 * The Pin Channels / Toolbar Settings buttons that used to float at the
 * bottom of this section now live in GROUP ACTIONS on
 * GroupDetailScreen.
 */
import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { useGroupChannels } from "../hooks/useGroupChannels";
import { useRespondToChannelInvite } from "../hooks/useRespondToChannelInvite";
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

  // The legacy `groupMembers.role === "admin"` enum is no longer assigned
  // by the backend (only "member" / "leader" exist). The defensive `||
  // "admin"` checks scattered through the app are dead — drop them as we
  // touch each surface.
  const isLeader = userRole === "leader";

  const pendingInvites = useQuery(
    api.functions.messaging.sharedChannels.listPendingInvitesForGroup,
    token && isLeader ? { token, groupId: groupId as Id<"groups"> } : "skip"
  );

  const { respondingTo, handleRespond: handleRespondToInvite } =
    useRespondToChannelInvite({ token, groupId });

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
  const pcoSyncedChannels = channels?.filter((c: Channel) => c.channelType === "pco_services") ?? [];
  const customChannels = channels?.filter((c: Channel) => c.channelType === "custom") ?? [];

  const leadersEnabled = !!leadersChannel && !leadersChannel.isArchived;
  const mainEnabled = !!mainChannel && !mainChannel.isArchived;
  const reachOutEnabled = !!reachOutChannel && !reachOutChannel.isArchived;

  const navigateToChannelChat = useCallback(
    (slug: string) => router.push(`/inbox/${groupId}/${slug}` as any),
    [router, groupId]
  );

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
      // General opens the chat directly. The group page IS its info screen.
      onPress: () => navigateToChannelChat(mainChannel.slug),
      unreadCount: mainChannel.unreadCount,
      pinned: mainChannel.isPinned,
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
    });
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.header, { color: colors.textSecondary }]}>CHANNELS</Text>
      <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
        {rows.map((row, idx) => {
          const isFirst = idx === 0;
          const dimmed = !row.enabled;
          // Disabled channels stay tappable so a leader can re-enable from
          // the info screen's Active state. Placeholder rows with no
          // onPress fall through to disabled.
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
        })}
      </View>

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

      {isLeader && pendingInvites && pendingInvites.length > 0 && (
        <>
          <Text style={[styles.header, styles.subSectionHeader, { color: colors.textSecondary }]}>
            SHARED CHANNEL INVITATIONS
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
            {pendingInvites.map((invite, idx) => (
              <View
                key={invite.channelId}
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
                    Invited by {invite.invitedByName}
                  </Text>
                </View>
                <View style={styles.inviteActions}>
                  <TouchableOpacity
                    style={[styles.inviteAcceptButton, { backgroundColor: primaryColor }]}
                    onPress={() => handleRespondToInvite(invite.channelId, "accepted")}
                    disabled={respondingTo !== null}
                  >
                    {respondingTo === `${invite.channelId}-accept` ? (
                      <ActivityIndicator size="small" color={colors.textInverse} />
                    ) : (
                      <Text style={styles.inviteAcceptText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.inviteDeclineButton, { borderColor: colors.destructive }]}
                    onPress={() => handleRespondToInvite(invite.channelId, "declined")}
                    disabled={respondingTo !== null}
                  >
                    {respondingTo === `${invite.channelId}-decline` ? (
                      <ActivityIndicator size="small" color={colors.destructive} />
                    ) : (
                      <Ionicons name="close" size={18} color={colors.destructive} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
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
  inviteActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inviteAcceptButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: "center",
  },
  inviteAcceptText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  inviteDeclineButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
