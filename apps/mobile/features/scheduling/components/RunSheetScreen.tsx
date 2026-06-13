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
 * Editing is spreadsheet-style and inline: title, duration, description, and
 * song key are edited in place (debounced autosave via `updateItem`); rows
 * expand for role links and notes. Reordering is drag-and-drop from a grip
 * handle (web + native, see `RunSheetDragList`). Each row can be duplicated or
 * deleted. There is no modal sub-page.
 *
 * Route: /rostering/[group_id]/run-sheet/[plan_id]
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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
  formatDuration,
  formatServiceRanges,
  totalDurationSec,
} from "../utils/runSheetTiming";
import { useAuth } from "@providers/AuthProvider";
import { InlineText } from "./InlineText";
import { RunSheetDragList } from "./RunSheetDragList";
import { SongPicker } from "./SongPicker";
import type { Song } from "@features/songs/types";

/** When an item happens relative to the event's service times. */
type Segment = "before" | "during" | "after";
const SEGMENT_OPTIONS: Array<{ key: Segment; label: string }> = [
  { key: "before", label: "Before event" },
  { key: "during", label: "During event" },
  { key: "after", label: "After event" },
];

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

type ItemAssignment = {
  roleId: Id<"teamRoles">;
  roleName: string;
  roleColor: string | null;
};

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

type RoleOption = {
  roleId: Id<"teamRoles">;
  roleName: string;
  roleColor?: string;
  people: string[];
};

/** Item field patch shape sent to updateItem. */
type ItemPatch = {
  type?: string;
  title?: string;
  segment?: Segment;
  durationSec?: number;
  description?: string;
  notes?: Array<{ category: string; content: string }>;
  assignments?: Array<{ roleId: Id<"teamRoles"> }>;
  songDetails?: { key?: string; bpm?: number };
  // Link / unlink a library song. `null` clears the link (ADR-027).
  songId?: Id<"songs"> | null;
};

