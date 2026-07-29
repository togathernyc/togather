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
 * WA-VISUAL-DELTAS.md §3 (Group/Channel info) layer, applied on top:
 *   - No opaque nav bar. `WaSubScreenHeader` puts a floating white back circle
 *     over the grouped-gray canvas with a centered 17pt "Group info" title
 *     (§3.1). This replaces `GroupHeader`, which owned the old bar AND the
 *     hero; that component is shared with the flag-off `GroupDetailScreen` /
 *     `GroupNonMemberView`, so it is left untouched and this screen renders
 *     its own hero instead (flag-off stays byte-identical).
 *   - Hero (§3.2): 100pt avatar (muted pastel initial disc when there's no
 *     photo — never brand green, S5.2), 28pt bold name, 15pt gray
 *     "N members · Type" subtitle. Cadence moved off the hero because the
 *     Details card below already carries it; photo tap-to-viewer, the edit
 *     pencil, and the description all carried over from `GroupHeader`.
 *   - Action row (§3.3): white rounded `WaActionCard`s, replacing the
 *     accent-glyph pills.
 *   - All cards inherit the S3 kit anatomy (24px radius, 52–56pt rows, black
 *     glyphs, centered chevrons, sentence-case labels) with no per-screen work.
 *
 * Deferred from the full W13 spec (out of scope for this composition pass):
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { waAccentPalette } from "@utils/waPalette";
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
import { AppImage } from "@components/ui/AppImage";
import { ImageViewerManager } from "@/providers/ImageViewerProvider";
import {
  WaInsetGroup,
  WaCell,
  WaSubScreenHeader,
  WaActionCard,
  WaActionCardRow,
  waAvatarPalette,
  WA_GROUP_SPACING,
  WA_GROUP_MARGIN,
  WA_AVATAR_PROFILE,
  WA_HERO_NAME_GAP,
  WA_HERO_SUBTITLE_GAP,
  WA_CELL_MIN_HEIGHT,
  WA_CELL_PADDING,
  WA_TYPE_HERO_NAME,
  WA_TYPE_SUBTITLE,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_FOOTNOTE,
  WA_WEIGHT_BOLD,
  WA_WEIGHT_REGULAR,
} from "@components/wa";

