/**
 * EventTasksScreen
 *
 * The leader-facing "database view" for defining Event Tasks on one event plan.
 * Shows every task the teams are accountable for, grouped by segment
 * (Pre / During / Post) and, within each segment, by team → role — presented as
 * an inline-editable grid (see EventTasksGrid). This is the leader's authoring
 * surface: what each team/role must do, and the How-To guidance for it.
 *
 * Leaders get cross-team visibility from the readiness header: three
 * ProgressBars (Pre / During / Post) plus a per-team breakdown, driven by
 * `getPlanTaskReadiness`.
 *
 * Gating: the screen is only reachable when the community has opted into the
 * Event Tasks feature (`churchFeatures.eventTasksEnabled`) AND the current user
 * is a leader/admin of the group. Non-eligible users see an explanatory state.
 *
 * Route: /rostering/[group_id]/tasks/[plan_id]
 * Backend: scheduling.eventTasks.{listPlanTasks,getPlanTaskReadiness,createTask,
 *          updateTask,deleteTask,reorderTasks}
 *
 * Media picker note: there is no shared scheduling media picker to reuse, so the
 * How-To "media" type accepts an `r2:` path typed/pasted in place. Swapping in a
 * real picker later is isolated to EventTasksHowToCell.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Alert,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { SegmentedTabs } from "@components/ui/SegmentedTabs";
import { useAuth } from "@providers/AuthProvider";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatEventDateLong } from "../utils/format";
import {
  EventTasksGrid,
  type PlanTask,
  type Segment,
  type TaskPatch,
  type TaskSection,
  type TeamOption,
  type RoleOption,
} from "./EventTasksGrid";
import { AnchoredMenu, measureAnchor, type AnchorRect } from "./AnchoredMenu";
import { EventTasksHowToDocEditor } from "./EventTasksHowToDocEditor";
import { PlanTemplateToolbar } from "./PlanTemplateToolbar";
import { listTaskTemplatesRef } from "../api/eventTemplates";
import {
  getPlanTemplateStateRef,
  setPlanTaskTemplateRef,
  saveTaskTemplateFromPlanRef,
  revertPlanTaskTemplateEditsRef,
  type PlanTemplateState,
  type TemplateCarryover,
  type SaveTemplateStrategy,
} from "../api/planTemplates";

/** Show a one-button error (Alert.alert is a no-op on web in this codebase). */
function notifyError(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** Confirm a destructive action, cross-platform. */
function confirmDelete(prompt: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(prompt)) onConfirm();
    return;
  }
  Alert.alert("Delete task?", prompt, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: onConfirm },
  ]);
}

type Readiness = {
  overall: { done: number; total: number };
  bySegment: Record<Segment, { done: number; total: number }>;
  byTeam: Array<{ teamId: string; teamName: string; done: number; total: number }>;
};

type EventDoc = { _id: Id<"eventPlans">; title: string; eventDate: number };

