/**
 * ChannelInfoScreen
 *
 * Mirror of `ChatInfoScreen` (the DM info surface) but for group channels
 * — General, Leaders, Reach Out, PCO synced, and custom channels. Reached
 * via the (i) icon in the chat header and via the CHANNELS card on the
 * group page.
 *
 * General (channelType === "main") mounts this screen like every other
 * channel, but only renders the hero, Open chat, Members, and the
 * leader-only Active state control — General can't be renamed, archived,
 * shared, left, or have people added (its membership is the group itself).
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
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Avatar } from "@components/ui/Avatar";
import { AdminViewNote } from "@components/ui/AdminViewNote";
import { ConfirmModal } from "@components/ui/ConfirmModal";
import { CustomModal } from "@components/ui/Modal";
import { AutoChannelSettings } from "@features/channels";
import {
  CrossTeamSelectorPicker,
  listCrossTeamChannelsRef,
  updateCrossTeamChannelRef,
  type CrossTeamChannel,
  type CrossTeamSelector,
} from "@features/scheduling";
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
import {
  getDebugReasonText,
  type UnsyncedPerson,
} from "@/utils/channel-members";

type Props = {
  groupId: string;
  channelSlug: string;
  /**
   * Optional disambiguator for shared channels. Channel slugs are only unique
   * within the owning group, so a group invited to two same-slug channels needs
   * the id to resolve the right one. Plain group channels omit it.
   */
  channelId?: string;
};

type ChannelType =
  | "main"
  | "leaders"
  | "reach_out"
  | "pco_services"
  | "custom"
  | "cross_team";

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
    case "cross_team":
      return { icon: "git-merge", color: "#00897B", bg: "#00897B15", defaultName: "Cross-team Channel" };
    default:
      return { icon: "chatbubble", color: "#00BCD4", bg: "#00BCD415", defaultName: "Channel" };
  }
}

