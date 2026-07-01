/**
 * EventTasksGrid
 *
 * The database/grid body of the leader Event Tasks screen. Renders one plan's
 * tasks grouped by segment (Pre / During / Post = before / during / after) and,
 * within each segment, ordered by team → role. Each task is a row with inline
 * columns:
 *
 *   - Title  → short high-level description (inline text edit).
 *   - Team   → picker (required).
 *   - Role   → picker (optional; empty = a team-level task).
 *   - How-To → the key column (see EventTasksHowToCell).
 *
 * Rows drag-to-reorder within the whole plan via `RunSheetDragList` (the same
 * cross-platform list the run sheet uses); dragging a row past a segment heading
 * moves it into that segment. Each segment has its own "Add task" affordance,
 * and every row can be deleted.
 *
 * This component is presentational + interaction only — data fetching, the
 * readiness header, and mutation wiring live in EventTasksScreen.
 */
import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@hooks/useTheme";
import type { Id } from "@services/api/convex";
import { InlineText } from "./InlineText";
import { RunSheetDragList } from "./RunSheetDragList";
import {
  EventTasksHowToCell,
  type HowToType,
  type HowToPatch,
} from "./EventTasksHowToCell";

/** When a task happens relative to the event (mirrors the backend segment). */
export type Segment = "before" | "during" | "after";

export const SEGMENT_OPTIONS: Array<{ key: Segment; label: string }> = [
  { key: "before", label: "Pre" },
  { key: "during", label: "During" },
  { key: "after", label: "Post" },
];

/**
 * A hydrated task row (mirrors `listPlanTasks`). `teamName` / `roleName` are the
 * hydrated display labels the backend attaches; they may be absent until Agent
 * A's real hydration lands, so treat them as optional.
 */
export type PlanTask = {
  _id: Id<"eventTasks">;
  planId: Id<"eventPlans">;
  teamId: Id<"teams">;
  teamName?: string;
  roleId?: Id<"teamRoles">;
  roleName?: string;
  segment: Segment;
  title: string;
  howToType: HowToType;
  howToText?: string;
  howToUrl?: string;
  howToMediaPath?: string;
  howToDoc?: string;
};

export type TeamOption = { _id: Id<"teams">; name: string };
export type RoleOption = { _id: Id<"teamRoles">; name: string; color?: string };

/** Fields a row can patch through `updateTask`. */
export type TaskPatch = {
  title?: string;
  roleId?: Id<"teamRoles">;
  /** Convert a role-scoped task back to team-level (see updateTask). */
  clearRole?: boolean;
  segment?: Segment;
} & HowToPatch;

type Row =
  | { kind: "header"; segment: Segment; key: string }
  | { kind: "task"; task: PlanTask; key: string };

