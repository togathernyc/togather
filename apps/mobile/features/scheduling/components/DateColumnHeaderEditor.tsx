/**
 * DateColumnHeaderEditor
 *
 * The desktop date-column header turned into an inline plan editor. On the
 * grid-first roster screen (≥700px) the docked plan-detail side panel is gone:
 * everything a leader edited there now lives in the column header itself.
 *
 *  - Title — plain text; tap to rename inline (debounced auto-save +
 *    blur/unmount flush, the same discipline EventEditorPanel/EventEditorScreen
 *    use so an in-flight rename is never lost).
 *  - Date — plain text; tap opens a date-only popup (just the date picker).
 *  - Run sheet — a compact button showing the item count → the run-sheet route.
 *  - A visible `⋯` button AND a web right-click (`onContextMenu`) open a context
 *    menu: Set needed roles · Edit time · Open run sheet · Publish this date ·
 *    Duplicate · Delete — all wired to the SAME plan mutations the editor uses.
 *    "Edit time" opens a times-only popup (list of service times with
 *    add/change/remove).
 *
 * Narrow columns keep title + date visible and fold the run-sheet button
 * (and everything else) into the `⋯`/right-click menu.
 *
 * Reuses the plan mutations directly (scheduling.events.updateEvent /
 * duplicateEvent / deleteEvent, scheduling.assignments.publishEvent) and opens
 * the shared NeededRolesModal. It fetches the plan via getEvent for the roles
 * (NeededRolesModal's currentCounts) and listItems for the run-sheet count —
 * mirroring EventEditorPanel, so the two surfaces can't drift.
 *
 * Mobile is unaffected: the grid still renders a plain tappable header that
 * opens the EventEditorPanel bottom sheet (see RosterGridScreen).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTheme } from "@hooks/useTheme";
import { DatePicker } from "@components/ui/DatePicker";
import {
  useAuthenticatedQuery,
  useAuthenticatedMutation,
  api,
} from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { confirmAsync, notify } from "@/utils/platformAlert";
import { NeededRolesModal } from "./NeededRolesModal";

type Colors = ReturnType<typeof useTheme>["colors"];

/** The slice of a roster event the header editor needs (from rosterMatrix). */
export type HeaderEvent = {
  _id: Id<"eventPlans">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
  status: "draft" | "published";
};

type EventRole = { roleId: Id<"teamRoles">; teamId: Id<"teams">; needed: number };
type EventDoc = {
  _id: Id<"eventPlans">;
  groupId: Id<"groups">;
  roles: EventRole[];
};

/** Best-effort human message from a thrown value (Convex error or Error). */
function errMessage(e: unknown): string {
  const err = e as { data?: { message?: string }; message?: string };
  return err?.data?.message ?? err?.message ?? "Please try again.";
}

