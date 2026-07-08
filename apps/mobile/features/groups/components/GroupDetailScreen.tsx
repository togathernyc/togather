import React, { useState, useMemo, useCallback } from "react";
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
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DOMAIN_CONFIG } from "@togather/shared";
import { useTheme } from "@hooks/useTheme";
import { GroupDetailSkeleton } from "./GroupDetailSkeleton";
import { useAuth } from "@providers/AuthProvider";
import {
  useGroupDetails,
  useLeaveGroup,
  useJoinGroup,
  useArchiveGroup,
} from "../hooks";
import { useWithdrawJoinRequest } from "../hooks/useWithdrawJoinRequest";
import { useMyPendingJoinRequests } from "../hooks/useMyPendingJoinRequests";
import { PendingRequestLimitModal } from "./PendingRequestLimitModal";
import { AddGroupMembersModal } from "./AddGroupMembersModal";
import { isGroupMember } from "../utils";
import { useUserData } from "@features/profile/hooks/useUserData";
import { GroupHeader } from "./GroupHeader";
import { GroupOptionsModal } from "./GroupOptionsModal";
import { NextEventSection } from "./NextEventSection";
import { MembersRow } from "./MembersRow";
import { HighlightsGrid } from "./HighlightsGrid";
import { GroupNonMemberView } from "./GroupNonMemberView";
import { ChannelsSection } from "./ChannelsSection";
import { UpcomingEventsSection } from "./UpcomingEventsSection";
import { RosteringSection } from "./RosteringSection";
import { GroupBotsSection } from "./GroupBotsSection";
import { sectionStyles } from "./sectionStyles";
import { Group } from "../types";
import { ImageViewerManager } from "@/providers/ImageViewerProvider";
import { formatCadence } from "../utils";
import {
  getExternalChatInfo,
  openExternalChatLink,
} from "@features/chat/utils/externalChat";

