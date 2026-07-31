/**
 * ServingTasksScreen
 *
 * The "Tasks" tab of serving mode. Shows the current user's serving tasks for
 * EVERY plan they're serving today (a volunteer can be on two campuses the same
 * morning) — one stacked section per plan, sourced from `getServingEligibility`.
 * Within each plan the tasks are grouped into three segments — Before / During /
 * After — each with its own ProgressBar reflecting completion of that segment.
 *
 * Two kinds of tasks are merged per segment (the `getMyServingTasks` query
 * returns an `isPersonal` flag):
 *   - Template (assigned) tasks — toggled via `toggleTaskCompletion`.
 *   - Personal (ad-hoc) tasks the user added — toggled via `togglePersonalTask`,
 *     and editable / deletable. These carry an "added by you" marker.
 *
 * How-To guidance: short `text` guidance renders inline (quiet secondary text);
 * heavier kinds (`link` / `media` / `doc`) show a compact "How-To →" chip that
 * opens the full-screen read-only `HowToViewer`. Personal tasks show their note
 * inline and expand (on tap) to Edit / Delete affordances.
 *
 * A "＋ Add task" affordance opens a small inline form (title + optional note +
 * segment; a time label when adding under During) that calls `addPersonalTask`.
 *
 * When "Mine" is empty, `MineEmptyNotice` says WHY — a plan with no tasks at
 * all, a viewer who holds no role on the plan, or tasks that exist but name
 * other roles are three different problems with three different fixes (see
 * `utils/servingTaskEmptyState.ts`). It also offers a jump to "Shared" when the
 * team has whole-team tasks, and — for a leader on a task-less plan —
 * `PopulateFromTemplate`, which links one of the group's saved task templates
 * via the existing `setPlanTaskTemplate`.
 *
 * A fifth pill, "Edit", appears only for a leader/community admin
 * (`canAuthorPlanTasks` — mirrors the backend's `isGroupScheduler` gate on
 * `createTask`/`updateTask`/`deleteTask`): `AuthorSection` lets them switch
 * between the campus's roles and add/edit/delete THAT role's shared tasks
 * in place, without leaving serving mode for the rostering grid. See the
 * "Author" section comment below for the offline decision (online-only).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthenticatedQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import { useAuth } from "@providers/AuthProvider";
import { ProgressBar } from "@components/ui/ProgressBar";
import {
  WA_CELL_MIN_HEIGHT,
  WA_CELL_PADDING,
  WA_CHEVRON_SIZE,
  WA_GROUP_MARGIN,
  WA_GROUP_RADIUS,
  WA_GROUP_SPACING,
  WA_SECTION_HEADER_GAP,
  WA_SECTION_LABEL_SIZE,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_HEADER_BLOCK,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_BOLD,
  WA_WEIGHT_REGULAR,
  WA_WEIGHT_SEMIBOLD,
} from "@components/wa";
import { useEventModeStore } from "@/stores/eventModeStore";
import { useServingPlans } from "../hooks/useServingPlans";
import { useConnectionStatus } from "@providers/ConnectionProvider";
import { useServingTasksCache } from "@/stores/servingTasksCache";
import {
  useServingTaskQueue,
  completionId,
  type ServingTaskKind,
} from "@/stores/servingTaskQueue";
import { HowToViewer, type HowToViewerContent } from "./HowToViewer";
import {
  buildRoleCatalog,
  canAuthorPlanTasks,
  isTeamLevelTask,
  tasksForRole,
  type RoleCatalogEntry,
} from "../utils/taskAuthoring";
import {
  diagnoseMineEmpty,
  mineEmptyCopy,
  myRoleNamesFromCrew,
  planTaskCountFromAllTeams,
  type MineEmptyFacts,
  type MineEmptyReason,
} from "../utils/servingTaskEmptyState";

type Segment = "before" | "during" | "after";

const SEGMENTS: Array<{ key: Segment; label: string }> = [
  { key: "before", label: "Before" },
  { key: "during", label: "During" },
  { key: "after", label: "After" },
];

/** How-to guidance kind (mirrors the backend `howToType` validator). */
type HowToType = "none" | "text" | "link" | "media" | "doc";

/**
 * A serving task row. Shape follows `getMyServingTasks` + the eventTasks /
 * personalServingTasks schemas. `isPersonal` distinguishes the two sources so
 * the correct toggle mutation (and edit/delete affordances) can be used.
 */
type ServingTask = {
  /** Unique per row (a "during" task expands to one row per service time). */
  key: string;
  /** Real task id, passed to completion mutations. */
  taskId: string;
  title: string;
  segment: Segment;
  isPersonal: boolean;
  completed: boolean;
  timeLabel?: string | null;
  // Personal-only
  note?: string | null;
  // Template-only how-to guidance
  howToType?: HowToType;
  howToText?: string | null;
  howToUrl?: string | null;
  howToMediaPath?: string | null;
  howToDoc?: string | null;
};

type MyServingTasks = {
  before: ServingTask[];
  during: ServingTask[];
  after: ServingTask[];
};

// ----------------------------------------------------------------------------
// Section switcher
// ----------------------------------------------------------------------------

/**
 * The views of the serving Tasks page. `author` is a fifth, leader-only view
 * (added to the pill row only when `canAuthorPlanTasks` says so) that lets a
 * leader add/edit/delete a role's shared tasks in place — see `AuthorSection`.
 */
type Section = "mine" | "shared" | "crew" | "allTeams" | "author";

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "mine", label: "Mine" },
  { key: "shared", label: "Shared" },
  { key: "crew", label: "Crew" },
  { key: "allTeams", label: "All teams" },
];

/** Appended to `SECTIONS` only for a leader/community admin — see `AuthorSection`. */
const AUTHOR_SECTION: { key: Section; label: string } = {
  key: "author",
  label: "Edit",
};

/** A whole-team task (from `getSharedTeamTasks`). Completion is team-wide. A
 *  team-level task may span multiple teams (still one shared checkbox). */
type SharedTask = {
  taskId: string;
  teamIds: string[];
  teamNames: string[];
  title: string;
  segment: Segment;
  howToType: HowToType;
  howToText?: string | null;
  howToUrl?: string | null;
  howToMediaPath?: string | null;
  howToDoc?: string | null;
  completed: boolean;
  completedByName?: string | null;
  completedAt?: number | null;
};

/** A single teammate task in the crew view (read-only; content not fetched). */
type CrewTask = {
  taskId: string;
  title: string;
  segment: Segment;
  completed: boolean;
  howToType: HowToType;
};

/** One entry per member+role from `getCrewTasks` (current user first). */
type CrewMember = {
  userId: string;
  name: string;
  roleId: string;
  roleName: string;
  teamId: string;
  teamName: string;
  isCurrentUser: boolean;
  /** "unconfirmed" teammates are shown with a badge; declined aren't returned. */
  status: "confirmed" | "unconfirmed";
  done: number;
  total: number;
  tasks: CrewTask[];
};

/** A single task in the all-teams overview (read-only). */
type TeamTask = {
  taskId: string;
  title: string;
  segment: Segment;
  /** Role(s) responsible on this team; empty => team-level. */
  roleNames: string[];
  completed: boolean;
  howToType: HowToType;
};

/** One row per team from `getAllTeamsTasks` (plan-wide readiness). */
type AllTeamsTeam = {
  teamId: string;
  teamName: string;
  taskCount: number;
  done: number;
  total: number;
  tasks: TeamTask[];
};

/** Show a one-button error (Alert.alert is a no-op on web in this codebase). */
function notify(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/**
 * A `getServingEligibility` plan. Matches `CachedServingPlan` so the whole list
 * can be persisted for offline via `useCachedServingPlans` — the child section
 * only reads `planId`/`title`/`startsAt`.
 */
type EligiblePlan = {
  planId: string;
  groupId: string;
  title: string;
  startsAt: number;
  endsAt: number;
};

/**
 * Parent for the Tasks tab. Owns nothing plan-specific: it resolves the list of
 * plans the user is serving (`getServingEligibility`) and renders one
 * `ServingTasksPlanSection` per plan, plus the SINGLE global offline flush loop
 * (see below). All per-plan data/handlers live in the child section.
 */
export function ServingTasksScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Flag-on restyle only (WHATSAPP-DESIGN-SYSTEM.md §7). Read once here and
  // passed down as a prop rather than re-read per row — the hook fans out to
  // three flag sources, two of them Convex queries.
  const wa = useWhatsappShell();
  const isServingMode = useEventModeStore((s) => s.isServingMode);
  const previewPlanId = useEventModeStore((s) => s.previewPlanId);

  // Every plan the user is serving today (soonest-first). One section each.
  // Cached for offline via `useCachedServingPlans` so the tab still renders its
  // sections at a venue with no signal.
  const eligibility = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingEligibility,
    isServingMode ? {} : "skip",
  ) as
    | { plans: EligiblePlan[]; upcomingPlans: EligiblePlan[] }
    | null
    | undefined;
  // Today's plans, or the single upcoming plan opened early for preview.
  const plans = useServingPlans(eligibility);

  // --- Global offline flush loop ---------------------------------------------
  // Replays queued (offline) completions when back online. The queue is GLOBAL
  // across every plan, so this must run exactly once — it lives here in the
  // parent rather than in each per-plan section, which would race to drain the
  // same queue. The per-plan RECONCILE (dropping entries the plan's live server
  // data already reflects) stays in the child, scoped to that plan's data.
  const { isEffectivelyOffline } = useConnectionStatus();
  const queuePending = useServingTaskQueue((s) => s.pending);
  const dequeueCompletion = useServingTaskQueue((s) => s.dequeue);
  const toggleSharedTeamTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.toggleSharedTeamTask,
  );
  const toggleTaskCompletion = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.toggleTaskCompletion,
  );
  const togglePersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.togglePersonalTask,
  );

  // Replay queued completions when back online. All three toggle mutations take
  // an explicit `completed` and are idempotent, so replay is always safe.
  const flushingRef = useRef(false);
  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      for (const op of useServingTaskQueue.getState().all()) {
        try {
          if (op.kind === "personal") {
            await togglePersonalTask({
              taskId: op.taskId as Id<"personalServingTasks">,
              completed: op.completed,
            });
          } else if (op.kind === "template") {
            await toggleTaskCompletion({
              taskId: op.taskId as Id<"eventTasks">,
              timeLabel: op.timeLabel,
              completed: op.completed,
            });
          } else {
            await toggleSharedTeamTask({
              planId: op.planId as Id<"eventPlans">,
              taskId: op.taskId as Id<"eventTasks">,
              completed: op.completed,
            });
          }
          // Only drop it if the desired state hasn't changed since we
          // snapshotted `all()` — the user may have gone offline mid-flush and
          // re-toggled this task, in which case `enqueue` replaced the entry and
          // we must keep the newer intent for the next flush.
          const current = useServingTaskQueue.getState().pending[op.id];
          if (current && current.completed === op.completed) {
            dequeueCompletion(op.id);
          }
        } catch {
          // Leave it queued; the next reconnect (or screen mount) retries.
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [
    togglePersonalTask,
    toggleTaskCompletion,
    toggleSharedTeamTask,
    dequeueCompletion,
  ]);

  useEffect(() => {
    if (isEffectivelyOffline) return;
    if (Object.keys(queuePending).length === 0) return;
    void flushQueue();
  }, [isEffectivelyOffline, queuePending, flushQueue]);

  if (!isServingMode) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text
          style={[styles.emptyText, wa && waStyles.emptyText, { color: colors.textSecondary }]}
        >
          Not currently serving on an event.
        </Text>
      </View>
    );
  }

  // The query is skipped outside serving mode; inside it, `undefined` means the
  // first load hasn't resolved yet. Offline, `plans` falls back to the cache, so
  // only show the spinner when we have nothing cached to render.
  if (eligibility === undefined && plans.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (plans.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text
          style={[styles.emptyText, wa && waStyles.emptyText, { color: colors.textSecondary }]}
        >
          {previewPlanId
            ? "This event isn't available to preview anymore."
            : "Not currently serving on an event."}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 40,
      }}
    >
      {plans.map((plan) => (
        <ServingTasksPlanSection key={plan.planId} plan={plan} wa={wa} />
      ))}
    </ScrollView>
  );
}

