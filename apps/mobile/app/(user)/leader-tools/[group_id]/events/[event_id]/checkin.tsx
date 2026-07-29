import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { UserRoute } from "@components/guards/UserRoute";
import { DragHandle } from "@components/ui/DragHandle";
import { useAuth } from "@providers/AuthProvider";
import {
  useQuery,
  useAuthenticatedMutation,
  api,
  Id,
} from "@services/api/convex";
import { DEFAULT_PRIMARY_COLOR } from "@utils/styles";
import { Avatar } from "@components/ui/Avatar";
import { CustomModal } from "@components/ui/Modal";
import { ToastManager } from "@components/ui/Toast";
import { useTheme } from "@hooks/useTheme";
import { GOING_RSVP_OPTION_ID } from "@/features/events/components/EventRsvpSection";
import {
  ATTENDANCE_PRESENT,
  ATTENDANCE_ABSENT,
  computeCheckInSummary,
  indexAttendanceByUser,
  isCheckedIn,
  type GoingUser,
} from "@/features/leader-tools/utils/checkIn";

const CHECKED_IN_COLOR = "#10B981"; // green-500

function formatCheckInTime(recordedAt?: number): string {
  if (!recordedAt) return "Checked in";
  const time = new Date(recordedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Checked in · ${time}`;
}

function CheckInPage() {
  const { colors } = useTheme();
  const { group_id, event_id: eventIdParam } = useLocalSearchParams<{
    group_id: string;
    event_id: string;
  }>();
  const router = useRouter();
  const { token } = useAuth();

  // Parse meeting ID from the composite event_id parameter (id-{uuid}|{date}).
  let meetingId: string | null = null;
  if (eventIdParam && eventIdParam.startsWith("id-")) {
    const afterPrefix = eventIdParam.replace("id-", "");
    const separatorIndex = afterPrefix.indexOf("|");
    if (separatorIndex > 0) {
      meetingId = afterPrefix.substring(0, separatorIndex);
    }
  }

  // Whether the current user may manage attendance (host / leader / admin).
  // Server-truthful gate — the same rule the mutations enforce.
  const canManage = useQuery(
    api.functions.meetings.attendance.canManageAttendance,
    meetingId && token
      ? { meetingId: meetingId as Id<"meetings">, token }
      : "skip"
  );
  const isLoadingPermission = canManage === undefined && !!meetingId && !!token;

  // Going roster.
  const rsvpData = useQuery(
    api.functions.meetingRsvps.list,
    meetingId
      ? { meetingId: meetingId as Id<"meetings">, token: token ?? undefined }
      : "skip"
  );
  const isLoadingRsvp = rsvpData === undefined && !!meetingId;

  // Who is currently marked Present.
  const attendance = useQuery(
    api.functions.meetings.attendance.listAttendance,
    meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip"
  );
  const isLoadingAttendance = attendance === undefined && !!meetingId;

  // Walk-ins (guest records without an account).
  const guests = useQuery(
    api.functions.meetings.attendance.listGuests,
    meetingId ? { meetingId: meetingId as Id<"meetings"> } : "skip"
  );
  const isLoadingGuests = guests === undefined && !!meetingId;

  const markAttendance = useAuthenticatedMutation(
    api.functions.meetings.attendance.markAttendance
  );
  const addGuest = useAuthenticatedMutation(
    api.functions.meetings.attendance.addGuest
  );
  const removeGuest = useAuthenticatedMutation(
    api.functions.meetings.attendance.removeGuest
  );

  const [pendingUserIds, setPendingUserIds] = useState<Set<string>>(new Set());
  const [showRestrictedModal, setShowRestrictedModal] = useState(false);
  const [showAddWalkIn, setShowAddWalkIn] = useState(false);

  const goingUsers: GoingUser[] = useMemo(
    () =>
      rsvpData?.rsvps?.find((r) => r.option.id === GOING_RSVP_OPTION_ID)
        ?.users ?? [],
    [rsvpData]
  );

  const attendanceByUser = useMemo(
    () => indexAttendanceByUser(attendance ?? []),
    [attendance]
  );

  const walkIns = useMemo(() => guests ?? [], [guests]);

  const summary = useMemo(
    () => computeCheckInSummary(goingUsers, attendanceByUser, walkIns),
    [goingUsers, attendanceByUser, walkIns]
  );

  const isLoading =
    isLoadingPermission ||
    isLoadingRsvp ||
    isLoadingAttendance ||
    isLoadingGuests;

  React.useEffect(() => {
    if (canManage === false) {
      setShowRestrictedModal(true);
    }
  }, [canManage]);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(user)/leader-tools/${group_id}/events/${eventIdParam}`);
    }
  };

  const handleToggle = async (user: GoingUser) => {
    if (!meetingId || pendingUserIds.has(user.id)) return;
    const currentlyIn = isCheckedIn(user.id, attendanceByUser);
    setPendingUserIds((prev) => new Set(prev).add(user.id));
    try {
      await markAttendance({
        meetingId: meetingId as Id<"meetings">,
        userId: user.id as Id<"users">,
        status: currentlyIn ? ATTENDANCE_ABSENT : ATTENDANCE_PRESENT,
      });
    } catch (err) {
      ToastManager.error(
        err instanceof Error ? err.message : "Couldn't update check-in"
      );
    } finally {
      setPendingUserIds((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  const handleAddWalkIn = async (guest: {
    firstName: string;
    lastName?: string;
    phoneNumber?: string;
  }) => {
    if (!meetingId) return;
    await addGuest({
      meetingId: meetingId as Id<"meetings">,
      firstName: guest.firstName,
      lastName: guest.lastName || undefined,
      phoneNumber: guest.phoneNumber || undefined,
    });
  };

  const handleRemoveWalkIn = async (guestId: string) => {
    try {
      await removeGuest({ guestId: guestId as Id<"meetingGuests"> });
    } catch (err) {
      ToastManager.error(
        err instanceof Error ? err.message : "Couldn't remove walk-in"
      );
    }
  };

  const rosterIsEmpty = goingUsers.length === 0 && walkIns.length === 0;

  return (
    <UserRoute>
      <View
        style={[
          styles.container,
          { backgroundColor: colors.backgroundSecondary },
        ]}
      >
        <DragHandle />
        {/* Header */}
        <View
          style={[
            styles.header,
            { backgroundColor: colors.surface, borderBottomColor: colors.border },
          ]}
        >
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Check in
            </Text>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={DEFAULT_PRIMARY_COLOR} />
          </View>
        ) : canManage === false ? (
          // Restricted — modal (below) explains and sends them back.
          <View style={styles.loadingContainer} />
        ) : (
          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
          >
            {/* Summary card */}
            <View
              style={[styles.summaryCard, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.summaryCount, { color: colors.text }]}>
                {summary.checkedIn} / {summary.total} checked in
              </Text>
              <View
                style={[
                  styles.progressTrack,
                  { backgroundColor: colors.backgroundSecondary },
                ]}
              >
                <View
                  style={[
                    styles.progressFill,
                    {
                      backgroundColor: CHECKED_IN_COLOR,
                      width: `${Math.round(summary.fraction * 100)}%`,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Going section */}
            {goingUsers.length > 0 && (
              <View style={styles.section}>
                <Text
                  style={[styles.sectionTitle, { color: colors.textSecondary }]}
                >
                  Going ({goingUsers.length})
                </Text>
                {goingUsers.map((user) => {
                  const checkedIn = isCheckedIn(user.id, attendanceByUser);
                  const pending = pendingUserIds.has(user.id);
                  const record = attendanceByUser.get(user.id);
                  return (
                    <TouchableOpacity
                      key={user.id}
                      style={[
                        styles.userRow,
                        { backgroundColor: colors.surface },
                      ]}
                      onPress={() => handleToggle(user)}
                      disabled={pending}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: checkedIn }}
                      accessibilityLabel={`Check in ${user.firstName ?? ""} ${
                        user.lastName ?? ""
                      }`.trim()}
                    >
                      <Avatar
                        name={`${user.firstName ?? ""} ${user.lastName ?? ""}`}
                        imageUrl={user.profileImage}
                        size={48}
                      />
                      <View style={styles.userInfo}>
                        <Text
                          style={[styles.userName, { color: colors.text }]}
                        >
                          {user.firstName} {user.lastName}
                        </Text>
                        <Text
                          style={[
                            styles.userSub,
                            {
                              color: checkedIn
                                ? CHECKED_IN_COLOR
                                : colors.textSecondary,
                            },
                          ]}
                        >
                          {checkedIn
                            ? formatCheckInTime(record?.recordedAt)
                            : "Tap to check in"}
                        </Text>
                      </View>
                      {pending ? (
                        <ActivityIndicator
                          size="small"
                          color={CHECKED_IN_COLOR}
                          style={styles.checkControl}
                        />
                      ) : checkedIn ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={30}
                          color={CHECKED_IN_COLOR}
                          style={styles.checkControl}
                        />
                      ) : (
                        <Ionicons
                          name="ellipse-outline"
                          size={30}
                          color={colors.iconSecondary}
                          style={styles.checkControl}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Walk-ins section */}
            {walkIns.length > 0 && (
              <View style={styles.section}>
                <Text
                  style={[styles.sectionTitle, { color: colors.textSecondary }]}
                >
                  Walk-ins ({walkIns.length})
                </Text>
                {walkIns.map((guest) => (
                  <View
                    key={guest._id}
                    style={[styles.userRow, { backgroundColor: colors.surface }]}
                  >
                    <Avatar
                      name={`${guest.firstName ?? ""} ${guest.lastName ?? ""}`}
                      size={48}
                    />
                    <View style={styles.userInfo}>
                      <Text style={[styles.userName, { color: colors.text }]}>
                        {guest.firstName} {guest.lastName}
                      </Text>
                      <Text
                        style={[styles.userSub, { color: CHECKED_IN_COLOR }]}
                      >
                        {formatCheckInTime(guest.recordedAt)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemoveWalkIn(guest._id)}
                      style={styles.checkControl}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove walk-in ${
                        guest.firstName ?? ""
                      }`.trim()}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={22}
                        color={colors.iconSecondary}
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Empty state — RSVP disabled or nobody going yet */}
            {rosterIsEmpty && (
              <View style={styles.emptyState}>
                <Ionicons
                  name="people-outline"
                  size={48}
                  color={colors.iconSecondary}
                />
                <Text
                  style={[
                    styles.emptyStateText,
                    { color: colors.textSecondary },
                  ]}
                >
                  No one has RSVPed yet. Add walk-ins to take a headcount.
                </Text>
              </View>
            )}

            {/* Add walk-in */}
            <TouchableOpacity
              style={[
                styles.addWalkInButton,
                { borderColor: DEFAULT_PRIMARY_COLOR },
              ]}
              onPress={() => setShowAddWalkIn(true)}
            >
              <Ionicons
                name="add"
                size={20}
                color={DEFAULT_PRIMARY_COLOR}
              />
              <Text
                style={[
                  styles.addWalkInText,
                  { color: DEFAULT_PRIMARY_COLOR },
                ]}
              >
                Add walk-in
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* Add walk-in modal */}
        <AddWalkInModal
          visible={showAddWalkIn}
          onClose={() => setShowAddWalkIn(false)}
          onAdd={handleAddWalkIn}
        />

        {/* Restricted access modal */}
        <CustomModal
          visible={showRestrictedModal}
          onClose={handleBack}
          withoutCloseBtn={true}
        >
          <View style={styles.restrictedContent}>
            <View style={styles.lockIconContainer}>
              <Ionicons
                name="lock-closed"
                size={48}
                color={DEFAULT_PRIMARY_COLOR}
              />
            </View>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Restricted Access
            </Text>
            <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
              Only the event's hosts, group leaders, or community admins can
              check people in.
            </Text>
            <TouchableOpacity
              style={[styles.modalButton, styles.modalButtonPrimary]}
              onPress={handleBack}
            >
              <Text style={styles.modalButtonTextPrimary}>Go back</Text>
            </TouchableOpacity>
          </View>
        </CustomModal>
      </View>
    </UserRoute>
  );
}

/**
 * Bottom-sheet modal to add a walk-in. First name required; last name and
 * phone optional (mirrors the request's "first name required" rule). The guest
 * is persisted already-checked-in via the parent's onAdd.
 */
function AddWalkInModal({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (guest: {
    firstName: string;
    lastName?: string;
    phoneNumber?: string;
  }) => Promise<void>;
}) {
  const { colors } = useTheme();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const canSubmit = firstName.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onAdd({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        phoneNumber: phone.replace(/\D/g, "") || undefined,
      });
      reset();
      onClose();
    } catch (err) {
      setSubmitting(false);
      ToastManager.error(
        err instanceof Error ? err.message : "Couldn't add walk-in"
      );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={handleClose}
        />
        <View
          style={[styles.sheet, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            Add walk-in
          </Text>

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            First name
          </Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={colors.textTertiary}
            autoFocus
          />

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            Last name (optional)
          </Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor={colors.textTertiary}
          />

          <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>
            Phone (optional)
          </Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text },
            ]}
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            placeholderTextColor={colors.textTertiary}
            keyboardType="phone-pad"
          />

          <TouchableOpacity
            style={[
              styles.sheetButton,
              {
                backgroundColor: canSubmit
                  ? colors.buttonPrimary
                  : colors.buttonDisabled,
              },
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text
                style={[
                  styles.sheetButtonText,
                  { color: colors.textInverse },
                ]}
              >
                Add & check in
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetCancel}
            onPress={handleClose}
          >
            <Text style={{ color: colors.textSecondary }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  summaryCount: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
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
  userSub: {
    fontSize: 13,
    marginTop: 2,
  },
  checkControl: {
    marginLeft: 12,
    minWidth: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
  },
  emptyStateText: {
    fontSize: 16,
    marginTop: 12,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  addWalkInButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 4,
  },
  addWalkInText: {
    fontSize: 16,
    fontWeight: "600",
  },
  // Restricted modal
  restrictedContent: {
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
  },
  modalButtonTextPrimary: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  // Add walk-in sheet
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  sheetButton: {
    borderRadius: 100,
    padding: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  sheetButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  sheetCancel: {
    alignItems: "center",
    paddingVertical: 14,
  },
});

export default CheckInPage;
