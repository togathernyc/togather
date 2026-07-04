/**
 * ServingTasksScreen
 *
 * The "Tasks" tab of serving mode. Shows the current user's serving tasks for
 * the active plan (`useEventModeStore().activePlanId`), grouped into three
 * segments — Before / During / After. Each segment has its own ProgressBar
 * reflecting the user's completion of that segment's tasks.
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
import { ProgressBar } from "@components/ui/ProgressBar";
import { useEventModeStore } from "@/stores/eventModeStore";
import { useConnectionStatus } from "@providers/ConnectionProvider";
import { useServingTasksCache } from "@/stores/servingTasksCache";
import {
  useServingTaskQueue,
  completionId,
  type ServingTaskKind,
} from "@/stores/servingTaskQueue";
import { ServingPlanSwitcher } from "./ServingPlanSwitcher";
import { HowToViewer, type HowToViewerContent } from "./HowToViewer";

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

/** The four views of the serving Tasks page. */
type Section = "mine" | "shared" | "crew" | "allTeams";

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: "mine", label: "Mine" },
  { key: "shared", label: "Shared" },
  { key: "crew", label: "Crew" },
  { key: "allTeams", label: "All teams" },
];

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

export function ServingTasksScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const activePlanId = useEventModeStore((s) => s.activePlanId);
  const planId = activePlanId as Id<"eventPlans"> | null;

  const tasks = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getMyServingTasks,
    planId ? { planId } : "skip",
  ) as MyServingTasks | undefined;

  // Header context (event title + when). Reuses the already-cheap serving
  // eligibility query — no extra fetch specific to this screen.
  const eligibility = useAuthenticatedQuery(
    api.functions.scheduling.serving.getServingEligibility,
    planId ? {} : "skip",
  ) as { plans: Array<{ planId: string; title: string; startsAt: number }> } | null | undefined;
  const activePlan = eligibility?.plans.find((p) => p.planId === planId) ?? null;

  // The other three sections. Fetched alongside Mine so the pill badges can
  // show live counts; only the active section's content is rendered.
  const sharedTasks = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getSharedTeamTasks,
    planId ? { planId } : "skip",
  ) as SharedTask[] | undefined;
  const crewMembers = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getCrewTasks,
    planId ? { planId } : "skip",
  ) as CrewMember[] | undefined;
  const allTeams = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getAllTeamsTasks,
    planId ? { planId } : "skip",
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

  if (!planId) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          Not currently serving on an event.
        </Text>
      </View>
    );
  }

  // Overall readiness across every segment (overlay-aware so queued offline
  // completions count toward the progress bars).
  const allTasks = mineWithOverlay
    ? [...mineWithOverlay.before, ...mineWithOverlay.during, ...mineWithOverlay.after]
    : [];
  const overallDone = allTasks.filter((t) => t.completed).length;
  const overallTotal = allTasks.length;

  // "Preloaded" tasks are the template (assigned) tasks for the user's role;
  // personal tasks are the ones the user adds themselves. When the role has no
  // preloaded tasks, we guide the user to their team lead while still letting
  // them add their own tasks per segment.
  const hasPreloadedTasks = allTasks.some((t) => !t.isPersonal);

  // Small badges on the section pills (null hides the badge).
  const sectionCounts: Record<Section, string | null> = {
    mine: overallTotal > 0 ? `${overallDone}/${overallTotal}` : null,
    shared: effShared && effShared.length > 0 ? String(effShared.length) : null,
    crew: effCrew && effCrew.length > 0 ? String(effCrew.length) : null,
    allTeams: effAllTeams && effAllTeams.length > 0 ? String(effAllTeams.length) : null,
  };

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <ServingPlanSwitcher />

        {isStale ? <OfflineBanner colors={colors} /> : null}

        <ServingHeader
          title={activePlan?.title ?? "My tasks"}
          startsAt={activePlan?.startsAt}
          done={overallDone}
          total={overallTotal}
          loading={effTasks === undefined}
          colors={colors}
          primaryColor={primaryColor}
        />

        <SectionPills
          section={section}
          counts={sectionCounts}
          onChange={setSection}
          colors={colors}
          primaryColor={primaryColor}
        />

        {section === "mine" &&
          (mineWithOverlay === undefined ? (
            useCache ? (
              <SectionEmpty
                icon="cloud-offline-outline"
                title="You're offline"
                subtitle="Your tasks will appear once you've opened them with a connection."
                colors={colors}
              />
            ) : (
              <View style={styles.inlineLoading}>
                <ActivityIndicator size="small" color={colors.text} />
              </View>
            )
          ) : (
            <>
            {!hasPreloadedTasks ? <NoPreloadedNotice colors={colors} /> : null}
            {SEGMENTS.map(({ key, label }) => {
            const segmentTasks = mineWithOverlay[key] ?? [];
            const done = segmentTasks.filter((t) => t.completed).length;
            const total = segmentTasks.length;
            const progress = total > 0 ? done / total : 0;

            return (
              <View key={key} style={styles.segment}>
                <View style={styles.segmentHeader}>
                  <Text style={[styles.segmentTitle, { color: colors.textSecondary }]}>
                    {label.toUpperCase()}
                  </Text>
                  <Text
                    style={[styles.segmentCount, { color: colors.textTertiary }]}
                  >
                    {done}/{total}
                  </Text>
                </View>
                <ProgressBar
                  progress={progress}
                  color={primaryColor}
                  height={4}
                />

                {/* When the role has no preloaded tasks, the notice above already
                    explains the empty state, so we skip the per-segment empty
                    card and leave just the "Add my own task" affordance. */}
                {segmentTasks.length === 0 && !hasPreloadedTasks ? null : (
                <View
                  style={[
                    styles.card,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  {segmentTasks.length === 0 ? (
                    <Text
                      style={[styles.cardEmpty, { color: colors.textTertiary }]}
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
                    <Text style={[styles.addButtonText, { color: primaryColor }]}>
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
          />
        )}
      </ScrollView>

      <HowToViewer
        visible={viewerContent !== null}
        content={viewerContent}
        onClose={() => setViewerContent(null)}
      />
    </>
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
}: {
  title: string;
  startsAt?: number;
  done: number;
  total: number;
  loading: boolean;
  colors: ThemeColors;
  primaryColor: string;
}) {
  const allDone = total > 0 && done === total;
  return (
    <View style={styles.header}>
      <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={2}>
        {title}
      </Text>
      {startsAt ? (
        <Text style={[styles.headerWhen, { color: colors.textSecondary }]}>
          {formatWhen(startsAt)}
        </Text>
      ) : null}

      {!loading && total > 0 ? (
        <View style={styles.readiness}>
          <View style={styles.readinessLabelRow}>
            <Text style={[styles.readinessLabel, { color: colors.textSecondary }]}>
              {allDone ? "You're all set" : "Your readiness"}
            </Text>
            <Text style={[styles.readinessCount, { color: colors.text }]}>
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
              task.completed
                ? { backgroundColor: primaryColor, borderColor: primaryColor }
                : { borderColor: colors.textTertiary },
            ]}
          >
            {task.completed ? (
              <Ionicons name="checkmark" size={15} color="#fff" />
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
              { color: colors.text },
              task.completed && styles.taskTitleDone,
            ]}
          >
            {task.title}
          </Text>

          {task.isPersonal ? (
            <View style={styles.taskMetaRow}>
              <Text style={[styles.taskMeta, { color: colors.textTertiary }]}>
                Added by you
              </Text>
            </View>
          ) : null}

          {inlineText ? (
            <Text
              style={[
                styles.inlineHowTo,
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
            style={[styles.howToChip, { borderColor: colors.border }]}
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
            <Text style={[styles.howToChipText, { color: primaryColor }]}>
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
        <View style={styles.taskDetail}>
          {editing ? (
            <View style={styles.editForm}>
              <TextInput
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Task title"
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
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
  onCancel,
  onSubmit,
}: AddTaskFormProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [timeLabel, setTimeLabel] = useState("");

  const canSubmit = title.trim().length > 0;

  return (
    <View style={[styles.addForm, { borderColor: colors.border }]}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Task title"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        style={[
          styles.input,
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
  counts,
  onChange,
  colors,
  primaryColor,
}: {
  section: Section;
  counts: Record<Section, string | null>;
  onChange: (s: Section) => void;
  colors: ThemeColors;
  primaryColor: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.pillsScroll}
      contentContainerStyle={styles.pillsRow}
    >
      {SECTIONS.map(({ key, label }) => {
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
              active
                ? { backgroundColor: primaryColor, borderColor: primaryColor }
                : { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.pillText,
                { color: active ? "#fff" : colors.textSecondary },
              ]}
            >
              {label}
            </Text>
            {count != null ? (
              <View
                style={[
                  styles.pillBadge,
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
}: {
  tasks: SharedTask[] | undefined;
  optimistic: Record<string, boolean>;
  colors: ThemeColors;
  primaryColor: string;
  onToggle: (taskId: string, next: boolean) => void;
  onOpenHowTo: (t: SharedTask) => void;
}) {
  if (tasks === undefined) return <SectionLoading colors={colors} />;
  if (tasks.length === 0) {
    return (
      <SectionEmpty
        icon="people-outline"
        title="No shared tasks"
        subtitle="Whole-team tasks show up here."
        colors={colors}
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
          <View key={key} style={styles.segment}>
            <View style={styles.segmentHeader}>
              <Text style={[styles.segmentTitle, { color: colors.textSecondary }]}>
                {label.toUpperCase()}
              </Text>
              <Text style={[styles.segmentCount, { color: colors.textTertiary }]}>
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
  onToggle,
  onOpenHowTo,
}: {
  task: SharedTask;
  completed: boolean;
  first: boolean;
  colors: ThemeColors;
  primaryColor: string;
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
              completed
                ? { backgroundColor: primaryColor, borderColor: primaryColor }
                : { borderColor: colors.textTertiary },
            ]}
          >
            {completed ? (
              <Ionicons name="checkmark" size={15} color="#fff" />
            ) : null}
          </View>
        </Pressable>

        <View style={styles.taskBody}>
          <Text
            style={[
              styles.taskTitle,
              { color: colors.text },
              completed && styles.taskTitleDone,
            ]}
          >
            {task.title}
          </Text>

          <View style={styles.taskMetaRow}>
            <View style={styles.teamCue}>
              <Ionicons name="people" size={12} color={colors.textTertiary} />
              <Text style={[styles.taskMeta, { color: colors.textTertiary }]}>
                Team task
              </Text>
            </View>
            {completed && task.completedByName ? (
              <Text style={[styles.taskMeta, { color: colors.textTertiary }]}>
                · Done by {task.completedByName}
              </Text>
            ) : null}
          </View>

          {inlineText ? (
            <Text
              style={[
                styles.inlineHowTo,
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
            style={[styles.howToChip, { borderColor: colors.border }]}
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
            <Text style={[styles.howToChipText, { color: primaryColor }]}>
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
}: {
  members: CrewMember[] | undefined;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  colors: ThemeColors;
  primaryColor: string;
}) {
  if (members === undefined) return <SectionLoading colors={colors} />;
  if (members.length === 0) {
    return (
      <SectionEmpty
        icon="people-outline"
        title="No crew yet"
        subtitle="Teammates serving this event will appear here."
        colors={colors}
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
        <View key={g.teamId} style={styles.crewGroup}>
          {showTeamHeaders ? (
            <Text style={[styles.groupHeader, { color: colors.textSecondary }]}>
              {g.teamName.toUpperCase()}
            </Text>
          ) : null}
          <View
            style={[
              styles.card,
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
}: {
  member: CrewMember;
  first: boolean;
  expanded: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  primaryColor: string;
}) {
  const progress = member.total > 0 ? member.done / member.total : 0;
  const allDone = member.total > 0 && member.done === member.total;

  return (
    <View
      style={[
        styles.expandRow,
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
            <Text style={[styles.expandTitle, { color: colors.text }]} numberOfLines={1}>
              {member.name}
            </Text>
            {member.isCurrentUser ? (
              <View style={[styles.youChip, { backgroundColor: primaryColor }]}>
                <Text style={styles.youChipText}>You</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.expandSub, { color: colors.textTertiary }]} numberOfLines={1}>
            {member.roleName}
          </Text>
        </View>
        <View style={styles.expandRight}>
          <Text
            style={[
              styles.expandCount,
              { color: allDone ? primaryColor : colors.textSecondary },
            ]}
          >
            {member.done}/{member.total}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
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
            <Text style={[styles.readonlyEmpty, { color: colors.textTertiary }]}>
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
}: {
  teams: AllTeamsTeam[] | undefined;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  colors: ThemeColors;
  primaryColor: string;
}) {
  if (teams === undefined) return <SectionLoading colors={colors} />;
  if (teams.length === 0) {
    return (
      <SectionEmpty
        icon="grid-outline"
        title="No teams"
        subtitle="Teams serving this event will appear here."
        colors={colors}
      />
    );
  }

  return (
    <View style={styles.sectionBody}>
      <View
        style={[
          styles.card,
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
}: {
  team: AllTeamsTeam;
  first: boolean;
  expanded: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  primaryColor: string;
}) {
  const progress = team.total > 0 ? team.done / team.total : 0;
  const allDone = team.total > 0 && team.done === team.total;

  return (
    <View
      style={[
        styles.expandRow,
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
          <Text style={[styles.expandTitle, { color: colors.text }]} numberOfLines={1}>
            {team.teamName}
          </Text>
        </View>
        <View style={styles.expandRight}>
          <Text
            style={[
              styles.expandCount,
              { color: allDone ? primaryColor : colors.textSecondary },
            ]}
          >
            {team.done}/{team.total}
          </Text>
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
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
            <Text style={[styles.readonlyEmpty, { color: colors.textTertiary }]}>
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
              />
            ))
          )}
        </View>
      ) : null}
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
}: {
  title: string;
  meta?: string;
  completed: boolean;
  howToType: HowToType;
  colors: ThemeColors;
  primaryColor: string;
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
            { color: colors.text },
            completed && styles.taskTitleDone,
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {meta ? (
          <Text style={[styles.roItemMeta, { color: colors.textTertiary }]} numberOfLines={1}>
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
function OfflineBanner({ colors }: { colors: ThemeColors }) {
  return (
    <View style={[styles.offlineBanner, { backgroundColor: colors.surface }]}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
      <Text style={[styles.offlineBannerText, { color: colors.textSecondary }]}>
        Offline · showing your saved copy
      </Text>
    </View>
  );
}

/**
 * Shown at the top of the "Mine" section when the user's role has no preloaded
 * (template) tasks. Explains the empty state and points the user to their team
 * lead, while the per-segment "Add my own task" affordances remain available.
 */
function NoPreloadedNotice({ colors }: { colors: ThemeColors }) {
  return (
    <View style={styles.segment}>
      <View
        style={[
          styles.noticeCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Ionicons
          name="information-circle-outline"
          size={20}
          color={colors.textSecondary}
        />
        <View style={styles.noticeBody}>
          <Text style={[styles.noticeMessage, { color: colors.text }]}>
            No preloaded task. Please contact your team lead to add tasks.
          </Text>
          <Text style={[styles.noticeHint, { color: colors.textTertiary }]}>
            You can still add your own tasks below.
          </Text>
        </View>
      </View>
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.sectionEmpty}>
      <Ionicons name={icon} size={30} color={colors.textTertiary} />
      <Text style={[styles.sectionEmptyTitle, { color: colors.textSecondary }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.sectionEmptySub, { color: colors.textTertiary }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
