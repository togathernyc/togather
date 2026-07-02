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
 * Editing is spreadsheet-style: the run sheet is one continuous `GridScrollList`
 * table (Item / When / Time / Dur / Owner-Role / Notes / Song / actions) modelled
 * on the events-os Run of Show. There are no segment-heading rows — a row's phase
 * is the "When" column. Duration and title edit inline; When, Who, Notes, and Song
 * open focused modals. Reordering is drag-and-drop from a grip in the first cell
 * (web + native). Each row can be duplicated or deleted from the actions column.
 *
 * Route: /rostering/[group_id]/run-sheet/[plan_id]
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
  Platform,
  type TextStyle,
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
import { GridScrollList, OptionTag, type GridColumn } from "./GridScrollList";
import { AnchoredMenu, measureAnchor, type AnchorRect } from "./AnchoredMenu";
import { SongPicker } from "./SongPicker";
import { CustomModal } from "@components/ui/Modal";
import type { Song } from "@features/songs/types";

/** When an item happens relative to the event's service times. */
type Segment = "before" | "during" | "after";
const SEGMENT_OPTIONS: Array<{ key: Segment; label: string; short: string }> = [
  { key: "before", label: "Before event", short: "Before" },
  { key: "during", label: "During event", short: "During" },
  { key: "after", label: "After event", short: "After" },
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

  // The just-created item to autofocus its title for immediate editing.
  const [focusId, setFocusId] = useState<string | null>(null);
  // Which phase the "Add" buttons create into.
  const [addSegment, setAddSegment] = useState<Segment>("during");

  // Cell-tap modals. Each holds the item whose Who / Notes / Song is being
  // edited; the live item is re-derived from `items` at render so a deleted or
  // moved row closes its modal instead of showing stale data.
  const [whoItem, setWhoItem] = useState<RunSheetItem | null>(null);
  const [notesItem, setNotesItem] = useState<RunSheetItem | null>(null);
  const [songItem, setSongItem] = useState<RunSheetItem | null>(null);
  // The "When" picker is an anchored dropdown next to its pill (not a modal), so
  // it tracks both the item and the pill's measured window rect.
  const [whenMenu, setWhenMenu] = useState<{
    item: RunSheetItem;
    anchor: AnchorRect;
  } | null>(null);

  // One continuous events-os-style table (after the auto drag-grip). Widths are
  // fixed pixels; the table scrolls horizontally when it overflows the card, and
  // the flex columns (Item / Notes) absorb any leftover slack when it fits.
  const columns: GridColumn[] = useMemo(
    () => [
      { key: "item", label: "Item", width: 220, flex: 3 },
      { key: "when", label: "When", width: 104 },
      { key: "time", label: "Time", width: 96, align: "center" },
      { key: "dur", label: "Dur", width: 84, align: "center" },
      { key: "who", label: "Owner / Role", width: 176 },
      { key: "notes", label: "Notes", width: 240, flex: 3 },
      { key: "song", label: "Song", width: 150 },
      { key: "actions", label: "", width: 64, align: "center" },
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

  // Flat rows for the single table, ordered by phase (before → during → after)
  // then existing sequence. There are no heading rows: a row's phase lives in the
  // "When" column and is changed there, not by dragging.
  const rows = useMemo(
    () =>
      itemsBySegment.before.concat(itemsBySegment.during, itemsBySegment.after),
    [itemsBySegment],
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
  const whenLive = whenMenu
    ? (items?.find((i) => i._id === whenMenu.item._id) ?? null)
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
        <TouchableOpacity onPress={handleBack} hitSlop={12} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Run sheet</Text>
        {/* Entry point to the leader Event Tasks "database view" for this plan.
            Shown only when the community has opted into Event Tasks; the Tasks
            screen itself re-checks the flag + leader role. */}
        {eventTasksEnabled ? (
          <TouchableOpacity
            onPress={() =>
              router.push(`/rostering/${group_id}/tasks/${planId}` as never)
            }
            hitSlop={12}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Event tasks"
          >
            <Ionicons name="checkbox-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
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

          // One continuous events-os-style table. Each row's phase is the "When"
          // column (no heading rows). renderCell returns cell CONTENT only — the
          // primitive draws the sized, padded cell frame.
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
              case "when": {
                const short =
                  SEGMENT_OPTIONS.find((s) => s.key === item.segment)?.short ??
                  "During";
                return (
                  <WhenPill
                    label={short}
                    colors={colors}
                    primaryColor={primaryColor}
                    onOpen={(anchor) => setWhenMenu({ item, anchor })}
                  />
                );
              }
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
                return (
                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={() => handleDuplicate(item._id)}
                      hitSlop={6}
                      style={styles.actionBtn}
                      accessibilityLabel="Duplicate"
                    >
                      <Ionicons name="copy-outline" size={16} color={colors.textTertiary} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(item)}
                      hitSlop={6}
                      style={styles.actionBtn}
                      accessibilityLabel="Delete"
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.destructive} />
                    </Pressable>
                  </View>
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
              ListHeaderComponent={listHeader}
              // The add controls are fixed below the table card, so they carry
              // the bottom safe-area inset here (the rows scroll inside the card).
              ListFooterComponent={
                <View style={{ paddingBottom: insets.bottom + 8 }}>
                  {listFooter}
                </View>
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

      {/* When picker — an anchored dropdown next to the pill that moves the row
          between the before / during / after phases. */}
      {whenMenu && whenLive ? (
        <AnchoredMenu
          anchor={whenMenu.anchor}
          options={SEGMENT_OPTIONS.map((s) => ({ id: s.key, name: s.label }))}
          selectedId={whenLive.segment}
          onSelect={(id) => {
            if (id) patchItem(whenLive._id, { segment: id as Segment });
            setWhenMenu(null);
          }}
          onClose={() => setWhenMenu(null)}
        />
      ) : null}
    </View>
  );
}

/**
 * The "When" phase pill. Measures its own window rect on press so the parent can
 * anchor the dropdown next to it (the pill can't hold the menu itself — the
 * table card clips overflow).
 */
function WhenPill({
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
      accessibilityLabel={`When: ${label}. Tap to change.`}
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

/**
 * Who's-involved editor body (roles multi-select).
 *
 * Seeds a local Set from the item's current assignments so rapid toggles
 * compound instead of each restarting from the last server-synced value (which
 * lags a mutation round-trip). Remounted per item via a `key` at the call site,
 * so it re-seeds whenever a different row's modal opens.
 */
function WhoModalBody({
  item,
  roleOptions,
  onPatch,
}: {
  item: RunSheetItem;
  roleOptions: RoleOption[];
  onPatch: (patch: ItemPatch) => void;
}) {
  const { colors } = useTheme();
  const [linked, setLinked] = useState<Set<string>>(
    () => new Set(item.assignments.map((a) => a.roleId as string)),
  );

  const toggle = (roleId: string) => {
    const next = new Set(linked);
    if (next.has(roleId)) next.delete(roleId);
    else next.add(roleId);
    setLinked(next);
    onPatch({
      assignments: [...next].map((id) => ({ roleId: id as Id<"teamRoles"> })),
    });
  };

  if (roleOptions.length === 0) {
    return (
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        No roles are defined for this event yet.
      </Text>
    );
  }

  return (
    <View style={styles.roleWrap}>
      {roleOptions.map((r) => {
        const selected = linked.has(r.roleId as string);
        const swatch = r.roleColor ?? DEFAULT_ROLE_COLOR;
        return (
          <Pressable
            key={r.roleId}
            onPress={() => toggle(r.roleId as string)}
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
              <Text
                style={[styles.roleChipText, { color: colors.text }]}
                numberOfLines={1}
              >
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
  );
}

/**
 * Notes editor body — the item's timing phase, free-text description, and the
 * role-categorized cue notes. This is where the old expanded "Timing",
 * "Description", and "Notes" fields now live.
 */
function NotesModalBody({
  item,
  onPatch,
}: {
  item: RunSheetItem;
  onPatch: (patch: ItemPatch) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.modalStack}>
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

      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        Description
      </Text>
      <InlineText
        value={item.description ?? ""}
        onSave={(d) => onPatch({ description: d })}
        placeholder="Optional details for this moment"
        multiline
        accessibilityLabel="Item description"
        style={[styles.descInput, { color: colors.text, borderColor: colors.border }]}
      />

      <NotesEditor
        notes={item.notes}
        onChange={(notes) => onPatch({ notes })}
        colors={colors}
      />
    </View>
  );
}

/**
 * Song editor body — links the row to a library song (ADR-027) and edits the
 * per-service Key / BPM overrides. When a song is linked, Key/BPM show only the
 * override (blank if none), placeholder is the song's default.
 */
function SongModalBody({
  item,
  communityId,
  groupId,
  onPatch,
}: {
  item: RunSheetItem;
  communityId: string;
  groupId: string;
  onPatch: (patch: ItemPatch) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.modalStack}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Song</Text>
      <SongPicker
        communityId={communityId}
        groupId={groupId}
        songId={item.songId}
        song={item.song}
        onSelect={(songId) => onPatch({ songId: songId as Id<"songs"> | null })}
      />

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
    </View>
  );
}

// RN-Web draws a browser focus ring on the underlying <input> that visually
// bleeds past this tiny cell; suppress it so the input stays fully contained.
const webNoOutline: TextStyle | undefined =
  Platform.OS === "web"
    ? ({ outlineStyle: "none" } as unknown as TextStyle)
    : undefined;

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
      style={[
        styles.durationInput,
        { color: colors.text, borderColor: colors.border },
        webNoOutline,
      ]}
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
  gridContent: { paddingBottom: 8 },
  planTitle: { fontSize: 22, fontWeight: "700" },
  planDate: { fontSize: 13, marginTop: 4 },
  ranges: { fontSize: 14, fontWeight: "600", marginTop: 8 },
  emptyText: { fontSize: 14, lineHeight: 20, marginTop: 24 },
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
  titleInput: { fontSize: 15, fontWeight: "600", width: "100%" },
  headerTitleInput: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  durationInput: {
    width: 60,
    alignSelf: "center",
    fontSize: 13,
    textAlign: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  actionBtn: { padding: 4 },
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
  // Grid cell content. The primitive draws the padded cell frame; these only
  // style the content that sits inside it.
  cellPressable: { flex: 1, justifyContent: "center" },
  cellText: { fontSize: 13 },
  muted: { fontSize: 13, fontWeight: "500" },
  whoChips: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  // Wraps an OptionTag that opens an anchored menu (self-aligned so it hugs its
  // content and can be measured for the dropdown anchor).
  tagPressable: { alignSelf: "flex-start", maxWidth: "100%" },
  // "Time" — a quiet, contained read-only clock value ("9:00 AM").
  timeText: { fontSize: 13, fontVariant: ["tabular-nums"] },
  actionsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  modalStack: { gap: 4 },
});
