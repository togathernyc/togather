/**
 * EventTasksGrid
 *
 * The database/grid body of the leader Event Tasks screen. Renders one plan's
 * tasks as a single continuous bordered table (modelled on the events-os Run of
 * Show table): a header row of column labels over dividered task rows. There are
 * NO Pre/During/Post section-heading rows breaking the table up — the phase is
 * just another column (a pill you tap to change).
 *
 * Columns (after the auto drag-grip): Task, Phase, Team, Role, How-To, and a
 * delete action. Tasks are still sorted within each segment by team → role, then
 * flattened in Pre → During → Post order. Rows drag-to-reorder within the whole
 * plan; the segment now changes via the Phase column, not by dragging past a
 * heading, so reorder is a plain id reorder.
 *
 * This component is presentational + interaction only — data fetching, the
 * readiness header, and mutation wiring live in EventTasksScreen.
 */
import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import type { Id } from "@services/api/convex";
import { InlineText } from "./InlineText";
import { GridScrollList, OptionTag, type GridColumn } from "./GridScrollList";
import { AnchoredMenu, measureAnchor, type AnchorRect } from "./AnchoredMenu";
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
 * A small palette of pleasant, distinct hexes for team tags (events-os style —
 * Flower pink, Food & Bev amber, Welcome blue…). Teams have no color field, so a
 * team's color is derived by hashing its id into this palette — stable per team.
 */
const TEAM_COLORS = [
  "#EC4899", // pink
  "#F59E0B", // amber
  "#3B82F6", // blue
  "#10B981", // emerald
  "#8B5CF6", // violet
  "#EF4444", // red
  "#14B8A6", // teal
  "#F97316", // orange
];

/** Stable color for a team, derived by hashing its id into the palette. */
function teamColor(teamId: string): string {
  let hash = 0;
  for (let i = 0; i < teamId.length; i++) {
    hash = (hash * 31 + teamId.charCodeAt(i)) >>> 0;
  }
  return TEAM_COLORS[hash % TEAM_COLORS.length];
}

/**
 * A hydrated task row (mirrors `listPlanTasks`). A task targets one or more
 * teams (`teamIds`, always >= 1) and zero or more roles (`roleIds`); an empty
 * `roleIds` means a team-level task. `teamNames` / `roleNames` are the hydrated
 * display labels, parallel to the id arrays.
 */
export type PlanTask = {
  _id: Id<"eventTasks">;
  planId: Id<"eventPlans">;
  teamIds: Id<"teams">[];
  teamNames: string[];
  roleIds: Id<"teamRoles">[];
  roleNames: string[];
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
  /** Replace the task's team(s). Must stay non-empty. */
  teamIds?: Id<"teams">[];
  /** Replace the task's role(s). Empty => team-level. */
  roleIds?: Id<"teamRoles">[];
  segment?: Segment;
} & HowToPatch;

