/**
 * NativeRunSheetView
 *
 * Read-only run sheet display for the leader-tools "Run Sheet" tool when a
 * group's `runSheetConfig.source === "native"` (ADR-026). It shows the group's
 * upcoming event plan run sheets — a tab per upcoming plan (mirroring the PCO
 * tool's service-type tabs), then the selected plan's items, timed from the
 * earliest service start with each service shown as a range.
 *
 * Authoring happens in Rostering; leaders get an "Edit" shortcut into the
 * native editor. This view only reads existing native queries (listEvents /
 * getEvent / eventItems.listItems) — no new backend.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useConnectionStatus } from "@providers/ConnectionProvider";
import { useServingRunSheetCache } from "@/stores/servingRunSheetCache";
import { DEFAULT_ROLE_COLOR, formatEventDate } from "@features/scheduling/utils/format";
import {
  computeSegmentedClockTimes,
  formatClockTime,
  formatDuration,
  formatServiceRanges,
  pickActiveServiceIndex,
  totalDurationSec,
} from "@features/scheduling/utils/runSheetTiming";
import { ServiceTimeSelector } from "@features/scheduling/components/ServiceTimeSelector";
import { renderTextWithLinks } from "../utils/runSheetLinks";

/** Current-item highlight, mirroring the PCO run sheet (RunSheetScreen). */
const CURRENT_ITEM_BG_LIGHT = "#FFF9E6";
const CURRENT_ITEM_BG_DARK = "#2a2700";
const CURRENT_ITEM_BORDER = "#D4A017";

/** When an item happens relative to the event's service times. */
type Segment = "before" | "during" | "after";
const SEGMENT_OPTIONS: Array<{ key: Segment; label: string }> = [
  { key: "before", label: "Before event" },
  { key: "during", label: "During event" },
  { key: "after", label: "After event" },
];

type PlanSummary = {
  _id: Id<"eventPlans">;
  title: string;
  eventDate: number;
  times: Array<{ label: string; startsAt: number }>;
};

type RunSheetItem = {
  _id: Id<"eventItems">;
  segment: string;
  type: string;
  title: string;
  description: string | null;
  durationSec: number;
  notes: Array<{ category: string; content: string }>;
  songDetails: { key?: string; bpm?: number } | null;
  assignments: Array<{
    roleId: Id<"teamRoles">;
    roleName: string;
    roleColor: string | null;
  }>;
};

type EventRole = {
  roleId: Id<"teamRoles">;
  assignments: Array<{ userName: string; status: string }>;
};

