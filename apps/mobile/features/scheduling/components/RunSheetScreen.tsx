/**
 * RunSheetScreen
 *
 * The native, editable run sheet (order-of-items) for an event plan (ADR-026).
 *
 * One run sheet is shared across all of a plan's service times — the order and
 * durations are identical; only the start differs. So there is no per-time
 * toggle: rows show clock times from the earliest start, and the header shows
 * every service as a start–end range that grows as items/durations change.
 *
 * Editing is spreadsheet-style: the run sheet is one dense `GridScrollList`
 * table (Item / Time / Dur / Owner-Role / Notes / Song / ⋯) modelled on the
 * events-os Run of Show. Rows are grouped into collapsible Before / During /
 * After sections — a row's phase is its section (there is no "When" column).
 * Duration and title edit inline; Who, Notes, and Song open focused modals.
 * Reordering is drag-and-drop from a grip in the first cell (web + native).
 * The per-row "⋯" menu moves an item to another segment, duplicates, or deletes
 * it, and each section's footer adds a new item into that segment.
 *
 * Route: /rostering/[group_id]/run-sheet/[plan_id]
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_ROLE_COLOR, formatEventDateLong } from "../utils/format";
import {
  computeSegmentedClockTimes,
  formatClockTime,
  formatServiceRanges,
  totalDurationSec,
} from "../utils/runSheetTiming";
import { useAuth } from "@providers/AuthProvider";
import { InlineText } from "./InlineText";
import {
  GridScrollList,
  OptionTag,
  type GridColumn,
  type GridSection,
} from "./GridScrollList";
import { AnchoredMenu, measureAnchor, type AnchorRect } from "./AnchoredMenu";
import { SegmentedTabs } from "@components/ui/SegmentedTabs";
import { CustomModal } from "@components/ui/Modal";
import { PlanTemplateToolbar } from "./PlanTemplateToolbar";
import { listRunSheetTemplatesRef } from "../api/eventTemplates";
import {
  getPlanTemplateStateRef,
  setPlanRunSheetTemplateRef,
  saveRunSheetTemplateFromPlanRef,
  revertPlanRunSheetTemplateEditsRef,
  type PlanTemplateState,
  type TemplateCarryover,
  type SaveTemplateStrategy,
} from "../api/planTemplates";
import type { Song } from "@features/songs/types";
import {
  AddButton,
  DurationCell,
  WhoModalBody,
  NotesModalBody,
  SongModalBody,
  SEGMENT_OPTIONS,
  type Segment,
  type ItemAssignment,
  type RoleOption,
  type ItemPatch,
} from "./RunSheetItemEditors";

/**
 * Show a one-button error. React Native's Alert.alert is a no-op on web in this
 * codebase, so fall back to window.alert there — otherwise a failed save /
 * delete / reorder would fail silently for web users.
 */
