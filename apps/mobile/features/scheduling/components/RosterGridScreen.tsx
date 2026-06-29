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
  Share,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DOMAIN_CONFIG } from "@togather/shared";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { Avatar } from "@components/ui/Avatar";
import { Button } from "@components/ui/Button";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { confirmAsync, notify } from "@/utils/platformAlert";
import { formatRelativeTime } from "@features/notifications";
import { assignmentStatusLabel } from "../utils/format";
import { AssignSheet } from "./AssignSheet";
import { GridPresenceBar } from "./GridPresenceBar";
import { EventEditorPanel } from "./EventEditorPanel";
import { DateColumnHeaderEditor } from "./DateColumnHeaderEditor";
import { TeamChannelToggle } from "./TeamChannelToggle";

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

type RosterTeam = {
  teamId: Id<"teams">;
  teamName: string;
  hasChannel: boolean;
  channelMemberCount: number;
};

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

/**
 * A frozen-column row in the role view: a team section header, a role, an
 * inline "＋ Add role" affordance (one per team), or the trailing "＋ Add team"
 * affordance. The add-* rows render in the frozen column with a matching empty
 * spacer in the body so vertical scroll + alignment stay in sync.
 */
type RoleRow =
  | { kind: "section"; teamId: string; teamName: string }
  | { kind: "role"; role: RosterRole }
  | { kind: "addRole"; teamId: Id<"teams">; teamName: string }
  | {
      kind: "enableChat";
      teamId: Id<"teams">;
      teamName: string;
      hasChannel: boolean;
      channelMemberCount: number;
    }
  | { kind: "addTeam" };

/** A team header or role row the leader has right-clicked to delete. */
type DeleteTarget =
  | { kind: "team"; teamId: Id<"teams">; teamName: string }
  | { kind: "role"; roleId: Id<"teamRoles">; roleName: string; teamId: Id<"teams"> };

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

/**
 * Web-only right-click prop bag. RN-Web forwards unknown DOM props onto the
 * host node, so `onContextMenu` lands on the underlying <div>. The RN types
 * don't know it, hence the cast. Mirrors the idiom in DateColumnHeaderEditor.
 * On native this returns `{}` (no right-click) — long-press is the fallback.
 */
function webContextMenu(onOpen: () => void): Record<string, unknown> {
  if (typeof document === "undefined") return {};
  return {
    onContextMenu: (e: { preventDefault?: () => void }) => {
      e.preventDefault?.();
      onOpen();
    },
  };
}

