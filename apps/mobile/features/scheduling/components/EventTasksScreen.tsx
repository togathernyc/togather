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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuth } from "@providers/AuthProvider";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { CustomModal } from "@components/ui/Modal";
import { ProgressBar } from "@components/ui/ProgressBar";
import { formatEventDateLong } from "../utils/format";
import {
  EventTasksGrid,
  TaskOptionList,
  type PlanTask,
  type Segment,
  type TaskPatch,
  type TeamOption,
  type RoleOption,
} from "./EventTasksGrid";
import { EventTasksHowToDocEditor } from "./EventTasksHowToDocEditor";

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
    for (const t of tasks ?? []) ids.add(t.teamId as string);
    return [...ids];
  }, [tasks]);

  // Picker modal state.
  const [teamPickerTask, setTeamPickerTask] = useState<PlanTask | null>(null);
  const [rolePickerTask, setRolePickerTask] = useState<PlanTask | null>(null);
  const [docEditorTask, setDocEditorTask] = useState<PlanTask | null>(null);

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
      const firstTeam = teams[0];
      if (!firstTeam) {
        notifyError(
          "Add a team first",
          "Create a serving team for this group before adding tasks.",
        );
        return;
      }
      try {
        await createTask({
          planId,
          teamId: firstTeam._id,
          segment,
          title: "New task",
          howToType: "none",
        });
      } catch (e: any) {
        notifyError("Couldn't add task", e?.data?.message ?? e?.message ?? "Please try again.");
      }
    },
    [createTask, planId, teams],
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

  const handleReorder = useCallback(
    (orderedIds: Array<Id<"eventTasks">>) => {
      void reorderTasks({ planId, orderedIds }).catch((e: any) =>
        notifyError("Couldn't reorder", e?.data?.message ?? e?.message ?? "Please try again."),
      );
    },
    [reorderTasks, planId],
  );

  // `updateTask` (final API) has no `teamId` arg — a task's team is fixed at
  // creation. Reassigning team is therefore a recreate: carry every editable
  // field onto a new task under the chosen team, drop the role (it belonged to
  // the old team), then delete the original. Stays entirely within the exposed
  // create/delete API.
  const handleReassignTeam = useCallback(
    async (task: PlanTask, teamId: Id<"teams">) => {
      if (task.teamId === teamId) return;
      try {
        await createTask({
          planId,
          teamId,
          segment: task.segment,
          title: task.title,
          howToType: task.howToType,
          howToText: task.howToText,
          howToUrl: task.howToUrl,
          howToMediaPath: task.howToMediaPath,
          howToDoc: task.howToDoc,
        });
        await deleteTask({ taskId: task._id });
      } catch (e: any) {
        notifyError("Couldn't change team", e?.data?.message ?? e?.message ?? "Please try again.");
      }
    },
    [createTask, deleteTask, planId],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const renderHeaderBar = () => (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBtn}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: colors.text }]}>Event tasks</Text>
      <View style={styles.headerBtn} />
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

  const listHeader = (
    <View>
      <Text style={[styles.planTitle, { color: colors.text }]}>
        {event?.title ?? "Event plan"}
      </Text>
      {event ? (
        <Text style={[styles.planDate, { color: colors.textSecondary }]}>
          {formatEventDateLong(event.eventDate)}
        </Text>
      ) : null}
      <ReadinessHeader readiness={readiness} primaryColor={primaryColor} colors={colors} />
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.surface }]}>
      {renderHeaderBar()}

      {/* Populate rolesByTeam for every referenced team + the team currently in
          the role picker, so role labels/pickers resolve without a big join. */}
      {referencedTeamIds.map((tid) => (
        <RoleLoader key={tid} teamId={tid as Id<"teams">} onLoaded={setRolesForTeam} />
      ))}
      {rolePickerTask ? (
        <RoleLoader
          key={`picker-${rolePickerTask.teamId}`}
          teamId={rolePickerTask.teamId}
          onLoaded={setRolesForTeam}
        />
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : (tasks ?? []).length === 0 ? (
        <ScrollView contentContainerStyle={styles.emptyScroll}>
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
        <EventTasksGrid
          tasks={tasks ?? []}
          teams={teams}
          rolesByTeam={rolesByTeam}
          onPatch={handlePatch}
          onDelete={handleDelete}
          onAdd={handleAdd}
          onReorder={handleReorder}
          onPickTeam={setTeamPickerTask}
          onPickRole={setRolePickerTask}
          onOpenDoc={setDocEditorTask}
          listHeader={listHeader}
        />
      )}

      {/* Team picker. */}
      <CustomModal
        visible={teamPickerTask !== null}
        onClose={() => setTeamPickerTask(null)}
        title="Team"
      >
        <TaskOptionList
          options={teams.map((t) => ({ id: t._id as string, name: t.name }))}
          selectedId={teamPickerTask?.teamId as string | undefined}
          onSelect={(id) => {
            if (id && teamPickerTask) {
              void handleReassignTeam(teamPickerTask, id as Id<"teams">);
            }
            setTeamPickerTask(null);
          }}
        />
      </CustomModal>

      {/* Role picker. */}
      <CustomModal
        visible={rolePickerTask !== null}
        onClose={() => setRolePickerTask(null)}
        title="Role"
      >
        <TaskOptionList
          options={(rolePickerTask
            ? rolesByTeam[rolePickerTask.teamId as string] ?? []
            : []
          ).map((r) => ({ id: r._id as string, name: r.name, color: r.color }))}
          selectedId={rolePickerTask?.roleId as string | undefined}
          emptyOption={{ label: "Team-level (no role)" }}
          onSelect={(id) => {
            if (rolePickerTask) {
              // "Team-level (no role)" sends no id → clear the role explicitly
              // (an omitted roleId can't be distinguished from a clear intent).
              handlePatch(
                rolePickerTask._id,
                id
                  ? { roleId: id as Id<"teamRoles"> }
                  : { clearRole: true },
              );
            }
            setRolePickerTask(null);
          }}
        />
      </CustomModal>

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

/** Readiness header — Pre/During/Post progress + per-team breakdown. */
function ReadinessHeader({
  readiness,
  primaryColor,
  colors,
}: {
  readiness: Readiness | undefined;
  primaryColor: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  if (!readiness) return null;
  const segs: Array<{ key: Segment; label: string }> = [
    { key: "before", label: "Pre" },
    { key: "during", label: "During" },
    { key: "after", label: "Post" },
  ];
  const pct = (d: number, t: number) => (t > 0 ? d / t : 0);

  return (
    <View style={[styles.readiness, { borderColor: colors.border }]}>
      <Text style={[styles.readinessTitle, { color: colors.textSecondary }]}>
        READINESS · {readiness.overall.done}/{readiness.overall.total}
      </Text>
      {segs.map((s) => {
        const seg = readiness.bySegment[s.key];
        return (
          <View key={s.key} style={styles.readinessSegRow}>
            <Text style={[styles.readinessSegLabel, { color: colors.text }]}>{s.label}</Text>
            <View style={styles.readinessBar}>
              <ProgressBar
                progress={pct(seg.done, seg.total)}
                color={primaryColor}
                height={6}
                animated={false}
              />
            </View>
            <Text style={[styles.readinessCount, { color: colors.textSecondary }]}>
              {seg.done}/{seg.total}
            </Text>
          </View>
        );
      })}

      {readiness.byTeam.length > 0 ? (
        <View style={styles.teamBreakdown}>
          {readiness.byTeam.map((t) => (
            <View key={t.teamId} style={styles.readinessSegRow}>
              <Text
                style={[styles.readinessTeamLabel, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {t.teamName}
              </Text>
              <View style={styles.readinessBar}>
                <ProgressBar
                  progress={pct(t.done, t.total)}
                  color={colors.success}
                  height={5}
                  animated={false}
                />
              </View>
              <Text style={[styles.readinessCount, { color: colors.textSecondary }]}>
                {t.done}/{t.total}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

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
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  gateText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  planTitle: { fontSize: 22, fontWeight: "700" },
  planDate: { fontSize: 13, marginTop: 4 },
  readiness: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  readinessTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  readinessSegRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  readinessSegLabel: { width: 52, fontSize: 13, fontWeight: "600" },
  readinessTeamLabel: { width: 90, fontSize: 12, fontWeight: "500" },
  readinessBar: { flex: 1 },
  readinessCount: { width: 44, fontSize: 12, textAlign: "right", fontVariant: ["tabular-nums"] },
  teamBreakdown: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "transparent",
    gap: 6,
  },
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
