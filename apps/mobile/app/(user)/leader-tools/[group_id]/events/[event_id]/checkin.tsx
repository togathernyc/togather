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
  useWindowDimensions,
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
import { SearchBar } from "@components/ui/SearchBar";
import { ToastManager } from "@components/ui/Toast";
import { useTheme } from "@hooks/useTheme";
import {
  ATTENDANCE_PRESENT,
  ATTENDANCE_ABSENT,
  buildGuestSlots,
  computeCheckInSummary,
  filterGoingUsers,
  filterWalkIns,
  fullName,
  guestSlotLabel,
  indexAttendanceByUser,
  isCheckedIn,
  partitionGuests,
  type GoingUser,
  type GuestSlot,
} from "@/features/leader-tools/utils/checkIn";

const CHECKED_IN_COLOR = "#10B981"; // green-500

/** Widest the content grows to before it stops stretching and centres. */
const MAX_CONTENT_WIDTH = 1280;
/** Gutter between roster columns; halved as padding on each column. */
const COLUMN_GUTTER = 12;

/**
 * How many roster columns fit the current window.
 *
 * Phones (and any narrow window) always get 1, so native rendering is exactly
 * as it was. Wider windows — the app also runs on the web — get 2 or 3, since a
 * door list is far more useful when you can see more of it at once than when
 * one phone-width column is stretched across a desktop.
 */
function rosterColumns(width: number): number {
  if (width >= 1400) return 3;
  if (width >= 900) return 2;
  return 1;
}