export function EventTasksScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  // Side "card" gutter the content insets by (header, readiness/filter rows, and
  // the table all line up on it): roomier on wide/web, tighter on narrow phones.
  const { width } = useWindowDimensions();
  const isWide = width >= 700;
  const gutter = isWide ? 24 : 16;
  const router = useRouter();
  const { community, user } = useAuth();
  const { plan_id, group_id } = useLocalSearchParams<{
    plan_id: string;
    group_id: string;
  }>();
  const planId = plan_id as Id<"eventPlans">;
  const groupId = group_id as Id<"groups">;

  // Feature flag: the mobile Community type only enumerates `prayerEnabled`, but
  // the backend `churchFeatures` object also carries `eventTasksEnabled` (schema
  // ADR). Read it defensively so we don't depend on the narrower client type.
  const eventTasksEnabled = Boolean(
    (community?.churchFeatures as { eventTasksEnabled?: boolean } | undefined)
      ?.eventTasksEnabled,
  );

  // Leader gate — authoritative group role (leader/admin), same source the
  // run-sheet tool uses to decide edit rights.
  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    group_id ? { groupId } : "skip",
  ) as { userRole?: string } | null | undefined;
  // Community admins can manage event tasks even when they aren't a member/leader
  // of this group (matching the backend scheduler permission), so `getById`
  // returns no `userRole` for them.
  const isLeader =
    groupData?.userRole === "leader" ||
    groupData?.userRole === "admin" ||
    user?.is_admin === true;

  const canView = eventTasksEnabled && isLeader;

  const event = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    canView && planId ? { planId } : "skip",
  ) as EventDoc | null | undefined;

  const tasks = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.listPlanTasks,
    canView && planId ? { planId } : "skip",
  ) as PlanTask[] | undefined;

  const readiness = useAuthenticatedQuery(
    api.functions.scheduling.eventTasks.getPlanTaskReadiness,
    canView && planId ? { planId } : "skip",
  ) as Readiness | undefined;

  const teamsData = useAuthenticatedQuery(
    api.functions.scheduling.teams.listTeams,
    canView && groupId ? { groupId } : "skip",
  ) as Array<{ _id: Id<"teams">; name: string }> | undefined;

  const createTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.createTask,
  );
  const updateTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.updateTask,
  );
  const deleteTask = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.deleteTask,
  );
  const reorderTasks = useAuthenticatedMutation(
    api.functions.scheduling.eventTasks.reorderTasks,
  );

  // Plan ↔ task-template linkage (Phase 3/4). `getPlanTemplateState` carries
  // both task and run-sheet slices; this screen reads the task slice only.
  const templateState = useAuthenticatedQuery(
    getPlanTemplateStateRef,
    canView && planId ? { planId } : "skip",
  ) as PlanTemplateState | undefined;
  const taskTemplates = useAuthenticatedQuery(
    listTaskTemplatesRef,
    canView && groupId ? { groupId } : "skip",
  );
  const setPlanTaskTemplate = useAuthenticatedMutation(setPlanTaskTemplateRef);
  const saveTaskTemplateFromPlan = useAuthenticatedMutation(
    saveTaskTemplateFromPlanRef,
  );
  const revertPlanTaskTemplateEdits = useAuthenticatedMutation(
    revertPlanTaskTemplateEditsRef,
  );

  const templateSlice = templateState
    ? {
        templateId: templateState.taskTemplateId,
        templateName: templateState.taskTemplateName,
        hasEdits: templateState.hasTaskTemplateEdits,
        isPast: templateState.isPast,
      }
    : undefined;
  const templateOptions = useMemo(
    () =>
      (taskTemplates ?? []).map((t) => ({
        _id: t._id as string,
        name: t.name,
        itemCount: t.itemCount,
      })),
    [taskTemplates],
  );

  const handleSetTemplate = useCallback(
    (templateId: string | null, carryover: TemplateCarryover) => {
      void setPlanTaskTemplate({
        planId,
        templateId: templateId as Id<"eventTaskTemplates"> | null,
        carryover,
      }).catch((e: any) =>
        notifyError(
          "Couldn't switch template",
          e?.data?.message ?? e?.message ?? "Please try again.",
        ),
      );
    },
    [setPlanTaskTemplate, planId],
  );

  const handleSaveNewTemplate = useCallback(
    (name: string) => {
      void saveTaskTemplateFromPlan({
        planId,
        mode: { kind: "new", name },
      }).catch((e: any) =>
        notifyError(
          "Couldn't save template",
          e?.data?.message ?? e?.message ?? "Please try again.",
        ),
      );
    },
    [saveTaskTemplateFromPlan, planId],
  );

  const handleSaveExistingTemplate = useCallback(
    (templateId: string, strategy: SaveTemplateStrategy) => {
      void saveTaskTemplateFromPlan({
        planId,
        mode: {
          kind: "existing",
          templateId: templateId as Id<"eventTaskTemplates">,
          strategy,
        },
      }).catch((e: any) =>
        notifyError(
          "Couldn't save template",
          e?.data?.message ?? e?.message ?? "Please try again.",
        ),
      );
    },
    [saveTaskTemplateFromPlan, planId],
  );

  const handleRevertTemplate = useCallback(() => {
    void revertPlanTaskTemplateEdits({ planId }).catch((e: any) =>
      notifyError(
        "Couldn't revert",
        e?.data?.message ?? e?.message ?? "Please try again.",
      ),
    );
  }, [revertPlanTaskTemplateEdits, planId]);

  const teams: TeamOption[] = useMemo(
    () => (teamsData ?? []).map((t) => ({ _id: t._id, name: t.name })),
    [teamsData],
  );

  // Roles are fetched per team on demand — the set of teams referenced by tasks
  // (plus any team currently in the role picker). We collect the referenced team
  // ids and render a RoleLoader per team to populate `rolesByTeam`.
  const [rolesByTeam, setRolesByTeam] = useState<Record<string, RoleOption[]>>({});
  const setRolesForTeam = useCallback((teamId: string, roles: RoleOption[]) => {
    setRolesByTeam((prev) => {
      const existing = prev[teamId];
      // Skip the state update when unchanged to avoid a render loop.
      if (
        existing &&
        existing.length === roles.length &&
        existing.every((r, i) => r._id === roles[i]._id && r.name === roles[i].name)
      ) {
        return prev;
      }
      return { ...prev, [teamId]: roles };
    });
  }, []);

  const referencedTeamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks ?? [])
      for (const id of t.teamIds) ids.add(id as string);
    return [...ids];
  }, [tasks]);

  // Picker state. Team/Role are anchored dropdowns next to their pills, so each
  // tracks the task plus the pill's measured window rect. Doc editor stays a
  // full-screen editor.
  const [teamPicker, setTeamPicker] = useState<{
    task: PlanTask;
    anchor: AnchorRect;
  } | null>(null);
  const [rolePicker, setRolePicker] = useState<{
    task: PlanTask;
    anchor: AnchorRect;
  } | null>(null);
  const [docEditorTask, setDocEditorTask] = useState<PlanTask | null>(null);

  // View filters (combinable): phase / team / role. `null` = "All". Applied to
  // derive the task list handed to the grid.
  const [phaseFilter, setPhaseFilter] = useState<Segment | null>(null);
  const [teamFilter, setTeamFilter] = useState<Id<"teams"> | null>(null);
  const [roleFilter, setRoleFilter] = useState<Id<"teamRoles"> | null>(null);

  // Per-phase section collapse state (default: all expanded). Owned here; the
  // grid's section headers flip these via `onToggle`.
  const [collapsed, setCollapsed] = useState<Record<Segment, boolean>>({
    before: false,
    during: false,
    after: false,
  });

  // Changing the team filter resets the role filter — a role belongs to one team.
  const handleSetTeamFilter = useCallback((id: Id<"teams"> | null) => {
    setTeamFilter(id);
    setRoleFilter(null);
  }, []);

  // Role filter options: scoped to the filtered team when one is set, else the
  // union of every loaded team's roles (deduped by id).
  const roleFilterOptions = useMemo<RoleOption[]>(() => {
    if (teamFilter) return rolesByTeam[teamFilter as string] ?? [];
    const byId = new Map<string, RoleOption>();
    for (const roles of Object.values(rolesByTeam)) {
      for (const r of roles ?? []) byId.set(r._id as string, r);
    }
    return [...byId.values()];
  }, [teamFilter, rolesByTeam]);

  const filteredTasks = useMemo<PlanTask[]>(
    () =>
      (tasks ?? []).filter((t) => {
        if (phaseFilter && t.segment !== phaseFilter) return false;
        if (teamFilter && !t.teamIds.includes(teamFilter)) return false;
        if (roleFilter && !t.roleIds.includes(roleFilter)) return false;
        return true;
      }),
    [tasks, phaseFilter, teamFilter, roleFilter],
  );

  const handlePatch = useCallback(
    (taskId: Id<"eventTasks">, patch: TaskPatch) => {
      void updateTask({ taskId, ...patch }).catch((e: any) =>
        notifyError("Couldn't save", e?.data?.message ?? e?.message ?? "Please try again."),
      );
    },
    [updateTask],
  );

  const handleAdd = useCallback(
    async (segment: Segment) => {
      // Seed the new task from the active view filters so it stays VISIBLE
      // under the current filter — otherwise it's created with defaults that
      // don't match, gets filtered out, and "Add task" looks like a no-op.
      //
      // Team: explicit team filter → the team that owns the role filter → the
      // first team. Segment: the phase filter overrides the caller's segment.
      // Role: only when it belongs to the resolved team.
      let teamId = (teamFilter ?? undefined) as Id<"teams"> | undefined;
      if (!teamId && roleFilter) {
        const owner = Object.entries(rolesByTeam).find(([, roles]) =>
          (roles ?? []).some((r) => r._id === roleFilter),
        );
        if (owner) teamId = owner[0] as Id<"teams">;
      }
      teamId = teamId ?? teams[0]?._id;
      if (!teamId) {
        notifyError(
          "Add a team first",
          "Create a serving team for this group before adding tasks.",
        );
        return;
      }
      const seg = phaseFilter ?? segment;
      const roleMatches =
        roleFilter &&
        (rolesByTeam[teamId as string] ?? []).some((r) => r._id === roleFilter);
      try {
        await createTask({
          planId,
          teamIds: [teamId],
          roleIds: roleMatches ? [roleFilter as Id<"teamRoles">] : [],
          segment: seg,
          title: "New task",
          howToType: "none",
        });
      } catch (e: any) {
        notifyError("Couldn't add task", e?.data?.message ?? e?.message ?? "Please try again.");
      }
    },
    [createTask, planId, teams, teamFilter, phaseFilter, roleFilter, rolesByTeam],
  );

  const handleDelete = useCallback(
    (task: PlanTask) => {
      confirmDelete(`Remove "${task.title}"?`, () => {
        void deleteTask({ taskId: task._id }).catch((e: any) =>
          notifyError("Couldn't delete", e?.data?.message ?? e?.message ?? "Please try again."),
        );
      });
    },
    [deleteTask],
  );

  // Duplicate a task — copy every editable field (teams/roles/segment/title +
  // How-To) onto a new task. Stays within the create API.
  const handleDuplicate = useCallback(
    async (task: PlanTask) => {
      try {
        await createTask({
          planId,
          teamIds: task.teamIds,
          roleIds: task.roleIds,
          segment: task.segment,
          title: task.title,
          howToType: task.howToType,
          howToText: task.howToText,
          howToUrl: task.howToUrl,
          howToMediaPath: task.howToMediaPath,
          howToDoc: task.howToDoc,
        });
      } catch (e: any) {
        notifyError("Couldn't duplicate", e?.data?.message ?? e?.message ?? "Please try again.");
      }
    },
    [createTask, planId],
  );

  const handleReorder = useCallback(
    (orderedIds: Array<Id<"eventTasks">>) => {
      // No-op while any view filter is active: the grid only sees the FILTERED
      // ids, so reordering here would rewrite sortOrder 0..k over just those,
      // colliding with the hidden tasks' sortOrders and corrupting the global
      // order. The reactive query snaps the dragged row back.
      if (phaseFilter || teamFilter || roleFilter) return;
      void reorderTasks({ planId, orderedIds }).catch((e: any) =>
        notifyError("Couldn't reorder", e?.data?.message ?? e?.message ?? "Please try again."),
      );
    },
    [reorderTasks, planId, phaseFilter, teamFilter, roleFilter],
  );

  // Group the visible tasks into Pre / During / Post sections for the grid. A
  // phase filter narrows to that one section; otherwise all three show. The grid
  // supplies each section's sorted rows itself (keyed by `segment`), so we only
  // own the chrome: title, readiness meta, collapse, and a per-section Add.
  const taskSections = useMemo<TaskSection[]>(() => {
    const defs: Array<{ segment: Segment; title: string }> = [
      { segment: "before", title: "PRE" },
      { segment: "during", title: "DURING" },
      { segment: "after", title: "POST" },
    ];
    return defs
      .filter((d) => !phaseFilter || d.segment === phaseFilter)
      .map((d) => {
        const seg = readiness?.bySegment[d.segment];
        const count = filteredTasks.filter((t) => t.segment === d.segment).length;
        return {
          key: d.segment,
          segment: d.segment,
          title: d.title,
          meta: seg ? `${seg.done}/${seg.total} ready` : `${count} tasks`,
          collapsed: collapsed[d.segment],
          onToggle: () =>
            setCollapsed((c) => ({ ...c, [d.segment]: !c[d.segment] })),
          footer: (
            <TouchableOpacity
              onPress={() => void handleAdd(d.segment)}
              style={[
                styles.sectionAdd,
                { borderColor: primaryColor, backgroundColor: primaryColor + "0D" },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Add a ${d.title.toLowerCase()} task`}
            >
              <Ionicons name="add" size={16} color={primaryColor} />
              <Text style={[styles.sectionAddText, { color: primaryColor }]}>
                Add task
              </Text>
            </TouchableOpacity>
          ),
        };
      });
  }, [phaseFilter, readiness, filteredTasks, collapsed, handleAdd, primaryColor]);

  // Teams and roles are now multi-select edits via `updateTask` (a task can
  // belong to several teams/roles). Toggling a team on/off keeps at least one
  // team; toggling a role on/off freely (empty roles => a team-level task).
  const handleToggleTeam = useCallback(
    (task: PlanTask, teamId: Id<"teams">) => {
      const has = task.teamIds.includes(teamId);
      const next = has
        ? task.teamIds.filter((t) => t !== teamId)
        : [...task.teamIds, teamId];
      if (next.length === 0) return; // a task must keep at least one team
      handlePatch(task._id, { teamIds: next });
    },
    [handlePatch],
  );

  const handleToggleRole = useCallback(
    (task: PlanTask, roleId: Id<"teamRoles">) => {
      const has = task.roleIds.includes(roleId);
      const next = has
        ? task.roleIds.filter((r) => r !== roleId)
        : [...task.roleIds, roleId];
      handlePatch(task._id, { roleIds: next });
    },
    [handlePatch],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  // Simple centered bar for gating states (event not loaded yet).
  const renderHeaderBar = () => (
    <View
      style={[
        styles.header,
        { borderBottomColor: colors.border, paddingHorizontal: gutter },
      ]}
    >
      <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBtn}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Event tasks</Text>
      <View style={styles.headerBtn} />
    </View>
  );

  // Consolidated top bar: back + event title/date + the Run sheet/Tasks tabs,
  // all on one row (matches the run sheet and the approved prototype).
  const renderRichHeader = () => (
    <View
      style={[
        styles.header,
        { borderBottomColor: colors.border, paddingHorizontal: gutter },
      ]}
    >
      <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBackBtn}>
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.headerTitleBlock}>
        <Text style={[styles.headerEventTitle, { color: colors.text }]} numberOfLines={1}>
          {event?.title ?? "Event tasks"}
        </Text>
        {event ? (
          <Text
            style={[styles.headerEventMeta, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {formatEventDateLong(event.eventDate)}
          </Text>
        ) : null}
      </View>
      <SegmentedTabs
        options={[
          { key: "run", label: "Run sheet" },
          { key: "tasks", label: "Tasks" },
        ]}
        value="tasks"
        onChange={(k) => {
          if (k === "run")
            router.push(`/rostering/${group_id}/run-sheet/${planId}`);
        }}
        accessibilityLabel="Switch between run sheet and tasks"
      />
    </View>
  );

  // --- Gating states ---------------------------------------------------------
  if (!eventTasksEnabled) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}>
        {renderHeaderBar()}
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.iconSecondary} />
          <Text style={[styles.gateText, { color: colors.textSecondary }]}>
            Event Tasks isn't enabled for this community.
          </Text>
        </View>
      </View>
    );
  }

  if (groupData === undefined) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}>
        {renderHeaderBar()}
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </View>
    );
  }

  if (!isLeader) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}>
        {renderHeaderBar()}
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={40} color={colors.iconSecondary} />
          <Text style={[styles.gateText, { color: colors.textSecondary }]}>
            Only leaders can define event tasks.
          </Text>
        </View>
      </View>
    );
  }

  const loading = tasks === undefined || event === undefined;

  // Split the template toolbar so its pieces land on the prototype's two rows:
  // "Save as template" sits on the readiness line; the picker sits inline with
  // the filter chips.
  const templateToolbarProps = {
    label: "Task template",
    itemNoun: "tasks",
    state: templateSlice,
    templates: templateOptions,
    onSetTemplate: handleSetTemplate,
    onSaveNew: handleSaveNewTemplate,
    onSaveExisting: handleSaveExistingTemplate,
    onRevert: handleRevertTemplate,
  } as const;
  const templatePicker = <PlanTemplateToolbar {...templateToolbarProps} pickerOnly />;
  const listHeader = (
    <View>
      <ReadinessHeader
        readiness={readiness}
        colors={colors}
        right={<PlanTemplateToolbar {...templateToolbarProps} saveOnly />}
      />
      {(tasks?.length ?? 0) > 0 ? (
        <FilterBar
          phase={phaseFilter}
          onPhase={setPhaseFilter}
          teamId={teamFilter}
          onTeam={handleSetTeamFilter}
          roleId={roleFilter}
          onRole={setRoleFilter}
          teams={teams}
          roles={roleFilterOptions}
          colors={colors}
          primaryColor={primaryColor}
          leading={templatePicker}
        />
      ) : (
        <View style={styles.pickerOnlyRow}>{templatePicker}</View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}>
      {renderRichHeader()}

      {/* Populate rolesByTeam for every referenced team + the team currently in
          the role picker, so role labels/pickers resolve without a big join. */}
      {referencedTeamIds.map((tid) => (
        <RoleLoader key={tid} teamId={tid as Id<"teams">} onLoaded={setRolesForTeam} />
      ))}
      {rolePicker
        ? rolePicker.task.teamIds.map((tid) => (
            <RoleLoader
              key={`picker-${tid}`}
              teamId={tid}
              onLoaded={setRolesForTeam}
            />
          ))
        : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : (tasks ?? []).length === 0 ? (
        <ScrollView
          contentContainerStyle={[
            styles.emptyScroll,
            { paddingHorizontal: gutter },
          ]}
        >
          {listHeader}
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No tasks yet. Use "Add task" under a phase (Pre / During / Post) to
            define what each team and role is accountable for, then attach a
            How-To for each.
          </Text>
          <View style={styles.emptyAddRow}>
            {(["before", "during", "after"] as Segment[]).map((seg) => (
              <TouchableOpacity
                key={seg}
                onPress={() => handleAdd(seg)}
                style={[styles.emptyAddBtn, { borderColor: colors.border }]}
              >
                <Ionicons name="add" size={16} color={primaryColor} />
                <Text style={[styles.emptyAddText, { color: primaryColor }]}>
                  {seg === "before" ? "Pre" : seg === "during" ? "During" : "Post"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      ) : (
        // Extra horizontal gutter to seat the table (and its readiness/filter
        // header) on the same inset as the top bar. GridScrollList already adds a
        // fixed 16px inset internally, so we only add the remainder (0 on narrow,
        // +8 on wide) to reach `gutter` without doubling up.
        <View style={{ flex: 1, paddingHorizontal: gutter - 16 }}>
          <EventTasksGrid
            tasks={filteredTasks}
            teams={teams}
            rolesByTeam={rolesByTeam}
            onPatch={handlePatch}
            onDelete={handleDelete}
            onDuplicate={handleDuplicate}
            onAdd={handleAdd}
            onReorder={handleReorder}
            onPickTeam={(task, anchor) => setTeamPicker({ task, anchor })}
            onPickRole={(task, anchor) => setRolePicker({ task, anchor })}
            onOpenDoc={setDocEditorTask}
            listHeader={listHeader}
            sections={taskSections}
          />
        </View>
      )}

      {/* Team picker — a multi-select dropdown; a task can belong to several
          teams. Toggling stays open (the backdrop closes it). Reads the LIVE
          task so its checkmarks reflect each toggle. */}
      {teamPicker
        ? (() => {
            const live =
              (tasks ?? []).find((t) => t._id === teamPicker.task._id) ??
              teamPicker.task;
            return (
              <AnchoredMenu
                anchor={teamPicker.anchor}
                options={teams.map((t) => ({ id: t._id as string, name: t.name }))}
                selectedIds={live.teamIds as string[]}
                onToggle={(id) => handleToggleTeam(live, id as Id<"teams">)}
                onSelect={() => {}}
                onClose={() => setTeamPicker(null)}
              />
            );
          })()
        : null}

      {/* Role picker — a multi-select dropdown over the union of roles across the
          task's teams. No selected roles => a team-level (whole-team) task. */}
      {rolePicker
        ? (() => {
            const live =
              (tasks ?? []).find((t) => t._id === rolePicker.task._id) ??
              rolePicker.task;
            // Union of roles across all of the task's teams (deduped by id).
            const roleOptions = new Map<
              string,
              { id: string; name: string; color?: string }
            >();
            for (const tid of live.teamIds) {
              for (const r of rolesByTeam[tid as string] ?? []) {
                roleOptions.set(r._id as string, {
                  id: r._id as string,
                  name: r.name,
                  color: r.color,
                });
              }
            }
            return (
              <AnchoredMenu
                anchor={rolePicker.anchor}
                options={[...roleOptions.values()]}
                selectedIds={live.roleIds as string[]}
                onToggle={(id) =>
                  handleToggleRole(live, id as Id<"teamRoles">)
                }
                onSelect={() => {}}
                onClose={() => setRolePicker(null)}
              />
            );
          })()
        : null}

      {/* Full-screen How-To doc editor. */}
      <EventTasksHowToDocEditor
        visible={docEditorTask !== null}
        taskTitle={docEditorTask?.title ?? ""}
        initialDoc={docEditorTask?.howToDoc ?? ""}
        onSave={(doc) => {
          if (docEditorTask) handlePatch(docEditorTask._id, { howToDoc: doc });
        }}
        onClose={() => setDocEditorTask(null)}
      />
    </View>
  );
}

/**
 * Loads a team's roles and reports them up via `onLoaded`. Rendered once per
 * referenced team so the grid can show role names and the role picker has
 * options — without a bespoke join query.
 */
function RoleLoader({
  teamId,
  onLoaded,
}: {
  teamId: Id<"teams">;
  onLoaded: (teamId: string, roles: RoleOption[]) => void;
}) {
  const roles = useAuthenticatedQuery(
    api.functions.scheduling.roles.listRoles,
    { teamId },
  ) as Array<{ _id: Id<"teamRoles">; name: string; color?: string }> | undefined;

  React.useEffect(() => {
    if (roles) {
      onLoaded(
        teamId as string,
        roles.map((r) => ({ _id: r._id, name: r.name, color: r.color })),
      );
    }
  }, [roles, teamId, onLoaded]);

  return null;
}

/**
 * Readiness header — one compact line: a bold done/total count (monospace,
 * tabular), a "READY" label, a thin progress track (fill in `colors.success`),
 * and inline per-phase counts (Pre / During / Post). Any per-team breakdown
 * follows as a small secondary line of compact chips. Contained to the table's
 * centered max width so it doesn't stretch edge-to-edge on desktop.
 */
function ReadinessHeader({
  readiness,
  colors,
  right,
}: {
  readiness: Readiness | undefined;
  colors: ReturnType<typeof useTheme>["colors"];
  /** Optional node pinned to the right of the readiness line (e.g. Save as template). */
  right?: React.ReactNode;
}) {
  if (!readiness) return null;
  const { overall, bySegment } = readiness;
  const ratio = overall.total > 0 ? overall.done / overall.total : 0;
  const clamped = Math.max(0, Math.min(1, ratio));
  const phases: Array<{ label: string; done: number; total: number }> = [
    { label: "Pre", ...bySegment.before },
    { label: "During", ...bySegment.during },
    { label: "Post", ...bySegment.after },
  ];

  return (
    <View style={styles.readiness}>
      <View style={styles.readinessMain}>
        <Text style={[styles.rdCount, { color: colors.text }]}>
          {overall.done}/{overall.total}
        </Text>
        <Text style={[styles.rdLabel, { color: colors.textSecondary }]}>
          READY
        </Text>
        <View style={[styles.rdTrack, { backgroundColor: colors.surfaceSecondary }]}>
          <View
            style={{
              height: "100%",
              width: `${clamped * 100}%`,
              borderRadius: 6,
              backgroundColor: colors.success,
            }}
          />
        </View>
        <View style={styles.rdPhases}>
          {phases.map((p) => (
            <Text
              key={p.label}
              style={[styles.rdPhase, { color: colors.textSecondary }]}
            >
              {p.label} {p.done}/{p.total}
            </Text>
          ))}
        </View>
        {right ? <View style={styles.readinessRight}>{right}</View> : null}
      </View>
    </View>
  );
}

/**
 * The view-filter bar above the grid: Phase chips (All / Pre / During / Post)
 * plus Team and Role dropdowns. Filters are combinable; active filters use the
 * community accent, and a Clear button resets them all. State lives in the
 * screen — this is presentational, owning only its own anchored-menu state.
 */
function FilterBar({
  phase,
  onPhase,
  teamId,
  onTeam,
  roleId,
  onRole,
  teams,
  roles,
  colors,
  primaryColor,
  leading,
}: {
  phase: Segment | null;
  onPhase: (seg: Segment | null) => void;
  teamId: Id<"teams"> | null;
  onTeam: (id: Id<"teams"> | null) => void;
  roleId: Id<"teamRoles"> | null;
  onRole: (id: Id<"teamRoles"> | null) => void;
  teams: TeamOption[];
  roles: RoleOption[];
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  /** Optional node rendered inline before the filter chips (e.g. template picker). */
  leading?: React.ReactNode;
}) {
  const [menu, setMenu] = useState<{ kind: "team" | "role"; anchor: AnchorRect } | null>(null);
  const teamRef = React.useRef<View>(null);
  const roleRef = React.useRef<View>(null);

  const hasActive = phase !== null || teamId !== null || roleId !== null;
  const teamName = teamId ? teams.find((t) => t._id === teamId)?.name : undefined;
  const roleName = roleId ? roles.find((r) => r._id === roleId)?.name : undefined;

  const phaseChips: Array<{ key: Segment | null; label: string }> = [
    { key: null, label: "All" },
    { key: "before", label: "Pre" },
    { key: "during", label: "During" },
    { key: "after", label: "Post" },
  ];

  const dropdownStyle = (active: boolean) => [
    styles.filterPill,
    {
      borderColor: active ? primaryColor : colors.border,
      backgroundColor: active ? primaryColor + "1A" : "transparent",
    },
  ];

  return (
    <View style={styles.filterBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        {leading}
        {phaseChips.map((c) => {
          const active = phase === c.key;
          return (
            <TouchableOpacity
              key={c.label}
              onPress={() => onPhase(c.key)}
              style={[
                styles.filterChip,
                {
                  borderColor: active ? primaryColor : colors.border,
                  backgroundColor: active ? primaryColor + "1A" : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: active ? primaryColor : colors.textSecondary },
                ]}
              >
                {c.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        <View style={[styles.filterDivider, { backgroundColor: colors.border }]} />

        <View ref={teamRef} collapsable={false}>
          <TouchableOpacity
            onPress={() =>
              measureAnchor(teamRef.current, (a) => setMenu({ kind: "team", anchor: a }))
            }
            style={dropdownStyle(teamId !== null)}
          >
            <Text
              style={[
                styles.filterPillText,
                { color: teamId ? primaryColor : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {teamName ? `Team: ${teamName}` : "Team: All"}
            </Text>
            <Ionicons
              name="chevron-down"
              size={12}
              color={teamId ? primaryColor : colors.textTertiary}
            />
          </TouchableOpacity>
        </View>

        {roles.length > 0 ? (
          <View ref={roleRef} collapsable={false}>
            <TouchableOpacity
              onPress={() =>
                measureAnchor(roleRef.current, (a) => setMenu({ kind: "role", anchor: a }))
              }
              style={dropdownStyle(roleId !== null)}
            >
              <Text
                style={[
                  styles.filterPillText,
                  { color: roleId ? primaryColor : colors.textSecondary },
                ]}
                numberOfLines={1}
              >
                {roleName ? `Role: ${roleName}` : "Role: All"}
              </Text>
              <Ionicons
                name="chevron-down"
                size={12}
                color={roleId ? primaryColor : colors.textTertiary}
              />
            </TouchableOpacity>
          </View>
        ) : null}

        {hasActive ? (
          <TouchableOpacity
            onPress={() => {
              onPhase(null);
              onTeam(null);
              onRole(null);
            }}
            style={styles.filterClear}
            accessibilityLabel="Clear filters"
          >
            <Ionicons name="close-circle" size={15} color={colors.textSecondary} />
            <Text style={[styles.filterClearText, { color: colors.textSecondary }]}>
              Clear
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {menu?.kind === "team" ? (
        <AnchoredMenu
          anchor={menu.anchor}
          options={teams.map((t) => ({ id: t._id as string, name: t.name }))}
          selectedId={teamId as string | undefined}
          emptyOption={{ label: "All teams" }}
          onSelect={(id) => {
            onTeam(id as Id<"teams"> | null);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {menu?.kind === "role" ? (
        <AnchoredMenu
          anchor={menu.anchor}
          options={roles.map((r) => ({ id: r._id as string, name: r.name, color: r.color }))}
          selectedId={roleId as string | undefined}
          emptyOption={{ label: "All roles" }}
          onSelect={(id) => {
            onRole(id as Id<"teamRoles"> | null);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </View>
  );
}

// Monospace + tabular figures for the readiness counts (the "broadcast rundown"
// numeric feel, matching the run-sheet time/duration cells).
const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 44, padding: 4, alignItems: "center" },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  headerBackBtn: { padding: 4 },
  headerTitleBlock: { flex: 1, minWidth: 0, marginLeft: 4, marginRight: 8 },
  headerEventTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  headerEventMeta: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: MONO_FONT,
    fontVariant: ["tabular-nums"],
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  gateText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  // Per-section "+ Add task" footer button (dashed, community accent).
  sectionAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  sectionAddText: { fontSize: 14, fontWeight: "600" },
  readiness: {
    marginTop: 16,
    width: "100%",
    maxWidth: 1200,
    alignSelf: "center",
    gap: 10,
  },
  // The single compact readiness line: count · READY · track · phase counts.
  readinessMain: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  rdCount: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: MONO_FONT,
    fontVariant: ["tabular-nums"],
  },
  rdLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  readinessRight: { marginLeft: "auto" },
  pickerOnlyRow: { marginTop: 14, width: "100%", maxWidth: 1200, alignSelf: "center" },
  rdTrack: { width: 130, height: 6, borderRadius: 6, overflow: "hidden" },
  rdPhases: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  rdPhase: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: MONO_FONT,
    fontVariant: ["tabular-nums"],
  },
  teamChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  teamChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  teamChipName: { fontSize: 12, fontWeight: "600", maxWidth: 120 },
  teamChipCount: {
    fontSize: 11,
    fontFamily: MONO_FONT,
    fontVariant: ["tabular-nums"],
  },
  filterBar: { marginTop: 14, width: "100%", maxWidth: 1200, alignSelf: "center" },
  filterScroll: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterChipText: { fontSize: 13, fontWeight: "600" },
  filterDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: 4,
    marginHorizontal: 2,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
  },
  filterPillText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  filterClear: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  filterClearText: { fontSize: 13, fontWeight: "600" },
  emptyScroll: { padding: 16 },
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 24 },
  emptyAddRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyAddText: { fontSize: 14, fontWeight: "600" },
});
