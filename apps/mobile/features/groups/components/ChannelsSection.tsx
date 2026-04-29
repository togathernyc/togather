/**
 * ChannelsSection Component
 *
 * Displays all channels for a group as a single grouped "CHANNELS" card,
 * styled to match the DM chat-info screen aesthetic.
 *
 * Phase-1 design (this file):
 * - One "CHANNELS" section header + one rounded card with internal dividers
 * - Each row: icon · name · subtitle · chevron (clean, no toggles, no
 *   trailing icon clusters)
 * - General is always rendered enabled (no greyed state on this screen)
 * - Reach Out subtitle reflects member count, or "Requires Leaders channel"
 *   when the Leaders channel is disabled (existing dependency preserved)
 * - "Create Channel" CTA is a solid card matching the DM "Add people" pattern
 *
 * Per-channel visibility/active-state moves to a per-channel Info screen
 * (Leader Controls), being built in parallel by another agent. This file
 * intentionally no longer mounts toggle switches or member-management /
 * share / leave buttons inline.
 *
 * Pin Channels and Toolbar Settings live in the GROUP ACTIONS card on the
 * group screen — not here.
 */
import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
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

type ChannelIconConfig = {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
};

export function ChannelsSection({ groupId, userRole }: ChannelsSectionProps) {
  const router = useRouter();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();

  const isLeader = userRole === "leader" || userRole === "admin";

  // Pending shared-channel invites (leaders only)
  const pendingInvites = useQuery(
    api.functions.messaging.sharedChannels.listPendingInvitesForGroup,
    token && isLeader ? { token, groupId: groupId as Id<"groups"> } : "skip"
  );
  const { respondingTo, handleRespond: handleRespondToInvite } =
    useRespondToChannelInvite({ token, groupId });

  const { channels: rawChannels } = useGroupChannels(groupId, {
    includeArchived: isLeader,
  });

  // Defense in depth: never show leader-disabled channels to non-leaders.
  const channels = useMemo(() => {
    if (rawChannels === undefined) return undefined;
    if (isLeader) return rawChannels;
    return rawChannels.filter((c: Channel) => c.isEnabled !== false);
  }, [rawChannels, isLeader]);

  // Bucket
  const mainChannel = channels?.find((c: Channel) => c.channelType === "main");
  const leadersChannel = channels?.find(
    (c: Channel) => c.channelType === "leaders",
  );
  const reachOutChannel = channels?.find(
    (c: Channel) => c.channelType === "reach_out",
  );
  const pcoSyncedChannels =
    channels?.filter((c: Channel) => c.channelType === "pco_services") ?? [];
  const customChannels =
    channels?.filter((c: Channel) => c.channelType === "custom") ?? [];

  const leadersChannelEnabled = leadersChannel && !leadersChannel.isArchived;

  // General opens the chat directly (channel == group audience). All other
  // channels open the channel info screen, where the chat is one tap away via
  // the "Open chat" CTA.
  const handleChannelPress = useCallback(
    (channel: Channel) => {
      if (channel.channelType === "main") {
        router.push(`/inbox/${groupId}/${channel.slug}`);
        return;
      }
      router.push(`/inbox/${groupId}/${channel.slug}/info`);
    },
    [router, groupId],
  );

  // Create channel — leaders only (solid CTA below the channels card)
  const handleCreateChannel = useCallback(() => {
    router.push(`/inbox/${groupId}/create`);
  }, [router, groupId]);

  if (channels === undefined) {
    return (
      <View style={styles.section}>
        <SectionHeader colors={colors} label="Channels" />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface },
            styles.loadingContainer,
          ]}
        >
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  if (channels.length === 0 && !isLeader) {
    return null;
  }

  // Build the ordered row list once. Each entry knows how to render its own
  // icon + subtitle. We render dividers between rows in JSX based on index.
  type Row = {
    key: string;
    name: string;
    subtitle: string;
    icon: ChannelIconConfig;
    onPress?: () => void;
    /** Greyed style for dependency-disabled rows (Reach Out w/o Leaders). */
    dimmed?: boolean;
    unreadCount?: number;
    unreadColor?: string;
  };

  const rows: Row[] = [];

  if (mainChannel) {
    rows.push({
      key: mainChannel._id,
      name: "General",
      // Per spec: General is always-on on this screen (no greyed state).
      subtitle: "All members",
      icon: {
        name: "chatbubbles",
        color: primaryColor,
        bg: primaryColor + "15",
      },
      onPress: () => handleChannelPress(mainChannel),
      unreadCount: mainChannel.unreadCount,
      unreadColor: primaryColor,
    });
  }

  if (leadersChannel || isLeader) {
    rows.push({
      key: leadersChannel?._id ?? "leaders-placeholder",
      name: "Leaders",
      subtitle: leadersChannel
        ? `${leadersChannel.memberCount} leader${leadersChannel.memberCount !== 1 ? "s" : ""}`
        : "Disabled",
      icon: { name: "star", color: "#FFA500", bg: "#FFA50015" },
      onPress:
        leadersChannel && leadersChannelEnabled
          ? () => handleChannelPress(leadersChannel)
          : undefined,
      dimmed: !leadersChannelEnabled,
      unreadCount: leadersChannel?.unreadCount,
      unreadColor: "#FFA500",
    });
  }

  if (isLeader) {
    const reachOutEnabled = reachOutChannel
      ? !reachOutChannel.isArchived
      : false;
    rows.push({
      key: reachOutChannel?._id ?? "reach-out-placeholder",
      name: "Reach Out",
      subtitle: !leadersChannelEnabled
        ? "Requires Leaders channel"
        : reachOutChannel
          ? `${reachOutChannel.memberCount} member${reachOutChannel.memberCount !== 1 ? "s" : ""}`
          : "Disabled",
      icon: { name: "hand-left", color: "#8E44AD", bg: "#8E44AD15" },
      onPress:
        reachOutChannel && reachOutEnabled && leadersChannelEnabled
          ? () => handleChannelPress(reachOutChannel)
          : undefined,
      dimmed: !reachOutEnabled || !leadersChannelEnabled,
    });
  }

  for (const channel of pcoSyncedChannels) {
    const enabled = channel.isEnabled && !channel.isArchived;
    rows.push({
      key: channel._id,
      name: channel.name,
      subtitle: enabled
        ? `${channel.memberCount} member${channel.memberCount !== 1 ? "s" : ""} · PCO Synced`
        : "Disabled",
      icon: { name: "sync", color: "#2196F3", bg: "#2196F315" },
      onPress: enabled ? () => handleChannelPress(channel) : undefined,
      dimmed: !enabled,
      unreadCount: channel.unreadCount,
      unreadColor: "#2196F3",
    });
  }

  for (const channel of customChannels) {
    const enabled = channel.isEnabled && !channel.isArchived;
    rows.push({
      key: channel._id,
      name: channel.name,
      subtitle: enabled
        ? `${channel.memberCount} member${channel.memberCount !== 1 ? "s" : ""}`
        : "Hidden from members",
      icon: { name: "chatbubble", color: "#00BCD4", bg: "#00BCD415" },
      onPress: enabled ? () => handleChannelPress(channel) : undefined,
      dimmed: !enabled,
      unreadCount: channel.unreadCount,
      unreadColor: "#00BCD4",
    });
  }

  return (
    <View style={styles.section}>
      <SectionHeader colors={colors} label="Channels" />

      {rows.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          {rows.map((row, idx) => (
            <Pressable
              key={row.key}
              onPress={row.onPress}
              disabled={!row.onPress}
              style={({ pressed }) => [
                styles.row,
                idx > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
                pressed &&
                  row.onPress && { backgroundColor: colors.selectedBackground },
              ]}
            >
              <View
                style={[styles.rowIcon, { backgroundColor: row.icon.bg }]}
              >
                <Ionicons
                  name={row.icon.name}
                  size={20}
                  color={row.icon.color}
                />
              </View>
              <View style={styles.rowText}>
                <Text
                  style={[
                    styles.rowName,
                    {
                      color: row.dimmed ? colors.textTertiary : colors.text,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {row.name}
                </Text>
                <Text
                  style={[styles.rowSubtitle, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {row.subtitle}
                </Text>
              </View>
              {row.unreadCount && row.unreadCount > 0 ? (
                <View
                  style={[
                    styles.unreadBadge,
                    { backgroundColor: row.unreadColor ?? primaryColor },
                  ]}
                >
                  <Text style={styles.unreadText}>
                    {row.unreadCount > 99 ? "99+" : row.unreadCount}
                  </Text>
                </View>
              ) : null}
              {row.onPress ? (
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                />
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      {/* Create Channel — solid card matching DM "Add people" affordance */}
      {isLeader && (
        <Pressable
          onPress={handleCreateChannel}
          style={({ pressed }) => [
            styles.actionRow,
            {
              backgroundColor: pressed
                ? colors.selectedBackground
                : colors.surface,
            },
          ]}
        >
          <View
            style={[
              styles.rowIcon,
              { backgroundColor: primaryColor + "15" },
            ]}
          >
            <Ionicons name="add" size={20} color={primaryColor} />
          </View>
          <Text style={[styles.actionRowLabel, { color: colors.text }]}>
            Create Channel
          </Text>
        </Pressable>
      )}

      {/* Pending shared-channel invitations — leaders only.
          Kept as a separate sub-section because it's transient state, not a
          channel the user is in. */}
      {isLeader && pendingInvites && pendingInvites.length > 0 && (
        <View style={{ marginTop: 16 }}>
          <SectionHeader colors={colors} label="Shared channel invitations" />
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
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
                <View
                  style={[styles.rowIcon, { backgroundColor: "#8B5CF615" }]}
                >
                  <Ionicons name="link" size={20} color="#8B5CF6" />
                </View>
                <View style={styles.rowText}>
                  <Text
                    style={[styles.rowName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    #{invite.channelName}
                  </Text>
                  <Text
                    style={[
                      styles.rowSubtitle,
                      { color: colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    From {invite.primaryGroupName} · invited by{" "}
                    {invite.invitedByName}
                  </Text>
                </View>
                <View style={styles.inviteActions}>
                  <Pressable
                    style={[
                      styles.inviteAcceptButton,
                      { backgroundColor: primaryColor },
                    ]}
                    onPress={() =>
                      handleRespondToInvite(invite.channelId, "accepted")
                    }
                    disabled={respondingTo !== null}
                  >
                    {respondingTo === `${invite.channelId}-accept` ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.textInverse}
                      />
                    ) : (
                      <Text style={styles.inviteAcceptText}>Accept</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[
                      styles.inviteDeclineButton,
                      { borderColor: colors.destructive },
                    ]}
                    onPress={() =>
                      handleRespondToInvite(invite.channelId, "declined")
                    }
                    disabled={respondingTo !== null}
                  >
                    {respondingTo === `${invite.channelId}-decline` ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.destructive}
                      />
                    ) : (
                      <Ionicons
                        name="close"
                        size={18}
                        color={colors.destructive}
                      />
                    )}
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {isLeader && <ChannelJoinRequestsBanner groupId={groupId} />}
    </View>
  );
}

function SectionHeader({
  colors,
  label,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  label: string;
}) {
  return (
    <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
      {label.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 0,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  card: {
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: "hidden",
  },
  loadingContainer: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 56,
    gap: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  rowSubtitle: {
    fontSize: 13,
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
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 12,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 56,
  },
  actionRowLabel: {
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
