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
 *      to the group and assigns in a single transaction.
 *
 * Placeholder users (already invited via SMS, not yet claimed an account) are
 * real `groupMembers` rows — they belong in whichever section their `inGroup`
 * flag puts them. They show an inline "Invited" tag next to their name so the
 * leader knows the person hasn't signed up yet, but the row is still tappable
 * and can be assigned (including to a second role on the same plan).
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
 * Each candidate row also shows the person's availability for *this event*
 * (sourced from `scheduling.availability.availabilityForPlan`) as a small
 * inline pill next to their name — "Available" / "Can't". People who haven't
 * responded show no tag, to keep the list uncluttered.
 *
 * Backend:
 *   - scheduling.people.searchCommunityPeople
 *   - scheduling.assignments.previousFillers
 *   - scheduling.assignments.assignRole
 *   - scheduling.assignments.assignFromCommunity
 *   - scheduling.assignments.inviteAndAssign
 *   - scheduling.availability.availabilityForPlan (per-candidate availability)
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
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
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

/** Per-event availability status for a community member. */
type AvailabilityStatus = "available" | "unavailable" | "no_response";

/** Shape returned by `scheduling.availability.availabilityForPlan`. */
type AvailabilityForPlan = {
  planId: Id<"eventPlans">;
  counts: {
    available: number;
    unavailable: number;
    noResponse: number;
    total: number;
  };
  members: Array<{
    userId: Id<"users">;
    userName: string;
    isLeader: boolean;
    status: AvailabilityStatus;
    note?: string;
    respondedAt?: number;
  }>;
};

/**
 * Short label for the availability pill. Only the two non-default statuses
 * get a tag — `no_response` returns null so the row stays uncluttered.
 */
function availabilityLabel(status: AvailabilityStatus): string | null {
  if (status === "available") return "Available";
  if (status === "unavailable") return "Can't";
  return null;
}

/**
 * Format an E.164-ish phone string for display. US numbers (`+1XXXXXXXXXX`)
 * render as `(XXX) XXX-XXXX`. Anything else falls back to the raw input so
 * we don't lie about non-US formats. Returns `null` for empty/missing input
 * so callers can short-circuit rendering the second line.
 *
 * Intentionally a tiny inline helper — no library, no native dep.
 */
