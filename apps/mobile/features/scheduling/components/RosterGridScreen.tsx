/**
 * RosterGridScreen
 *
 * The leader's "both-toggle" rostering matrix — turns collected availability
 * into a placed roster. One screen, two lenses on the same backend matrix:
 *
 *  - ROLES view (default): rows = team roles, columns = events. Each cell shows
 *    coverage (filled/needed) and lets a leader fill an open slot (AssignSheet)
 *    or manage existing occupants (cell popover). Roles are grouped under a
 *    small uppercase team header in the frozen first column.
 *  - PEOPLE view: rows = members (most-available first), columns = events. Each
 *    cell shows what a person is serving that date, or — when they're available
 *    and unassigned — an inviting "av" tap-target that opens an *open-roles
 *    menu* for one-tap placement. This is the availability → roster bridge.
 *
 * Scaffold: frozen header row + frozen first column + synced two-axis scroll,
 * measured body height, responsive widths.
 * Assignment is delegated entirely to AssignSheet — we never fork that logic.
 *
 * Route: /rostering/[group_id]/grid
 * Backend: scheduling.roster.rosterMatrix (reactive — mutations self-refresh),
 *          scheduling.assignments.assignRole / .unassign
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Avatar } from "@components/ui/Avatar";
import { EmptyState } from "@components/ui/EmptyState";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { confirmAsync, notify } from "@/utils/platformAlert";
import { AssignSheet } from "./AssignSheet";
import { GridPresenceBar } from "./GridPresenceBar";

// ---------------------------------------------------------------------------
// Backend contract (mirrors scheduling.roster.rosterMatrix)
// ---------------------------------------------------------------------------
type Availability = "available" | "unavailable" | "no_response";
type AssignmentStatus = "confirmed" | "unconfirmed" | "declined";

type RosterEvent = {
  _id: Id<"eventPlans">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
  status: "draft" | "published";
  /** Unconfirmed assignments for the plan — who publish will notify. */
  pendingCount: number;
};

type RosterTeam = { teamId: Id<"teams">; teamName: string };

type RosterRole = {
  roleId: Id<"teamRoles">;
  teamId: Id<"teams">;
  roleName: string;
  roleColor?: string;
  teamName: string;
};

type RoleCell = {
  needed: number;
  filled: number;
  confirmed: number;
  open: number;
  occupants: Array<{
    assignmentId: Id<"roleAssignments">;
    userId: Id<"users">;
    userName: string;
    profilePhoto?: string;
    status: AssignmentStatus;
  }>;
};

type MemberAssignment = {
  assignmentId: Id<"roleAssignments">;
  roleId: Id<"teamRoles">;
  roleName: string;
  status: AssignmentStatus;
};

type MemberCell = {
  availability: Availability;
  assignments: MemberAssignment[];
  doubleBooked: boolean;
};

type RosterMember = {
  userId: Id<"users">;
  userName: string;
  isLeader: boolean;
  availableCount: number;
  load: number;
  cells: Record<string, MemberCell>;
};

type RosterMatrix = {
  events: RosterEvent[];
  teams: RosterTeam[];
  roles: RosterRole[];
  roleCells: Record<string, RoleCell>;
  members: RosterMember[];
  eventCounts: Record<
    string,
    {
      available: number;
      unavailable: number;
      noResponse: number;
      openSlots: number;
      neededTotal: number;
    }
  >;
  summary: { totalMembers: number; respondedMembers: number };
};

type ViewMode = "roles" | "people";

/** A frozen-column row in the role view: a team section header or a role. */
type RoleRow =
  | { kind: "section"; teamId: string; teamName: string }
  | { kind: "role"; role: RosterRole };

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------
function weekday(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { weekday: "short" });
}
function monthDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Debounce a value by `delay` ms — same pattern as AssignSheet. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** The worst (most-attention-needing) status in a set of assignments. */
function worstStatus(items: { status: AssignmentStatus }[]): AssignmentStatus {
  if (items.some((i) => i.status === "declined")) return "declined";
  if (items.some((i) => i.status === "unconfirmed")) return "unconfirmed";
  return "confirmed";
}

type Colors = ReturnType<typeof useTheme>["colors"];

function statusColor(status: AssignmentStatus, colors: Colors): string {
  if (status === "declined") return colors.destructive;
  if (status === "unconfirmed") return colors.warning;
  return colors.success;
}

function statusIcon(status: AssignmentStatus): keyof typeof Ionicons.glyphMap {
  if (status === "declined") return "close";
  if (status === "unconfirmed") return "time-outline";
  return "checkmark";
}

// AssignSheet's required shape; used by the role-cell + open-roles flows.
type AssignTarget = {
  planId: Id<"eventPlans">;
  planStatus: "draft" | "published";
  teamId: Id<"teams">;
  roleId: Id<"teamRoles">;
  roleName: string;
  timeLabel?: string;
  assignedUserIds: Set<string>;
  keepOpenWhileUnfilled: boolean;
};