/**
 * One plan's Tasks UI: header (plan title + when + readiness), the Mine / Shared
 * / Crew / All-teams section switcher, and all the per-plan data, offline cache,
 * mutations and handlers. Every hook here is scoped to `plan.planId`, so
 * completing a task offline enqueues under the CORRECT plan. Rendered once per
 * eligible plan by `ServingTasksScreen`; the global offline flush loop lives in
 * the parent — only the per-plan reconcile lives here.
 */
function ServingTasksPlanSection({ plan, wa }: { plan: EligiblePlan; wa: boolean }) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { user } = useAuth();
  const planId = plan.planId as Id<"eventPlans">;
  const groupId = plan.groupId as Id<"groups">;

  // Leader gate for the "Edit" surface — same source (and same check) the
  // desktop grid uses to decide edit rights (`EventTasksScreen`'s `isLeader`),
  // mirroring the backend's actual `createTask`/`updateTask`/`deleteTask` gate
  // (`isGroupScheduler`: active group leader, or community admin) so the
  // affordance only shows to users the backend will actually accept.
  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    { groupId },
  ) as { userRole?: string } | null | undefined;
  const canAuthor = canAuthorPlanTasks(
    groupData?.userRole,
    user?.is_admin === true,
  );

  const tasks = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getMyServingTasks,
    { planId },
  ) as MyServingTasks | undefined;

  // The other three sections. Fetched alongside Mine so the pill badges can
  // show live counts; only the active section's content is rendered.
  const sharedTasks = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getSharedTeamTasks,
    { planId },
  ) as SharedTask[] | undefined;
  const crewMembers = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getCrewTasks,
    { planId },
  ) as CrewMember[] | undefined;
  const allTeams = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getAllTeamsTasks,
    { planId },
  ) as AllTeamsTeam[] | undefined;

  const toggleSharedTeamTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.toggleSharedTeamTask,
  );

  const toggleTaskCompletion = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.toggleTaskCompletion,
  );
  const togglePersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.togglePersonalTask,
  );
  const addPersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.addPersonalTask,
  );
  const updatePersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.updatePersonalTask,
  );
  const deletePersonalTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.deletePersonalTask,
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which segment's inline add-form is open (null = none).
  const [addingSegment, setAddingSegment] = useState<Segment | null>(null);
  // The personal task currently being edited (null = none).
  const [editingId, setEditingId] = useState<string | null>(null);
  // The how-to guidance currently open in the full-screen viewer (null = none).
  const [viewerContent, setViewerContent] = useState<HowToViewerContent | null>(null);

  // Which section is showing. Persisted in component state.
  const [section, setSection] = useState<Section>("mine");
  // Expanded rows in the read-only Crew / All-teams sections.
  const [expandedCrewId, setExpandedCrewId] = useState<string | null>(null);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  // Optimistic overrides for shared (team-wide) task completion, keyed by
  // taskId. Cleared once the reactive query catches up to the toggled value.
  const [sharedOptimistic, setSharedOptimistic] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (!sharedTasks) return;
    setSharedOptimistic((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const t of sharedTasks) {
        if (t.taskId in next && next[t.taskId] === t.completed) {
          delete next[t.taskId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sharedTasks]);

  // --- Offline support -------------------------------------------------------
  // Serving happens on the event day, often with poor venue connectivity, so
  // the Tasks tab must work offline: view cached tasks and check them off, with
  // completions queued to sync on reconnect. See ADR-028.
  const { isNetworkAvailable, isEffectivelyOffline } = useConnectionStatus();
  const queuePending = useServingTaskQueue((s) => s.pending);
  const enqueueCompletion = useServingTaskQueue((s) => s.enqueue);
  const dequeueCompletion = useServingTaskQueue((s) => s.dequeue);
  // Subscribe to the cache store (not `.getState()`) so the async AsyncStorage
  // rehydration on a cold offline launch re-renders us once the saved copy lands.
  const tasksCache = useServingTasksCache();

  // Cache each section's live result as it arrives so it can be shown offline.
  useEffect(() => {
    if (planId && tasks !== undefined)
      useServingTasksCache.getState().setSection("mine", planId, tasks);
  }, [planId, tasks]);
  useEffect(() => {
    if (planId && sharedTasks !== undefined)
      useServingTasksCache.getState().setSection("shared", planId, sharedTasks);
  }, [planId, sharedTasks]);
  useEffect(() => {
    if (planId && crewMembers !== undefined)
      useServingTasksCache.getState().setSection("crew", planId, crewMembers);
  }, [planId, crewMembers]);
  useEffect(() => {
    if (planId && allTeams !== undefined)
      useServingTasksCache.getState().setSection("allTeams", planId, allTeams);
  }, [planId, allTeams]);

  // With no network the live queries stay `undefined`; fall back to the last
  // saved copy (any age). `isNetworkAvailable` is the stable radio signal —
  // preferred over `isEffectivelyOffline` here to avoid Android's flaky
  // reachability probe forcing the cache on a healthy cold start.
  const useCache = !isNetworkAvailable && !!planId;
  const effTasks: MyServingTasks | undefined =
    tasks ??
    (useCache
      ? ((tasksCache.getSectionStale("mine", planId!) as
          | MyServingTasks
          | null) ?? undefined)
      : undefined);
  const effShared: SharedTask[] | undefined =
    sharedTasks ??
    (useCache
      ? ((tasksCache.getSectionStale("shared", planId!) as
          | SharedTask[]
          | null) ?? undefined)
      : undefined);
  const effCrew: CrewMember[] | undefined =
    crewMembers ??
    (useCache
      ? ((tasksCache.getSectionStale("crew", planId!) as
          | CrewMember[]
          | null) ?? undefined)
      : undefined);
  const effAllTeams: AllTeamsTeam[] | undefined =
    allTeams ??
    (useCache
      ? ((tasksCache.getSectionStale("allTeams", planId!) as
          | AllTeamsTeam[]
          | null) ?? undefined)
      : undefined);
  const isStale = tasks === undefined && effTasks !== undefined;

  // Overlay any queued (offline) completions on top of the displayed data so a
  // just-checked task shows checked before it has synced.
  const mineWithOverlay = useMemo<MyServingTasks | undefined>(() => {
    if (!effTasks) return effTasks;
    const apply = (arr: ServingTask[]) =>
      arr.map((t) => {
        const kind: ServingTaskKind = t.isPersonal ? "personal" : "template";
        const queued = queuePending[completionId(kind, t.taskId, t.timeLabel)];
        return queued ? { ...t, completed: queued.completed } : t;
      });
    return {
      before: apply(effTasks.before),
      during: apply(effTasks.during),
      after: apply(effTasks.after),
    };
  }, [effTasks, queuePending]);

  // Shared completion overlay merges the online optimistic map with any queued
  // offline completions (queue wins).
  const sharedOverlay = useMemo<Record<string, boolean>>(() => {
    const merged: Record<string, boolean> = { ...sharedOptimistic };
    for (const op of Object.values(queuePending)) {
      if (op.kind === "shared") merged[op.taskId] = op.completed;
    }
    return merged;
  }, [sharedOptimistic, queuePending]);

  // NOTE: The global offline flush loop (replaying queued completions across
  // ALL plans) lives in the parent `ServingTasksScreen` — it must run exactly
  // once. This child only RECONCILES against its own plan's live data below.

  // Drop queued entries the server already reflects (our flush landing, or
  // another volunteer completing a shared task) so the overlay clears.
  useEffect(() => {
    // Only reconcile against LIVE server data. Offline, `effTasks`/`effShared`
    // are the stale cache, and matching a queued op against it would dequeue a
    // completion that never reached the server — a silent lost write.
    if (!isNetworkAvailable) return;
    const pending = useServingTaskQueue.getState().pending;
    if (Object.keys(pending).length === 0) return;
    const mineFlat = effTasks
      ? [...effTasks.before, ...effTasks.during, ...effTasks.after]
      : [];
    for (const op of Object.values(pending)) {
      let serverState: boolean | undefined;
      if (op.kind === "shared") {
        serverState = (effShared ?? []).find(
          (t) => t.taskId === op.taskId,
        )?.completed;
      } else {
        serverState = mineFlat.find(
          (t) =>
            t.taskId === op.taskId &&
            (t.timeLabel ?? "") === (op.timeLabel ?? ""),
        )?.completed;
      }
      if (serverState !== undefined && serverState === op.completed) {
        dequeueCompletion(op.id);
      }
    }
  }, [isNetworkAvailable, effTasks, effShared, dequeueCompletion]);

  const toggleShared = useCallback(
    async (taskId: string, next: boolean) => {
      if (!planId) return;
      // Offline: queue the desired state; the overlay reflects it immediately.
      if (isEffectivelyOffline) {
        enqueueCompletion({ planId, kind: "shared", taskId, completed: next });
        return;
      }
      setSharedOptimistic((o) => ({ ...o, [taskId]: next }));
      try {
        await toggleSharedTeamTask({
          planId,
          taskId: taskId as Id<"eventTasks">,
          completed: next,
        });
      } catch (err) {
        // Revert the optimistic value on failure.
        setSharedOptimistic((o) => {
          const copy = { ...o };
          delete copy[taskId];
          return copy;
        });
        notify("Couldn't update task", String((err as Error)?.message ?? err));
      }
    },
    [planId, isEffectivelyOffline, enqueueCompletion, toggleSharedTeamTask],
  );

  const openHowTo = useCallback(
    (t: {
      taskId: string;
      title: string;
      howToType?: HowToType;
      howToUrl?: string | null;
      howToMediaPath?: string | null;
      howToDoc?: string | null;
    }) => {
      setViewerContent({
        taskId: t.taskId,
        title: t.title,
        howToType: t.howToType ?? "none",
        howToUrl: t.howToUrl,
        howToMediaPath: t.howToMediaPath,
        howToDoc: t.howToDoc,
      });
    },
    [],
  );

  const toggle = useCallback(
    async (task: ServingTask) => {
      if (!planId) return;
      const kind: ServingTaskKind = task.isPersonal ? "personal" : "template";
      // `task.completed` is the displayed (overlay-aware) state, so this is the
      // correct desired next value.
      const desired = !task.completed;
      // Offline: queue the desired state; the overlay reflects it immediately.
      if (isEffectivelyOffline) {
        enqueueCompletion({
          planId,
          kind,
          taskId: task.taskId,
          timeLabel: task.timeLabel ?? undefined,
          completed: desired,
        });
        return;
      }
      try {
        if (task.isPersonal) {
          await togglePersonalTask({
            taskId: task.taskId as Id<"personalServingTasks">,
            completed: desired,
          });
        } else {
          await toggleTaskCompletion({
            taskId: task.taskId as Id<"eventTasks">,
            timeLabel: task.timeLabel ?? undefined,
            completed: desired,
          });
        }
      } catch (err) {
        notify("Couldn't update task", String((err as Error)?.message ?? err));
      }
    },
    [
      planId,
      isEffectivelyOffline,
      enqueueCompletion,
      togglePersonalTask,
      toggleTaskCompletion,
    ],
  );

  const remove = useCallback(
    async (taskId: string) => {
      try {
        await deletePersonalTask({
          taskId: taskId as Id<"personalServingTasks">,
        });
      } catch (err) {
        notify("Couldn't delete task", String((err as Error)?.message ?? err));
      }
    },
    [deletePersonalTask],
  );

  // Overall readiness across every segment (overlay-aware so queued offline
  // completions count toward the progress bars).
  const allTasks = mineWithOverlay
    ? [...mineWithOverlay.before, ...mineWithOverlay.during, ...mineWithOverlay.after]
    : [];
  const overallDone = allTasks.filter((t) => t.completed).length;
  const overallTotal = allTasks.length;

  // "Preloaded" tasks are the template (assigned) tasks for the user's role;
  // personal tasks are the ones the user adds themselves.
  const myTemplateTaskCount = allTasks.filter((t) => !t.isPersonal).length;

  // WHY the "Mine" list is empty. Three unrelated causes used to share one
  // message ("No preloaded task. Please contact your team lead to add tasks.")
  // that was wrong for two of them; `diagnoseMineEmpty` tells them apart from
  // data these four queries already carry. See `servingTaskEmptyState.ts`.
  const mineFacts = useMemo(
    () => ({
      planTaskCount: planTaskCountFromAllTeams(effAllTeams),
      myRoleNames: myRoleNamesFromCrew(effCrew),
      myTemplateTaskCount,
      sharedTaskCount: effShared?.length ?? 0,
    }),
    [effAllTeams, effCrew, myTemplateTaskCount, effShared],
  );
  const mineEmptyReason: MineEmptyReason = diagnoseMineEmpty(mineFacts);
  // `loading` renders nothing, so the per-segment empty cards stay visible
  // until we can say something true.
  const showMineNotice =
    mineEmptyReason !== "has-tasks" && mineEmptyReason !== "loading";

  // Small badges on the section pills (null hides the badge).
  const sectionCounts: Record<Section, string | null> = {
    mine: overallTotal > 0 ? `${overallDone}/${overallTotal}` : null,
    shared: effShared && effShared.length > 0 ? String(effShared.length) : null,
    crew: effCrew && effCrew.length > 0 ? String(effCrew.length) : null,
    allTeams: effAllTeams && effAllTeams.length > 0 ? String(effAllTeams.length) : null,
    author: null,
  };

  // The "Edit" pill is leader-only — appended rather than always present, so
  // a plain volunteer sees no authoring affordance at all (backend would
  // reject their writes anyway; this keeps the UI honest about that).
  const sections = canAuthor ? [...SECTIONS, AUTHOR_SECTION] : SECTIONS;

  return (
    <View style={styles.planSection}>
      {isStale ? <OfflineBanner colors={colors} wa={wa} /> : null}

        <ServingHeader
          title={plan.title}
          startsAt={plan.startsAt}
          done={overallDone}
          total={overallTotal}
          loading={effTasks === undefined}
          colors={colors}
          primaryColor={primaryColor}
          wa={wa}
        />

        <SectionPills
          section={section}
          sections={sections}
          counts={sectionCounts}
          onChange={setSection}
          colors={colors}
          primaryColor={primaryColor}
          wa={wa}
        />

        {section === "mine" &&
          (mineWithOverlay === undefined ? (
            useCache ? (
              <SectionEmpty
                icon="cloud-offline-outline"
                title="You're offline"
                subtitle="Your tasks will appear once you've opened them with a connection."
                colors={colors}
                wa={wa}
              />
            ) : (
              <View style={styles.inlineLoading}>
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            )
          ) : (
            <>
            {showMineNotice ? (
              <MineEmptyNotice
                reason={mineEmptyReason}
                facts={mineFacts}
                onViewShared={() => setSection("shared")}
                leader={
                  canAuthor && mineEmptyReason === "no-plan-tasks"
                    ? { planId, groupId, isEffectivelyOffline }
                    : null
                }
                colors={colors}
                primaryColor={primaryColor}
                wa={wa}
              />
            ) : null}
            {SEGMENTS.map(({ key, label }) => {
            const segmentTasks = mineWithOverlay[key] ?? [];
            const done = segmentTasks.filter((t) => t.completed).length;
            const total = segmentTasks.length;
            const progress = total > 0 ? done / total : 0;

            return (
              <View key={key} style={[styles.segment, wa && waStyles.segment]}>
                <View style={styles.segmentHeader}>
                  <Text
                    style={[
                      styles.segmentTitle,
                      wa && waStyles.segmentTitle,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {/* S3.5: ALL-CAPS section labels are dead flag-on. */}
                    {wa ? label : label.toUpperCase()}
                  </Text>
                  <Text
                    style={[
                      styles.segmentCount,
                      wa && waStyles.segmentCount,
                      { color: colors.textTertiary },
                    ]}
                  >
                    {done}/{total}
                  </Text>
                </View>
                <ProgressBar
                  progress={progress}
                  color={primaryColor}
                  height={4}
                />

                {/* When the notice above is explaining the empty state, skip
                    the per-segment empty card and leave just the "Add my own
                    task" affordance. (While the diagnosis is still `loading`
                    no notice shows, so the cards stay.) */}
                {segmentTasks.length === 0 && showMineNotice ? null : (
                <View
                  style={[
                    styles.card,
                    wa && waStyles.card,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  {segmentTasks.length === 0 ? (
                    <Text
                      style={[
                        styles.cardEmpty,
                        wa && waStyles.cardEmpty,
                        { color: colors.textTertiary },
                      ]}
                    >
                      Nothing here yet.
                    </Text>
                  ) : (
                    segmentTasks.map((task, i) => (
                      <TaskRow
                        key={task.key}
                        task={task}
                        first={i === 0}
                        colors={colors}
                        primaryColor={primaryColor}
                        wa={wa}
                        expanded={expandedId === task.key}
                        editing={editingId === task.key}
                        onToggle={() => toggle(task)}
                        onOpenHowTo={() =>
                          setViewerContent({
                            taskId: task.taskId,
                            title: task.title,
                            howToType: task.howToType ?? "none",
                            howToUrl: task.howToUrl,
                            howToMediaPath: task.howToMediaPath,
                            howToDoc: task.howToDoc,
                          })
                        }
                        onToggleExpand={() =>
                          setExpandedId((cur) =>
                            cur === task.key ? null : task.key,
                          )
                        }
                        onEdit={() => setEditingId(task.key)}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={async (patch) => {
                          try {
                            await updatePersonalTask({
                              taskId: task.taskId as Id<"personalServingTasks">,
                              ...patch,
                            });
                            setEditingId(null);
                          } catch (err) {
                            notify(
                              "Couldn't save task",
                              String((err as Error)?.message ?? err),
                            );
                          }
                        }}
                        onDelete={() => remove(task.taskId)}
                      />
                    ))
                  )}
                </View>
                )}

                {addingSegment === key ? (
                  <AddTaskForm
                    segment={key}
                    colors={colors}
                    primaryColor={primaryColor}
                    wa={wa}
                    onCancel={() => setAddingSegment(null)}
                    onSubmit={async ({ title, note, timeLabel }) => {
                      if (!planId) return;
                      try {
                        await addPersonalTask({
                          planId,
                          segment: key,
                          title,
                          note: note || undefined,
                          timeLabel: timeLabel || undefined,
                        });
                        setAddingSegment(null);
                      } catch (err) {
                        notify(
                          "Couldn't add task",
                          String((err as Error)?.message ?? err),
                        );
                      }
                    }}
                  />
                ) : (
                  <Pressable
                    onPress={() => setAddingSegment(key)}
                    style={styles.addButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a ${label} task`}
                  >
                    <Ionicons name="add" size={17} color={primaryColor} />
                    <Text
                      style={[
                        styles.addButtonText,
                        wa && waStyles.addButtonText,
                        { color: primaryColor },
                      ]}
                    >
                      Add my own task
                    </Text>
                  </Pressable>
                )}
                </View>
              );
            })}
            </>
          ))}

        {section === "shared" && (
          <SharedSection
            tasks={effShared}
            optimistic={sharedOverlay}
            colors={colors}
            primaryColor={primaryColor}
            onToggle={toggleShared}
            onOpenHowTo={openHowTo}
            wa={wa}
          />
        )}

        {section === "crew" && (
          <CrewSection
            members={effCrew}
            expandedId={expandedCrewId}
            onToggleExpand={(id) =>
              setExpandedCrewId((cur) => (cur === id ? null : id))
            }
            colors={colors}
            primaryColor={primaryColor}
            wa={wa}
          />
        )}

        {section === "allTeams" && (
          <AllTeamsSection
            teams={effAllTeams}
            expandedId={expandedTeamId}
            onToggleExpand={(id) =>
              setExpandedTeamId((cur) => (cur === id ? null : id))
            }
            colors={colors}
            primaryColor={primaryColor}
            wa={wa}
          />
        )}

        {section === "author" && canAuthor && (
          <AuthorSection
            planId={planId}
            groupId={groupId}
            isEffectivelyOffline={isEffectivelyOffline}
            colors={colors}
            primaryColor={primaryColor}
            wa={wa}
          />
        )}
      <HowToViewer
        visible={viewerContent !== null}
        content={viewerContent}
        onClose={() => setViewerContent(null)}
      />
    </View>
  );
}

// ============================================================================
// Header
// ============================================================================

/** Format a plan start timestamp as e.g. "Sun, Jul 6 · 9:00 AM". */
function formatWhen(startsAt: number): string {
  const d = new Date(startsAt);
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${time}`;
}

function ServingHeader({
  title,
  startsAt,
  done,
  total,
  loading,
  colors,
  primaryColor,
  wa,
}: {
  title: string;
  startsAt?: number;
  done: number;
  total: number;
  loading: boolean;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  const allDone = total > 0 && done === total;
  return (
    <View style={styles.header}>
      <Text
        style={[styles.headerTitle, wa && waStyles.headerTitle, { color: colors.text }]}
        numberOfLines={2}
      >
        {title}
      </Text>
      {startsAt ? (
        <Text
          style={[
            styles.headerWhen,
            wa && waStyles.headerWhen,
            { color: colors.textSecondary },
          ]}
        >
          {formatWhen(startsAt)}
        </Text>
      ) : null}

      {!loading && total > 0 ? (
        <View style={styles.readiness}>
          <View style={styles.readinessLabelRow}>
            <Text
              style={[
                styles.readinessLabel,
                wa && waStyles.readinessLabel,
                { color: colors.textSecondary },
              ]}
            >
              {allDone ? "You're all set" : "Your readiness"}
            </Text>
            <Text
              style={[
                styles.readinessCount,
                wa && waStyles.readinessCount,
                { color: colors.text },
              ]}
            >
              {done} of {total}
            </Text>
          </View>
          <ProgressBar progress={done / total} color={primaryColor} height={8} />
        </View>
      ) : null}
    </View>
  );
}

// ============================================================================
// Task row
// ============================================================================

type ThemeColors = ReturnType<typeof useTheme>["colors"];

interface TaskRowProps {
  task: ServingTask;
  first: boolean;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
  expanded: boolean;
  editing: boolean;
  onToggle: () => void;
  onOpenHowTo: () => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (patch: { title?: string; note?: string }) => void;
  onDelete: () => void;
}

/** How-to kinds that open the full-screen viewer rather than rendering inline. */
const VIEWER_HOW_TO_ICONS: Record<
  "link" | "media" | "doc",
  keyof typeof Ionicons.glyphMap
> = {
  link: "link-outline",
  media: "image-outline",
  doc: "document-text-outline",
};

function TaskRow({
  task,
  first,
  colors,
  primaryColor,
  wa,
  expanded,
  editing,
  onToggle,
  onOpenHowTo,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: TaskRowProps) {
  const [editTitle, setEditTitle] = useState(task.title);
  const [editNote, setEditNote] = useState(task.note ?? "");

  const howToType = task.howToType ?? "none";
  // Short text guidance renders inline; personal notes render inline too.
  const inlineText = task.isPersonal
    ? task.note
    : howToType === "text"
      ? task.howToText
      : null;
  // link / media / doc open the viewer via a compact affordance.
  const viewerType =
    !task.isPersonal && (howToType === "link" || howToType === "media" || howToType === "doc")
      ? howToType
      : null;

  return (
    <View
      style={[
        styles.taskRow,
        wa && waStyles.taskRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
    >
      <View style={styles.taskRowMain}>
        <Pressable
          onPress={onToggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.completed }}
          accessibilityLabel={task.title}
          style={styles.checkboxPress}
        >
          <View
            style={[
              styles.checkbox,
              wa && waStyles.checkbox,
              task.completed
                ? { backgroundColor: primaryColor, borderColor: primaryColor }
                : { borderColor: colors.textTertiary },
            ]}
          >
            {task.completed ? (
              <Ionicons name="checkmark" size={wa ? 16 : 15} color="#fff" />
            ) : null}
          </View>
        </Pressable>

        <Pressable
          style={styles.taskBody}
          onPress={task.isPersonal ? onToggleExpand : undefined}
          disabled={!task.isPersonal}
        >
          <Text
            style={[
              styles.taskTitle,
              wa && waStyles.taskTitle,
              { color: colors.text },
              task.completed && styles.taskTitleDone,
            ]}
          >
            {task.title}
          </Text>

          {task.isPersonal ? (
            <View style={styles.taskMetaRow}>
              <Text style={[styles.taskMeta, wa && waStyles.taskMeta, { color: colors.textTertiary }]}>
                Added by you
              </Text>
            </View>
          ) : null}

          {inlineText ? (
            <Text
              style={[
                styles.inlineHowTo,
                wa && waStyles.inlineHowTo,
                { color: colors.textSecondary },
                task.completed && styles.inlineHowToDone,
              ]}
              numberOfLines={2}
            >
              {inlineText}
            </Text>
          ) : null}
        </Pressable>

        {/* How-To sits on the same line as the title (row-level, right side).
            `link` opens the URL directly; `media`/`doc` open the viewer. */}
        {viewerType ? (
          <Pressable
            onPress={() => {
              if (howToType === "link" && task.howToUrl) {
                void Linking.openURL(task.howToUrl).catch(() => {});
              } else {
                onOpenHowTo();
              }
            }}
            hitSlop={6}
            style={[styles.howToChip, wa && waStyles.howToChip, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={
              howToType === "link"
                ? `Open link for ${task.title}`
                : `Open how-to for ${task.title}`
            }
          >
            <Ionicons
              name={VIEWER_HOW_TO_ICONS[viewerType]}
              size={13}
              color={primaryColor}
            />
            <Text
              style={[
                styles.howToChipText,
                wa && waStyles.howToChipText,
                { color: primaryColor },
              ]}
            >
              How-To
            </Text>
            <Ionicons
              name={howToType === "link" ? "open-outline" : "arrow-forward"}
              size={13}
              color={primaryColor}
            />
          </Pressable>
        ) : null}
      </View>

      {expanded && task.isPersonal ? (
        <View style={[styles.taskDetail, wa && waStyles.taskDetail]}>
          {editing ? (
            <View style={styles.editForm}>
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Task title"
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  wa && waStyles.input,
                  { color: colors.text, borderColor: colors.border },
                ]}
              />
              <TextInput
                value={editNote}
                onChangeText={setEditNote}
                placeholder="Note (optional)"
                placeholderTextColor={colors.textTertiary}
                multiline
                style={[
                  styles.input,
                  wa && waStyles.input,
                  styles.inputMultiline,
                  { color: colors.text, borderColor: colors.border },
                ]}
              />
              <View style={styles.editActions}>
                <Pressable onPress={onCancelEdit} style={styles.textButton}>
                  <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    onSaveEdit({
                      title: editTitle.trim() || task.title,
                      note: editNote.trim(),
                    })
                  }
                  style={styles.textButton}
                >
                  <Text style={{ color: primaryColor, fontWeight: "600" }}>
                    Save
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.personalActions}>
              <Pressable onPress={onEdit} style={styles.textButton}>
                <Text style={{ color: primaryColor }}>Edit</Text>
              </Pressable>
              <Pressable onPress={onDelete} style={styles.textButton}>
                <Text style={{ color: colors.error ?? "#c00" }}>Delete</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

// ============================================================================
// Add-task form
// ============================================================================

interface AddTaskFormProps {
  segment: Segment;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
  onCancel: () => void;
  onSubmit: (values: {
    title: string;
    note: string;
    timeLabel: string;
  }) => void;
}

function AddTaskForm({
  segment,
  colors,
  primaryColor,
  wa,
  onCancel,
  onSubmit,
}: AddTaskFormProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [timeLabel, setTimeLabel] = useState("");

  const canSubmit = title.trim().length > 0;

  return (
    <View style={[styles.addForm, wa && waStyles.addForm, { borderColor: colors.border }]}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Task title"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        style={[
          styles.input,
          wa && waStyles.input,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note (optional)"
        placeholderTextColor={colors.textTertiary}
        multiline
        style={[
          styles.input,
          wa && waStyles.input,
          styles.inputMultiline,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      {/* A time label only applies to "during" tasks (per service time). */}
      {segment === "during" ? (
        <TextInput
          value={timeLabel}
          onChangeText={setTimeLabel}
          placeholder="Time (e.g. 9:00 AM service)"
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.input,
            wa && waStyles.input,
            { color: colors.text, borderColor: colors.border },
          ]}
        />
      ) : null}
      <View style={styles.editActions}>
        <Pressable onPress={onCancel} style={styles.textButton}>
          <Text style={{ color: colors.textSecondary }}>Cancel</Text>
        </Pressable>
        <Pressable
          disabled={!canSubmit}
          onPress={() =>
            onSubmit({ title: title.trim(), note: note.trim(), timeLabel: timeLabel.trim() })
          }
          style={styles.textButton}
        >
          <Text
            style={{
              color: canSubmit ? primaryColor : colors.textTertiary,
              fontWeight: "600",
            }}
          >
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ============================================================================
// Section pills (Mine · Shared · Crew · All teams)
// ============================================================================

function SectionPills({
  section,
  sections,
  counts,
  onChange,
  colors,
  primaryColor,
  wa,
}: {
  section: Section;
  /** Which pills to show — the leader-only "Edit" pill is appended by the caller. */
  sections: Array<{ key: Section; label: string }>;
  counts: Record<Section, string | null>;
  onChange: (s: Section) => void;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.pillsScroll}
      contentContainerStyle={styles.pillsRow}
    >
      {sections.map(({ key, label }) => {
        const active = key === section;
        const count = counts[key];
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            style={[
              styles.pill,
              wa && waStyles.pill,
              active
                ? { backgroundColor: primaryColor, borderColor: primaryColor }
                : { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.pillText,
                wa && waStyles.pillText,
                { color: active ? "#fff" : colors.textSecondary },
              ]}
            >
              {label}
            </Text>
            {count != null ? (
              <View
                style={[
                  styles.pillBadge,
                  wa && waStyles.pillBadge,
                  {
                    backgroundColor: active
                      ? "rgba(255,255,255,0.25)"
                      : colors.background,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pillBadgeText,
                    wa && waStyles.pillBadgeText,
                    { color: active ? "#fff" : colors.textTertiary },
                  ]}
                >
                  {count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ============================================================================
// Shared (team-wide) tasks
// ============================================================================

function SharedSection({
  tasks,
  optimistic,
  colors,
  primaryColor,
  onToggle,
  onOpenHowTo,
  wa,
}: {
  tasks: SharedTask[] | undefined;
  optimistic: Record<string, boolean>;
  colors: ThemeColors;
  primaryColor: string;
  onToggle: (taskId: string, next: boolean) => void;
  onOpenHowTo: (t: SharedTask) => void;
  wa: boolean;
}) {
  if (tasks === undefined) return <SectionLoading colors={colors} />;
  if (tasks.length === 0) {
    return (
      <SectionEmpty
        icon="people-outline"
        title="No shared tasks"
        subtitle="Whole-team tasks show up here."
        colors={colors}
        wa={wa}
      />
    );
  }

  const stateOf = (t: SharedTask) => optimistic[t.taskId] ?? t.completed;

  return (
    <View style={styles.sectionBody}>
      {SEGMENTS.map(({ key, label }) => {
        const segTasks = tasks.filter((t) => t.segment === key);
        if (segTasks.length === 0) return null;
        const done = segTasks.filter(stateOf).length;
        const total = segTasks.length;
        return (
          <View key={key} style={[styles.segment, wa && waStyles.segment]}>
            <View style={styles.segmentHeader}>
              <Text
                style={[
                  styles.segmentTitle,
                  wa && waStyles.segmentTitle,
                  { color: colors.textSecondary },
                ]}
              >
                {/* S3.5: ALL-CAPS section labels are dead flag-on. */}
                {wa ? label : label.toUpperCase()}
              </Text>
              <Text
                style={[
                  styles.segmentCount,
                  wa && waStyles.segmentCount,
                  { color: colors.textTertiary },
                ]}
              >
                {done}/{total}
              </Text>
            </View>
            <ProgressBar
              progress={total > 0 ? done / total : 0}
              color={primaryColor}
              height={4}
            />
            <View
              style={[
                styles.card,
                wa && waStyles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {segTasks.map((task, i) => (
                <SharedTaskRow
                  key={task.taskId}
                  task={task}
                  completed={stateOf(task)}
                  first={i === 0}
                  colors={colors}
                  primaryColor={primaryColor}
                  wa={wa}
                  onToggle={() => onToggle(task.taskId, !stateOf(task))}
                  onOpenHowTo={() => onOpenHowTo(task)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SharedTaskRow({
  task,
  completed,
  first,
  colors,
  primaryColor,
  wa,
  onToggle,
  onOpenHowTo,
}: {
  task: SharedTask;
  completed: boolean;
  first: boolean;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
  onToggle: () => void;
  onOpenHowTo: () => void;
}) {
  const howToType = task.howToType;
  const inlineText = howToType === "text" ? task.howToText : null;
  const viewerType =
    howToType === "link" || howToType === "media" || howToType === "doc"
      ? howToType
      : null;

  return (
    <View
      style={[
        styles.taskRow,
        wa && waStyles.taskRow,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      ]}
    >
      <View style={styles.taskRowMain}>
        <Pressable
          onPress={onToggle}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
          accessibilityLabel={task.title}
          style={styles.checkboxPress}
        >
          <View
            style={[
              styles.checkbox,
              wa && waStyles.checkbox,
              completed
                ? { backgroundColor: primaryColor, borderColor: primaryColor }
                : { borderColor: colors.textTertiary },
            ]}
          >
            {completed ? (
              <Ionicons name="checkmark" size={wa ? 16 : 15} color="#fff" />
            ) : null}
          </View>
        </Pressable>

        <View style={styles.taskBody}>
          <Text
            style={[
              styles.taskTitle,
              wa && waStyles.taskTitle,
              { color: colors.text },
              completed && styles.taskTitleDone,
            ]}
          >
            {task.title}
          </Text>

          <View style={styles.taskMetaRow}>
            <View style={styles.teamCue}>
              <Ionicons name="people" size={12} color={colors.textTertiary} />
              <Text style={[styles.taskMeta, wa && waStyles.taskMeta, { color: colors.textTertiary }]}>
                Team task
              </Text>
            </View>
            {completed && task.completedByName ? (
              <Text style={[styles.taskMeta, wa && waStyles.taskMeta, { color: colors.textTertiary }]}>
                · Done by {task.completedByName}
              </Text>
            ) : null}
          </View>

          {inlineText ? (
            <Text
              style={[
                styles.inlineHowTo,
                wa && waStyles.inlineHowTo,
                { color: colors.textSecondary },
                completed && styles.inlineHowToDone,
              ]}
              numberOfLines={2}
            >
              {inlineText}
            </Text>
          ) : null}
        </View>

        {viewerType ? (
          <Pressable
            onPress={() => {
              if (howToType === "link" && task.howToUrl) {
                void Linking.openURL(task.howToUrl).catch(() => {});
              } else {
                onOpenHowTo();
              }
            }}
            hitSlop={6}
            style={[styles.howToChip, wa && waStyles.howToChip, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel={
              howToType === "link"
                ? `Open link for ${task.title}`
                : `Open how-to for ${task.title}`
            }
          >
            <Ionicons
              name={VIEWER_HOW_TO_ICONS[viewerType]}
              size={13}
              color={primaryColor}
            />
            <Text
              style={[
                styles.howToChipText,
                wa && waStyles.howToChipText,
                { color: primaryColor },
              ]}
            >
              How-To
            </Text>
            <Ionicons
              name={howToType === "link" ? "open-outline" : "arrow-forward"}
              size={13}
              color={primaryColor}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// ============================================================================
// Crew (read-only: who's doing what)
// ============================================================================

function CrewSection({
  members,
  expandedId,
  onToggleExpand,
  colors,
  primaryColor,
  wa,
}: {
  members: CrewMember[] | undefined;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  if (members === undefined) return <SectionLoading colors={colors} />;
  if (members.length === 0) {
    return (
      <SectionEmpty
        icon="people-outline"
        title="No crew yet"
        subtitle="Teammates serving this event will appear here."
        colors={colors}
        wa={wa}
      />
    );
  }

  // Group by team, preserving the query's ordering (current user first).
  const groups: Array<{ teamId: string; teamName: string; members: CrewMember[] }> = [];
  for (const m of members) {
    let g = groups.find((x) => x.teamId === m.teamId);
    if (!g) {
      g = { teamId: m.teamId, teamName: m.teamName, members: [] };
      groups.push(g);
    }
    g.members.push(m);
  }
  const showTeamHeaders = groups.length > 1;

  return (
    <View style={styles.sectionBody}>
      {groups.map((g) => (
        <View key={g.teamId} style={[styles.crewGroup, wa && waStyles.crewGroup]}>
          {showTeamHeaders ? (
            <Text
              style={[
                styles.groupHeader,
                wa && waStyles.groupHeader,
                { color: colors.textSecondary },
              ]}
            >
              {/* S3.5: ALL-CAPS section labels are dead flag-on. */}
              {wa ? g.teamName : g.teamName.toUpperCase()}
            </Text>
          ) : null}
          <View
            style={[
              styles.card,
              wa && waStyles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {g.members.map((m, i) => {
              const rowKey = `${m.userId}:${m.roleId}`;
              return (
                <CrewMemberRow
                  key={rowKey}
                  member={m}
                  first={i === 0}
                  expanded={expandedId === rowKey}
                  onToggle={() => onToggleExpand(rowKey)}
                  colors={colors}
                  primaryColor={primaryColor}
                  wa={wa}
                />
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

function CrewMemberRow({
  member,
  first,
  expanded,
  onToggle,
  colors,
  primaryColor,
  wa,
}: {
  member: CrewMember;
  first: boolean;
  expanded: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  const progress = member.total > 0 ? member.done / member.total : 0;
  const allDone = member.total > 0 && member.done === member.total;

  return (
    <View
      style={[
        styles.expandRow,
        wa && waStyles.expandRow,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        style={styles.expandHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${member.name}, ${member.roleName}`}
      >
        <View style={styles.expandInfo}>
          <View style={styles.expandTitleRow}>
            <Text
              style={[styles.expandTitle, wa && waStyles.expandTitle, { color: colors.text }]}
              numberOfLines={1}
            >
              {member.name}
            </Text>
            {/* §7 bans colored chips as a status device ("never a colored pill
                sitting where WhatsApp puts a timestamp/badge") — and
                `colors.warning` is a semantic hue outside the accent/
                destructive pair the system allows. Flag-on, both signals
                move into the subtitle as plain descriptive text; no
                affordance is lost. */}
            {!wa && member.isCurrentUser ? (
              <View style={[styles.youChip, { backgroundColor: primaryColor }]}>
                <Text style={styles.youChipText}>You</Text>
              </View>
            ) : null}
            {!wa && member.status === "unconfirmed" ? (
              <View
                style={[
                  styles.unconfirmedChip,
                  { backgroundColor: colors.warning },
                ]}
              >
                <Ionicons name="time-outline" size={11} color="#fff" />
                <Text style={styles.youChipText}>Unconfirmed</Text>
              </View>
            ) : null}
          </View>
          <Text
            style={[styles.expandSub, wa && waStyles.expandSub, { color: colors.textTertiary }]}
            numberOfLines={1}
          >
            {wa
              ? [
                  member.roleName,
                  member.isCurrentUser ? "You" : null,
                  member.status === "unconfirmed" ? "Unconfirmed" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : member.roleName}
          </Text>
        </View>
        <View style={styles.expandRight}>
          <Text
            style={[
              styles.expandCount,
              wa && waStyles.expandCount,
              { color: allDone ? primaryColor : colors.textSecondary },
            ]}
          >
            {member.done}/{member.total}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            // §3.2 chevrons are 13pt, text.tertiary, vertically centered.
            size={wa ? WA_CHEVRON_SIZE : 16}
            color={colors.textTertiary}
          />
        </View>
      </Pressable>

      <View style={styles.expandProgress}>
        <ProgressBar progress={progress} color={primaryColor} height={3} />
      </View>

      {expanded ? (
        <View style={styles.readonlyList}>
          {member.tasks.length === 0 ? (
            <Text
              style={[
                styles.readonlyEmpty,
                wa && waStyles.readonlyEmpty,
                { color: colors.textTertiary },
              ]}
            >
              No tasks assigned.
            </Text>
          ) : (
            member.tasks.map((t) => (
              <ReadOnlyTaskItem
                key={t.taskId}
                title={t.title}
                completed={t.completed}
                howToType={t.howToType}
                colors={colors}
                primaryColor={primaryColor}
                wa={wa}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

// ============================================================================
// All teams (read-only: whole-event overview)
// ============================================================================

function AllTeamsSection({
  teams,
  expandedId,
  onToggleExpand,
  colors,
  primaryColor,
  wa,
}: {
  teams: AllTeamsTeam[] | undefined;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  if (teams === undefined) return <SectionLoading colors={colors} />;
  if (teams.length === 0) {
    return (
      <SectionEmpty
        icon="grid-outline"
        title="No teams"
        subtitle="Teams serving this event will appear here."
        colors={colors}
        wa={wa}
      />
    );
  }

  return (
    <View style={styles.sectionBody}>
      <View
        style={[
          styles.card,
          wa && waStyles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {teams.map((team, i) => (
          <TeamRow
            key={team.teamId}
            team={team}
            first={i === 0}
            expanded={expandedId === team.teamId}
            onToggle={() => onToggleExpand(team.teamId)}
            colors={colors}
            primaryColor={primaryColor}
            wa={wa}
          />
        ))}
      </View>
    </View>
  );
}

function TeamRow({
  team,
  first,
  expanded,
  onToggle,
  colors,
  primaryColor,
  wa,
}: {
  team: AllTeamsTeam;
  first: boolean;
  expanded: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  const progress = team.total > 0 ? team.done / team.total : 0;
  const allDone = team.total > 0 && team.done === team.total;

  return (
    <View
      style={[
        styles.expandRow,
        wa && waStyles.expandRow,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
      ]}
    >
      <Pressable
        onPress={onToggle}
        style={styles.expandHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={team.teamName}
      >
        <View style={styles.expandInfo}>
          <Text
            style={[styles.expandTitle, wa && waStyles.expandTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {team.teamName}
          </Text>
        </View>
        <View style={styles.expandRight}>
          <Text
            style={[
              styles.expandCount,
              wa && waStyles.expandCount,
              { color: allDone ? primaryColor : colors.textSecondary },
            ]}
          >
            {team.done}/{team.total}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            // §3.2 chevrons are 13pt, text.tertiary, vertically centered.
            size={wa ? WA_CHEVRON_SIZE : 16}
            color={colors.textTertiary}
          />
        </View>
      </Pressable>

      <View style={styles.expandProgress}>
        <ProgressBar progress={progress} color={primaryColor} height={3} />
      </View>

      {expanded ? (
        <View style={styles.readonlyList}>
          {team.tasks.length === 0 ? (
            <Text
              style={[
                styles.readonlyEmpty,
                wa && waStyles.readonlyEmpty,
                { color: colors.textTertiary },
              ]}
            >
              No tasks yet.
            </Text>
          ) : (
            team.tasks.map((t) => (
              <ReadOnlyTaskItem
                key={t.taskId}
                title={t.title}
                meta={t.roleNames.length > 0 ? t.roleNames.join(", ") : undefined}
                completed={t.completed}
                howToType={t.howToType}
                colors={colors}
                primaryColor={primaryColor}
                wa={wa}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

// ============================================================================
// Author (leader-only): add/edit/delete a role's shared tasks, in place.
//
// Lets a leader add a task "real quick" to a role — or fix one that's wrong
// for today — without leaving serving mode for the rostering grid (the WHY:
// "you wouldn't need your laptop to do this... it's a little bit of friction
// to add a task"). A role switcher lets them view the list AS a given role
// sees it and author against that role, reusing the same `listPlanTasks` /
// `createTask` / `updateTask` / `deleteTask` the desktop grid uses — no new
// backend surface. Gated by `canAuthorPlanTasks` (mirrors the mutations' own
// `isGroupScheduler` check) one level up, in `ServingTasksPlanSection`.
//
// OFFLINE: deliberately online-only. Unlike task *completion* (idempotent,
// explicit desired-state booleans — see `servingTaskQueue.ts`), `createTask`
// has no dedupe key, so replaying a queued create after reconnect would
// create a DUPLICATE shared task every teammate in that role would see —
// worse than the write simply failing. These are the plan's shared,
// authoritative tasks (ADR-028's "when offline is NOT worth it": data
// requiring server validation to be safe), so the add/edit/delete controls
// are hidden (not merely disabled) while offline, with a banner explaining
// why, rather than accepting input that silently gets dropped.
// ============================================================================

/** The slice of a `listPlanTasks` row this section reads. */
type AuthorTask = {
  _id: string;
  teamIds: string[];
  roleIds: string[];
  segment: Segment;
  title: string;
  sortOrder: number;
};

function AuthorSection({
  planId,
  groupId,
  isEffectivelyOffline,
  colors,
  primaryColor,
  wa,
}: {
  planId: Id<"eventPlans">;
  groupId: Id<"groups">;
  isEffectivelyOffline: boolean;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  const teams = useAuthenticatedQuery(api.functions.scheduling.teams.listTeams, {
    groupId,
  }) as Array<{ _id: Id<"teams">; name: string }> | undefined;

  const planTasks = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.listPlanTasks,
    { planId },
  ) as AuthorTask[] | undefined;

  const createTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.createTask,
  );
  const updateTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.updateTask,
  );
  const deleteTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.deleteTask,
  );

  // Role catalog: one `listRoles` call per team, mirroring the desktop grid's
  // `RoleLoader` pattern (EventTasksScreen.tsx) rather than a bespoke join
  // query — "reuse whatever role list the plan already exposes."
  const [rolesByTeam, setRolesByTeam] = useState<
    Record<string, Array<{ _id: string; name: string }>>
  >({});
  const setRolesForTeam = useCallback(
    (teamId: string, roles: Array<{ _id: string; name: string }>) => {
      setRolesByTeam((prev) => ({ ...prev, [teamId]: roles }));
    },
    [],
  );
  const roleCatalog = useMemo(
    () => buildRoleCatalog(teams ?? [], rolesByTeam),
    [teams, rolesByTeam],
  );

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedRoleId && roleCatalog.length > 0) {
      setSelectedRoleId(roleCatalog[0].roleId);
    }
  }, [selectedRoleId, roleCatalog]);
  const selectedRole: RoleCatalogEntry | undefined = roleCatalog.find(
    (r) => r.roleId === selectedRoleId,
  );

  // Team-scoped: `listPlanTasks` is plan-wide and the role catalog spans every
  // team in the group, so team-level tasks must be matched on the SELECTED
  // role's team or a leader would see (and be able to delete) another team's.
  const bySegment = useMemo(
    () => tasksForRole(planTasks ?? [], selectedRole ?? null),
    [planTasks, selectedRole],
  );

  const [addingSegment, setAddingSegment] = useState<Segment | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  if (teams === undefined || planTasks === undefined) {
    // A brand-new (never-resolved) query stays undefined while offline (see
    // ADR-028) — show the offline notice instead of spinning forever.
    if (isEffectivelyOffline) {
      return <AuthorOfflineNotice colors={colors} wa={wa} />;
    }
    return <SectionLoading colors={colors} />;
  }

  return (
    <View style={styles.sectionBody}>
      {/* Always mounted once `teams` resolves — regardless of whether the
          catalog is empty YET — so each team's roles can load in and fill it.
          (Rendering these only inside the "catalog non-empty" branch below
          would be a chicken-and-egg deadlock: nothing would ever load.) */}
      {teams.map((team) => (
        <RoleLoader key={team._id} teamId={team._id} onLoaded={setRolesForTeam} />
      ))}

      {roleCatalog.length === 0 ? (
        <SectionEmpty
          icon="person-outline"
          title="No roles yet"
          subtitle="Add a role to one of this campus's teams to start authoring tasks."
          colors={colors}
          wa={wa}
        />
      ) : (
        <AuthorRoleAndSegments
          roleCatalog={roleCatalog}
          selectedRoleId={selectedRoleId}
          selectedRole={selectedRole}
          onSelectRole={setSelectedRoleId}
          bySegment={bySegment}
          planId={planId}
          isEffectivelyOffline={isEffectivelyOffline}
          addingSegment={addingSegment}
          setAddingSegment={setAddingSegment}
          editingTaskId={editingTaskId}
          setEditingTaskId={setEditingTaskId}
          createTask={createTask}
          updateTask={updateTask}
          deleteTask={deleteTask}
          colors={colors}
          primaryColor={primaryColor}
          wa={wa}
        />
      )}
    </View>
  );
}

/**
 * The role switcher + Before/During/After segments — split out from
 * `AuthorSection` purely so that component's early-return ladder (loading /
 * offline / empty-catalog) stays simple; this is the "catalog non-empty"
 * render, unchanged in behavior from being inline.
 */
function AuthorRoleAndSegments({
  roleCatalog,
  selectedRoleId,
  selectedRole,
  onSelectRole,
  bySegment,
  planId,
  isEffectivelyOffline,
  addingSegment,
  setAddingSegment,
  editingTaskId,
  setEditingTaskId,
  createTask,
  updateTask,
  deleteTask,
  colors,
  primaryColor,
  wa,
}: {
  roleCatalog: RoleCatalogEntry[];
  selectedRoleId: string | null;
  selectedRole: RoleCatalogEntry | undefined;
  onSelectRole: (roleId: string) => void;
  bySegment: Record<Segment, AuthorTask[]>;
  planId: Id<"eventPlans">;
  isEffectivelyOffline: boolean;
  addingSegment: Segment | null;
  setAddingSegment: (s: Segment | null) => void;
  editingTaskId: string | null;
  setEditingTaskId: (id: string | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createTask: (args: any) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTask: (args: any) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteTask: (args: any) => Promise<unknown>;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillsScroll}
        contentContainerStyle={styles.pillsRow}
      >
        {roleCatalog.map((role) => {
          const active = role.roleId === selectedRoleId;
          return (
            <Pressable
              key={role.roleId}
              onPress={() => onSelectRole(role.roleId)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`View and edit ${role.teamName} ${role.roleName} tasks`}
              style={[
                styles.pill,
                wa && waStyles.pill,
                active
                  ? { backgroundColor: primaryColor, borderColor: primaryColor }
                  : { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                  wa && waStyles.pillText,
                  { color: active ? colors.onAccent : colors.textSecondary },
                ]}
              >
                {role.teamName} · {role.roleName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {selectedRole ? (
        <Text
          style={[
            styles.authorHint,
            wa && waStyles.authorHint,
            { color: colors.textTertiary },
          ]}
        >
          Editing what {selectedRole.roleName} sees — changes are visible to everyone in that role.
        </Text>
      ) : null}

      {isEffectivelyOffline ? <AuthorOfflineNotice colors={colors} wa={wa} /> : null}

      {SEGMENTS.map(({ key, label }) => {
        const segTasks = bySegment[key];
        return (
          <View key={key} style={[styles.segment, wa && waStyles.segment]}>
            <Text
              style={[
                styles.segmentTitle,
                wa && waStyles.segmentTitle,
                { color: colors.textSecondary },
              ]}
            >
              {wa ? label : label.toUpperCase()}
            </Text>
            <View
              style={[
                styles.card,
                wa && waStyles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {segTasks.length === 0 ? (
                <Text
                  style={[
                    styles.cardEmpty,
                    wa && waStyles.cardEmpty,
                    { color: colors.textTertiary },
                  ]}
                >
                  No tasks yet for this role.
                </Text>
              ) : (
                segTasks.map((task, i) => (
                  <AuthorTaskRow
                    key={task._id}
                    title={task.title}
                    teamLevel={isTeamLevelTask(task)}
                    first={i === 0}
                    editable={!isEffectivelyOffline}
                    editing={editingTaskId === task._id}
                    colors={colors}
                    primaryColor={primaryColor}
                    wa={wa}
                    onStartEdit={() => setEditingTaskId(task._id)}
                    onCancelEdit={() => setEditingTaskId(null)}
                    onSave={async (title) => {
                      try {
                        await updateTask({
                          taskId: task._id as Id<"eventTasks">,
                          title,
                        });
                        setEditingTaskId(null);
                      } catch (err) {
                        notify(
                          "Couldn't save task",
                          String((err as Error)?.message ?? err),
                        );
                      }
                    }}
                    onDelete={async () => {
                      try {
                        await deleteTask({ taskId: task._id as Id<"eventTasks"> });
                        setEditingTaskId(null);
                      } catch (err) {
                        notify(
                          "Couldn't delete task",
                          String((err as Error)?.message ?? err),
                        );
                      }
                    }}
                  />
                ))
              )}
            </View>

            {isEffectivelyOffline ? null : addingSegment === key ? (
              <AuthorAddTaskForm
                colors={colors}
                primaryColor={primaryColor}
                wa={wa}
                onCancel={() => setAddingSegment(null)}
                onSubmit={async (title) => {
                  if (!selectedRole) return;
                  try {
                    await createTask({
                      planId,
                      teamIds: [selectedRole.teamId as Id<"teams">],
                      roleIds: [selectedRole.roleId as Id<"teamRoles">],
                      segment: key,
                      title,
                      howToType: "none",
                    });
                    setAddingSegment(null);
                  } catch (err) {
                    notify("Couldn't add task", String((err as Error)?.message ?? err));
                  }
                }}
              />
            ) : (
              <Pressable
                onPress={() => setAddingSegment(key)}
                style={styles.addButton}
                accessibilityRole="button"
                accessibilityLabel={`Add a ${label} task for ${selectedRole?.roleName ?? "this role"}`}
              >
                <Ionicons name="add" size={17} color={primaryColor} />
                <Text
                  style={[
                    styles.addButtonText,
                    wa && waStyles.addButtonText,
                    { color: primaryColor },
                  ]}
                >
                  Add task
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </>
  );
}

/** Loads one team's roles and reports them up — mirrors `EventTasksScreen`'s
 *  `RoleLoader`, rendered once per team so the role switcher fills in without
 *  a bespoke join query. */
function RoleLoader({
  teamId,
  onLoaded,
}: {
  teamId: Id<"teams">;
  onLoaded: (teamId: string, roles: Array<{ _id: string; name: string }>) => void;
}) {
  const roles = useAuthenticatedQuery(api.functions.scheduling.roles.listRoles, {
    teamId,
  }) as Array<{ _id: Id<"teamRoles">; name: string }> | undefined;

  useEffect(() => {
    if (roles) {
      onLoaded(
        teamId as string,
        roles.map((r) => ({ _id: r._id as string, name: r.name })),
      );
    }
  }, [roles, teamId, onLoaded]);

  return null;
}

/** One task row in the Edit surface: title, tap-to-edit (title only) when
 *  online; read-only when offline (see the OFFLINE note above).
 *
 *  `teamLevel` rows belong to the WHOLE TEAM, not the role currently selected
 *  in the switcher — they show under every role (that's the only place a
 *  leader can reach them), so they carry a caption saying so. */
function AuthorTaskRow({
  title,
  teamLevel,
  first,
  editable,
  editing,
  colors,
  primaryColor,
  wa,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  title: string;
  teamLevel: boolean;
  first: boolean;
  editable: boolean;
  editing: boolean;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (title: string) => void;
  onDelete: () => void;
}) {
  const [editTitle, setEditTitle] = useState(title);

  return (
    <View
      style={[
        styles.taskRow,
        wa && waStyles.taskRow,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
      ]}
    >
      <Pressable
        style={styles.taskBody}
        onPress={editable ? onStartEdit : undefined}
        disabled={!editable}
        accessibilityRole={editable ? "button" : undefined}
        accessibilityLabel={editable ? `Edit ${title}` : title}
      >
        <Text style={[styles.taskTitle, wa && waStyles.taskTitle, { color: colors.text }]}>
          {title}
        </Text>
        {teamLevel ? (
          <View style={styles.taskMetaRow}>
            <Text
              style={[
                styles.taskMeta,
                wa && waStyles.taskMeta,
                { color: colors.textTertiary },
              ]}
            >
              Whole team — not just this role
            </Text>
          </View>
        ) : null}
      </Pressable>

      {editing && editable ? (
        <View style={[styles.taskDetail, wa && waStyles.taskDetail, { paddingLeft: 0 }]}>
          <View style={styles.editForm}>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Task title"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              style={[
                styles.input,
                wa && waStyles.input,
                { color: colors.text, borderColor: colors.border },
              ]}
            />
            <View style={styles.editActions}>
              <Pressable onPress={onCancelEdit} style={styles.textButton}>
                <Text style={{ color: colors.textSecondary }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={onDelete} style={styles.textButton}>
                <Text style={{ color: colors.error }}>Delete</Text>
              </Pressable>
              <Pressable
                onPress={() => onSave(editTitle.trim() || title)}
                style={styles.textButton}
              >
                <Text style={{ color: primaryColor, fontWeight: "600" }}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Inline "add a task" form for the Edit surface — title only (no how-to
 *  authoring: friction removal, not deepening what a task IS — see the work
 *  order's non-goals). */
function AuthorAddTaskForm({
  colors,
  primaryColor,
  wa,
  onCancel,
  onSubmit,
}: {
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const canSubmit = title.trim().length > 0;

  return (
    <View style={[styles.addForm, wa && waStyles.addForm, { borderColor: colors.border }]}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Task title"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        style={[
          styles.input,
          wa && waStyles.input,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <View style={styles.editActions}>
        <Pressable onPress={onCancel} style={styles.textButton}>
          <Text style={{ color: colors.textSecondary }}>Cancel</Text>
        </Pressable>
        <Pressable
          disabled={!canSubmit}
          onPress={() => onSubmit(title.trim())}
          style={styles.textButton}
        >
          <Text
            style={{
              color: canSubmit ? primaryColor : colors.textTertiary,
              fontWeight: "600",
            }}
          >
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Explains why the Edit surface's write controls are hidden — authoring is
 *  deliberately online-only (see the OFFLINE note above), not silently
 *  dropped or queued. */
function AuthorOfflineNotice({ colors, wa }: { colors: ThemeColors; wa: boolean }) {
  return (
    <View
      style={[
        styles.noticeCard,
        wa && waStyles.noticeCard,
        { backgroundColor: colors.surface, borderColor: colors.border, marginHorizontal: 16 },
      ]}
    >
      <Ionicons name="cloud-offline-outline" size={20} color={colors.textSecondary} />
      <View style={styles.noticeBody}>
        <Text style={[styles.noticeMessage, wa && waStyles.noticeMessage, { color: colors.text }]}>
          You're offline
        </Text>
        <Text style={[styles.noticeHint, wa && waStyles.noticeHint, { color: colors.textTertiary }]}>
          Adding or changing shared tasks needs a connection. Reconnect to make changes.
        </Text>
      </View>
    </View>
  );
}

// ============================================================================
// Shared bits for the read-only sections
// ============================================================================

/** A non-interactive task line: done indicator, title, optional meta + quiet
 *  how-to hint. Used by both Crew and All-teams. */
function ReadOnlyTaskItem({
  title,
  meta,
  completed,
  howToType,
  colors,
  primaryColor,
  wa,
}: {
  title: string;
  meta?: string;
  completed: boolean;
  howToType: HowToType;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  return (
    <View style={styles.roItem}>
      <Ionicons
        name={completed ? "checkmark-circle" : "ellipse-outline"}
        size={18}
        color={completed ? primaryColor : colors.textTertiary}
      />
      <View style={styles.roItemBody}>
        <Text
          style={[
            styles.roItemTitle,
            wa && waStyles.roItemTitle,
            { color: colors.text },
            completed && styles.taskTitleDone,
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {meta ? (
          <Text
            style={[
              styles.roItemMeta,
              wa && waStyles.roItemMeta,
              { color: colors.textTertiary },
            ]}
            numberOfLines={1}
          >
            {meta}
          </Text>
        ) : null}
      </View>
      {howToType !== "none" ? (
        <Ionicons
          name="help-circle-outline"
          size={16}
          color={colors.textTertiary}
        />
      ) : null}
    </View>
  );
}

/** Quiet banner shown when the tab is rendering a saved (offline) copy. */
function OfflineBanner({ colors, wa }: { colors: ThemeColors; wa: boolean }) {
  return (
    <View
      style={[
        styles.offlineBanner,
        wa && waStyles.offlineBanner,
        { backgroundColor: colors.surface },
      ]}
    >
      <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
      <Text
        style={[
          styles.offlineBannerText,
          wa && waStyles.offlineBannerText,
          { color: colors.textSecondary },
        ]}
      >
        Offline · showing your saved copy
      </Text>
    </View>
  );
}

/**
 * Shown at the top of the "Mine" section when the viewer has no preloaded
 * (template) tasks — and says WHICH of the several possible reasons applies
 * (`diagnoseMineEmpty`). The per-segment "Add my own task" affordances stay
 * available underneath in every case.
 *
 * Two extra affordances hang off it:
 *   • a one-tap jump to "Shared" whenever the team HAS whole-team tasks — the
 *     screen opens on "Mine" and `getMyServingTasks` deliberately omits
 *     team-level tasks, so otherwise the viewer has to guess they exist;
 *   • for a leader on a plan with NO tasks, `PopulateFromTemplate` — the
 *     nothing-backfills-a-new-plan case is theirs to fix, in place.
 */
function MineEmptyNotice({
  reason,
  facts,
  onViewShared,
  leader,
  colors,
  primaryColor,
  wa,
}: {
  reason: MineEmptyReason;
  facts: MineEmptyFacts;
  onViewShared: () => void;
  /** Non-null only for a leader on a plan with zero tasks (see `canAuthorPlanTasks`). */
  leader: {
    planId: Id<"eventPlans">;
    groupId: Id<"groups">;
    isEffectivelyOffline: boolean;
  } | null;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  const copy = mineEmptyCopy(reason, facts);
  if (!copy) return null;

  return (
    <View style={[styles.segment, wa && waStyles.segment]}>
      <View
        style={[
          styles.noticeCard,
          wa && waStyles.noticeCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={colors.textSecondary}
        />
        <View style={styles.noticeBody}>
          <Text
            style={[styles.noticeMessage, wa && waStyles.noticeMessage, { color: colors.text }]}
          >
            {copy.title}
          </Text>
          <Text
            style={[
              styles.noticeHint,
              wa && waStyles.noticeHint,
              { color: colors.textTertiary },
            ]}
          >
            {copy.hint}
          </Text>

          {facts.sharedTaskCount > 0 ? (
            <Pressable
              onPress={onViewShared}
              style={styles.noticeAction}
              accessibilityRole="button"
              accessibilityLabel="Open the Shared tab"
            >
              <Text
                style={[
                  styles.noticeActionText,
                  wa && waStyles.noticeActionText,
                  { color: primaryColor },
                ]}
              >
                {`Open Shared (${facts.sharedTaskCount})`}
              </Text>
              <Ionicons name="arrow-forward" size={15} color={primaryColor} />
            </Pressable>
          ) : null}

          {leader ? (
            <PopulateFromTemplate
              planId={leader.planId}
              groupId={leader.groupId}
              isEffectivelyOffline={leader.isEffectivelyOffline}
              colors={colors}
              primaryColor={primaryColor}
              wa={wa}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * Leader-only: fill an EMPTY plan's task list from one of the group's saved
 * task templates, without leaving serving mode.
 *
 * A plan created by `createEventDraftImpl` has no `taskTemplateId` and no
 * tasks, and nothing ever backfills it — tasks only materialise when someone
 * links a template from the rostering grid (or duplicates an event). That grid
 * is where a leader would otherwise have to go, on a laptop, mid-service. This
 * calls the SAME existing `setPlanTaskTemplate` mutation the grid uses (no new
 * backend surface); the default `carryover` is irrelevant here because the
 * plan has no rows to carry over.
 *
 * Only rendered when the plan has zero tasks, so there is nothing to destroy
 * and no confirmation step is warranted.
 *
 * OFFLINE: hidden, for the same reason `AuthorSection` hides its controls —
 * this is a plan-wide, server-validated write with no dedupe key.
 */
function PopulateFromTemplate({
  planId,
  groupId,
  isEffectivelyOffline,
  colors,
  primaryColor,
  wa,
}: {
  planId: Id<"eventPlans">;
  groupId: Id<"groups">;
  isEffectivelyOffline: boolean;
  colors: ThemeColors;
  primaryColor: string;
  wa: boolean;
}) {
  const templates = useAuthenticatedQuery(
    api.functions.scheduling.taskTemplates.listTaskTemplates,
    isEffectivelyOffline ? "skip" : { groupId },
  ) as Array<{ _id: string; name: string; itemCount: number }> | undefined;
  const setPlanTaskTemplate = useAuthenticatedMutation(
    api.functions.scheduling.planTemplates.setPlanTaskTemplate,
  );
  const [applyingId, setApplyingId] = useState<string | null>(null);

  if (isEffectivelyOffline || templates === undefined) return null;

  // A template with no items would link cleanly and still leave the plan empty.
  const usable = templates.filter((t) => t.itemCount > 0);

  if (usable.length === 0) {
    return (
      <Text
        style={[
          styles.noticeHint,
          wa && waStyles.noticeHint,
          { color: colors.textTertiary },
        ]}
      >
        This campus has no saved task lists yet. Use the Edit tab above to add
        tasks role by role.
      </Text>
    );
  }

  return (
    <View style={styles.noticeActions}>
      <Text
        style={[
          styles.noticeHint,
          wa && waStyles.noticeHint,
          { color: colors.textTertiary },
        ]}
      >
        Add this event&apos;s tasks from a saved list:
      </Text>
      {usable.map((template) => (
        <Pressable
          key={template._id}
          disabled={applyingId !== null}
          onPress={async () => {
            setApplyingId(template._id);
            try {
              await setPlanTaskTemplate({
                planId,
                templateId: template._id as Id<"eventTaskTemplates">,
              });
            } catch (err) {
              notify(
                "Couldn't add these tasks",
                String((err as Error)?.message ?? err),
              );
            } finally {
              setApplyingId(null);
            }
          }}
          style={styles.noticeAction}
          accessibilityRole="button"
          accessibilityLabel={`Add tasks from ${template.name}`}
        >
          <Ionicons name="add" size={16} color={primaryColor} />
          <Text
            style={[
              styles.noticeActionText,
              wa && waStyles.noticeActionText,
              { color: primaryColor },
            ]}
          >
            {`${template.name} · ${template.itemCount} ${
              template.itemCount === 1 ? "task" : "tasks"
            }`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function SectionLoading({ colors }: { colors: ThemeColors }) {
  return (
    <View style={styles.inlineLoading}>
      <ActivityIndicator size="small" color={colors.text} />
    </View>
  );
}

function SectionEmpty({
  icon,
  title,
  subtitle,
  colors,
  wa,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  colors: ThemeColors;
  wa: boolean;
}) {
  return (
    <View style={styles.sectionEmpty}>
      <Ionicons name={icon} size={30} color={colors.textTertiary} />
      <Text
        style={[
          styles.sectionEmptyTitle,
          wa && waStyles.sectionEmptyTitle,
          { color: colors.textSecondary },
        ]}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={[
            styles.sectionEmptySub,
            wa && waStyles.sectionEmptySub,
            { color: colors.textTertiary },
          ]}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // One stacked plan section. The big ServingHeader title acts as the visual
  // separator between plans; a little bottom room keeps adjacent plans distinct.
  planSection: { marginBottom: 12 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  emptyText: { fontSize: 15, textAlign: "center" },
  inlineLoading: { paddingVertical: 48, alignItems: "center" },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  offlineBannerText: { fontSize: 13, fontWeight: "500" },

  // Header
  header: { paddingHorizontal: 16, marginBottom: 20 },
  headerTitle: { fontSize: 26, fontWeight: "700", letterSpacing: -0.4 },
  headerWhen: { fontSize: 14, marginTop: 4 },
  readiness: { marginTop: 16, gap: 8 },
  readinessLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  readinessLabel: { fontSize: 13, fontWeight: "500" },
  readinessCount: { fontSize: 13, fontWeight: "700" },

  // Segments
  segment: { paddingHorizontal: 16, marginBottom: 24 },
  segmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  segmentTitle: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8 },
  segmentCount: { fontSize: 12, fontWeight: "600" },
  card: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardEmpty: { fontSize: 14, fontStyle: "italic", padding: 16 },

  // "No preloaded task" notice (Mine section, role with no assigned tasks)
  noticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  noticeBody: { flex: 1 },
  noticeMessage: { fontSize: 14, lineHeight: 20, fontWeight: "500" },
  noticeHint: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  // Actions inside the "Mine" empty-state notice (jump to Shared; a leader's
  // "populate from a saved task list" rows).
  noticeActions: { marginTop: 4 },
  noticeAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  noticeActionText: { fontSize: 14, fontWeight: "600" },

  // Author (leader "Edit" surface) role-switcher caption
  authorHint: {
    fontSize: 13,
    lineHeight: 18,
    marginHorizontal: 16,
    marginBottom: 12,
  },

  // Task rows
  taskRow: { paddingHorizontal: 14, paddingVertical: 12 },
  taskRowMain: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  checkboxPress: { paddingTop: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  taskBody: { flex: 1 },
  taskTitle: { fontSize: 15, lineHeight: 20, fontWeight: "500" },
  taskTitleDone: { textDecorationLine: "line-through", opacity: 0.5 },
  taskMetaRow: { flexDirection: "row", gap: 8, marginTop: 3 },
  taskMeta: { fontSize: 12 },
  inlineHowTo: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  inlineHowToDone: { opacity: 0.5 },
  howToChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    flexShrink: 0,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  howToChipText: { fontSize: 12, fontWeight: "600" },
  taskDetail: { paddingLeft: 34, paddingTop: 10 },
  personalActions: { flexDirection: "row", gap: 16 },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    marginTop: 6,
  },
  addButtonText: { fontSize: 14, fontWeight: "600" },
  addForm: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    gap: 8,
  },
  editForm: { gap: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 60, textAlignVertical: "top" },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
  },
  textButton: { paddingVertical: 6, paddingHorizontal: 4 },

  // Section pills
  pillsScroll: { marginBottom: 20 },
  pillsRow: { paddingHorizontal: 16, gap: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: { fontSize: 14, fontWeight: "600" },
  pillBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  pillBadgeText: { fontSize: 11, fontWeight: "700" },

  // Shared / read-only section wrappers
  sectionBody: {},
  teamCue: { flexDirection: "row", alignItems: "center", gap: 4 },

  // Crew grouping
  crewGroup: { paddingHorizontal: 16, marginBottom: 20 },
  groupHeader: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  // Expandable rows (crew members + teams)
  expandRow: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 },
  expandHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  expandInfo: { flex: 1 },
  expandTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  expandTitle: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
  expandSub: { fontSize: 13, marginTop: 2 },
  expandRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  expandCount: { fontSize: 13, fontWeight: "700" },
  expandProgress: { marginTop: 10 },
  youChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  youChipText: { fontSize: 10, fontWeight: "700", color: "#fff", letterSpacing: 0.3 },
  unconfirmedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },

  // Read-only task lists (inside expanded crew/team rows)
  readonlyList: { marginTop: 12, gap: 10 },
  readonlyEmpty: { fontSize: 13, fontStyle: "italic" },
  roItem: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  roItemBody: { flex: 1 },
  roItemTitle: { fontSize: 14, lineHeight: 19, fontWeight: "500" },
  roItemMeta: { fontSize: 12, marginTop: 2 },

  // Per-section empty state
  sectionEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 56,
    gap: 8,
  },
  sectionEmptyTitle: { fontSize: 16, fontWeight: "600" },
  sectionEmptySub: { fontSize: 14, textAlign: "center", lineHeight: 19 },
});

/**
 * `whatsapp-shell` (flag-on) style overrides — applied as
 * `style={[styles.x, wa && waStyles.x]}` so flag-off renders `styles`
 * byte-for-byte and only flag-on picks these up.
 *
 * This is a SKIN, not a restructure: every affordance, handler and piece of
 * offline plumbing is untouched. What changes is the vocabulary
 * (WHATSAPP-DESIGN-SYSTEM.md §7's four primitives — rows, inset-grouped
 * cells, bubbles, pills):
 *
 *  - Cards go from radius-14 hairline-bordered boxes to §3.2 inset-grouped
 *    cards: 24pt radius, no border.
 *  - Rows get the §3.2 54pt minimum height and 16pt cell padding.
 *  - Type moves onto the S7 scale (17 / 15 / 13) — the pre-pass sizes ran
 *    "1–2pt small and one weight light throughout".
 *  - ALL-CAPS 12pt letter-spaced section labels are dead (S3.5); they become
 *    sentence-case 15pt gray. The `toUpperCase()` calls are dropped at the
 *    call sites, not here.
 *  - Chevrons drop to 13pt (WA_CHEVRON_SIZE).
 *  - The offline banner becomes a pill rather than a rounded card.
 *  - Italics (`cardEmpty`, `readonlyEmpty`) aren't in the system at all.
 *
 * The "You" / "Unconfirmed" colored chips are removed at their call site
 * (see `CrewMemberRow`) rather than restyled — §7 bans colored chips as a
 * status device outright, so they fold into the row's subtitle text.
 */
const waStyles = StyleSheet.create({
  // Header (§2 header block)
  headerTitle: {
    fontSize: WA_TYPE_HEADER_BLOCK,
    fontWeight: WA_WEIGHT_BOLD,
    letterSpacing: 0,
  },
  headerWhen: { fontSize: WA_TYPE_SUBTITLE, marginTop: 6 },
  readinessLabel: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },
  readinessCount: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },

  // Segments — sentence-case section labels above 24pt inset cards.
  segment: { paddingHorizontal: WA_GROUP_MARGIN, marginBottom: WA_GROUP_SPACING },
  segmentTitle: {
    fontSize: WA_SECTION_LABEL_SIZE,
    fontWeight: WA_WEIGHT_REGULAR,
    letterSpacing: 0,
  },
  segmentCount: { fontSize: WA_SECTION_LABEL_SIZE, fontWeight: WA_WEIGHT_REGULAR },
  card: { borderRadius: WA_GROUP_RADIUS, borderWidth: 0, marginTop: WA_SECTION_HEADER_GAP },
  cardEmpty: { fontSize: WA_TYPE_SUBTITLE, fontStyle: "normal", padding: WA_CELL_PADDING },

  noticeCard: { borderRadius: WA_GROUP_RADIUS, borderWidth: 0, padding: WA_CELL_PADDING },
  noticeMessage: { fontSize: WA_TYPE_ROW_TITLE, lineHeight: 22, fontWeight: WA_WEIGHT_REGULAR },
  noticeHint: { fontSize: WA_TYPE_FOOTNOTE, lineHeight: 18 },
  noticeActionText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  authorHint: { fontSize: WA_TYPE_FOOTNOTE, marginHorizontal: WA_GROUP_MARGIN },

  // Task rows (§3.2 cell anatomy)
  taskRow: {
    paddingHorizontal: WA_CELL_PADDING,
    paddingVertical: 12,
    minHeight: WA_CELL_MIN_HEIGHT,
    justifyContent: "center",
  },
  checkbox: { width: 24, height: 24, borderRadius: 12 },
  taskTitle: {
    fontSize: WA_TYPE_ROW_TITLE,
    lineHeight: 22,
    fontWeight: WA_WEIGHT_REGULAR,
  },
  taskMeta: { fontSize: WA_TYPE_FOOTNOTE },
  inlineHowTo: { fontSize: WA_TYPE_SUBTITLE, lineHeight: 20 },
  // Pill, per §7's pill vocabulary — outlined, accent text.
  howToChip: { paddingHorizontal: 12, paddingVertical: 6 },
  howToChipText: { fontSize: WA_TYPE_FOOTNOTE, fontWeight: WA_WEIGHT_SEMIBOLD },
  taskDetail: { paddingLeft: 36 },

  // §3.2 "plain accent-colored action text, no icon, no chevron" row.
  addButtonText: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_REGULAR },
  addForm: { borderRadius: WA_GROUP_RADIUS, borderWidth: 0, padding: WA_CELL_PADDING },
  input: {
    borderRadius: 18,
    borderWidth: 0,
    fontSize: WA_TYPE_ROW_TITLE,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },

  // Section pills (§7: unselected = card fill + separator border, selected = accent)
  pill: { paddingHorizontal: 16, paddingVertical: 9 },
  pillText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  pillBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 8 },
  pillBadgeText: { fontSize: 12, fontWeight: WA_WEIGHT_BOLD },

  // Crew grouping
  crewGroup: { paddingHorizontal: WA_GROUP_MARGIN, marginBottom: WA_GROUP_SPACING },
  groupHeader: {
    fontSize: WA_SECTION_LABEL_SIZE,
    fontWeight: WA_WEIGHT_REGULAR,
    letterSpacing: 0,
    marginBottom: WA_SECTION_HEADER_GAP,
  },

  // Expandable crew/team rows
  expandRow: {
    paddingHorizontal: WA_CELL_PADDING,
    paddingTop: 14,
    paddingBottom: 12,
    minHeight: WA_CELL_MIN_HEIGHT,
  },
  expandTitle: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_REGULAR },
  expandSub: { fontSize: WA_TYPE_SUBTITLE, marginTop: 3 },
  expandCount: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },

  // Read-only task lists inside an expanded row
  readonlyEmpty: { fontSize: WA_TYPE_SUBTITLE, fontStyle: "normal" },
  roItemTitle: { fontSize: WA_TYPE_SUBTITLE, lineHeight: 20, fontWeight: WA_WEIGHT_REGULAR },
  roItemMeta: { fontSize: WA_TYPE_FOOTNOTE },

  // Status strip — a pill, not a rounded card (§6: banners aren't cards).
  offlineBanner: { borderRadius: 999, marginHorizontal: WA_GROUP_MARGIN },
  offlineBannerText: { fontSize: WA_TYPE_FOOTNOTE },

  // Empty states
  emptyText: { fontSize: WA_TYPE_SUBTITLE },
  sectionEmptyTitle: { fontSize: WA_TYPE_ROW_TITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  sectionEmptySub: { fontSize: WA_TYPE_SUBTITLE, lineHeight: 21 },
});