export function ChannelInfoScreen({ groupId, channelSlug, channelId }: Props) {
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
      ? {
          token,
          groupId: groupId as Id<"groups">,
          slug: channelSlug,
          includeArchived: true,
          ...(channelId ? { channelId: channelId as Id<"chatChannels"> } : {}),
        }
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
  const respondToInviteMutation = useAuthenticatedMutation(
    api.functions.messaging.sharedChannels.respondToChannelInvite,
  );
  const removeGroupFromChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.sharedChannels.removeGroupFromChannel,
  );
  const archiveCustomChannelMutation = useAuthenticatedMutation(
    api.functions.messaging.channels.archiveCustomChannel,
  );
  const enableInviteLinkMutation = useAuthenticatedMutation(
    api.functions.messaging.channelInvites.enableInviteLink,
  );
  const addByPcoPersonId = useAuthenticatedMutation(
    api.functions.groupMembers.addByPcoPersonId,
  );

  // Auto channel config — drives the "Not in channel" section for PCO synced
  // channels. Backend gates by leader role + community-admin, so a non-leader
  // viewer just gets `null` here and the section won't render.
  const autoChannelConfig = useQuery(
    api.functions.pcoServices.queries.getAutoChannelConfigByChannel,
    token && channel?._id && channel.channelType === "pco_services"
      ? { token, channelId: channel._id }
      : "skip",
  );

  // Cross-team channels: list the group's cross-team channels so we can find
  // THIS channel's current selectors to prefill the edit picker. The backend
  // has no per-channel getter, so we filter the group-scoped list.
  const crossTeamChannels = useQuery(
    listCrossTeamChannelsRef,
    token && channel?._id && channel.channelType === "cross_team"
      ? { token, groupId: groupId as Id<"groups"> }
      : "skip",
  ) as CrossTeamChannel[] | undefined;

  const updateCrossTeamChannel = useAuthenticatedMutation(
    updateCrossTeamChannelRef,
  );

  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [hintValue, setHintValue] = useState("");
  const [hintSubmitting, setHintSubmitting] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [archiveVisible, setArchiveVisible] = useState(false);
  const [pendingResponding, setPendingResponding] = useState<
    null | "accept" | "decline"
  >(null);
  const [removeShareVisible, setRemoveShareVisible] = useState(false);
  const [removingShare, setRemovingShare] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pcoSettingsVisible, setPcoSettingsVisible] = useState(false);
  const [crossTeamEditVisible, setCrossTeamEditVisible] = useState(false);
  const [crossTeamDraft, setCrossTeamDraft] = useState<CrossTeamSelector[]>([]);
  const [crossTeamSaving, setCrossTeamSaving] = useState(false);
  const [requestInFlight, setRequestInFlight] = useState<string | null>(null);
  const [unmatchedActionInFlight, setUnmatchedActionInFlight] = useState<
    string | null
  >(null);

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
    return channel?.userGroupRole === "leader";
  }, [channel?.userGroupRole]);
  // Backend `getChannelBySlug` allows leaders to open custom / PCO channels
  // they're not members of (and the Leaders channel for any leader). When
  // the viewer is on this screen *because* they're a leader and not because
  // they're actually in the channel, surface that asymmetry.
  const isMemberOfChannel = channel?.isMember === true;
  const isViewingAsLeaderOnly = isLeader && !isMemberOfChannel;

  const channelType = (channel?.channelType ?? "custom") as ChannelType;
  const isMain = channelType === "main";
  const isCustom = channelType === "custom";
  const isLeadersChannel = channelType === "leaders";
  const isReachOut = channelType === "reach_out";
  const isPco = channelType === "pco_services";
  const isCrossTeam = channelType === "cross_team";

  // This channel's current cross-team config (selectors), if any.
  const thisCrossTeamChannel = useMemo(
    () => crossTeamChannels?.find((c) => c._id === channel?._id),
    [crossTeamChannels, channel?._id],
  );

  const iconCfg = getChannelIconConfig(channelType, primaryColor);
  const channelDisplayName = channel?.name?.trim() || iconCfg.defaultName;

  const sharedGroupCount = useMemo(() => {
    if (!channel?.sharedGroups) return 0;
    return channel.sharedGroups.filter((sg: any) => sg.status === "accepted").length;
  }, [channel?.sharedGroups]);

  // Shared-channel relationship of THIS group (the URL group) to the channel.
  // `pendingShareForGroup` / `primaryGroupName` come from getChannelBySlug.
  const isPendingShareInvite =
    (channel as { pendingShareForGroup?: boolean } | undefined)
      ?.pendingShareForGroup === true;
  const primaryGroupName = (
    channel as { primaryGroupName?: string | null } | undefined
  )?.primaryGroupName;
  // True when this group is a *secondary* participant on a shared channel it
  // owns by acceptance (not the owning group). Leaders here can remove the
  // whole group from the channel — distinct from an individual "leave".
  const isSecondaryShare = useMemo(() => {
    if (!channel?.groupId || channel.groupId === groupId) return false;
    return (channel.sharedGroups ?? []).some(
      (sg: any) => sg.groupId === groupId && sg.status === "accepted",
    );
  }, [channel?.groupId, channel?.sharedGroups, groupId]);

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

  const handleAcceptInvite = useCallback(async () => {
    if (!channel?._id) return;
    setPendingResponding("accept");
    try {
      await respondToInviteMutation({
        channelId: channel._id,
        groupId: groupId as Id<"groups">,
        response: "accepted",
      });
      // Stay on the screen — getChannelBySlug now re-resolves the channel as an
      // accepted shared channel and the normal management UI takes over.
    } catch (e: any) {
      Alert.alert("Couldn't accept", e?.message || "Please try again.");
    } finally {
      setPendingResponding(null);
    }
  }, [channel?._id, respondToInviteMutation, groupId]);

  const handleDeclineInvite = useCallback(() => {
    Alert.alert(
      "Decline invitation",
      "Decline this shared channel invitation?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            if (!channel?._id) return;
            setPendingResponding("decline");
            try {
              await respondToInviteMutation({
                channelId: channel._id,
                groupId: groupId as Id<"groups">,
                response: "declined",
              });
              router.replace(`/groups/${groupId}` as any);
            } catch (e: any) {
              Alert.alert("Couldn't decline", e?.message || "Please try again.");
            } finally {
              setPendingResponding(null);
            }
          },
        },
      ],
    );
  }, [channel?._id, respondToInviteMutation, groupId, router]);

  const handleRemoveShare = useCallback(async () => {
    if (!channel?._id) return;
    setRemovingShare(true);
    try {
      await removeGroupFromChannelMutation({
        channelId: channel._id,
        groupId: groupId as Id<"groups">,
      });
      setRemoveShareVisible(false);
      router.replace(`/groups/${groupId}` as any);
    } catch (e: any) {
      Alert.alert("Couldn't remove", e?.message || "Please try again.");
    } finally {
      setRemovingShare(false);
    }
  }, [channel?._id, removeGroupFromChannelMutation, groupId, router]);

  const handleArchiveChannel = useCallback(async () => {
    if (!channel?._id) return;
    setArchiving(true);
    try {
      await archiveCustomChannelMutation({ channelId: channel._id });
      setArchiveVisible(false);
      router.replace(`/groups/${groupId}` as any);
    } catch (e: any) {
      Alert.alert("Couldn't archive", e?.message || "Please try again.");
    } finally {
      setArchiving(false);
    }
  }, [channel?._id, archiveCustomChannelMutation, groupId, router]);

  const handleOpenCrossTeamEdit = useCallback(() => {
    // Prefill the picker draft from the channel's current selectors. The
    // enriched selectors carry extra display fields — strip them down to the
    // { sourceTeamId, roleId? } shape the picker/mutation expect.
    const current: CrossTeamSelector[] = (
      thisCrossTeamChannel?.selectors ?? []
    ).map((s) => ({
      sourceTeamId: s.sourceTeamId,
      ...(s.roleId ? { roleId: s.roleId } : {}),
    }));
    setCrossTeamDraft(current);
    setCrossTeamEditVisible(true);
  }, [thisCrossTeamChannel?.selectors]);

  const handleSaveCrossTeam = useCallback(async () => {
    if (!channel?._id || crossTeamSaving) return;
    if (crossTeamDraft.length === 0) {
      Alert.alert(
        "Pick at least one role",
        "A cross-team channel needs at least one team + role selector.",
      );
      return;
    }
    setCrossTeamSaving(true);
    try {
      const result = await updateCrossTeamChannel({
        channelId: channel._id,
        selectors: crossTeamDraft,
      });
      setCrossTeamEditVisible(false);
      const { addedCount, removedCount } = result;
      const message =
        addedCount === 0 && removedCount === 0
          ? "Synced roles updated. Membership is unchanged."
          : `Synced roles updated. ${addedCount} added, ${removedCount} removed.`;
      Alert.alert("Saved", message);
    } catch (e: any) {
      Alert.alert("Couldn't save", e?.message || "Please try again.");
    } finally {
      setCrossTeamSaving(false);
    }
  }, [channel?._id, crossTeamSaving, crossTeamDraft, updateCrossTeamChannel]);

  const handleAddUnmatchedToGroup = useCallback(
    async (person: UnsyncedPerson) => {
      if (!groupId) return;
      setUnmatchedActionInFlight(person.pcoPersonId);
      try {
        await addByPcoPersonId({
          groupId: groupId as Id<"groups">,
          pcoPersonId: person.pcoPersonId,
        });
        Alert.alert(
          "Added to group",
          `${person.pcoName} was added. They'll be synced into this channel on the next PCO sync.`,
        );
      } catch (e: any) {
        Alert.alert(
          "Couldn't add to group",
          e?.message ?? "Please try again.",
        );
      } finally {
        setUnmatchedActionInFlight(null);
      }
    },
    [addByPcoPersonId, groupId],
  );

  const handleInviteUnmatchedBySMS = useCallback(
    async (person: UnsyncedPerson) => {
      if (!person.pcoPhone) return;
      const groupName = groupData?.name?.trim() || "our group";
      const shortId = groupData?.shortId;
      const groupUrl = shortId
        ? DOMAIN_CONFIG.groupShareUrl(shortId)
        : DOMAIN_CONFIG.landingUrl;
      // SMS originates from the leader's own number, so address the recipient
      // directly by first name. PCO returns names as "First Last" (composed
      // from first_name + last_name), so the first whitespace-separated
      // token is the first name. Falls back to the full pcoName if empty.
      const firstName =
        person.pcoName?.trim().split(/\s+/)[0] || person.pcoName || "there";
      const body =
        `Hey ${firstName}, join the #${channelDisplayName} channel in ${groupName} on Togather so you can stay in the loop: ${groupUrl}`;

      // sms: separator differs by platform — `?` on Android, `&` on iOS.
      // See https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/SMSLinks/SMSLinks.html
      const separator = Platform.OS === "ios" ? "&" : "?";
      const phone = person.pcoPhone.replace(/\s+/g, "");
      const url = `sms:${phone}${separator}body=${encodeURIComponent(body)}`;

      try {
        const can = await Linking.canOpenURL(url);
        if (!can) {
          Alert.alert(
            "Can't open Messages",
            "This device doesn't support SMS. The link has been copied so you can paste it into another app.",
          );
          await Clipboard.setStringAsync(body);
          return;
        }
        await Linking.openURL(url);
      } catch (e: any) {
        Alert.alert("Couldn't open Messages", e?.message ?? "Please try again.");
      }
    },
    [channelDisplayName, groupData?.name, groupData?.shortId],
  );

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

  const handleSaveHint = useCallback(async () => {
    if (!channel?._id) return;
    setHintSubmitting(true);
    try {
      // Empty value clears the hint (composer falls back to "Message...").
      await updateChannelMutation({
        channelId: channel._id,
        hint: hintValue.trim(),
      });
      setHintVisible(false);
      setHintError(null);
    } catch (e: any) {
      setHintError(e?.message || "Could not save hint");
    } finally {
      setHintSubmitting(false);
    }
  }, [hintValue, channel?._id, updateChannelMutation]);

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

  const memberRows = channelMembers?.members ?? [];
  const totalMemberCount = channelMembers?.totalCount ?? channel.memberCount ?? 0;
  const ownerId = (channel as { createdById?: Id<"users"> }).createdById;
  const unmatchedPeople: UnsyncedPerson[] =
    (autoChannelConfig?.lastSyncResults?.unmatchedPeople as
      | UnsyncedPerson[]
      | undefined) ?? [];

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
        {/* Asymmetric-view banner — only when the viewer is here because
            they're a group leader and isn't actually a member of the
            channel itself (custom / PCO disabled / Leaders for non-leader-channel-members). */}
        {isViewingAsLeaderOnly && !isPendingShareInvite && (
          <AdminViewNote
            variant="banner"
            text="You can see this channel as a group leader. Members not in the channel don't see it."
          />
        )}

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

        {/* Pending shared-channel invitation — this group was invited to the
            channel but hasn't accepted. Show a focused accept/decline prompt
            and hide the normal management surfaces until the leader responds. */}
        {isPendingShareInvite && (
          <View
            style={[
              styles.sectionGroup,
              styles.inviteCard,
              { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <Text style={[styles.inviteHeading, { color: colors.text }]}>
              Shared channel invitation
            </Text>
            <Text style={[styles.inviteBody, { color: colors.textSecondary }]}>
              {primaryGroupName
                ? `${primaryGroupName} invited your group to join this channel.`
                : "Your group has been invited to join this channel."}
            </Text>
            <View style={styles.inviteButtonRow}>
              <TouchableOpacity
                onPress={handleAcceptInvite}
                disabled={pendingResponding !== null}
                style={[
                  styles.inviteAcceptBtn,
                  { backgroundColor: primaryColor },
                  pendingResponding !== null && { opacity: 0.6 },
                ]}
              >
                {pendingResponding === "accept" ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.inviteAcceptText}>Accept</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDeclineInvite}
                disabled={pendingResponding !== null}
                style={[
                  styles.inviteDeclineBtn,
                  { borderColor: colors.destructive },
                  pendingResponding !== null && { opacity: 0.6 },
                ]}
              >
                {pendingResponding === "decline" ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <Text
                    style={[styles.inviteDeclineText, { color: colors.destructive }]}
                  >
                    Decline
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isPendingShareInvite && (
        <>
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
                // Backend `getPendingRequests` returns these fields directly
                // on each enriched row — see channelInvites.ts.
                const requesterName = req.displayName || "Someone";
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
                      imageUrl={req.profilePhoto}
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
                      notificationsDisabled={!!m.notificationsDisabled}
                      notificationsBadgeRingColor={colors.surfaceSecondary}
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

        {/* Not in channel — PCO synced channels only. Lists people scheduled
            in PCO who couldn't be matched into the channel, with the reason
            and quick actions. Mirrors the unmatched panel in PCO sync
            settings (image 5 in the original spec). Only renders when the
            backend returns unmatched data — leader access is enforced server
            side via `getAutoChannelConfigByChannel`. */}
        {isPco && isLeader && unmatchedPeople.length > 0 && (
          <>
            <SectionHeader
              colors={colors}
              label={`Not in channel · ${unmatchedPeople.length}`}
            />
            <View
              style={[
                styles.unmatchedHelperBox,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              ]}
            >
              <Ionicons name="information-circle" size={16} color={colors.textSecondary} />
              <Text style={[styles.unmatchedHelperText, { color: colors.textSecondary }]}>
                PCO matches Togather users by phone number. Make sure each
                person's phone in PCO matches their Togather account.
              </Text>
            </View>
            <View style={[styles.sectionGroup, { backgroundColor: colors.surfaceSecondary }]}>
              {unmatchedPeople.map((person, idx) => {
                const inFlight = unmatchedActionInFlight === person.pcoPersonId;
                const canAddToGroup = person.reason === "not_in_group";
                const canSmsInvite = !!person.pcoPhone;
                return (
                  <View
                    key={person.pcoPersonId}
                    style={[
                      styles.unmatchedRow,
                      idx > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.unmatchedHeaderRow}>
                      <View style={styles.unmatchedAvatarWarn}>
                        <Ionicons name="warning" size={20} color="#B25000" />
                      </View>
                      <View style={styles.unmatchedTextWrap}>
                        <Text
                          style={[styles.memberRowName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {person.pcoName}
                        </Text>
                        {(person.teamName || person.position) && (
                          <Text
                            style={[styles.unmatchedSubLabel, { color: colors.textSecondary }]}
                            numberOfLines={1}
                          >
                            {[person.teamName, person.position]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        )}
                        {person.pcoPhone ? (
                          <Text
                            style={[styles.unmatchedContactLine, { color: colors.textSecondary }]}
                            numberOfLines={1}
                          >
                            {`📱 ${person.pcoPhone}`}
                          </Text>
                        ) : null}
                        {person.pcoEmail ? (
                          <Text
                            style={[styles.unmatchedContactLine, { color: colors.textSecondary }]}
                            numberOfLines={1}
                          >
                            {`✉️ ${person.pcoEmail}`}
                          </Text>
                        ) : null}
                        <Text
                          style={[styles.unmatchedReasonText, { color: "#B25000" }]}
                          numberOfLines={2}
                        >
                          {getDebugReasonText(person.reason, person)}
                        </Text>
                      </View>
                    </View>
                    {(canAddToGroup || canSmsInvite) && (
                      <View style={styles.unmatchedActionsRow}>
                        {canAddToGroup && (
                          <Pressable
                            onPress={() => handleAddUnmatchedToGroup(person)}
                            disabled={inFlight}
                            style={({ pressed }) => [
                              styles.unmatchedActionBtn,
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
                              <>
                                <Ionicons name="person-add" size={14} color="#fff" />
                                <Text style={styles.unmatchedActionLabelLight}>
                                  Add to group
                                </Text>
                              </>
                            )}
                          </Pressable>
                        )}
                        {canSmsInvite && (
                          <Pressable
                            onPress={() => handleInviteUnmatchedBySMS(person)}
                            disabled={inFlight}
                            style={({ pressed }) => [
                              styles.unmatchedActionBtn,
                              {
                                backgroundColor: pressed
                                  ? colors.selectedBackground
                                  : colors.surface,
                                borderWidth: StyleSheet.hairlineWidth,
                                borderColor: colors.border,
                                opacity: inFlight ? 0.6 : 1,
                              },
                            ]}
                          >
                            <Ionicons
                              name="chatbubble-ellipses-outline"
                              size={14}
                              color={colors.text}
                            />
                            <Text
                              style={[
                                styles.unmatchedActionLabel,
                                { color: colors.text },
                              ]}
                            >
                              Invite via SMS
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Add people — for now this routes to the existing manage-members
            sub-route. TODO: fold the in-screen picker (mirror of DM
            ChatInfoScreen.AddPeopleModal) inline once we have a
            channel-scoped search query. General's membership is the group
            itself, so there's nothing to add here. */}
        {isLeader && !isMain && (
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

        {/* CHANNEL ACTIONS — General has no invite link and can't be left
            (its membership is the group itself), so hide the whole section. */}
        {!isMain && (
          <>
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

              {/* Remove shared channel — leader-only opt-out for a group that
                  participates in this channel as a secondary (non-owning)
                  group. Removes the whole group from the share, distinct from
                  an individual leave. The owning group keeps the channel. */}
              {isLeader && isSecondaryShare && (
                <Pressable
                  onPress={() => setRemoveShareVisible(true)}
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
                    name="remove-circle-outline"
                    size={20}
                    color={colors.destructive}
                  />
                  <Text style={[styles.actionLabel, { color: colors.destructive }]}>
                    Remove shared channel
                  </Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        {/* LEADER CONTROLS */}
        {isLeader && (
          <>
            <SectionHeader colors={colors} label="Leader controls" />
            <View
              style={[styles.sectionGroup, { backgroundColor: colors.surfaceSecondary }]}
            >
              {/* Active state — common to main/leaders/reach_out/custom/pco.
                  For General this is the only leader control: it's how a
                  leader disables and (from the disabled row) re-enables it. */}
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

              {/* Edit synced roles — cross-team channels. Reopens the
                  selector picker prefilled from the current config and
                  saves via updateCrossTeamChannel. */}
              {isCrossTeam && (
                <Pressable
                  onPress={handleOpenCrossTeamEdit}
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
                    name="git-merge-outline"
                    size={20}
                    color={colors.icon}
                  />
                  <Text style={[styles.actionLabel, { color: colors.text }]}>
                    Edit synced roles
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                    style={{ marginLeft: "auto" }}
                  />
                </Pressable>
              )}

              {/* No "set up as serving team" here — ADR-024/ADR-025 removed
                  the channel→team conversion path. Teams are created only in
                  the Rostering hub via `createServingTeam`, and a team's
                  roster is managed there, not from its chat channel. */}

              {/* Composer hint — guidance text shown as the message-box
                  placeholder (e.g. "put experience updates here"). Available
                  on any group channel; the backend gates edits to leaders. */}
              <Pressable
                onPress={() => {
                  setHintValue(channel?.hint ?? "");
                  setHintError(null);
                  setHintVisible(true);
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
                <Ionicons name="bulb-outline" size={20} color={colors.icon} />
                <Text style={[styles.actionLabel, { color: colors.text }]}>
                  Composer hint
                </Text>
                {channel?.hint ? (
                  <Text
                    style={[styles.actionRowValue, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {channel.hint}
                  </Text>
                ) : null}
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                  style={{ marginLeft: channel?.hint ? 0 : "auto" }}
                />
              </Pressable>

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
                  onPress={() => setArchiveVisible(true)}
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

      {/* Composer hint modal */}
      <CustomModal
        visible={hintVisible}
        onClose={() => {
          if (!hintSubmitting) {
            setHintVisible(false);
            setHintError(null);
          }
        }}
        title="Composer hint"
      >
        <View>
          <Text style={[styles.helperText, { color: colors.textSecondary, marginBottom: 12 }]}>
            Shown as the message-box placeholder to guide what people post here.
            Leave empty to use the default.
          </Text>
          <TextInput
            value={hintValue}
            onChangeText={setHintValue}
            placeholder="e.g. put experience updates here"
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
          {hintError ? (
            <Text style={[styles.errorText, { color: colors.destructive, marginTop: 8 }]}>
              {hintError}
            </Text>
          ) : null}
          <View style={styles.modalButtonRow}>
            <TouchableOpacity
              onPress={() => {
                setHintVisible(false);
                setHintError(null);
              }}
              disabled={hintSubmitting}
              style={[styles.modalButton, { backgroundColor: colors.surfaceSecondary }]}
            >
              <Text style={[styles.modalButtonText, { color: colors.text }]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSaveHint}
              disabled={hintSubmitting}
              style={[
                styles.modalButton,
                { backgroundColor: primaryColor },
                hintSubmitting && { opacity: 0.6 },
              ]}
            >
              {hintSubmitting ? (
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

      <ConfirmModal
        visible={archiveVisible}
        title="Archive channel"
        message={`Archive #${channelDisplayName}? This removes all members and hides the channel. This action cannot be undone.`}
        onConfirm={handleArchiveChannel}
        onCancel={() => setArchiveVisible(false)}
        confirmText="Archive"
        destructive
        isLoading={archiving}
      />

      <ConfirmModal
        visible={removeShareVisible}
        title="Remove shared channel"
        message={`Remove #${channelDisplayName} from this group? Members who are only here through this group will lose access. The owning group keeps the channel.`}
        onConfirm={handleRemoveShare}
        onCancel={() => setRemoveShareVisible(false)}
        confirmText="Remove"
        destructive
        isLoading={removingShare}
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

      {/* Edit synced roles — cross-team channels. Full-screen modal mounting
          the same selector picker used in channel creation. */}
      <Modal
        visible={crossTeamEditVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!crossTeamSaving) setCrossTeamEditVisible(false);
        }}
      >
        <View
          style={[
            styles.container,
            { paddingTop: insets.top, backgroundColor: colors.surface },
          ]}
        >
          <View
            style={[
              styles.headerBar,
              {
                backgroundColor: colors.surface,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => setCrossTeamEditVisible(false)}
              disabled={crossTeamSaving}
              style={styles.headerBackButton}
              hitSlop={12}
            >
              <Ionicons name="close" size={26} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Edit synced roles
            </Text>
            <TouchableOpacity
              onPress={handleSaveCrossTeam}
              disabled={crossTeamSaving}
              style={styles.headerBackButton}
              hitSlop={12}
            >
              {crossTeamSaving ? (
                <ActivityIndicator size="small" color={primaryColor} />
              ) : (
                <Text
                  style={[styles.crossTeamSaveLabel, { color: primaryColor }]}
                >
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{
              padding: 16,
              paddingBottom: insets.bottom + 24,
            }}
          >
            <CrossTeamSelectorPicker
              groupId={groupId as Id<"groups">}
              selectors={crossTeamDraft}
              onChange={setCrossTeamDraft}
              disabled={crossTeamSaving}
            />
          </ScrollView>
        </View>
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
  crossTeamSaveLabel: {
    fontSize: 16,
    fontWeight: "600",
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
  inviteCard: {
    padding: 16,
    gap: 8,
  },
  inviteHeading: {
    fontSize: 16,
    fontWeight: "700",
  },
  inviteBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  inviteButtonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  inviteAcceptBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteAcceptText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  inviteDeclineBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteDeclineText: {
    fontSize: 15,
    fontWeight: "600",
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
  unmatchedHelperBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  unmatchedHelperText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  unmatchedRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  unmatchedHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  unmatchedAvatarWarn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFE0B2",
    alignItems: "center",
    justifyContent: "center",
  },
  unmatchedTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  unmatchedSubLabel: {
    fontSize: 12,
  },
  unmatchedContactLine: {
    fontSize: 12,
  },
  unmatchedReasonText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "500",
  },
  unmatchedActionsRow: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 52,
  },
  unmatchedActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 32,
  },
  unmatchedActionLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  unmatchedActionLabelLight: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
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