export function RosterGridScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { group_id } = useLocalSearchParams<{ group_id: string }>();
  const groupId = group_id as Id<"groups">;

  const isWide = width >= 700;
  const NAME_W = isWide ? 220 : 150;
  const ROW_H = 52;
  const SECTION_H = 28;
  const HEADER_H = 70;
  // Minimum legible column width per platform. On desktop the cells region
  // grows to fill the viewport (see `CELL_W` below) so a 1–2 date roster reads
  // as a real table rather than a sliver hugging the left edge. There is no
  // upper cap on the fill path: with few dates the columns expand to fill the
  // full grid width (a single wide column is fine — far better than a 280px
  // column with a 700px dead band beside it).
  const MIN_CELL_W = isWide ? 150 : 76;

  const data = useAuthenticatedQuery(
    api.functions.scheduling.roster.rosterMatrix,
    groupId ? { groupId } : "skip",
  ) as RosterMatrix | undefined;

  const assignRole = useAuthenticatedMutation(
    api.functions.scheduling.assignments.assignRole,
  );
  const unassign = useAuthenticatedMutation(
    api.functions.scheduling.assignments.unassign,
  );
  // Publish from the grid (#477 FR-3) — the SAME action the event editor uses,
  // not a fork. The grid is group-scoped with multiple date columns, so the
  // chooser below targets a specific plan (or all draft plans).
  const publishEvent = useAuthenticatedAction(
    api.functions.scheduling.assignments.publishEvent,
  );

  // --- View + filter state ---
  const [mode, setMode] = useState<ViewMode>("roles");
  // Team scope: a single isolated team, or null for "All teams" (#477 FR-2).
  // Picking a team shows only its roles; "All teams" shows everything. Gates
  // the Roles view only — People rows stay ungated.
  const [isolatedTeamId, setIsolatedTeamId] = useState<string | null>(null);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [openOnly, setOpenOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  // "Also in group" filter — narrows People rows to members who also belong to
  // another of the leader's groups. `filterGroups` populates the picker;
  // `filterMemberIds` is the chosen group's member set (skipped until picked).
  const [filterGroupId, setFilterGroupId] = useState<Id<"groups"> | null>(null);
  const [groupFilterOpen, setGroupFilterOpen] = useState(false);

  const filterGroups = useAuthenticatedQuery(
    api.functions.scheduling.roster.rosterFilterGroups,
    groupId ? { groupId } : "skip",
  ) as Array<{ id: Id<"groups">; name: string }> | undefined;

  // Gate the member-id query on the selection still being present in the loaded
  // group list. If it goes stale mid-session (the leader left the filter group,
  // or it was archived), this skips on the SAME render — before
  // `rosterFilterMemberIds`' `requireGroupMember` gate could throw into the
  // error boundary — rather than relying on the effect below, which only runs
  // after render.
  const filterMemberIds = useAuthenticatedQuery(
    api.functions.scheduling.roster.rosterFilterMemberIds,
    filterGroupId && filterGroups?.some((g) => g.id === filterGroupId)
      ? { groupId: filterGroupId }
      : "skip",
  ) as string[] | undefined;

  const filterMemberSet = useMemo(
    () => (filterMemberIds ? new Set(filterMemberIds) : null),
    [filterMemberIds],
  );

  const filterGroupName = filterGroupId
    ? filterGroups?.find((g) => g.id === filterGroupId)?.name
    : undefined;

  // Reset a stale selection once the loaded group list no longer contains it —
  // the group was archived, the leader left it, or the screen was reused for a
  // different roster group. Without this the filter chip (which only renders
  // while `filterGroups` is non-empty) can vanish with the filter still active,
  // stranding the People view filtered/empty. (The query above is already gated
  // on the same condition; this clears the lingering UI state.)
  useEffect(() => {
    if (
      filterGroupId &&
      filterGroups &&
      !filterGroups.some((g) => g.id === filterGroupId)
    ) {
      setFilterGroupId(null);
    }
  }, [filterGroups, filterGroupId]);

  // --- Synced scroll scaffold (frozen header row + frozen first column) ---
  const headerScrollRef = useRef<ScrollView>(null);
  const frozenScrollRef = useRef<ScrollView>(null);
  const [bodyH, setBodyH] = useState(0);
  const [bodyW, setBodyW] = useState(0);

  const onCellsHScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    headerScrollRef.current?.scrollTo({
      x: e.nativeEvent.contentOffset.x,
      animated: false,
    });
  };
  const onCellsVScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    frozenScrollRef.current?.scrollTo({
      y: e.nativeEvent.contentOffset.y,
      animated: false,
    });
  };

  // --- Modal state ---
  // AssignSheet target (role-cell fill / "add someone" / open-roles handoff).
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  // Role-cell occupant popover (manage existing assignments + add someone).
  const [roleCellModal, setRoleCellModal] = useState<{
    role: RosterRole;
    event: RosterEvent;
  } | null>(null);
  // People-view: a member's assignments for an event (manage + add role).
  const [memberCellModal, setMemberCellModal] = useState<{
    member: RosterMember;
    event: RosterEvent;
  } | null>(null);
  // People-view: open-roles menu for placing a member into a slot.
  const [openRolesModal, setOpenRolesModal] = useState<{
    member: RosterMember;
    event: RosterEvent;
    note?: string;
  } | null>(null);
  // Publish chooser (#477 FR-3): which date(s) to publish & send requests.
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Single docked side-panel at a time (desktop). The assign panel and the two
  // cell-management panels (role / member) all share the grid's right dock
  // region, so opening one must close the others — otherwise two panels could
  // render at once. On mobile these are independent overlay modals; clearing
  // siblings is harmless there too (only one is ever opened at a time).
  const openAssign = useCallback((target: AssignTarget) => {
    setRoleCellModal(null);
    setMemberCellModal(null);
    setAssignTarget(target);
  }, []);
  const openRoleCell = useCallback(
    (payload: { role: RosterRole; event: RosterEvent }) => {
      setAssignTarget(null);
      setMemberCellModal(null);
      setRoleCellModal(payload);
    },
    [],
  );
  const openMemberCell = useCallback(
    (payload: { member: RosterMember; event: RosterEvent }) => {
      setAssignTarget(null);
      setRoleCellModal(null);
      setMemberCellModal(payload);
    },
    [],
  );

  const surfaceError = useCallback((title: string, e: unknown) => {
    const err = e as { data?: { message?: string }; message?: string };
    Alert.alert(title, err?.data?.message ?? err?.message ?? "Something went wrong");
  }, []);

  const handleUnassign = useCallback(
    async (assignmentId: Id<"roleAssignments">) => {
      try {
        await unassign({ assignmentId });
      } catch (e) {
        surfaceError("Couldn't remove", e);
      }
    },
    [unassign, surfaceError],
  );

  /** A single time-label when the event has exactly one time, else undefined. */
  const singleTimeLabel = useCallback(
    (event: RosterEvent): string | undefined =>
      event.times.length === 1 ? event.times[0].label : undefined,
    [],
  );

  const handleQuickAssign = useCallback(
    async (role: RosterRole, event: RosterEvent, member: RosterMember) => {
      try {
        await assignRole({
          planId: event._id,
          teamId: role.teamId,
          roleId: role.roleId,
          userId: member.userId,
          timeLabel: singleTimeLabel(event),
        });
        setOpenRolesModal(null);
      } catch (e) {
        surfaceError("Couldn't assign", e);
      }
    },
    [assignRole, singleTimeLabel, surfaceError],
  );

  // --- Derived filters ---
  const events = data?.events ?? [];
  const roleCells = data?.roleCells ?? {};

  // Column width. On mobile it's the fixed minimum (today's behavior). On
  // desktop the date columns EXPAND to fill the available grid width — the
  // measured body width minus the frozen NAME_W column — divided across the
  // date columns, with only a MIN_CELL_W floor (no upper cap). So 1 date fills
  // the whole grid area as one wide column, and ≥N dates fill the width then
  // scroll horizontally once they hit the floor. `bodyW` re-measures whenever
  // the grid area resizes (e.g. the assign side-panel docking shrinks it), so
  // the fill always targets the space actually left of the panel — no dead band
  // between the table and the panel. Frozen-column alignment is preserved since
  // header + body share this same CELL_W.
  const CELL_W = useMemo(() => {
    if (!isWide || bodyW === 0 || events.length === 0) return MIN_CELL_W;
    const avail = bodyW - NAME_W;
    return Math.max(MIN_CELL_W, Math.floor(avail / events.length));
  }, [isWide, bodyW, events.length, NAME_W, MIN_CELL_W]);

  // Clear a stale isolated team once it's no longer in the loaded team list
  // (e.g. its roles were removed). Keeps the dropdown label honest.
  useEffect(() => {
    if (
      isolatedTeamId &&
      data &&
      !data.teams.some((t) => (t.teamId as string) === isolatedTeamId)
    ) {
      setIsolatedTeamId(null);
    }
  }, [data, isolatedTeamId]);

  const isolatedTeamName = isolatedTeamId
    ? data?.teams.find((t) => (t.teamId as string) === isolatedTeamId)?.teamName
    : undefined;

  /** Roles after team + "open only" filters; grouped headers are derived on render. */
  const visibleRoles = useMemo(() => {
    if (!data) return [];
    return data.roles.filter((r) => {
      if (isolatedTeamId && (r.teamId as string) !== isolatedTeamId) return false;
      if (openOnly) {
        // Keep only roles with at least one open slot across visible events.
        const hasOpen = events.some((ev) => {
          const c = roleCells[`${r.roleId}:${ev._id}`];
          return c && c.open > 0;
        });
        if (!hasOpen) return false;
      }
      return true;
    });
  }, [data, events, roleCells, isolatedTeamId, openOnly]);

  /**
   * Interleave team section-header rows into the (already team-sorted) role
   * list. Computed unconditionally (above the early returns) to respect the
   * Rules of Hooks.
   */
  const roleRows = useMemo<RoleRow[]>(() => {
    const out: RoleRow[] = [];
    let lastTeam: string | null = null;
    for (const role of visibleRoles) {
      const tid = role.teamId as string;
      if (tid !== lastTeam) {
        out.push({ kind: "section", teamId: tid, teamName: role.teamName });
        lastTeam = tid;
      }
      out.push({ kind: "role", role });
    }
    return out;
  }, [visibleRoles]);

  /** Members after team* + search + open/available filters. (*teams don't gate people rows.) */
  const visibleMembers = useMemo(() => {
    if (!data) return [];
    const q = debouncedSearch.trim().toLowerCase();
    return data.members.filter((m) => {
      if (q && !m.userName.toLowerCase().includes(q)) return false;
      if (availableOnly && m.availableCount === 0) return false;
      if (filterMemberSet && !filterMemberSet.has(m.userId as string))
        return false;
      if (openOnly) {
        // Keep only people with at least one available-and-unassigned cell.
        const hasOpenCell = events.some((ev) => {
          const c = m.cells[ev._id as string];
          return c && c.availability === "available" && c.assignments.length === 0;
        });
        if (!hasOpenCell) return false;
      }
      return true;
    });
  }, [data, events, debouncedSearch, availableOnly, openOnly, filterMemberSet]);

  /** Open roles for an event, computed client-side (the placement menu). */
  const openRolesForEvent = useCallback(
    (event: RosterEvent): RosterRole[] => {
      if (!data) return [];
      return data.roles.filter((r) => {
        const c = roleCells[`${r.roleId}:${event._id}`];
        return c && c.open > 0;
      });
    },
    [data, roleCells],
  );

  // -------------------------------------------------------------------------
  // Publish (#477 FR-3)
  //
  // `publishEvent` notifies only *unconfirmed* assignments (confirmed people
  // are never re-pinged). We surface `event.pendingCount` straight from
  // `rosterMatrix`, which counts unconfirmed assignments off `by_plan` — the
  // exact population `markPublished` notifies. Summing `roleCells` here would
  // undercount assignments orphaned by a removed needed role (no cell exists).
  // -------------------------------------------------------------------------
  const requestCountForEvent = useCallback(
    (event: RosterEvent): number => event.pendingCount,
    [],
  );

  /** Draft event plans — the default publish target (unpublished dates). */
  const draftEvents = useMemo(
    () => events.filter((e) => e.status === "draft"),
    [events],
  );

  /** Publish a single plan, with a confirm listing its request count. */
  const publishOne = useCallback(
    async (event: RosterEvent) => {
      const count = requestCountForEvent(event);
      const dateLabel = `${weekday(event.eventDate)} ${monthDay(event.eventDate)}`;
      const already = event.status === "published";
      const ok = await confirmAsync({
        title: already ? "Re-send requests?" : "Publish & send requests?",
        message:
          `${dateLabel} — ${count} request${count === 1 ? "" : "s"} will be sent.` +
          (count > 0
            ? "\n\nConfirmed people won't be re-notified."
            : "\n\nNo one is awaiting a response on this date yet."),
        confirmText: already ? "Re-send" : "Send",
      });
      if (!ok) return;
      setPublishing(true);
      try {
        const result = await publishEvent({ planId: event._id });
        notify(
          already ? "Requests re-sent" : "Published",
          result.requestCount > 0
            ? `Sent ${result.requestCount} request${result.requestCount === 1 ? "" : "s"}.`
            : "No pending requests to send.",
        );
      } catch (e) {
        surfaceError("Couldn't publish", e);
      } finally {
        setPublishing(false);
      }
    },
    [requestCountForEvent, publishEvent, surfaceError],
  );

  /** Publish every draft plan, with a confirm listing each date + its count. */
  const publishAllDrafts = useCallback(async () => {
    if (draftEvents.length === 0) return;
    const lines = draftEvents
      .map((e) => {
        const count = requestCountForEvent(e);
        return `• ${weekday(e.eventDate)} ${monthDay(e.eventDate)} — ${count} request${count === 1 ? "" : "s"}`;
      })
      .join("\n");
    const ok = await confirmAsync({
      title: "Publish all draft dates?",
      message: `These dates will notify volunteers:\n${lines}\n\nConfirmed people won't be re-notified.`,
      confirmText: "Send",
    });
    if (!ok) return;
    setPublishing(true);
    try {
      let total = 0;
      for (const e of draftEvents) {
        const result = await publishEvent({ planId: e._id });
        total += result.requestCount;
      }
      notify(
        "Published",
        total > 0
          ? `Sent ${total} request${total === 1 ? "" : "s"} across ${draftEvents.length} date${draftEvents.length === 1 ? "" : "s"}.`
          : "No pending requests to send.",
      );
    } catch (e) {
      surfaceError("Couldn't publish", e);
    } finally {
      setPublishing(false);
    }
  }, [draftEvents, requestCountForEvent, publishEvent, surfaceError]);

  /**
   * Entry point for the Publish action. With a single date in the grid, skip
   * the chooser and publish it directly; with several, open the chooser so the
   * leader picks a date (or all drafts) — every path goes through a confirm.
   */
  const handlePublishPress = useCallback(() => {
    if (publishing) return;
    if (events.length === 1) {
      void publishOne(events[0]);
    } else {
      setPublishMenuOpen(true);
    }
  }, [publishing, events, publishOne]);

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------
  const renderHeaderBar = () => (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <TouchableOpacity
        onPress={() => router.canGoBack() && router.back()}
        hitSlop={12}
        style={styles.back}
      >
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.headerTitleWrap}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Roster</Text>
        {data && (
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            {events.length} {events.length === 1 ? "event" : "events"} ·{" "}
            {data.summary.respondedMembers}/{data.summary.totalMembers} responded
          </Text>
        )}
      </View>
      {groupId && <GridPresenceBar groupId={groupId} />}
      {/* On desktop the view toggle moves into the single toolbar row below
          (renderDesktopToolbar); on mobile it stays here in the header. */}
      {!isWide && (
        <View style={styles.segmented}>
          <SegBtn
            label="Roles"
            active={mode === "roles"}
            onPress={() => setMode("roles")}
            colors={colors}
          />
          <SegBtn
            label="People"
            active={mode === "people"}
            onPress={() => setMode("people")}
            colors={colors}
          />
        </View>
      )}
    </View>
  );

  // The shared view toggle, reused by the header (mobile) and toolbar (desktop).
  const renderViewToggle = () => (
    <View style={styles.segmented}>
      <SegBtn
        label="Roles"
        active={mode === "roles"}
        onPress={() => setMode("roles")}
        colors={colors}
      />
      <SegBtn
        label="People"
        active={mode === "people"}
        onPress={() => setMode("people")}
        colors={colors}
      />
    </View>
  );

  if (data === undefined) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        {renderHeaderBar()}
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </View>
    );
  }

  if (data.events.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        {renderHeaderBar()}
        <View style={styles.centered}>
          <EmptyState
            icon="calendar-outline"
            title="No upcoming events"
            message="Create event plans and collect availability, then place volunteers here."
          />
        </View>
      </View>
    );
  }

  // -------------------------------------------------------------------------
  // Filter controls
  //
  // The same set of chips/search render in two containers: a stacked filter bar
  // on mobile (renderFilterBar) and a single inline toolbar row on desktop
  // (renderDesktopToolbar, where Publish is right-aligned). The chip builders
  // below are shared so the two layouts can never drift.
  // -------------------------------------------------------------------------

  // Team scope — single-select dropdown (#477 FR-2). Gates the Roles view only.
  const teamChip =
    mode === "roles" && data.teams.length > 0 ? (
      <Chip
        icon="people-outline"
        label={isolatedTeamName ?? "All teams"}
        trailingIcon="chevron-down"
        active={isolatedTeamId !== null}
        onPress={() => setTeamMenuOpen(true)}
        colors={colors}
      />
    ) : null;

  const openOnlyChip = (
    <Chip
      icon={openOnly ? "checkbox" : "square-outline"}
      label="Open only"
      active={openOnly}
      onPress={() => setOpenOnly((v) => !v)}
      colors={colors}
    />
  );

  const availableOnlyChip =
    mode === "people" ? (
      <Chip
        icon={availableOnly ? "checkbox" : "square-outline"}
        label="Available only"
        active={availableOnly}
        onPress={() => setAvailableOnly((v) => !v)}
        colors={colors}
      />
    ) : null;

  // "Also in group" is now a GRID-LEVEL scope (#477 FR-4): set once here, it
  // narrows the People view rows AND seeds the assign sheet's candidate pool.
  // Shown in both views; hidden when the leader has no other eligible groups.
  const groupScopeChip =
    filterGroups && filterGroups.length > 0 ? (
      <Chip
        icon="funnel"
        label={filterGroupName ? `In: ${filterGroupName}` : "Also in group"}
        trailingIcon="chevron-down"
        active={filterGroupId !== null}
        onPress={() => setGroupFilterOpen(true)}
        colors={colors}
      />
    ) : null;

  const renderSearchBox = () =>
    mode === "people" ? (
      <View style={[styles.searchBox, { borderColor: colors.border }]}>
        <Ionicons name="search" size={15} color={colors.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search people…"
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>
    ) : null;

  const renderFilterBar = () => (
    <View style={[styles.filterBar, { borderBottomColor: colors.border }]}>
      <View style={styles.chipRow}>
        {teamChip}
        {openOnlyChip}
        {availableOnlyChip}
        {groupScopeChip}
      </View>
      {renderSearchBox()}
    </View>
  );

  // Desktop: one horizontal toolbar row — view toggle, filters, then Publish
  // pinned right. Replaces both the header toggle and the stacked filter bar.
  const renderDesktopToolbar = () => (
    <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
      {renderViewToggle()}
      {teamChip}
      {groupScopeChip}
      {openOnlyChip}
      {availableOnlyChip}
      {mode === "people" && <View style={styles.toolbarSearch}>{renderSearchBox()}</View>}
      <View style={styles.toolbarSpacer} />
      {renderPublishButton(false)}
    </View>
  );

  const renderLegend = () => (
    <View style={styles.legend}>
      <LegendItem icon="checkmark" color={colors.success} label="Confirmed" colors={colors} />
      <LegendItem icon="time-outline" color={colors.warning} label="Awaiting" colors={colors} />
      <LegendItem icon="close" color={colors.destructive} label="Declined" colors={colors} />
      <LegendItem icon="ellipse-outline" color={colors.textTertiary} label="Open" colors={colors} />
      <LegendItem icon="warning" color={colors.warning} label="Double-booked" colors={colors} />
    </View>
  );

  // -------------------------------------------------------------------------
  // Header row of event columns (shared by both views)
  // -------------------------------------------------------------------------
  const renderHeaderRow = (cornerLabel: string) => (
    <View style={[styles.matrixHeaderRow, { borderBottomColor: colors.border }]}>
      <View
        style={[
          styles.corner,
          { width: NAME_W, height: HEADER_H, backgroundColor: colors.surface },
        ]}
      >
        <Text style={[styles.cornerText, { color: colors.textSecondary }]}>
          {cornerLabel}
        </Text>
      </View>
      <ScrollView
        ref={headerScrollRef}
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
      >
        <View style={styles.row}>
          {events.map((ev) => {
            const c = data.eventCounts[ev._id as string];
            const open = c?.openSlots ?? 0;
            return (
              <View
                key={ev._id}
                style={[
                  styles.headerCell,
                  { width: CELL_W, height: HEADER_H, borderLeftColor: colors.border },
                ]}
              >
                <Text
                  style={[styles.headerCellTitle, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {ev.title}
                </Text>
                <Text style={[styles.headerCellWk, { color: colors.textSecondary }]}>
                  {weekday(ev.eventDate)}
                </Text>
                <Text style={[styles.headerCellDate, { color: colors.text }]}>
                  {monthDay(ev.eventDate)}
                </Text>
                <View style={styles.headerCellTally}>
                  {mode === "roles" ? (
                    open > 0 ? (
                      <>
                        <Ionicons name="ellipse-outline" size={10} color={colors.textTertiary} />
                        <Text style={[styles.headerCellTallyText, { color: colors.textTertiary }]}>
                          {open}
                        </Text>
                      </>
                    ) : (
                      <Ionicons name="checkmark" size={12} color={colors.success} />
                    )
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={11} color={colors.success} />
                      <Text style={[styles.headerCellTallyText, { color: colors.success }]}>
                        {c?.available ?? 0}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );

  // -------------------------------------------------------------------------
  // ROLE VIEW — frozen column rows (team section header + role rows)
  // -------------------------------------------------------------------------
  const renderRoleFrozen = () => (
    <ScrollView
      ref={frozenScrollRef}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      // Pin the frozen column to NAME_W. On RN-Web a bare ScrollView defaults to
      // flexGrow:1/flexBasis:0%, which overrides `width` and lets the column
      // grow to fill the body — knocking the data cells out of line with their
      // event-date headers. flexGrow/Shrink:0 + flexBasis hold it to NAME_W.
      style={{ width: NAME_W, flexGrow: 0, flexShrink: 0, flexBasis: NAME_W }}
    >
      {roleRows.map((r, i) => {
        if (r.kind === "section") {
          return (
            <View
              key={`sec-${r.teamId}`}
              style={[
                styles.sectionCell,
                { width: NAME_W, height: SECTION_H, backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionText, { color: colors.textSecondary }]} numberOfLines={1}>
                {r.teamName.toUpperCase()}
              </Text>
            </View>
          );
        }
        const coveredCount = events.reduce((n, ev) => {
          const c = roleCells[`${r.role.roleId}:${ev._id}`];
          return n + (c && c.needed > 0 && c.open === 0 ? 1 : 0);
        }, 0);
        return (
          <View
            key={r.role.roleId}
            style={[
              styles.nameCell,
              {
                width: NAME_W,
                height: ROW_H,
                backgroundColor: i % 2 === 0 ? colors.surface : colors.surfaceSecondary,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View style={styles.nameTextWrap}>
              <Text style={[styles.nameText, { color: colors.text }]} numberOfLines={1}>
                {r.role.roleName}
              </Text>
              <Text style={[styles.subCount, { color: colors.textTertiary }]}>
                covered {coveredCount}/{events.length}
              </Text>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );

  const renderRoleCells = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      onScroll={onCellsHScroll}
      scrollEventThrottle={16}
    >
      <ScrollView
        style={{ height: bodyH }}
        showsVerticalScrollIndicator
        onScroll={onCellsVScroll}
        scrollEventThrottle={16}
      >
        {roleRows.map((r, i) => {
          if (r.kind === "section") {
            return (
              <View
                key={`sec-${r.teamId}`}
                style={[
                  styles.row,
                  { height: SECTION_H, backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              />
            );
          }
          return (
            <View key={r.role.roleId} style={styles.row}>
              {events.map((ev) => (
                <RoleCellView
                  key={ev._id}
                  cell={roleCells[`${r.role.roleId}:${ev._id}`]}
                  width={CELL_W}
                  height={ROW_H}
                  striped={i % 2 !== 0}
                  colors={colors}
                  onPress={() => {
                    const cell = roleCells[`${r.role.roleId}:${ev._id}`];
                    if (!cell) return;
                    if (cell.occupants.length === 0) {
                      openAssign({
                        planId: ev._id,
                        planStatus: ev.status,
                        teamId: r.role.teamId,
                        roleId: r.role.roleId,
                        roleName: r.role.roleName,
                        timeLabel: singleTimeLabel(ev),
                        assignedUserIds: new Set(),
                        keepOpenWhileUnfilled: cell.needed > 1,
                      });
                    } else {
                      openRoleCell({ role: r.role, event: ev });
                    }
                  }}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>
    </ScrollView>
  );

  // -------------------------------------------------------------------------
  // PEOPLE VIEW
  // -------------------------------------------------------------------------
  const renderPeopleFrozen = () => (
    <ScrollView
      ref={frozenScrollRef}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      // See renderRoleFrozen: pin to NAME_W so RN-Web's ScrollView flex defaults
      // don't let the frozen column grow and misalign the data cells.
      style={{ width: NAME_W, flexGrow: 0, flexShrink: 0, flexBasis: NAME_W }}
    >
      {visibleMembers.map((m, i) => {
        const heavy = m.load >= Math.ceil(events.length / 2);
        return (
          <View
            key={m.userId}
            style={[
              styles.nameCell,
              {
                width: NAME_W,
                height: ROW_H,
                backgroundColor: i % 2 === 0 ? colors.surface : colors.surfaceSecondary,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View style={styles.nameTextWrap}>
              <View style={styles.nameInline}>
                <Text style={[styles.nameText, { color: colors.text }]} numberOfLines={1}>
                  {m.userName}
                </Text>
                {m.isLeader && (
                  <Text style={[styles.leaderTag, { color: colors.textTertiary }]}>Leader</Text>
                )}
              </View>
              <View style={styles.nameInline}>
                <Text style={[styles.subCount, { color: colors.success }]}>
                  ✓{m.availableCount}/{events.length}
                </Text>
                <Text style={[styles.subCount, { color: heavy ? colors.warning : colors.textTertiary }]}>
                  {heavy ? "⚠ " : ""}
                  {m.load} srv
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );

  const renderPeopleCells = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      onScroll={onCellsHScroll}
      scrollEventThrottle={16}
    >
      <ScrollView
        style={{ height: bodyH }}
        showsVerticalScrollIndicator
        onScroll={onCellsVScroll}
        scrollEventThrottle={16}
      >
        {visibleMembers.map((m, i) => (
          <View key={m.userId} style={styles.row}>
            {events.map((ev) => {
              const cell = m.cells[ev._id as string];
              return (
                <PeopleCellView
                  key={ev._id}
                  cell={cell}
                  width={CELL_W}
                  height={ROW_H}
                  striped={i % 2 !== 0}
                  colors={colors}
                  onPress={() => {
                    if (cell && cell.assignments.length > 0) {
                      openMemberCell({ member: m, event: ev });
                    } else {
                      setOpenRolesModal({
                        member: m,
                        event: ev,
                        note:
                          cell?.availability === "unavailable"
                            ? "Marked unavailable"
                            : undefined,
                      });
                    }
                  }}
                />
              );
            })}
          </View>
        ))}
      </ScrollView>
    </ScrollView>
  );

  const rows = mode === "roles" ? roleRows.length : visibleMembers.length;
  const cornerLabel =
    mode === "roles"
      ? `${visibleRoles.length} ${visibleRoles.length === 1 ? "role" : "roles"}`
      : `${visibleMembers.length} ${visibleMembers.length === 1 ? "person" : "people"}`;

  // Publish button label (#477 FR-3). One event → name the date; several with
  // drafts left → generic; all published → "Re-send". Anyone who can see this
  // grid is a scheduler (rosterMatrix requires it), so the action is always
  // permission-appropriate — no extra gate needed.
  const allPublished = events.length > 0 && draftEvents.length === 0;
  const publishLabel =
    events.length === 1
      ? allPublished
        ? `Re-send · ${monthDay(events[0].eventDate)}`
        : `Publish & send · ${monthDay(events[0].eventDate)}`
      : allPublished
        ? "Re-send requests"
        : "Publish & send requests";

  /**
   * The Publish CTA. Rendered two ways: `compact` (desktop toolbar — inline,
   * auto-width, right-aligned) and full-bleed (mobile sticky bottom bar).
   * Same action and label both ways. Layout lives on the inner static View so
   * RN-Web doesn't drop it (Pressable function-style is ignored on web).
   */
  const renderPublishButton = (full: boolean) => (
    <Pressable
      onPress={handlePublishPress}
      disabled={publishing}
      accessibilityRole="button"
      accessibilityLabel={publishLabel}
    >
      <View
        style={[
          styles.publishBtn,
          full ? styles.publishBtnFull : styles.publishBtnCompact,
          { backgroundColor: primaryColor, opacity: publishing ? 0.7 : 1 },
        ]}
      >
        {publishing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <View style={styles.publishBtnContent}>
            {!full && (
              <Ionicons name="paper-plane" size={15} color="#fff" />
            )}
            <Text
              style={[styles.publishBtnText, full && styles.publishBtnTextFull]}
              numberOfLines={1}
            >
              {publishLabel}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
      {renderHeaderBar()}
      {isWide ? renderDesktopToolbar() : renderFilterBar()}
      {renderLegend()}

      {/* On desktop the grid and the docked assign panel share a row so the
          grid stays visible beside the panel; on mobile the grid takes the
          full width and AssignSheet overlays as a modal (below). */}
      <View style={isWide ? styles.contentRowWide : styles.contentColumn}>
        <View style={styles.gridArea}>
          {renderHeaderRow(cornerLabel)}
          <View
            style={styles.matrixBody}
            onLayout={(e) => {
              setBodyH(e.nativeEvent.layout.height);
              setBodyW(e.nativeEvent.layout.width);
            }}
          >
            {rows === 0 ? (
              <View style={styles.centered}>
                <Text style={{ color: colors.textSecondary }}>
                  {mode === "roles" ? "No roles to show." : "No one to show."}
                </Text>
              </View>
            ) : mode === "roles" ? (
              <>
                {renderRoleFrozen()}
                {renderRoleCells()}
              </>
            ) : (
              <>
                {renderPeopleFrozen()}
                {renderPeopleCells()}
              </>
            )}
          </View>
        </View>

        {/* Desktop: docked right side-panel — stays open after assigning so a
            leader can fill a whole column. Mobile renders AssignSheet as a
            modal below instead. */}
        {isWide && assignTarget && (
          <AssignSheet
            visible
            dockedRight
            planId={assignTarget.planId}
            planStatus={assignTarget.planStatus}
            groupId={groupId}
            teamId={assignTarget.teamId}
            roleId={assignTarget.roleId}
            roleName={assignTarget.roleName}
            timeLabel={assignTarget.timeLabel}
            assignedUserIds={assignTarget.assignedUserIds}
            prioritizeAvailable
            keepOpenWhileUnfilled={assignTarget.keepOpenWhileUnfilled}
            filterMemberIds={filterMemberSet}
            filterGroupName={filterGroupName}
            onClose={() => setAssignTarget(null)}
          />
        )}

        {/* Desktop: filled-cell management docks in the SAME right region as
            the assign panel (mutually exclusive — only one is ever non-null, see
            openAssign/openRoleCell/openMemberCell). Mobile renders these as
            popover modals below. */}
        {isWide && roleCellModal && (
          <RoleCellPopover
            role={roleCellModal.role}
            event={roleCellModal.event}
            cell={roleCells[`${roleCellModal.role.roleId}:${roleCellModal.event._id}`]}
            colors={colors}
            docked
            onRemove={handleUnassign}
            onAddSomeone={(cell) => {
              const role = roleCellModal.role;
              const ev = roleCellModal.event;
              openAssign({
                planId: ev._id,
                planStatus: ev.status,
                teamId: role.teamId,
                roleId: role.roleId,
                roleName: role.roleName,
                timeLabel: singleTimeLabel(ev),
                assignedUserIds: new Set(cell.occupants.map((o) => o.userId as string)),
                keepOpenWhileUnfilled: cell.open > 1,
              });
            }}
            onClose={() => setRoleCellModal(null)}
          />
        )}

        {isWide && memberCellModal && (
          <MemberCellPopover
            member={memberCellModal.member}
            event={memberCellModal.event}
            cell={memberCellModal.member.cells[memberCellModal.event._id as string]}
            colors={colors}
            docked
            onRemove={handleUnassign}
            onAddRole={() => {
              const m = memberCellModal.member;
              const ev = memberCellModal.event;
              setMemberCellModal(null);
              setOpenRolesModal({ member: m, event: ev });
            }}
            onClose={() => setMemberCellModal(null)}
          />
        )}
      </View>

      {/* Publish bar — MOBILE only (#477 FR-3); desktop hosts Publish in the
          toolbar (renderDesktopToolbar). Scoped to a chosen date via the
          chooser; single-date grids publish that date directly. */}
      {!isWide && (
        <View
          style={[
            styles.publishBar,
            {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          {renderPublishButton(true)}
        </View>
      )}

      {/* ===== Modals ===== */}
      {/* Mobile: AssignSheet as a centered modal overlay. (Desktop docks it in
          the content row above.) */}
      {!isWide && assignTarget && (
        <AssignSheet
          visible
          planId={assignTarget.planId}
          planStatus={assignTarget.planStatus}
          groupId={groupId}
          teamId={assignTarget.teamId}
          roleId={assignTarget.roleId}
          roleName={assignTarget.roleName}
          timeLabel={assignTarget.timeLabel}
          assignedUserIds={assignTarget.assignedUserIds}
          prioritizeAvailable
          keepOpenWhileUnfilled={assignTarget.keepOpenWhileUnfilled}
          filterMemberIds={filterMemberSet}
          filterGroupName={filterGroupName}
          onClose={() => setAssignTarget(null)}
        />
      )}

      {/* Mobile: filled-cell management as popover modals. (Desktop docks them
          in the content row above.) */}
      {!isWide && roleCellModal && (
        <RoleCellPopover
          role={roleCellModal.role}
          event={roleCellModal.event}
          cell={roleCells[`${roleCellModal.role.roleId}:${roleCellModal.event._id}`]}
          colors={colors}
          onRemove={handleUnassign}
          onAddSomeone={(cell) => {
            const role = roleCellModal.role;
            const ev = roleCellModal.event;
            setRoleCellModal(null);
            setAssignTarget({
              planId: ev._id,
              planStatus: ev.status,
              teamId: role.teamId,
              roleId: role.roleId,
              roleName: role.roleName,
              timeLabel: singleTimeLabel(ev),
              assignedUserIds: new Set(cell.occupants.map((o) => o.userId as string)),
              keepOpenWhileUnfilled: cell.open > 1,
            });
          }}
          onClose={() => setRoleCellModal(null)}
        />
      )}

      {!isWide && memberCellModal && (
        <MemberCellPopover
          member={memberCellModal.member}
          event={memberCellModal.event}
          cell={memberCellModal.member.cells[memberCellModal.event._id as string]}
          colors={colors}
          onRemove={handleUnassign}
          onAddRole={() => {
            const m = memberCellModal.member;
            const ev = memberCellModal.event;
            setMemberCellModal(null);
            setOpenRolesModal({ member: m, event: ev });
          }}
          onClose={() => setMemberCellModal(null)}
        />
      )}

      {openRolesModal && (
        <OpenRolesMenu
          member={openRolesModal.member}
          event={openRolesModal.event}
          note={openRolesModal.note}
          roles={openRolesForEvent(openRolesModal.event)}
          roleCells={roleCells}
          colors={colors}
          onPick={(role) =>
            handleQuickAssign(role, openRolesModal.event, openRolesModal.member)
          }
          onClose={() => setOpenRolesModal(null)}
        />
      )}

      {groupFilterOpen && (
        <GroupFilterMenu
          groups={filterGroups ?? []}
          selectedId={filterGroupId}
          colors={colors}
          onPick={(id) => {
            setFilterGroupId(id);
            setGroupFilterOpen(false);
          }}
          onClose={() => setGroupFilterOpen(false)}
        />
      )}

      {teamMenuOpen && (
        <TeamFilterMenu
          teams={data.teams}
          selectedId={isolatedTeamId}
          colors={colors}
          onPick={(id) => {
            setIsolatedTeamId(id);
            setTeamMenuOpen(false);
          }}
          onClose={() => setTeamMenuOpen(false)}
        />
      )}

      {publishMenuOpen && (
        <PublishMenu
          events={events}
          draftCount={draftEvents.length}
          requestCountForEvent={requestCountForEvent}
          colors={colors}
          onPublishOne={(event) => {
            setPublishMenuOpen(false);
            void publishOne(event);
          }}
          onPublishAll={() => {
            setPublishMenuOpen(false);
            void publishAllDrafts();
          }}
          onClose={() => setPublishMenuOpen(false)}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Cell renderers
// ---------------------------------------------------------------------------
function RoleCellView({
  cell,
  width,
  height,
  striped,
  colors,
  onPress,
}: {
  cell: RoleCell | undefined;
  width: number;
  height: number;
  striped: boolean;
  colors: Colors;
  onPress: () => void;
}) {
  const base = striped ? colors.surfaceSecondary : colors.surface;

  // Role not needed this event → dim, non-interactive placeholder.
  if (!cell || cell.needed === 0) {
    return (
      <View
        style={[
          styles.cell,
          { width, height, backgroundColor: base, borderColor: colors.border, opacity: 0.45 },
        ]}
      >
        <Text style={[styles.cellMuted, { color: colors.textTertiary }]}>·</Text>
      </View>
    );
  }

  // Show the rostered people as avatars (status-ringed), plus a dashed "+"
  // chip for each still-open slot. Coverage is conveyed by who's in the cell —
  // the role's row header carries the textual "covered X/Y".
  const AV = 22;
  const MAX_AVATARS = 2;
  const visible = cell.occupants.slice(0, MAX_AVATARS);
  const overflow = cell.occupants.length - visible.length;

  // Subtle cell tint mirrors the legend: green when fully confirmed, amber
  // when filled-but-awaiting, neutral when a slot is still open.
  const fullyConfirmed = cell.open === 0 && cell.confirmed === cell.needed;
  const bg = cell.open > 0 ? base : fullyConfirmed ? colors.success + "14" : colors.warning + "14";

  return (
    <Pressable
      onPress={onPress}
      style={[styles.cell, { width, height, backgroundColor: bg, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={
        cell.occupants.length > 0
          ? `${cell.occupants.map((o) => o.userName).join(", ")}${
              cell.open > 0 ? `, ${cell.open} open` : ""
            }`
          : `${cell.open} open — tap to assign`
      }
    >
      <View style={styles.cellAvatars}>
        {visible.map((o, idx) => (
          <View
            key={o.assignmentId}
            style={[
              styles.avatarRing,
              {
                borderColor: statusColor(o.status, colors),
                backgroundColor: colors.surface,
                marginLeft: idx === 0 ? 0 : -7,
              },
            ]}
          >
            <Avatar name={o.userName} imageUrl={o.profilePhoto} size={AV} />
          </View>
        ))}
        {overflow > 0 && (
          <View
            style={[
              styles.avatarRing,
              styles.overflowChip,
              { borderColor: colors.border, backgroundColor: colors.surfaceSecondary, marginLeft: -7 },
            ]}
          >
            <Text style={[styles.overflowText, { color: colors.textSecondary }]}>
              +{overflow}
            </Text>
          </View>
        )}
        {/* One dashed chip stands for the open slots; when more than one is
            open it shows the count so a multi-person role doesn't read as a
            single empty slot. */}
        {cell.open > 0 && (
          <View
            style={[
              styles.openSlot,
              {
                borderColor: colors.textTertiary,
                marginLeft: visible.length > 0 || overflow > 0 ? -7 : 0,
              },
            ]}
          >
            {cell.open > 1 ? (
              <Text style={[styles.openSlotCount, { color: colors.textTertiary }]}>
                {cell.open}
              </Text>
            ) : (
              <Ionicons name="add" size={13} color={colors.textTertiary} />
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

function PeopleCellView({
  cell,
  width,
  height,
  striped,
  colors,
  onPress,
}: {
  cell: MemberCell | undefined;
  width: number;
  height: number;
  striped: boolean;
  colors: Colors;
  onPress: () => void;
}) {
  const base = striped ? colors.surfaceSecondary : colors.surface;

  if (cell && cell.assignments.length > 0) {
    const status = worstStatus(cell.assignments);
    const tint = statusColor(status, colors);
    const first = cell.assignments[0].roleName;
    const extra = cell.assignments.length - 1;
    return (
      <Pressable
        onPress={onPress}
        style={[styles.cell, { width, height, backgroundColor: tint + "22", borderColor: colors.border }]}
        accessibilityRole="button"
      >
        <Text style={[styles.cellRole, { color: tint }]} numberOfLines={1}>
          {first}
          {extra > 0 ? ` +${extra}` : ""}
        </Text>
        {cell.doubleBooked && (
          <Ionicons name="warning" size={11} color={colors.warning} style={styles.cellCorner} />
        )}
      </Pressable>
    );
  }

  const availability = cell?.availability ?? "no_response";
  if (availability === "available") {
    return (
      <Pressable
        onPress={onPress}
        style={[styles.cell, { width, height, backgroundColor: colors.success + "12", borderColor: colors.border }]}
        accessibilityRole="button"
      >
        <View style={styles.cellInner}>
          <Ionicons name="ellipse-outline" size={11} color={colors.success} />
          <Text style={[styles.cellAv, { color: colors.success }]}>av</Text>
        </View>
      </Pressable>
    );
  }
  if (availability === "unavailable") {
    return (
      <Pressable
        onPress={onPress}
        style={[styles.cell, { width, height, backgroundColor: colors.destructive + "10", borderColor: colors.border }]}
        accessibilityRole="button"
      >
        <Ionicons name="close" size={13} color={colors.destructive} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={[styles.cell, { width, height, backgroundColor: base, borderColor: colors.border }]}
      accessibilityRole="button"
    >
      <Text style={[styles.cellMuted, { color: colors.textTertiary }]}>—</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Popovers / menus
// ---------------------------------------------------------------------------
/**
 * Shared header + body container for the cell popovers/menus. On mobile (and
 * for the picker menus) it's a centered card over a dim backdrop (`Modal`). On
 * desktop, when `docked`, the SAME header+children render inside the grid's
 * right side-panel (no Modal, no backdrop) so filled-cell management matches
 * the docked AssignSheet — one panel idiom, never a floating popup beside it.
 */
function ModalShell({
  title,
  subtitle,
  colors,
  onClose,
  docked = false,
  children,
}: {
  title: string;
  subtitle?: string;
  colors: Colors;
  onClose: () => void;
  docked?: boolean;
  children: React.ReactNode;
}) {
  const head = (
    <View style={styles.popoverHead}>
      <View style={styles.popoverHeadText}>
        <Text style={[styles.popoverTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.popoverSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <TouchableOpacity onPress={onClose} hitSlop={12}>
        <Ionicons name="close" size={22} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  if (docked) {
    return (
      <View
        style={[
          styles.dockPanel,
          { backgroundColor: colors.surface, borderLeftColor: colors.border },
        ]}
      >
        <View style={styles.dockPanelInner}>
          {head}
          {children}
        </View>
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.popover, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {head}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RoleCellPopover({
  role,
  event,
  cell,
  colors,
  docked = false,
  onRemove,
  onAddSomeone,
  onClose,
}: {
  role: RosterRole;
  event: RosterEvent;
  cell: RoleCell | undefined;
  colors: Colors;
  docked?: boolean;
  onRemove: (id: Id<"roleAssignments">) => void;
  onAddSomeone: (cell: RoleCell) => void;
  onClose: () => void;
}) {
  if (!cell) return null;
  return (
    <ModalShell
      title={role.roleName}
      subtitle={`${role.teamName} · ${monthDay(event.eventDate)} · ${cell.filled}/${cell.needed}`}
      colors={colors}
      docked={docked}
      onClose={onClose}
    >
      <ScrollView style={docked ? styles.popoverListDocked : styles.popoverList}>
        {cell.occupants.map((o) => (
          <View key={o.assignmentId} style={[styles.occupantRow, { borderBottomColor: colors.border }]}>
            <Ionicons name={statusIcon(o.status)} size={16} color={statusColor(o.status, colors)} />
            <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
              {o.userName}
            </Text>
            <TouchableOpacity onPress={() => onRemove(o.assignmentId)} hitSlop={8}>
              <Text style={[styles.removeText, { color: colors.destructive }]}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
      {cell.open > 0 && (
        <Pressable
          onPress={() => onAddSomeone(cell)}
          style={[styles.addBtn, { borderColor: colors.link }]}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={18} color={colors.link} />
          <Text style={[styles.addBtnText, { color: colors.link }]}>Add someone</Text>
        </Pressable>
      )}
    </ModalShell>
  );
}

function MemberCellPopover({
  member,
  event,
  cell,
  colors,
  docked = false,
  onRemove,
  onAddRole,
  onClose,
}: {
  member: RosterMember;
  event: RosterEvent;
  cell: MemberCell | undefined;
  colors: Colors;
  docked?: boolean;
  onRemove: (id: Id<"roleAssignments">) => void;
  onAddRole: () => void;
  onClose: () => void;
}) {
  if (!cell) return null;
  return (
    <ModalShell
      title={member.userName}
      subtitle={`${event.title} · ${monthDay(event.eventDate)}`}
      colors={colors}
      docked={docked}
      onClose={onClose}
    >
      {cell.doubleBooked && (
        <Text style={[styles.noteLine, { color: colors.warning }]}>
          ⚠ Double-booked this day
        </Text>
      )}
      <ScrollView style={docked ? styles.popoverListDocked : styles.popoverList}>
        {cell.assignments.map((a) => (
          <View key={a.assignmentId} style={[styles.occupantRow, { borderBottomColor: colors.border }]}>
            <Ionicons name={statusIcon(a.status)} size={16} color={statusColor(a.status, colors)} />
            <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
              {a.roleName}
            </Text>
            <TouchableOpacity onPress={() => onRemove(a.assignmentId)} hitSlop={8}>
              <Text style={[styles.removeText, { color: colors.destructive }]}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
      <Pressable
        onPress={onAddRole}
        style={[styles.addBtn, { borderColor: colors.link }]}
        accessibilityRole="button"
      >
        <Ionicons name="add" size={18} color={colors.link} />
        <Text style={[styles.addBtnText, { color: colors.link }]}>Add role</Text>
      </Pressable>
    </ModalShell>
  );
}

function OpenRolesMenu({
  member,
  event,
  note,
  roles,
  roleCells,
  colors,
  onPick,
  onClose,
}: {
  member: RosterMember;
  event: RosterEvent;
  note?: string;
  roles: RosterRole[];
  roleCells: Record<string, RoleCell>;
  colors: Colors;
  onPick: (role: RosterRole) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell
      title={`Place ${member.userName}`}
      subtitle={`${event.title} · ${monthDay(event.eventDate)}`}
      colors={colors}
      onClose={onClose}
    >
      {note && <Text style={[styles.noteLine, { color: colors.destructive }]}>{note}</Text>}
      {roles.length === 0 ? (
        <Text style={[styles.menuEmpty, { color: colors.textSecondary }]}>
          No open roles on this date.
        </Text>
      ) : (
        <ScrollView style={styles.popoverList}>
          {roles.map((role) => {
            const c = roleCells[`${role.roleId}:${event._id}`];
            return (
              <Pressable
                key={role.roleId}
                onPress={() => onPick(role)}
                style={[styles.menuRow, { borderBottomColor: colors.border }]}
                accessibilityRole="button"
              >
                <View style={styles.menuRowText}>
                  <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
                    {role.roleName}
                  </Text>
                  <Text style={[styles.menuRowSub, { color: colors.textTertiary }]} numberOfLines={1}>
                    {role.teamName}
                  </Text>
                </View>
                <Text style={[styles.menuRowCount, { color: colors.textSecondary }]}>
                  {c ? `${c.filled}/${c.needed}` : ""}
                </Text>
                <Ionicons name="add-circle" size={20} color={colors.link} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </ModalShell>
  );
}

/**
 * "Also in group" picker — narrows the People view to members who also belong
 * to one of the leader's other groups. "Everyone" clears the filter.
 */
function GroupFilterMenu({
  groups,
  selectedId,
  colors,
  onPick,
  onClose,
}: {
  groups: Array<{ id: Id<"groups">; name: string }>;
  selectedId: Id<"groups"> | null;
  colors: Colors;
  onPick: (id: Id<"groups"> | null) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell
      title="Also in group"
      subtitle="Show only people who are also in…"
      colors={colors}
      onClose={onClose}
    >
      <ScrollView style={styles.popoverList}>
        <Pressable
          onPress={() => onPick(null)}
          style={[styles.menuRow, { borderBottomColor: colors.border }]}
          accessibilityRole="button"
        >
          <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
            Everyone
          </Text>
          {selectedId === null && (
            <Ionicons name="checkmark" size={20} color={colors.link} />
          )}
        </Pressable>
        {groups.map((g) => (
          <Pressable
            key={g.id}
            onPress={() => onPick(g.id)}
            style={[styles.menuRow, { borderBottomColor: colors.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
              {g.name}
            </Text>
            {selectedId === g.id && (
              <Ionicons name="checkmark" size={20} color={colors.link} />
            )}
          </Pressable>
        ))}
      </ScrollView>
    </ModalShell>
  );
}

/**
 * Team scope picker (#477 FR-2) — a single-select menu that isolates one
 * team's roles in the Roles view. "All teams" clears the scope.
 */
function TeamFilterMenu({
  teams,
  selectedId,
  colors,
  onPick,
  onClose,
}: {
  teams: RosterTeam[];
  selectedId: string | null;
  colors: Colors;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell
      title="Teams"
      subtitle="Show roles for…"
      colors={colors}
      onClose={onClose}
    >
      <ScrollView style={styles.popoverList}>
        <Pressable
          onPress={() => onPick(null)}
          style={[styles.menuRow, { borderBottomColor: colors.border }]}
          accessibilityRole="button"
        >
          <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
            All teams
          </Text>
          {selectedId === null && (
            <Ionicons name="checkmark" size={20} color={colors.link} />
          )}
        </Pressable>
        {teams.map((t) => (
          <Pressable
            key={t.teamId}
            onPress={() => onPick(t.teamId as string)}
            style={[styles.menuRow, { borderBottomColor: colors.border }]}
            accessibilityRole="button"
          >
            <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
              {t.teamName}
            </Text>
            {selectedId === (t.teamId as string) && (
              <Ionicons name="checkmark" size={20} color={colors.link} />
            )}
          </Pressable>
        ))}
      </ScrollView>
    </ModalShell>
  );
}

/**
 * Publish chooser (#477 FR-3) — when the grid spans multiple dates, the leader
 * picks which date to publish (each row shows its pending request count), or
 * publishes all draft dates at once. Single-date grids skip this and publish
 * directly. Every path runs through a confirm dialog before notifying anyone.
 */
function PublishMenu({
  events,
  draftCount,
  requestCountForEvent,
  colors,
  onPublishOne,
  onPublishAll,
  onClose,
}: {
  events: RosterEvent[];
  draftCount: number;
  requestCountForEvent: (event: RosterEvent) => number;
  colors: Colors;
  onPublishOne: (event: RosterEvent) => void;
  onPublishAll: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell
      title="Publish & send"
      subtitle="Pick a date to send requests for"
      colors={colors}
      onClose={onClose}
    >
      <ScrollView style={styles.popoverList}>
        {events.map((ev) => {
          const count = requestCountForEvent(ev);
          const published = ev.status === "published";
          return (
            <Pressable
              key={ev._id}
              onPress={() => onPublishOne(ev)}
              style={[styles.menuRow, { borderBottomColor: colors.border }]}
              accessibilityRole="button"
            >
              <View style={styles.menuRowText}>
                <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
                  {weekday(ev.eventDate)} {monthDay(ev.eventDate)}
                </Text>
                <Text style={[styles.menuRowSub, { color: colors.textTertiary }]} numberOfLines={1}>
                  {published ? "Published · " : ""}
                  {count} request{count === 1 ? "" : "s"}
                </Text>
              </View>
              <Text style={[styles.menuRowCount, { color: colors.link }]}>
                {published ? "Re-send" : "Send"}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {draftCount > 1 && (
        <Pressable
          onPress={onPublishAll}
          style={[styles.addBtn, { borderColor: colors.link }]}
          accessibilityRole="button"
        >
          <Ionicons name="paper-plane-outline" size={16} color={colors.link} />
          <Text style={[styles.addBtnText, { color: colors.link }]}>
            Publish all draft dates ({draftCount})
          </Text>
        </Pressable>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Small shared UI
// ---------------------------------------------------------------------------
function SegBtn({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: Colors;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.segBtn,
        { backgroundColor: active ? colors.surface : "transparent" },
        active && styles.segBtnActive,
      ]}
    >
      <Text style={[styles.segBtnText, { color: active ? colors.text : colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Chip({
  icon,
  trailingIcon,
  label,
  active,
  onPress,
  colors,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional icon after the label — e.g. a chevron marking a dropdown. */
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  colors: Colors;
}) {
  const tint = active ? colors.link : colors.textSecondary;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? colors.link : colors.border,
          backgroundColor: active ? colors.link + "18" : "transparent",
        },
      ]}
    >
      {icon && <Ionicons name={icon} size={14} color={tint} />}
      <Text style={[styles.chipText, { color: tint }]}>{label}</Text>
      {trailingIcon && <Ionicons name={trailingIcon} size={13} color={tint} />}
    </Pressable>
  );
}

function LegendItem({
  icon,
  color,
  label,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  colors: Colors;
}) {
  return (
    <View style={styles.legendItem}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.legendText, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  back: { width: 36, padding: 4 },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerSub: { fontSize: 12, marginTop: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  segmented: {
    flexDirection: "row",
    borderRadius: 9,
    padding: 2,
    backgroundColor: "rgba(120,120,128,0.12)",
  },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
  segBtnActive: {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segBtnText: { fontSize: 13, fontWeight: "600" },
  filterBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexWrap: "wrap",
  },
  toolbarSearch: { width: 220 },
  toolbarSpacer: { flexGrow: 1 },
  contentColumn: { flex: 1 },
  contentRowWide: { flex: 1, flexDirection: "row" },
  gridArea: { flex: 1, minWidth: 0 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 2 },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 11 },
  matrixHeaderRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  corner: { justifyContent: "flex-end", paddingHorizontal: 12, paddingBottom: 8 },
  cornerText: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row" },
  headerCell: {
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 6,
    paddingHorizontal: 2,
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 1,
  },
  headerCellTitle: { fontSize: 9, maxWidth: "100%" },
  headerCellWk: { fontSize: 10 },
  headerCellDate: { fontSize: 13, fontWeight: "700" },
  headerCellTally: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 1 },
  headerCellTallyText: { fontSize: 11, fontWeight: "700" },
  matrixBody: { flex: 1, flexDirection: "row" },
  sectionCell: {
    justifyContent: "center",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  nameCell: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  nameTextWrap: { flex: 1, minWidth: 0 },
  nameInline: { flexDirection: "row", alignItems: "center", gap: 6 },
  nameText: { fontSize: 14, fontWeight: "500", flexShrink: 1 },
  leaderTag: { fontSize: 10 },
  subCount: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  cell: {
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cellInner: { flexDirection: "row", alignItems: "center", gap: 3 },
  cellAvatars: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  avatarRing: {
    borderWidth: 1.5,
    borderRadius: 999,
    padding: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  overflowChip: { width: 26, height: 26 },
  overflowText: { fontSize: 10, fontWeight: "700" },
  openSlot: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  openSlotCount: { fontSize: 12, fontWeight: "700" },
  cellRole: { fontSize: 11, fontWeight: "600", paddingHorizontal: 3, textAlign: "center" },
  cellAv: { fontSize: 11, fontWeight: "700" },
  cellMuted: { fontSize: 13 },
  cellCorner: { position: "absolute", top: 2, right: 3 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  popover: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "80%",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  // Desktop docked side-panel — same fixed width + treatment as AssignSheet's
  // dockedRight panel, so filled-cell management reserves identical space and
  // the grid's column-fill targets the same reduced width.
  dockPanel: {
    width: 420,
    flexShrink: 0,
    height: "100%",
    borderLeftWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  dockPanelInner: { flex: 1, padding: 16 },
  popoverListDocked: { flexGrow: 1, flexShrink: 1 },
  popoverHead: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  popoverHeadText: { flex: 1, minWidth: 0 },
  popoverTitle: { fontSize: 17, fontWeight: "700" },
  popoverSub: { fontSize: 12, marginTop: 2 },
  popoverList: { flexGrow: 0 },
  occupantRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  occupantName: { flex: 1, fontSize: 15, fontWeight: "500" },
  removeText: { fontSize: 13, fontWeight: "600" },
  noteLine: { fontSize: 12, fontWeight: "600", marginBottom: 8 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  addBtnText: { fontSize: 14, fontWeight: "600" },
  menuEmpty: { fontSize: 14, paddingVertical: 20, textAlign: "center" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuRowText: { flex: 1, minWidth: 0 },
  menuRowSub: { fontSize: 11, marginTop: 1 },
  menuRowCount: { fontSize: 13, fontWeight: "600" },
  publishBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  publishBtn: {
    alignItems: "center",
    justifyContent: "center",
  },
  publishBtnFull: {
    minHeight: 50,
    borderRadius: 12,
  },
  publishBtnCompact: {
    minHeight: 38,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  publishBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  publishBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  publishBtnTextFull: {
    fontSize: 16,
  },
});