export function GroupDetailScreen() {
  const params = useLocalSearchParams<{ group_id: string }>();
  const group_id = params.group_id;
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [showJoinSuccessModal, setShowJoinSuccessModal] = useState(false);
  const [showPendingLimitModal, setShowPendingLimitModal] = useState(false);
  const [showAddPeopleModal, setShowAddPeopleModal] = useState(false);

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

  // Pending join requests the current user may review (0 for non-reviewers, so
  // this both gates the "Requests" row and badges it). Populated for leaders
  // when the group's approval mode is "leaders", and for community admins.
  const pendingRequestCount = useAuthenticatedQuery(
    api.functions.groupMembers.countGroupJoinRequests,
    group?._id ? { groupId: group._id as Id<"groups"> } : "skip",
  ) as number | undefined;
  const hasPendingRequests = (pendingRequestCount ?? 0) > 0;

  // Whether the group has ever had an event plan. Rostering keeps its inline
  // position only once plans exist; before that it drops to a bottom group
  // action so the tile order stays focused on the common path. Convex dedupes
  // this subscription with RosteringSection's own listEvents query.
  const eventPlans = useAuthenticatedQuery(
    api.functions.scheduling.events.listEvents,
    group?._id && isLeader ? { groupId: group._id as Id<"groups"> } : "skip",
  ) as unknown[] | undefined;
  const hasEventPlans = Array.isArray(eventPlans) && eventPlans.length > 0;

  const handleMembersPress = () => {
    if (!group?._id) return;
    // Leaders/admins land on the full member-management surface (promote /
    // demote / remove from group / add member). Regular members get the
    // read-only roster on the general channel — same humans, no controls.
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
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => setShowOptionsModal(false),
        },
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
            setShowOptionsModal(false);
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
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () => withdrawMutation.mutate(),
        },
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

  const handleEditGroup = () => {
    if (!group?._id) return;
    router.push(`/groups/${group._id}/edit`);
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
        {
          options: ["Cancel", "Copy Link", "Share"],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            await Clipboard.setStringAsync(groupUrl);
            Alert.alert("Link Copied", "Group link has been copied to clipboard.");
          } else if (buttonIndex === 2) {
            await Share.share({
              message: `${groupName}\n${groupUrl}`,
              url: groupUrl,
            });
          }
        },
      );
    } else {
      await Share.share({ message: `${groupName}\n${groupUrl}` });
    }
  };

  const handlePinChannels = () => {
    if (!group?._id) return;
    router.push(`/(user)/leader-tools/${group._id}/pin-channels`);
  };

  const handleToolbarSettings = () => {
    if (!group?._id) return;
    router.push(`/(user)/leader-tools/${group._id}/toolbar-settings`);
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
            if (router.canGoBack()) {
              router.back();
            }
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
                  if (router.canGoBack()) {
                    router.back();
                  }
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
        await Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${encoded}`,
        );
      }
    } catch (err) {
      console.error("Error opening maps:", err);
    }
  };

  const showDetailsCard = !!cadence || !!address;
  const externalChatLink = (group as any).externalChatLink as string | undefined;

  return (
    <>
      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        // GroupHeader owns its own safe-area top inset; only need bottom padding here.
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.link}
          />
        }
      >
        {/* Centered hero (DM-style). The (i) icon is gone — you're
            already on the info surface; share lives in the top right. */}
        <GroupHeader
          group={group}
          onSharePress={group.shortId ? handleShareGroup : undefined}
          canEdit={canEditGroup}
        />

        {/* MEMBERS — moved above channels. Announcement groups contain the
            entire community, so exposing the full roster to a regular member
            would be a directory leak. Leaders/admins still get the full
            list there for moderation. */}
        {((group.members && group.members.length > 0) ||
          (group.leaders && group.leaders.length > 0) ||
          (group.members_count && group.members_count > 0)) && (
          <View style={sectionStyles.section}>
            <Text style={[sectionStyles.sectionHeader, { color: colors.textSecondary }]}>
              MEMBERS{group.members_count ? ` · ${group.members_count}` : ""}
            </Text>
            {(() => {
              // Tap disabled in two cases:
              //  1. Announcement group + non-leader (directory leak).
              //  2. Caller isn't an actual group member — `getChannelBySlug`
              //     refuses non-members, so the destination would dead-end
              //     in a permanent loading spinner. (Community super-admins
              //     who aren't group members fall here too; that's fine,
              //     they can use admin-tools surfaces instead.)
              const isAnnouncementRoster =
                !!group.is_announcement_group && !(isLeader || isAdmin);
              const hasGroupMembership = !!group.user_role;
              const tapEnabled = !isAnnouncementRoster && hasGroupMembership;
              const Container: React.ComponentType<any> = tapEnabled
                ? TouchableOpacity
                : View;
              return (
                <Container
                  {...(tapEnabled
                    ? { activeOpacity: 0.7, onPress: handleMembersPress }
                    : {})}
                  style={[sectionStyles.card, { backgroundColor: colors.surfaceSecondary }]}
                >
                  <MembersRow
                    members={group.members}
                    leaders={group.leaders}
                    totalCount={group.members_count ?? undefined}
                  />
                  {tapEnabled && (
                    <View style={[sectionStyles.viewAllRow, { borderTopColor: colors.border }]}>
                      <Text style={[sectionStyles.viewAllText, { color: colors.text }]}>
                        View all members
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textTertiary}
                      />
                    </View>
                  )}
                </Container>
              );
            })()}
          </View>
        )}

        {/* REQUESTS — the group-page review surface for the "leaders approve"
            handoff. Shown only when the group hands approval to leaders and
            there are pending requests the viewer may review (its leaders, plus
            community admins). In the default "admins" mode requests live in the
            admin dashboard instead, so this row stays hidden. Taps into the
            full review page (also the target of the incoming-request push). */}
        {group._id &&
          (group as any).join_approval_mode === "leaders" &&
          hasPendingRequests && (
          <View style={{ paddingHorizontal: 12, marginTop: 4 }}>
            <TouchableOpacity
              onPress={() =>
                router.push(`/groups/${group._id}/requests` as any)
              }
              activeOpacity={0.7}
              style={[
                styles.addPeopleTile,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <View
                style={[
                  styles.addPeopleIcon,
                  { backgroundColor: colors.warning + "1A" },
                ]}
              >
                <Ionicons name="person-add-outline" size={18} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionLabel, { color: colors.text }]}>
                  Requests
                </Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  {pendingRequestCount}{" "}
                  {pendingRequestCount === 1 ? "person wants" : "people want"} to
                  join
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Add people — leader/admin only. Mirrors the DM chat-info pattern:
            a standalone tile sitting just under the members card.
            Hidden on announcement groups (membership is implicit/community-wide). */}
        {(isLeader || isAdmin) && group._id && !group.is_announcement_group && (
          <View style={{ paddingHorizontal: 12, marginTop: 4 }}>
            <TouchableOpacity
              onPress={() => setShowAddPeopleModal(true)}
              activeOpacity={0.7}
              style={[
                styles.addPeopleTile,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <View
                style={[
                  styles.addPeopleIcon,
                  { backgroundColor: colors.link + "1A" },
                ]}
              >
                <Ionicons name="person-add" size={18} color={colors.link} />
              </View>
              <Text style={[styles.actionLabel, { color: colors.text }]}>
                Add people
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Check-in — leader/admin entry point into the people health +
            follow-up tool. Shown for both regular groups and the announcement
            (community-wide) group. */}
        {(isLeader || isAdmin) && group._id && (
          <View style={{ paddingHorizontal: 12, marginTop: 4 }}>
            <TouchableOpacity
              onPress={() =>
                router.push(`/(user)/leader-tools/${group._id}/followup` as any)
              }
              activeOpacity={0.7}
              style={[
                styles.addPeopleTile,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <View
                style={[
                  styles.addPeopleIcon,
                  { backgroundColor: colors.success + "1A" },
                ]}
              >
                <Ionicons name="pulse" size={18} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionLabel, { color: colors.text }]}>
                  Check-in
                </Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  Member health & follow-up
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}

        {/* ROSTERING — leader-only entry row into the rostering hub. Keeps this
            inline position only once the group has event plans; before that it
            drops to a bottom group action (see GROUP ACTIONS below). */}
        {group._id && isLeader && hasEventPlans && (
          <RosteringSection groupId={group._id} />
        )}

        {/* UPCOMING EVENTS — horizontal scroll. Hidden when there are no
            upcoming events. */}
        {group._id && <UpcomingEventsSection groupId={group._id} />}

        {/* CHANNELS */}
        {group._id && (
          <ChannelsSection groupId={group._id} userRole={group.user_role} />
        )}

        {/* BOTS — replaces the legacy "Bots" toolbar chip in chat. Leader
            only; renders the same bot cards + config modals BotsScreen
            renders. */}
        {group._id && (
          <GroupBotsSection groupId={group._id} isLeader={isLeader} />
        )}

        {/* Highlights */}
        {group.highlights && group.highlights.length > 0 && (
          <HighlightsGrid
            highlights={group.highlights as any}
            onImagePress={(clickedHighlight) => {
              const imageUrls = (group.highlights as any)
                .map((h: any) => h.image_url)
                .filter(Boolean);
              const index = (group.highlights as any).findIndex(
                (h: any) => h.id === clickedHighlight.id,
              );
              ImageViewerManager.show(imageUrls, Math.max(0, index));
            }}
          />
        )}

        {/* Next event */}
        <NextEventSection group={group} currentRSVP={null} />

        {/* External chat */}
        {!!externalChatLink &&
          (() => {
            const externalChatInfo = getExternalChatInfo(externalChatLink);
            return (
              <View style={sectionStyles.section}>
                <Text style={[sectionStyles.sectionHeader, { color: colors.textSecondary }]}>
                  EXTERNAL CHAT
                </Text>
                <TouchableOpacity
                  style={[sectionStyles.card, styles.externalRow, { backgroundColor: colors.surfaceSecondary }]}
                  onPress={() => openExternalChatLink(externalChatLink)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.externalIcon,
                      { backgroundColor: externalChatInfo.color + "15" },
                    ]}
                  >
                    <Ionicons
                      name={externalChatInfo.iconName as any}
                      size={20}
                      color={externalChatInfo.color}
                    />
                  </View>
                  <View style={styles.externalInfo}>
                    <Text style={[styles.externalTitle, { color: colors.text }]}>
                      Join on {externalChatInfo.name}
                    </Text>
                    <Text
                      style={[styles.externalSubtitle, { color: colors.textSecondary }]}
                    >
                      This group also chats on {externalChatInfo.name}
                    </Text>
                  </View>
                  <Ionicons name="open-outline" size={18} color={externalChatInfo.color} />
                </TouchableOpacity>
              </View>
            );
          })()}

        {/* DETAILS — schedule + address */}
        {showDetailsCard && (
          <View style={sectionStyles.section}>
            <Text style={[sectionStyles.sectionHeader, { color: colors.textSecondary }]}>
              DETAILS
            </Text>
            <View style={[sectionStyles.card, { backgroundColor: colors.surfaceSecondary }]}>
              {!!cadence && (
                <View style={sectionStyles.detailRow}>
                  <Ionicons name="calendar-outline" size={20} color={colors.icon} />
                  <Text style={[sectionStyles.detailText, { color: colors.text }]}>{cadence}</Text>
                </View>
              )}
              {!!address && (
                <TouchableOpacity
                  onPress={handleAddressPress}
                  activeOpacity={0.7}
                  style={[
                    sectionStyles.detailRow,
                    cadence && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="location-outline" size={20} color={colors.icon} />
                  <Text
                    style={[sectionStyles.detailText, { color: colors.text }]}
                    numberOfLines={2}
                  >
                    {address}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* GROUP ACTIONS */}
        <View style={sectionStyles.section}>
          <Text style={[sectionStyles.sectionHeader, { color: colors.textSecondary }]}>
            GROUP ACTIONS
          </Text>
          <View style={[sectionStyles.card, { backgroundColor: colors.surfaceSecondary }]}>
            {isLeader && (
              <ActionRow
                icon="pin-outline"
                label="Pin Channels"
                onPress={handlePinChannels}
                color={colors.text}
                iconColor={colors.icon}
                topBorder={false}
                borderColor={colors.border}
              />
            )}
            {isLeader && (
              <ActionRow
                icon="options-outline"
                label="Toolbar Settings"
                onPress={handleToolbarSettings}
                color={colors.text}
                iconColor={colors.icon}
                topBorder
                borderColor={colors.border}
              />
            )}
            {/* Rostering lives here as a group action until the group has its
                first event plan; after that it graduates to an inline section
                above (with a live status summary). */}
            {isLeader && eventPlans !== undefined && !hasEventPlans && (
              <ActionRow
                icon="calendar-outline"
                label="Rostering"
                onPress={() => router.push(`/rostering/${group._id}` as any)}
                color={colors.text}
                iconColor={colors.icon}
                topBorder
                borderColor={colors.border}
              />
            )}
            {group.shortId && (
              <ActionRow
                icon="share-outline"
                label="Share Group"
                onPress={handleShareGroup}
                color={colors.text}
                iconColor={colors.icon}
                topBorder={isLeader}
                borderColor={colors.border}
              />
            )}
            {canEditGroup && (
              <ActionRow
                icon="create-outline"
                label="Edit Group"
                onPress={handleEditGroup}
                color={colors.text}
                iconColor={colors.icon}
                topBorder
                borderColor={colors.border}
              />
            )}
            {canArchiveGroup && (
              <ActionRow
                icon="archive-outline"
                label="Archive Group"
                onPress={handleArchiveGroup}
                color={colors.text}
                iconColor={colors.icon}
                topBorder
                borderColor={colors.border}
              />
            )}
            {!group.is_announcement_group && (
              <ActionRow
                icon="exit-outline"
                label="Leave Group"
                onPress={handleLeaveGroup}
                color={colors.destructive}
                iconColor={colors.destructive}
                topBorder
                borderColor={colors.border}
              />
            )}
          </View>
        </View>
      </ScrollView>

      {/* Kept mounted for any external openers; the (i) on the hero no
          longer opens it. Migrating fully out of GroupOptionsModal would
          touch the non-member flow too — out of scope for this redesign. */}
      <GroupOptionsModal
        visible={showOptionsModal}
        group={group}
        onClose={() => setShowOptionsModal(false)}
        onLeaveGroup={handleLeaveGroup}
        onArchiveGroup={handleArchiveGroup}
        isLeaving={leaveGroupMutation.isPending}
        isArchiving={archiveGroupMutation.isPending}
      />
      {group._id && (isLeader || isAdmin) && (
        <AddGroupMembersModal
          visible={showAddPeopleModal}
          onClose={() => setShowAddPeopleModal(false)}
          groupId={group._id}
          onAdded={() => refetch()}
        />
      )}
    </>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  color,
  iconColor,
  topBorder,
  borderColor,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  color: string;
  iconColor: string;
  topBorder: boolean;
  borderColor: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        styles.actionRow,
        topBorder && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor },
      ]}
    >
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text style={[styles.actionLabel, { color }]}>{label}</Text>
    </TouchableOpacity>
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
  actionRow: {
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
  addPeopleTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 48,
  },
  addPeopleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  externalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 56,
  },
  externalIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  externalInfo: {
    flex: 1,
  },
  externalTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  externalSubtitle: {
    fontSize: 13,
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
