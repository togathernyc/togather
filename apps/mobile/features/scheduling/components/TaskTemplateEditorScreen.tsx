/**
 * TaskTemplateEditorScreen
 *
 * The item editor for one task TEMPLATE (event templates Phase 2). It reuses the
 * plan-level `EventTasksGrid` verbatim — the grid is presentational and never
 * reads `planId`, so template items are adapted to its `PlanTask` shape and the
 * grid's callbacks are wired to the `*TaskTemplateItem*` mutations instead of
 * the plan's `eventTasks` mutations. The id-brand mismatch (template item vs
 * plan task) is bridged with localized casts at this boundary so the shared grid
 * stays untouched.
 *
 * Route: /rostering/[group_id]/templates/task/[template_id]
 * Backend: scheduling.taskTemplates.{listTaskTemplateItems,addTaskTemplateItem,
 *          updateTaskTemplateItem,deleteTaskTemplateItem,reorderTaskTemplateItems,
 *          listTaskTemplates,renameTaskTemplate}
 *
 * Auth: leaders / community admins only — mirrors EventTasksScreen's gate.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
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
import {
  EventTasksGrid,
  type PlanTask,
  type Segment,
  type TaskPatch,
  type TeamOption,
  type RoleOption,
} from "./EventTasksGrid";
import { AnchoredMenu, type AnchorRect } from "./AnchoredMenu";
import { EventTasksHowToDocEditor } from "./EventTasksHowToDocEditor";
import {
  listTaskTemplatesRef,
  renameTaskTemplateRef,
  listTaskTemplateItemsRef,
  addTaskTemplateItemRef,
  updateTaskTemplateItemRef,
  deleteTaskTemplateItemRef,
  reorderTaskTemplateItemsRef,
  type TaskTemplateItem,
  type TaskTemplateSummary,
} from "../api/eventTemplates";

function notifyError(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

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

const errMsg = (e: unknown) => {
  const err = e as { data?: { message?: string } | string; message?: string };
  const data = err?.data;
  if (typeof data === "string") return data;
  return data?.message ?? err?.message ?? "Please try again.";
};

// The grid is typed to the plan's `eventTasks` ids; template items carry
// `eventTaskTemplateItems` ids. These branded strings are structurally the same
// value, so we cast at the boundary rather than fork the shared grid.
const asTaskId = (id: string) => id as unknown as Id<"eventTasks">;
const asItemId = (id: Id<"eventTasks">) =>
  id as unknown as Id<"eventTaskTemplateItems">;

export function TaskTemplateEditorScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { group_id, template_id } = useLocalSearchParams<{
    group_id: string;
    template_id: string;
  }>();
  const groupId = group_id as Id<"groups">;
  const templateId = template_id as Id<"eventTaskTemplates">;

  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    group_id ? { groupId } : "skip",
  ) as { userRole?: string } | null | undefined;
  const isLeader =
    groupData?.userRole === "leader" ||
    groupData?.userRole === "admin" ||
    user?.is_admin === true;

  const templates = useAuthenticatedQuery(
    listTaskTemplatesRef,
    isLeader && groupId ? { groupId } : "skip",
  ) as TaskTemplateSummary[] | undefined;
  const template = useMemo(
    () => (templates ?? []).find((t) => t._id === templateId) ?? null,
    [templates, templateId],
  );

  const items = useAuthenticatedQuery(
    listTaskTemplateItemsRef,
    isLeader && templateId ? { templateId } : "skip",
  ) as TaskTemplateItem[] | undefined;

  const teamsData = useAuthenticatedQuery(
    api.functions.scheduling.teams.listTeams,
    isLeader && groupId ? { groupId } : "skip",
  ) as Array<{ _id: Id<"teams">; name: string }> | undefined;

  const addItem = useAuthenticatedMutation(addTaskTemplateItemRef);
  const updateItem = useAuthenticatedMutation(updateTaskTemplateItemRef);
  const deleteItem = useAuthenticatedMutation(deleteTaskTemplateItemRef);
  const reorderItems = useAuthenticatedMutation(reorderTaskTemplateItemsRef);
  const renameTemplate = useAuthenticatedMutation(renameTaskTemplateRef);

  const teams: TeamOption[] = useMemo(
    () => (teamsData ?? []).map((t) => ({ _id: t._id, name: t.name })),
    [teamsData],
  );

  // Roles loaded per referenced team (same lazy pattern as EventTasksScreen).
  const [rolesByTeam, setRolesByTeam] = useState<Record<string, RoleOption[]>>(
    {},
  );
  const setRolesForTeam = useCallback((teamId: string, roles: RoleOption[]) => {
    setRolesByTeam((prev) => {
      const existing = prev[teamId];
      if (
        existing &&
        existing.length === roles.length &&
        existing.every(
          (r, i) => r._id === roles[i]._id && r.name === roles[i].name,
        )
      ) {
        return prev;
      }
      return { ...prev, [teamId]: roles };
    });
  }, []);

  // Adapt template items to the grid's PlanTask shape.
  const tasks = useMemo<PlanTask[]>(
    () =>
      (items ?? []).map((it) => ({
        _id: asTaskId(it._id as string),
        planId: templateId as unknown as Id<"eventPlans">,
        teamIds: it.teamIds.map((id) => id as Id<"teams">),
        teamNames: it.teamNames,
        roleIds: it.roleIds.map((id) => id as Id<"teamRoles">),
        roleNames: it.roleNames,
        segment: it.segment,
        title: it.title,
        howToType: it.howToType,
        howToText: it.howToText,
        howToUrl: it.howToUrl,
        howToMediaPath: it.howToMediaPath,
        howToDoc: it.howToDoc,
      })),
    [items, templateId],
  );

  const referencedTeamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) for (const id of t.teamIds) ids.add(id as string);
    return [...ids];
  }, [tasks]);

  const [teamPicker, setTeamPicker] = useState<{
    task: PlanTask;
    anchor: AnchorRect;
  } | null>(null);
  const [rolePicker, setRolePicker] = useState<{
    task: PlanTask;
    anchor: AnchorRect;
  } | null>(null);
  const [docEditorTask, setDocEditorTask] = useState<PlanTask | null>(null);
  const [renaming, setRenaming] = useState(false);

  const handlePatch = useCallback(
    (taskId: Id<"eventTasks">, patch: TaskPatch) => {
      void updateItem({ itemId: asItemId(taskId), ...patch }).catch((e) =>
        notifyError("Couldn't save", errMsg(e)),
      );
    },
    [updateItem],
  );

  const handleAdd = useCallback(
    async (segment: Segment) => {
      // Distinguish "teams still loading" from "genuinely no teams" so a tap
      // before listTeams resolves doesn't wrongly claim there are none.
      if (teamsData === undefined) {
        notifyError(
          "Just a moment",
          "Teams are still loading — try again in a second.",
        );
        return;
      }
      const teamId = teams[0]?._id;
      if (!teamId) {
        notifyError(
          "Add a team first",
          "Create a serving team for this group before adding tasks.",
        );
        return;
      }
      try {
        await addItem({
          templateId,
          teamIds: [teamId],
          roleIds: [],
          segment,
          title: "New task",
          howToType: "none",
        });
      } catch (e) {
        notifyError("Couldn't add task", errMsg(e));
      }
    },
    [addItem, templateId, teams, teamsData],
  );

  const handleDelete = useCallback(
    (task: PlanTask) => {
      confirmDelete(`Remove "${task.title}"?`, () => {
        void deleteItem({ itemId: asItemId(task._id) }).catch((e) =>
          notifyError("Couldn't delete", errMsg(e)),
        );
      });
    },
    [deleteItem],
  );

  const handleDuplicate = useCallback(
    async (task: PlanTask) => {
      try {
        await addItem({
          templateId,
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
      } catch (e) {
        notifyError("Couldn't duplicate", errMsg(e));
      }
    },
    [addItem, templateId],
  );

  const handleReorder = useCallback(
    (orderedIds: Array<Id<"eventTasks">>) => {
      void reorderItems({
        templateId,
        orderedIds: orderedIds.map(asItemId),
      }).catch((e) => notifyError("Couldn't reorder", errMsg(e)));
    },
    [reorderItems, templateId],
  );

  const handleToggleTeam = useCallback(
    (task: PlanTask, teamId: Id<"teams">) => {
      const has = task.teamIds.includes(teamId);
      const next = has
        ? task.teamIds.filter((t) => t !== teamId)
        : [...task.teamIds, teamId];
      if (next.length === 0) return;
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

  const templateName = template?.name ?? "Task template";

  const renderHeaderBar = () => (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBtn}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </TouchableOpacity>
      <Pressable
        onPress={() => template && setRenaming(true)}
        style={styles.headerTitleWrap}
        accessibilityRole="button"
        accessibilityLabel="Rename template"
      >
        <Text
          style={[styles.headerTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {templateName}
        </Text>
        {template ? (
          <Ionicons name="pencil" size={13} color={colors.textTertiary} />
        ) : null}
      </Pressable>
      <View style={styles.headerBtn} />
    </View>
  );

  if (groupData === undefined || (isLeader && items === undefined)) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        {renderHeaderBar()}
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </View>
    );
  }

  if (!isLeader) {
    return (
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, backgroundColor: colors.surface },
        ]}
      >
        {renderHeaderBar()}
        <View style={styles.centered}>
          <Ionicons name="people-outline" size={40} color={colors.iconSecondary} />
          <Text style={[styles.gateText, { color: colors.textSecondary }]}>
            Only leaders can edit templates.
          </Text>
        </View>
      </View>
    );
  }

  const listHeader = (
    <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
      Define the tasks each team and role is accountable for. These seed a plan's
      Event Tasks when you apply this template.
    </Text>
  );

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      {renderHeaderBar()}

      {/* Load roles for every referenced team + the team currently in the role
          picker, so role labels/pickers resolve without a big join. */}
      {referencedTeamIds.map((tid) => (
        <RoleLoader
          key={tid}
          teamId={tid as Id<"teams">}
          onLoaded={setRolesForTeam}
        />
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

      {(items ?? []).length === 0 ? (
        <ScrollView contentContainerStyle={styles.emptyScroll}>
          {listHeader}
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No tasks yet. Use "Add task" to define what each team and role is
            accountable for, then attach a How-To for each.
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
          tasks={tasks}
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
          storageKey="taskTemplate"
        />
      )}

      {/* Team picker — multi-select; reads the LIVE task so checkmarks reflect
          each toggle. */}
      {teamPicker
        ? (() => {
            const live =
              tasks.find((t) => t._id === teamPicker.task._id) ?? teamPicker.task;
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

      {/* Role picker — union of roles across the task's teams. */}
      {rolePicker
        ? (() => {
            const live =
              tasks.find((t) => t._id === rolePicker.task._id) ?? rolePicker.task;
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
                onToggle={(id) => handleToggleRole(live, id as Id<"teamRoles">)}
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

      {/* Rename the template. */}
      <CustomModal
        visible={renaming}
        onClose={() => setRenaming(false)}
        title="Rename template"
      >
        <RenameBody
          key={templateName}
          initialValue={templateName}
          colors={colors}
          primaryColor={primaryColor}
          onSave={(name) => {
            setRenaming(false);
            void renameTemplate({ templateId, name }).catch((e) =>
              notifyError("Couldn't rename", errMsg(e)),
            );
          }}
        />
      </CustomModal>
    </View>
  );
}

/**
 * Loads a team's roles and reports them up. Rendered once per referenced team so
 * the grid can show role names and the role picker has options.
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

function RenameBody({
  initialValue,
  colors,
  primaryColor,
  onSave,
}: {
  initialValue: string;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const canSave = value.trim().length > 0;
  return (
    <View style={styles.renameBody}>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="Template name"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        maxLength={50}
        returnKeyType="done"
        onSubmitEditing={() => canSave && onSave(value.trim())}
        accessibilityLabel="Template name"
        style={[
          styles.renameInput,
          { color: colors.text, borderColor: colors.border },
        ]}
      />
      <Pressable
        onPress={() => canSave && onSave(value.trim())}
        disabled={!canSave}
        style={[
          styles.saveBtn,
          { backgroundColor: primaryColor, opacity: canSave ? 1 : 0.5 },
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.saveBtnText}>Save</Text>
      </Pressable>
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
  headerTitleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  headerTitle: { fontSize: 17, fontWeight: "600", flexShrink: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  gateText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  subtitle: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
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
  renameBody: { gap: 12, paddingTop: 4 },
  renameInput: {
    fontSize: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  saveBtn: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  saveBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
});
