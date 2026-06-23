/**
 * EventEditorPanel
 *
 * Plan-LEVEL controls for a single event plan, rendered as the grid's docked
 * right panel (desktop) and as a bottom sheet (mobile). Tapping a date-column
 * header in RosterGridScreen opens this; it is mutually exclusive with the
 * grid's assign / role-cell / member-cell panels via the single-panel
 * coordinator.
 *
 * It deliberately OMITS the per-role "Assign someone" cards (the
 * `TeamRoleGroup` / `AssignSheet` flow that EventEditorScreen still shows):
 * the GRID itself is the assignment surface, so duplicating per-role assign
 * here would (a) double the placement UI and (b) nest an AssignSheet inside the
 * dock, fighting the grid's own assign dock. This panel is for plan-level
 * actions only — rename, When, needed roles, run sheet, publish, duplicate,
 * delete.
 *
 * Used by:
 *  - RosterGridScreen (docked / bottom sheet) — the grid is the rostering home.
 *  - EventEditorScreen (the standalone /rostering/[group_id]/event/[plan_id]
 *    route still renders the fuller editor, including per-role assign).
 *
 * Backend: scheduling.events.getEvent / updateEvent / deleteEvent /
 * duplicateEvent, scheduling.assignments.publishEvent, NeededRolesModal.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  useAuthenticatedAction,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { confirmAsync, notify } from "@/utils/platformAlert";
import { NeededRolesModal } from "./NeededRolesModal";
import { TimesEditor } from "./TimesEditor";

/** Formats a Date as a display time label, e.g. "9:00 AM". */
function formatTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

type EventRole = {
  roleId: Id<"teamRoles">;
  teamId: Id<"teams">;
  roleName: string;
  needed: number;
};

type EventDoc = {
  _id: Id<"eventPlans">;
  groupId: Id<"groups">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
  status: string;
  fillSummary: { totalNeeded: number; totalFilled: number };
  roles: EventRole[];
};

type Colors = ReturnType<typeof useTheme>["colors"];

