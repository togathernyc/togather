/**
 * ChannelsSection Component
 *
 * Displays all channels for a group with management options.
 * Part of the Group Detail screen.
 *
 * Features:
 * - Shows "Auto Channels" section (General and Leaders channels)
 * - Shows "Custom Channels" section with user's custom channels
 * - Leaders can toggle any channel on/off (General, Leaders, Reach Out, PCO, custom)
 * - Leaders can manage custom channel members
 * - Leaders can create new custom channels
 * - Users can leave custom channels
 * - Pin indicators for pinned channels
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Switch,
  ActivityIndicator,
  Share,
  ActionSheetIOS,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  useAuthenticatedMutation,
  useQuery,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useTheme } from "@hooks/useTheme";
import { DOMAIN_CONFIG } from "@togather/shared";
import * as Clipboard from "expo-clipboard";
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
}

export function ChannelsSection({ groupId, userRole }: ChannelsSectionProps) {
  const router = useRouter();
  const { token } = useAuth();
  const { primaryColor } = useCommunityTheme();
  const { colors } = useTheme();
  const [togglingLeaders, setTogglingLeaders] = useState(false);
  const [togglingReachOut, setTogglingReachOut] = useState(false);
  const [togglingChannelId, setTogglingChannelId] = useState<string | null>(null);
  const [leavingChannelId, setLeavingChannelId] = useState<string | null>(null);

  // Determine if user is a leader
  const isLeader = userRole === "leader" || userRole === "admin";

  // Query pending shared channel invites for this group (leaders only)
  const pendingInvites = useQuery(
    api.functions.messaging.sharedChannels.listPendingInvitesForGroup,
    token && isLeader ? { token, groupId: groupId as Id<"groups"> } : "skip"
  );

  const { respondingTo, handleRespond: handleRespondToInvite } =
    useRespondToChannelInvite({ token, groupId });

  // Fetch channels for this group (with offline cache support)
  const { channels } = useGroupChannels(groupId, { includeArchived: isLeader });

  // Mutations
  const leaveChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.leaveChannel
  );
  const toggleLeadersChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.toggleLeadersChannel
  );
  const toggleReachOutChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.toggleReachOutChannel
  );
  const toggleMainChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.toggleMainChannel
  );
  const togglePcoChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.togglePcoChannel
  );
  const archiveCustomChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.archiveCustomChannel
  );
  const unarchiveCustomChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.unarchiveCustomChannel
  );
  const enableInviteLinkMutation = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.enableInviteLink
  );

  // Filter channels by type
  const mainChannel = channels?.find((c: Channel) => c.channelType === "main");
  const leadersChannel = channels?.find((c: Channel) => c.channelType === "leaders");
  const pcoSyncedChannels = channels?.filter((c: Channel) => c.channelType === "pco_services") ?? [];
  const customChannels = channels?.filter((c: Channel) => c.channelType === "custom") ?? [];

  // Check if leaders channel is enabled (exists and not archived)
  const leadersChannelEnabled = leadersChannel && !leadersChannel.isArchived;

  const mainChannelEnabled = mainChannel ? !mainChannel.isArchived : false;

  // Check if reach out channel exists and is enabled
  const reachOutChannel = channels?.find((c: Channel) => c.channelType === "reach_out");
  const reachOutEnabled = reachOutChannel ? !reachOutChannel.isArchived : false;

  // Navigate to channel chat
  const handleChannelPress = useCallback(
    (channel: Channel) => {
      router.push(`/inbox/${groupId}/${channel.slug}`);
    },
    [router, groupId]
  );

  // Leave a custom channel
  const handleLeaveChannel = useCallback(
    (channel: Channel) => {
      Alert.alert(
        "Leave Channel",
        `Are you sure you want to leave "${channel.name}"?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: async () => {
              setLeavingChannelId(channel._id);
              try {
                await leaveChannelMutation({ channelId: channel._id });
              } catch (error: any) {
                Alert.alert(
                  "Error",
                  error?.message || "Failed to leave channel"
                );
              } finally {
                setLeavingChannelId(null);
              }
            },
          },
        ]
      );
    },
    [leaveChannelMutation]
  );

  // Navigate to manage members screen
  const handleManageMembers = useCallback(
    (channel: Channel) => {
      router.push(`/inbox/${groupId}/${channel.slug}/members`);
    },
    [router, groupId]
  );

  // Toggle leaders channel on/off
  const handleToggleLeadersChannel = useCallback(
    async (enabled: boolean) => {
      setTogglingLeaders(true);
      try {
        await toggleLeadersChannelMutation({
          groupId: groupId as Id<"groups">,
          enabled,
        });
      } catch (error: any) {
        Alert.alert(
          "Error",
          error?.message || "Failed to toggle leaders channel"
        );
      } finally {
        setTogglingLeaders(false);
      }
    },
    [toggleLeadersChannelMutation, groupId]
  );

  // Toggle reach out channel on/off
  const handleToggleReachOutChannel = useCallback(async (enabled: boolean) => {
    setTogglingReachOut(true);
    try {
      await toggleReachOutChannelMutation({ groupId: groupId as Id<"groups">, enabled });
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to toggle reach out channel");
    } finally {
      setTogglingReachOut(false);
    }
  }, [toggleReachOutChannelMutation, groupId]);

  const handleToggleMainChannel = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        Alert.alert(
          "Disable General channel?",
          "Members will not be able to use General until you turn it back on.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Disable",
              style: "destructive",
              onPress: async () => {
                setTogglingChannelId("main");
                try {
                  await toggleMainChannelMutation({
                    groupId: groupId as Id<"groups">,
                    enabled: false,
                  });
                } catch (error: any) {
                  Alert.alert(
                    "Error",
                    error?.message || "Failed to update General channel"
                  );
                } finally {
                  setTogglingChannelId(null);
                }
              },
            },
          ]
        );
        return;
      }
      setTogglingChannelId("main");
      try {
        await toggleMainChannelMutation({
          groupId: groupId as Id<"groups">,
          enabled: true,
        });
      } catch (error: any) {
        Alert.alert("Error", error?.message || "Failed to update General channel");
      } finally {
        setTogglingChannelId(null);
      }
    },
    [toggleMainChannelMutation, groupId]
  );

  const handleTogglePcoChannel = useCallback(
    async (channel: Channel, enabled: boolean) => {
      setTogglingChannelId(channel._id);
      try {
        await togglePcoChannelMutation({ channelId: channel._id, enabled });
      } catch (error: any) {
        Alert.alert("Error", error?.message || "Failed to update channel");
      } finally {
        setTogglingChannelId(null);
      }
    },
    [togglePcoChannelMutation]
  );

  const handleToggleCustomChannel = useCallback(
    async (channel: Channel, enabled: boolean) => {
      if (!enabled) {
        Alert.alert(
          "Disable channel?",
          `Everyone will be removed from "${channel.name}". You can enable the channel again later, but you will need to add members back.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Disable",
              style: "destructive",
              onPress: async () => {
                setTogglingChannelId(channel._id);
                try {
                  await archiveCustomChannelMutation({ channelId: channel._id });
                } catch (error: any) {
                  Alert.alert("Error", error?.message || "Failed to disable channel");
                } finally {
                  setTogglingChannelId(null);
                }
              },
            },
          ]
        );
        return;
      }
      setTogglingChannelId(channel._id);
      try {
        await unarchiveCustomChannelMutation({ channelId: channel._id });
      } catch (error: any) {
        Alert.alert("Error", error?.message || "Failed to enable channel");
      } finally {
        setTogglingChannelId(null);
      }
    },
    [archiveCustomChannelMutation, unarchiveCustomChannelMutation]
  );

  // Navigate to create channel screen
  const handleCreateChannel = useCallback(() => {
    router.push(`/inbox/${groupId}/create`);
  }, [router, groupId]);

  // Share channel invite link
  const handleShareChannel = useCallback(async (channel: Channel) => {
    try {
      const result = await enableInviteLinkMutation({
        channelId: channel._id,
      });
      const url = DOMAIN_CONFIG.channelInviteUrl(result.shortId);

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Copy Link", "Share Link"],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await Clipboard.setStringAsync(url);
              Alert.alert("Copied!", "Invite link copied to clipboard.");
            } else if (buttonIndex === 2) {
              Share.share({ url, message: `Join #${channel.name}: ${url}` });
            }
          }
        );
      } else {
        Share.share({ message: `Join #${channel.name}: ${url}` });
      }
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to share channel");
    }
  }, [enableInviteLinkMutation]);

  // Navigate to pin channels screen (dedicated route)
  const handlePinChannels = useCallback(() => {
    router.push(`/(user)/leader-tools/${groupId}/pin-channels`);
  }, [router, groupId]);

  // Navigate to toolbar settings screen
  const handleToolbarSettings = useCallback(() => {
    router.push(`/(user)/leader-tools/${groupId}/toolbar-settings`);
  }, [router, groupId]);

  // Loading state
  if (channels === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.header, { color: colors.text }]}>CHANNELS</Text>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  // No channels case (shouldn't happen normally)
  if (channels.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceSecondary }]}>
      {/* AUTO CHANNELS Section */}
      <Text style={[styles.header, { color: colors.text }]}>AUTO CHANNELS</Text>
      <View style={[styles.channelList, { backgroundColor: colors.surface }]}>
        {/* General Channel */}
        {mainChannel && (
          <View style={[styles.channelRow, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              style={styles.channelContent}
              onPress={() =>
                mainChannelEnabled ? handleChannelPress(mainChannel) : undefined
              }
              activeOpacity={mainChannelEnabled ? 0.7 : 1}
              disabled={!mainChannelEnabled}
            >
              <View style={[styles.channelIcon, { backgroundColor: primaryColor + "15" }]}>
                <Ionicons name="chatbubbles" size={20} color={primaryColor} />
              </View>
              <View style={styles.channelInfo}>
                <Text
                  style={[
                    styles.channelName,
                    { color: colors.text },
                    !mainChannelEnabled && { color: colors.textTertiary },
                  ]}
                >
                  General
                </Text>
                <Text style={[styles.channelSubtitle, { color: colors.textSecondary }]}>
                  {mainChannelEnabled ? "All members" : "Disabled"}
                </Text>
              </View>
              {mainChannelEnabled && mainChannel.unreadCount > 0 && (
                <View style={[styles.unreadBadge, { backgroundColor: primaryColor }]}>
                  <Text style={styles.unreadText}>
                    {mainChannel.unreadCount > 99 ? "99+" : mainChannel.unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            {isLeader ? (
              <View style={styles.toggleContainer}>
                {togglingChannelId === "main" ? (
                  <ActivityIndicator size="small" color={primaryColor} />
                ) : (
                  <Switch
                    testID="channel-toggle-general"
                    value={mainChannelEnabled}
                    onValueChange={handleToggleMainChannel}
                    trackColor={{ false: colors.border, true: primaryColor + "80" }}
                    thumbColor={mainChannelEnabled ? primaryColor : colors.surfaceSecondary}
                  />
                )}
              </View>
            ) : (
              mainChannelEnabled && (
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              )
            )}
          </View>
        )}

        {/* Leaders Channel */}
        {(leadersChannel || isLeader) && (
          <View style={[styles.channelRow, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              style={styles.channelContent}
              onPress={() => leadersChannel && leadersChannelEnabled && handleChannelPress(leadersChannel)}
              activeOpacity={leadersChannelEnabled ? 0.7 : 1}
              disabled={!leadersChannelEnabled}
            >
              <View style={[styles.channelIcon, { backgroundColor: "#FFA50015" }]}>
                <Ionicons name="star" size={20} color="#FFA500" />
              </View>
              <View style={styles.channelInfo}>
                <Text style={[styles.channelName, { color: colors.text }, !leadersChannelEnabled && { color: colors.textTertiary }]}>
                  Leaders
                </Text>
                <Text style={[styles.channelSubtitle, { color: colors.textSecondary }]}>
                  {leadersChannel
                    ? `${leadersChannel.memberCount} leader${leadersChannel.memberCount !== 1 ? "s" : ""}`
                    : "Disabled"}
                </Text>
                {leadersChannel && leadersChannelEnabled && (
                  <Text style={[styles.channelNote, { color: colors.textTertiary }]}>
                    You're here because you're a leader
                  </Text>
                )}
              </View>
              {leadersChannel && leadersChannelEnabled && leadersChannel.unreadCount > 0 && (
                <View style={[styles.unreadBadge, { backgroundColor: "#FFA500" }]}>
                  <Text style={styles.unreadText}>
                    {leadersChannel.unreadCount > 99 ? "99+" : leadersChannel.unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            {isLeader && (
              <View style={styles.toggleContainer}>
                {togglingLeaders ? (
                  <ActivityIndicator size="small" color={primaryColor} />
                ) : (
                  <Switch
                    testID="channel-toggle-leaders"
                    value={leadersChannelEnabled}
                    onValueChange={handleToggleLeadersChannel}
                    trackColor={{ false: colors.border, true: primaryColor + "80" }}
                    thumbColor={leadersChannelEnabled ? primaryColor : colors.surfaceSecondary}
                  />
                )}
              </View>
            )}
            {!isLeader && leadersChannelEnabled && (
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            )}
          </View>
        )}

        {/* Reach Out Channel */}
        {isLeader && (
          <View style={[styles.channelRow, { borderBottomColor: colors.border }]}>
            <View style={styles.channelContent}>
              <View style={[styles.channelIcon, { backgroundColor: "#8E44AD15" }]}>
                <Ionicons name="hand-left" size={20} color="#8E44AD" />
              </View>
              <View style={styles.channelInfo}>
                <Text style={[styles.channelName, { color: colors.text }, (!reachOutEnabled || !leadersChannelEnabled) && { color: colors.textTertiary }]}>
                  Reach Out
                </Text>
                <Text style={[styles.channelSubtitle, { color: colors.textSecondary }]}>
                  {!leadersChannelEnabled
                    ? "Requires Leaders channel"
                    : reachOutChannel
                      ? `${reachOutChannel.memberCount} member(s)`
                      : "Disabled"}
                </Text>
              </View>
            </View>
            <View style={styles.toggleContainer}>
              {togglingReachOut ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : (
                <Switch
                  testID="channel-toggle-reach-out"
                  value={reachOutEnabled}
                  onValueChange={handleToggleReachOutChannel}
                  trackColor={{ false: colors.border, true: primaryColor + "80" }}
                  thumbColor={reachOutEnabled ? primaryColor : colors.surfaceSecondary}
                  disabled={!leadersChannelEnabled}
                />
              )}
            </View>
          </View>
        )}

        {/* PCO Synced Channels */}
        {pcoSyncedChannels.map((channel: Channel) => {
          const pcoEnabled = !channel.isArchived;
          const canTogglePco = isLeader && !channel.isShared;
          return (
            <View key={channel._id} style={[styles.channelRow, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                style={styles.channelContent}
                onPress={() =>
                  pcoEnabled && channel.isMember
                    ? handleChannelPress(channel)
                    : pcoEnabled
                      ? handleManageMembers(channel)
                      : undefined
                }
                activeOpacity={pcoEnabled ? 0.7 : 1}
                disabled={!pcoEnabled}
              >
                <View style={[styles.channelIcon, { backgroundColor: "#2196F315" }]}>
                  <Ionicons name="sync" size={20} color="#2196F3" />
                </View>
                <View style={styles.channelInfo}>
                  <View style={styles.channelNameRow}>
                    <Text
                      style={[
                        styles.channelName,
                        { color: colors.text },
                        (!channel.isMember || !pcoEnabled) && { color: colors.textTertiary },
                      ]}
                    >
                      {channel.name}
                    </Text>
                    {channel.isPinned && (
                      <Ionicons name="pin" size={14} color={colors.iconSecondary} style={styles.pinIcon} />
                    )}
                  </View>
                  <Text style={[styles.channelSubtitle, { color: colors.textSecondary }]}>
                    {pcoEnabled
                      ? `${channel.memberCount} member${channel.memberCount !== 1 ? "s" : ""} · PCO Synced`
                      : "Disabled"}
                  </Text>
                  {!channel.isMember && isLeader && pcoEnabled && (
                    <Text style={[styles.channelNote, { color: colors.textTertiary }]}>
                      You're not in this channel
                    </Text>
                  )}
                </View>
                {pcoEnabled && channel.isMember && channel.unreadCount > 0 && (
                  <View style={[styles.unreadBadge, { backgroundColor: "#2196F3" }]}>
                    <Text style={styles.unreadText}>
                      {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              {canTogglePco && (
                <View style={styles.toggleContainer}>
                  {togglingChannelId === channel._id ? (
                    <ActivityIndicator size="small" color={primaryColor} />
                  ) : (
                    <Switch
                      testID={`channel-toggle-pco-${channel.slug}`}
                      value={pcoEnabled}
                      onValueChange={(on) => handleTogglePcoChannel(channel, on)}
                      trackColor={{ false: colors.border, true: primaryColor + "80" }}
                      thumbColor={pcoEnabled ? primaryColor : colors.surfaceSecondary}
                    />
                  )}
                </View>
              )}
              {isLeader && (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }]}
                  onPress={() => handleManageMembers(channel)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="settings-outline" size={18} color={colors.icon} />
                </TouchableOpacity>
              )}
              {!isLeader && channel.isMember && (
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              )}
            </View>
          );
        })}
      </View>

      {/* PENDING SHARED CHANNEL INVITATIONS Section */}
      {isLeader && pendingInvites && pendingInvites.length > 0 && (
        <>
          <Text style={[styles.header, styles.customHeader, { color: colors.text }]}>SHARED CHANNEL INVITATIONS</Text>
          <View style={[styles.channelList, { backgroundColor: colors.surface }]}>
            {pendingInvites.map((invite) => (
              <View key={invite.channelId} style={[styles.channelRow, { borderBottomColor: colors.border }]}>
                <View style={styles.channelContent}>
                  <View style={[styles.channelIcon, { backgroundColor: "#8B5CF615" }]}>
                    <Ionicons name="link" size={20} color="#8B5CF6" />
                  </View>
                  <View style={styles.channelInfo}>
                    <Text style={[styles.channelName, { color: colors.text }]}>#{invite.channelName}</Text>
                    <Text style={[styles.channelSubtitle, { color: colors.textSecondary }]}>
                      From {invite.primaryGroupName}
                    </Text>
                    <Text style={[styles.channelNote, { color: colors.textTertiary }]}>
                      Invited by {invite.invitedByName}
                    </Text>
                  </View>
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

      {/* CUSTOM CHANNELS Section */}
      {(customChannels.length > 0 || isLeader) && (
        <>
          <Text style={[styles.header, styles.customHeader, { color: colors.text }]}>CUSTOM CHANNELS</Text>
          {isLeader && <ChannelJoinRequestsBanner groupId={groupId} />}
          <View style={[styles.channelList, { backgroundColor: colors.surface }]}>
            {customChannels.map((channel: Channel) => {
              const customEnabled = !channel.isArchived;
              const canToggleCustom = isLeader && !channel.isShared;
              return (
                <View key={channel._id} style={[styles.channelRow, { borderBottomColor: colors.border }]}>
                  <TouchableOpacity
                    style={styles.channelContent}
                    onPress={() =>
                      customEnabled && channel.isMember
                        ? handleChannelPress(channel)
                        : customEnabled
                          ? handleManageMembers(channel)
                          : undefined
                    }
                    activeOpacity={customEnabled ? 0.7 : 1}
                    disabled={!customEnabled}
                  >
                    <View style={[styles.channelIcon, { backgroundColor: "#00BCD415" }]}>
                      <Ionicons name="chatbubble" size={20} color="#00BCD4" />
                    </View>
                    <View style={styles.channelInfo}>
                      <View style={styles.channelNameRow}>
                        <Text
                          style={[
                            styles.channelName,
                            { color: colors.text },
                            (!channel.isMember || !customEnabled) && { color: colors.textTertiary },
                          ]}
                        >
                          {channel.name}
                        </Text>
                        {channel.isPinned && (
                          <Ionicons name="pin" size={14} color={colors.iconSecondary} style={styles.pinIcon} />
                        )}
                      </View>
                      <Text style={[styles.channelSubtitle, { color: colors.textSecondary }]}>
                        {customEnabled
                          ? `${channel.memberCount} member${channel.memberCount !== 1 ? "s" : ""}`
                          : "Disabled · add members after enabling"}
                      </Text>
                      {!channel.isMember && isLeader && customEnabled && (
                        <Text style={[styles.channelNote, { color: colors.textTertiary }]}>
                          You're not in this channel
                        </Text>
                      )}
                    </View>
                    {customEnabled && channel.isMember && channel.unreadCount > 0 && (
                      <View style={[styles.unreadBadge, { backgroundColor: "#00BCD4" }]}>
                        <Text style={styles.unreadText}>
                          {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  {canToggleCustom && (
                    <View style={styles.toggleContainer}>
                      {togglingChannelId === channel._id ? (
                        <ActivityIndicator size="small" color={primaryColor} />
                      ) : (
                        <Switch
                          testID={`channel-toggle-custom-${channel.slug}`}
                          value={customEnabled}
                          onValueChange={(on) => handleToggleCustomChannel(channel, on)}
                          trackColor={{ false: colors.border, true: primaryColor + "80" }}
                          thumbColor={customEnabled ? primaryColor : colors.surfaceSecondary}
                        />
                      )}
                    </View>
                  )}
                  <View style={styles.actionButtons}>
                    {isLeader && customEnabled && (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }]}
                        onPress={() => handleManageMembers(channel)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="people-outline" size={18} color={colors.icon} />
                      </TouchableOpacity>
                    )}
                    {isLeader && customEnabled && (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }]}
                        onPress={() => handleShareChannel(channel)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="share-outline" size={18} color={colors.icon} />
                      </TouchableOpacity>
                    )}
                    {channel.isMember && customEnabled && (
                      <TouchableOpacity
                        style={[styles.actionButton, { backgroundColor: colors.surfaceSecondary }]}
                        onPress={() => handleLeaveChannel(channel)}
                        activeOpacity={0.7}
                        disabled={leavingChannelId === channel._id}
                      >
                        {leavingChannelId === channel._id ? (
                          <ActivityIndicator size="small" color={colors.destructive} />
                        ) : (
                          <Ionicons name="exit-outline" size={18} color={colors.destructive} />
                        )}
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            {/* Empty state for custom channels */}
            {customChannels.length === 0 && isLeader && (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyStateText, { color: colors.textTertiary }]}>
                  No custom channels yet
                </Text>
              </View>
            )}
          </View>

          {/* Create Channel Button (Leaders only) */}
          {isLeader && (
            <TouchableOpacity
              style={[styles.createButton, { borderColor: primaryColor, backgroundColor: colors.surface }]}
              onPress={handleCreateChannel}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={20} color={primaryColor} />
              <Text style={[styles.createButtonText, { color: primaryColor }]}>
                Create Channel
              </Text>
            </TouchableOpacity>
          )}

          {/* Pin Channels Button (Leaders only) */}
          {isLeader && (
            <TouchableOpacity
              style={styles.pinChannelsButton}
              onPress={handlePinChannels}
              activeOpacity={0.7}
            >
              <Ionicons name="pin-outline" size={18} color={colors.icon} />
              <Text style={[styles.pinChannelsButtonText, { color: colors.icon }]}>Pin Channels</Text>
            </TouchableOpacity>
          )}

          {/* Toolbar Settings Button (Leaders only) */}
          {isLeader && (
            <TouchableOpacity
              style={styles.pinChannelsButton}
              onPress={handleToolbarSettings}
              activeOpacity={0.7}
            >
              <Ionicons name="options-outline" size={18} color={colors.icon} />
              <Text style={[styles.pinChannelsButtonText, { color: colors.icon }]}>Toolbar Settings</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  header: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  customHeader: {
    marginTop: 20,
  },
  loadingContainer: {
    paddingVertical: 20,
    alignItems: "center",
  },
  channelList: {
    borderRadius: 12,
    overflow: "hidden",
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  channelContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  channelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  channelInfo: {
    flex: 1,
  },
  channelNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  channelName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  pinIcon: {
    marginLeft: 6,
    marginBottom: 2,
  },
  channelSubtitle: {
    fontSize: 13,
  },
  channelNote: {
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
    marginRight: 8,
  },
  unreadText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
  },
  toggleContainer: {
    marginLeft: 8,
    width: 51, // Standard Switch width
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    paddingVertical: 16,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  pinChannelsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    paddingVertical: 10,
    gap: 6,
  },
  pinChannelsButtonText: {
    fontSize: 14,
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
