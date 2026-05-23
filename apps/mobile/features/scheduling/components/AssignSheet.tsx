/**
 * AssignSheet
 *
 * A modal sheet for assigning a person to a role slot. Backed by three
 * sections:
 *
 *   1. PREVIOUSLY FILLED BY — recent confirmed fillers of *this role*, kept
 *      at the top as a convenience. Hidden while the scheduler is searching.
 *   2. GROUP — community people who are already in the event's group. Tapping
 *      a row runs `assignRole` (no group write needed).
 *   3. COMMUNITY — community people who are NOT yet in the event's group.
 *      Tapping "+ Add & assign" runs `assignFromCommunity`, which adds them
 *      to the group and assigns in a single transaction. Placeholder users
 *      (already invited, not yet claimed) appear here as disabled rows with
 *      an "Invited" badge.
 *
 * The candidate pool comes from `searchCommunityPeople`, which already
 * annotates `inGroup` / `isPlaceholder` so the two sections are a simple
 * partition. Search input is debounced 300ms to keep the query under
 * control while typing.
 *
 * The "Invite someone new" form at the bottom calls `inviteAndAssign` (an
 * action: it creates a placeholder user, assigns them, then SMS-invites
 * them in one shot). The form is collapsed behind a button by default so
 * the candidate list is the primary affordance.
 *
 * Backend:
 *   - scheduling.people.searchCommunityPeople
 *   - scheduling.assignments.previousFillers
 *   - scheduling.assignments.assignRole
 *   - scheduling.assignments.assignFromCommunity
 *   - scheduling.assignments.inviteAndAssign
 *   - scheduling.teams.getTeam (for the "Vocals · Worship Team" subtitle)
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar } from "@components/ui/Avatar";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";

/** Row shape returned by `searchCommunityPeople`. */
type CommunityPerson = {
  userId: Id<"users">;
  firstName: string;
  lastName?: string;
  displayName: string;
  profilePhoto?: string;
  phone?: string;
  isPlaceholder: boolean;
  inGroup: boolean;
};

type PreviousFiller = {
  userId: Id<"users">;
  userName: string;
  lastServedDate: number;
};