export function EventEditorPanel({
  planId,
  docked = false,
  onClose,
}: {
  planId: Id<"eventPlans">;
  /** Desktop: render into the grid's right dock (no Modal chrome). */
  docked?: boolean;
  /** Called after the panel should close (× tap, or a delete that succeeds). */
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const router = useRouter();

  const event = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    planId ? { planId } : "skip",
  ) as EventDoc | null | undefined;

  // Run sheet item count, for the "Run sheet" entry row (ADR-026).
  const runSheetItems = useAuthenticatedQuery(
    api.functions.scheduling.eventItems.listItems,
    planId ? { planId } : "skip",
  ) as Array<unknown> | null | undefined;

  // Compact availability summary for the event (display-only).
  const availability = useAuthenticatedQuery(
    api.functions.scheduling.availability.availabilityForPlan,
    planId ? { planId } : "skip",
  ) as
    | {
        counts: {
          available: number;
          unavailable: number;
          noResponse: number;
          total: number;
        };
      }
    | null
    | undefined;

  const updateEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.updateEvent,
  );
  const deleteEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.deleteEvent,
  );
  const duplicateEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.duplicateEvent,
  );
  const publishEvent = useAuthenticatedAction(
    api.functions.scheduling.assignments.publishEvent,
  );

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [neededVisible, setNeededVisible] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // teamId|roleId -> needed count, fed into the needed-roles modal.
  const currentCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const role of event?.roles ?? []) {
      map[`${role.teamId}|${role.roleId}`] = role.needed;
    }
    return map;
  }, [event?.roles]);

  // Title auto-saves: a debounced save fires as the scheduler types, and any
  // still-pending save is flushed on blur/submit and on closing the panel.
  // (iOS does not reliably blur a TextInput when you tap elsewhere, so we must
  // not depend on onBlur alone — and on the dock there is no unmount on blur.)
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTitleRef = useRef<string | null>(null);

  const flushTitle = useCallback(async () => {
    if (titleSaveTimer.current) {
      clearTimeout(titleSaveTimer.current);
      titleSaveTimer.current = null;
    }
    const pending = pendingTitleRef.current;
    pendingTitleRef.current = null;
    if (pending == null) return;
    const trimmed = pending.trim();
    if (!trimmed || trimmed === event?.title) return;
    try {
      await updateEvent({ planId, title: trimmed });
    } catch (e: any) {
      notify("Couldn't rename", e?.message ?? "Please try again.");
    }
  }, [event?.title, updateEvent, planId]);

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitleDraft(text);
      pendingTitleRef.current = text;
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
      titleSaveTimer.current = setTimeout(() => {
        void flushTitle();
      }, 600);
    },
    [flushTitle],
  );

  const handleSaveTitle = useCallback(() => {
    setEditingTitle(false);
    void flushTitle();
  }, [flushTitle]);

  // Flush a pending title save when the panel unmounts (the dock closes, the
  // sheet dismisses, or the grid swaps to another panel) so an in-progress
  // rename is never lost.
  const flushTitleRef = useRef(flushTitle);
  flushTitleRef.current = flushTitle;
  useEffect(() => () => void flushTitleRef.current(), []);

  // Close = flush any pending rename first, then notify the parent. Used by the
  // × button and (on a swap) the coordinator; the unmount effect above is the
  // belt-and-braces for paths that bypass this (delete, route change).
  const handleClose = useCallback(() => {
    void flushTitle();
    onClose();
  }, [flushTitle, onClose]);

  const handleChangeDate = useCallback(
    async (date: Date | null) => {
      if (!date) return;
      try {
        await updateEvent({ planId, eventDate: date.getTime() });
      } catch (e: any) {
        notify("Couldn't update date", e?.message ?? "Please try again.");
      }
    },
    [updateEvent, planId],
  );

  const saveTimes = useCallback(
    async (times: Array<{ label: string; startsAt: number }>) => {
      try {
        await updateEvent({ planId, times });
      } catch (e: any) {
        notify("Couldn't update times", e?.message ?? "Please try again.");
      }
    },
    [updateEvent, planId],
  );

  const handleChangeTimeAt = useCallback(
    (index: number, date: Date | null) => {
      if (!date || !event) return;
      void saveTimes(
        event.times.map((t, i) =>
          i === index
            ? { label: formatTimeLabel(date), startsAt: date.getTime() }
            : t,
        ),
      );
    },
    [event, saveTimes],
  );

  const handleRemoveTime = useCallback(
    (index: number) => {
      if (!event) return;
      void saveTimes(event.times.filter((_, i) => i !== index));
    },
    [event, saveTimes],
  );

  const handleAddTime = useCallback(() => {
    if (!event) return;
    const last = event.times[event.times.length - 1];
    let base: Date;
    if (last) {
      base = new Date(last.startsAt + 60 * 60 * 1000); // an hour after the last
    } else {
      base = new Date(event.eventDate);
      base.setHours(9, 0, 0, 0);
    }
    void saveTimes([
      ...event.times,
      { label: formatTimeLabel(base), startsAt: base.getTime() },
    ]);
  }, [event, saveTimes]);

  const handleDuplicate = useCallback(async () => {
    if (!event) return;
    setMenuOpen(false);
    try {
      const result = await duplicateEvent({ planId });
      // The reactive grid will show the new column; jump the panel to the copy
      // so the leader can set its date right away.
      router.push(
        `/rostering/${event.groupId}/event/${result.planId}` as never,
      );
    } catch (e: any) {
      notify("Couldn't duplicate", e?.message ?? "Please try again.");
    }
  }, [event, duplicateEvent, planId, router]);

  const handleDelete = useCallback(async () => {
    setMenuOpen(false);
    const ok = await confirmAsync({
      title: "Delete event plan?",
      message: "This removes the event plan and all its assignments.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteEvent({ planId });
      // Drop the in-flight rename — the plan is gone — and let the grid's
      // reactive query drop the column.
      pendingTitleRef.current = null;
      onClose();
    } catch (e: any) {
      notify("Couldn't delete", e?.message ?? "Please try again.");
    }
  }, [deleteEvent, planId, onClose]);

  const handlePublish = useCallback(async () => {
    if (!event) return;
    const ok = await confirmAsync({
      title: "Publish & send requests?",
      message:
        "Volunteers with an open request will get a push and SMS asking them to accept or decline.",
      confirmText: "Publish",
    });
    if (!ok) return;
    setPublishing(true);
    try {
      const result = await publishEvent({ planId });
      notify(
        "Event plan published",
        result.requestCount > 0
          ? `Sent ${result.requestCount} request${
              result.requestCount === 1 ? "" : "s"
            }.`
          : "No pending requests to send.",
      );
    } catch (e: any) {
      notify("Couldn't publish", e?.message ?? "Please try again.");
    } finally {
      setPublishing(false);
    }
  }, [event, publishEvent, planId]);

  // -------------------------------------------------------------------------

  if (event === undefined) {
    return (
      <PanelFrame colors={colors} title="Event plan" onClose={handleClose}>
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={colors.text} />
        </View>
      </PanelFrame>
    );
  }

  if (!event) {
    return (
      <PanelFrame colors={colors} title="Event plan" onClose={handleClose}>
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.textSecondary }]}>
            This event plan is no longer available.
          </Text>
        </View>
      </PanelFrame>
    );
  }

  const isPublished = event.status === "published";

  return (
    <PanelFrame
      colors={colors}
      title={event.title}
      onClose={handleClose}
      headerRight={
        <View>
          <TouchableOpacity
            onPress={() => setMenuOpen((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Event plan options"
            style={styles.menuBtn}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={22}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {menuOpen && (
            <View
              style={[
                styles.menu,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <TouchableOpacity
                onPress={handleDuplicate}
                style={styles.menuItem}
                accessibilityRole="button"
              >
                <Ionicons name="copy-outline" size={18} color={colors.text} />
                <Text style={[styles.menuItemText, { color: colors.text }]}>
                  Duplicate
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDelete}
                style={styles.menuItem}
                accessibilityRole="button"
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={colors.destructive}
                />
                <Text
                  style={[styles.menuItemText, { color: colors.destructive }]}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      }
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        {editingTitle ? (
          <TextInput
            value={titleDraft}
            onChangeText={handleTitleChange}
            onBlur={handleSaveTitle}
            onSubmitEditing={handleSaveTitle}
            returnKeyType="done"
            autoFocus
            maxLength={120}
            placeholder="Event plan title"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.titleInput,
              {
                color: colors.text,
                borderColor: colors.inputBorder,
                backgroundColor: colors.inputBackground,
              },
            ]}
          />
        ) : (
          <Pressable
            onPress={() => {
              setTitleDraft(event.title);
              setEditingTitle(true);
            }}
            style={styles.titleRow}
          >
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {event.title}
            </Text>
            <Ionicons name="pencil" size={16} color={colors.textSecondary} />
          </Pressable>
        )}

        {/* When — date + one or more times. */}
        <TimesEditor
          eventDate={event.eventDate}
          times={event.times}
          onChangeDate={handleChangeDate}
          onChangeTimeAt={handleChangeTimeAt}
          onRemoveTime={handleRemoveTime}
          onAddTime={handleAddTime}
        />

        {/* Status pill */}
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: isPublished
                ? colors.success + "22"
                : colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.statusPillText,
              { color: isPublished ? colors.success : colors.textSecondary },
            ]}
          >
            {isPublished ? "Published" : "Draft"}
          </Text>
        </View>

        <Text style={[styles.autoSaveHint, { color: colors.textSecondary }]}>
          Changes are saved automatically. Publishing notifies volunteers.
        </Text>

        {/* Availability summary — a single compact line. */}
        {availability && availability.counts.total > 0 && (
          <Text
            style={[styles.availabilitySummary, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            🗓 Availability — {availability.counts.available} available ·{" "}
            {availability.counts.unavailable} can't ·{" "}
            {availability.counts.noResponse} no response
          </Text>
        )}

        {/* Needed roles editor entry */}
        <Pressable
          onPress={() => setNeededVisible(true)}
          style={({ pressed }) => [
            styles.actionRow,
            { backgroundColor: colors.surfaceSecondary },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="options-outline" size={20} color={colors.text} />
          <Text style={[styles.actionLabel, { color: colors.text }]}>
            Set needed roles
          </Text>
          <Text style={[styles.actionValue, { color: colors.textSecondary }]}>
            {event.fillSummary.totalFilled}/{event.fillSummary.totalNeeded}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>

        {/* Run sheet (order-of-items) entry — ADR-026. */}
        <Pressable
          onPress={() =>
            router.push(
              `/rostering/${event.groupId}/run-sheet/${planId}` as never,
            )
          }
          style={({ pressed }) => [
            styles.actionRow,
            { backgroundColor: colors.surfaceSecondary, marginTop: 12 },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="list-outline" size={20} color={colors.text} />
          <Text style={[styles.actionLabel, { color: colors.text }]}>
            Run sheet
          </Text>
          <Text style={[styles.actionValue, { color: colors.textSecondary }]}>
            {runSheetItems === undefined
              ? ""
              : `${runSheetItems?.length ?? 0} item${
                  (runSheetItems?.length ?? 0) === 1 ? "" : "s"
                }`}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </Pressable>

        {/* Assignment happens on the GRID — this panel intentionally has no
            per-role assign cards. A short pointer keeps that discoverable. */}
        <Text style={[styles.assignHint, { color: colors.textTertiary }]}>
          Assign people from the grid — tap a role × date cell.
        </Text>

        {/* Publish & send — the same action the toolbar Publish runs. */}
        <Pressable
          onPress={handlePublish}
          disabled={publishing}
          style={({ pressed }) => [
            styles.publishBtn,
            { backgroundColor: primaryColor },
            (publishing || pressed) && { opacity: 0.8 },
          ]}
          accessibilityRole="button"
        >
          {publishing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.publishBtnText}>
              {isPublished ? "Re-send requests" : "Publish & send requests"}
            </Text>
          )}
        </Pressable>
      </ScrollView>

      <NeededRolesModal
        visible={neededVisible}
        planId={planId}
        groupId={event.groupId}
        currentCounts={currentCounts}
        onClose={() => setNeededVisible(false)}
      />
    </PanelFrame>
  );
}

/**
 * The panel's header + body shell. `docked`-agnostic: the caller (the dock vs.
 * the bottom-sheet Modal in RosterGridScreen) supplies the outer container, so
 * this just renders the close-able header and the children. A ⋯ menu / other
 * controls slot into `headerRight`.
 */
function PanelFrame({
  colors,
  title,
  onClose,
  headerRight,
  children,
}: {
  colors: Colors;
  title: string;
  onClose: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.frame}>
      <View style={styles.head}>
        <Text
          style={[styles.headTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {headerRight}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 0 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  headTitle: { flex: 1, minWidth: 0, fontSize: 17, fontWeight: "700" },
  menuBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  // Anchored under the ⋯; small floating action list. Sits above the scroll.
  menu: {
    position: "absolute",
    top: 34,
    right: 0,
    minWidth: 150,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    zIndex: 10,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  menuItemText: { fontSize: 15, fontWeight: "500" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14, textAlign: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  title: { flex: 1, fontSize: 22, fontWeight: "700" },
  titleInput: {
    fontSize: 20,
    fontWeight: "700",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  autoSaveHint: { fontSize: 12, lineHeight: 16, marginTop: 8 },
  availabilitySummary: { fontSize: 12, lineHeight: 16, marginTop: 8 },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 12,
  },
  statusPillText: { fontSize: 11, fontWeight: "700" },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionLabel: { flex: 1, fontSize: 16, fontWeight: "500" },
  actionValue: { fontSize: 14, fontWeight: "600" },
  assignHint: { fontSize: 12, lineHeight: 16, marginTop: 20 },
  publishBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  publishBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
});