function formatPhoneForDisplay(phone: string | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  // US: +1 followed by 10 digits.
  const usMatch = trimmed.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (usMatch) {
    return `(${usMatch[1]}) ${usMatch[2]}-${usMatch[3]}`;
  }
  return trimmed;
}

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
  dockedRight = false,
  planId,
  planStatus,
  groupId,
  teamId,
  roleId,
  roleName,
  timeLabel,
  assignedUserIds,
  prioritizeAvailable = false,
  keepOpenWhileUnfilled = false,
  filterMemberIds = null,
  filterGroupName,
  onClose,
}: {
  visible: boolean;
  /**
   * Desktop: render as a docked right side-panel (flush right, full height)
   * beside the grid instead of a centered modal. The panel never auto-closes
   * after assigning so a leader can fill a whole column — only the X dismisses.
   */
  dockedRight?: boolean;
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
  /**
   * Sort GROUP candidates available-first (when opened from the roster grid,
   * where availability is the primary lens). Default keeps name order.
   */
  prioritizeAvailable?: boolean;
  /**
   * Keep the sheet open after assigning instead of closing — lets a leader
   * fill a multi-person role (e.g. "Vocals 3") without re-opening. The parent
   * reactively updates `assignedUserIds`, so filled people grey out in place.
   */
  keepOpenWhileUnfilled?: boolean;
  /**
   * Grid-level "also in group" scope (#477 FR-4), owned by RosterGridScreen and
   * passed down — `null` means no scope. When set, the candidate list is
   * intersected with this member set (presentation-only). The control itself
   * lives once in the grid toolbar, not in this sheet.
   */
  filterMemberIds?: Set<string> | null;
  /** Name of the scoped group, for the "also in X" hint in the GROUP header. */
  filterGroupName?: string;
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

  // Per-candidate availability for this event, keyed by userId for cheap
  // lookups in the row renderers. Display-only — does not affect ordering.
  const availability = useAuthenticatedQuery(
    api.functions.scheduling.availability.availabilityForPlan,
    visible ? { planId } : "skip",
  ) as AvailabilityForPlan | null | undefined;

  const availabilityByUser = useMemo(
    () =>
      new Map<string, AvailabilityStatus>(
        (availability?.members ?? []).map((m) => [
          m.userId as string,
          m.status,
        ]),
      ),
    [availability],
  );

  // "Also in group" scope (#477 FR-4) is now owned by the grid toolbar and
  // passed down as a resolved member set — this sheet just applies it. `null`
  // means no scope. The control + its `rosterFilterGroups` /
  // `rosterFilterMemberIds` queries live once in RosterGridScreen.
  const filterMemberSet = filterMemberIds;

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
    // Apply the "also in group" scope first — it's presentation-only, so it
    // narrows every section (previous / group / community) uniformly. The
    // roster's own coverage tallies live elsewhere and stay whole (FR-4.4).
    const list = (candidates ?? []).filter(
      (c) => !filterMemberSet || filterMemberSet.has(c.userId as string),
    );
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
      // Placeholders are real `groupMembers` rows — partition purely on
      // `inGroup`. The "Invited" tag (rendered inline next to the name)
      // is what flags them as awaiting signup.
      if (c.inGroup) {
        groupRows.push(c);
      } else {
        communityRows.push(c);
      }
    }
    if (prioritizeAvailable) {
      // Available → no-response → unavailable, then existing (name) order.
      const rank = (uid: string): number => {
        const s = availabilityByUser.get(uid);
        if (s === "available") return 0;
        if (s === "unavailable") return 2;
        return 1;
      };
      groupRows.sort(
        (a, b) => rank(a.userId as string) - rank(b.userId as string),
      );
    }
    return { previousRows, groupRows, communityRows };
  }, [
    candidates,
    previous,
    debouncedSearch,
    prioritizeAvailable,
    availabilityByUser,
    filterMemberSet,
  ]);

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
        // Multi-person roles (e.g. "Vocals 3") stay open so the leader fills
        // the rest without re-opening; the just-assigned person greys out as
        // the parent's reactive `assignedUserIds` updates. The desktop docked
        // panel ALWAYS stays open (closes only via its X) so a leader can fill
        // a whole column.
        if (!keepOpenWhileUnfilled && !dockedRight) onClose();
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
      keepOpenWhileUnfilled,
      dockedRight,
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
        if (!dockedRight) onClose();
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
      dockedRight,
      onClose,
      roleName,
      surfaceError,
    ],
  );

  const handleInviteSubmit = useCallback(async () => {
    const firstName = inviteFirstName.trim();
    const phone = invitePhone.trim();
    if (!firstName) {
      Alert.alert("Name required", "Enter the person's name.");
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
            existedAlready?: boolean;
            existingDisplayName?: string | null;
          }
        | undefined;
      if (result?.existedAlready) {
        const matched = result.existingDisplayName || firstName;
        Alert.alert(
          "Already in Togather",
          `That phone matched ${matched} in your community. We assigned them to ${roleName} instead of creating a new invite.`,
        );
      } else if (result?.deferred) {
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
      if (dockedRight) {
        // Keep the panel open to fill more of the column; clear the form so the
        // next invite starts blank.
        setInviteOpen(false);
        setInviteFirstName("");
        setInvitePhone("");
      } else {
        onClose();
      }
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
    dockedRight,
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
  /**
   * Person identity block (avatar + name + optional "Invited" tag + optional
   * availability pill + phone). Shared between both row variants so GROUP and
   * COMMUNITY rows show disambiguating phone numbers and availability
   * identically.
   */
  const renderPersonIdentity = (person: CommunityPerson) => {
    const phoneLine = formatPhoneForDisplay(person.phone);
    const availabilityStatus = availabilityByUser.get(person.userId as string);
    const availabilityText = availabilityStatus
      ? availabilityLabel(availabilityStatus)
      : null;
    const available = availabilityStatus === "available";
    return (
      <>
        <Avatar
          name={person.displayName}
          imageUrl={person.profilePhoto}
          size={40}
        />
        <View style={styles.identityTextWrap}>
          <View style={styles.identityNameRow}>
            <Text
              style={[styles.memberName, { color: colors.text }]}
              numberOfLines={1}
            >
              {person.displayName}
            </Text>
            {person.isPlaceholder && (
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: colors.surfaceSecondary,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.badgeText, { color: colors.textSecondary }]}
                >
                  Invited
                </Text>
              </View>
            )}
            {availabilityText && (
              <View
                style={[
                  styles.availabilityTag,
                  {
                    backgroundColor:
                      (available ? colors.success : colors.destructive) + "22",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.availabilityTagText,
                    { color: available ? colors.success : colors.destructive },
                  ]}
                >
                  {availabilityText}
                </Text>
              </View>
            )}
          </View>
          {phoneLine && (
            <Text
              style={[styles.phoneText, { color: colors.textTertiary }]}
              numberOfLines={1}
            >
              {phoneLine}
            </Text>
          )}
        </View>
      </>
    );
  };

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
          {renderPersonIdentity(person)}
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
    const disabled = already || !!busyUserId || invitingSubmit;
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
            already && { opacity: 0.55 },
          ]}
        >
          {renderPersonIdentity(person)}
          {busy ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : already ? (
            <Text style={[styles.metaText, { color: colors.textSecondary }]}>
              Assigned
            </Text>
          ) : (
            <View style={styles.addAssignWrap}>
              <Ionicons name="add" size={16} color={primaryColor} />
              <Text style={[styles.addAssignText, { color: primaryColor }]}>
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

  // Flatten the three sections into a single list for FlashList. The candidate
  // pool can now be the FULL group membership (≥500 in big churches — #477
  // FR-1/FR-9), so the rows must virtualize rather than render all at once.
  // Section labels are interleaved as their own items; the search box + group
  // filter live in the list header, the invite form in the footer.
  type AssignListItem =
    | { kind: "label"; key: string; label: string }
    | { kind: "group"; key: string; person: CommunityPerson; prior: boolean }
    | { kind: "community"; key: string; person: CommunityPerson };

  const listData = useMemo<AssignListItem[]>(() => {
    const out: AssignListItem[] = [];
    if (previousRows.length > 0) {
      out.push({ kind: "label", key: "l-prev", label: "PREVIOUSLY FILLED BY" });
      for (const p of previousRows) {
        out.push({ kind: "group", key: `prev-${p.userId}`, person: p, prior: true });
      }
    }
    if (groupRows.length > 0) {
      out.push({
        kind: "label",
        key: "l-group",
        label: filterGroupName ? `GROUP · ALSO IN ${filterGroupName.toUpperCase()}` : "GROUP",
      });
      for (const p of groupRows) {
        out.push({ kind: "group", key: `grp-${p.userId}`, person: p, prior: false });
      }
    }
    if (communityRows.length > 0) {
      out.push({
        kind: "label",
        key: "l-comm",
        label: "COMMUNITY",
      });
      for (const p of communityRows) {
        out.push({ kind: "community", key: `comm-${p.userId}`, person: p });
      }
    }
    return out;
  }, [previousRows, groupRows, communityRows, filterGroupName]);

  // Plain function (not memoized): the row renderers it delegates to close over
  // fresh state each render, so memoizing here would be a no-op. FlashList still
  // recycles rows by `keyExtractor` + `extraData`.
  const renderListItem = ({ item }: { item: AssignListItem }) => {
    if (item.kind === "label") {
      return (
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          {item.label}
        </Text>
      );
    }
    if (item.kind === "group") {
      return renderGroupRow(item.person, item.prior);
    }
    return renderCommunityRow(item.person);
  };

  // Header + scrollable body — identical in both presentations (docked panel /
  // centered modal). Only the container around it changes by breakpoint.
  const panelContent = (
    <>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
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
        <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.headerClose}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.cardBody}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
          <FlashList
            data={listData}
            // Re-render rows when these change the per-row affordance (busy
            // spinner, disabled state, "Assigned" greying as the parent
            // reactively updates `assignedUserIds`).
            extraData={`${busyUserId ?? ""}|${invitingSubmit}|${assignedUserIds.size}`}
            keyExtractor={(item) => item.key}
            renderItem={renderListItem}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={
              <View>
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

                {/* "Also in group" scope hint (#477 FR-4). The control now
                    lives once in the grid toolbar; here we only echo the active
                    scope so the narrowed list is legible. */}
                {filterGroupName && (
                  <View
                    style={[
                      styles.scopeRow,
                      {
                        borderColor: primaryColor,
                        backgroundColor: primaryColor + "14",
                      },
                    ]}
                  >
                    <Ionicons name="funnel" size={14} color={primaryColor} />
                    <Text
                      style={[styles.scopeText, { color: primaryColor }]}
                      numberOfLines={1}
                    >
                      Also in: {filterGroupName}
                    </Text>
                  </View>
                )}

                {loading && (
                  <View style={styles.centered}>
                    <ActivityIndicator size="small" color={colors.text} />
                  </View>
                )}
                {showEmpty && (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {debouncedSearch.trim() || filterGroupName
                      ? "No one matches these filters."
                      : "No assignable people yet — invite someone new below."}
                  </Text>
                )}
              </View>
            }
            ListFooterComponent={
              <View>
                {/* Invite someone new — collapsed by default. */}
                <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
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
                      placeholder="Name"
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
                      style={[styles.inviteHelperText, { color: colors.textSecondary }]}
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
                        style={[styles.inviteToggleText, { color: primaryColor }]}
                      >
                        Invite someone new
                      </Text>
                    </View>
                  </Pressable>
                )}
              </View>
            }
          />
      </KeyboardAvoidingView>
    </>
  );

  // Desktop: a docked right side-panel flush against the grid (no backdrop, no
  // Modal), so the grid stays visible and interactive beside it.
  if (dockedRight) {
    if (!visible) return null;
    return (
      <View
        style={[
          styles.dockPanel,
          { backgroundColor: colors.surface, borderLeftColor: colors.border },
        ]}
      >
        {panelContent}
      </View>
    );
  }

  // Mobile: a centered card over a dim backdrop, so the roster grid stays
  // visible behind it instead of a full-screen sheet.
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {panelContent}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "85%",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  // Desktop docked panel: fixed-width column flush against the grid's right
  // edge, full height. No border radius — it reads as a docked inspector.
  dockPanel: {
    width: 420,
    flexShrink: 0,
    height: "100%",
    borderLeftWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardBody: {
    flexShrink: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
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
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
  },
  scopeText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
  },
  identityTextWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "column",
    gap: 2,
  },
  identityNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  memberName: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  phoneText: {
    fontSize: 12,
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
  availabilityTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  availabilityTagText: {
    fontSize: 11,
    fontWeight: "600",
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