function notifyError(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

type RunSheetItem = {
  _id: Id<"eventItems">;
  planId: Id<"eventPlans">;
  segment: string;
  sequence: number;
  type: string;
  title: string;
  description: string | null;
  durationSec: number;
  notes: Array<{ category: string; content: string }>;
  songDetails: { key?: string; bpm?: number; author?: string } | null;
  // Link to a library song (ADR-027). When set, the joined `song` carries the
  // defaults; `songDetails.key`/`.bpm` become per-service overrides of them.
  songId: Id<"songs"> | null;
  song: Song | null;
  assignments: ItemAssignment[];
};

type EventRole = {
  roleId: Id<"teamRoles">;
  roleName: string;
  roleColor?: string;
  assignments: Array<{ userId: Id<"users">; userName: string; status: string }>;
};

type EventDoc = {
  _id: Id<"eventPlans">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
  roles: EventRole[];
};

/**
 * The per-row "⋯" trigger. Measures its own window rect on press so the parent
 * can anchor the actions dropdown next to it (the table card clips overflow, so
 * the menu can't live inside the row). Mirrors `WhenPill`'s measure pattern.
 */
function RowActionsButton({
  colors,
  onOpen,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  onOpen: (anchor: AnchorRect) => void;
}) {
  const ref = React.useRef<View>(null);
  return (
    <Pressable
      ref={ref}
      onPress={() => measureAnchor(ref.current, onOpen)}
      hitSlop={8}
      style={styles.actionsTrigger}
      accessibilityRole="button"
      accessibilityLabel="Item actions"
    >
      <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

export function RunSheetScreen() {
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
  const communityId = community?.id ?? "";

  // Leader gate — same authoritative source EventTasksScreen uses. The run sheet
  // editor's cell edits are already reachable only from leader entry points, but
  // the template toolbar's controls are leader-only, so gate them explicitly:
  // a non-leader should never see the picker / save / revert affordances.
  const groupData = useAuthenticatedQuery(
    api.functions.groups.queries.getById,
    group_id ? { groupId: group_id as Id<"groups"> } : "skip",
  ) as { userRole?: string } | null | undefined;
  const isLeader =
    groupData?.userRole === "leader" ||
    groupData?.userRole === "admin" ||
    user?.is_admin === true;
  // Whether to surface the Event Tasks entry point in the header. Read
  // defensively — the mobile Community type only enumerates `prayerEnabled`.
  const eventTasksEnabled = Boolean(
    (community?.churchFeatures as { eventTasksEnabled?: boolean } | undefined)
      ?.eventTasksEnabled,
  );

  const event = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    planId ? { planId } : "skip",
  ) as EventDoc | null | undefined;

  const items = useAuthenticatedQuery(
    api.functions.scheduling.eventItems.listItems,
    planId ? { planId } : "skip",
  ) as RunSheetItem[] | null | undefined;

  const createItem = useAuthenticatedMutation(
    api.functions.scheduling.eventItems.createItem,
  );
  const updateItem = useAuthenticatedMutation(
    api.functions.scheduling.eventItems.updateItem,
  );
  const deleteItem = useAuthenticatedMutation(
    api.functions.scheduling.eventItems.deleteItem,
  );
  const duplicateItem = useAuthenticatedMutation(
    api.functions.scheduling.eventItems.duplicateItem,
  );
  const reorderItems = useAuthenticatedMutation(
    api.functions.scheduling.eventItems.reorderItems,
  );

  // Plan ↔ run-sheet-template linkage (Phase 3/4). `getPlanTemplateState`
  // carries both task and run-sheet slices; this screen reads the run-sheet one.
  const templateState = useAuthenticatedQuery(
    getPlanTemplateStateRef,
    isLeader && planId ? { planId } : "skip",
  ) as PlanTemplateState | undefined;
  const runSheetTemplates = useAuthenticatedQuery(
    listRunSheetTemplatesRef,
    isLeader && group_id ? { groupId: group_id as Id<"groups"> } : "skip",
  );
  const setPlanRunSheetTemplate = useAuthenticatedMutation(
    setPlanRunSheetTemplateRef,
  );
  const saveRunSheetTemplateFromPlan = useAuthenticatedMutation(
    saveRunSheetTemplateFromPlanRef,
  );
  const revertPlanRunSheetTemplateEdits = useAuthenticatedMutation(
    revertPlanRunSheetTemplateEditsRef,
  );

  const templateSlice = templateState
    ? {
        templateId: templateState.runSheetTemplateId,
        templateName: templateState.runSheetTemplateName,
        hasEdits: templateState.hasRunSheetTemplateEdits,
        isPast: templateState.isPast,
      }
    : undefined;
  const templateOptions = useMemo(
    () =>
      (runSheetTemplates ?? []).map((t) => ({
        _id: t._id as string,
        name: t.name,
        itemCount: t.itemCount,
      })),
    [runSheetTemplates],
  );

  const handleSetTemplate = useCallback(
    (templateId: string | null, carryover: TemplateCarryover) => {
      void setPlanRunSheetTemplate({
        planId,
        templateId: templateId as Id<"runSheetTemplates"> | null,
        carryover,
      }).catch((e: any) =>
        notifyError(
          "Couldn't switch template",
          e?.data?.message ?? e?.message ?? "Please try again.",
        ),
      );
    },
    [setPlanRunSheetTemplate, planId],
  );

  const handleSaveNewTemplate = useCallback(
    (name: string) => {
      void saveRunSheetTemplateFromPlan({
        planId,
        mode: { kind: "new", name },
      }).catch((e: any) =>
        notifyError(
          "Couldn't save template",
          e?.data?.message ?? e?.message ?? "Please try again.",
        ),
      );
    },
    [saveRunSheetTemplateFromPlan, planId],
  );

  const handleSaveExistingTemplate = useCallback(
    (templateId: string, strategy: SaveTemplateStrategy) => {
      void saveRunSheetTemplateFromPlan({
        planId,
        mode: {
          kind: "existing",
          templateId: templateId as Id<"runSheetTemplates">,
          strategy,
        },
      }).catch((e: any) =>
        notifyError(
          "Couldn't save template",
          e?.data?.message ?? e?.message ?? "Please try again.",
        ),
      );
    },
    [saveRunSheetTemplateFromPlan, planId],
  );

  const handleRevertTemplate = useCallback(() => {
    void revertPlanRunSheetTemplateEdits({ planId }).catch((e: any) =>
      notifyError(
        "Couldn't revert",
        e?.data?.message ?? e?.message ?? "Please try again.",
      ),
    );
  }, [revertPlanRunSheetTemplateEdits, planId]);

  // The just-created item to autofocus its title for immediate editing.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Per-segment collapse state (all expanded by default). Owned here; the
  // section header's onToggle flips the matching flag.
  const [collapsed, setCollapsed] = useState<Record<Segment, boolean>>({
    before: false,
    during: false,
    after: false,
  });

  // Cell-tap modals. Each holds the item whose Who / Notes / Song is being
  // edited; the live item is re-derived from `items` at render so a deleted or
  // moved row closes its modal instead of showing stale data.
  const [whoItem, setWhoItem] = useState<RunSheetItem | null>(null);
  const [notesItem, setNotesItem] = useState<RunSheetItem | null>(null);
  const [songItem, setSongItem] = useState<RunSheetItem | null>(null);
  // The per-row actions menu (move-between-segments / duplicate / delete) is an
  // anchored dropdown next to the row's "⋯" trigger, so it tracks both the item
  // and the trigger's measured window rect.
  const [actionsMenu, setActionsMenu] = useState<{
    item: RunSheetItem;
    anchor: AnchorRect;
  } | null>(null);

  // One continuous events-os-style table (after the auto drag-grip). Widths are
  // fixed pixels; the table scrolls horizontally when it overflows the card, and
  // the flex columns (Item / Notes) absorb any leftover slack when it fits.
  const columns: GridColumn[] = useMemo(
    () => [
      { key: "time", label: "Time", width: 84 },
      { key: "dur", label: "Dur", width: 64 },
      { key: "item", label: "Item", width: 200, flex: 3 },
      { key: "notes", label: "Notes", width: 240, flex: 3 },
      { key: "who", label: "Owner / Role", width: 132 },
      { key: "song", label: "Song", width: 96 },
      { key: "actions", label: "", width: 48, align: "center" },
    ],
    [],
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  // The shared run sheet is timed from the earliest service start.
  const times = event?.times ?? [];
  const earliestStart = useMemo(
    () =>
      times.length > 0
        ? Math.min(...times.map((t) => t.startsAt))
        : (event?.eventDate ?? Date.now()),
    [times, event?.eventDate],
  );

  // Group items into before / during / after phases. `listItems` already
  // returns them sorted by (segment, sequence), so each group stays ordered.
  const itemsBySegment = useMemo(() => {
    const groups: Record<Segment, RunSheetItem[]> = {
      before: [],
      during: [],
      after: [],
    };
    for (const it of items ?? []) {
      const seg = (it.segment as Segment) ?? "during";
      (groups[seg] ?? groups.during).push(it);
    }
    return groups;
  }, [items]);

  const clockTimes = useMemo(
    () =>
      computeSegmentedClockTimes(
        itemsBySegment.before,
        itemsBySegment.during,
        itemsBySegment.after,
        earliestStart,
      ),
    [itemsBySegment, earliestStart],
  );

  // The service window is the "during" phase — before/after bracket it.
  const duringTotalSec = useMemo(
    () => totalDurationSec(itemsBySegment.during),
    [itemsBySegment.during],
  );

  const roleOptions: RoleOption[] = useMemo(
    () =>
      (event?.roles ?? []).map((r) => ({
        roleId: r.roleId,
        roleName: r.roleName,
        roleColor: r.roleColor,
        people: r.assignments
          .filter((a) => a.status !== "declined")
          .map((a) => a.userName),
      })),
    [event?.roles],
  );

  const patchItem = useCallback(
    (itemId: Id<"eventItems">, patch: ItemPatch) =>
      updateItem({ itemId, ...patch }).catch((e: any) =>
        notifyError(
          "Couldn't save",
          e?.data?.message ?? e?.message ?? "Please try again.",
        ),
      ),
    [updateItem],
  );

  const handleAddTo = useCallback(
    async (type: string, segment: Segment) => {
      try {
        const { itemId } = await createItem({
          planId,
          type,
          title: type === "header" ? "New section" : "New item",
          segment,
        });
        setFocusId(itemId as string);
      } catch (e: any) {
        notifyError("Couldn't add item", e?.message ?? "Please try again.");
      }
    },
    [createItem, planId],
  );

  const handleDuplicate = useCallback(
    (itemId: Id<"eventItems">) =>
      duplicateItem({ itemId }).catch((e: any) =>
        notifyError("Couldn't duplicate", e?.message ?? "Please try again."),
      ),
    [duplicateItem],
  );

  const handleDelete = useCallback(
    (item: RunSheetItem) => {
      const doDelete = () =>
        deleteItem({ itemId: item._id }).catch((e: any) =>
          notifyError("Couldn't delete", e?.message ?? "Please try again."),
        );
      const prompt = `Remove "${item.title}" from the run sheet?`;
      // React Native's Alert.alert is a no-op on web in this codebase, so the
      // delete (X) confirm never resolved there — fall back to window.confirm
      // (same pattern as HostsPicker / EventPageClient).
      if (Platform.OS === "web") {
        if (typeof window !== "undefined" && window.confirm(prompt)) {
          void doDelete();
        }
        return;
      }
      Alert.alert("Delete item?", prompt, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void doDelete() },
      ]);
    },
    [deleteItem],
  );

  // Flat rows for the single table, ordered by phase (before → during → after)
  // then existing sequence. Kept for `data`/reorder; the visual grouping is now
  // driven by the `sections` prop below, so a row's phase is its section.
  const rows = useMemo(
    () =>
      itemsBySegment.before.concat(itemsBySegment.during, itemsBySegment.after),
    [itemsBySegment],
  );

  // A compact per-segment summary for the section header, e.g. "6 items ·
  // 7:30–9:59 AM". The span is the earliest–latest clock time of the segment's
  // items (headers have no clock time and are skipped); when it can't be
  // computed we fall back to just the item count.
  const segmentMeta = useCallback(
    (seg: Segment): string => {
      const segItems = itemsBySegment[seg];
      const n = segItems.length;
      const countLabel = `${n} item${n === 1 ? "" : "s"}`;
      const stamps = segItems
        .map((it) => clockTimes[it._id])
        .filter((ms): ms is number => ms != null);
      if (stamps.length === 0) return countLabel;
      const start = formatClockTime(Math.min(...stamps));
      const end = formatClockTime(Math.max(...stamps));
      const span = start === end ? start : `${start}–${end}`;
      return `${countLabel} · ${span}`;
    },
    [itemsBySegment, clockTimes],
  );

  // Drag only reorders within the existing phases — each row keeps its current
  // segment (phase is changed via the When column instead).
  const handleReorder = useCallback(
    (orderedKeys: string[]) => {
      const byId = new Map(rows.map((it) => [it._id as string, it]));
      const orderedItems = orderedKeys
        .map((id) => byId.get(id))
        .filter((it): it is RunSheetItem => it != null)
        .map((it) => ({
          id: it._id,
          segment: (it.segment as Segment) ?? "during",
        }));
      return reorderItems({ planId, orderedItems }).catch((e: any) =>
        notifyError("Couldn't reorder", e?.message ?? "Please try again."),
      );
    },
    [reorderItems, planId, rows],
  );

  const loading = event === undefined || items === undefined;

  // Re-derive each modal's live item from the current `items` so a row that was
  // deleted or reordered elsewhere closes its modal instead of editing a stale
  // snapshot. `null` when the item is gone → the modal hides.
  const whoLive = whoItem
    ? (items?.find((i) => i._id === whoItem._id) ?? null)
    : null;
  const notesLive = notesItem
    ? (items?.find((i) => i._id === notesItem._id) ?? null)
    : null;
  const songLive = songItem
    ? (items?.find((i) => i._id === songItem._id) ?? null)
    : null;
  const actionsLive = actionsMenu
    ? (items?.find((i) => i._id === actionsMenu.item._id) ?? null)
    : null;

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: colors.surface },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBackBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleBlock}>
          <Text
            style={[styles.headerEventTitle, { color: colors.text }]}
            numberOfLines={1}
          >
            {event?.title ?? "Run sheet"}
          </Text>
          {event ? (
            <Text
              style={[styles.headerEventMeta, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {formatEventDateLong(event.eventDate)}
              {times.length > 0
                ? ` · ${formatServiceRanges(times, duringTotalSec)}`
                : ""}
            </Text>
          ) : null}
        </View>
        {/* Run sheet ⇄ Tasks switcher — the entry point to the leader Event Tasks
            "database view" for this plan. Shown only when the community has opted
            into Event Tasks; the Tasks screen itself re-checks the flag + leader role. */}
        {eventTasksEnabled ? (
          <SegmentedTabs
            options={[
              { key: "run", label: "Run sheet" },
              { key: "tasks", label: "Tasks" },
            ]}
            value="run"
            onChange={(key) => {
              if (key === "tasks")
                router.push(`/rostering/${group_id}/tasks/${planId}` as never);
            }}
            accessibilityLabel="View"
          />
        ) : null}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      ) : !event || !items ? (
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This run sheet is no longer available.
          </Text>
        </View>
      ) : (
        (() => {
          const listHeader = (
            <View>
              {isLeader ? (
                <PlanTemplateToolbar
                  label="Run-sheet template"
                  itemNoun="run-sheet items"
                  state={templateSlice}
                  templates={templateOptions}
                  onSetTemplate={handleSetTemplate}
                  onSaveNew={handleSaveNewTemplate}
                  onSaveExisting={handleSaveExistingTemplate}
                  onRevert={handleRevertTemplate}
                />
              ) : null}
            </View>
          );

          // Per-section add controls. Every segment gets "Add item"; the
          // "during" segment also carries Song / Header so those types stay
          // reachable now that the flat bottom add-bar is gone. A newly-added
          // item takes the section's segment.
          const footerFor = (seg: Segment): React.ReactNode => (
            <View style={styles.addBar}>
              <AddButton
                label="Add item"
                icon="add"
                onPress={() => handleAddTo("item", seg)}
                primaryColor={primaryColor}
                colors={colors}
              />
              {seg === "during" ? (
                <>
                  <AddButton
                    label="Song"
                    icon="musical-notes"
                    onPress={() => handleAddTo("song", seg)}
                    primaryColor={primaryColor}
                    colors={colors}
                  />
                  <AddButton
                    label="Header"
                    icon="bookmark"
                    onPress={() => handleAddTo("header", seg)}
                    primaryColor={primaryColor}
                    colors={colors}
                  />
                </>
              ) : null}
            </View>
          );

          const sections: GridSection<RunSheetItem>[] = SEGMENT_OPTIONS.map(
            (seg) => ({
              key: seg.key,
              title: seg.label.toUpperCase(),
              meta: segmentMeta(seg.key),
              collapsed: collapsed[seg.key],
              onToggle: () =>
                setCollapsed((prev) => ({
                  ...prev,
                  [seg.key]: !prev[seg.key],
                })),
              rows: itemsBySegment[seg.key],
              footer: footerFor(seg.key),
            }),
          );

          // One continuous events-os-style table, grouped into before / during /
          // after sections. A row's phase is its section; renderCell returns cell
          // CONTENT only — the primitive draws the sized, padded cell frame.
          const renderCell = (
            item: RunSheetItem,
            key: string,
          ): React.ReactNode => {
            const isHeader = item.type === "header";
            const isSong = item.type === "song";
            switch (key) {
              case "item":
                return (
                  <InlineText
                    value={item.title}
                    onSave={(t) => {
                      patchItem(item._id, { title: t });
                    }}
                    placeholder={isHeader ? "Section name" : "Item title"}
                    autoFocus={focusId === (item._id as string)}
                    maxLength={120}
                    required
                    accessibilityLabel="Item title"
                    style={[
                      styles.titleInput,
                      isHeader && styles.headerTitleInput,
                      { color: colors.text },
                    ]}
                  />
                );
              case "time": {
                if (isHeader) return null;
                const ms = clockTimes[item._id];
                // A single, quiet read-only clock value ("9:00 AM") — no boxed
                // pill, so it stays contained and doesn't compete with the
                // editable Dur input beside it.
                return (
                  <Text
                    style={[styles.timeText, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {ms != null ? formatClockTime(ms) : "—"}
                  </Text>
                );
              }
              case "dur":
                if (isHeader) return null;
                return (
                  <DurationCell
                    durationSec={item.durationSec}
                    onSave={(sec) => patchItem(item._id, { durationSec: sec })}
                    colors={colors}
                  />
                );
              case "who":
                return (
                  <Pressable
                    onPress={() => setWhoItem(item)}
                    style={styles.cellPressable}
                    accessibilityLabel="Edit owner / role"
                  >
                    {item.assignments.length > 0 ? (
                      <View style={styles.whoChips}>
                        {item.assignments.slice(0, 2).map((a) => (
                          <OptionTag
                            key={a.roleId}
                            label={a.roleName}
                            colors={colors}
                            primaryColor={primaryColor}
                            color={a.roleColor ?? DEFAULT_ROLE_COLOR}
                          />
                        ))}
                        {item.assignments.length > 2 ? (
                          <Text style={[styles.muted, { color: colors.textTertiary }]}>
                            +{item.assignments.length - 2}
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <OptionTag
                        label="＋"
                        colors={colors}
                        primaryColor={primaryColor}
                        placeholder
                      />
                    )}
                  </Pressable>
                );
              case "notes":
                return (
                  <Pressable
                    onPress={() => setNotesItem(item)}
                    style={styles.cellPressable}
                    accessibilityLabel="Edit notes"
                  >
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.cellText,
                        {
                          color: item.description
                            ? colors.text
                            : colors.textTertiary,
                        },
                      ]}
                    >
                      {item.description && item.description.length > 0
                        ? item.description
                        : "Add notes"}
                      {item.notes.length > 0 ? ` · ${item.notes.length} cues` : ""}
                    </Text>
                  </Pressable>
                );
              case "song": {
                if (!isSong) {
                  return (
                    <Text style={[styles.muted, { color: colors.textTertiary }]}>—</Text>
                  );
                }
                const resolvedKey = item.songDetails?.key ?? item.song?.defaultKey;
                return (
                  <Pressable
                    onPress={() => setSongItem(item)}
                    style={styles.cellPressable}
                    accessibilityLabel="Edit song"
                  >
                    {item.song ? (
                      <Text
                        numberOfLines={1}
                        style={[styles.cellText, { color: colors.text }]}
                      >
                        {item.song.title}
                        {resolvedKey ? ` · ${resolvedKey}` : ""}
                      </Text>
                    ) : (
                      <Text style={[styles.muted, { color: colors.textTertiary }]}>
                        ＋ Song
                      </Text>
                    )}
                  </Pressable>
                );
              }
              case "actions":
                // A single "⋯" that opens an anchored menu: move-between-segments
                // (the When column is gone), Duplicate, Delete. Keeps the row
                // compact while preserving every action.
                return (
                  <RowActionsButton
                    colors={colors}
                    onOpen={(anchor) => setActionsMenu({ item, anchor })}
                  />
                );
              default:
                return null;
            }
          };

          return (
            <GridScrollList<RunSheetItem>
              data={rows}
              keyExtractor={(it) => it._id as string}
              onReorder={handleReorder}
              columns={columns}
              renderCell={renderCell}
              sections={sections}
              dense
              ListHeaderComponent={listHeader}
              // Add controls now live in each section's footer, so the list footer
              // only carries the bottom safe-area inset.
              ListFooterComponent={
                <View style={{ paddingBottom: insets.bottom + 8 }} />
              }
              // Vertical padding only — horizontal padding would shift the rows
              // out of alignment with the pinned header.
              contentContainerStyle={styles.gridContent}
            />
          );
        })()
      )}

      {/* Who's-involved (roles) editor — multi-select, opened from the Who cell.
          The live item is re-derived so a deleted/moved row closes the modal. */}
      <CustomModal
        visible={whoLive !== null}
        onClose={() => setWhoItem(null)}
        title="Who's involved"
      >
        {whoLive ? (
          <WhoModalBody
            key={whoLive._id}
            item={whoLive}
            roleOptions={roleOptions}
            onPatch={(patch) => patchItem(whoLive._id, patch)}
            emptyStateText="No roles are defined for this event yet."
          />
        ) : null}
      </CustomModal>

      {/* Notes editor — timing phase, description, and role-categorized cues. */}
      <CustomModal
        visible={notesLive !== null}
        onClose={() => setNotesItem(null)}
        title="Notes"
      >
        {notesLive ? (
          <NotesModalBody
            key={notesLive._id}
            item={notesLive}
            onPatch={(patch) => patchItem(notesLive._id, patch)}
          />
        ) : null}
      </CustomModal>

      {/* Song editor — library link plus per-service key / BPM overrides. */}
      <CustomModal
        visible={songLive !== null}
        onClose={() => setSongItem(null)}
        title="Song"
      >
        {songLive ? (
          <SongModalBody
            key={songLive._id}
            item={songLive}
            communityId={communityId}
            groupId={group_id ?? ""}
            onPatch={(patch) => patchItem(songLive._id, patch)}
          />
        ) : null}
      </CustomModal>

      {/* Row actions — an anchored dropdown next to the "⋯" trigger: move the row
          to another segment (the When column is gone), duplicate, or delete. */}
      {actionsMenu && actionsLive ? (
        <AnchoredMenu
          anchor={actionsMenu.anchor}
          options={[
            ...SEGMENT_OPTIONS.filter((s) => s.key !== actionsLive.segment).map(
              (s) => ({
                id: `move:${s.key}`,
                name: `Move to ${s.label}`,
                icon: "swap-horizontal" as const,
              }),
            ),
            { id: "duplicate", name: "Duplicate", icon: "copy-outline" as const },
            { id: "delete", name: "Delete", icon: "trash-outline" as const },
          ]}
          onSelect={(id) => {
            if (id?.startsWith("move:")) {
              patchItem(actionsLive._id, {
                segment: id.slice("move:".length) as Segment,
              });
            } else if (id === "duplicate") {
              void handleDuplicate(actionsLive._id);
            } else if (id === "delete") {
              handleDelete(actionsLive);
            }
            setActionsMenu(null);
          }}
          onClose={() => setActionsMenu(null)}
        />
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
  headerBtn: { width: 36, padding: 4, alignItems: "center" },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  headerBackBtn: { padding: 4 },
  headerTitleBlock: { flex: 1, minWidth: 0, marginLeft: 4, marginRight: 8 },
  headerEventTitle: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  headerEventMeta: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontVariant: ["tabular-nums"],
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14 },
  gridContent: { paddingBottom: 8 },
  planTitle: { fontSize: 22, fontWeight: "700" },
  planDate: { fontSize: 13, marginTop: 4 },
  ranges: { fontSize: 14, fontWeight: "600", marginTop: 8 },
  titleInput: { fontSize: 15, fontWeight: "600", width: "100%" },
  headerTitleInput: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  // Section footer add controls — a compact row of dashed AddButtons.
  addBar: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  // Grid cell content. The primitive draws the padded cell frame; these only
  // style the content that sits inside it.
  cellPressable: { flex: 1, justifyContent: "center" },
  cellText: { fontSize: 13 },
  muted: { fontSize: 13, fontWeight: "500" },
  whoChips: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  // "Time" — a quiet, contained read-only clock value ("9:00 AM"). Monospace +
  // tabular figures give it the aligned "broadcast rundown" feel.
  timeText: {
    fontSize: 13,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontVariant: ["tabular-nums"],
  },
  // The per-row "⋯" actions trigger — centered in its compact cell.
  actionsTrigger: { flex: 1, alignItems: "center", justifyContent: "center" },
});
