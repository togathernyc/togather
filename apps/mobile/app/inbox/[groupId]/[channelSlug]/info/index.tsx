/**
 * Channel Info Screen
 *
 * Route: /inbox/[groupId]/[channelSlug]/info
 *
 * The DM-info aesthetic applied to group channels:
 *   - Centered hero (avatar -> name -> "{N} members" -> shared pill)
 *   - "Open chat" CTA card
 *   - MEMBERS card with role badge + "View all" entry to legacy /members
 *   - Add people standalone card (when caller can invite)
 *   - CHANNEL ACTIONS card (Share invite link, Leave channel)
 *   - LEADER CONTROLS card (leaders of primary group only): Join mode,
 *     Active state, Rename, Share with groups, Archive channel
 *
 * Special-case: General channel (channelType === "main") redirects to the
 * group page on mount — General has the same audience as the group itself
 * and doesn't warrant its own info surface.
 *
 * Backend integration:
 *   - Reads channel via api.functions.messaging.channels.getChannelBySlug
 *   - Reads members via api.functions.messaging.channels.getChannelMembers
 *   - Reads invite link / join mode via
 *     api.functions.messaging.channelInvites.getInviteInfo
 *   - Mutations: archiveCustomChannel, leaveChannel, enableInviteLink
 *   - Active-state toggle uses setChannelEnabled (added by backend agent in
 *     parallel; expected at api.functions.messaging.channels.setChannelEnabled).
 *     The picker sub-screen consumes that mutation, not this index.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Share,
  Platform,
  ActionSheetIOS,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@components/ui/Avatar";
import { ConfirmModal } from "@components/ui/ConfirmModal";
import { useAuth } from "@providers/AuthProvider";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useQuery, useMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DOMAIN_CONFIG } from "@togather/shared";
import {
  GroupCard,
  InfoHeader,
  SectionHeader,
  infoStyles,
} from "./_shared";

const MEMBERS_PREVIEW_LIMIT = 8;

export default function ChannelInfoScreen() {
  const { groupId, channelSlug } = useLocalSearchParams<{
    groupId: string;
    channelSlug: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const { colors, isDark } = useTheme();
  const { primaryColor, accentLight } = useCommunityTheme();

  // ---- Channel + members ----------------------------------------------------
  const channelData = useQuery(
    api.functions.messaging.channels.getChannelBySlug,
    token && groupId && channelSlug
      ? {
          token,
          groupId: groupId as Id<"groups">,
          slug: channelSlug,
        }
      : "skip",
  );

  // Redirect General to the group page — it shares the group's audience
  // and doesn't need its own info screen. We also redirect for unknown
  // channels (null) so users don't get stuck on a blank info page.
  React.useEffect(() => {
    if (channelData === undefined) return;
    if (!channelData) {
      router.replace(`/groups/${groupId}` as any);
      return;
    }
    if (channelData.channelType === "main") {
      router.replace(`/groups/${groupId}` as any);
    }
  }, [channelData, groupId, router]);

  const membersData = useQuery(
    api.functions.messaging.channels.getChannelMembers,
    token && channelData?._id
      ? { token, channelId: channelData._id, limit: MEMBERS_PREVIEW_LIMIT }
      : "skip",
  );

  const inviteInfo = useQuery(
    api.functions.messaging.channelInvites.getInviteInfo,
    token && channelData?._id && channelData?.channelType === "custom"
      ? { token, channelId: channelData._id }
      : "skip",
  );

  // ---- Mutations ------------------------------------------------------------
  const archiveCustomChannelMutation = useMutation(
    api.functions.messaging.channels.archiveCustomChannel,
  );
  const archivePcoChannelMutation = useMutation(
    api.functions.messaging.channels.archivePcoChannel,
  );
  const leaveChannelMutation = useMutation(
    api.functions.messaging.channels.leaveChannel,
  );
  const enableInviteLinkMutation = useMutation(
    api.functions.messaging.channelInvites.enableInviteLink,
  );

  // ---- Derived flags --------------------------------------------------------
  const channelType = channelData?.channelType;
  const isPrimaryGroup = channelData ? channelData.groupId === groupId : false;
  const isSharedChannel = !!channelData?.isShared;
  const sharedAcceptedCount = useMemo(() => {
    const groups = (channelData?.sharedGroups ?? []) as Array<{ status: string }>;
    // Primary group + accepted secondaries
    return 1 + groups.filter((sg) => sg.status === "accepted").length;
  }, [channelData?.sharedGroups]);

  const isGroupLeader =
    channelData?.userGroupRole === "leader" ||
    channelData?.userGroupRole === "admin";
  const isPrimaryLeader = isGroupLeader && isPrimaryGroup;
  // Channel-level "owner" role on chatChannelMembers — the creator. Used
  // for the OWNER badge next to that user in the members list.
  const channelOwnerRole = "owner";

  // Anyone in any participating group is a channel-eligible member; the
  // backend already gates this query so reaching the info screen at all
  // means the caller has access.
  const isChannelEligibleMember = !!channelData;
  const joinMode = (inviteInfo?.joinMode as "open" | "approval_required" | undefined) ?? "open";
  // "Add people" + "Share invite link" are visible when:
  //   - joinMode is open AND caller is any eligible member, OR
  //   - caller is a leader/admin of the primary group
  const canInvite =
    isPrimaryLeader ||
    (joinMode === "open" && isChannelEligibleMember && channelType === "custom");

  const showLeaderControls =
    isPrimaryLeader && channelType !== "main" && channelType !== "leaders";
  const isCustomChannel = channelType === "custom";
  const isPcoAutoChannel = channelType === "pco_services";
  const canArchive = showLeaderControls && (isCustomChannel || isPcoAutoChannel);

  // ---- UI state -------------------------------------------------------------
  const [leaveConfirmVisible, setLeaveConfirmVisible] = useState(false);
  const [archiveConfirmVisible, setArchiveConfirmVisible] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);

  // ---- Handlers -------------------------------------------------------------
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/inbox/${groupId}/${channelSlug}` as any);
    }
  }, [router, groupId, channelSlug]);

  const goToChat = useCallback(() => {
    router.push(`/inbox/${groupId}/${channelSlug}` as any);
  }, [router, groupId, channelSlug]);

  const goToMember = useCallback(
    (userId: Id<"users">) => {
      router.push(`/profile/${userId}` as any);
    },
    [router],
  );

  const goToAllMembers = useCallback(() => {
    // Reuse the existing legacy members screen for the full list — phase 2
    // will retire it, but for now it's the source of truth for full
    // pagination, removal, share-with-groups, etc.
    router.push(`/inbox/${groupId}/${channelSlug}/members` as any);
  }, [router, groupId, channelSlug]);

  const goToJoinMode = useCallback(() => {
    router.push(`/inbox/${groupId}/${channelSlug}/info/join-mode` as any);
  }, [router, groupId, channelSlug]);

  const goToActiveState = useCallback(() => {
    router.push(`/inbox/${groupId}/${channelSlug}/info/active-state` as any);
  }, [router, groupId, channelSlug]);

  const goToRename = useCallback(() => {
    router.push(`/inbox/${groupId}/${channelSlug}/info/rename` as any);
  }, [router, groupId, channelSlug]);

  const goToShareWithGroups = useCallback(() => {
    // The share-with-groups modal is hosted by the legacy /members screen —
    // route to it; phase-2 work can pull this into its own sub-screen.
    router.push(`/inbox/${groupId}/${channelSlug}/members` as any);
  }, [router, groupId, channelSlug]);

  const handleShareInviteLink = useCallback(async () => {
    if (!token || !channelData?._id) return;
    try {
      const result = await enableInviteLinkMutation({
        token,
        channelId: channelData._id,
      });
      const url = DOMAIN_CONFIG.channelInviteUrl(result.shortId);
      const message = `Join #${channelData.name}: ${url}`;

      if (Platform.OS === "ios") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: ["Cancel", "Copy Link", "Share Link"],
            cancelButtonIndex: 0,
          },
          async (buttonIndex) => {
            if (buttonIndex === 1) {
              await Clipboard.setStringAsync(url);
              Alert.alert("Copied", "Invite link copied to clipboard.");
            } else if (buttonIndex === 2) {
              Share.share({ url, message });
            }
          },
        );
      } else {
        Share.share({ message });
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to generate invite link.";
      Alert.alert("Error", msg);
    }
  }, [token, channelData, enableInviteLinkMutation]);

  const handleConfirmLeave = useCallback(async () => {
    if (!token || !channelData?._id) return;
    setActionInFlight(true);
    try {
      await leaveChannelMutation({ token, channelId: channelData._id });
      setLeaveConfirmVisible(false);
      router.replace(`/inbox/${groupId}/general` as any);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Couldn't leave channel.";
      Alert.alert("Error", msg);
    } finally {
      setActionInFlight(false);
    }
  }, [token, channelData, leaveChannelMutation, router, groupId]);

  const handleConfirmArchive = useCallback(async () => {
    if (!token || !channelData?._id) return;
    setActionInFlight(true);
    try {
      if (channelData.channelType === "pco_services") {
        await archivePcoChannelMutation({ token, channelId: channelData._id });
      } else {
        await archiveCustomChannelMutation({ token, channelId: channelData._id });
      }
      setArchiveConfirmVisible(false);
      router.replace(`/inbox/${groupId}/general` as any);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Couldn't archive channel.";
      Alert.alert("Error", msg);
    } finally {
      setActionInFlight(false);
    }
  }, [
    token,
    channelData,
    archiveCustomChannelMutation,
    archivePcoChannelMutation,
    router,
    groupId,
  ]);

  // ---- Loading + empty states ----------------------------------------------
  if (channelData === undefined) {
    return (
      <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
        <InfoHeader title="Channel info" onBack={handleBack} colors={colors} />
        <View style={infoStyles.centered}>
          <ActivityIndicator size="small" color={primaryColor} />
        </View>
      </View>
    );
  }

  if (!channelData || channelData.channelType === "main") {
    // Falls through to redirect effect — render an empty shell while it fires.
    return (
      <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
        <InfoHeader title="Channel info" onBack={handleBack} colors={colors} />
      </View>
    );
  }

  const memberCount = membersData?.totalCount ?? channelData.memberCount ?? 0;
  const previewMembers = (membersData?.members ?? []).slice(0, MEMBERS_PREVIEW_LIMIT);
  const hasMoreMembers = memberCount > previewMembers.length;
  const channelInitial = (channelData.name?.trim()?.[0] ?? "#").toUpperCase();

  return (
    <View style={[infoStyles.container, { backgroundColor: colors.surface }]}>
      <InfoHeader title="Channel info" onBack={handleBack} colors={colors} />

      <ScrollView
        style={infoStyles.scroll}
        contentContainerStyle={[
          infoStyles.scrollContent,
          { paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---- Hero -------------------------------------------------------- */}
        <View style={infoStyles.heroSection}>
          <View
            style={[
              infoStyles.heroAvatar,
              { backgroundColor: accentLight },
            ]}
          >
            <Text style={[infoStyles.heroAvatarInitials, { color: primaryColor }]}>
              {channelInitial}
            </Text>
          </View>
          <Text style={[infoStyles.heroName, { color: colors.text }]} numberOfLines={2}>
            #{channelData.name}
          </Text>
          <Text style={[infoStyles.heroSubtitle, { color: colors.textSecondary }]}>
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </Text>
          {isSharedChannel && sharedAcceptedCount > 1 ? (
            <View
              style={[
                infoStyles.heroPill,
                {
                  backgroundColor: isDark ? "rgba(124,58,237,0.15)" : "#F5F0FF",
                },
              ]}
            >
              <Ionicons name="link" size={12} color="#8B5CF6" />
              <Text
                style={[
                  infoStyles.heroPillText,
                  { color: isDark ? "#c4b5fd" : "#5B21B6" },
                ]}
              >
                Shared with {sharedAcceptedCount} groups
              </Text>
            </View>
          ) : null}
        </View>

        {/* ---- Open chat CTA --------------------------------------------- */}
        <Pressable
          onPress={goToChat}
          style={({ pressed }) => [
            infoStyles.ctaCard,
            {
              backgroundColor: pressed
                ? colors.selectedBackground
                : colors.surfaceSecondary,
            },
          ]}
        >
          <View style={[infoStyles.ctaIcon, { backgroundColor: accentLight }]}>
            <Ionicons name="chatbubble" size={18} color={primaryColor} />
          </View>
          <Text style={[infoStyles.ctaLabel, { color: colors.text }]}>Open chat</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
        </Pressable>

        {/* ---- Members --------------------------------------------------- */}
        <SectionHeader colors={colors} label="Members" />
        <GroupCard colors={colors}>
          {previewMembers.map((m) => {
            const isOwner = m.role === channelOwnerRole;
            const isSelf = m.userId === user?.id;
            return (
              <Pressable
                key={m.userId}
                onPress={() => goToMember(m.userId as Id<"users">)}
                style={({ pressed }) => [
                  infoStyles.memberRow,
                  pressed && { backgroundColor: colors.selectedBackground },
                ]}
              >
                <Avatar
                  name={m.displayName}
                  imageUrl={m.profilePhoto ?? null}
                  size={40}
                />
                <View style={infoStyles.memberRowText}>
                  <Text
                    style={[infoStyles.memberRowName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {m.displayName}
                    {isSelf ? (
                      <Text style={{ color: colors.textSecondary }}> (you)</Text>
                    ) : null}
                  </Text>
                </View>
                {isOwner ? (
                  <View
                    style={[
                      infoStyles.roleBadge,
                      { backgroundColor: accentLight },
                    ]}
                  >
                    <Text style={[infoStyles.roleBadgeText, { color: primaryColor }]}>
                      OWNER
                    </Text>
                  </View>
                ) : null}
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                />
              </Pressable>
            );
          })}

          {hasMoreMembers ? (
            <Pressable
              onPress={goToAllMembers}
              style={({ pressed }) => [
                infoStyles.actionRow,
                pressed && { backgroundColor: colors.selectedBackground },
              ]}
            >
              <Text
                style={[
                  infoStyles.actionRowLabel,
                  { color: primaryColor, fontWeight: "600" },
                ]}
              >
                View all {memberCount} members
              </Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </Pressable>
          ) : null}
        </GroupCard>

        {/* ---- Add people standalone CTA --------------------------------- */}
        {canInvite ? (
          <Pressable
            onPress={goToAllMembers /* members.tsx hosts the picker */}
            style={({ pressed }) => [
              infoStyles.ctaCard,
              {
                backgroundColor: pressed
                  ? colors.selectedBackground
                  : colors.surfaceSecondary,
              },
            ]}
          >
            <View style={[infoStyles.ctaIcon, { backgroundColor: accentLight }]}>
              <Ionicons name="person-add" size={18} color={primaryColor} />
            </View>
            <Text style={[infoStyles.ctaLabel, { color: colors.text }]}>Add people</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
          </Pressable>
        ) : null}

        {/* ---- Channel actions ------------------------------------------- */}
        <SectionHeader colors={colors} label="Channel actions" />
        <GroupCard colors={colors}>
          {canInvite && isCustomChannel ? (
            <Pressable
              onPress={handleShareInviteLink}
              style={({ pressed }) => [
                infoStyles.actionRow,
                pressed && { backgroundColor: colors.selectedBackground },
              ]}
            >
              <Ionicons name="link-outline" size={20} color={colors.icon} />
              <Text style={[infoStyles.actionRowLabel, { color: colors.text }]}>
                Share invite link
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </Pressable>
          ) : null}
          {/* TODO: Mute action — backend has `isMuted` on chatChannelMembers but
              no setter mutation exists. Omit until that lands so we don't
              ship a dead row. */}
          <Pressable
            onPress={() => setLeaveConfirmVisible(true)}
            style={({ pressed }) => [
              infoStyles.actionRow,
              pressed && { backgroundColor: colors.selectedBackground },
            ]}
          >
            <Ionicons name="exit-outline" size={20} color={colors.destructive} />
            <Text
              style={[infoStyles.actionRowLabel, { color: colors.destructive }]}
            >
              Leave channel
            </Text>
          </Pressable>
        </GroupCard>

        {/* ---- Leader controls ------------------------------------------- */}
        {showLeaderControls ? (
          <>
            <SectionHeader colors={colors} label="Leader controls" />
            <GroupCard colors={colors}>
              {isCustomChannel ? (
                <Pressable
                  onPress={goToJoinMode}
                  style={({ pressed }) => [
                    infoStyles.actionRow,
                    pressed && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Ionicons name="key-outline" size={20} color={colors.icon} />
                  <Text style={[infoStyles.actionRowLabel, { color: colors.text }]}>
                    Join mode
                  </Text>
                  <Text
                    style={[
                      infoStyles.actionRowValue,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {joinMode === "open" ? "Open" : "Approval required"}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                  />
                </Pressable>
              ) : null}
              {/* Active state row — also surfaces for reach_out / leaders if
                  ever shown here. Today only custom + pco show leader
                  controls (showLeaderControls already excludes main/leaders),
                  but the picker handles all types defensively. */}
              <Pressable
                onPress={goToActiveState}
                style={({ pressed }) => [
                  infoStyles.actionRow,
                  pressed && { backgroundColor: colors.selectedBackground },
                ]}
              >
                <Ionicons name="radio-outline" size={20} color={colors.icon} />
                <Text style={[infoStyles.actionRowLabel, { color: colors.text }]}>
                  Active state
                </Text>
                <Text
                  style={[
                    infoStyles.actionRowValue,
                    { color: colors.textSecondary },
                  ]}
                >
                  {(() => {
                    // Mirrors `channelIsLeaderEnabled` in convex/lib/helpers.ts —
                    // unified `enabled` takes precedence; legacy `isEnabled` is
                    // the fallback for unmigrated docs.
                    const ch = channelData as { enabled?: boolean; isEnabled?: boolean };
                    const active =
                      ch.enabled !== undefined ? ch.enabled !== false : ch.isEnabled !== false;
                    return active ? "Active" : "Disabled";
                  })()}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                />
              </Pressable>
              <Pressable
                onPress={goToRename}
                style={({ pressed }) => [
                  infoStyles.actionRow,
                  pressed && { backgroundColor: colors.selectedBackground },
                ]}
              >
                <Ionicons name="create-outline" size={20} color={colors.icon} />
                <Text style={[infoStyles.actionRowLabel, { color: colors.text }]}>
                  Rename
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textTertiary}
                />
              </Pressable>
              {isCustomChannel || isPcoAutoChannel ? (
                <Pressable
                  onPress={goToShareWithGroups}
                  style={({ pressed }) => [
                    infoStyles.actionRow,
                    pressed && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Ionicons name="people-outline" size={20} color={colors.icon} />
                  <Text style={[infoStyles.actionRowLabel, { color: colors.text }]}>
                    Share with groups
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                  />
                </Pressable>
              ) : null}
              {canArchive ? (
                <Pressable
                  onPress={() => setArchiveConfirmVisible(true)}
                  style={({ pressed }) => [
                    infoStyles.actionRow,
                    pressed && { backgroundColor: colors.selectedBackground },
                  ]}
                >
                  <Ionicons
                    name="archive-outline"
                    size={20}
                    color={colors.destructive}
                  />
                  <Text
                    style={[
                      infoStyles.actionRowLabel,
                      { color: colors.destructive },
                    ]}
                  >
                    Archive channel
                  </Text>
                </Pressable>
              ) : null}
            </GroupCard>
          </>
        ) : null}

        <View style={{ height: 24 }} />
      </ScrollView>

      <ConfirmModal
        visible={leaveConfirmVisible}
        title="Leave channel"
        message={`Leave #${channelData.name}? You won't see new messages and the channel will be removed from your inbox.`}
        onConfirm={handleConfirmLeave}
        onCancel={() => setLeaveConfirmVisible(false)}
        confirmText="Leave"
        destructive
        isLoading={actionInFlight}
      />

      <ConfirmModal
        visible={archiveConfirmVisible}
        title="Archive channel"
        message={`Archive "${channelData.name}"? This removes all members and hides the channel. This action cannot be undone.`}
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveConfirmVisible(false)}
        confirmText="Archive"
        destructive
        isLoading={actionInFlight}
      />
    </View>
  );
}

// Suppress unused-style warning if any local style is added later.
const _unused = StyleSheet.create({});
void _unused;