function formatTimeLabel(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function monthDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
/** "Sun, Jul 5" — the plain-text date shown in the header (no input box). */
function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function DateColumnHeaderEditor({
  event,
  groupId,
  width,
  height,
  narrow,
  colors,
  tally,
  onPublish,
}: {
  event: HeaderEvent;
  groupId: Id<"groups">;
  width: number;
  height: number;
  /** Narrow column: fold the run-sheet button + extras into the ⋯ menu. */
  narrow: boolean;
  colors: Colors;
  /** The view-specific coverage/availability tally (rendered by the caller). */
  tally: React.ReactNode;
  /** Publish just this date — runs the grid's confirm-and-publish flow. */
  onPublish: () => void;
}) {
  const router = useRouter();

  // Run-sheet item count for the header button / menu row.
  const runSheetItems = useAuthenticatedQuery(
    api.functions.scheduling.eventItems.listItems,
    { planId: event._id },
  ) as Array<unknown> | null | undefined;

  // Plan doc — only for NeededRolesModal's currentCounts (roles + groupId).
  // Fetched lazily: skipped until the needed-roles modal is engaged.
  const [neededVisible, setNeededVisible] = useState(false);
  const planDoc = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    neededVisible ? { planId: event._id } : "skip",
  ) as EventDoc | null | undefined;

  const updateEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.updateEvent,
  );
  const deleteEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.deleteEvent,
  );
  const duplicateEvent = useAuthenticatedMutation(
    api.functions.scheduling.events.duplicateEvent,
  );

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // Two separate edit popups — the native pickers live ONLY here, never inline
  // in the header. The date is a plain-text tap in the header; times moved into
  // the ⋯ menu ("Edit time").
  const [dateEditOpen, setDateEditOpen] = useState(false);
  const [timesEditOpen, setTimesEditOpen] = useState(false);

  // --- Title auto-save (debounced) + blur/unmount flush (reused pattern) ---
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
    if (!trimmed || trimmed === event.title) return;
    try {
      await updateEvent({ planId: event._id, title: trimmed });
    } catch (e) {
      notify("Couldn't rename", errMessage(e));
    }
  }, [event.title, event._id, updateEvent]);

  const handleTitleChange = useCallback(
    (text: string) => {
      setTitleDraft(text);
      pendingTitleRef.current = text;
      if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current);
      titleSaveTimer.current = setTimeout(() => void flushTitle(), 600);
    },
    [flushTitle],
  );

  const handleSaveTitle = useCallback(() => {
    setEditingTitle(false);
    void flushTitle();
  }, [flushTitle]);

  // Flush any pending rename on unmount (column removed, screen swap).
  const flushTitleRef = useRef(flushTitle);
  flushTitleRef.current = flushTitle;
  useEffect(() => () => void flushTitleRef.current(), []);

  // --- Date / times ---
  const saveTimes = useCallback(
    async (times: Array<{ label: string; startsAt: number }>) => {
      try {
        await updateEvent({ planId: event._id, times });
      } catch (e) {
        notify("Couldn't update times", errMessage(e));
      }
    },
    [updateEvent, event._id],
  );

  const handleChangeDate = useCallback(
    async (date: Date | null) => {
      if (!date) return;
      try {
        await updateEvent({ planId: event._id, eventDate: date.getTime() });
      } catch (e) {
        notify("Couldn't update date", errMessage(e));
      }
    },
    [updateEvent, event._id],
  );

  const handleChangeTimeAt = useCallback(
    (index: number, date: Date | null) => {
      if (!date) return;
      void saveTimes(
        event.times.map((t, i) =>
          i === index
            ? { label: formatTimeLabel(date), startsAt: date.getTime() }
            : t,
        ),
      );
    },
    [event.times, saveTimes],
  );

  const handleAddTime = useCallback(() => {
    const last = event.times[event.times.length - 1];
    let base: Date;
    if (last) {
      base = new Date(last.startsAt + 60 * 60 * 1000);
    } else {
      base = new Date(event.eventDate);
      base.setHours(9, 0, 0, 0);
    }
    void saveTimes([
      ...event.times,
      { label: formatTimeLabel(base), startsAt: base.getTime() },
    ]);
  }, [event.times, event.eventDate, saveTimes]);

  const handleRemoveTimeAt = useCallback(
    (index: number) => {
      void saveTimes(event.times.filter((_, i) => i !== index));
    },
    [event.times, saveTimes],
  );

  // --- Menu actions ---
  const openRunSheet = useCallback(() => {
    setMenuOpen(false);
    router.push(`/rostering/${groupId}/run-sheet/${event._id}` as never);
  }, [router, groupId, event._id]);

  const handleDuplicate = useCallback(async () => {
    setMenuOpen(false);
    try {
      await duplicateEvent({ planId: event._id });
      // The reactive grid adds the copy's column on its own.
    } catch (e) {
      notify("Couldn't duplicate", errMessage(e));
    }
  }, [duplicateEvent, event._id]);

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
      pendingTitleRef.current = null;
      await deleteEvent({ planId: event._id });
    } catch (e) {
      notify("Couldn't delete", errMessage(e));
    }
  }, [deleteEvent, event._id]);

  // currentCounts for NeededRolesModal, derived from the lazily-loaded plan doc.
  const currentCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const role of planDoc?.roles ?? []) {
      map[`${role.teamId}|${role.roleId}`] = role.needed;
    }
    return map;
  }, [planDoc?.roles]);

  const runSheetCount = runSheetItems?.length ?? 0;

  // RN-Web forwards unknown DOM props on the host node; onContextMenu lands on
  // the underlying <div>. The types don't know it, so we attach via a cast on a
  // web-only prop bag. The ⋯ button is the reliable primary; this is the bonus.
  const contextMenuProps =
    typeof document !== "undefined"
      ? ({
          onContextMenu: (e: { preventDefault?: () => void }) => {
            e.preventDefault?.();
            setMenuOpen(true);
          },
        } as Record<string, unknown>)
      : {};

  return (
    <View
      {...contextMenuProps}
      style={[
        styles.headerCell,
        { width, minHeight: height, borderLeftColor: colors.border },
      ]}
    >
      {/* Title row: editable inline + ⋯ button (always visible). */}
      <View style={styles.titleRow}>
        {editingTitle ? (
          <TextInput
            value={titleDraft}
            onChangeText={handleTitleChange}
            onBlur={handleSaveTitle}
            onSubmitEditing={handleSaveTitle}
            returnKeyType="done"
            autoFocus
            maxLength={120}
            placeholder="Title"
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
            style={styles.titleTap}
            accessibilityRole="button"
            accessibilityLabel={`Rename ${event.title}`}
          >
            <Text
              style={[styles.titleText, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {event.title}
            </Text>
          </Pressable>
        )}
        <TouchableOpacity
          onPress={() => setMenuOpen((v) => !v)}
          hitSlop={8}
          style={styles.kebab}
          accessibilityRole="button"
          accessibilityLabel={`Options for ${event.title}`}
        >
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Date — plain text; tapping opens the date-only edit popup (no inline
          native input box, no pencil, no times in the header). */}
      <TouchableOpacity
        onPress={() => setDateEditOpen(true)}
        style={styles.whenRow}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={`Edit date — ${dateLabel(event.eventDate)}`}
      >
        <Text
          style={[styles.weekday, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {dateLabel(event.eventDate)}
        </Text>
      </TouchableOpacity>

      {/* Coverage / availability tally (rendered by the caller, view-aware). */}
      <View style={styles.tallyRow}>{tally}</View>

      {/* Run-sheet button — wide columns only; narrow folds it into the menu. */}
      {!narrow && (
        <TouchableOpacity
          onPress={openRunSheet}
          style={[styles.runSheetBtn, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Open run sheet"
        >
          <Ionicons name="list-outline" size={12} color={colors.textSecondary} />
          <Text
            style={[styles.runSheetText, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            Run sheet · {runSheetCount}
          </Text>
        </TouchableOpacity>
      )}

      {/* Context menu — a centered card over a dim backdrop (Modal), matching
          the screen's other menus. A Modal (rather than an absolutely-
          positioned popover) avoids the horizontal header ScrollView clipping
          the list on web. Opened by the ⋯ button or a web right-click. */}
      {menuOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setMenuOpen(false)}
        >
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => setMenuOpen(false)}
          >
            <Pressable
              style={[
                styles.menuCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <Text
                style={[styles.menuHeading, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {event.title} · {monthDay(event.eventDate)}
              </Text>
              <MenuItem
                icon="options-outline"
                label="Set needed roles"
                colors={colors}
                onPress={() => {
                  setMenuOpen(false);
                  setNeededVisible(true);
                }}
              />
              <MenuItem
                icon="time-outline"
                label="Edit time"
                colors={colors}
                onPress={() => {
                  setMenuOpen(false);
                  setTimesEditOpen(true);
                }}
              />
              <MenuItem
                icon="list-outline"
                label={`Open run sheet · ${runSheetCount}`}
                colors={colors}
                onPress={openRunSheet}
              />
              <MenuItem
                icon="paper-plane-outline"
                label={
                  event.status === "published"
                    ? `Re-send · ${monthDay(event.eventDate)}`
                    : "Publish this date"
                }
                colors={colors}
                onPress={() => {
                  setMenuOpen(false);
                  onPublish();
                }}
              />
              <MenuItem
                icon="copy-outline"
                label="Duplicate"
                colors={colors}
                onPress={handleDuplicate}
              />
              <MenuItem
                icon="trash-outline"
                label="Delete"
                colors={colors}
                destructive
                onPress={handleDelete}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Date-only edit popup — opened by tapping the plain-text date in the
          header. Just the date picker + Done. Reuses handleChangeDate. */}
      {dateEditOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setDateEditOpen(false)}
        >
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => setDateEditOpen(false)}
          >
            <Pressable
              style={[
                styles.menuCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.whenEditHeader}>
                <Text style={[styles.whenEditTitle, { color: colors.text }]} numberOfLines={1}>
                  {event.title} · date
                </Text>
                <TouchableOpacity
                  onPress={() => setDateEditOpen(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Text style={[styles.whenEditDone, { color: colors.link }]}>Done</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.whenEditBody}>
                <Text style={[styles.whenEditLabel, { color: colors.textSecondary }]}>
                  Date
                </Text>
                <DatePicker
                  value={new Date(event.eventDate)}
                  onChange={handleChangeDate}
                  mode="date"
                />
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Times-only editor — opened by the ⋯ menu's "Edit time". Lists each
          service time (change inline) with a remove ✕, an Add time button, and
          Done. Reuses handleChangeTimeAt / handleAddTime / handleRemoveTimeAt. */}
      {timesEditOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setTimesEditOpen(false)}
        >
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => setTimesEditOpen(false)}
          >
            <Pressable
              style={[
                styles.menuCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.whenEditHeader}>
                <Text style={[styles.whenEditTitle, { color: colors.text }]} numberOfLines={1}>
                  {event.title} · times
                </Text>
                <TouchableOpacity
                  onPress={() => setTimesEditOpen(false)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Text style={[styles.whenEditDone, { color: colors.link }]}>Done</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.whenEditBody}>
                {event.times.map((t, index) => (
                  <View key={`${t.startsAt}-${index}`} style={styles.timeEditRow}>
                    <View style={styles.timeEditPicker}>
                      <DatePicker
                        value={new Date(t.startsAt)}
                        onChange={(d) => handleChangeTimeAt(index, d)}
                        mode="time"
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemoveTimeAt(index)}
                      hitSlop={8}
                      style={styles.removeTime}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove time ${t.label}`}
                    >
                      <Ionicons name="close" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity
                  onPress={handleAddTime}
                  style={styles.addTime}
                  accessibilityRole="button"
                  accessibilityLabel="Add a time"
                >
                  <Ionicons name="add" size={16} color={colors.link} />
                  <Text style={[styles.addTimeText, { color: colors.link }]}>Add time</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <NeededRolesModal
        visible={neededVisible}
        planId={event._id}
        groupId={groupId}
        currentCounts={currentCounts}
        onClose={() => setNeededVisible(false)}
      />
    </View>
  );
}

function MenuItem({
  icon,
  label,
  colors,
  onPress,
  destructive = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  colors: Colors;
  onPress: () => void;
  destructive?: boolean;
}) {
  const tint = destructive ? colors.destructive : colors.text;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.menuItem}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={tint} />
      <Text style={[styles.menuItemText, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  headerCell: {
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 2,
    // The menu floats above sibling columns; keep the cell as the stacking
    // context anchor for its absolute children.
    position: "relative",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  titleTap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  titleText: { fontSize: 10, fontWeight: "600", flexShrink: 1 },
  titleInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  kebab: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  whenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  weekday: { fontSize: 11, fontWeight: "600", flexShrink: 1 },
  timeEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timeEditPicker: { flex: 1, minWidth: 0 },
  removeTime: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  addTime: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
  },
  addTimeText: { fontSize: 14, fontWeight: "600" },
  whenEditHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  whenEditTitle: { fontSize: 13, fontWeight: "700", flexShrink: 1, marginRight: 12 },
  whenEditDone: { fontSize: 15, fontWeight: "600" },
  whenEditBody: { paddingHorizontal: 14, paddingBottom: 12 },
  whenEditLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 4,
  },
  tallyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    minHeight: 14,
  },
  runSheetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    alignSelf: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  runSheetText: { fontSize: 9, fontWeight: "600" },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  menuCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  menuHeading: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 4,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  menuItemText: { fontSize: 14, fontWeight: "500", flexShrink: 1 },
});