export function EventTasksGrid({
  tasks,
  teams,
  rolesByTeam,
  onPatch,
  onDelete,
  onAdd,
  onReorder,
  onPickTeam,
  onPickRole,
  onOpenDoc,
  listHeader,
  listFooter,
}: {
  tasks: PlanTask[];
  teams: TeamOption[];
  /** Roles keyed by team id — populated lazily as teams are selected. */
  rolesByTeam: Record<string, RoleOption[] | undefined>;
  onPatch: (taskId: Id<"eventTasks">, patch: TaskPatch) => void;
  onDelete: (task: PlanTask) => void;
  onAdd: (segment: Segment) => void;
  onReorder: (orderedIds: Array<Id<"eventTasks">>) => void;
  /** Open the team picker for a task (parent owns the modal). */
  onPickTeam: (task: PlanTask) => void;
  /** Open the role picker for a task (parent owns the modal). */
  onPickRole: (task: PlanTask) => void;
  /** Open the full-screen doc editor for a task. */
  onOpenDoc: (task: PlanTask) => void;
  listHeader?: React.ReactElement | null;
  listFooter?: React.ReactElement | null;
}) {
  const { colors } = useTheme();

  // Sort tasks within each segment by team → role so the grid reads as a
  // grouped database. Backend order (from reorder) is preserved as the tiebreak
  // via a stable sort on a copy.
  const tasksBySegment = useMemo(() => {
    const groups: Record<Segment, PlanTask[]> = { before: [], during: [], after: [] };
    for (const t of tasks) (groups[t.segment] ?? groups.during).push(t);
    const teamRank = new Map(teams.map((t, i) => [t._id as string, i]));
    for (const seg of Object.keys(groups) as Segment[]) {
      groups[seg] = groups[seg]
        .map((t, i) => ({ t, i }))
        .sort((a, b) => {
          const ta = teamRank.get(a.t.teamId as string) ?? 999;
          const tb = teamRank.get(b.t.teamId as string) ?? 999;
          if (ta !== tb) return ta - tb;
          // Team-level tasks (no role) sort before role-scoped ones.
          const ra = a.t.roleId ? 1 : 0;
          const rb = b.t.roleId ? 1 : 0;
          if (ra !== rb) return ra - rb;
          const na = (a.t.roleName ?? "").localeCompare(b.t.roleName ?? "");
          if (na !== 0) return na;
          return a.i - b.i;
        })
        .map((x) => x.t);
    }
    return groups;
  }, [tasks, teams]);

  // Flat rows for the drag list: each segment heading followed by its tasks.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const seg of SEGMENT_OPTIONS) {
      out.push({ kind: "header", segment: seg.key, key: `seg:${seg.key}` });
      for (const t of tasksBySegment[seg.key]) {
        out.push({ kind: "task", task: t, key: t._id as string });
      }
    }
    return out;
  }, [tasksBySegment]);

  // After a drag, walk the new key order: each heading switches the running
  // segment; each task takes the current one (so dragging past a heading changes
  // its segment). We emit the flat ordered id list to `reorderTasks` and patch
  // any task whose segment changed.
  const handleReorder = (orderedKeys: string[]) => {
    const orderedIds: Array<Id<"eventTasks">> = [];
    let current: Segment = "before";
    const byId = new Map(tasks.map((t) => [t._id as string, t]));
    for (const key of orderedKeys) {
      if (key.startsWith("seg:")) {
        current = key.slice(4) as Segment;
      } else {
        orderedIds.push(key as Id<"eventTasks">);
        const t = byId.get(key);
        if (t && t.segment !== current) {
          onPatch(t._id, { segment: current });
        }
      }
    }
    onReorder(orderedIds);
  };

  const renderHeaderRow = (segment: Segment) => (
    <View style={styles.segHeaderRow}>
      <Text style={[styles.segLabel, { color: colors.textSecondary }]}>
        {SEGMENT_OPTIONS.find((s) => s.key === segment)?.label.toUpperCase()}
      </Text>
      <Pressable
        onPress={() => onAdd(segment)}
        hitSlop={8}
        style={styles.addTaskBtn}
        accessibilityRole="button"
        accessibilityLabel={`Add a task to ${segment}`}
      >
        <Ionicons name="add" size={16} color={colors.buttonPrimary} />
        <Text style={[styles.addTaskText, { color: colors.buttonPrimary }]}>Add task</Text>
      </Pressable>
    </View>
  );

  return (
    <RunSheetDragList
      data={rows}
      keyExtractor={(r) => r.key}
      onReorder={handleReorder}
      ListHeaderComponent={listHeader ?? undefined}
      ListFooterComponent={listFooter ?? undefined}
      contentContainerStyle={styles.listContent}
      renderRow={({ item: row, Handle, isActive }) =>
        row.kind === "header" ? (
          renderHeaderRow(row.segment)
        ) : (
          <TaskRow
            task={row.task}
            teamName={
              row.task.teamName ??
              teams.find((t) => t._id === row.task.teamId)?.name
            }
            roleOptionsForTeam={rolesByTeam[row.task.teamId as string]}
            isActive={isActive}
            Handle={Handle}
            onPatch={(patch) => onPatch(row.task._id, patch)}
            onDelete={() => onDelete(row.task)}
            onPickTeam={() => onPickTeam(row.task)}
            onPickRole={() => onPickRole(row.task)}
            onOpenDoc={() => onOpenDoc(row.task)}
          />
        )
      }
    />
  );
}

