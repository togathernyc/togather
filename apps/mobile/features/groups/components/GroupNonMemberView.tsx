import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Avatar } from "@components/ui";
import { AdminViewNote } from "@components/ui/AdminViewNote";
import { GroupHeader } from "./GroupHeader";
import { MembersRow } from "./MembersRow";
import { HighlightsGrid } from "./HighlightsGrid";
import { JoinGroupButton } from "./JoinGroupButton";
import { GroupOptionsModal } from "./GroupOptionsModal";
import { sectionStyles } from "./sectionStyles";
import { Group } from "../types";
import { ImageViewerManager } from "@/providers/ImageViewerProvider";
import { useAuth } from "@providers/AuthProvider";
import { useArchiveGroup } from "../hooks";

interface GroupNonMemberViewProps {
  group: Group;
  onJoinPress: () => void;
  onWithdrawPress?: () => void;
  isJoining?: boolean;
  isWithdrawing?: boolean;
}

/**
 * Non-member group page. Shares the section/card layout primitives with
 * `GroupDetailScreen` (the member view) via `sectionStyles` so spacing
 * stays consistent. Sections only a member should see (channels, bots,
 * group actions, full address for non-admins) are gated out here.
 */
export function GroupNonMemberView({
  group,
  onJoinPress,
  onWithdrawPress,
  isJoining = false,
  isWithdrawing = false,
}: GroupNonMemberViewProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const [showOptionsModal, setShowOptionsModal] = useState(false);

  // Leaders are intentionally exposed to non-members so they can reach out
  // before joining. Provided publicly by groupMembers.getLeaderPreview.
  const leaderPreview =
    ((group as any).leader_preview as
      | Array<{
          id: string;
          first_name: string;
          last_name: string;
          profile_photo?: string;
        }>
      | undefined) ?? [];

  const handleLeaderPress = (userId: string) => {
    if (!userId) return;
    // Use the canonical profile route pattern shared across the app
    // (see chat/MessageItem, EventComment, ChatInfoScreen, etc.)
    router.push(`/profile/${userId}` as any);
  };

  // Community admins see the menu and admin-only details (location)
  // even when they're not a member of this specific group.
  const isAdmin = user?.is_admin === true;

  const groupIdentifier = group?._id;
  const archiveGroupMutation = useArchiveGroup(groupIdentifier);

  const handleArchiveGroup = () => {
    Alert.alert(
      "Archive Group",
      `Are you sure you want to archive "${
        group?.name || "this group"
      }"? This will hide the group from all members. This action can be undone by a community admin.`,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => setShowOptionsModal(false),
        },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            await archiveGroupMutation.mutate();
          },
        },
      ]
    );
  };

  // Navigate to members page (for admins) - use Convex _id for navigation
  const handleMembersPress = () => {
    if (!group._id) return;
    router.push(`/leader-tools/${group._id}/members`);
  };

  // Resolve a single address string the same way the member view does so
  // the LOCATION card behaves identically for community admins.
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
          `https://www.google.com/maps/search/?api=1&query=${encoded}`
        );
      }
    } catch (err) {
      console.error("Error opening maps:", err);
    }
  };

  const memberPreview = ((group as any).member_preview ??
    []) as Array<unknown>;

  // Admins see the full member roster. Non-admins only see what's publicly
  // exposed via `member_preview` (or a count fallback) — privacy-preserving,
  // matching the prior behavior the existing tests assert.
  const hasMemberRowForAdmin =
    isAdmin &&
    ((group.members && group.members.length > 0) ||
      (group.leaders && group.leaders.length > 0));
  const hasMemberRowForNonAdmin = !isAdmin && memberPreview.length > 0;
  const showMemberRow = hasMemberRowForAdmin || hasMemberRowForNonAdmin;
  const showMemberCountFallback =
    !isAdmin &&
    !hasMemberRowForNonAdmin &&
    !!group.members_count &&
    group.members_count > 0;
  const showMembersCard = showMemberRow || showMemberCountFallback;

  const isPendingRequest = group.user_request_status === "pending";

  // Tap behavior on the MEMBERS card mirrors the member view: admins land
  // on the management roster; everyone else gets a friendly nudge to join
  // (or sees the pending state when their request is in flight).
  const onMembersCardPress = () => {
    if (isAdmin) {
      handleMembersPress();
      return;
    }
    if (isPendingRequest) return;
    Alert.alert(
      "Members",
      "Join this group to see all members. Use the button below to request to join."
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Centered hero (DM-style). Tapping share opens the options modal
            which non-members rely on for "Share Group" + admin "Archive". */}
        <GroupHeader
          group={group}
          onSharePress={() => setShowOptionsModal(true)}
        />

        {/* DESCRIPTION — wrapped in the shared section/card pattern so it
            sits in the same visual rhythm as the rest of the page. */}
        {!!group.description && group.description.trim().length > 0 && (
          <View style={sectionStyles.section}>
            <Text
              style={[
                sectionStyles.sectionHeader,
                { color: colors.textSecondary },
              ]}
            >
              ABOUT
            </Text>
            <View
              style={[
                sectionStyles.card,
                styles.descriptionCard,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <Text style={[styles.description, { color: colors.text }]}>
                {group.description}
              </Text>
            </View>
          </View>
        )}

        {/* LOCATION — admin-only. Address is sensitive for non-members so
            the row stays gated. The disclaimer makes the asymmetry
            explicit so admins know the field doesn't show to people
            outside the group. Matches the member view's DETAILS card. */}
        {isAdmin && !!address && (
          <View style={sectionStyles.section}>
            <Text
              style={[
                sectionStyles.sectionHeader,
                { color: colors.textSecondary },
              ]}
            >
              LOCATION
            </Text>
            <View
              style={[
                sectionStyles.card,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <TouchableOpacity
                onPress={handleAddressPress}
                activeOpacity={0.7}
                style={sectionStyles.detailRow}
                accessibilityRole="button"
                accessibilityLabel={`Open ${address} in Maps`}
              >
                <Ionicons
                  name="location-outline"
                  size={20}
                  color={colors.icon}
                />
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
            </View>
            <View style={styles.adminNoteWrap}>
              <AdminViewNote text="Address shown because you're a community admin. Members don't see it until they join." />
            </View>
          </View>
        )}

        {/* LEADERS — public on purpose so non-members can DM a leader before
            joining. Tap a card to open their profile. */}
        {leaderPreview.length > 0 && (
          <View style={sectionStyles.section}>
            <Text
              style={[
                sectionStyles.sectionHeader,
                { color: colors.textSecondary },
              ]}
            >
              LEADERS
            </Text>
            <View
              style={[
                sectionStyles.card,
                { backgroundColor: colors.surfaceSecondary },
              ]}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.leadersScrollContent}
              >
                {leaderPreview.map((leader) => {
                  const fullName = `${leader.first_name || ""} ${
                    leader.last_name || ""
                  }`.trim();
                  const displayName = leader.first_name || fullName || "Leader";
                  return (
                    <TouchableOpacity
                      key={leader.id}
                      onPress={() => handleLeaderPress(leader.id)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${displayName}'s profile`}
                    >
                      {/* Layout styles live on the inner View so they apply
                          on React Native Web (Pressable/Touchable's
                          function-style is silently ignored on web). */}
                      <View style={styles.leaderCard}>
                        <View
                          style={[
                            styles.leaderAvatarWrapper,
                            { borderColor: primaryColor },
                          ]}
                        >
                          <Avatar
                            name={fullName || displayName}
                            imageUrl={leader.profile_photo}
                            size={56}
                          />
                          <View
                            style={[
                              styles.leaderBadge,
                              {
                                backgroundColor: primaryColor,
                                borderColor: colors.surfaceSecondary,
                              },
                            ]}
                          />
                        </View>
                        <Text
                          style={[styles.leaderName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {displayName}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        )}

        {/* MEMBERS — same card pattern as the member view. Privacy:
              - Admins see the full roster (group.members / group.leaders).
              - Non-admins only see `member_preview` (publicly safe), or a
                count-only fallback if just the count is known.
              - Nothing renders when neither path has data. */}
        {showMembersCard && (
          <View style={sectionStyles.section}>
            <Text
              style={[
                sectionStyles.sectionHeader,
                { color: colors.textSecondary },
              ]}
            >
              MEMBERS
              {group.members_count ? ` · ${group.members_count}` : ""}
            </Text>
            {(() => {
              const cardTappable = isAdmin || !isPendingRequest;
              const Container: React.ComponentType<any> = cardTappable
                ? TouchableOpacity
                : View;
              const footerLabel = isAdmin
                ? "View all members"
                : isPendingRequest
                  ? "Request pending — you'll see all members once approved"
                  : "Join to see all members";
              const previewMembers = isAdmin
                ? group.members
                : (memberPreview as any);
              const previewLeaders = isAdmin ? group.leaders : [];
              return (
                <Container
                  {...(cardTappable
                    ? {
                        activeOpacity: 0.7,
                        onPress: onMembersCardPress,
                        accessibilityRole: "button" as const,
                        accessibilityLabel: footerLabel,
                      }
                    : {})}
                  style={[
                    sectionStyles.card,
                    { backgroundColor: colors.surfaceSecondary },
                  ]}
                >
                  {showMemberRow ? (
                    <MembersRow
                      members={previewMembers}
                      leaders={previewLeaders}
                      maxVisible={5}
                      totalCount={group.members_count ?? undefined}
                    />
                  ) : (
                    // Count-only fallback for non-admins when no public
                    // preview avatars are available. Mirrors the prior
                    // people-icon block but inside the shared card.
                    <View style={sectionStyles.detailRow}>
                      <Ionicons
                        name="people-outline"
                        size={20}
                        color={colors.icon}
                      />
                      <Text
                        style={[
                          sectionStyles.detailText,
                          { color: colors.text },
                        ]}
                      >
                        {group.members_count}{" "}
                        {group.members_count === 1 ? "member" : "members"}
                      </Text>
                    </View>
                  )}
                  <View
                    style={[
                      sectionStyles.viewAllRow,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[
                        sectionStyles.viewAllText,
                        {
                          color: isPendingRequest
                            ? colors.textSecondary
                            : colors.text,
                          fontStyle: isPendingRequest ? "italic" : "normal",
                        },
                      ]}
                    >
                      {footerLabel}
                    </Text>
                    {!isPendingRequest && (
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textTertiary}
                      />
                    )}
                  </View>
                </Container>
              );
            })()}
            {isAdmin && (
              <View style={styles.adminNoteWrap}>
                <AdminViewNote text="Full roster shown because you're a community admin. Non-members see only public previews." />
              </View>
            )}
          </View>
        )}

        {/* HIGHLIGHTS — already a self-contained section component. */}
        {group.highlights && group.highlights.length > 0 && (
          <HighlightsGrid
            highlights={group.highlights as any}
            onImagePress={(clickedHighlight) => {
              const imageUrls = (group.highlights ?? [])
                .map((h: any) => h.image_url)
                .filter(Boolean) as string[];

              const index = (group.highlights ?? []).findIndex(
                (h: any) => h.id === clickedHighlight.id
              );

              ImageViewerManager.show(imageUrls, Math.max(0, index));
            }}
          />
        )}

        {/* Spacer for fixed button */}
        <View style={styles.spacer} />
      </ScrollView>

      {/* Join Button - Fixed at bottom */}
      <JoinGroupButton
        onPress={onJoinPress}
        onWithdraw={onWithdrawPress}
        isPending={isJoining || isWithdrawing}
        group={group}
        requestStatus={
          group.user_request_status as
            | "pending"
            | "accepted"
            | "declined"
            | null
        }
      />

      {/* Options Modal - Share Group for everyone, Edit/Archive for admins */}
      <GroupOptionsModal
        visible={showOptionsModal}
        group={group}
        onClose={() => setShowOptionsModal(false)}
        onLeaveGroup={() => {}} // No-op since user is not a member
        onArchiveGroup={handleArchiveGroup}
        isLeaving={false}
        isArchiving={archiveGroupMutation.isPending}
        isMember={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100, // Space for fixed Join button
  },
  descriptionCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
  },
  spacer: {
    height: 20,
  },
  adminNoteWrap: {
    marginTop: 8,
  },
  // Leaders horizontal scroll lives inside the section card.
  leadersScrollContent: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  leaderCard: {
    alignItems: "center",
    width: 72,
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 88,
  },
  leaderAvatarWrapper: {
    position: "relative",
    borderRadius: 32,
    borderWidth: 3,
    padding: 2,
    marginBottom: 6,
  },
  leaderBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    zIndex: 1,
  },
  leaderName: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    maxWidth: 72,
  },
});