/** Next Sunday at 9:00 AM local time — the neutral default for a new plan. */
function nextSundayAtNine(): Date {
  const d = new Date();
  const daysUntilSunday = (7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSunday);
  d.setHours(9, 0, 0, 0);
  return d;
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
  /** Current "needed" count for this role on this plan — drives the stepper. */
  neededCount: number;
  /**
   * People already assigned to this role on this plan — the stepper's floor
   * (you can't need fewer slots than are already filled).
   */
  assignedCount: number;
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
  // The header row is a plain tally column on mobile and a richer inline plan
  // editor on desktop (title row + date text + tally + run-sheet button), so
  // it's taller there. Sized to fit that simplified content snugly: the desktop
  // header stacks a ~22px title row, a ~16px date row, a 14px tally, and a ~16px
  // run-sheet button (gap 2 each + 12px vertical padding ≈ 86px). The earlier
  // 132 was sized for the removed inline date/time INPUT boxes and left an
  // obvious empty gap. The cell uses `minHeight` so nothing clips. Only the
  // header cells share this height — body cells use ROW_H — so it doesn't
  // disturb frozen-column/body alignment.
  const HEADER_H = isWide ? 88 : 70;
  // Minimum legible column width per platform. On desktop the cells region
  // grows to fill the viewport (see `CELL_W` below) so a 1–2 date roster reads
  // as a real table rather than a sliver hugging the left edge. There is no
  // upper cap on the fill path: with few dates the columns expand to fill the
  // full grid width (a single wide column is fine — far better than a 280px
  // column with a 700px dead band beside it).
  const MIN_CELL_W = isWide ? 150 : 76;

  // Past dates are normally hidden (the grid leads with upcoming). The ⋯
  // overflow's "Include past" toggle flips this so leaders can reach and
  // re-run past plans — replacing the old Schedule list's "Past plans" section.
  const [includePast, setIncludePast] = useState(false);

  const data = useAuthenticatedQuery(
    api.functions.scheduling.roster.rosterMatrix,
    groupId ? { groupId, includePast } : "skip",
  ) as RosterMatrix | undefined;

  const assignRole = useAuthenticatedMutation(
    api.functions.scheduling.assignments.assignRole,
  );
  // Create a plan straight from the grid (the "＋ Add date" column / quick-start
  // CTA). The reactive rosterMatrix query self-refreshes to show the new column.
  const createEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.createEvent,
  );
  const quickStartRostering = useAuthenticatedMutation(
    api.functions.scheduling.quickStart.quickStartRostering,
  );
  const createAvailabilityLink = useAuthenticatedMutation(
    api.functions.scheduling.publicAvailability.createAvailabilityLink,
  );
  const unassign = useAuthenticatedMutation(
    api.functions.scheduling.assignments.unassign,
  );
  // Set how many of a role are needed for a plan (the AssignSheet stepper).
  // `setNeededRoles` REPLACES the plan's whole needed-roles set, so the handler
  // below rebuilds the full array from `roleCells` and changes only one count.
  const setNeededRoles = useAuthenticatedMutation(
    api.functions.scheduling.events.setNeededRoles,
  );
  // Create a role inline from a team's row-header "＋ Add role" affordance.
  const createRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.createRole,
  );
  // Create a serving team inline from the row-header "＋ Add team" affordance.
  const createServingTeam = useAuthenticatedMutation(
    api.functions.scheduling.teams.createServingTeam,
  );
  // Delete a role / team from the frozen column (right-click → confirm). Both
  // archive + cascade their assignments and text staffed people server-side.
  const deleteRole = useAuthenticatedMutation(
    api.functions.scheduling.deletion.deleteRole,
  );
  const deleteTeam = useAuthenticatedMutation(
    api.functions.scheduling.deletion.deleteTeam,
  );
  // Rename a role / team from the same right-click menu — reuses the existing
  // update mutations the Teams setup screen uses (both scheduler-gated).
  const updateRole = useAuthenticatedMutation(
    api.functions.scheduling.roles.updateRole,
  );
  const updateTeam = useAuthenticatedMutation(
    api.functions.scheduling.teams.updateTeam,
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
  // Request-history modal for a role-cell (initial + re-sends + resend action).
  const [historyModal, setHistoryModal] = useState<{
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
  // Plan-detail panel — MOBILE ONLY now. Tapping a date-column header opens the
  // EventEditorPanel as a bottom sheet. On desktop the header itself is the plan
  // editor (DateColumnHeaderEditor), so there is no desktop plan dock and this
  // stays null there. Holds only the planId — EventEditorPanel queries the rest.
  const [planPanel, setPlanPanel] = useState<{
    planId: Id<"eventPlans">;
  } | null>(null);
  // Publish chooser (#477 FR-3): which date(s) to publish & send requests.
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // ⋯ overflow (Teams / Cross-team / Collect availability / Include past) and
  // the in-flight states for its async actions + the "＋ Add date" column.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [sharingLink, setSharingLink] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  // Inline row-header creation (frozen left column). `addRoleForTeam` holds the
  // team whose "＋ Add role" input is open (null = none); `addTeamOpen` toggles
  // the trailing "＋ Add team" input. `savingRow` guards against double-submit.
  const [addRoleForTeam, setAddRoleForTeam] = useState<Id<"teams"> | null>(null);
  const [addRoleName, setAddRoleName] = useState("");
  const [addTeamOpen, setAddTeamOpen] = useState(false);
  const [addTeamName, setAddTeamName] = useState("");
  const [savingRow, setSavingRow] = useState(false);

  // Right-click (web) / long-press (mobile) on a team header or role row opens
  // a one-item menu → "Delete team" / "Delete role" → confirm flow. See
  // `DeleteRowFlow` below.
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // Single docked side-panel at a time (desktop). The assign panel and the two
  // cell-management panels (role / member) all share the grid's right dock
  // region, so opening one must close the others — otherwise two panels could
  // render at once. On mobile these are independent overlay modals; clearing
  // siblings is harmless there too (only one is ever opened at a time).
  const openAssign = useCallback((target: AssignTarget) => {
    setRoleCellModal(null);
    setMemberCellModal(null);
    setHistoryModal(null);
    setPlanPanel(null);
    setAssignTarget(target);
  }, []);
  const openRoleCell = useCallback(
    (payload: { role: RosterRole; event: RosterEvent }) => {
      setAssignTarget(null);
      setMemberCellModal(null);
      setHistoryModal(null);
      setPlanPanel(null);
      setRoleCellModal(payload);
    },
    [],
  );
  const openMemberCell = useCallback(
    (payload: { member: RosterMember; event: RosterEvent }) => {
      setAssignTarget(null);
      setRoleCellModal(null);
      setHistoryModal(null);
      setPlanPanel(null);
      setMemberCellModal(payload);
    },
    [],
  );
  // Open the plan-detail bottom sheet (MOBILE) for a date column. Clears any
  // open assign/cell panel so only one overlay is live. Unused on desktop —
  // the column header edits the plan inline (DateColumnHeaderEditor).
  const openPlanPanel = useCallback((planId: Id<"eventPlans">) => {
    setAssignTarget(null);
    setRoleCellModal(null);
    setMemberCellModal(null);
    setHistoryModal(null);
    setPlanPanel({ planId });
  }, []);

  // Open the request-history modal from the assign panel — the entry point for
  // empty/open role cells, which route straight to AssignSheet (skipping the
  // occupant popover). Resolves the full role/event rows from `data` by the
  // assign target's ids so the same RequestHistoryModal can be reused.
  const openHistoryForTarget = useCallback(
    (target: AssignTarget) => {
      const role = data?.roles.find((r) => r.roleId === target.roleId);
      const event = data?.events.find((e) => e._id === target.planId);
      if (!role || !event) return;
      setAssignTarget(null);
      setHistoryModal({ role, event });
    },
    [data],
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

  /**
   * Set the needed count for one (role, plan) via `setNeededRoles`, which
   * REPLACES the plan's entire needed-roles set. We rebuild that full set from
   * the current `roleCells` (every role with needed > 0 on this plan), then
   * override just the target role's count — so 0→1 ADDS the role to the date
   * and N→0 removes it. The reactive `rosterMatrix` query refreshes the cells.
   */
  const handleSetNeeded = useCallback(
    async (
      planId: Id<"eventPlans">,
      roleId: Id<"teamRoles">,
      count: number,
    ) => {
      if (!data) return;
      const next = data.roles
        .map((r) => {
          const cell = roleCells[`${r.roleId}:${planId}`];
          const c = r.roleId === roleId ? count : (cell?.needed ?? 0);
          return { teamId: r.teamId, roleId: r.roleId, count: c };
        })
        .filter((r) => r.count > 0);
      try {
        await setNeededRoles({ planId, roles: next });
      } catch (e) {
        surfaceError("Couldn't update needed", e);
      }
    },
    [data, roleCells, setNeededRoles, surfaceError],
  );

  // Column width. On mobile it's the fixed minimum (today's behavior). On
  // desktop the date columns EXPAND to fill the available grid width — the
  // measured body width minus the frozen NAME_W column AND the trailing
  // "＋ Add date" column (MIN_CELL_W) — divided across the date columns, with
  // only a MIN_CELL_W floor (no upper cap). Reserving the add-date width keeps
  // that column on-screen at the right edge instead of being pushed off the
  // filled grid. So 1 date fills the remaining width as one wide column, and
  // ≥N dates fill then scroll horizontally once they hit the floor. `bodyW`
  // re-measures whenever the grid area resizes (e.g. the assign side-panel
  // docking shrinks it), so the fill always targets the space actually left of
  // the panel. Frozen-column alignment is preserved since header + body share
  // this same CELL_W.
  const CELL_W = useMemo(() => {
    if (!isWide || bodyW === 0 || events.length === 0) return MIN_CELL_W;
    const avail = bodyW - NAME_W - MIN_CELL_W;
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
   * Build the frozen-column rows from `data.teams` — the authoritative team
   * list — rather than from "teams that happen to have roles". Every team gets
   * a section header, its (filtered) role rows, and its "＋ Add role"
   * affordance, so a team with zero roles still renders (header + Add role) and
   * is usable. Roles are grouped under their team via `visibleRoles`. Computed
   * unconditionally (above the early returns) to respect the Rules of Hooks.
   */
  const roleRows = useMemo<RoleRow[]>(() => {
    if (!data) return [];
    // Group the already-filtered roles by team for O(1) lookup per team.
    const rolesByTeam = new Map<string, RosterRole[]>();
    for (const role of visibleRoles) {
      const tid = role.teamId as string;
      const list = rolesByTeam.get(tid);
      if (list) list.push(role);
      else rolesByTeam.set(tid, [role]);
    }
    const out: RoleRow[] = [];
    for (const team of data.teams) {
      const tid = team.teamId as string;
      // When a team is isolated, render only that team's section.
      if (isolatedTeamId && tid !== isolatedTeamId) continue;
      // With "Open only" active, hide teams that have no visible roles so the
      // filter still reads as a coverage view — but always show an isolated
      // team and any team that has visible roles.
      const teamRoles = rolesByTeam.get(tid) ?? [];
      if (openOnly && teamRoles.length === 0 && tid !== isolatedTeamId) continue;
      out.push({ kind: "section", teamId: tid, teamName: team.teamName });
      for (const role of teamRoles) out.push({ kind: "role", role });
      out.push({
        kind: "addRole",
        teamId: team.teamId,
        teamName: team.teamName,
      });
      out.push({
        kind: "enableChat",
        teamId: team.teamId,
        teamName: team.teamName,
        hasChannel: team.hasChannel,
        channelMemberCount: team.channelMemberCount,
      });
    }
    // Trailing "＋ Add team". When a team is isolated, hide it so the rows stay
    // scoped to that team.
    if (!isolatedTeamId) out.push({ kind: "addTeam" });
    return out;
  }, [data, visibleRoles, isolatedTeamId, openOnly]);

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
  // ⋯ overflow + plan creation (ported from EventListScreen — the grid is the
  // rostering home now, so these actions live here).
  // -------------------------------------------------------------------------

  // Generate a public, app-optional availability link and hand it to the OS
  // share sheet. People open it in a browser (no app needed) and their
  // response is matched to their account when they later sign up.
  const handleShareLink = useCallback(async () => {
    if (sharingLink) return;
    setSharingLink(true);
    try {
      const { publicToken } = await createAvailabilityLink({ groupId });
      const url = DOMAIN_CONFIG.availabilityLinkUrl(publicToken);
      await Share.share({
        message: `Let us know when you can serve: ${url}`,
      });
    } catch (e) {
      const err = e as { data?: { message?: string }; message?: string };
      Alert.alert(
        "Couldn't create link",
        err?.data?.message ??
          err?.message ??
          "Add an upcoming event plan first, then try again.",
      );
    } finally {
      setSharingLink(false);
    }
  }, [sharingLink, createAvailabilityLink, groupId]);

  // Create a new draft plan at the neutral default date (next Sunday 9 AM, same
  // as the editor's default). The reactive rosterMatrix self-refreshes → a new
  // date column appears; the leader sets the real date in the plan editor.
  const handleAddDate = useCallback(async () => {
    if (creatingEvent) return;
    setCreatingEvent(true);
    try {
      const date = nextSundayAtNine();
      await createEvent({
        groupId,
        title: "Untitled event plan",
        eventDate: date.getTime(),
        times: [{ label: "9:00 AM", startsAt: date.getTime() }],
      });
    } catch (e) {
      surfaceError("Couldn't add date", e);
    } finally {
      setCreatingEvent(false);
    }
  }, [creatingEvent, createEvent, groupId, surfaceError]);

  // One-tap bootstrap for a brand-new group: starter team + roles + a draft
  // plan, then into the editor to own the date. Idempotent on the backend.
  const handleSetUpRostering = useCallback(async () => {
    if (settingUp) return;
    setSettingUp(true);
    try {
      // Compute the default plan date CLIENT-side (leader-local next-Sunday-9 AM)
      // with the SAME helper `handleAddDate` uses, so the quick-start and manual
      // paths agree for non-UTC churches instead of using the server timezone.
      const result = await quickStartRostering({
        groupId,
        startsAt: nextSundayAtNine().getTime(),
      });
      if (result.planId) {
        router.push(`/rostering/${groupId}/event/${result.planId}` as never);
        return;
      }
      // `alreadySetUp` with no new plan → the group already had teams or only
      // past plans (hidden by the default upcoming filter), so quick-start
      // created nothing. Fall back to creating/opening a plan so the CTA is
      // never a dead tap that just clears its spinner on the empty screen.
      await handleAddDate();
    } catch (e) {
      surfaceError("Couldn't set up rostering", e);
    } finally {
      setSettingUp(false);
    }
  }, [
    settingUp,
    quickStartRostering,
    groupId,
    router,
    surfaceError,
    handleAddDate,
  ]);

  // Inline "＋ Add role" under a team section → existing `createRole` mutation
  // (the same one TeamSetupScreen uses). The reactive rosterMatrix adds the new
  // role row. Keeps the input open on desktop so a leader can add several.
  const handleAddRole = useCallback(
    async (teamId: Id<"teams">) => {
      const name = addRoleName.trim();
      if (!name || savingRow) return;
      setSavingRow(true);
      try {
        await createRole({ teamId, name });
        setAddRoleName("");
        if (!isWide) setAddRoleForTeam(null);
      } catch (e) {
        surfaceError("Couldn't add role", e);
      } finally {
        setSavingRow(false);
      }
    },
    [addRoleName, savingRow, createRole, isWide, surfaceError],
  );

  // Inline "＋ Add team" → existing `createServingTeam` mutation (also creates
  // the team's chat channel, same as quickStart). The reactive rosterMatrix
  // adds the new team section.
  const handleAddTeam = useCallback(async () => {
    const name = addTeamName.trim();
    if (!name || savingRow) return;
    setSavingRow(true);
    try {
      await createServingTeam({ groupId, name });
      setAddTeamName("");
      setAddTeamOpen(false);
    } catch (e) {
      surfaceError("Couldn't add team", e);
    } finally {
      setSavingRow(false);
    }
  }, [addTeamName, savingRow, createServingTeam, groupId, surfaceError]);

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
      {!isWide && renderOverflowButton()}
    </View>
  );

  // ⋯ overflow — Teams / Cross-team / Collect availability / Include past.
  // Lives in the mobile header and the desktop toolbar. Layout stays on the
  // inner static View so RN-Web doesn't drop it (Pressable function-style is
  // ignored on web).
  const renderOverflowButton = () => (
    <TouchableOpacity
      onPress={() => setOverflowOpen(true)}
      hitSlop={10}
      style={styles.overflowBtn}
      accessibilityRole="button"
      accessibilityLabel="More rostering options"
    >
      <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
    </TouchableOpacity>
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
    // Fresh group: lead with a one-tap "Set up rostering" that bootstraps a
    // starter team + roles + a draft plan, then drops the leader into the
    // editor. "Add a blank event plan" stays available as the manual path.
    return (
      <View style={[styles.container, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        {renderHeaderBar()}
        <View style={styles.emptyWrap}>
          <Ionicons
            name="calendar-outline"
            size={64}
            color={colors.iconSecondary}
            style={styles.emptyIcon}
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Set up rostering
          </Text>
          <Text style={[styles.emptyMessage, { color: colors.textSecondary }]}>
            Create a starter team with roles and a first event plan in one tap.
            You can rename and tune everything afterwards.
          </Text>
          <View style={styles.emptyActions}>
            <Button
              onPress={handleSetUpRostering}
              variant="primary"
              loading={settingUp}
              style={styles.emptyPrimaryButton}
            >
              Set up rostering
            </Button>
            <Pressable
              onPress={handleAddDate}
              disabled={creatingEvent}
              style={styles.emptySecondary}
              accessibilityRole="button"
              accessibilityLabel="Add a blank event plan"
            >
              {creatingEvent ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Text
                  style={[styles.emptySecondaryText, { color: colors.textSecondary }]}
                >
                  Or add a blank event plan
                </Text>
              )}
            </Pressable>
          </View>
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
      {renderOverflowButton()}
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
            // The view-aware coverage/availability tally, shared by both the
            // mobile header cell and the desktop inline editor.
            const tally =
              mode === "roles" ? (
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
              );

            // Desktop: the header IS the plan editor — no docked side panel.
            // Mobile: a plain tappable header opens the EventEditorPanel sheet.
            if (isWide) {
              return (
                <DateColumnHeaderEditor
                  key={ev._id}
                  event={ev}
                  groupId={groupId}
                  width={CELL_W}
                  height={HEADER_H}
                  narrow={CELL_W < 200}
                  colors={colors}
                  tally={tally}
                  onPublish={() => publishOne(ev)}
                />
              );
            }

            return (
              <TouchableOpacity
                key={ev._id}
                activeOpacity={0.6}
                onPress={() => openPlanPanel(ev._id)}
                accessibilityRole="button"
                accessibilityLabel={`${ev.title}, ${weekday(ev.eventDate)} ${monthDay(ev.eventDate)} — open plan details`}
                style={[
                  styles.headerCell,
                  { width: CELL_W, height: HEADER_H, borderLeftColor: colors.border },
                ]}
              >
                <View style={styles.headerCellTitleRow}>
                  <Text
                    style={[styles.headerCellTitle, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {ev.title}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={9}
                    color={colors.textTertiary}
                  />
                </View>
                <Text style={[styles.headerCellWk, { color: colors.textSecondary }]}>
                  {weekday(ev.eventDate)}
                </Text>
                <Text style={[styles.headerCellDate, { color: colors.text }]}>
                  {monthDay(ev.eventDate)}
                </Text>
                <View style={styles.headerCellTally}>{tally}</View>
              </TouchableOpacity>
            );
          })}
          {/* Trailing "＋ Add date" column — creates a new draft plan at the
              neutral default date; the reactive query adds its column. Lives
              inside the scrolling header so it sits at the right edge of the
              date columns. */}
          <TouchableOpacity
            onPress={handleAddDate}
            disabled={creatingEvent}
            accessibilityRole="button"
            accessibilityLabel="Add a date"
            style={[
              styles.addDateCell,
              { width: MIN_CELL_W, height: HEADER_H, borderLeftColor: colors.border },
            ]}
          >
            {creatingEvent ? (
              <ActivityIndicator size="small" color={colors.link} />
            ) : (
              <>
                <Ionicons name="add" size={20} color={colors.link} />
                <Text
                  style={[styles.addDateText, { color: colors.link }]}
                  numberOfLines={1}
                >
                  Add date
                </Text>
              </>
            )}
          </TouchableOpacity>
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
          const teamId = r.teamId as Id<"teams">;
          return (
            <Pressable
              key={`sec-${r.teamId}`}
              onLongPress={() =>
                setDeleteTarget({ kind: "team", teamId, teamName: r.teamName })
              }
              {...webContextMenu(() =>
                setDeleteTarget({ kind: "team", teamId, teamName: r.teamName }),
              )}
              accessibilityLabel={`${r.teamName} team — long-press to delete`}
              style={[
                styles.sectionCell,
                { width: NAME_W, height: SECTION_H, backgroundColor: colors.surfaceSecondary, borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionText, { color: colors.textSecondary }]} numberOfLines={1}>
                {r.teamName.toUpperCase()}
              </Text>
            </Pressable>
          );
        }
        if (r.kind === "addRole") {
          const open = addRoleForTeam === r.teamId;
          return (
            <View
              key={`addrole-${r.teamId}`}
              style={[
                styles.addRow,
                {
                  width: NAME_W,
                  height: ROW_H,
                  backgroundColor: colors.surface,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              {open ? (
                <View style={styles.addInputRow}>
                  <TextInput
                    style={[styles.addInput, { color: colors.text, borderColor: colors.border }]}
                    placeholder="Role name"
                    placeholderTextColor={colors.textTertiary}
                    value={addRoleName}
                    onChangeText={setAddRoleName}
                    autoFocus
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!savingRow}
                    onSubmitEditing={() => handleAddRole(r.teamId)}
                    returnKeyType="done"
                  />
                  {savingRow ? (
                    <ActivityIndicator size="small" color={colors.link} />
                  ) : (
                    <TouchableOpacity
                      onPress={() => handleAddRole(r.teamId)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Save role"
                    >
                      <Ionicons name="checkmark" size={20} color={colors.link} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => {
                      setAddRoleForTeam(null);
                      setAddRoleName("");
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel add role"
                  >
                    <Ionicons name="close" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    setAddTeamOpen(false);
                    setAddRoleForTeam(r.teamId);
                    setAddRoleName("");
                  }}
                  style={styles.addCta}
                  accessibilityRole="button"
                  accessibilityLabel={`Add a role to ${r.teamName}`}
                >
                  <Ionicons name="add" size={16} color={colors.link} />
                  <Text style={[styles.addCtaText, { color: colors.link }]} numberOfLines={1}>
                    Add role
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }
        if (r.kind === "enableChat") {
          return (
            <View
              key={`enablechat-${r.teamId}`}
              style={[
                styles.addRow,
                {
                  width: NAME_W,
                  height: ROW_H,
                  backgroundColor: colors.surface,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <TeamChannelToggle
                teamId={r.teamId}
                teamName={r.teamName}
                hasChannel={r.hasChannel}
                channelMemberCount={r.channelMemberCount}
              />
            </View>
          );
        }
        if (r.kind === "addTeam") {
          return (
            <View
              key="addteam"
              style={[
                styles.addRow,
                {
                  width: NAME_W,
                  height: ROW_H,
                  backgroundColor: colors.surfaceSecondary,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              {addTeamOpen ? (
                <View style={styles.addInputRow}>
                  <TextInput
                    style={[styles.addInput, { color: colors.text, borderColor: colors.border }]}
                    placeholder="Team name"
                    placeholderTextColor={colors.textTertiary}
                    value={addTeamName}
                    onChangeText={setAddTeamName}
                    autoFocus
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!savingRow}
                    onSubmitEditing={handleAddTeam}
                    returnKeyType="done"
                  />
                  {savingRow ? (
                    <ActivityIndicator size="small" color={colors.link} />
                  ) : (
                    <TouchableOpacity
                      onPress={handleAddTeam}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Save team"
                    >
                      <Ionicons name="checkmark" size={20} color={colors.link} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => {
                      setAddTeamOpen(false);
                      setAddTeamName("");
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel add team"
                  >
                    <Ionicons name="close" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    setAddRoleForTeam(null);
                    setAddTeamOpen(true);
                    setAddTeamName("");
                  }}
                  style={styles.addCta}
                  accessibilityRole="button"
                  accessibilityLabel="Add a team"
                >
                  <Ionicons name="add" size={16} color={colors.link} />
                  <Text style={[styles.addCtaText, { color: colors.link, fontWeight: "700" }]} numberOfLines={1}>
                    Add team
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }
        const coveredCount = events.reduce((n, ev) => {
          const c = roleCells[`${r.role.roleId}:${ev._id}`];
          return n + (c && c.needed > 0 && c.open === 0 ? 1 : 0);
        }, 0);
        const role = r.role;
        const openRoleDelete = () =>
          setDeleteTarget({
            kind: "role",
            roleId: role.roleId,
            roleName: role.roleName,
            teamId: role.teamId,
          });
        return (
          <Pressable
            key={role.roleId}
            onLongPress={openRoleDelete}
            {...webContextMenu(openRoleDelete)}
            accessibilityLabel={`${role.roleName} role — long-press to delete`}
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
                {role.roleName}
              </Text>
              <Text style={[styles.subCount, { color: colors.textTertiary }]}>
                covered {coveredCount}/{events.length}
              </Text>
            </View>
          </Pressable>
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
          // The "＋ Add role" / "＋ Add team" / "Enable chat" rows live only in
          // the frozen column; the body renders an empty spacer of the SAME
          // height so the synced vertical scroll + frozen-column alignment stay.
          if (r.kind === "addRole" || r.kind === "addTeam" || r.kind === "enableChat") {
            const key =
              r.kind === "addRole"
                ? `addrole-${r.teamId}`
                : r.kind === "enableChat"
                  ? `enablechat-${r.teamId}`
                  : "addteam";
            return (
              <View
                key={key}
                style={[
                  styles.row,
                  {
                    height: ROW_H,
                    backgroundColor:
                      r.kind === "addTeam" ? colors.surfaceSecondary : colors.surface,
                    borderBottomColor: colors.border,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
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
                    // Every cell opens the assign panel — including not-needed
                    // cells (no `cell` row, or needed === 0). The panel's Needed
                    // stepper lets a leader add the role to this date (0→1+) or
                    // change its count; the candidate list fills open slots.
                    if (!cell || cell.occupants.length === 0) {
                      openAssign({
                        planId: ev._id,
                        planStatus: ev.status,
                        teamId: r.role.teamId,
                        roleId: r.role.roleId,
                        roleName: r.role.roleName,
                        timeLabel: singleTimeLabel(ev),
                        assignedUserIds: new Set(),
                        keepOpenWhileUnfilled: (cell?.needed ?? 0) > 1,
                        neededCount: cell?.needed ?? 0,
                        assignedCount: cell?.filled ?? 0,
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
            neededCount={
              roleCells[`${assignTarget.roleId}:${assignTarget.planId}`]?.needed ??
              assignTarget.neededCount
            }
            assignedCount={
              roleCells[`${assignTarget.roleId}:${assignTarget.planId}`]?.filled ??
              assignTarget.assignedCount
            }
            onSetNeeded={(count) =>
              handleSetNeeded(
                assignTarget.planId,
                assignTarget.roleId,
                count,
              )
            }
            onShowHistory={() => openHistoryForTarget(assignTarget)}
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
                neededCount: cell.needed,
                assignedCount: cell.filled,
              });
            }}
            onShowHistory={() => {
              const role = roleCellModal.role;
              const ev = roleCellModal.event;
              setRoleCellModal(null);
              setHistoryModal({ role, event: ev });
            }}
            onClose={() => setRoleCellModal(null)}
          />
        )}

        {isWide && historyModal && (
          <RequestHistoryModal
            role={historyModal.role}
            event={historyModal.event}
            colors={colors}
            docked
            onClose={() => setHistoryModal(null)}
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

        {/* Desktop has NO plan side-panel: the date-column header IS the plan
            editor (DateColumnHeaderEditor). The plan-detail panel survives only
            as the mobile bottom sheet (rendered below). */}
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
          neededCount={
            roleCells[`${assignTarget.roleId}:${assignTarget.planId}`]?.needed ??
            assignTarget.neededCount
          }
          assignedCount={
            roleCells[`${assignTarget.roleId}:${assignTarget.planId}`]?.filled ??
            assignTarget.assignedCount
          }
          onSetNeeded={(count) =>
            handleSetNeeded(
              assignTarget.planId,
              assignTarget.roleId,
              count,
            )
          }
          onShowHistory={() => openHistoryForTarget(assignTarget)}
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
              neededCount: cell.needed,
              assignedCount: cell.filled,
            });
          }}
          onShowHistory={() => {
            const role = roleCellModal.role;
            const ev = roleCellModal.event;
            setRoleCellModal(null);
            setHistoryModal({ role, event: ev });
          }}
          onClose={() => setRoleCellModal(null)}
        />
      )}

      {!isWide && historyModal && (
        <RequestHistoryModal
          role={historyModal.role}
          event={historyModal.event}
          colors={colors}
          onClose={() => setHistoryModal(null)}
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

      {/* Mobile: plan-detail panel as a bottom sheet. (Desktop docks it in the
          content row above.) */}
      {!isWide && planPanel && (
        <Modal
          visible
          transparent
          animationType="slide"
          onRequestClose={() => setPlanPanel(null)}
        >
          <View style={styles.sheetBackdrop}>
            <Pressable
              style={styles.sheetBackdropTap}
              onPress={() => setPlanPanel(null)}
              accessibilityLabel="Close plan details"
            />
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.surface,
                  paddingBottom: insets.bottom + 16,
                },
              ]}
            >
              <EventEditorPanel
                key={planPanel.planId}
                planId={planPanel.planId}
                onClose={() => setPlanPanel(null)}
              />
            </View>
          </View>
        </Modal>
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

      {deleteTarget && (
        <DeleteRowFlow
          target={deleteTarget}
          colors={colors}
          deleteRole={deleteRole}
          deleteTeam={deleteTeam}
          updateRole={updateRole}
          updateTeam={updateTeam}
          onError={surfaceError}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {overflowOpen && (
        <OverflowMenu
          colors={colors}
          includePast={includePast}
          sharingLink={sharingLink}
          onTeams={() => {
            setOverflowOpen(false);
            router.push(`/rostering/${groupId}/teams` as never);
          }}
          onCrossTeam={() => {
            setOverflowOpen(false);
            router.push(`/rostering/${groupId}/cross-team` as never);
          }}
          onCollectAvailability={() => {
            setOverflowOpen(false);
            void handleShareLink();
          }}
          onToggleIncludePast={() => setIncludePast((v) => !v)}
          onClose={() => setOverflowOpen(false)}
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

  // Role not needed this event → dim placeholder, but STILL tappable: tapping
  // opens the assign panel where the Needed stepper can add the role to this
  // date (0→1). A faint "+" hints that the empty cell is actionable.
  if (!cell || cell.needed === 0) {
    return (
      <Pressable
        onPress={onPress}
        style={[
          styles.cell,
          { width, height, backgroundColor: base, borderColor: colors.border, opacity: 0.45 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Not needed — tap to add this role"
      >
        <Ionicons name="add" size={13} color={colors.textTertiary} />
      </Pressable>
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
  onShowHistory,
  onClose,
}: {
  role: RosterRole;
  event: RosterEvent;
  cell: RoleCell | undefined;
  colors: Colors;
  docked?: boolean;
  onRemove: (id: Id<"roleAssignments">) => void;
  onAddSomeone: (cell: RoleCell) => void;
  onShowHistory: () => void;
  onClose: () => void;
}) {
  // Per-person serving request, straight from the occupant row. After assigning
  // or reassigning one volunteer on a PUBLISHED plan, a leader can ping just that
  // person instead of re-sending the whole plan via Publish. Reuses the same
  // scheduler-gated action as the request-history "Resend"; the backend only
  // (re-)sends to an `unconfirmed` assignment, so the action is shown only for
  // awaiting people. Gated to published plans (see the occupant row): on a draft
  // the first send is "Publish & send requests", so a stray tap can't text a
  // volunteer about an unpublished roster the leader is still building.
  const resend = useAuthenticatedAction(
    api.functions.scheduling.assignments.resendAssignmentRequest,
  );
  const [resending, setResending] = useState<string | null>(null);

  const handleSendOne = useCallback(
    async (assignmentId: Id<"roleAssignments">, userName: string) => {
      setResending(assignmentId as string);
      try {
        const result = await resend({ assignmentId });
        if (result.scheduled) {
          notify("Request sent", `Sent a serving request to ${userName}.`);
        } else {
          notify(
            "Couldn't send",
            "This volunteer already responded, or the assignment was removed.",
          );
        }
      } catch {
        notify("Couldn't send", "Something went wrong. Please try again.");
      } finally {
        setResending(null);
      }
    },
    [resend],
  );

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
            {event.status === "published" && o.status === "unconfirmed" ? (
              <TouchableOpacity
                onPress={() => handleSendOne(o.assignmentId, o.userName)}
                disabled={resending === (o.assignmentId as string)}
                hitSlop={8}
              >
                <Text style={[styles.removeText, { color: colors.link }]}>
                  {resending === (o.assignmentId as string)
                    ? "Sending…"
                    : "Send request"}
                </Text>
              </TouchableOpacity>
            ) : null}
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
      <Pressable
        onPress={onShowHistory}
        style={[styles.addBtn, { borderColor: colors.border }]}
        accessibilityRole="button"
      >
        <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
        <Text style={[styles.addBtnText, { color: colors.textSecondary }]}>
          Request history
        </Text>
      </Pressable>
    </ModalShell>
  );
}

/**
 * Request-history modal for a role+event cell. Shows every assignment request
 * sent for the role on the plan (initial + re-sends), newest first, with the
 * volunteer's current status, and a Resend action for anyone still awaiting a
 * response. Mirrors the docked-on-desktop / modal-on-mobile pattern of the
 * other cell popovers via ModalShell.
 */
function RequestHistoryModal({
  role,
  event,
  colors,
  docked = false,
  onClose,
}: {
  role: RosterRole;
  event: RosterEvent;
  colors: Colors;
  docked?: boolean;
  onClose: () => void;
}) {
  const history = useAuthenticatedQuery(
    api.functions.scheduling.assignments.assignmentRequestHistory,
    { planId: event._id, roleId: role.roleId },
  );
  const resend = useAuthenticatedAction(
    api.functions.scheduling.assignments.resendAssignmentRequest,
  );
  const [resending, setResending] = useState<string | null>(null);

  const handleResend = useCallback(
    async (assignmentId: Id<"roleAssignments">) => {
      setResending(assignmentId as string);
      try {
        const result = await resend({ assignmentId });
        if (result.scheduled) {
          notify("Request re-sent", `${role.roleName} request was sent again.`);
        } else {
          notify(
            "Couldn't re-send",
            "This volunteer already declined, or the assignment was removed.",
          );
        }
      } catch {
        notify("Couldn't re-send", "Something went wrong. Please try again.");
      } finally {
        setResending(null);
      }
    },
    [resend, role.roleName],
  );

  return (
    <ModalShell
      title="Request history"
      subtitle={`${role.roleName} · ${monthDay(event.eventDate)}`}
      colors={colors}
      docked={docked}
      onClose={onClose}
    >
      {history === undefined ? (
        <ActivityIndicator style={{ paddingVertical: 20 }} color={colors.link} />
      ) : history.length === 0 ? (
        <Text style={[styles.menuEmpty, { color: colors.textSecondary }]}>
          No requests sent yet.
        </Text>
      ) : (
        <ScrollView style={docked ? styles.popoverListDocked : styles.popoverList}>
          {history.map((h) => {
            const removed = h.currentStatus === "removed";
            const statusLabel = removed
              ? "Removed"
              : assignmentStatusLabel(h.currentStatus);
            const verb = h.kind === "resend" ? "Re-sent" : "Requested";
            return (
              <View
                key={h.id}
                style={[styles.occupantRow, { borderBottomColor: colors.border }]}
              >
                <Ionicons
                  name={
                    removed
                      ? "close-circle-outline"
                      : statusIcon(h.currentStatus as AssignmentStatus)
                  }
                  size={16}
                  color={
                    removed
                      ? colors.textSecondary
                      : statusColor(h.currentStatus as AssignmentStatus, colors)
                  }
                />
                <View style={styles.menuRowText}>
                  <Text
                    style={[styles.occupantName, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {h.userName}
                  </Text>
                  <Text
                    style={[styles.menuRowSub, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {`${verb} · ${formatRelativeTime(h.sentAt)} · ${statusLabel}`}
                  </Text>
                  {h.declineNote ? (
                    <Text
                      style={[styles.menuRowSub, { color: colors.textSecondary }]}
                      numberOfLines={2}
                    >
                      {`“${h.declineNote}”`}
                    </Text>
                  ) : null}
                </View>
                {h.currentStatus === "unconfirmed" ? (
                  <TouchableOpacity
                    onPress={() => handleResend(h.assignmentId)}
                    disabled={resending === (h.assignmentId as string)}
                    hitSlop={8}
                  >
                    <Text style={[styles.removeText, { color: colors.link }]}>
                      {resending === (h.assignmentId as string)
                        ? "Sending…"
                        : "Resend"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
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

/**
 * ⋯ overflow menu — secondary rostering surfaces that no longer have a tab:
 * Teams, Cross-team, Collect availability, plus the "Include past" toggle that
 * flips the grid's rosterMatrix({ includePast }) arg.
 */
function OverflowMenu({
  colors,
  includePast,
  sharingLink,
  onTeams,
  onCrossTeam,
  onCollectAvailability,
  onToggleIncludePast,
  onClose,
}: {
  colors: Colors;
  includePast: boolean;
  sharingLink: boolean;
  onTeams: () => void;
  onCrossTeam: () => void;
  onCollectAvailability: () => void;
  onToggleIncludePast: () => void;
  onClose: () => void;
}) {
  return (
    <ModalShell title="Rostering" colors={colors} onClose={onClose}>
      <View>
        <Pressable
          onPress={onTeams}
          style={[styles.menuRow, { borderBottomColor: colors.border }]}
          accessibilityRole="button"
        >
          <Ionicons name="people-outline" size={20} color={colors.text} />
          <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
            Teams
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>
        <Pressable
          onPress={onCrossTeam}
          style={[styles.menuRow, { borderBottomColor: colors.border }]}
          accessibilityRole="button"
        >
          <Ionicons name="git-merge-outline" size={20} color={colors.text} />
          <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
            Cross-team
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>
        <Pressable
          onPress={onCollectAvailability}
          disabled={sharingLink}
          style={[styles.menuRow, { borderBottomColor: colors.border }]}
          accessibilityRole="button"
        >
          {sharingLink ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <Ionicons name="share-outline" size={20} color={colors.text} />
          )}
          <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
            Collect availability
          </Text>
        </Pressable>
        <Pressable
          onPress={onToggleIncludePast}
          style={[styles.menuRow, { borderBottomColor: colors.border }]}
          accessibilityRole="button"
        >
          <Ionicons
            name={includePast ? "checkbox" : "square-outline"}
            size={20}
            color={includePast ? colors.link : colors.text}
          />
          <Text style={[styles.occupantName, { color: colors.text }]} numberOfLines={1}>
            Include past dates
          </Text>
        </Pressable>
      </View>
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

// ---------------------------------------------------------------------------
// Delete team / role flow
// ---------------------------------------------------------------------------

/** "Sun, Jul 5" / "Sun, Jul 5 and Sun, Jul 12" / "3 dates" — the affected-date copy. */
function describeDates(dates: number[]): string {
  const unique = [...new Set(dates)].sort((a, b) => a - b);
  if (unique.length === 0) return "upcoming events";
  if (unique.length === 1) return monthDay(unique[0]);
  if (unique.length === 2) return `${monthDay(unique[0])} and ${monthDay(unique[1])}`;
  return `${unique.length} dates`;
}

/**
 * Right-click actions for a team header or role row: a menu (Rename · Delete)
 * → either an inline rename field, or the "cannot be undone" confirm → (only
 * if people are staffed) a "they'll be texted" confirm → the delete mutation.
 * The staffed count + names + dates are computed client-side from the grid's
 * `roleCells`, so the second modal can show them before any mutation runs.
 *
 * Rename reuses the existing `updateRole` / `updateTeam` mutations (both
 * scheduler-gated) — the same ones the Teams setup screen uses.
 */
function DeleteRowFlow({
  target,
  colors,
  deleteRole,
  deleteTeam,
  updateRole,
  updateTeam,
  onError,
  onClose,
}: {
  target: DeleteTarget;
  colors: Colors;
  deleteRole: (args: { roleId: Id<"teamRoles"> }) => Promise<unknown>;
  deleteTeam: (args: { teamId: Id<"teams"> }) => Promise<unknown>;
  updateRole: (args: { roleId: Id<"teamRoles">; name: string }) => Promise<unknown>;
  updateTeam: (args: { teamId: Id<"teams">; name: string }) => Promise<unknown>;
  onError: (title: string, e: unknown) => void;
  onClose: () => void;
}) {
  // "menu" → "rename" (inline field) | "confirm" → "notify" (only when
  // staffed). Starts at the menu so right-click and long-press both land on a
  // consistent, discoverable surface (matching the date-column ⋯ menu idiom).
  const [step, setStep] = useState<"menu" | "rename" | "confirm" | "notify">(
    "menu",
  );
  const [busy, setBusy] = useState(false);

  const name = target.kind === "team" ? target.teamName : target.roleName;
  const noun = target.kind === "team" ? "team" : "role";
  const [draftName, setDraftName] = useState(name);

  // Who actually gets texted, queried server-side across ALL upcoming plans —
  // not just the grid's visible columns (which cap at ~10 and hide past), so
  // the warning never undercounts. Fetched lazily: only once the user opens the
  // destructive confirm step (the menu / rename steps don't need it).
  const wantStaffed = step === "confirm" || step === "notify";
  const affected = useAuthenticatedQuery(
    api.functions.scheduling.deletion.affectedByDeletion,
    wantStaffed
      ? target.kind === "role"
        ? { roleId: target.roleId }
        : { teamId: target.teamId }
      : "skip",
  ) as
    | { peopleCount: number; dates: number[]; names: string[] }
    | undefined;
  const affectedLoading = wantStaffed && affected === undefined;

  const runDelete = useCallback(async () => {
    setBusy(true);
    try {
      if (target.kind === "team") {
        await deleteTeam({ teamId: target.teamId });
      } else {
        await deleteRole({ roleId: target.roleId });
      }
      onClose();
    } catch (e) {
      onError(`Couldn't delete ${noun}`, e);
      setBusy(false);
    }
  }, [target, deleteTeam, deleteRole, onClose, onError, noun]);

  // Step 1 → jump to the notify modal when the server says people are staffed,
  // otherwise delete straight away. Wait for the count to load first so we
  // never silently skip the notify warning when affected events are off-screen.
  const onConfirmFirst = useCallback(() => {
    if (affected === undefined) return; // still loading — button shows a spinner
    if (affected.peopleCount > 0) {
      setStep("notify");
    } else {
      void runDelete();
    }
  }, [affected, runDelete]);

  const runRename = useCallback(async () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === name) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (target.kind === "team") {
        await updateTeam({ teamId: target.teamId, name: trimmed });
      } else {
        await updateRole({ roleId: target.roleId, name: trimmed });
      }
      onClose();
    } catch (e) {
      onError(`Couldn't rename ${noun}`, e);
      setBusy(false);
    }
  }, [draftName, name, target, updateTeam, updateRole, onClose, onError, noun]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.deleteBackdrop} onPress={busy ? undefined : onClose}>
        <Pressable
          style={[
            styles.deleteCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {step === "menu" && (
            <>
              <Text
                style={[styles.deleteHeading, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {name}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setDraftName(name);
                  setStep("rename");
                }}
                style={styles.deleteMenuItem}
                accessibilityRole="button"
                accessibilityLabel={`Rename ${noun}`}
              >
                <Ionicons name="pencil-outline" size={16} color={colors.text} />
                <Text style={[styles.deleteMenuItemText, { color: colors.text }]}>
                  Rename
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setStep("confirm")}
                style={styles.deleteMenuItem}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${noun}`}
              >
                <Ionicons name="trash-outline" size={16} color={colors.destructive} />
                <Text style={[styles.deleteMenuItemText, { color: colors.destructive }]}>
                  Delete {noun}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === "rename" && (
            <>
              <Text
                style={[styles.deleteHeading, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                Rename {noun}
              </Text>
              <TextInput
                style={[
                  styles.renameInput,
                  { color: colors.text, borderColor: colors.border },
                ]}
                value={draftName}
                onChangeText={setDraftName}
                placeholder={`${noun === "team" ? "Team" : "Role"} name`}
                placeholderTextColor={colors.textTertiary}
                autoFocus
                autoCapitalize="words"
                autoCorrect={false}
                editable={!busy}
                onSubmitEditing={() => void runRename()}
                returnKeyType="done"
                accessibilityLabel={`${noun} name`}
              />
              <View style={styles.deleteActions}>
                <TouchableOpacity
                  onPress={onClose}
                  disabled={busy}
                  style={[styles.deleteBtn, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={[styles.deleteBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void runRename()}
                  disabled={busy || !draftName.trim()}
                  style={[
                    styles.deleteBtn,
                    {
                      backgroundColor: colors.link,
                      opacity: !draftName.trim() ? 0.5 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Save name"
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[styles.deleteBtnText, { color: "#fff" }]}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === "confirm" && (
            <>
              <Text style={[styles.deleteTitle, { color: colors.text }]}>
                Delete &ldquo;{name}&rdquo;?
              </Text>
              <Text style={[styles.deleteBody, { color: colors.textSecondary }]}>
                This action cannot be undone.
              </Text>
              <View style={styles.deleteActions}>
                <TouchableOpacity
                  onPress={onClose}
                  style={[styles.deleteBtn, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={[styles.deleteBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onConfirmFirst}
                  disabled={busy || affectedLoading}
                  style={[styles.deleteBtn, { backgroundColor: colors.destructive }]}
                  accessibilityRole="button"
                  accessibilityLabel="Delete"
                >
                  {busy || affectedLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[styles.deleteBtnText, { color: "#fff" }]}>Delete</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === "notify" && (
            <>
              <Text style={[styles.deleteTitle, { color: colors.text }]}>
                Delete &ldquo;{name}&rdquo;?
              </Text>
              <Text style={[styles.deleteBody, { color: colors.textSecondary }]}>
                {affected?.peopleCount ?? 0}{" "}
                {(affected?.peopleCount ?? 0) === 1 ? "person is" : "people are"}{" "}
                staffed in this {noun}. They&rsquo;ll receive a text that their{" "}
                {noun} has been removed for {describeDates(affected?.dates ?? [])}.
              </Text>
              <Text style={[styles.deleteNames, { color: colors.textTertiary }]} numberOfLines={2}>
                {(affected?.names ?? []).join(", ")}
                {affected && affected.names.length < affected.peopleCount
                  ? ", …"
                  : ""}
              </Text>
              <View style={styles.deleteActions}>
                <TouchableOpacity
                  onPress={onClose}
                  disabled={busy}
                  style={[styles.deleteBtn, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={[styles.deleteBtnText, { color: colors.text }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => void runDelete()}
                  disabled={busy}
                  style={[styles.deleteBtn, { backgroundColor: colors.destructive }]}
                  accessibilityRole="button"
                  accessibilityLabel="Delete and notify"
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={[styles.deleteBtnText, { color: "#fff" }]}>Delete &amp; notify</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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
  overflowBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerSub: { fontSize: 12, marginTop: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },

  // Quick-start empty state (no plans/teams yet) — ported from EventListScreen.
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emptyIcon: { marginBottom: 24 },
  emptyTitle: { fontSize: 20, fontWeight: "600", textAlign: "center", marginBottom: 8 },
  emptyMessage: { fontSize: 16, textAlign: "center", lineHeight: 24, maxWidth: 300 },
  emptyActions: {
    width: "100%",
    maxWidth: 300,
    alignItems: "center",
    gap: 16,
    marginTop: 24,
  },
  emptyPrimaryButton: { width: "100%" },
  emptySecondary: { minHeight: 24, alignItems: "center", justifyContent: "center" },
  emptySecondaryText: { fontSize: 15, fontWeight: "500" },
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
  headerCellTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    maxWidth: "100%",
  },
  headerCellTitle: { fontSize: 9, flexShrink: 1 },
  headerCellWk: { fontSize: 10 },
  headerCellDate: { fontSize: 13, fontWeight: "700" },
  headerCellTally: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 1 },
  headerCellTallyText: { fontSize: 11, fontWeight: "700" },
  addDateCell: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  addDateText: { fontSize: 11, fontWeight: "600" },
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
  addRow: {
    justifyContent: "center",
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  addCtaText: { fontSize: 13, fontWeight: "600" },
  addInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  addInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
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
  // Mobile bottom sheet for the plan-detail panel — a tall card pinned to the
  // bottom over a dim backdrop (tap-to-dismiss above it).
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheetBackdropTap: { flex: 1 },
  sheet: {
    height: "88%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
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

  // Delete team/role flow (right-click menu → confirm → notify). A centered
  // card over a dim backdrop — a Modal, not an in-column popover, so the
  // frozen-column ScrollView can't clip it (same reason as DateColumnHeaderEditor).
  deleteBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  deleteCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
  },
  deleteHeading: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  deleteMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  deleteMenuItemText: { fontSize: 15, fontWeight: "500" },
  renameInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 15,
    marginTop: 4,
  },
  deleteTitle: { fontSize: 17, fontWeight: "700", marginBottom: 8 },
  deleteBody: { fontSize: 14, lineHeight: 20 },
  deleteNames: { fontSize: 13, marginTop: 8, fontStyle: "italic" },
  deleteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  deleteBtn: {
    minWidth: 96,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  deleteBtnText: { fontSize: 15, fontWeight: "600" },
});