export function RunSheetScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { community } = useAuth();
  const { plan_id, group_id } = useLocalSearchParams<{
    plan_id: string;
    group_id: string;
  }>();
  const planId = plan_id as Id<"eventPlans">;
  const communityId = community?.id ?? "";

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

  // The just-created item to autofocus its title for immediate editing.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Which phase the "Add" buttons create into.
  const [addSegment, setAddSegment] = useState<Segment>("during");

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
  const peopleByRole = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of roleOptions) map[r.roleId as string] = r.people;
    return map;
  }, [roleOptions]);

  const patchItem = useCallback(
    (itemId: Id<"eventItems">, patch: ItemPatch) =>
      updateItem({ itemId, ...patch }).catch((e: any) =>
        notifyError("Couldn't save", e?.data?.message ?? e?.message ?? "Please try again."),
      ),
    [updateItem],
  );

  const handleAdd = useCallback(
    async (type: string) => {
      try {
        const { itemId } = await createItem({
          planId,
          type,
          title: type === "header" ? "New section" : "New item",
          segment: addSegment,
        });
        setFocusId(itemId as string);
      } catch (e: any) {
        notifyError("Couldn't add item", e?.message ?? "Please try again.");
      }
    },
    [createItem, planId, addSegment],
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

  // The unified list interleaves phase-header rows (keyed `seg:<phase>`) with
  // item rows. After a drag, walk the new key order: each header switches the
  // running phase, and every item that follows takes it — so dragging an item
  // past a header moves it into that phase.
  const handleReorder = useCallback(
    (orderedKeys: string[]) => {
      const orderedItems: Array<{ id: Id<"eventItems">; segment: Segment }> = [];
      let current: Segment = "before";
      for (const key of orderedKeys) {
        if (key.startsWith("seg:")) {
          current = key.slice(4) as Segment;
        } else {
          orderedItems.push({ id: key as Id<"eventItems">, segment: current });
        }
      }
      return reorderItems({ planId, orderedItems }).catch((e: any) =>
        notifyError("Couldn't reorder", e?.message ?? "Please try again."),
      );
    },
    [reorderItems, planId],
  );

  // Flat rows for the single drag list: each phase's header followed by its
  // items. Phase headers are always present so an empty phase is still a drop
  // target — you can drag the first item into it.
  const rows = useMemo(() => {
    type Row =
      | { kind: "header"; segment: Segment; key: string }
      | { kind: "item"; item: RunSheetItem; key: string };
    const out: Row[] = [];
    for (const seg of SEGMENT_OPTIONS) {
      out.push({ kind: "header", segment: seg.key, key: `seg:${seg.key}` });
      for (const it of itemsBySegment[seg.key]) {
        out.push({ kind: "item", item: it, key: it._id as string });
      }
    }
    return out;
  }, [itemsBySegment]);

  const loading = event === undefined || items === undefined;

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
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Run sheet</Text>
        <View style={styles.headerBtn} />
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
              <Text style={[styles.planTitle, { color: colors.text }]}>
                {event.title}
              </Text>
              <Text style={[styles.planDate, { color: colors.textSecondary }]}>
                {formatEventDateLong(event.eventDate)}
              </Text>
              {/* The "during" phase is the event window; before/after bracket it. */}
              {times.length > 0 ? (
                <Text style={[styles.ranges, { color: colors.text }]}>
                  {formatServiceRanges(times, duringTotalSec)}
                </Text>
              ) : null}
            </View>
          );

          const listFooter = (
            <View>
              {/* Add controls — choose the phase, then add. */}
              <View style={styles.addToRow}>
                <Text style={[styles.addToLabel, { color: colors.textSecondary }]}>
                  Add to:
                </Text>
                {SEGMENT_OPTIONS.map((seg) => {
                  const active = addSegment === seg.key;
                  return (
                    <Pressable
                      key={seg.key}
                      onPress={() => setAddSegment(seg.key)}
                      style={styles.addToChipPressable}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <View
                        style={[
                          styles.addToChip,
                          {
                            borderColor: active ? primaryColor : colors.border,
                            backgroundColor: active
                              ? primaryColor + "18"
                              : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.addToChipText,
                            { color: active ? primaryColor : colors.textSecondary },
                          ]}
                        >
                          {seg.label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.addBar}>
                <AddButton label="Add item" icon="add" onPress={() => handleAdd("item")} primaryColor={primaryColor} colors={colors} />
                <AddButton label="Song" icon="musical-notes" onPress={() => handleAdd("song")} primaryColor={primaryColor} colors={colors} />
                <AddButton label="Header" icon="bookmark" onPress={() => handleAdd("header")} primaryColor={primaryColor} colors={colors} />
              </View>
            </View>
          );

          const contentStyle = [
            styles.scrollContent,
            { paddingBottom: insets.bottom + 96 },
          ];

          if (items.length === 0) {
            return (
              <ScrollView
                contentContainerStyle={contentStyle}
                keyboardShouldPersistTaps="handled"
              >
                {listHeader}
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No items yet. Pick a phase under "Add to" below, then add songs,
                  headers, and other moments. Drag the grip to reorder — drag
                  across a phase heading to move an item before, during, or after
                  the event.
                </Text>
                {listFooter}
              </ScrollView>
            );
          }

          // One drag list over all phases. Phase headings are drop zones: drag
          // an item past one to change its phase.
          return (
            <RunSheetDragList
              data={rows}
              keyExtractor={(r) => r.key}
              onReorder={handleReorder}
              ListHeaderComponent={listHeader}
              ListFooterComponent={listFooter}
              contentContainerStyle={contentStyle}
              renderRow={({ item: row, Handle, isActive }) =>
                row.kind === "header" ? (
                  <Text
                    style={[styles.segmentLabel, { color: colors.textSecondary }]}
                  >
                    {SEGMENT_OPTIONS.find((s) => s.key === row.segment)?.label.toUpperCase()}
                  </Text>
                ) : (
                  <EditableRow
                    item={row.item}
                    clockMs={clockTimes[row.item._id]}
                    communityId={communityId}
                    groupId={group_id ?? ""}
                    roleOptions={roleOptions}
                    peopleByRole={peopleByRole}
                    autoFocus={focusId === (row.item._id as string)}
                    isActive={isActive}
                    Handle={Handle}
                    onPatch={(patch) => patchItem(row.item._id, patch)}
                    onDuplicate={() => handleDuplicate(row.item._id)}
                    onDelete={() => handleDelete(row.item)}
                  />
                )
              }
            />
          );
        })()
      )}
    </View>
  );
}