/**
 * Debounce a value by `delay` ms. Defined locally to avoid a shared-hook
 * round-trip — other scheduling screens roll the same pattern (see
 * FollowupDesktopTable).
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function AssignSheet({
  visible,
  planId,
  planStatus,
  groupId,
  teamId,
  roleId,
  roleName,
  timeLabel,
  assignedUserIds,
  onClose,
}: {
  visible: boolean;
  planId: Id<"eventPlans">;
  /**
   * Whether the plan is still a draft or already published. Controls whether
   * the "Invite someone new" form sends the SMS immediately or defers it
   * until the plan is published — see `inviteAndAssign`'s `deferred` return.
   */
  planStatus: "draft" | "published";
  /** The event plan's owning group — its members are the assignable pool. */
  groupId: Id<"groups">;
  teamId: Id<"teams">;
  roleId: Id<"teamRoles">;
  roleName: string;
  /** A single event-time label, when the event has exactly one time. */
  timeLabel?: string;
  /** Users already on this role — shown as disabled. */
  assignedUserIds: Set<string>;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

  // ---------------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------------
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteFirstName, setInviteFirstName] = useState("");
  const [invitePhone, setInvitePhone] = useState("");
  const [invitingSubmit, setInvitingSubmit] = useState(false);

  // Reset transient state whenever the sheet closes so a re-open starts
  // clean (the parent unmounts us when assignTarget clears, but be defensive).
  useEffect(() => {
    if (!visible) {
      setSearch("");
      setBusyUserId(null);
      setInviteOpen(false);
      setInviteFirstName("");
      setInvitePhone("");
      setInvitingSubmit(false);
    }
  }, [visible]);

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  const candidates = useAuthenticatedQuery(
    api.functions.scheduling.people.searchCommunityPeople,
    visible ? { groupId, search: debouncedSearch, limit: 30 } : "skip",
  ) as CommunityPerson[] | undefined;

  const previous = useAuthenticatedQuery(
    api.functions.scheduling.assignments.previousFillers,
    visible ? { roleId, limit: 8 } : "skip",
  ) as PreviousFiller[] | undefined;

  const team = useAuthenticatedQuery(
    api.functions.scheduling.teams.getTeam,
    visible ? { teamId } : "skip",
  ) as { _id: Id<"teams">; name: string } | undefined;

  const assignRole = useAuthenticatedMutation(
    api.functions.scheduling.assignments.assignRole,
  );
  const assignFromCommunity = useAuthenticatedMutation(
    api.functions.scheduling.assignments.assignFromCommunity,
  );
  const inviteAndAssign = useAuthenticatedAction(
    api.functions.scheduling.assignments.inviteAndAssign,
  );

  // ---------------------------------------------------------------------------
  // Section partition
  //
  // `previousFillers` returns users-by-id with their display name, but it
  // does not tell us whether they are still in the group or whether they're
  // placeholders. We hydrate against the community-search results so the
  // "previous" rows render with the same avatar/display-name pipeline as
  // every other row. While the user is searching, the "previous" section
  // is hidden — the candidate list IS the result of their query.
  // ---------------------------------------------------------------------------
  const { previousRows, groupRows, communityRows } = useMemo(() => {
    const list = candidates ?? [];
    const byUser = new Map<string, CommunityPerson>(
      list.map((c) => [c.userId as string, c]),
    );
    const isSearching = debouncedSearch.trim().length > 0;

    const previousRows: CommunityPerson[] = isSearching
      ? []
      : (previous ?? [])
          .map((p) => byUser.get(p.userId as string))
          .filter((c): c is CommunityPerson => !!c);
    const previousIds = new Set(previousRows.map((p) => p.userId as string));

    const groupRows: CommunityPerson[] = [];
    const communityRows: CommunityPerson[] = [];
    for (const c of list) {
      if (previousIds.has(c.userId as string)) continue;
      // Placeholders are always shown under COMMUNITY — they're not real
      // group members yet even if `inGroup` happens to be true.
      if (c.inGroup && !c.isPlaceholder) {
        groupRows.push(c);
      } else {
        communityRows.push(c);
      }
    }
    return { previousRows, groupRows, communityRows };
  }, [candidates, previous, debouncedSearch]);

  // ---------------------------------------------------------------------------
  // Mutation handlers
  // ---------------------------------------------------------------------------
  const surfaceError = useCallback(
    (title: string, e: unknown) => {
      const err = e as { data?: { message?: string }; message?: string };
      const msg =
        err?.data?.message ?? err?.message ?? "Something went wrong";
      Alert.alert(title, msg);
    },
    [],
  );

  const handleAssignFromGroup = useCallback(
    async (person: CommunityPerson) => {
      if (assignedUserIds.has(person.userId as string)) return;
      setBusyUserId(person.userId as string);
      try {
        const result = await assignRole({
          planId,
          teamId,
          roleId,
          userId: person.userId,
          timeLabel,
        });
        if (result?.doubleBooked) {
          Alert.alert(
            "Heads up — double-booked",
            `${person.displayName} is already scheduled somewhere else this day. They've still been assigned — they can sort it out when they respond.`,
          );
        }
        onClose();
      } catch (e) {
        surfaceError("Couldn't assign", e);
      } finally {
        setBusyUserId(null);
      }
    },
    [
      assignedUserIds,
      assignRole,
      planId,
      teamId,
      roleId,
      timeLabel,
      onClose,
      surfaceError,
    ],
  );

  const handleAddAndAssign = useCallback(
    async (person: CommunityPerson) => {
      if (assignedUserIds.has(person.userId as string)) return;
      setBusyUserId(person.userId as string);
      try {
        const result = await assignFromCommunity({
          planId,
          teamId,
          roleId,
          userId: person.userId,
          timeLabel,
        });
        const firstName = person.firstName?.trim() || person.displayName;
        Alert.alert(
          "Assigned",
          result?.addedToGroup
            ? `Added ${firstName} to the group and assigned to ${roleName}.`
            : `Assigned ${firstName} to ${roleName}.`,
        );
        onClose();
      } catch (e) {
        surfaceError("Couldn't add & assign", e);
      } finally {
        setBusyUserId(null);
      }
    },
    [
      assignedUserIds,
      assignFromCommunity,
      planId,
      teamId,
      roleId,
      timeLabel,
      onClose,
      roleName,
      surfaceError,
    ],
  );

  const handleInviteSubmit = useCallback(async () => {
    const firstName = inviteFirstName.trim();
    const phone = invitePhone.trim();
    if (!firstName) {
      Alert.alert("First name required", "Enter the person's first name.");
      return;
    }
    if (!phone) {
      Alert.alert("Phone required", "Enter a phone number for the SMS invite.");
      return;
    }
    setInvitingSubmit(true);
    try {
      const result = (await inviteAndAssign({
        planId,
        teamId,
        roleId,
        firstName,
        phone,
        timeLabel,
      })) as
        | {
            assignmentId: Id<"roleAssignments">;
            invitedUserId: Id<"users">;
            sentInvite: boolean;
            deferred?: boolean;
          }
        | undefined;
      if (result?.deferred) {
        Alert.alert(
          "Added to the plan",
          `${firstName} is on the roster as ${roleName}. They'll get an SMS invite when you publish.`,
        );
      } else if (result?.sentInvite) {
        Alert.alert(
          "Invite sent",
          `An SMS invite was sent to ${firstName} and they're assigned to ${roleName}.`,
        );
      } else {
        Alert.alert(
          "Invite sent",
          `Couldn't send the SMS, but ${firstName} is created and assigned. You can resend later.`,
        );
      }
      onClose();
    } catch (e) {
      surfaceError("Couldn't invite", e);
    } finally {
      setInvitingSubmit(false);
    }
  }, [
    inviteFirstName,
    invitePhone,
    inviteAndAssign,
    planId,
    teamId,
    roleId,
    timeLabel,
    roleName,
    onClose,
    surfaceError,
  ]);

  // ---------------------------------------------------------------------------
  // Row renderers
  //
  // RN-Web gotcha: a function-style `style` prop on Pressable silently drops
  // layout (gap / flexDirection / padding) on web. We keep layout on a
  // static-styled inner <View> and only use Pressable for the tap target.
  // ---------------------------------------------------------------------------
  const renderGroupRow = (person: CommunityPerson, prior: boolean) => {
    const already = assignedUserIds.has(person.userId as string);
    const busy = busyUserId === (person.userId as string);
    const disabled = already || !!busyUserId || invitingSubmit;
    return (
      <Pressable
        key={person.userId as string}
        onPress={() => handleAssignFromGroup(person)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Assign ${person.displayName}`}
      >
        <View
          style={[
            styles.memberRow,
            already && { opacity: 0.5 },
          ]}
        >
          <Avatar
            name={person.displayName}
            imageUrl={person.profilePhoto}
            size={40}
          />
          <Text
            style={[styles.memberName, { color: colors.text }]}
            numberOfLines={1}
          >
            {person.displayName}
          </Text>
          {busy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : already ? (
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              Assigned
            </Text>
          ) : prior ? (
            <Ionicons name="star" size={16} color={colors.warning} />
          ) : (
            <Ionicons name="add" size={20} color={colors.textSecondary} />
          )}
        </View>
      </Pressable>
    );
  };

  const renderCommunityRow = (person: CommunityPerson) => {
    const already = assignedUserIds.has(person.userId as string);
    const busy = busyUserId === (person.userId as string);
    const isPlaceholder = person.isPlaceholder;
    // Placeholders are informational — they can't be re-invited from here.
    const disabled =
      isPlaceholder || already || !!busyUserId || invitingSubmit;
    return (
      <Pressable
        key={person.userId as string}
        onPress={() => handleAddAndAssign(person)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Add ${person.displayName} to the group and assign`}
      >
        <View
          style={[
            styles.memberRow,
            (isPlaceholder || already) && { opacity: 0.55 },
          ]}
        >
          <Avatar
            name={person.displayName}
            imageUrl={person.profilePhoto}
            size={40}
          />
          <Text
            style={[styles.memberName, { color: colors.text }]}
            numberOfLines={1}
          >
            {person.displayName}
          </Text>
          {busy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : isPlaceholder ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                Invited
              </Text>
            </View>
          ) : already ? (
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              Assigned
            </Text>
          ) : (
            <View style={styles.addAssignWrap}>
              <Ionicons name="add" size={16} color={primaryColor} />
              <Text
                style={[styles.addAssignText, { color: primaryColor }]}
              >
                Add & assign
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const loading = candidates === undefined;
  const teamName = team?.name;
  const subtitle = [roleName, teamName].filter(Boolean).join(" · ");
  const showEmpty =
    !loading &&
    previousRows.length === 0 &&
    groupRows.length === 0 &&
    communityRows.length === 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.surface }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.headerClose}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Assign someone
            </Text>
            <Text
              style={[styles.headerSub, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {subtitle}
              {timeLabel ? ` · ${timeLabel}` : ""}
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
          >
            <View
              style={[
                styles.searchBox,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Ionicons name="search" size={16} color={colors.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search by name…"
                placeholderTextColor={colors.textSecondary}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>

            {loading ? (
              <View style={styles.centered}>
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            ) : (
              <>
                {previousRows.length > 0 && (
                  <>
                    <Text
                      style={[styles.sectionLabel, { color: colors.textSecondary }]}
                    >
                      PREVIOUSLY FILLED BY
                    </Text>
                    <View
                      style={[
                        styles.group,
                        { backgroundColor: colors.surfaceSecondary },
                      ]}
                    >
                      {previousRows.map((m) => renderGroupRow(m, true))}
                    </View>
                  </>
                )}

                {groupRows.length > 0 && (
                  <>
                    <Text
                      style={[styles.sectionLabel, { color: colors.textSecondary }]}
                    >
                      GROUP
                    </Text>
                    <View
                      style={[
                        styles.group,
                        { backgroundColor: colors.surfaceSecondary },
                      ]}
                    >
                      {groupRows.map((m) => renderGroupRow(m, false))}
                    </View>
                  </>
                )}

                {communityRows.length > 0 && (
                  <>
                    <Text
                      style={[styles.sectionLabel, { color: colors.textSecondary }]}
                    >
                      COMMUNITY
                    </Text>
                    <View
                      style={[
                        styles.group,
                        { backgroundColor: colors.surfaceSecondary },
                      ]}
                    >
                      {communityRows.map(renderCommunityRow)}
                    </View>
                  </>
                )}

                {showEmpty && (
                  <Text
                    style={[styles.emptyText, { color: colors.textSecondary }]}
                  >
                    {debouncedSearch.trim()
                      ? `No one in this community matches "${debouncedSearch.trim()}".`
                      : "No assignable people yet — invite someone new below."}
                  </Text>
                )}
              </>
            )}

            {/* Invite someone new — collapsed by default. */}
            <Text
              style={[styles.sectionLabel, { color: colors.textSecondary }]}
            >
              INVITE SOMEONE NEW
            </Text>
            {inviteOpen ? (
              <View
                style={[
                  styles.inviteCard,
                  { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                ]}
              >
                <TextInput
                  style={[
                    styles.inviteInput,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                  placeholder="First name"
                  placeholderTextColor={colors.textSecondary}
                  value={inviteFirstName}
                  onChangeText={setInviteFirstName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!invitingSubmit}
                />
                <TextInput
                  style={[
                    styles.inviteInput,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                  placeholder="Phone (e.g. (555) 123-4567)"
                  placeholderTextColor={colors.textSecondary}
                  value={invitePhone}
                  onChangeText={setInvitePhone}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                  editable={!invitingSubmit}
                />
                <View style={styles.inviteActions}>
                  <Pressable
                    onPress={() => {
                      if (invitingSubmit) return;
                      setInviteOpen(false);
                      setInviteFirstName("");
                      setInvitePhone("");
                    }}
                    disabled={invitingSubmit}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel invite"
                  >
                    <View style={styles.inviteCancelInner}>
                      <Text
                        style={[styles.inviteCancelText, { color: colors.textSecondary }]}
                      >
                        Cancel
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={handleInviteSubmit}
                    disabled={invitingSubmit}
                    accessibilityRole="button"
                    accessibilityLabel={
                      planStatus === "draft"
                        ? "Invite and assign"
                        : "Send invite and assign"
                    }
                  >
                    <View
                      style={[
                        styles.inviteSubmitInner,
                        {
                          backgroundColor: primaryColor,
                          opacity: invitingSubmit ? 0.6 : 1,
                        },
                      ]}
                    >
                      {invitingSubmit ? (
                        <ActivityIndicator size="small" color={colors.surface} />
                      ) : (
                        <Text
                          style={[styles.inviteSubmitText, { color: colors.surface }]}
                        >
                          {planStatus === "draft"
                            ? "Invite & assign"
                            : "Send invite & assign"}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                </View>
                <Text
                  style={[
                    styles.inviteHelperText,
                    { color: colors.textSecondary },
                  ]}
                >
                  {planStatus === "draft"
                    ? `We'll text ${inviteFirstName.trim() || "them"} the invite when you publish this event plan.`
                    : "An SMS invite will be sent now."}
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={() => setInviteOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Invite someone new"
              >
                <View
                  style={[
                    styles.inviteToggle,
                    { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={18}
                    color={primaryColor}
                  />
                  <Text
                    style={[
                      styles.inviteToggleText,
                      { color: primaryColor },
                    ]}
                  >
                    Invite someone new
                  </Text>
                </View>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerClose: {
    paddingHorizontal: 4,
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  headerSub: {
    fontSize: 13,
    marginTop: 2,
  },
  centered: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
  },
  group: {
    borderRadius: 12,
    overflow: "hidden",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
  },
  memberName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  metaText: {
    fontSize: 13,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  addAssignWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addAssignText: {
    fontSize: 14,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 14,
    paddingVertical: 16,
    lineHeight: 20,
  },
  inviteToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inviteToggleText: {
    fontSize: 15,
    fontWeight: "600",
  },
  inviteCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  inviteInput: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inviteActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 4,
  },
  inviteCancelInner: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  inviteCancelText: {
    fontSize: 14,
    fontWeight: "500",
  },
  inviteSubmitInner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteSubmitText: {
    fontSize: 14,
    fontWeight: "600",
  },
  inviteHelperText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});
