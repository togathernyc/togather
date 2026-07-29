/**
 * GroupInfoScreen — W13 "Group info page"
 *
 * docs/plans/church-migration-ui-redesign/README.md ("W13 — Group info page")
 * + FEATURE-MAP.md §3-4 (field-by-field mapping and gates).
 *
 * The WhatsApp-shell consolidation of today's group settings, which are
 * split across `EditGroupScreen`, `GroupDetailScreen`'s GROUP ACTIONS card,
 * and the `leader-tools/**` subtree. This screen is pure composition: every
 * data fetch, mutation, and section below is an existing hook/component
 * reused as-is (see the imports) — no new backend surface.
 *
 * Rendered only behind the `whatsapp-shell` flag (see
 * `app/groups/[group_id]/index.tsx`); `GroupDetailScreen` is untouched and
 * keeps rendering when the flag is off. Because this screen only ever
 * mounts flag-on, it's styled unconditionally to
 * `docs/plans/church-migration-ui-redesign/WHATSAPP-DESIGN-SYSTEM.md` §3b
 * (inset-grouped) / §8 ("Group info" checklist) using the `components/wa/*`
 * kit — `bg.grouped` canvas, `WaInsetGroup`/`WaCell` for every card, plain
 * monochrome cell icons, red destructive cells with no icon/chevron.
 *
 * Deferred from the full W13 spec (out of scope for this composition pass):
 *   - Hero photo tap-to-viewer, cadence, description, and the edit pencil
 *     all come for free from the existing `GroupHeader` component (already
 *     a centered circular-avatar hero — out of this pass's touched-file
 *     list, so left as-is).
 *   - "Search" in the icon action row (README's icon list) — the task's
 *     explicit v1 scope is Share + Invite only.
 *   - Events section (README lists it between Channels and Leader tools) —
 *     not in this task's explicit numbered scope; left for a follow-up pass.
 *   - Pinned-channel reorder mode and per-channel mute — `ChannelsSection`
 *     is rendered unmodified (explicitly out of scope for this restyle
 *     pass), so it ships whatever that component already supports/looks
 *     like today — including its own `colors.background`/bordered-card
 *     styling, which now sits on this screen's `bg.grouped` canvas as a
 *     known, deferred visual seam (see file-level restyle note below).
 *   - `isOnBreak` / `isPublic` settings rows — FEATURE-MAP §3 flags these as
 *     "schema-only, no UI today" backlog items, not part of this page yet.
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Modal,
  Linking,
  Platform,
  Share,
  ActionSheetIOS,
  Switch,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DOMAIN_CONFIG } from "@togather/shared";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import { useUserData } from "@features/profile/hooks/useUserData";
import {
  useGroupDetails,
  useLeaveGroup,
  useJoinGroup,
  useArchiveGroup,
} from "../hooks";
import { useWithdrawJoinRequest } from "../hooks/useWithdrawJoinRequest";
import { useMyPendingJoinRequests } from "../hooks/useMyPendingJoinRequests";
import { PendingRequestLimitModal } from "./PendingRequestLimitModal";
import { GroupDetailSkeleton } from "./GroupDetailSkeleton";
import { GroupHeader } from "./GroupHeader";
import { MembersRow } from "./MembersRow";
import { GroupNonMemberView } from "./GroupNonMemberView";
import { ChannelsSection } from "./ChannelsSection";
import { GroupBotsSection } from "./GroupBotsSection";
import { isGroupMember, formatCadence } from "../utils";
import { formatError } from "@/utils/error-handling";
import {
  getExternalChatInfo,
  openExternalChatLink,
} from "@features/chat/utils/externalChat";
import {
  WaInsetGroup,
  WaCell,
  WA_GROUP_SPACING,
  WA_GROUP_MARGIN,
} from "@components/wa";

export function GroupInfoScreen() {
  // Router param name/shape matches the route file
  // (`app/groups/[group_id]/index.tsx`) exactly, same as GroupDetailScreen.
  const params = useLocalSearchParams<{ group_id: string }>();
  const group_id = params.group_id;
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  const [showJoinSuccessModal, setShowJoinSuccessModal] = useState(false);
  const [showPendingLimitModal, setShowPendingLimitModal] = useState(false);

  const {
    isAtLimit: isAtPendingLimit,
    isLoading: isPendingLimitLoading,
  } = useMyPendingJoinRequests();

  const {
    data: group,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useGroupDetails(group_id);
  const { data: userData } = useUserData(!!user);

  const groupIdentifier = group?._id || group_id;

  const leaveGroupMutation = useLeaveGroup();
  const joinGroupMutation = useJoinGroup(groupIdentifier);
  const withdrawMutation = useWithdrawJoinRequest(groupIdentifier);
  const archiveGroupMutation = useArchiveGroup(groupIdentifier);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // ---------------------------------------------------------------------
  // Membership + role derivations — copied verbatim from GroupDetailScreen
  // so the two screens agree on who sees what.
  // ---------------------------------------------------------------------
  const isMember = useMemo(() => {
    if (!group || !user?.id) {
      return false;
    }
    if (group.user_request_status === "accepted") {
      return true;
    }
    if (group.user_role && group.user_role !== null) {
      return true;
    }
    const memberCheck = isGroupMember(group, user.id);
    if (memberCheck) {
      return true;
    }
    if (
      userData?.group_memberships &&
      Array.isArray(userData.group_memberships)
    ) {
      const hasMembership = userData.group_memberships.some(
        (membership: any) => membership.group?._id === group._id,
      );
      if (hasMembership) {
        return true;
      }
    }
    return false;
  }, [group, user?.id, userData?.group_memberships]);

  const isAdmin = user?.is_admin === true;
  const isLeader = group?.user_role === "leader";
  const canEditGroup = useMemo(() => {
    if (!group || !user?.id) return false;
    if (user.is_admin === true) return true;
    return (
      group.leaders?.some((leader) => String(leader.id) === String(user.id)) ||
      false
    );
  }, [group, user?.id, user?.is_admin]);
  const canArchiveGroup = isAdmin && !group?.is_announcement_group;

  // Requests badge (item 4): only meaningful in leader-approval mode.
  const pendingRequestCount = useAuthenticatedQuery(
    api.functions.groupMembers.countGroupJoinRequests,
    group?._id ? { groupId: group._id as Id<"groups"> } : "skip",
  ) as number | undefined;
  const hasPendingRequests = (pendingRequestCount ?? 0) > 0;
  const showRequestsBadge =
    (group as any)?.join_approval_mode === "leaders" && hasPendingRequests;

  // ---------------------------------------------------------------------
  // Mute toggle (item 3) — the exact per-group notification mutation/query
  // NotificationPreferencesSection uses, promoted to the group page per
  // FEATURE-MAP §2/§3.
  // ---------------------------------------------------------------------
  const groupNotifPref = useAuthenticatedQuery(
    api.functions.notifications.preferences.getGroupNotifications,
    group?._id ? { groupId: group._id as Id<"groups"> } : "skip",
  );
  const setGroupNotifications = useAuthenticatedMutation(
    api.functions.notifications.preferences.setGroupNotifications,
  );
  const [isSavingMute, setIsSavingMute] = useState(false);
  const isMuted = !(groupNotifPref?.notificationsEnabled ?? true);

  const handleToggleMuted = async (nextMuted: boolean) => {
    if (!group?._id) return;
    setIsSavingMute(true);
    try {
      await setGroupNotifications({
        groupId: group._id as Id<"groups">,
        enabled: !nextMuted,
      });
    } catch (e) {
      Alert.alert("Error", formatError(e, "Failed to update notification setting"));
    } finally {
      setIsSavingMute(false);
    }
  };

  // ---------------------------------------------------------------------
  // Admin-only settings (item 9) — the exact mutations EditGroupScreen uses.
  // ---------------------------------------------------------------------
  const setHiddenFromDiscovery = useAuthenticatedMutation(
    api.functions.groups.index.setHiddenFromDiscovery,
  );
  const setJoinApprovalMode = useAuthenticatedMutation(
    api.functions.groups.index.setJoinApprovalMode,
  );
  const [hiddenFromDiscovery, setHiddenFromDiscoveryState] = useState(false);
  const [isSavingHidden, setIsSavingHidden] = useState(false);
  const [leadersApprove, setLeadersApprove] = useState(false);
  const [isSavingApproval, setIsSavingApproval] = useState(false);

  useEffect(() => {
    if (group) {
      setHiddenFromDiscoveryState(Boolean((group as any).hidden_from_discovery));
      setLeadersApprove((group as any).join_approval_mode === "leaders");
    }
  }, [group]);

  const handleToggleHiddenFromDiscovery = async (next: boolean) => {
    if (!group?._id) return;
    const previous = hiddenFromDiscovery;
    setHiddenFromDiscoveryState(next); // optimistic
    setIsSavingHidden(true);
    try {
      await setHiddenFromDiscovery({ groupId: group._id as Id<"groups">, hidden: next });
    } catch (error) {
      setHiddenFromDiscoveryState(previous); // revert
      Alert.alert(
        "Couldn't update visibility",
        formatError(error, "Failed to update discovery visibility"),
      );
    } finally {
      setIsSavingHidden(false);
    }
  };

  const handleToggleLeadersApprove = async (next: boolean) => {
    if (!group?._id) return;
    const previous = leadersApprove;
    setLeadersApprove(next); // optimistic
    setIsSavingApproval(true);
    try {
      await setJoinApprovalMode({
        groupId: group._id as Id<"groups">,
        mode: next ? "leaders" : "admins",
      });
    } catch (error) {
      setLeadersApprove(previous); // revert
      Alert.alert(
        "Couldn't update approvals",
        formatError(error, "Failed to update who approves requests"),
      );
    } finally {
      setIsSavingApproval(false);
    }
  };

  // ---------------------------------------------------------------------
  // Handlers reused verbatim from GroupDetailScreen.
  // ---------------------------------------------------------------------
  const handleMembersPress = () => {
    if (!group?._id) return;
    if (isLeader || isAdmin) {
      router.push(`/leader-tools/${group._id}/members`);
      return;
    }
    router.push(`/inbox/${group._id}/general/members` as any);
  };

  const handleLeaveGroup = () => {
    Alert.alert(
      "Leave Group",
      `Are you sure you want to leave ${
        group?.title || group?.name || "this group"
      }? You will need to re-join if you want to participate again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave Group",
          style: "destructive",
          onPress: () => {
            if (user?.id) {
              leaveGroupMutation.mutate({
                groupId: groupIdentifier,
                userId: String(user.id),
              });
            }
          },
        },
      ],
    );
  };

  const handleJoinGroup = async () => {
    if (!user?.id) {
      Alert.alert("Error", "Please log in to join a group.");
      return;
    }
    if (!group?._id && !group?.id) {
      Alert.alert("Error", "Group information is missing. Please try again.");
      return;
    }
    if (isPendingLimitLoading) return;
    if (isAtPendingLimit) {
      setShowPendingLimitModal(true);
      return;
    }
    try {
      await joinGroupMutation.mutateAsync();
      setShowJoinSuccessModal(true);
    } catch (error) {
      console.error("Join group error:", error);
    }
  };

  const handleWithdrawRequest = () => {
    Alert.alert(
      "Withdraw Request",
      "Are you sure you want to withdraw your join request?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Withdraw", style: "destructive", onPress: () => withdrawMutation.mutate() },
      ],
    );
  };

  const handleArchiveGroup = () => {
    Alert.alert(
      "Archive Group",
      `Are you sure you want to archive "${
        group?.title || group?.name || "this group"
      }"? This will hide the group from all members. This action can be undone by a community admin.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            await archiveGroupMutation.mutate();
          },
        },
      ],
    );
  };

  const handleShareGroup = async () => {
    if (!group?.shortId) {
      Alert.alert("Cannot Share", "This group doesn't have a shareable link yet.");
      return;
    }
    const groupUrl = DOMAIN_CONFIG.groupShareUrl(group.shortId);
    const groupName = group.name || group.title || "Group";

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ["Cancel", "Copy Link", "Share"], cancelButtonIndex: 0 },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await Clipboard.setStringAsync(groupUrl);
            Alert.alert("Link Copied", "Group link has been copied to clipboard.");
          } else if (buttonIndex === 2) {
            await Share.share({ message: `${groupName}\n${groupUrl}`, url: groupUrl });
          }
        },
      );
    } else {
      await Share.share({ message: `${groupName}\n${groupUrl}` });
    }
  };

  if (isLoading) {
    return <GroupDetailSkeleton />;
  }

  if (error || !group) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>Group not found</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.link }]}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/groups");
            }
          }}
        >
          <Text style={[styles.buttonText, { color: colors.textInverse }]}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Non-members land on the existing, unmodified non-member page (share
  // preview, join/request CTA, admin read-only peeking) — W13 is the info
  // page for members; this keeps the route working for everyone else who
  // can reach it (e.g. from a share link or Explore).
  if (!isMember) {
    return (
      <>
        <GroupNonMemberView
          group={group}
          onJoinPress={handleJoinGroup}
          onWithdrawPress={handleWithdrawRequest}
          isJoining={joinGroupMutation.isPending || isPendingLimitLoading}
          isWithdrawing={withdrawMutation.isPending}
        />
        <PendingRequestLimitModal
          visible={showPendingLimitModal}
          onDismiss={() => setShowPendingLimitModal(false)}
          onViewRequests={() => {
            setShowPendingLimitModal(false);
            router.push("/(tabs)/profile");
          }}
        />
        <Modal
          visible={showJoinSuccessModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setShowJoinSuccessModal(false);
            if (router.canGoBack()) router.back();
          }}
        >
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.modalContent, { backgroundColor: colors.modalBackground }]}>
              <View style={styles.modalHeader}>
                <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                <Text style={[styles.modalTitle, { color: colors.text }]}>Request Submitted!</Text>
              </View>
              <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
                Your request to join this group has been sent to the group leaders for approval.
              </Text>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: colors.link }]}
                onPress={() => {
                  setShowJoinSuccessModal(false);
                  if (router.canGoBack()) router.back();
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.modalButtonText, { color: colors.textInverse }]}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  const cadence = formatCadence(group);
  const address =
    group.full_address ||
    (group.address_line1 || group.city || group.state || group.zip_code
      ? [
          group.address_line1,
          group.address_line2,
          [group.city, group.state].filter(Boolean).join(", "),
          group.zip_code,
        ]
          .filter(Boolean)
          .join(", ")
      : null) ||
    group.location ||
    null;

  const handleAddressPress = async () => {
    if (!address) return;
    const encoded = encodeURIComponent(address);
    const url =
      Platform.OS === "ios"
        ? `maps://maps.apple.com/?q=${encoded}`
        : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encoded}`);
      }
    } catch (err) {
      console.error("Error opening maps:", err);
    }
  };

  const meetingTypeLabel =
    group.default_meeting_type === 2
      ? "Online"
      : group.default_meeting_type === 1
        ? "In-person"
        : null;
  const meetingLink = group.default_meeting_link || null;
  const externalChatLink = (group as any).externalChatLink as string | undefined;
  const externalChatInfo = externalChatLink ? getExternalChatInfo(externalChatLink) : null;

  const showDetailsCard = !!cadence || !!address || !!meetingTypeLabel || !!externalChatLink;
  const heroMetaParts = [
    group.members_count
      ? `${group.members_count} member${group.members_count === 1 ? "" : "s"}`
      : null,
    group.group_type_name || null,
  ].filter(Boolean) as string[];

  return (
    <>
      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.backgroundGrouped }]}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={colors.link} />
        }
      >
        {/* 1. HERO — centered photo/name come from the unmodified
            GroupHeader (already a §6-style centered circular hero — out of
            this pass's touched-file list). We only add the §2 "member
            count, hero subtitle" meta line it doesn't already render. */}
        <GroupHeader group={group} canEdit={canEditGroup} />
        {heroMetaParts.length > 0 && (
          <Text style={[styles.heroMeta, { color: colors.textSecondary }]}>
            {heroMetaParts.join(" · ")}
          </Text>
        )}

        {/* 2. ICON ACTION ROW (§3.2/§8) — Share + Invite. Accent-tinted
            glyphs on a card-colored pill, no card container around the
            row itself. Invite reuses the same share flow for v1 (no
            separate invite-kit yet — see file-header deferral note). */}
        {!!group.shortId && (
          <View style={styles.iconActionRow}>
            <IconAction icon="share-outline" label="Share" onPress={handleShareGroup} accent={primaryColor} />
            <IconAction icon="person-add-outline" label="Invite" onPress={handleShareGroup} accent={primaryColor} />
          </View>
        )}

        {/* 3. MUTE GROUP — WaCell toggle (§3.2/§6: native Switch, accent-on
            track). Reuses the exact per-group notification query/mutation
            NotificationPreferencesSection uses. */}
        <View style={styles.waSection}>
          <WaInsetGroup>
            <WaCell
              icon="notifications-off-outline"
              title="Mute group"
              variant="toggle"
              toggleValue={isMuted}
              onToggleChange={handleToggleMuted}
              disabled={isSavingMute}
              accent={primaryColor}
            />
          </WaInsetGroup>
        </View>

        {/* 4. MEMBERS — WaInsetGroup: the MembersRow avatar-stack preview
            plus a "View all members" WaCell (§3.2 navigational row). Same
            tap gates GroupDetailScreen applies (announcement-group +
            non-member guard). */}
        {((group.members && group.members.length > 0) ||
          (group.leaders && group.leaders.length > 0) ||
          (group.members_count && group.members_count > 0) ||
          // Never let pending requests vanish just because membership
          // signals are empty — GroupDetailScreen shows its Requests tile
          // independently of the members card.
          showRequestsBadge) && (
          <View style={styles.waSection}>
            <WaInsetGroup
              header={`Members${group.members_count ? ` · ${group.members_count}` : ""}`}
              separatorInset={0}
            >
              {(() => {
                const isAnnouncementRoster =
                  !!group.is_announcement_group && !(isLeader || isAdmin);
                const hasGroupMembership = !!group.user_role;
                const tapEnabled = !isAnnouncementRoster && hasGroupMembership;
                const rows: React.ReactNode[] = [
                  <View key="members-preview">
                    <MembersRow
                      members={group.members}
                      leaders={group.leaders}
                      totalCount={group.members_count ?? undefined}
                    />
                  </View>,
                ];
                if (tapEnabled) {
                  rows.push(
                    <WaCell
                      key="view-all-members"
                      variant="navigational"
                      title="View all members"
                      onPress={handleMembersPress}
                    />,
                  );
                }
                return rows;
              })()}
            </WaInsetGroup>
            {showRequestsBadge && (
              <TouchableOpacity
                onPress={() => router.push(`/groups/${group._id}/requests` as any)}
                activeOpacity={0.7}
                style={[styles.requestsBadgeRow, { backgroundColor: colors.warning + "1A" }]}
              >
                <Ionicons name="person-add-outline" size={16} color={colors.warning} />
                <Text style={[styles.requestsBadgeText, { color: colors.warning }]}>
                  {pendingRequestCount} {pendingRequestCount === 1 ? "request" : "requests"} to join
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.warning} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 5. CHANNELS — rendered exactly as-is; not modified (out of
            scope for this restyle pass — see file-header deferral note). */}
        {group._id && <ChannelsSection groupId={group._id} userRole={group.user_role} />}

        {/* 6. LEADER TOOLS — leader/admin only, WaInsetGroup of navigational
            WaCells (plain monochrome glyphs per §3.2), reusing today's
            routes. */}
        {(isLeader || isAdmin) && group._id && (
          <View style={styles.waSection}>
            <WaInsetGroup header="Leader tools">
              <WaCell
                icon="pulse-outline"
                title="People"
                onPress={() => router.push(`/(user)/leader-tools/${group._id}/followup` as any)}
              />
              <WaCell
                icon="checkmark-done-outline"
                title="Attendance"
                onPress={() => router.push(`/(user)/leader-tools/${group._id}/attendance` as any)}
              />
              <WaCell
                icon="list-outline"
                title="Tasks"
                onPress={() => router.push(`/(user)/leader-tools/${group._id}/tasks` as any)}
              />
              <WaCell
                icon="calendar-outline"
                title="Rostering"
                onPress={() => router.push(`/rostering/${group._id}` as any)}
              />
              <WaCell
                icon="document-text-outline"
                title="Run sheet"
                onPress={() => router.push(`/(user)/leader-tools/${group._id}/run-sheet` as any)}
              />
              <WaCell
                icon="folder-outline"
                title="Resources"
                onPress={() => router.push(`/(user)/leader-tools/${group._id}/resources` as any)}
              />
              <WaCell
                icon="options-outline"
                title="Toolbar settings"
                onPress={() => router.push(`/(user)/leader-tools/${group._id}/toolbar-settings` as any)}
              />
            </WaInsetGroup>
          </View>
        )}

        {/* 7. BOTS — rendered exactly as-is (leader-gated internally, out
            of scope for this restyle pass). */}
        {group._id && <GroupBotsSection groupId={group._id} isLeader={isLeader} />}

        {/* 8. DETAILS — WaInsetGroup of WaCells: meeting day/time, meeting
            type/link, address, external chat link. Cadence has no onPress
            (pure text), so its WaCell renders inert (still shows a chevron
            — a known WaCell-anatomy limitation for "Navigational" rows;
            see restyle report). `WaCell.title` is single-line, so a long
            address now truncates instead of wrapping to 2 lines — also
            noted in the restyle report. */}
        {showDetailsCard && (
          <View style={styles.waSection}>
            <WaInsetGroup header="Details">
              {!!cadence && <WaCell icon="calendar-outline" title={cadence} />}
              {!!meetingTypeLabel && (
                <WaCell
                  icon={meetingTypeLabel === "Online" ? "videocam-outline" : "body-outline"}
                  title={meetingTypeLabel}
                  description={meetingLink ?? undefined}
                  onPress={meetingLink ? () => Linking.openURL(meetingLink) : undefined}
                />
              )}
              {!!address && (
                <WaCell
                  icon="location-outline"
                  title={address}
                  onPress={handleAddressPress}
                />
              )}
              {!!externalChatLink && externalChatInfo && (
                <WaCell
                  icon={externalChatInfo.iconName as any}
                  iconColor={externalChatInfo.color}
                  title={`Also chats on ${externalChatInfo.name}`}
                  onPress={() => openExternalChatLink(externalChatLink)}
                />
              )}
            </WaInsetGroup>
          </View>
        )}

        {/* 9. SETTINGS — community-admin-only rows with an ADMIN tag,
            reusing EditGroupScreen's exact mutations. WaCell has no slot
            for an inline badge next to the title, so these two rows stay a
            bespoke toggle row (built to the same WA_CELL_* metrics as
            WaCell) inside a WaInsetGroup card — see restyle report. */}
        {isAdmin && (
          <View style={styles.waSection}>
            <WaInsetGroup header="Settings" separatorInset={0}>
              <SettingsToggleRow
                label="Hidden from discovery"
                description="Won't appear on the map, near-me page, or group browse."
                value={hiddenFromDiscovery}
                onValueChange={handleToggleHiddenFromDiscovery}
                disabled={isSavingHidden}
                accent={primaryColor}
              />
              <SettingsToggleRow
                label="Join approval: leaders"
                description="When off, community admins approve join requests instead."
                value={leadersApprove}
                onValueChange={handleToggleLeadersApprove}
                disabled={isSavingApproval}
                accent={primaryColor}
              />
            </WaInsetGroup>
          </View>
        )}

        {/* 10. BOTTOM RED ROWS (§1.4/§3.3/§8) — Leave (hidden for
            announcement groups) as a plain WaCell destructive row (no
            icon, no chevron); Archive (admin only) stays a bespoke
            destructive row so it can carry the trailing ADMIN tag WaCell
            has no slot for. */}
        <View style={styles.waSection}>
          <WaInsetGroup separatorInset={0}>
            {!group.is_announcement_group && (
              <WaCell variant="destructive" title="Leave Group" onPress={handleLeaveGroup} />
            )}
            {canArchiveGroup && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleArchiveGroup}
                style={styles.dangerRow}
              >
                <Text style={[styles.dangerLabel, { color: colors.destructive }]}>Archive Group</Text>
                <View style={{ flex: 1 }} />
                <AdminTag />
              </TouchableOpacity>
            )}
          </WaInsetGroup>
        </View>
      </ScrollView>
    </>
  );
}

