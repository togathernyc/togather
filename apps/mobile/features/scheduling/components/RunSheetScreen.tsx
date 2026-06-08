/**
 * RunSheetScreen
 *
 * The native, editable run sheet (order-of-items) for an event plan (ADR-026).
 * One run sheet is shared across all of the plan's times; clock times cascade
 * from the selected service time and re-base instantly when you switch it.
 *
 * Schedulers can add / edit / delete / reorder items and link each item to the
 * roles rostered on the plan. Reorder uses up/down controls rather than a
 * native drag dependency, so it works on web and over OTA (ADR-013).
 *
 * Route: /rostering/[group_id]/run-sheet/[plan_id]
 *
 * Backend: scheduling.eventItems.listItems / createItem / updateItem /
 * deleteItem / reorderItems, scheduling.events.getEvent (for title, times,
 * and the plan's roles used by the link picker).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
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
  computeItemClockTimes,
  formatClockTime,
  formatDuration,
} from "../utils/runSheetTiming";
import { ItemEditorModal, type ItemDraft } from "./ItemEditorModal";

type RunSheetItem = {
  _id: Id<"eventItems">;
  planId: Id<"eventPlans">;
  sequence: number;
  type: string;
  title: string;
  description: string | null;
  durationSec: number;
  notes: Array<{ category: string; content: string }>;
  songDetails: { key?: string; bpm?: number; author?: string } | null;
  assignments: Array<{
    roleId: Id<"teamRoles">;
    roleName: string;
    roleColor: string | null;
    userId: Id<"users"> | null;
    userName: string | null;
  }>;
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

export function RunSheetScreen() {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { plan_id } = useLocalSearchParams<{ plan_id: string }>();
  const planId = plan_id as Id<"eventPlans">;

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
  const reorderItems = useAuthenticatedMutation(
    api.functions.scheduling.eventItems.reorderItems,
  );

  // Which service time the sheet is displayed against (re-bases clock times).
  const [timeIndex, setTimeIndex] = useState(0);
  // The item being edited (or "new" for the create flow), opens the modal.
  const [editing, setEditing] = useState<RunSheetItem | "new" | null>(null);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  const times = event?.times ?? [];
  const activeTime = times[Math.min(timeIndex, Math.max(0, times.length - 1))];
  const serviceStartMs = activeTime?.startsAt ?? event?.eventDate ?? Date.now();

  const clockTimes = useMemo(
    () => computeItemClockTimes(items ?? [], serviceStartMs),
    [items, serviceStartMs],
  );

  // Plan roles for the link picker, with currently-assigned people resolved so
  // a role-only link can still display "Lead Vocal: Sarah".
  const roleOptions = useMemo(
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

  // roleId -> assigned people names, so a row's role-only link still shows the
  // person ("Lead Vocal: Sarah") without pinning a specific user.
  const peopleByRole = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of roleOptions) map[r.roleId as string] = r.people;
    return map;
  }, [roleOptions]);

  const handleSave = useCallback(
    async (draft: ItemDraft, itemId: Id<"eventItems"> | null) => {
      if (itemId) {
        await updateItem({ itemId, ...draft });
      } else {
        await createItem({ planId, ...draft });
      }
    },
    [createItem, updateItem, planId],
  );

  const handleDelete = useCallback(
    (item: RunSheetItem) => {
      Alert.alert("Delete item?", `Remove "${item.title}" from the run sheet?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            deleteItem({ itemId: item._id }).catch((e: any) =>
              Alert.alert("Couldn't delete", e?.message ?? "Please try again."),
            ),
        },
      ]);
    },
    [deleteItem],
  );

  // Move an item up/down by one slot and persist the new full order.
  const handleMove = useCallback(
    (index: number, direction: -1 | 1) => {
      if (!items) return;
      const target = index + direction;
      if (target < 0 || target >= items.length) return;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      reorderItems({ planId, orderedIds: next.map((i) => i._id) }).catch(
        (e: any) =>
          Alert.alert("Couldn't reorder", e?.message ?? "Please try again."),
      );
    },
    [items, reorderItems, planId],
  );

  const totalSec = useMemo(
    () => (items ?? []).reduce((sum, i) => sum + i.durationSec, 0),
    [items],
  );

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
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 96 },
          ]}
        >
          {/* Plan title + date */}
          <Text style={[styles.planTitle, { color: colors.text }]}>
            {event.title}
          </Text>
          <Text style={[styles.planDate, { color: colors.textSecondary }]}>
            {formatEventDateLong(event.eventDate)}
            {totalSec > 0 ? ` · ${formatDuration(totalSec)} total` : ""}
          </Text>

          {/* Service-time toggle (only when the plan has more than one time) */}
          {times.length > 1 ? (
            <View style={styles.timeToggleRow}>
              {times.map((t, i) => {
                const selected = i === timeIndex;
                return (
                  <Pressable
                    key={`${t.label}-${i}`}
                    onPress={() => setTimeIndex(i)}
                    style={styles.timeTogglePressable}
                  >
                    <View
                      style={[
                        styles.timeToggle,
                        {
                          backgroundColor: selected
                            ? primaryColor
                            : colors.surfaceSecondary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.timeToggleText,
                          { color: selected ? "#fff" : colors.textSecondary },
                        ]}
                      >
                        {t.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Items */}
          {items.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No items yet. Tap "Add item" to build this run sheet — songs,
              headers, media, and other moments in order.
            </Text>
          ) : (
            <View style={styles.itemList}>
              {items.map((item, index) => (
                <RunSheetRow
                  key={item._id}
                  item={item}
                  clockMs={clockTimes[item._id]}
                  peopleByRole={peopleByRole}
                  isFirst={index === 0}
                  isLast={index === items.length - 1}
                  onEdit={() => setEditing(item)}
                  onDelete={() => handleDelete(item)}
                  onMoveUp={() => handleMove(index, -1)}
                  onMoveDown={() => handleMove(index, 1)}
                />
              ))}
            </View>
          )}

          {/* Add item */}
          <Pressable onPress={() => setEditing("new")} style={styles.addPressable}>
            <View style={[styles.addRow, { borderColor: colors.border }]}>
              <Ionicons name="add" size={20} color={primaryColor} />
              <Text style={[styles.addText, { color: primaryColor }]}>
                Add item
              </Text>
            </View>
          </Pressable>
        </ScrollView>
      )}

      {editing && event ? (
        <ItemEditorModal
          item={editing === "new" ? null : editing}
          roleOptions={roleOptions}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

/** One run sheet row: time column + content + reorder/edit controls. */
function RunSheetRow({
  item,
  clockMs,
  peopleByRole,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  item: RunSheetItem;
  clockMs: number | null;
  peopleByRole: Record<string, string[]>;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { colors } = useTheme();
  const isHeader = item.type === "header";
  const duration = formatDuration(item.durationSec);

  if (isHeader) {
    return (
      <View style={styles.headerItemRow}>
        <View style={styles.reorderCol}>
          <ReorderControls
            isFirst={isFirst}
            isLast={isLast}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            colors={colors}
          />
        </View>
        <Pressable onPress={onEdit} style={styles.headerItemPressable}>
          <View style={styles.headerItemInner}>
            <Text
              style={[styles.headerItemText, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {item.title.toUpperCase()}
            </Text>
            {clockMs != null ? (
              <Text style={[styles.headerItemTime, { color: colors.textTertiary }]}>
                {formatClockTime(clockMs)}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <DeleteButton onDelete={onDelete} colors={colors} />
      </View>
    );
  }

  return (
    <View style={[styles.itemRow, { backgroundColor: colors.surfaceSecondary }]}>
      <View style={styles.reorderCol}>
        <ReorderControls
          isFirst={isFirst}
          isLast={isLast}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          colors={colors}
        />
      </View>

      {/* Time column */}
      <View style={styles.timeCol}>
        <Text style={[styles.timeText, { color: colors.text }]}>
          {clockMs != null ? formatClockTime(clockMs) : "—"}
        </Text>
        {duration ? (
          <Text style={[styles.durationText, { color: colors.textTertiary }]}>
            {duration}
          </Text>
        ) : null}
      </View>

      {/* Content */}
      <Pressable onPress={onEdit} style={styles.contentPressable}>
        <View style={styles.contentInner}>
          <View style={styles.titleLine}>
            <TypeBadge type={item.type} colors={colors} />
            <Text
              style={[styles.itemTitle, { color: colors.text }]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
          </View>

          {item.type === "song" && item.songDetails?.key ? (
            <Text style={[styles.songMeta, { color: colors.textSecondary }]}>
              Key {item.songDetails.key}
              {item.songDetails.bpm ? ` · ${item.songDetails.bpm} BPM` : ""}
            </Text>
          ) : null}

          {item.assignments.length > 0 ? (
            <View style={styles.assignWrap}>
              {item.assignments.map((a) => {
                // Prefer a pinned user; otherwise show whoever currently fills
                // the linked role (resolved from the plan's roster).
                const names = a.userName
                  ? [a.userName]
                  : peopleByRole[a.roleId as string] ?? [];
                return (
                  <View
                    key={a.roleId}
                    style={[
                      styles.assignChip,
                      { backgroundColor: (a.roleColor ?? DEFAULT_ROLE_COLOR) + "22" },
                    ]}
                  >
                    <View
                      style={[
                        styles.assignSwatch,
                        { backgroundColor: a.roleColor ?? DEFAULT_ROLE_COLOR },
                      ]}
                    />
                    <Text
                      style={[styles.assignText, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {a.roleName}
                      {names.length > 0 ? `: ${names.join(", ")}` : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {item.notes.length > 0 ? (
            <Text
              style={[styles.notePreview, { color: colors.textSecondary }]}
              numberOfLines={2}
            >
              {item.notes[0].category}: {item.notes[0].content}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <DeleteButton onDelete={onDelete} colors={colors} />
    </View>
  );
}

function ReorderControls({
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  colors,
}: {
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <>
      <Pressable
        onPress={onMoveUp}
        disabled={isFirst}
        hitSlop={6}
        accessibilityLabel="Move up"
      >
        <View style={[styles.reorderBtn, isFirst && { opacity: 0.25 }]}>
          <Ionicons name="chevron-up" size={18} color={colors.text} />
        </View>
      </Pressable>
      <Pressable
        onPress={onMoveDown}
        disabled={isLast}
        hitSlop={6}
        accessibilityLabel="Move down"
      >
        <View style={[styles.reorderBtn, isLast && { opacity: 0.25 }]}>
          <Ionicons name="chevron-down" size={18} color={colors.text} />
        </View>
      </Pressable>
    </>
  );
}

function DeleteButton({
  onDelete,
  colors,
}: {
  onDelete: () => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteBtn}>
      <Ionicons name="close" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

function TypeBadge({
  type,
  colors,
}: {
  type: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  if (type === "item") return null;
  const icon =
    type === "song"
      ? ("musical-notes" as const)
      : type === "media"
        ? ("videocam" as const)
        : ("bookmark" as const);
  return (
    <View style={[styles.typeBadge, { backgroundColor: colors.border }]}>
      <Ionicons name={icon} size={12} color={colors.textSecondary} />
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
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14 },
  scrollContent: { padding: 16 },
  planTitle: { fontSize: 22, fontWeight: "700" },
  planDate: { fontSize: 13, marginTop: 4 },
  timeToggleRow: { flexDirection: "row", gap: 8, marginTop: 16, flexWrap: "wrap" },
  timeTogglePressable: { borderRadius: 999 },
  timeToggle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  timeToggleText: { fontSize: 14, fontWeight: "600" },
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 24 },
  itemList: { marginTop: 16, gap: 8 },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  reorderCol: { alignItems: "center", justifyContent: "center", gap: 2, paddingTop: 2 },
  reorderBtn: { padding: 2 },
  timeCol: { width: 64, paddingTop: 2 },
  timeText: { fontSize: 14, fontWeight: "700" },
  durationText: { fontSize: 11, marginTop: 1 },
  contentPressable: { flex: 1 },
  contentInner: { flex: 1, gap: 4 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  typeBadge: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: "600" },
  songMeta: { fontSize: 12 },
  assignWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
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
  notePreview: { fontSize: 12, lineHeight: 16 },
  deleteBtn: { padding: 4 },
  headerItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    marginTop: 4,
  },
  headerItemPressable: { flex: 1 },
  headerItemInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  headerItemText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, flexShrink: 1 },
  headerItemTime: { fontSize: 11, fontWeight: "600" },
  addPressable: { marginTop: 16 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  addText: { fontSize: 15, fontWeight: "600" },
});