function formatCheckInTime(recordedAt?: number): string {
  if (!recordedAt) return "Checked in";
  const time = new Date(recordedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Checked in · ${time}`;
}

/** The guest currently being named, identified by its persisted row. */
interface NamingGuest {
  guestId: string;
  firstName: string;
  lastName: string;
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

  // Only fetch roster / attendance / guest data once permission resolves to
  // `true`. All three queries throw server-side for non-managers
  // (`canEditMeeting`), and convex/react surfaces a query error by throwing
  // during render — which would crash the screen instead of showing the
  // Restricted Access modal (e.g. on a direct deep link, or a client/server
  // permission mismatch). Skipping until `canManage === true` keeps the
  // graceful-degradation path alive while the server stays the source of truth.
  const canFetch = !!meetingId && !!token && canManage === true;

  // Going roster. Uses the manager-gated `goingRoster` (not `meetingRsvps.list`,
  // which caps non-RSVPed callers at a 10-person preview) so every "Going"
  // attendee can be checked in and the N/M count is complete — a manager
  // running an event often hasn't RSVPed to it themselves.
  const goingRoster = useQuery(
    api.functions.meetingRsvps.goingRoster,
    canFetch
      ? { meetingId: meetingId as Id<"meetings">, token: token as string }
      : "skip"
  );
  const isLoadingRsvp = canFetch && goingRoster === undefined;

  // Who is currently marked Present. Manager-gated server-side, so pass token.
  const attendance = useQuery(
    api.functions.meetings.attendance.listAttendance,
    canFetch
      ? { meetingId: meetingId as Id<"meetings">, token: token as string }
      : "skip"
  );
  const isLoadingAttendance = canFetch && attendance === undefined;

  // Guest rows: members' plus-ones (hostUserId set) and unattached walk-ins.
  // Manager-gated, pass token.
  const guests = useQuery(
    api.functions.meetings.attendance.listGuests,
    canFetch
      ? { meetingId: meetingId as Id<"meetings">, token: token as string }
      : "skip"
  );
  const isLoadingGuests = canFetch && guests === undefined;

  const markAttendance = useAuthenticatedMutation(
    api.functions.meetings.attendance.markAttendance
  );
  const addGuest = useAuthenticatedMutation(
    api.functions.meetings.attendance.addGuest
  );
  const updateGuest = useAuthenticatedMutation(
    api.functions.meetings.attendance.updateGuest
  );
  const removeGuest = useAuthenticatedMutation(
    api.functions.meetings.attendance.removeGuest
  );

  const [pendingUserIds, setPendingUserIds] = useState<Set<string>>(new Set());
  const [pendingGuestKeys, setPendingGuestKeys] = useState<Set<string>>(
    new Set()
  );
  const [showRestrictedModal, setShowRestrictedModal] = useState(false);
  const [showAddWalkIn, setShowAddWalkIn] = useState(false);
  const [namingGuest, setNamingGuest] = useState<NamingGuest | null>(null);
  const [search, setSearch] = useState("");

  const { width } = useWindowDimensions();
  const columns = rosterColumns(width);
  const isWide = columns > 1;
  // Column sizing for the wrapping roster grid. RN has no `calc()`, so the
  // gutter is padding inside each column, cancelled by a negative margin on the
  // row — the standard flexbox gutter trick.
  const columnStyle = isWide
    ? {
        width: `${100 / columns}%` as const,
        paddingHorizontal: COLUMN_GUTTER / 2,
      }
    : null;
  const gridStyle = isWide
    ? { ...styles.grid, marginHorizontal: -COLUMN_GUTTER / 2 }
    : null;

  const goingUsers: GoingUser[] = useMemo(
    () => goingRoster ?? [],
    [goingRoster]
  );

  const attendanceByUser = useMemo(
    () => indexAttendanceByUser(attendance ?? []),
    [attendance]
  );

  const { guestsByHost, walkIns } = useMemo(
    () => partitionGuests(goingUsers, guests ?? []),
    [goingUsers, guests]
  );

  // The summary counts the whole event, not the current search — a filtered
  // "3 / 4 checked in" would be misleading while someone is typing.
  const summary = useMemo(
    () => computeCheckInSummary(goingUsers, attendanceByUser, guests ?? []),
    [goingUsers, attendanceByUser, guests]
  );

  const visibleGoing = useMemo(
    () => filterGoingUsers(goingUsers, guestsByHost, search),
    [goingUsers, guestsByHost, search]
  );
  const visibleWalkIns = useMemo(
    () => filterWalkIns(walkIns, search),
    [walkIns, search]
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

  const withGuestPending = async (key: string, action: () => Promise<void>) => {
    if (pendingGuestKeys.has(key)) return;
    setPendingGuestKeys((prev) => new Set(prev).add(key));
    try {
      await action();
    } finally {
      setPendingGuestKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
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

  /**
   * Check a member's guest in. The guest row is created immediately (so the
   * count moves on the first tap even if the leader never types a name), then
   * the name sheet opens — names are the point of the feature, but a busy line
   * can dismiss it and add the name later.
   */
  const handleCheckInGuest = async (user: GoingUser, slot: GuestSlot) => {
    if (!meetingId) return;
    await withGuestPending(`${user.id}:${slot.position}`, async () => {
      try {
        const guestId = await addGuest({
          meetingId: meetingId as Id<"meetings">,
          hostUserId: user.id as Id<"users">,
        });
        setNamingGuest({
          guestId: guestId as unknown as string,
          firstName: "",
          lastName: "",
        });
      } catch (err) {
        ToastManager.error(
          err instanceof Error ? err.message : "Couldn't check in guest"
        );
      }
    });
  };

  const handleRemoveGuest = async (guestId: string) => {
    await withGuestPending(guestId, async () => {
      try {
        await removeGuest({ guestId: guestId as Id<"meetingGuests"> });
      } catch (err) {
        ToastManager.error(
          err instanceof Error ? err.message : "Couldn't remove guest"
        );
      }
    });
  };

  const handleSaveGuestName = async (guest: NamingGuest) => {
    await updateGuest({
      guestId: guest.guestId as Id<"meetingGuests">,
      firstName: guest.firstName.trim(),
      lastName: guest.lastName.trim(),
    });
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

  const rosterIsEmpty = goingUsers.length === 0 && walkIns.length === 0;
  const searchFoundNothing =
    !rosterIsEmpty &&
    search.trim().length > 0 &&
    visibleGoing.length === 0 &&
    visibleWalkIns.length === 0;

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
          <>
            {/* Fixed controls. Summary, walk-ins and search stay put so they
                stay reachable partway down a long roster. On a wide window they
                sit on one row rather than eating three rows of height. */}
            <View style={[styles.controls, isWide && styles.controlsRow]}>
              <View
                style={[
                  styles.summaryCard,
                  { backgroundColor: colors.surface },
                  isWide && styles.summaryCardWide,
                ]}
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

              <TouchableOpacity
                style={[
                  styles.addWalkInButton,
                  { borderColor: DEFAULT_PRIMARY_COLOR },
                  isWide && styles.addWalkInButtonWide,
                ]}
                onPress={() => setShowAddWalkIn(true)}
              >
                <Ionicons name="add" size={20} color={DEFAULT_PRIMARY_COLOR} />
                <Text
                  style={[styles.addWalkInText, { color: DEFAULT_PRIMARY_COLOR }]}
                >
                  Add walk-in
                </Text>
              </TouchableOpacity>

              <SearchBar
                placeholder="Search by name"
                value={search}
                onChangeText={setSearch}
                style={[styles.searchBar, isWide && styles.searchBarWide]}
              />
            </View>

            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              keyboardShouldPersistTaps="handled"
            >
              {/* Going section */}
              {visibleGoing.length > 0 && (
                <View style={styles.section}>
                  <Text
                    style={[styles.sectionTitle, { color: colors.textSecondary }]}
                  >
                    Going ({visibleGoing.length})
                  </Text>
                  <View style={gridStyle}>
                  {visibleGoing.map((user) => {
                    const checkedIn = isCheckedIn(user.id, attendanceByUser);
                    const pending = pendingUserIds.has(user.id);
                    const record = attendanceByUser.get(user.id);
                    const hostedGuests = guestsByHost.get(user.id) ?? [];
                    const slots = buildGuestSlots(user.guestCount, hostedGuests);
                    return (
                      <View
                        key={user.id}
                        style={[styles.personBlock, columnStyle]}
                      >
                        <TouchableOpacity
                          style={[
                            styles.userRow,
                            { backgroundColor: colors.surface },
                          ]}
                          onPress={() => handleToggle(user)}
                          disabled={pending}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: checkedIn }}
                          accessibilityLabel={`Check in ${fullName(
                            user.firstName,
                            user.lastName
                          )}`}
                        >
                          <Avatar
                            name={fullName(user.firstName, user.lastName)}
                            imageUrl={user.profileImage}
                            size={48}
                          />
                          <View style={styles.userInfo}>
                            <Text style={[styles.userName, { color: colors.text }]}>
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

                        {/* Their guests */}
                        {slots.map((slot) => (
                          <GuestSlotRow
                            key={slot.guest?._id ?? `empty-${slot.position}`}
                            slot={slot}
                            hostName={fullName(user.firstName, user.lastName)}
                            pending={pendingGuestKeys.has(
                              slot.guest?._id ?? `${user.id}:${slot.position}`
                            )}
                            onCheckIn={() => handleCheckInGuest(user, slot)}
                            onRemove={() =>
                              slot.guest && handleRemoveGuest(slot.guest._id)
                            }
                            onEditName={() =>
                              slot.guest &&
                              setNamingGuest({
                                guestId: slot.guest._id,
                                firstName: slot.guest.firstName ?? "",
                                lastName: slot.guest.lastName ?? "",
                              })
                            }
                          />
                        ))}

                        {/* An undeclared extra: someone brought a friend they
                            didn't RSVP for. Only offered once the member is in,
                            to keep the unchecked roster clean. */}
                        {checkedIn && (
                          <TouchableOpacity
                            style={styles.addGuestLink}
                            onPress={() =>
                              handleCheckInGuest(user, {
                                position: slots.length + 1,
                                partySize: slots.length + 1,
                              })
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Add a guest for ${fullName(
                              user.firstName,
                              user.lastName
                            )}`}
                          >
                            <Ionicons
                              name="add"
                              size={16}
                              color={DEFAULT_PRIMARY_COLOR}
                            />
                            <Text
                              style={[
                                styles.addGuestLinkText,
                                { color: DEFAULT_PRIMARY_COLOR },
                              ]}
                            >
                              Add guest
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                  </View>
                </View>
              )}

              {/* Walk-ins section */}
              {visibleWalkIns.length > 0 && (
                <View style={styles.section}>
                  <Text
                    style={[styles.sectionTitle, { color: colors.textSecondary }]}
                  >
                    Walk-ins ({visibleWalkIns.length})
                  </Text>
                  <View style={gridStyle}>
                    {visibleWalkIns.map((guest) => (
                      <View
                        key={guest._id}
                        style={[styles.personBlock, columnStyle]}
                      >
                        <View
                          style={[
                            styles.userRow,
                            { backgroundColor: colors.surface },
                          ]}
                        >
                          <Avatar
                            name={fullName(guest.firstName, guest.lastName)}
                            size={48}
                          />
                          <View style={styles.userInfo}>
                            <Text
                              style={[styles.userName, { color: colors.text }]}
                            >
                              {fullName(guest.firstName, guest.lastName) ||
                                "Guest"}
                            </Text>
                            <Text
                              style={[
                                styles.userSub,
                                { color: CHECKED_IN_COLOR },
                              ]}
                            >
                              {formatCheckInTime(guest.recordedAt)}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleRemoveGuest(guest._id)}
                            style={styles.checkControl}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove walk-in ${fullName(
                              guest.firstName,
                              guest.lastName
                            )}`}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={22}
                              color={colors.iconSecondary}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* No search hits */}
              {searchFoundNothing && (
                <View style={styles.emptyState}>
                  <Ionicons
                    name="search-outline"
                    size={48}
                    color={colors.iconSecondary}
                  />
                  <Text
                    style={[styles.emptyStateText, { color: colors.textSecondary }]}
                  >
                    No one matches "{search.trim()}". They may be a walk-in — add
                    them above.
                  </Text>
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
                    style={[styles.emptyStateText, { color: colors.textSecondary }]}
                  >
                    No one has RSVPed yet. Add walk-ins to take a headcount.
                  </Text>
                </View>
              )}
            </ScrollView>
          </>
        )}

        {/* Add walk-in modal */}
        <AddWalkInModal
          visible={showAddWalkIn}
          onClose={() => setShowAddWalkIn(false)}
          onAdd={handleAddWalkIn}
        />

        {/* Name a member's guest */}
        <GuestNameModal
          guest={namingGuest}
          onClose={() => setNamingGuest(null)}
          onSave={handleSaveGuestName}
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
 * One plus-one under a member: an empty slot to tap in, or a checked-in guest
 * whose name can still be filled in. The name area and the check control are
 * separate targets so editing a name never toggles the guest back out.
 */
function GuestSlotRow({
  slot,
  hostName,
  pending,
  onCheckIn,
  onRemove,
  onEditName,
}: {
  slot: GuestSlot;
  hostName: string;
  pending: boolean;
  onCheckIn: () => void;
  onRemove: () => void;
  onEditName: () => void;
}) {
  const { colors } = useTheme();
  const checkedIn = !!slot.guest;
  const named = !!fullName(slot.guest?.firstName, slot.guest?.lastName);

  return (
    <View style={styles.guestRowWrapper}>
      <View style={[styles.guestConnector, { backgroundColor: colors.border }]} />
      <View style={[styles.guestRow, { backgroundColor: colors.surface }]}>
        <TouchableOpacity
          style={styles.guestLabel}
          onPress={checkedIn ? onEditName : onCheckIn}
          disabled={pending}
          accessibilityRole="button"
          accessibilityLabel={
            checkedIn
              ? `Edit name for ${guestSlotLabel(slot)}, guest of ${hostName}`
              : `Check in ${guestSlotLabel(slot)} of ${hostName}`
          }
        >
          <Ionicons
            name="person-outline"
            size={18}
            color={colors.iconSecondary}
          />
          <View style={styles.guestText}>
            <Text style={[styles.guestName, { color: colors.text }]}>
              {guestSlotLabel(slot)}
            </Text>
            <Text
              style={[
                styles.guestSub,
                {
                  color: checkedIn ? CHECKED_IN_COLOR : colors.textSecondary,
                },
              ]}
            >
              {checkedIn
                ? named
                  ? formatCheckInTime(slot.guest?.recordedAt)
                  : "Checked in · tap to add name"
                : "Tap to check in"}
            </Text>
          </View>
        </TouchableOpacity>

        {pending ? (
          <ActivityIndicator
            size="small"
            color={CHECKED_IN_COLOR}
            style={styles.checkControl}
          />
        ) : (
          <TouchableOpacity
            onPress={checkedIn ? onRemove : onCheckIn}
            style={styles.checkControl}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: checkedIn }}
            accessibilityLabel={
              checkedIn
                ? `Undo check-in for ${guestSlotLabel(slot)}`
                : `Check in ${guestSlotLabel(slot)}`
            }
          >
            <Ionicons
              name={checkedIn ? "checkmark-circle" : "ellipse-outline"}
              size={26}
              color={checkedIn ? CHECKED_IN_COLOR : colors.iconSecondary}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/**
 * Name (or rename) a guest who has already been checked in. Both fields are
 * optional — dismissing leaves the guest checked in but unnamed, which is the
 * right trade when there's a queue at the door.
 */
function GuestNameModal({
  guest,
  onClose,
  onSave,
}: {
  guest: NamingGuest | null;
  onClose: () => void;
  onSave: (guest: NamingGuest) => Promise<void>;
}) {
  const { colors } = useTheme();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the fields whenever a different guest is opened.
  React.useEffect(() => {
    setFirstName(guest?.firstName ?? "");
    setLastName(guest?.lastName ?? "");
    setSubmitting(false);
  }, [guest]);

  const handleSave = async () => {
    if (!guest || submitting) return;
    setSubmitting(true);
    try {
      await onSave({ ...guest, firstName, lastName });
      onClose();
    } catch (err) {
      setSubmitting(false);
      ToastManager.error(
        err instanceof Error ? err.message : "Couldn't save guest name"
      );
    }
  };

  return (
    <Modal
      visible={!!guest}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={onClose}
        />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            Guest name
          </Text>
          <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
            They're already checked in — add a name if you have it.
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
            onSubmitEditing={handleSave}
          />

          <TouchableOpacity
            style={[
              styles.sheetButton,
              { backgroundColor: colors.buttonPrimary },
            ]}
            onPress={handleSave}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text
                style={[styles.sheetButtonText, { color: colors.textInverse }]}
              >
                Save name
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.sheetCancel} onPress={onClose}>
            <Text style={{ color: colors.textSecondary }}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  controls: {
    paddingHorizontal: 16,
    paddingTop: 16,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  // Wide windows: summary, Add walk-in and search share one row.
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  content: {
    flex: 1,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  // Wrapping roster grid; the negative margin cancels each column's gutter.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
  },
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  summaryCardWide: {
    flex: 2,
    marginBottom: 0,
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
  searchBar: {
    marginBottom: 12,
  },
  searchBarWide: {
    flex: 3,
    marginBottom: 0,
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
  personBlock: {
    marginBottom: 8,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
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
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  // Guest slots, indented under the member who brought them.
  guestRowWrapper: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    paddingLeft: 24,
  },
  guestConnector: {
    width: 12,
    height: 1,
  },
  guestRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  guestLabel: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  guestText: {
    flex: 1,
    marginLeft: 10,
  },
  guestName: {
    fontSize: 15,
    fontWeight: "500",
  },
  guestSub: {
    fontSize: 12,
    marginTop: 1,
  },
  addGuestLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
    paddingLeft: 36,
    paddingVertical: 6,
  },
  addGuestLinkText: {
    fontSize: 14,
    fontWeight: "600",
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
    paddingVertical: 12,
    marginBottom: 12,
  },
  addWalkInButtonWide: {
    flex: 1,
    minWidth: 150,
    marginBottom: 0,
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
  // Bottom sheets
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
  sheetSubtitle: {
    fontSize: 14,
    marginTop: -12,
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