/**
 * IconAction — the §3.2 "quick-action row" button (Add Members/Add Groups/
 * Search on the reference Community-info screenshot): a card-colored pill,
 * accent-tinted glyph, 13pt label. Accent-colored per §8's Group-info
 * checklist ("icon action row … accent icons") — distinct from the
 * monochrome rule that governs cell icons *inside* an inset-grouped card.
 */
function IconAction({
  icon,
  label,
  onPress,
  accent,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  accent: string;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.iconAction, { backgroundColor: colors.surfaceGrouped }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={22} color={accent} />
      <Text style={[styles.iconActionLabel, { color: colors.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Small monospace-ish "ADMIN" tag flagging community-admin-only rows. */
function AdminTag() {
  const { colors } = useTheme();
  return (
    <View style={[styles.adminTag, { backgroundColor: colors.textTertiary + "26", borderColor: colors.separator }]}>
      <Text style={[styles.adminTagText, { color: colors.textSecondary }]}>ADMIN</Text>
    </View>
  );
}

/**
 * SettingsToggleRow — an ADMIN-tagged toggle row for the SETTINGS group
 * (§9). `WaCell`'s `title` is a plain string with no slot for an inline
 * badge next to it, so this is a bespoke row built to the same
 * `WA_CELL_*` metrics as `WaCell` (padding, min height, type scale) rather
 * than a literal `<WaCell>` — see the restyle report for why.
 */
function SettingsToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
  accent,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accent: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.settingsRow}>
      <View style={styles.settingsRowTextWrap}>
        <View style={styles.settingsRowTitleLine}>
          <Text style={[styles.settingsRowLabel, { color: colors.text }]}>{label}</Text>
          <AdminTag />
        </View>
        <Text style={[styles.settingsRowDescription, { color: colors.textTertiary }]}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.textTertiary, true: accent }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: "center",
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  // §2 "Community/group member count, hero subtitle": 15pt Regular, text.secondary.
  heroMeta: {
    marginTop: -16,
    marginBottom: 8,
    fontSize: 15,
    fontWeight: "400",
    textAlign: "center",
  },
  waSection: {
    marginTop: WA_GROUP_SPACING,
  },
  iconActionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: WA_GROUP_MARGIN,
    paddingVertical: 12,
  },
  iconAction: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
  },
  iconActionLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  requestsBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginHorizontal: WA_GROUP_MARGIN,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  requestsBadgeText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingsRowTextWrap: {
    flex: 1,
  },
  settingsRowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingsRowLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  settingsRowDescription: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  adminTag: {
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  adminTagText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  dangerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  dangerLabel: {
    fontSize: 16,
    fontWeight: "500",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginTop: 12,
  },
  modalMessage: {
    fontSize: 16,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
    minWidth: 120,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
});