export function NativeRunSheetView({
  groupId,
  canEdit,
  initialPlanId,
}: {
  groupId: Id<"groups">;
  /** Show the "Edit in Rostering" shortcut (group leaders / admins). */
  canEdit: boolean;
  /**
   * Plan to select by default (e.g. serving mode focuses the plan the user is
   * serving, rather than the group's soonest upcoming event). The user can
   * still switch tabs. Falls back to the first plan when unset.
   */
  initialPlanId?: Id<"eventPlans">;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const router = useRouter();
  const { isNetworkAvailable } = useConnectionStatus();
  // Subscribe to the cache store (not `.getState()`) so the async AsyncStorage
  // rehydration on a cold offline launch re-renders us once the saved copy lands.
  const runSheetCache = useServingRunSheetCache();

  // This tool renders inside the `(user)` route group, which is presented as
  // a modal (see app/_layout.tsx). Pushing a `/rostering/...` card from inside
  // the modal lands it *behind* the modal on iOS, so dismiss the modal stack
  // first, then navigate — same pattern as useStartDirectMessage.
  const navigateToRostering = (path: string) => {
    if (router.canDismiss?.()) router.dismissAll();
    router.push(path as never);
  };

  const plans = useAuthenticatedQuery(
    api.functions.scheduling.events.listEvents,
    { groupId },
  ) as PlanSummary[] | undefined;

  // Cache-on-load so a serving volunteer can reopen this group's plans offline.
  // The live query stays `undefined` with no radio, so we persist every fresh
  // result (stale-while-revalidate; see servingRunSheetCache / ADR-028).
  useEffect(() => {
    if (plans !== undefined) {
      useServingRunSheetCache.getState().setPlans(groupId, plans);
    }
  }, [plans, groupId]);

  // Offline fallback: when the device radio is down the query can't resolve, so
  // fall back to the last-cached plans. Web always reports online and waits for
  // live data, so `effectivePlans === plans` there (and whenever online).
  const effectivePlans =
    plans ??
    (!isNetworkAvailable
      ? ((runSheetCache.getPlansStale(groupId) as PlanSummary[] | null) ??
        undefined)
      : undefined);

  const [selectedId, setSelectedId] = useState<Id<"eventPlans"> | null>(null);
  const activePlanId =
    selectedId ?? initialPlanId ?? effectivePlans?.[0]?._id ?? null;

  if (effectivePlans === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (effectivePlans.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No upcoming event plans. Create one in Rostering to build its run
          sheet.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Upcoming-plan tabs (only when there's more than one) */}
      {effectivePlans.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {effectivePlans.map((p) => {
            const selected = p._id === activePlanId;
            return (
              <Pressable
                key={p._id}
                onPress={() => setSelectedId(p._id)}
                style={styles.tabPressable}
              >
                <View
                  style={[
                    styles.tab,
                    {
                      backgroundColor: selected
                        ? primaryColor
                        : colors.surfaceSecondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      { color: selected ? "#fff" : colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {p.title} · {formatEventDate(p.eventDate)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {activePlanId ? (
        <PlanRunSheet
          planId={activePlanId}
          groupId={groupId}
          canEdit={canEdit}
          onEdit={() => navigateToRostering(
            `/rostering/${groupId}/run-sheet/${activePlanId}`,
          )}
          onRehearse={() => navigateToRostering(
            `/rostering/${groupId}/run-sheet/rehearse/${activePlanId}`,
          )}
        />
      ) : null}
    </View>
  );
}

function PlanRunSheet({
  planId,
  groupId,
  canEdit,
  onEdit,
  onRehearse,
}: {
  planId: Id<"eventPlans">;
  groupId: Id<"groups">;
  canEdit: boolean;
  onEdit: () => void;
  /** Open the read-only musician rehearsal view for this plan (all members). */
  onRehearse: () => void;
}) {
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const { isNetworkAvailable } = useConnectionStatus();
  // Subscribe so AsyncStorage rehydration re-renders us (see NativeRunSheetView).
  const runSheetCache = useServingRunSheetCache();

  const event = useAuthenticatedQuery(
    api.functions.scheduling.events.getEvent,
    { planId },
  ) as
    | {
        title: string;
        eventDate: number;
        times: Array<{ label: string; startsAt: number }>;
        roles: EventRole[];
      }
    | null
    | undefined;

  const items = useAuthenticatedQuery(
    api.functions.scheduling.eventItems.listItems,
    { planId },
  ) as RunSheetItem[] | null | undefined;

  // Cache-on-load so this plan's header + items reopen offline. Both queries
  // stay `undefined` with no radio, so persist every fresh result
  // (stale-while-revalidate; see servingRunSheetCache / ADR-028).
  useEffect(() => {
    if (event !== undefined) {
      useServingRunSheetCache.getState().setEvent(planId, event);
    }
  }, [event, planId]);
  useEffect(() => {
    if (items !== undefined) {
      useServingRunSheetCache.getState().setItems(planId, items);
    }
  }, [items, planId]);

  // Offline fallback: when the device radio is down the queries can't resolve,
  // so fall back to the last-cached copies. Web always reports online and waits
  // for live data, so `effEvent === event` / `effItems === items` there (and
  // whenever online) — this is purely an additive read fallback.
  const effEvent =
    event ??
    (!isNetworkAvailable
      ? ((runSheetCache.getEventStale(planId) as typeof event | null) ??
        undefined)
      : undefined);
  const effItems =
    items ??
    (!isNetworkAvailable
      ? ((runSheetCache.getItemsStale(planId) as RunSheetItem[] | null) ??
        undefined)
      : undefined);

  const times = effEvent?.times ?? [];
  // Group into before / during / after phases (listItems returns them sorted
  // by (segment, sequence)), then time each phase: during from the event start,
  // before backward to it, after from the event end. Keeps clocks consistent
  // with the editor's segmented timing.
  const itemsBySegment = useMemo(() => {
    const groups: Record<Segment, RunSheetItem[]> = {
      before: [],
      during: [],
      after: [],
    };
    for (const it of effItems ?? []) {
      const seg = (it.segment as Segment) ?? "during";
      (groups[seg] ?? groups.during).push(it);
    }
    return groups;
  }, [effItems]);
  // Phase totals feed both the header ranges and the active-service window.
  const duringTotalSec = useMemo(
    () => totalDurationSec(itemsBySegment.during),
    [itemsBySegment.during],
  );
  const beforeTotalSec = useMemo(
    () => totalDurationSec(itemsBySegment.before),
    [itemsBySegment.before],
  );
  const afterTotalSec = useMemo(
    () => totalDurationSec(itemsBySegment.after),
    [itemsBySegment.after],
  );

  // Live clock: tick every 30s so the current-item highlight — and, on a
  // multi-service plan, the auto-selected service — advance as the day moves.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Which service the sheet is anchored to. `null` = follow the live service
  // (auto, day-of); a number = the user manually picked one (sticky override).
  const [manualServiceIdx, setManualServiceIdx] = useState<number | null>(null);
  const autoServiceIdx = useMemo(
    () =>
      pickActiveServiceIndex(
        times,
        now,
        beforeTotalSec,
        duringTotalSec,
        afterTotalSec,
      ),
    [times, now, beforeTotalSec, duringTotalSec, afterTotalSec],
  );
  // A manual pick can go stale if `times` shrinks (rare) — clamp it.
  const effectiveServiceIdx =
    manualServiceIdx != null && manualServiceIdx < times.length
      ? manualServiceIdx
      : autoServiceIdx;
  const serviceStartMs =
    times.length > 0 ? times[effectiveServiceIdx].startsAt : now;

  const clockTimes = useMemo(
    () =>
      computeSegmentedClockTimes(
        itemsBySegment.before,
        itemsBySegment.during,
        itemsBySegment.after,
        serviceStartMs,
      ),
    [itemsBySegment, serviceStartMs],
  );
  const peopleByRole = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of effEvent?.roles ?? []) {
      map[r.roleId as string] = r.assignments
        .filter((a) => a.status !== "declined")
        .map((a) => a.userName);
    }
    return map;
  }, [effEvent?.roles]);
  // Only surface the rehearsal shortcut when the sheet actually has songs.
  const hasSongs = useMemo(
    () => (effItems ?? []).some((it) => it.type === "song"),
    [effItems],
  );

  // Expandable rows: which items have their description/notes revealed.
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleItemExpanded = useCallback((itemId: string) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  // Collapsible sections: header ids whose following items are hidden.
  // Persisted to AsyncStorage per group (native-specific key so it never
  // collides with the PCO viewer's collapse state) and restored on reopen.
  const [collapsedHeaders, setCollapsedHeaders] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedHeadersLoaded, setCollapsedHeadersLoaded] = useState(false);
  const toggleHeaderCollapsed = useCallback((headerId: string) => {
    setCollapsedHeaders((prev) => {
      const next = new Set(prev);
      if (next.has(headerId)) next.delete(headerId);
      else next.add(headerId);
      return next;
    });
  }, []);

  const collapsedStorageKey = `native_runsheet_collapsed_${groupId}`;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(collapsedStorageKey);
        if (!cancelled && saved) {
          setCollapsedHeaders(new Set(JSON.parse(saved)));
        }
      } catch (err) {
        console.error("Failed to load collapsed state:", err);
      } finally {
        if (!cancelled) setCollapsedHeadersLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collapsedStorageKey]);
  useEffect(() => {
    // Don't persist until the initial load finishes, to avoid clobbering
    // saved state with the empty default on first render.
    if (!collapsedHeadersLoaded) return;
    AsyncStorage.setItem(
      collapsedStorageKey,
      JSON.stringify(Array.from(collapsedHeaders)),
    ).catch((err) => console.error("Failed to save collapsed state:", err));
  }, [collapsedHeaders, collapsedHeadersLoaded, collapsedStorageKey]);

  // Live "current item": match the item whose computed [start, start +
  // durationSec) window contains `now` (ticked above). Because `clockTimes` is
  // anchored to the active/selected service, this highlights the right rows on
  // every service of a multi-service plan, not just the earliest.
  const currentItemId = useMemo(() => {
    // Without real service times the clocks are anchored to `now` (the
    // serviceStartMs fallback), which would spuriously highlight the first item.
    if (times.length === 0) return null;
    const list = effItems ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.type === "header") continue;
      const start = clockTimes[it._id];
      if (start == null) continue;
      const end = start + Math.max(0, it.durationSec) * 1000;
      if (now >= start && now < end) return it._id;
    }
    return null;
  }, [effItems, clockTimes, now, times.length]);

  if (effEvent === undefined || effItems === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }
  if (!effEvent || !effItems) {
    return (
      <View style={styles.centered}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          This run sheet is unavailable.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.sheet}>
      <View style={styles.sheetHeader}>
        <View style={styles.sheetHeaderText}>
          <Text style={[styles.planTitle, { color: colors.text }]}>
            {effEvent.title}
          </Text>
          {times.length > 0 ? (
            <Text style={[styles.ranges, { color: colors.textSecondary }]}>
              {formatServiceRanges(times, duringTotalSec)}
            </Text>
          ) : null}
        </View>
        <View style={styles.sheetHeaderActions}>
          {hasSongs ? (
            <Pressable
              onPress={onRehearse}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Rehearse songs"
            >
              <View style={styles.editRow}>
                <Ionicons
                  name="musical-notes-outline"
                  size={16}
                  color={primaryColor}
                />
                <Text style={[styles.editText, { color: primaryColor }]}>
                  Rehearse
                </Text>
              </View>
            </Pressable>
          ) : null}
          {canEdit ? (
            <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button">
              <View style={styles.editRow}>
                <Ionicons name="create-outline" size={16} color={primaryColor} />
                <Text style={[styles.editText, { color: primaryColor }]}>
                  Edit
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ServiceTimeSelector
        times={times}
        selectedIndex={effectiveServiceIdx}
        following={manualServiceIdx == null}
        onSelect={setManualServiceIdx}
        onResetToLive={() => setManualServiceIdx(null)}
      />

      {effItems.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          This event plan's run sheet is empty.
        </Text>
      ) : (
        SEGMENT_OPTIONS.map((seg) => {
          const segItems = itemsBySegment[seg.key];
          if (segItems.length === 0) return null;
          // Hide items that follow a collapsed header (positional: a header
          // owns the rows after it until the next header in the segment).
          const visibleItems = filterVisible(segItems, collapsedHeaders);
          return (
            <View key={seg.key}>
              <Text style={[styles.segmentLabel, { color: colors.textSecondary }]}>
                {seg.label.toUpperCase()}
              </Text>
              {visibleItems.map((item) => (
                <ReadOnlyRow
                  key={item._id}
                  item={item}
                  clockMs={clockTimes[item._id]}
                  peopleByRole={peopleByRole}
                  colors={colors}
                  isDark={isDark}
                  isCurrent={item._id === currentItemId}
                  isExpanded={expandedItemIds.has(item._id)}
                  onToggleExpand={() => toggleItemExpanded(item._id)}
                  isCollapsed={collapsedHeaders.has(item._id)}
                  onToggleCollapse={() => toggleHeaderCollapsed(item._id)}
                />
              ))}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

/**
 * Drop items that follow a collapsed header. Headers are always kept; a
 * collapsed header hides every non-header row until the next header. The
 * association is positional within the segment's ordered item list.
 */
function filterVisible(
  segItems: RunSheetItem[],
  collapsedHeaders: Set<string>,
): RunSheetItem[] {
  const out: RunSheetItem[] = [];
  let hidden = false;
  for (const it of segItems) {
    if (it.type === "header") {
      hidden = collapsedHeaders.has(it._id as string);
      out.push(it);
    } else if (!hidden) {
      out.push(it);
    }
  }
  return out;
}

function ReadOnlyRow({
  item,
  clockMs,
  peopleByRole,
  colors,
  isDark,
  isCurrent,
  isExpanded,
  onToggleExpand,
  isCollapsed,
  onToggleCollapse,
}: {
  item: RunSheetItem;
  clockMs: number | null;
  peopleByRole: Record<string, string[]>;
  colors: ReturnType<typeof useTheme>["colors"];
  isDark: boolean;
  isCurrent: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const isHeader = item.type === "header";
  const duration = formatDuration(item.durationSec);

  if (isHeader) {
    // Collapsible section header — tap the chevron/title to fold its rows.
    return (
      <Pressable
        onPress={onToggleCollapse}
        style={styles.headerRow}
        accessibilityRole="button"
        accessibilityState={{ expanded: !isCollapsed }}
      >
        <Ionicons
          name={isCollapsed ? "chevron-forward" : "chevron-down"}
          size={16}
          color={colors.textSecondary}
        />
        <Text
          style={[styles.headerText, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {item.title.toUpperCase()}
        </Text>
        {clockMs != null ? (
          <Text style={[styles.headerTime, { color: colors.textTertiary }]}>
            {formatClockTime(clockMs)}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  const hasNotes = item.notes.length > 0;
  const hasDescription = !!item.description && item.description.trim().length > 0;
  const hasExpandableContent = hasDescription || hasNotes;

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.surfaceSecondary },
        isCurrent && {
          backgroundColor: isDark ? CURRENT_ITEM_BG_DARK : CURRENT_ITEM_BG_LIGHT,
          borderLeftColor: CURRENT_ITEM_BORDER,
          borderLeftWidth: 4,
        },
      ]}
    >
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
      <View style={styles.content}>
        {/* Summary row — tapping toggles the description/notes when present. */}
        <Pressable
          onPress={hasExpandableContent ? onToggleExpand : undefined}
          style={styles.titleRow}
          accessibilityRole={hasExpandableContent ? "button" : undefined}
          accessibilityState={
            hasExpandableContent ? { expanded: isExpanded } : undefined
          }
        >
          <Text style={[styles.itemTitle, { color: colors.text }]}>
            {item.title}
          </Text>
          {hasExpandableContent ? (
            <Ionicons
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.textTertiary}
            />
          ) : null}
        </Pressable>
        {item.type === "song" && item.songDetails?.key ? (
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            Key {item.songDetails.key}
            {item.songDetails.bpm ? ` · ${item.songDetails.bpm} BPM` : ""}
          </Text>
        ) : null}
        {item.assignments.length > 0 ? (
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
        {/* Collapsed preview — a truncated description + note teaser so the
            content stays glanceable without expanding (mirrors the PCO
            renderer's collapsed row). Full text + rich link previews render
            once expanded. */}
        {!isExpanded && hasDescription ? (
          <Text
            style={[styles.desc, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {item.description}
          </Text>
        ) : null}
        {!isExpanded && hasNotes ? (
          <Text
            style={[styles.notePreview, { color: colors.textTertiary }]}
            numberOfLines={2}
          >
            {item.notes[0].category ? `${item.notes[0].category}: ` : ""}
            {item.notes[0].content}
          </Text>
        ) : null}
        {/* Expanded content lives OUTSIDE the Pressable so links stay tappable
            and text stays selectable (same pattern as the PCO renderer). */}
        {isExpanded ? (
          <View style={styles.expanded}>
            {hasDescription
              ? renderTextWithLinks(
                  item.description!,
                  [styles.desc, { color: colors.textSecondary }],
                  colors.link,
                )
              : null}
            {item.notes.map((n, i) => (
              <View key={i} style={styles.noteBlock}>
                {n.category ? (
                  <Text style={[styles.noteCategory, { color: colors.textTertiary }]}>
                    {n.category}
                  </Text>
                ) : null}
                {renderTextWithLinks(
                  n.content,
                  [styles.note, { color: colors.textSecondary }],
                  colors.link,
                )}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  tabs: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tabPressable: { borderRadius: 999 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, maxWidth: 220 },
  tabText: { fontSize: 13, fontWeight: "600" },
  sheet: { padding: 16, gap: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  sheetHeaderText: { flex: 1 },
  sheetHeaderActions: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  planTitle: { fontSize: 20, fontWeight: "700" },
  ranges: { fontSize: 13, fontWeight: "600", marginTop: 4 },
  segmentLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginTop: 14,
    marginBottom: 6,
  },
  editRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 4 },
  editText: { fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", gap: 10, borderRadius: 12, padding: 12, marginTop: 4 },
  timeCol: { width: 64 },
  timeText: { fontSize: 14, fontWeight: "700" },
  durationText: { fontSize: 11, marginTop: 1 },
  content: { flex: 1, gap: 4 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  itemTitle: { fontSize: 15, fontWeight: "600", flex: 1 },
  meta: { fontSize: 12 },
  expanded: { marginTop: 4, gap: 6 },
  notePreview: { fontSize: 12, lineHeight: 16, fontStyle: "italic" },
  noteBlock: { gap: 2 },
  noteCategory: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
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
  desc: { fontSize: 13, lineHeight: 18 },
  note: { fontSize: 12, lineHeight: 16 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  headerText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, flex: 1 },
  headerTime: { fontSize: 11, fontWeight: "600" },
});
