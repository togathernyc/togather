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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
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
import { GroupBotsSection } from "./GroupBotsSection";
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
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [showOptionsModal, setShowOptionsModal] = useState(false);
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
  const isLeader =
    group?.user_role === "leader" || group?.user_role === "admin";
  const canEditGroup = useMemo(() => {
    if (!group || !user?.id) return false;
    if (user.is_admin === true) return true;
    return (
      group.leaders?.some((leader) => String(leader.id) === String(user.id)) ||
      false
    );
  }, [group, user?.id, user?.is_admin]);
  const canArchiveGroup = isAdmin && !group?.is_announcement_group;

  const handleMembersPress = () => {
    if (!group?._id) return;
    router.push(`/leader-tools/${group._id}/members`);
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
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: 24 }}
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

        {/* MEMBERS — moved above channels */}
        {((group.members && group.members.length > 0) ||
          (group.leaders && group.leaders.length > 0) ||
          (group.members_count && group.members_count > 0)) && (
          <View style={styles.section}>
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              MEMBERS{group.members_count ? ` · ${group.members_count}` : ""}
            </Text>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={isLeader || isAdmin ? handleMembersPress : undefined}
              disabled={!(isLeader || isAdmin)}
              style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}
            >
              <MembersRow
                members={group.members}
                leaders={group.leaders}
                totalCount={group.members_count ?? undefined}
              />
              {(isLeader || isAdmin) && (
                <View style={[styles.viewAllRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.viewAllText, { color: colors.text }]}>
                    View all members
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textTertiary}
                  />
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* UPCOMING EVENTS — horizontal scroll, sits between Members and
            Channels per product design. Hidden when there are no upcoming
            events. */}
        {group._id && <UpcomingEventsSection groupId={group._id} />}

        {/* CHANNELS */}
        {group._id && (
          <ChannelsSection groupId={group._id} userRole={group.user_role} />
        )}

        {/* BOTS — replaces the legacy "Bots" toolbar chip in chat. Leader
            only; renders the same bot cards + config modals BotsScreen
            renders. */}
        {group._id && (
          <GroupBotsSection groupId={group._id} isLeader={isLeader || isAdmin} />
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
              <View style={styles.section}>
                <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
                  EXTERNAL CHAT
                </Text>
                <TouchableOpacity
                  style={[styles.card, styles.externalRow, { backgroundColor: colors.surfaceSecondary }]}
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
          <View style={styles.section}>
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
              DETAILS
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
              {!!cadence && (
                <View style={styles.detailRow}>
                  <Ionicons name="calendar-outline" size={20} color={colors.icon} />
                  <Text style={[styles.detailText, { color: colors.text }]}>{cadence}</Text>
                </View>
              )}
              {!!address && (
                <TouchableOpacity
                  onPress={handleAddressPress}
                  activeOpacity={0.7}
                  style={[
                    styles.detailRow,
                    cadence && {
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons name="location-outline" size={20} color={colors.icon} />
                  <Text
                    style={[styles.detailText, { color: colors.text }]}
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
        <View style={styles.section}>
          <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
            GROUP ACTIONS
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surfaceSecondary }]}>
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
  section: {
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
  },
  viewAllRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  viewAllText: {
    fontSize: 15,
    fontWeight: "500",
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  detailText: {
    flex: 1,
    fontSize: 15,
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