export function EventTasksGrid({
  tasks,
  teams,
  rolesByTeam,
  onPatch,
  onDelete,
  onDuplicate,
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
  /** Create a copy of a task (same team/role/segment/title/how-to). */
  onDuplicate: (task: PlanTask) => void;
  onAdd: (segment: Segment) => void;
  onReorder: (orderedIds: Array<Id<"eventTasks">>) => void;
  /** Open the team picker for a task, anchored to its pill (parent owns the menu). */
  onPickTeam: (task: PlanTask, anchor: AnchorRect) => void;
  /** Open the role picker for a task, anchored to its pill (parent owns the menu). */
  onPickRole: (task: PlanTask, anchor: AnchorRect) => void;
  /** Open the full-screen doc editor for a task. */
  onOpenDoc: (task: PlanTask) => void;
  listHeader?: React.ReactElement | null;
  listFooter?: React.ReactElement | null;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();

  // Phase menu (Pre / During / Post) for one task — an anchored dropdown next to
  // the pill. Held locally; the parent owns the team/role menus, but phase lives
  // entirely in the grid.
  const [phaseMenu, setPhaseMenu] = useState<{
    task: PlanTask;
    anchor: AnchorRect;
  } | null>(null);

  const columns = useMemo<GridColumn[]>(
    () => [
      { key: "task", label: "Task", width: 220, flex: 3 },
      { key: "phase", label: "Phase", width: 104 },
      { key: "team", label: "Team", width: 160 },
      { key: "role", label: "Role", width: 160 },
      { key: "howto", label: "How-To", width: 260, flex: 3 },
      { key: "actions", label: "", width: 84, align: "center" },
    ],
    [],
  );

  // Sort tasks within each segment by team → role so the grid reads as a
  // grouped database. Backend order (from reorder) is preserved as the tiebreak
  // via a stable sort on a copy.
  const tasksBySegment = useMemo(() => {
    const groups: Record<Segment, PlanTask[]> = { before: [], during: [], after: [] };
    for (const t of tasks) (groups[t.segment] ?? groups.during).push(t);
    const teamRank = new Map(teams.map((t, i) => [t._id as string, i]));
    // Group by the task's first team (multi-team tasks sort by their leading
    // team) so the grid still reads as a grouped database.
    for (const seg of Object.keys(groups) as Segment[]) {
      groups[seg] = groups[seg]
        .map((t, i) => ({ t, i }))
        .sort((a, b) => {
          const ta = teamRank.get(a.t.teamIds[0] as string) ?? 999;
          const tb = teamRank.get(b.t.teamIds[0] as string) ?? 999;
          if (ta !== tb) return ta - tb;
          // Team-level tasks (no roles) sort before role-scoped ones.
          const ra = a.t.roleIds.length > 0 ? 1 : 0;
          const rb = b.t.roleIds.length > 0 ? 1 : 0;
          if (ra !== rb) return ra - rb;
          const na = (a.t.roleNames[0] ?? "").localeCompare(
            b.t.roleNames[0] ?? "",
          );
          if (na !== 0) return na;
          return a.i - b.i;
        })
        .map((x) => x.t);
    }
    return groups;
  }, [tasks, teams]);

  // Flat task list for the table, in Pre → During → Post order.
  const flatTasks = useMemo<PlanTask[]>(
    () =>
      tasksBySegment.before.concat(tasksBySegment.during, tasksBySegment.after),
    [tasksBySegment],
  );

  // Segments now change via the Phase column, so drag is a plain id reorder.
  const handleReorder = (orderedKeys: string[]) => {
    const byId = new Map(tasks.map((t) => [t._id as string, t._id]));
    const orderedIds = orderedKeys
      .map((k) => byId.get(k))
      .filter((id): id is Id<"eventTasks"> => id !== undefined);
    onReorder(orderedIds);
  };

  const renderCell = (task: PlanTask, key: string) => {
    switch (key) {
      case "task":
        return (
          <InlineText
            value={task.title}
            onSave={(t) => onPatch(task._id, { title: t })}
            placeholder="Task title"
            required
            maxLength={140}
            accessibilityLabel="Task title"
            style={[styles.titleInput, { color: colors.text }]}
          />
        );
      case "phase": {
        const label =
          SEGMENT_OPTIONS.find((s) => s.key === task.segment)?.label ?? "Pre";
        return (
          <PhasePill
            label={label}
            colors={colors}
            primaryColor={primaryColor}
            onOpen={(anchor) => setPhaseMenu({ task, anchor })}
          />
        );
      }
      case "team": {
        const chips = task.teamIds.map((id, i) => ({
          id: id as string,
          label:
            task.teamNames[i] ??
            teams.find((t) => t._id === id)?.name ??
            "Team",
          color: teamColor(id as string),
        }));
        return (
          <ChipCell
            chips={chips}
            addLabel="Team"
            // A task must keep at least one team — block removing the last.
            onRemove={
              task.teamIds.length > 1
                ? (id) =>
                    onPatch(task._id, {
                      teamIds: task.teamIds.filter((t) => (t as string) !== id),
                    })
                : undefined
            }
            onAdd={(anchor) => onPickTeam(task, anchor)}
            colors={colors}
            primaryColor={primaryColor}
          />
        );
      }
      case "role": {
        // Resolve each role's color from the loaded roles across the task's
        // teams (roles are fetched per team into `rolesByTeam`).
        const roleColor = (roleId: string): string | undefined => {
          for (const tid of task.teamIds) {
            const found = rolesByTeam[tid as string]?.find(
              (rl) => (rl._id as string) === roleId,
            );
            if (found) return found.color;
          }
          return undefined;
        };
        const chips = task.roleIds.map((id, i) => ({
          id: id as string,
          label: task.roleNames[i] ?? "Role",
          dotColor: roleColor(id as string),
        }));
        return (
          <ChipCell
            chips={chips}
            addLabel="Role"
            emptyPlaceholder="Team-level"
            onRemove={(id) =>
              onPatch(task._id, {
                roleIds: task.roleIds.filter((r) => (r as string) !== id),
              })
            }
            onAdd={(anchor) => onPickRole(task, anchor)}
            colors={colors}
            primaryColor={primaryColor}
          />
        );
      }
      case "howto":
        return (
          <EventTasksHowToCell
            howToType={task.howToType}
            howToText={task.howToText}
            howToUrl={task.howToUrl}
            howToMediaPath={task.howToMediaPath}
            howToDoc={task.howToDoc}
            onPatch={(patch) => onPatch(task._id, patch)}
            onOpenDoc={() => onOpenDoc(task)}
          />
        );
      case "actions":
        return (
          <View style={styles.actionsCell}>
            <Pressable
              onPress={() => onDuplicate(task)}
              hitSlop={6}
              style={styles.actionBtn}
              accessibilityLabel="Duplicate task"
            >
              <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => onDelete(task)}
              hitSlop={6}
              style={styles.actionBtn}
              accessibilityLabel="Delete task"
            >
              <Ionicons name="trash-outline" size={18} color={colors.destructive} />
            </Pressable>
          </View>
        );
      default:
        return null;
    }
  };

  // Add-task bar below the table. Sections are gone, so a new task starts in Pre
  // and the leader reassigns its phase via the Phase column.
  const footer = (
    <View style={{ paddingBottom: insets.bottom + 8 }}>
      <Pressable
        onPress={() => onAdd("before")}
        style={[
          styles.addTaskBar,
          { borderColor: primaryColor, backgroundColor: primaryColor + "0D" },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add a task"
      >
        <Ionicons name="add" size={18} color={primaryColor} />
        <Text style={[styles.addTaskText, { color: primaryColor }]}>Add task</Text>
      </Pressable>
      {listFooter}
    </View>
  );

  // Re-derive the live task so a deleted row closes the phase menu.
  const livePhaseTask = phaseMenu
    ? tasks.find((t) => t._id === phaseMenu.task._id) ?? null
    : null;

  return (
    <>
      <GridScrollList
        data={flatTasks}
        keyExtractor={(t) => t._id as string}
        onReorder={handleReorder}
        columns={columns}
        renderCell={(item, columnKey) => renderCell(item, columnKey)}
        ListHeaderComponent={listHeader ?? undefined}
        ListFooterComponent={footer}
        contentContainerStyle={styles.listContent}
        dense
      />

      {/* Phase menu (Pre / During / Post) — an anchored dropdown at the pill. */}
      {phaseMenu && livePhaseTask ? (
        <AnchoredMenu
          anchor={phaseMenu.anchor}
          options={SEGMENT_OPTIONS.map((s) => ({ id: s.key, name: s.label }))}
          selectedId={livePhaseTask.segment}
          onSelect={(id) => {
            if (id) onPatch(livePhaseTask._id, { segment: id as Segment });
            setPhaseMenu(null);
          }}
          onClose={() => setPhaseMenu(null)}
        />
      ) : null}
    </>
  );
}

/**
 * The Phase pill (Pre / During / Post). Measures its own window rect on press so
 * the parent can anchor the dropdown to it — the table card clips overflow, so
 * the menu can't live inside the cell.
 */
function PhasePill({
  label,
  colors,
  primaryColor,
  onOpen,
}: {
  label: string;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
  onOpen: (anchor: AnchorRect) => void;
}) {
  const ref = React.useRef<View>(null);
  return (
    <Pressable
      ref={ref}
      onPress={() => measureAnchor(ref.current, onOpen)}
      style={styles.tagPressable}
      accessibilityRole="button"
      accessibilityLabel={`Phase: ${label}. Tap to change.`}
    >
      <OptionTag
        label={label}
        colors={colors}
        primaryColor={primaryColor}
        tinted
        chevron
      />
    </Pressable>
  );
}

/**
 * A cell that renders a wrapping set of removable chips (teams or roles) plus an
 * add affordance that measures its own window rect so the parent can anchor a
 * multi-select menu to it. The chips and the add control sit INLINE on one row
 * (wrapping only when they overflow the column), so the common case — a single
 * team / role — is a single line.
 *
 * When there are chips, the add control is a compact icon-only "+" button placed
 * right after the last chip. When there are none and an `emptyPlaceholder` is
 * given (the role column's team-level case), it renders as a single dashed
 * "+ Team-level" chip that opens the same picker — so team-level rows are also
 * one line and still read as "no role = team-level".
 */
function ChipCell({
  chips,
  addLabel,
  emptyPlaceholder,
  onRemove,
  onAdd,
  colors,
  primaryColor,
}: {
  chips: Array<{ id: string; label: string; color?: string; dotColor?: string }>;
  addLabel: string;
  emptyPlaceholder?: string;
  /** Omit to disable removal (e.g. can't remove a task's last team). */
  onRemove?: (id: string) => void;
  onAdd: (anchor: AnchorRect) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  primaryColor: string;
}) {
  const addRef = React.useRef<View>(null);
  // Empty + a placeholder label => the team-level dashed chip (role column).
  const showPlaceholder = chips.length === 0 && !!emptyPlaceholder;
  return (
    <View style={styles.chipWrap}>
      {chips.map((chip) => (
        <View
          key={chip.id}
          style={[
            styles.chip,
            chip.color
              ? { backgroundColor: chip.color + "22", borderColor: chip.color + "55" }
              : { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          {chip.dotColor ? (
            <View style={[styles.chipDot, { backgroundColor: chip.dotColor }]} />
          ) : null}
          <Text
            style={[styles.chipText, { color: colors.text }]}
            numberOfLines={1}
          >
            {chip.label}
          </Text>
          {onRemove ? (
            <Pressable
              onPress={() => onRemove(chip.id)}
              hitSlop={6}
              accessibilityLabel={`Remove ${chip.label}`}
            >
              <Ionicons name="close" size={13} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {showPlaceholder ? (
        // Team-level: a single dashed placeholder chip that opens the role picker.
        <Pressable
          ref={addRef}
          onPress={() => measureAnchor(addRef.current, onAdd)}
          style={[styles.chipAdd, { borderColor: primaryColor }]}
          accessibilityRole="button"
          accessibilityLabel={emptyPlaceholder}
        >
          <Ionicons name="add" size={13} color={primaryColor} />
          <Text style={[styles.chipAddText, { color: primaryColor }]}>
            {emptyPlaceholder}
          </Text>
        </Pressable>
      ) : (
        // Compact icon-only add, inline after the last chip to keep one line.
        <Pressable
          ref={addRef}
          onPress={() => measureAnchor(addRef.current, onAdd)}
          hitSlop={8}
          style={[
            styles.chipAddCompact,
            { borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Add ${addLabel.toLowerCase()}`}
        >
          <Ionicons name="add" size={15} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * A shared picker modal body — a scrollable option list. The screen renders this
 * inside a CustomModal for the team, role, and phase pickers.
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
  listContent: { paddingBottom: 24 },
  titleInput: { fontSize: 15, fontWeight: "600", width: "100%" },
  actionsCell: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionBtn: { padding: 4, alignItems: "center", justifyContent: "center" },
  // Wraps an OptionTag that opens an anchored menu (self-aligned so it hugs its
  // content and can be measured for the dropdown anchor).
  tagPressable: { alignSelf: "flex-start", maxWidth: "100%" },
  // Add-task bar below the table card — a clear, tappable dashed button.
  addTaskBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  addTaskText: { fontSize: 15, fontWeight: "600" },
  // Multi-chip team/role cells.
  chipWrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 8,
    paddingRight: 6,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "100%",
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  chipAdd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  chipAddText: { fontSize: 12, fontWeight: "600" },
  // Compact icon-only add: a small muted circle that hugs the chip on one line.
  // Visually ~24px; hitSlop widens the touch target to a comfortable size.
  chipAddCompact: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
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