function AddButton({
  label,
  icon,
  onPress,
  primaryColor,
  colors,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  primaryColor: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <Pressable onPress={onPress} style={styles.addPressable}>
      <View style={[styles.addRow, { borderColor: colors.border }]}>
        <Ionicons name={icon} size={18} color={primaryColor} />
        <Text style={[styles.addText, { color: primaryColor }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** One inline-editable run sheet row. */
function EditableRow({
  item,
  clockMs,
  communityId,
  groupId,
  roleOptions,
  peopleByRole,
  autoFocus,
  isActive,
  Handle,
  onPatch,
  onDuplicate,
  onDelete,
}: {
  item: RunSheetItem;
  clockMs: number | null;
  communityId: string;
  groupId: string;
  roleOptions: RoleOption[];
  peopleByRole: Record<string, string[]>;
  autoFocus: boolean;
  isActive: boolean;
  Handle: React.ComponentType<{ children: React.ReactNode }>;
  onPatch: (patch: ItemPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const isHeader = item.type === "header";
  const isSong = item.type === "song";

  // Local selection state so rapid toggles compound instead of each starting
  // from the last server-synced `item.assignments` (which lags a mutation
  // round-trip and would drop quick successive taps). Re-syncs only when the
  // server's set genuinely changes (e.g. another device edited it).
  const serverRoleKey = item.assignments.map((a) => a.roleId).join(",");
  const [linkedRoleIds, setLinkedRoleIds] = useState<Set<string>>(
    () => new Set(item.assignments.map((a) => a.roleId as string)),
  );
  useEffect(() => {
    setLinkedRoleIds(new Set(serverRoleKey ? serverRoleKey.split(",") : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRoleKey]);

  const toggleRole = (roleId: string) => {
    const next = new Set(linkedRoleIds);
    if (next.has(roleId)) next.delete(roleId);
    else next.add(roleId);
    setLinkedRoleIds(next);
    onPatch({
      assignments: [...next].map((id) => ({ roleId: id as Id<"teamRoles"> })),
    });
  };

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: isHeader ? "transparent" : colors.surfaceSecondary,
          opacity: isActive ? 0.6 : 1,
          borderColor: colors.border,
        },
        isHeader && styles.headerRow,
      ]}
    >
      <View style={styles.rowTop}>
        {/* Drag grip */}
        <Handle>
          <View
            style={styles.grip}
            accessibilityLabel="Drag to reorder"
            hitSlop={10}
          >
            <Ionicons name="reorder-three" size={20} color={colors.textTertiary} />
          </View>
        </Handle>

        {/* Time */}
        <View style={styles.timeCol}>
          <Text style={[styles.timeText, { color: isHeader ? colors.textTertiary : colors.text }]}>
            {clockMs != null ? formatClockTime(clockMs) : "—"}
          </Text>
        </View>

        {/* Title (inline) */}
        <View style={styles.titleCol}>
          <InlineText
            value={item.title}
            onSave={(t) => onPatch({ title: t })}
            placeholder={isHeader ? "Section name" : "Item title"}
            autoFocus={autoFocus}
            maxLength={120}
            required
            accessibilityLabel="Item title"
            style={[
              styles.titleInput,
              isHeader && styles.headerTitleInput,
              { color: colors.text },
            ]}
          />
        </View>

        {/* Duration (inline m:ss) — hidden for headers */}
        {!isHeader ? (
          <View style={styles.durationCol}>
            <DurationCell
              durationSec={item.durationSec}
              onSave={(sec) => onPatch({ durationSec: sec })}
              colors={colors}
            />
          </View>
        ) : null}

        {/* Row actions */}
        <View style={styles.actions}>
          {!isHeader ? (
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              hitSlop={6}
              style={styles.actionBtn}
              accessibilityLabel={expanded ? "Collapse" : "Expand details"}
            >
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={colors.textTertiary}
              />
            </Pressable>
          ) : null}
          <Pressable onPress={onDuplicate} hitSlop={6} style={styles.actionBtn} accessibilityLabel="Duplicate">
            <Ionicons name="copy-outline" size={17} color={colors.textTertiary} />
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={6} style={styles.actionBtn} accessibilityLabel="Delete">
            <Ionicons name="close" size={18} color={colors.textTertiary} />
          </Pressable>
        </View>
      </View>

      {/* Linked people (always visible when present) */}
      {!isHeader && item.assignments.length > 0 ? (
        <View style={styles.assignWrap}>
          {item.assignments.map((a) => {
            const names = peopleByRole[a.roleId as string] ?? [];
            return (
              <View
                key={a.roleId}
                style={[
                  styles.assignChip,
                  { backgroundColor: (a.roleColor ?? DEFAULT_ROLE_COLOR) + "22" },
                ]}
              >
                <View style={[styles.assignSwatch, { backgroundColor: a.roleColor ?? DEFAULT_ROLE_COLOR }]} />
                <Text style={[styles.assignText, { color: colors.text }]} numberOfLines={1}>
                  {a.roleName}
                  {names.length > 0 ? `: ${names.join(", ")}` : ""}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Expanded inline editors */}
      {expanded && !isHeader ? (
        <View style={styles.expanded}>
          {/* Timing phase — before / during / after the event (PCO's position). */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Timing
          </Text>
          <View style={styles.timingToggle}>
            {SEGMENT_OPTIONS.map((seg) => {
              const active = (item.segment as Segment) === seg.key;
              return (
                <Pressable
                  key={seg.key}
                  onPress={() => onPatch({ segment: seg.key })}
                  style={styles.timingPressable}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <View
                    style={[
                      styles.timingChip,
                      {
                        borderColor: active ? colors.buttonPrimary : colors.border,
                        backgroundColor: active
                          ? colors.buttonPrimary + "1F"
                          : "transparent",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.timingChipText,
                        { color: active ? colors.buttonPrimary : colors.textSecondary },
                      ]}
                    >
                      {seg.label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {isSong ? (
            <>
              {/* Link this row to a library song (ADR-027). Free-typed rows
                  (no songId) keep working — the picker just stays unlinked. */}
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Song</Text>
              <SongPicker
                communityId={communityId}
                groupId={groupId}
                songId={item.songId}
                song={item.song}
                onSelect={(songId) =>
                  onPatch({ songId: songId as Id<"songs"> | null })
                }
              />

              {/* Key / BPM. When a song is linked these are PER-SERVICE
                  OVERRIDES: the value is only the override (blank if none),
                  the placeholder is the song's default, and saving writes
                  songDetails. Display elsewhere resolves override ?? default. */}
              <View style={styles.songRow}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Key</Text>
                <InlineText
                  value={item.songDetails?.key ?? ""}
                  onSave={(key) =>
                    onPatch({
                      songDetails: { key: key.trim() || undefined, bpm: item.songDetails?.bpm },
                    })
                  }
                  placeholder={item.song?.defaultKey ?? "—"}
                  maxLength={8}
                  accessibilityLabel="Song key"
                  style={[styles.songInput, { color: colors.text, borderColor: colors.border }]}
                />
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>BPM</Text>
                <InlineText
                  value={item.songDetails?.bpm ? String(item.songDetails.bpm) : ""}
                  onSave={(bpm) =>
                    onPatch({
                      songDetails: {
                        key: item.songDetails?.key,
                        bpm: parseInt(bpm, 10) || undefined,
                      },
                    })
                  }
                  placeholder={item.song?.bpm ? String(item.song.bpm) : "—"}
                  keyboardType="number-pad"
                  maxLength={3}
                  accessibilityLabel="Song BPM"
                  style={[styles.songInput, { color: colors.text, borderColor: colors.border }]}
                />
              </View>
            </>
          ) : null}

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description</Text>
          <InlineText
            value={item.description ?? ""}
            onSave={(d) => onPatch({ description: d })}
            placeholder="Optional details for this moment"
            multiline
            accessibilityLabel="Item description"
            style={[styles.descInput, { color: colors.text, borderColor: colors.border }]}
          />

          {roleOptions.length > 0 ? (
            <>
              <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Who's involved</Text>
              <View style={styles.roleWrap}>
                {roleOptions.map((r) => {
                  const selected = linkedRoleIds.has(r.roleId as string);
                  const swatch = r.roleColor ?? DEFAULT_ROLE_COLOR;
                  return (
                    <Pressable
                      key={r.roleId}
                      onPress={() => toggleRole(r.roleId as string)}
                      style={styles.rolePressable}
                    >
                      <View
                        style={[
                          styles.roleChip,
                          {
                            backgroundColor: selected ? swatch + "22" : colors.surface,
                            borderColor: selected ? swatch : colors.border,
                          },
                        ]}
                      >
                        <View style={[styles.roleSwatch, { backgroundColor: swatch }]} />
                        <Text style={[styles.roleChipText, { color: colors.text }]} numberOfLines={1}>
                          {r.roleName}
                          {r.people.length > 0 ? `: ${r.people.join(", ")}` : ""}
                        </Text>
                        {selected ? (
                          <Ionicons name="checkmark-circle" size={15} color={swatch} />
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <NotesEditor
            notes={item.notes}
            onChange={(notes) => onPatch({ notes })}
            colors={colors}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Inline m:ss duration cell. Parses "5", "5:30", or "330s"-style minute input. */
function DurationCell({
  durationSec,
  onSave,
  colors,
}: {
  durationSec: number;
  onSave: (sec: number) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const mm = Math.floor(durationSec / 60);
  const ss = durationSec % 60;
  const display = `${mm}:${String(ss).padStart(2, "0")}`;
  return (
    <InlineText
      value={display}
      onSave={(text) => onSave(parseDuration(text))}
      placeholder="0:00"
      keyboardType="numbers-and-punctuation"
      maxLength={6}
      accessibilityLabel="Duration (minutes:seconds)"
      style={[styles.durationInput, { color: colors.text, borderColor: colors.border }]}
    />
  );
}

/** Parse "m:ss" or plain minutes into seconds. */
function parseDuration(text: string): number {
  const trimmed = text.trim();
  if (trimmed.includes(":")) {
    const [m, s] = trimmed.split(":");
    return Math.max(0, (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0));
  }
  return Math.max(0, Math.round((parseFloat(trimmed) || 0) * 60));
}

/** Inline role-categorized notes editor. */
function NotesEditor({
  notes,
  onChange,
  colors,
}: {
  notes: Array<{ category: string; content: string }>;
  onChange: (notes: Array<{ category: string; content: string }>) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const setNote = (idx: number, patch: Partial<{ category: string; content: string }>) =>
    onChange(notes.map((n, i) => (i === idx ? { ...n, ...patch } : n)));
  const removeNote = (idx: number) => onChange(notes.filter((_, i) => i !== idx));

  return (
    <>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Notes</Text>
      {notes.map((note, idx) => (
        <View key={idx} style={styles.noteRow}>
          <InlineText
            value={note.category}
            onSave={(v) => setNote(idx, { category: v })}
            placeholder="Role"
            maxLength={30}
            accessibilityLabel="Note role"
            style={[styles.noteCategory, { color: colors.text, borderColor: colors.border }]}
          />
          <InlineText
            value={note.content}
            onSave={(v) => setNote(idx, { content: v })}
            placeholder="Cue or instruction"
            accessibilityLabel="Note content"
            style={[styles.noteContent, { color: colors.text, borderColor: colors.border }]}
          />
          <Pressable onPress={() => removeNote(idx)} hitSlop={8} style={styles.actionBtn} accessibilityLabel="Remove note">
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={() => onChange([...notes, { category: "", content: "" }])}
        style={styles.addNotePressable}
      >
        <View style={styles.addNoteRow}>
          <Ionicons name="add" size={16} color={colors.buttonPrimary} />
          <Text style={[styles.addNoteText, { color: colors.buttonPrimary }]}>Add a note</Text>
        </View>
      </Pressable>
    </>
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14 },
  scrollContent: { padding: 16 },
  planTitle: { fontSize: 22, fontWeight: "700" },
  planDate: { fontSize: 13, marginTop: 4 },
  ranges: { fontSize: 14, fontWeight: "600", marginTop: 8 },
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 24 },
  segmentLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 8,
  },
  list: { marginTop: 10 },
  addToRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 24,
  },
  addToLabel: { fontSize: 13, fontWeight: "600" },
  addToChipPressable: { borderRadius: 999 },
  addToChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  addToChipText: { fontSize: 13, fontWeight: "600" },
  timingToggle: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  timingPressable: { borderRadius: 999 },
  timingChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  timingChipText: { fontSize: 12, fontWeight: "600" },
  row: {
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    borderWidth: 0,
    paddingVertical: 4,
    marginBottom: 4,
    marginTop: 4,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 6 },
  grip: { paddingHorizontal: 2, paddingVertical: 6, justifyContent: "center" },
  timeCol: { width: 62 },
  timeText: { fontSize: 13, fontWeight: "700" },
  titleCol: { flex: 1 },
  titleInput: { fontSize: 15, fontWeight: "600" },
  headerTitleInput: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  durationCol: { width: 56 },
  durationInput: {
    fontSize: 13,
    textAlign: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  actions: { flexDirection: "row", alignItems: "center" },
  actionBtn: { padding: 4 },
  assignWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8, paddingLeft: 30 },
  assignChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    maxWidth: "100%",
  },
  assignSwatch: { width: 8, height: 8, borderRadius: 4 },
  assignText: { fontSize: 12, fontWeight: "500", flexShrink: 1 },
  expanded: { marginTop: 10, paddingLeft: 30, gap: 4 },
  fieldLabel: { fontSize: 11, fontWeight: "700", marginTop: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  songRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  songInput: {
    minWidth: 52,
    fontSize: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  descInput: {
    fontSize: 14,
    minHeight: 40,
    textAlignVertical: "top",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  roleWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rolePressable: { borderRadius: 999, maxWidth: "100%" },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  roleSwatch: { width: 9, height: 9, borderRadius: 5 },
  roleChipText: { fontSize: 12, fontWeight: "500", flexShrink: 1 },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  noteCategory: {
    width: 88,
    fontSize: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  noteContent: {
    flex: 1,
    fontSize: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  addNotePressable: { marginTop: 6 },
  addNoteRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  addNoteText: { fontSize: 13, fontWeight: "600" },
  addBar: { flexDirection: "row", gap: 8, marginTop: 16, flexWrap: "wrap" },
  addPressable: { flexGrow: 1, borderRadius: 12 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  addText: { fontSize: 14, fontWeight: "600" },
});