/** One inline-editable task row. */
function TaskRow({
  task,
  teamName,
  roleOptionsForTeam,
  isActive,
  Handle,
  onPatch,
  onDelete,
  onPickTeam,
  onPickRole,
  onOpenDoc,
}: {
  task: PlanTask;
  teamName?: string;
  roleOptionsForTeam?: RoleOption[];
  isActive: boolean;
  Handle: React.ComponentType<{ children: React.ReactNode }>;
  onPatch: (patch: TaskPatch) => void;
  onDelete: () => void;
  onPickTeam: () => void;
  onPickRole: () => void;
  onOpenDoc: () => void;
}) {
  const { colors } = useTheme();

  const roleLabel =
    task.roleName ??
    roleOptionsForTeam?.find((r) => r._id === task.roleId)?.name;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
          opacity: isActive ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.rowTop}>
        <Handle>
          <View style={styles.grip} accessibilityLabel="Drag to reorder" hitSlop={10}>
            <Ionicons name="reorder-three" size={20} color={colors.textTertiary} />
          </View>
        </Handle>

        <View style={styles.titleCol}>
          <InlineText
            value={task.title}
            onSave={(t) => onPatch({ title: t })}
            placeholder="Task title"
            required
            maxLength={140}
            accessibilityLabel="Task title"
            style={[styles.titleInput, { color: colors.text }]}
          />
        </View>

        <Pressable onPress={onDelete} hitSlop={6} style={styles.deleteBtn} accessibilityLabel="Delete task">
          <Ionicons name="close" size={18} color={colors.textTertiary} />
        </Pressable>
      </View>

      {/* Team + Role pickers. */}
      <View style={styles.pickerRow}>
        <PickerPill
          label="Team"
          value={teamName}
          placeholder="Pick team"
          onPress={onPickTeam}
          colors={colors}
        />
        <PickerPill
          label="Role"
          value={roleLabel}
          placeholder="Team-level"
          onPress={onPickRole}
          colors={colors}
        />
      </View>

      {/* How-To column. */}
      <View style={styles.howToWrap}>
        <Text style={[styles.colLabel, { color: colors.textTertiary }]}>HOW-TO</Text>
        <EventTasksHowToCell
          howToType={task.howToType}
          howToText={task.howToText}
          howToUrl={task.howToUrl}
          howToMediaPath={task.howToMediaPath}
          howToDoc={task.howToDoc}
          onPatch={onPatch}
          onOpenDoc={onOpenDoc}
        />
      </View>
    </View>
  );
}

function PickerPill({
  label,
  value,
  placeholder,
  onPress,
  colors,
}: {
  label: string;
  value?: string;
  placeholder: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const filled = !!value;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pickerPill, { borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? placeholder}`}
    >
      <Text style={[styles.pickerPillLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text
        style={[styles.pickerPillValue, { color: filled ? colors.text : colors.textTertiary }]}
        numberOfLines={1}
      >
        {value ?? placeholder}
      </Text>
      <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
    </Pressable>
  );
}

/**
 * A shared picker modal body — a scrollable option list. The screen renders this
 * inside a CustomModal for both the team and role pickers.
 */
export function TaskOptionList({
  options,
  selectedId,
  emptyOption,
  onSelect,
}: {
  options: Array<{ id: string; name: string; color?: string }>;
  selectedId?: string;
  /** When set, prepends a "clear" row (e.g. "Team-level (no role)"). */
  emptyOption?: { label: string };
  onSelect: (id: string | null) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView style={styles.optionScroll}>
      {emptyOption ? (
        <Pressable
          onPress={() => onSelect(null)}
          style={[styles.optionRow, !selectedId && { backgroundColor: colors.surfaceSecondary }]}
        >
          <Text style={[styles.optionText, { color: colors.textSecondary }]}>
            {emptyOption.label}
          </Text>
          {!selectedId ? (
            <Ionicons name="checkmark" size={18} color={colors.buttonPrimary} />
          ) : null}
        </Pressable>
      ) : null}
      {options.length === 0 ? (
        <Text style={[styles.optionEmpty, { color: colors.textTertiary }]}>
          No options available.
        </Text>
      ) : (
        options.map((o) => {
          const active = o.id === selectedId;
          return (
            <Pressable
              key={o.id}
              onPress={() => onSelect(o.id)}
              style={[styles.optionRow, active && { backgroundColor: colors.surfaceSecondary }]}
            >
              {o.color ? (
                <View style={[styles.optionSwatch, { backgroundColor: o.color }]} />
              ) : null}
              <Text style={[styles.optionText, { color: colors.text }]}>{o.name}</Text>
              {active ? <Ionicons name="checkmark" size={18} color={colors.buttonPrimary} /> : null}
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: 16, paddingBottom: 120 },
  segHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 8,
  },
  segLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  addTaskBtn: { flexDirection: "row", alignItems: "center", gap: 2, padding: 4 },
  addTaskText: { fontSize: 13, fontWeight: "600" },
  row: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  grip: { paddingHorizontal: 2, paddingVertical: 6, justifyContent: "center" },
  titleCol: { flex: 1 },
  titleInput: { fontSize: 15, fontWeight: "600" },
  deleteBtn: { padding: 4 },
  pickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingLeft: 30 },
  pickerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "100%",
  },
  pickerPillLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  pickerPillValue: { fontSize: 13, fontWeight: "500", flexShrink: 1, maxWidth: 160 },
  howToWrap: { paddingLeft: 30, gap: 4 },
  colLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  optionScroll: { maxHeight: 360 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
  },
  optionSwatch: { width: 12, height: 12, borderRadius: 6 },
  optionText: { flex: 1, fontSize: 15, fontWeight: "500" },
  optionEmpty: { fontSize: 14, padding: 16, fontStyle: "italic" },
});