export function GroupInfoScreen() {
  // Router param name/shape matches the route file
  // (`app/groups/[group_id]/index.tsx`) exactly, same as GroupDetailScreen.
  const params = useLocalSearchParams<{ group_id: string }>();
  const group_id = params.group_id;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  // §1.2 dark-mode accent shift — never reuse the light-mode brand hex
  // verbatim in dark mode (see MessageItem/MessageInput/ConvexChatRoomScreen/
  // InviteKitScreen for the same pattern).
  const waAccent = useMemo(() => waAccentPalette(primaryColor, isDark).accent, [primaryColor, isDark]);

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
  const groupName = group.title || group.name || "Group";
  const groupPhoto = group.preview || group.image_url || null;
  const groupDescription = group.description?.trim() || "";
  // §3.2 hero subtitle: "62 members" (+ the group type, Togather's own extra
  // signal). Cadence lives in the Details card, not here.
  const heroSubtitle = [
    group.members_count
      ? `${group.members_count} member${group.members_count === 1 ? "" : "s"}`
      : null,
    group.group_type_name || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/groups");
    }
  };

  const handleEditGroup = () => {
    if (group._id) router.push(`/groups/${group._id}/edit`);
  };

  const handleViewPhoto = () => {
    if (groupPhoto) ImageViewerManager.show([groupPhoto], 0);
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.backgroundGrouped, paddingTop: insets.top },
      ]}
    >
      {/* §3.1 — floating back circle + centered 17pt title over the
          grouped-gray canvas. No bar fill, no hairline. */}
      <WaSubScreenHeader title="Group info" onBack={handleBack} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor={colors.link} />
        }
      >
        {/* 1. HERO (§3.2) — 100pt avatar (muted pastel initial disc as the
            no-photo fallback, never brand green per S5.2), 28pt bold name
            with the leader/admin edit pencil, 15pt gray subtitle, optional
            description. */}
        <View style={styles.hero}>
          <TouchableOpacity
            activeOpacity={groupPhoto ? 0.85 : 1}
            onPress={handleViewPhoto}
            disabled={!groupPhoto}
            accessibilityRole={groupPhoto ? "button" : undefined}
            accessibilityLabel={groupPhoto ? "View group photo" : undefined}
          >
            <AppImage
              source={groupPhoto}
              testID="group-hero-avatar"
              style={styles.heroAvatar}
              optimizedWidth={Math.min(WA_AVATAR_PROFILE * 2, 400)}
              placeholder={{
                type: "initials",
                name: groupName,
                backgroundColor: waAvatarPalette(groupName, isDark).background,
              }}
            />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={canEditGroup ? 0.7 : 1}
            onPress={canEditGroup ? handleEditGroup : undefined}
            disabled={!canEditGroup}
            style={styles.heroNameRow}
          >
            <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={2}>
              {groupName}
            </Text>
            {canEditGroup && (
              <Ionicons name="pencil" size={16} color={colors.textSecondary} style={styles.heroPencil} />
            )}
          </TouchableOpacity>

          {!!heroSubtitle && (
            <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>{heroSubtitle}</Text>
          )}
          {!!groupDescription && (
            <Text
              style={[styles.heroDescription, { color: colors.textSecondary }]}
              numberOfLines={3}
            >
              {groupDescription}
            </Text>
          )}
        </View>

        {/* 2. ACTION ROW (§3.3) — white rounded button cards with an accent
            glyph and a dark label, replacing the accent-pill glyphs S5.2
            kill-lists. §3.3 names Mute among the action buttons, so it moves
            out of its own card here: as a button it has no switch slot, so it
            flips on tap and its own label carries the state (same treatment as
            Channel info, so the two info screens stay one screen family).
            Invite reuses the same share flow for v1 (no separate invite-kit
            yet — see file-header deferral note). It still runs the exact
            per-group notification mutation NotificationPreferencesSection
            uses. */}
        <View style={styles.actionRow}>
          <WaActionCardRow>
            {!!group.shortId && (
              <WaActionCard icon="share-outline" label="Share" onPress={handleShareGroup} accent={waAccent} />
            )}
            {!!group.shortId && (
              <WaActionCard
                icon="person-add-outline"
                label="Invite"
                onPress={handleShareGroup}
                accent={waAccent}
              />
            )}
            <WaActionCard
              icon={isMuted ? "notifications-outline" : "notifications-off-outline"}
              label={isMuted ? "Unmute" : "Mute"}
              onPress={() => handleToggleMuted(!isMuted)}
              disabled={isSavingMute}
              accent={waAccent}
            />
          </WaActionCardRow>
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
                accent={waAccent}
              />
              <SettingsToggleRow
                label="Join approval: leaders"
                description="When off, community admins approve join requests instead."
                value={leadersApprove}
                onValueChange={handleToggleLeadersApprove}
                disabled={isSavingApproval}
                accent={waAccent}
              />
            </WaInsetGroup>
          </View>
        )}

        {/* 10. DESTRUCTIVE ZONE (§3.6) — Leave (hidden for announcement
            groups) as a plain WaCell destructive row (no icon, no chevron);
            Archive (admin only) stays a bespoke destructive row so it can
            carry the trailing ADMIN tag WaCell has no slot for, built to the
            same 17pt/regular WA_CELL_* metrics. The share link rides below as
            §3.6's gray footer metadata. */}
        <View style={styles.waSection}>
          <WaInsetGroup
            separatorInset={0}
            footer={group.shortId ? DOMAIN_CONFIG.groupShareUrl(group.shortId) : undefined}
          >
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
    </View>
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
  screen: {
    flex: 1,
  },
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
  // §3.2 hero — centered 100pt disc, 28pt bold name, 15pt gray subtitle.
  hero: {
    alignItems: "center",
    paddingTop: 16,
    paddingHorizontal: 24,
  },
  heroAvatar: {
    width: WA_AVATAR_PROFILE,
    height: WA_AVATAR_PROFILE,
    borderRadius: WA_AVATAR_PROFILE / 2,
  },
  heroNameRow: {
    marginTop: WA_HERO_NAME_GAP,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroName: {
    fontSize: WA_TYPE_HERO_NAME,
    fontWeight: WA_WEIGHT_BOLD,
    textAlign: "center",
  },
  heroPencil: {
    marginTop: 4,
  },
  heroSubtitle: {
    marginTop: WA_HERO_SUBTITLE_GAP,
    fontSize: WA_TYPE_SUBTITLE,
    fontWeight: WA_WEIGHT_REGULAR,
    textAlign: "center",
  },
  heroDescription: {
    marginTop: 8,
    fontSize: WA_TYPE_FOOTNOTE,
    lineHeight: 18,
    textAlign: "center",
  },
  waSection: {
    marginTop: WA_GROUP_SPACING,
  },
  actionRow: {
    marginTop: WA_GROUP_SPACING,
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
    // S3.2: cell labels are 17pt regular, not 16/500.
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_REGULAR,
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
  // Built to WaCell's own destructive-row metrics so it can't drift from the
  // "Leave Group" row directly above it.
  dangerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: WA_CELL_PADDING,
    minHeight: WA_CELL_MIN_HEIGHT,
  },
  dangerLabel: {
    fontSize: WA_TYPE_ROW_TITLE,
    fontWeight: WA_WEIGHT_REGULAR,
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
