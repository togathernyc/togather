/**
 * ChannelInfoScreen
 *
 * Mirror of `ChatInfoScreen` (the DM info surface) but for group channels
 * — Leaders, Reach Out, PCO synced, and custom channels. Reached via the
 * (i) icon in the chat header on non-General channels and via the
 * CHANNELS card on the group page.
 *
 * General (channelType === "main") does NOT mount this screen — the
 * group page IS the channel info for General. The route shim
 * `/inbox/[groupId]/[channelSlug]/info/index.tsx` redirects in that
 * case.
 *
 * Layout (DM-sleek):
 *   - "Channel info" centered title + back chevron
 *   - Centered hero (channel icon + #name + "N members" + share pill if shared)
 *   - "Open chat" CTA card
 *   - MEMBERS card
 *   - "Add people" standalone card (leaders only — manage screen)
 *   - CHANNEL ACTIONS (Share invite link, Leave channel)
 *   - LEADER CONTROLS (Active state, Rename, Share with groups, Archive)
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  Share,
  ActionSheetIOS,
  Platform,
  TextInput,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Avatar } from "@components/ui/Avatar";
import { ConfirmModal } from "@components/ui/ConfirmModal";
import { CustomModal } from "@components/ui/Modal";
import { AutoChannelSettings } from "@features/channels";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  useQuery,
  api,
  useAuthenticatedMutation,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DOMAIN_CONFIG } from "@togather/shared";

type Props = {
  groupId: string;
  channelSlug: string;
};

type ChannelType = "main" | "leaders" | "reach_out" | "pco_services" | "custom";

type ChannelIconConfig = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  bg: string;
  defaultName: string;
};

function getChannelIconConfig(
  channelType: string,
  brand: string,
): ChannelIconConfig {
  switch (channelType) {
    case "main":
      return { icon: "chatbubbles", color: brand, bg: brand + "15", defaultName: "General" };
    case "leaders":
      return { icon: "star", color: "#FFA500", bg: "#FFA50015", defaultName: "Leaders" };
    case "reach_out":
      return { icon: "hand-left", color: "#8E44AD", bg: "#8E44AD15", defaultName: "Reach Out" };
    case "pco_services":
      return { icon: "sync", color: "#2196F3", bg: "#2196F315", defaultName: "PCO Channel" };
    default:
      return { icon: "chatbubble", color: "#00BCD4", bg: "#00BCD415", defaultName: "Channel" };
  }
}

export function ChannelInfoScreen({ groupId, channelSlug }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const channel = useQuery(
    api.functions.messaging.channels.getChannelBySlug,
    // includeArchived: leaders may land here on a disabled Leaders/Reach Out
    // channel (where `isArchived` doubles as the legacy-disable flag) so they
    // can re-enable from Active state. Without this, the row is filtered out
    // and the screen shows "no longer available."
    token
      ? { token, groupId: groupId as Id<"groups">, slug: channelSlug, includeArchived: true }
      : "skip",
  );

  const channelMembers = useQuery(
    api.functions.messaging.channels.getChannelMembers,
    token && channel
      ? { token, channelId: channel._id, limit: 50 }
      : "skip",
  );

  // Group data — needed to pass communityId into AutoChannelSettings for
  // PCO synced channels.
  const groupData = useQuery(
    api.functions.groups.index.getById,
    token ? { token, groupId: groupId as Id<"groups"> } : "skip",
  );

  // Invite info — exposes joinMode for the Leader Controls "Join mode" row.
  // Leader-only on the backend; query returns null for non-leaders.
  const inviteInfo = useQuery(
    api.functions.messaging.channelInvites.getInviteInfo,
    token && channel?._id ? { token, channelId: channel._id } : "skip",
  );

  // Pending join requests (custom channels, leader-only) — surfaced as a
  // dedicated REQUESTS card on this screen so leaders don't have to dig
  // into /members to approve.
  const pendingRequests = useQuery(
    api.functions.messaging.channelInvites.getPendingRequests,
    token && channel?._id && channel.channelType === "custom"
      ? { token, channelId: channel._id }
      : "skip",
  );

  const approveRequestMutation = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.approveJoinRequest,
  );
  const declineRequestMutation = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.declineJoinRequest,
  );

  const updateChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.updateChannel,
  );
  const leaveChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.leaveChannel,
  );
  const enableInviteLinkMutation = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.enableInviteLink,
  );

  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pcoSettingsVisible, setPcoSettingsVisible] = useState(false);
  const [requestInFlight, setRequestInFlight] = useState<string | null>(null);

  const handleJoinMode = useCallback(() => {
    router.push(`/inbox/${groupId}/${channelSlug}/info/join-mode` as any);
  }, [router, groupId, channelSlug]);

  const handleApproveRequest = useCallback(
    async (requestId: Id<"channelJoinRequests">) => {
      setRequestInFlight(requestId as string);
      try {
        await approveRequestMutation({ requestId });
      } catch (e: any) {
        Alert.alert("Could not approve", e?.message ?? "Try again.");
      } finally {
        setRequestInFlight(null);
      }
    },
    [approveRequestMutation],
  );

  const handleDeclineRequest = useCallback(
    async (requestId: Id<"channelJoinRequests">) => {
      Alert.alert("Decline request?", "The user will not be added to the channel.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            setRequestInFlight(requestId as string);
            try {
              await declineRequestMutation({ requestId });
            } catch (e: any) {
              Alert.alert("Could not decline", e?.message ?? "Try again.");
            } finally {
              setRequestInFlight(null);
            }
          },
        },
      ]);
    },
    [declineRequestMutation],
  );

  const isLeader = useMemo(() => {
    return (
      channel?.userGroupRole === "leader" || channel?.userGroupRole === "admin"
    );
  }, [channel?.userGroupRole]);

  const channelType = (channel?.channelType ?? "custom") as ChannelType;
  const isMain = channelType === "main";
  const isCustom = channelType === "custom";
  const isLeadersChannel = channelType === "leaders";
  const isReachOut = channelType === "reach_out";
  const isPco = channelType === "pco_services";

  const iconCfg = getChannelIconConfig(channelType, primaryColor);
  const channelDisplayName = channel?.name?.trim() || iconCfg.defaultName;

  const sharedGroupCount = useMemo(() => {
    if (!channel?.sharedGroups) return 0;
    return channel.sharedGroups.filter((sg: any) => sg.status === "accepted").length;
  }, [channel?.sharedGroups]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/groups/${groupId}` as any);
    }
  }, [router, groupId]);

  const handleOpenChat = useCallback(() => {
    router.push(`/inbox/${groupId}/${channelSlug}` as any);
  }, [router, groupId, channelSlug]);

  const handleManageMembers = useCallback(() => {
    router.push(`/inbox/${groupId}/${channelSlug}/members` as any);
  }, [router, groupId, channelSlug]);

  const handleActiveState = useCallback(() => {
    router.push(`/inbox/${groupId}/${channelSlug}/info/active-state` as any);
  }, [router, groupId, channelSlug]);

  const handleShareInvite = useCallback(async () => {
    if (!isCustom) {
      Alert.alert(
        "Not available",
        "Invite links are only available for custom channels.",
      );
      return;
    }
    if (!channel?._id) return;
    try {
      const result = await enableInviteLinkMutation({ channelId: channel._id });
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
              Share.share({
                url,
                message: `Join #${channelDisplayName}: ${url}`,
              });
            }
          },
        );
      } else {
        await Share.share({
          message: `Join #${channelDisplayName}: ${url}`,
        });
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Failed to share channel");
    }
  }, [enableInviteLinkMutation, channel?._id, isCustom, channelDisplayName]);

  const handleLeaveChannel = useCallback(async () => {
    if (!channel?._id) return;
    setLeaving(true);
    try {
      await leaveChannelMutation({ channelId: channel._id });
      setLeaveVisible(false);
      router.replace(`/groups/${groupId}` as any);
    } catch (e: any) {
      Alert.alert("Couldn't leave", e?.message || "Please try again.");
    } finally {
      setLeaving(false);
    }
  }, [channel?._id, leaveChannelMutation, groupId, router]);

  const handleRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Channel name can't be empty");
      return;
    }
    if (!channel?._id) return;
    setRenameSubmitting(true);
    try {
      await updateChannelMutation({
        channelId: channel._id,
        name: trimmed,
      });
      setRenameVisible(false);
      setRenameError(null);
    } catch (e: any) {
      setRenameError(e?.message || "Could not rename channel");
    } finally {
      setRenameSubmitting(false);
    }
  }, [renameValue, channel?._id, updateChannelMutation]);

  if (channel === undefined) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  if (!channel) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} />
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This channel is no longer available.
          </Text>
        </View>
      </View>
    );
  }

  // Main channel never reaches the rendered body — the route shim
  // redirects to the group page. This is a defensive fallback.
  if (isMain) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        <Header onBack={handleBack} colors={colors} />
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            The General channel uses the group page for info.
          </Text>
        </View>
      </View>
    );
  }

  const memberRows = channelMembers?.members ?? [];
  const totalMemberCount = channelMembers?.totalCount ?? channel.memberCount ?? 0;
  const ownerId = (channel as { createdById?: Id<"users"> }).createdById;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <Header onBack={handleBack} colors={colors} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
      >
        {/* Hero */}
        <View style={styles.heroSection}>
          <View style={[styles.heroIconCircle, { backgroundColor: iconCfg.bg }]}>
            <Ionicons name={iconCfg.icon} size={48} color={iconCfg.color} />
          </View>
          <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={2}>
            {isCustom || isPco ? `#${channelDisplayName}` : channelDisplayName}
          </Text>
          <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
            {totalMemberCount} {totalMemberCount === 1 ? "member" : "members"}
          </Text>
          {sharedGroupCount > 0 && (
            <View
              style={[
                styles.sharedPill,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              ]}
            >
              <Ionicons name="link" size={12} color={colors.textSecondary} />
              <Text style={[styles.sharedPillText, { color: colors.textSecondary }]}>
                Shared with {sharedGroupCount} group{sharedGroupCount === 1 ? "" : "s"}
              </Text>
            </View>
          )}
        </View>

        {/* Open chat */}
        <Pressable
          onPress={handleOpenChat}
          style={({ pressed }) => [
            styles.actionCard,
            {
              backgroundColor: pressed ? colors.selectedBackground : colors.surfaceSecondary,
            },
          ]}
        >
          <View style={[styles.actionIcon, { backgroundColor: iconCfg.bg }]}>
            <Ionicons name="chatbubbles" size={18} color={iconCfg.color} />
          </View>
          <Text style={[styles.actionLabel, { color: colors.text }]}>
            Open chat
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>

        {/* Pending join requests — leader-only, custom channels with
            approval-required mode. Shown above Members so leaders see
            pending work first. */}
        {isLeader && (pendingRequests?.length ?? 0) > 0 && (
          <>
            <SectionHeader
              colors={colors}
              label={`Requests · ${pendingRequests!.length}`}
            />
            <View style={[styles.sectionGroup, { backgroundColor: colors.surfaceSecondary }]}>
              {pendingRequests!.map((req: any, idx: number) => {
                const inFlight = requestInFlight === (req._id as string);
                const requesterName = req.userName || req.user?.displayName || "Someone";
                return (
                  <View
                    key={req._id}
                    style={[
                      styles.requestRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <Avatar
                      name={requesterName}
                      imageUrl={req.userPhoto || req.user?.profilePhoto}
                      size={40}
                    />
                    <View style={styles.requestText}>
                      <Text
                        style={[styles.requestName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {requesterName}
                      </Text>
                      <Text
                        style={[styles.requestSubtitle, { color: colors.textSecondary }]}
                        numberOfLines={1}
                      >
                        Wants to join
                      </Text>
                    </View>
                    <View style={styles.requestActions}>
                      <Pressable
                        onPress={() => handleDeclineRequest(req._id)}
                        disabled={inFlight}
                        style={({ pressed }) => [
                          styles.requestActionBtn,
                          {
                            backgroundColor: pressed
                              ? colors.selectedBackground
                              : colors.surface,
                            opacity: inFlight ? 0.5 : 1,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.requestActionLabel, { color: colors.destructive }]}
                        >
                          Decline
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleApproveRequest(req._id)}
                        disabled={inFlight}
                        style={({ pressed }) => [
                          styles.requestActionBtn,
                          {
                            backgroundColor: pressed
                              ? primaryColor + "CC"
                              : primaryColor,
                            opacity: inFlight ? 0.6 : 1,
                          },
                        ]}
                      >
                        {inFlight ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text
                            style={[styles.requestActionLabel, { color: "#fff" }]}
                          >
                            Approve
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Members */}
        {memberRows.length > 0 && (
          <>
            <SectionHeader colors={colors} label="Members" />
            <View style={[styles.sectionGroup, { backgroundColor: colors.surfaceSecondary }]}>
              {memberRows.map((m: any, idx: number) => {
                const displayName = m.displayName || "Member";
                const isOwner = !!ownerId && m.userId === ownerId;
                const isSelf = m.userId === user?.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => router.push(`/profile/${m.userId}` as any)}
                    style={({ pressed }) => [
                      styles.memberRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                      pressed && { backgroundColor: colors.selectedBackground },
                    ]}
                  >
                    <Avatar
                      name={displayName}
                      imageUrl={m.profilePhoto}
                      size={40}
                    />
                    <View style={styles.memberRowText}>
                      <Text
                        style={[styles.memberRowName, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {displayName}
                        {isSelf ? (
                          <Text style={{ color: colors.textSecondary }}> (you)</Text>
                        ) : null}
                      </Text>
                      {isOwner && (
                        <Text
                          style={[styles.memberRowSubtitle, { color: colors.textSecondary }]}
                        >
                          OWNER
                        </Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                  </Pressable>
                );
              })}
            </View>
            {totalMemberCount > memberRows.length && (
              <Pressable
                onPress={handleManageMembers}
                style={({ pressed }) => [
                  styles.viewAllButton,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.viewAllText, { color: primaryColor }]}>
                  View all {totalMemberCount} members
                </Text>
              </Pressable>
            )}
          </>
        )}

        {/* Add people — for now this routes to the existing manage-members
            sub-route. TODO: fold the in-screen picker (mirror of DM
            ChatInfoScreen.AddPeopleModal) inline once we have a
            channel-scoped search query. */}
        {isLeader && (
          <Pressable
            onPress={handleManageMembers}
            style={({ pressed }) => [
              styles.actionCard,
              {
                backgroundColor: pressed ? colors.selectedBackground : colors.surfaceSecondary,
              },
            ]}
          >
            <View style={[styles.actionIcon, { backgroundColor: primaryColor + "15" }]}>
              <Ionicons name="person-add" size={18} color={primaryColor} />
            </View>
            <Text style={[styles.actionLabel, { color: colors.text }]}>
              Add people
            </Text>
          </Pressable>
        )}

        {/* CHANNEL ACTIONS */}
        <SectionHeader colors={colors} label="Channel actions" />
        <View style={[styles.sectionGroup, { backgroundColor: colors.surfaceSecondary }]}>
          {isLeader && isCustom && (
            <Pressable
              onPress={handleShareInvite}
              style={({ pressed }) => [
                styles.actionRowFlat,
                pressed && { backgroundColor: colors.selectedBackground },
              ]}
            >
              <Ionicons name="share-outline" size={20} color={colors.icon} />
              <Text style={[styles.actionLabel, { color: colors.text }]}>
                Share invite link
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setLeaveVisible(true)}
            style={({ pressed }) => [
              styles.actionRowFlat,
              isLeader && isCustom && {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              },
              pressed && { backgroundColor: colors.selectedBackground },
            ]}
          >
            <Ionicons name="exit-outline" size={20} color={colors.destructive} />
            <Text style={[styles.actionLabel, { color: colors.destructive }]}>
              Leave channel
            </Text>
          </Pressable>
        </View>

        {/* LEADER CONTROLS */}
        {isLeader && (
          <>
            <SectionHeader colors={colors} label="Leader controls" />
            <View
              style={[styles.sectionGroup, { backgroundColor: colors.surfaceSecondary }]}
            >
              {/* Active state — common to leaders/reach_out/custom/pco */}
              <Pressable
                onPress={handleActiveState}
                style={({ pressed }) => [
                  styles.actionRowFlat,
                  pressed && { backgroundColor: colors.selectedBackground },
                ]}
              >
                <Ionicons name="toggle-outline" size={20} color={colors.icon} />
                <Text style={[styles.actionLabel, { color: colors.text }]}>
                  Active state
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                  style={{ marginLeft: "auto" }}
                />
              </Pressable>

              {/* Join mode — custom channels only. Routes to an explicit
                  picker (Open / Approval required) so leaders don't have to
                  dive into Share with groups → swap-icon to change it. */}
              {isCustom && (
                <Pressable
                  onPress={handleJoinMode}
                  style={({ pressed }) => [
                    styles.actionRowFlat,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                    pressed && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Ionicons name="key-outline" size={20} color={colors.icon} />
                  <Text style={[styles.actionLabel, { color: colors.text }]}>
                    Join mode
                  </Text>
                  <Text
                    style={[
                      styles.actionRowValue,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {(inviteInfo?.joinMode ?? "open") === "open"
                      ? "Open"
                      : "Approval required"}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                  />
                </Pressable>
              )}

              {/* PCO Sync Settings — open the existing AutoChannelSettings
                  modal. Only meaningful for PCO synced channels. */}
              {isPco && (
                <Pressable
                  onPress={() => setPcoSettingsVisible(true)}
                  style={({ pressed }) => [
                    styles.actionRowFlat,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                    pressed && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Ionicons name="sync-outline" size={20} color={colors.icon} />
                  <Text style={[styles.actionLabel, { color: colors.text }]}>
                    PCO sync settings
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                    style={{ marginLeft: "auto" }}
                  />
                </Pressable>
              )}

              {/* Rename — custom channels only (backend gates the rest). */}
              {isCustom && (
                <Pressable
                  onPress={() => {
                    setRenameValue(channelDisplayName);
                    setRenameError(null);
                    setRenameVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.actionRowFlat,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                    pressed && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Ionicons name="create-outline" size={20} color={colors.icon} />
                  <Text style={[styles.actionLabel, { color: colors.text }]}>
                    Rename
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                    style={{ marginLeft: "auto" }}
                  />
                </Pressable>
              )}

              {/* Share with groups — custom + pco_services */}
              {(isCustom || isPco) && (
                <Pressable
                  onPress={handleManageMembers}
                  style={({ pressed }) => [
                    styles.actionRowFlat,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                    pressed && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Ionicons name="people-outline" size={20} color={colors.icon} />
                  <Text style={[styles.actionLabel, { color: colors.text }]}>
                    Share with groups
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                    style={{ marginLeft: "auto" }}
                  />
                </Pressable>
              )}

              {/* Archive — custom only (Leaders/Reach Out are toggled via
                  Active state; archive is a stronger op). */}
              {isCustom && (
                <Pressable
                  onPress={handleManageMembers}
                  style={({ pressed }) => [
                    styles.actionRowFlat,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                    pressed && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Ionicons
                    name="archive-outline"
                    size={20}
                    color={colors.destructive}
                  />
                  <Text
                    style={[styles.actionLabel, { color: colors.destructive }]}
                  >
                    Archive channel
                  </Text>
                </Pressable>
              )}

              {/* Reach Out hint — surface the dependency on Leaders. */}
              {isReachOut && (
                <View
                  style={[
                    styles.helperRow,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                    Reach Out requires the Leaders channel to be active.
                  </Text>
                </View>
              )}

              {/* Leaders channel hint */}
              {isLeadersChannel && (
                <View
                  style={[
                    styles.helperRow,
                    {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.helperText, { color: colors.textSecondary }]}>
                    Leaders channel is private to group leaders and admins.
                  </Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Rename modal */}
      <CustomModal
        visible={renameVisible}
        onClose={() => {
          if (!renameSubmitting) {
            setRenameVisible(false);
            setRenameError(null);
          }
        }}
        title="Rename channel"
      >
        <View>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder="Channel name"
            placeholderTextColor={colors.textSecondary}
            maxLength={100}
            autoFocus
            style={[
              styles.renameInput,
              {
                color: colors.text,
                backgroundColor: colors.inputBackground,
                borderColor: colors.inputBorder,
              },
            ]}
          />
          {renameError ? (
            <Text style={[styles.errorText, { color: colors.destructive, marginTop: 8 }]}>
              {renameError}
            </Text>
          ) : null}
          <View style={styles.modalButtonRow}>
            <TouchableOpacity
              onPress={() => {
                setRenameVisible(false);
                setRenameError(null);
              }}
              disabled={renameSubmitting}
              style={[styles.modalButton, { backgroundColor: colors.surfaceSecondary }]}
            >
              <Text style={[styles.modalButtonText, { color: colors.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleRename}
              disabled={renameSubmitting}
              style={[
                styles.modalButton,
                { backgroundColor: primaryColor },
                renameSubmitting && { opacity: 0.6 },
              ]}
            >
              {renameSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={[styles.modalButtonText, { color: "#ffffff" }]}>
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </CustomModal>

      <ConfirmModal
        visible={leaveVisible}
        title="Leave channel"
        message="You won't see new messages and the channel will be removed from your inbox."
        onConfirm={handleLeaveChannel}
        onCancel={() => setLeaveVisible(false)}
        confirmText="Leave"
        destructive
        isLoading={leaving}
      />

      {/* PCO Sync Settings — full-screen modal mounting the existing
          AutoChannelSettings UI for PCO synced channels. */}
      <Modal
        visible={pcoSettingsVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPcoSettingsVisible(false)}
      >
        {channel && groupData?.communityId && (
          <AutoChannelSettings
            channelId={channel._id}
            groupId={groupId as Id<"groups">}
            communityId={groupData.communityId}
            canEdit={isLeader}
            onClose={() => setPcoSettingsVisible(false)}
          />
        )}
      </Modal>
    </View>
  );
}

function Header({
  onBack,
  colors,
}: {
  onBack: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View
      style={[
        styles.headerBar,
        {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <TouchableOpacity onPress={onBack} style={styles.headerBackButton} hitSlop={12}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Channel info</Text>
      <View style={styles.headerSpacer} />
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
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBackButton: {
    padding: 4,
    marginRight: 4,
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  centered: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  heroSection: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  heroIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  heroName: {
    marginTop: 16,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  heroSubtitle: {
    marginTop: 4,
    fontSize: 13,
  },
  sharedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sharedPillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  sectionGroup: {
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 56,
    gap: 12,
  },
  memberRowText: {
    flex: 1,
    minWidth: 0,
  },
  memberRowName: {
    fontSize: 16,
    fontWeight: "500",
  },
  memberRowSubtitle: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  viewAllButton: {
    alignItems: "center",
    paddingVertical: 10,
    marginHorizontal: 12,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "600",
  },
  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 12,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 48,
  },
  actionIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  actionRowFlat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  actionLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  actionRowValue: {
    fontSize: 14,
    fontWeight: "500",
    marginLeft: "auto",
    marginRight: 4,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  requestText: {
    flex: 1,
    flexDirection: "column",
    gap: 2,
  },
  requestName: {
    fontSize: 15,
    fontWeight: "600",
  },
  requestSubtitle: {
    fontSize: 12,
  },
  requestActions: {
    flexDirection: "row",
    gap: 8,
  },
  requestActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 72,
    alignItems: "center",
  },
  requestActionLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  helperRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 44,
  },
  modalButtonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
