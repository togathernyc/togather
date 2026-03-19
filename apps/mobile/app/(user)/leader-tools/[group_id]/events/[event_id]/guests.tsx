import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { UserRoute } from "@components/guards/UserRoute";
import { DragHandle } from "@components/ui/DragHandle";
import { useAuth } from "@providers/AuthProvider";
import { useQuery, api, Id } from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { Avatar } from "@components/ui/Avatar";
import { CustomModal } from "@components/ui/Modal";
import { useTheme } from "@hooks/useTheme";

function GuestListPage() {
  const { colors } = useTheme();
  const { group_id, event_id: eventIdParam } = useLocalSearchParams<{
    group_id: string;
    event_id: string;
  }>();
  const router = useRouter();
  const { token } = useAuth();
  const [showRestrictedModal, setShowRestrictedModal] = useState(false);

  // Parse meeting ID from event_id parameter
  let meetingId: string | null = null;
  if (eventIdParam && eventIdParam.startsWith("id-")) {
    const afterPrefix = eventIdParam.replace("id-", "");
    const separatorIndex = afterPrefix.indexOf("|");
    if (separatorIndex > 0) {
      meetingId = afterPrefix.substring(0, separatorIndex);
    }
  }

  // Fetch group details to check if user is leader using Convex
  const group = useQuery(
    api.functions.groups.queries.getByIdWithRole,
    group_id && token ? { groupId: group_id as Id<"groups">, token } : "skip"
  );

  const isLeader = React.useMemo(() => {
    if (!group) return false;
    return group.userRole === "leader" || group.userRole === "admin";
  }, [group]);

  // Fetch meeting details using Convex
  const meeting = useQuery(
    api.functions.meetings.index.getById,
    meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip"
  );
  // Only consider loading if query is not skipped (meetingId exists)
  const isLoadingMeeting = meeting === undefined && !!meetingId;

  // Fetch RSVPs for the meeting using Convex
  // Pass token if available to get full access (if user has RSVPed or is leader)
  const rsvpData = useQuery(
    api.functions.meetingRsvps.list,
    meetingId ? { meetingId: meetingId as Id<"meetings">, token: token ?? undefined } : "skip"
  );
  // Only consider loading if query is not skipped (meetingId exists)
  const isLoadingRsvp = rsvpData === undefined && !!meetingId;

  // Fetch current user's RSVP using Convex
  const myRsvp = useQuery(
    api.functions.meetingRsvps.myRsvp,
    meetingId && token ? { meetingId: meetingId as Id<"meetings">, token } : "skip"
  );

  const userHasRsvpd = !!myRsvp?.optionId;
  const canViewGuestList = userHasRsvpd || isLeader;

  React.useEffect(() => {
    if (!isLoadingMeeting && !canViewGuestList) {
      setShowRestrictedModal(true);
    }
  }, [isLoadingMeeting, canViewGuestList]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(user)/leader-tools/${group_id}/events/${eventIdParam}`);
    }
  };

  const handleRsvpPress = () => {
    setShowRestrictedModal(false);
    // Navigate back to event details where user can RSVP
    handleBack();
  };

  const handleRemindLater = () => {
    setShowRestrictedModal(false);
    handleBack();
  };

  const isLoading = isLoadingMeeting || isLoadingRsvp;

  // Get all users grouped by RSVP status
  const goingUsers = rsvpData?.rsvps?.find((r) =>
    r.option.label.toLowerCase().includes("going") && !r.option.label.toLowerCase().includes("can't")
  )?.users || [];

  const maybeUsers = rsvpData?.rsvps?.find((r) =>
    r.option.label.toLowerCase().includes("maybe")
  )?.users || [];

  const cantGoUsers = rsvpData?.rsvps?.find((r) =>
    r.option.label.toLowerCase().includes("can't")
  )?.users || [];

  return (
    <UserRoute>
      <View style={[styles.container, { backgroundColor: colors.backgroundSecondary }]}>
        <DragHandle />
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Guest List</Text>
          </View>
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
          </View>
        ) : (
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
          >
            {canViewGuestList ? (
              <>
                {/* Going Section */}
                {goingUsers.length > 0 && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                      Going ({goingUsers.length})
                    </Text>
                    {goingUsers.map((user) => (
                      <View key={user.id} style={[styles.userRow, { backgroundColor: colors.surface }]}>
                        <Avatar
                          name={`${user.firstName} ${user.lastName}`}
                          imageUrl={user.profileImage}
                          size={48}
                        />
                        <View style={styles.userInfo}>
                          <Text style={[styles.userName, { color: colors.text }]}>
                            {user.firstName} {user.lastName}
                          </Text>
                        </View>
                        <View style={[styles.badge, styles.badgeGoing]}>
                          <Text style={styles.badgeText}>Going</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Maybe Section */}
                {maybeUsers.length > 0 && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                      Maybe ({maybeUsers.length})
                    </Text>
                    {maybeUsers.map((user) => (
                      <View key={user.id} style={[styles.userRow, { backgroundColor: colors.surface }]}>
                        <Avatar
                          name={`${user.firstName} ${user.lastName}`}
                          imageUrl={user.profileImage}
                          size={48}
                        />
                        <View style={styles.userInfo}>
                          <Text style={[styles.userName, { color: colors.text }]}>
                            {user.firstName} {user.lastName}
                          </Text>
                        </View>
                        <View style={[styles.badge, styles.badgeMaybe]}>
                          <Text style={styles.badgeText}>Maybe</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Can't Go Section */}
                {cantGoUsers.length > 0 && (
                  <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                      Can't Go ({cantGoUsers.length})
                    </Text>
                    {cantGoUsers.map((user) => (
                      <View key={user.id} style={[styles.userRow, { backgroundColor: colors.surface }]}>
                        <Avatar
                          name={`${user.firstName} ${user.lastName}`}
                          imageUrl={user.profileImage}
                          size={48}
                        />
                        <View style={styles.userInfo}>
                          <Text style={[styles.userName, { color: colors.text }]}>
                            {user.firstName} {user.lastName}
                          </Text>
                        </View>
                        <View style={[styles.badge, styles.badgeCantGo]}>
                          <Text style={styles.badgeText}>Can't Go</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {rsvpData?.total === 0 && (
                  <View style={styles.emptyState}>
                    <Ionicons name="people-outline" size={48} color={colors.iconSecondary} />
                    <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>No RSVPs yet</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.blurredList}>
                <View style={styles.blurOverlay} />
                {[1, 2, 3, 4, 5].map((i) => (
                  <View key={i} style={styles.userRow}>
                    <View style={styles.blurredAvatar} />
                    <View style={styles.userInfo}>
                      <View style={styles.blurredName} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        )}

        {/* Restricted Access Modal */}
        <CustomModal
          visible={showRestrictedModal}
          onClose={handleRemindLater}
          withoutCloseBtn={true}
        >
          <View style={styles.modalContent}>
            <View style={styles.lockIconContainer}>
              <Ionicons name="lock-closed" size={48} color={DEFAULT_PRIMARY_COLOR} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Restricted Access</Text>
            <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
              Only RSVP'd guests can view event activity & see who's going
            </Text>

            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonPrimary]}
              onPress={handleRsvpPress}
            >
              <Text style={styles.modalButtonTextPrimary}>RSVP</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonSecondary, { backgroundColor: colors.surfaceSecondary }]}
              onPress={handleRemindLater}
            >
              <Ionicons name="time-outline" size={20} color={colors.icon} />
              <Text style={[styles.modalButtonTextSecondary, { color: colors.textSecondary }]}>Remind me later</Text>
            </TouchableOpacity>

            <View style={styles.modalHint}>
              <Ionicons name="information-circle-outline" size={16} color={colors.icon} />
              <Text style={[styles.modalHintText, { color: colors.textSecondary }]}>Not sure? Pick "Maybe"</Text>
            </View>
          </View>
        </CustomModal>
      </View>
    </UserRoute>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
  },
  backButton: {
    marginRight: 12,
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 12,
    textTransform: "uppercase",
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  badgeGoing: {
    backgroundColor: "#D1FAE5",
  },
  badgeMaybe: {
    backgroundColor: "#FEF3C7",
  },
  badgeCantGo: {
    backgroundColor: "#FEE2E2",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyStateText: {
    fontSize: 16,
    marginTop: 12,
  },
  blurredList: {
    position: "relative",
  },
  blurOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(243, 244, 246, 0.8)",
    zIndex: 1,
  },
  blurredAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#D1D5DB",
  },
  blurredName: {
    height: 16,
    backgroundColor: "#D1D5DB",
    borderRadius: 4,
    width: "70%" as any,
  },
  modalContent: {
    alignItems: "center",
    paddingVertical: 8,
  },
  lockIconContainer: {
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center",
  },
  modalMessage: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 24,
  },
  modalButton: {
    width: "100%",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalButtonPrimary: {
    backgroundColor: DEFAULT_PRIMARY_COLOR,
    flexDirection: "row",
  },
  modalButtonSecondary: {
    flexDirection: "row",
    gap: 8,
  },
  modalButtonTextPrimary: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  modalButtonTextSecondary: {
    fontSize: 16,
    fontWeight: "600",
  },
  modalHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  modalHintText: {
    fontSize: 14,
  },
});

export default GuestListPage;
