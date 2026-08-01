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
import { useWhatsappShell } from "@hooks/useWhatsappShell";
import {
  WA_CELL_MIN_HEIGHT,
  WA_CELL_PADDING,
  WA_GROUP_RADIUS,
  WA_GROUP_SPACING,
  WA_SECTION_HEADER_GAP,
  WA_SECTION_LABEL_SIZE,
  WA_TYPE_FOOTNOTE,
  WA_TYPE_HEADER_BLOCK,
  WA_TYPE_ROW_TITLE,
  WA_TYPE_SUBTITLE,
  WA_WEIGHT_BOLD,
  WA_WEIGHT_REGULAR,
  WA_WEIGHT_SEMIBOLD,
  waRoleInk,
} from "@components/wa";
import { useAuth } from "@providers/AuthProvider";
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
import {
  runSheetItemMatchesViewer,
  segmentHasContentForViewer,
} from "@features/scheduling/utils/runSheetViewerFilter";
import { ServiceTimeSelector } from "@features/scheduling/components/ServiceTimeSelector";
import { renderTextWithLinks } from "../utils/runSheetLinks";

/** "All" / "Mine" run sheet filter (stakeholder request — see runSheetViewerFilter.ts). */
type ViewMode = "all" | "mine";
const VIEW_MODE_OPTIONS: Array<{ key: ViewMode; label: string }> = [
  { key: "all", label: "All" },
  { key: "mine", label: "Mine" },
];

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
  assignments: Array<{ userId: Id<"users">; userName: string; status: string }>;
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
  // Flag-on restyle only — see the `waStyles` block at the bottom of this file.
  const wa = useWhatsappShell();
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

  // §1 canvas. This component OWNS the leader-tools canvas, so flag-on it
  // paints `bg.grouped` and lets its cards/pills be `bg.card` — the inset-
  // grouped pairing the rest of the flag-on app uses (YouScreen,
  // AttendanceScreen, GroupInfoScreen). On the flag-off `background` canvas
  // a white pill was literally invisible (1.00:1 fill-vs-canvas in default
  // light) and the rows sat at 1.03–1.09:1; on `backgroundGrouped` they read
  // at 1.12–1.47:1 across all four palettes.
  const canvas = wa ? colors.backgroundGrouped : colors.background;

  if (effectivePlans === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: canvas }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (effectivePlans.length === 0) {
    return (
      <View style={[styles.centered, { backgroundColor: canvas }]}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text
          style={[
            styles.emptyText,
            wa && waStyles.emptyText,
            { color: colors.textSecondary },
          ]}
        >
          No upcoming event plans. Create one in Rostering to build its run
          sheet.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: canvas }]}>
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
                    wa && waStyles.tab,
                    // §7 pill vocabulary: selected = accent fill; unselected =
                    // card fill + a 1px separator border, never a gray blob.
                    wa
                      ? selected
                        ? { backgroundColor: primaryColor, borderColor: primaryColor }
                        : {
                            backgroundColor: colors.surface,
                            borderColor: colors.separator,
                          }
                      : {
                          backgroundColor: selected
                            ? primaryColor
                            : colors.surfaceSecondary,
                        },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      wa && waStyles.tabText,
                      wa
                        ? { color: selected ? colors.onAccent : colors.text }
                        : { color: selected ? "#fff" : colors.textSecondary },
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
          key={activePlanId}
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

export function PlanRunSheet({
  planId,
  groupId,
  canEdit,
  onEdit,
  onRehearse,
  embedded = false,
}: {
  planId: Id<"eventPlans">;
  groupId: Id<"groups">;
  canEdit: boolean;
  onEdit: () => void;
  /** Open the read-only musician rehearsal view for this plan (all members). */
  onRehearse: () => void;
  /**
   * When true, render the sheet body as a plain `View` instead of its own
   * `ScrollView`, so the component can be stacked inside a parent scroll
   * container (the serving Runsheet tab shows one sheet per plan). Defaults to
   * false — the standalone leader-tools usage keeps its own scroll.
   */
  embedded?: boolean;
}) {
  const { colors, isDark } = useTheme();
  const { primaryColor } = useCommunityTheme();
  // Flag-on restyle only — see the `waStyles` block at the bottom of this file.
  const wa = useWhatsappShell();
  const { isNetworkAvailable } = useConnectionStatus();
  const { user } = useAuth();
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
  // Guard the upper bound so a manual pick that outran a shrunk `times` falls
  // back to auto. (A reorder that keeps the length isn't tracked — editing
  // service times mid-serving is rare enough to accept.)
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

  // "All / Mine" filter (per-instance state — each stacked plan section in
  // serving mode's Runsheet tab gets its own PlanRunSheet, so this never
  // leaks across sections). The viewer's roles on THIS plan are derived from
  // the same `event.roles` already loaded above — no extra query.
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const viewerRoleIds = useMemo(() => {
    const ids = new Set<string>();
    if (!user?.id) return ids;
    for (const r of effEvent?.roles ?? []) {
      const holds = r.assignments.some(
        (a) => a.userId === user.id && a.status !== "declined",
      );
      if (holds) ids.add(r.roleId as string);
    }
    return ids;
  }, [effEvent?.roles, user?.id]);
  const hasAnyViewerRole = viewerRoleIds.size > 0;
  // Whether "Mine" has anything to show at all — distinct from `hasAnyViewerRole`
  // because a viewer can hold a role on the plan that no run sheet item is
  // actually tagged with (e.g. scheduled for sound, but sound has no rows yet).
  const mineHasContent = useMemo(() => {
    if (viewMode !== "mine") return true;
    return segmentHasContentForViewer(effItems ?? [], viewerRoleIds);
  }, [viewMode, effItems, viewerRoleIds]);
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
        <Text
          style={[
            styles.emptyText,
            wa && waStyles.emptyText,
            { color: colors.textSecondary },
          ]}
        >
          This run sheet is unavailable.
        </Text>
      </View>
    );
  }

  const Root = embedded ? View : ScrollView;
  // No flag-on override: `WA_GROUP_MARGIN`/`WA_SECTION_HEADER_GAP` are 16/8,
  // exactly what `styles.sheet` already is.
  const sheetStyle = [styles.sheet];
  const rootProps = embedded
    ? { style: sheetStyle }
    : { contentContainerStyle: sheetStyle };
  return (
    <Root {...(rootProps as object)}>
      <View style={styles.sheetHeader}>
        <View style={styles.sheetHeaderText}>
          {/* Embedded, the wrapper (`ServingRunsheetScreen`) already renders
              this exact string as its own section header. Flag-off the two
              are different type roles — 16/700 there, 20/700 here — so the
              pair reads as a header plus a subheader and both stay. Flag-on
              they'd both be 20pt/600: the same string twice, at the same
              size, directly stacked. Drop ours; the wrapper's is the one
              carrying the date and the campus/teams subtitle. */}
          {wa && embedded ? null : (
            <Text
              style={[styles.planTitle, wa && waStyles.planTitle, { color: colors.text }]}
            >
              {effEvent.title}
            </Text>
          )}
          {times.length > 0 ? (
            <Text
              style={[
                styles.ranges,
                wa && waStyles.ranges,
                { color: colors.textSecondary },
              ]}
            >
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
                <Text
                  style={[
                    styles.editText,
                    wa && waStyles.editText,
                    { color: primaryColor },
                  ]}
                >
                  Rehearse
                </Text>
              </View>
            </Pressable>
          ) : null}
          {canEdit ? (
            <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button">
              <View style={styles.editRow}>
                <Ionicons name="create-outline" size={16} color={primaryColor} />
                <Text
                  style={[
                    styles.editText,
                    wa && waStyles.editText,
                    { color: primaryColor },
                  ]}
                >
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
        <Text
          style={[
            styles.emptyText,
            wa && waStyles.emptyText,
            { color: colors.textSecondary },
          ]}
        >
          This event plan's run sheet is empty.
        </Text>
      ) : (
        <>
          <View style={styles.viewModeRow}>
            {VIEW_MODE_OPTIONS.map((opt) => {
              const selected = viewMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setViewMode(opt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Show ${opt.label.toLowerCase()} run sheet items`}
                >
                  <View
                    style={[
                      styles.viewModePill,
                      wa && waStyles.viewModePill,
                      // §7 pill vocabulary: selected = accent fill; unselected =
                      // card fill + a 1px separator border, never a gray blob.
                      wa
                        ? selected
                          ? { backgroundColor: primaryColor, borderColor: primaryColor }
                          : {
                              backgroundColor: colors.surface,
                              borderColor: colors.separator,
                            }
                        : {
                            backgroundColor: selected
                              ? primaryColor
                              : colors.surfaceSecondary,
                          },
                    ]}
                  >
                    <Text
                      style={[
                        styles.viewModeText,
                        wa && waStyles.viewModeText,
                        wa
                          ? { color: selected ? colors.onAccent : colors.text }
                          : {
                              color: selected
                                ? colors.textInverse
                                : colors.textSecondary,
                            },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {viewMode === "mine" && !mineHasContent ? (
            <View style={styles.mineEmptyState}>
              <Ionicons name="person-outline" size={22} color={colors.textTertiary} />
              <Text
                style={[
                  styles.emptyText,
                  wa && waStyles.emptyText,
                  { color: colors.textSecondary },
                ]}
              >
                {hasAnyViewerRole
                  ? "None of the run sheet items are tagged with your roles yet."
                  : "You're not assigned a role on this plan yet."}
              </Text>
            </View>
          ) : (
            SEGMENT_OPTIONS.map((seg) => {
              const segItems = itemsBySegment[seg.key];
              const modeItems =
                viewMode === "mine"
                  ? segItems.filter((it) => runSheetItemMatchesViewer(it, viewerRoleIds))
                  : segItems;
              if (modeItems.length === 0) return null;
              // In "Mine", a segment whose only matches are headers has no
              // actual content to show — skip the whole segment rather than
              // render a label + bare header row (see runSheetViewerFilter).
              if (
                viewMode === "mine" &&
                !segmentHasContentForViewer(segItems, viewerRoleIds)
              ) {
                return null;
              }
              // Hide items that follow a collapsed header (positional: a header
              // owns the rows after it until the next header in the segment).
              const visibleItems = filterVisible(modeItems, collapsedHeaders);
              return (
                <View key={seg.key}>
                  <Text
                    style={[
                      styles.segmentLabel,
                      wa && waStyles.segmentLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {/* §3.2/S3.5: the ALL-CAPS letter-spaced section label is
                        dead — sentence-case gray, verbatim, flag-on. */}
                    {wa ? seg.label : seg.label.toUpperCase()}
                  </Text>
                  {visibleItems.map((item) => (
                    <ReadOnlyRow
                      key={item._id}
                      item={item}
                      clockMs={clockTimes[item._id]}
                      peopleByRole={peopleByRole}
                      colors={colors}
                      isDark={isDark}
                      wa={wa}
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
        </>
      )}
    </Root>
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
  wa,
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
  /** Which theme is painting, so `waRoleInk` can pick the readable band. */
  isDark: boolean;
  /** `whatsapp-shell` flag — restyle only, never a behavior branch. */
  wa: boolean;
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
        style={[styles.headerRow, wa && waStyles.headerRow]}
        accessibilityRole="button"
        accessibilityState={{ expanded: !isCollapsed }}
      >
        <Ionicons
          name={isCollapsed ? "chevron-forward" : "chevron-down"}
          size={16}
          color={colors.textSecondary}
        />
        <Text
          style={[
            styles.headerText,
            wa && waStyles.headerText,
            { color: colors.textSecondary },
          ]}
          numberOfLines={1}
        >
          {/* §3.2/S3.5: sentence-case section labels, never ALL-CAPS. */}
          {wa ? item.title : item.title.toUpperCase()}
        </Text>
        {clockMs != null ? (
          <Text
            style={[
              styles.headerTime,
              wa && waStyles.headerTime,
              { color: colors.textTertiary },
            ]}
          >
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
        wa && waStyles.row,
        // §1 `bg.card` flag-on: both consumers now paint a `bg.grouped`
        // canvas, so the row is a real inset-grouped card instead of a
        // 1.03–1.09:1 ghost of one.
        { backgroundColor: wa ? colors.surfaceGrouped : colors.surfaceSecondary },
        // Live "happening now" highlight, mirroring the PCO run sheet
        // (RunSheetScreen). Theme-sourced so light/dark comes from the palette
        // rather than an `isDark` branch on module-level hex constants.
        //
        // Flag-on the leading strip is a separate inset view, not a border —
        // see `waStyles.currentStrip`. Flag-off keeps the 4pt border on its
        // 12pt radius, where it still reads as a strip.
        isCurrent &&
          (wa
            ? { backgroundColor: colors.runSheetCurrentItem }
            : {
                backgroundColor: colors.runSheetCurrentItem,
                borderLeftColor: colors.runSheetCurrentItemAccent,
                borderLeftWidth: 4,
              }),
      ]}
    >
      {wa && isCurrent ? (
        <View
          style={[
            waStyles.currentStrip,
            { backgroundColor: colors.runSheetCurrentItemAccent },
          ]}
        />
      ) : null}
      <View style={styles.timeCol}>
        <Text
          style={[styles.timeText, wa && waStyles.timeText, { color: colors.text }]}
        >
          {clockMs != null ? formatClockTime(clockMs) : "—"}
        </Text>
        {duration ? (
          <Text
            style={[
              styles.durationText,
              wa && waStyles.durationText,
              { color: colors.textTertiary },
            ]}
          >
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
          <Text
            style={[styles.itemTitle, wa && waStyles.itemTitle, { color: colors.text }]}
          >
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
          <Text
            style={[
              styles.meta,
              wa && waStyles.meta,
              { color: colors.textSecondary },
            ]}
          >
            Key {item.songDetails.key}
            {item.songDetails.bpm ? ` · ${item.songDetails.bpm} BPM` : ""}
          </Text>
        ) : null}
        {item.assignments.length > 0 ? (
          <View style={[styles.assignWrap, wa && waStyles.assignWrap]}>
            {item.assignments.map((a) => {
              const names = peopleByRole[a.roleId as string] ?? [];
              const roleColor = a.roleColor ?? DEFAULT_ROLE_COLOR;
              const people = names.length > 0 ? `: ${names.join(", ")}` : "";
              // §7 bans a colored pill as a taxonomy device ("never a colored
              // pill sitting where WhatsApp puts a timestamp/badge"), which is
              // exactly what the flag-off chip is — a translucent `roleColor`
              // fill plus a swatch. Flag-on it becomes what §7 does sanction:
              // "plain descriptive text in the subtitle line". The role's own
              // hue survives as TEXT INK, which is how WhatsApp itself carries
              // a per-entity identity (§5/§1.3 group-chat sender names:
              // colored semibold text, no container, never the brand accent) —
              // so a volunteer still finds their role by color, and it's the
              // same hue their leader picked in Rostering.
              //
              // The RAW swatch hex can't be that ink: `ROLE_COLORS` was picked
              // to read as a fill, and 8 of its 9 values fail WCAG AA as 15pt
              // text (amber `#FFB224` at 1.65:1 light, violet `#6E56CF` at
              // 2.83:1 dark). `waRoleInk` keeps the author's HUE and re-lights
              // it per theme so every value clears 4.5:1 — see waRoleInk.ts.
              if (wa) {
                return (
                  <Text
                    key={a.roleId}
                    style={[waStyles.assignText, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    <Text
                      style={[
                        waStyles.assignRole,
                        { color: waRoleInk(roleColor, isDark) },
                      ]}
                    >
                      {a.roleName}
                    </Text>
                    {people}
                  </Text>
                );
              }
              return (
                <View
                  key={a.roleId}
                  style={[styles.assignChip, { backgroundColor: roleColor + "22" }]}
                >
                  <View style={[styles.assignSwatch, { backgroundColor: roleColor }]} />
                  <Text style={[styles.assignText, { color: colors.text }]} numberOfLines={1}>
                    {a.roleName}
                    {people}
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
            style={[styles.desc, wa && waStyles.desc, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {item.description}
          </Text>
        ) : null}
        {!isExpanded && hasNotes ? (
          <Text
            style={[
              styles.notePreview,
              wa && waStyles.notePreview,
              { color: colors.textTertiary },
            ]}
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
                  [styles.desc, wa && waStyles.desc, { color: colors.textSecondary }],
                  colors.link,
                )
              : null}
            {item.notes.map((n, i) => (
              <View key={i} style={styles.noteBlock}>
                {n.category ? (
                  <Text
                    style={[
                      styles.noteCategory,
                      wa && waStyles.noteCategory,
                      { color: colors.textTertiary },
                    ]}
                  >
                    {n.category}
                  </Text>
                ) : null}
                {renderTextWithLinks(
                  n.content,
                  [styles.note, wa && waStyles.note, { color: colors.textSecondary }],
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
  viewModeRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  viewModePill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  viewModeText: { fontSize: 13, fontWeight: "600" },
  mineEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
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

/**
 * `whatsapp-shell` (flag-on) style overrides — applied as
 * `style={[styles.x, wa && waStyles.x]}` so flag-off renders `styles`
 * byte-for-byte and only flag-on picks these up.
 *
 * This is a SKIN, not a restructure (README §9.5: serving mode is "shared
 * between shells, not forked"). Every affordance, handler, offline fallback
 * and the `canEdit` Edit/Rehearse shortcuts are untouched — this view is
 * shared by the leader-tools Run Sheet tool (`RunSheetToolScreen`, `canEdit`
 * true for leaders/admins) and serving mode's Runsheet tab
 * (`ServingRunsheetScreen`, `canEdit={false}`, embedded), and both get the
 * same treatment. What changes is the vocabulary
 * (WHATSAPP-DESIGN-SYSTEM.md §7's four primitives — rows, inset-grouped
 * cells, bubbles, pills):
 *
 *  - **Role chips are gone.** The flag-off `assignChip` is a translucent
 *    `roleColor` fill + swatch behind the role name — the colored taxonomy
 *    chip §7 bans outright. Flag-on the container disappears and each
 *    assignment becomes one plain subtitle line (§7's sanctioned "plain
 *    descriptive text"), with the role's own hue kept as text ink the way
 *    WhatsApp colors group-chat sender names (§5/§1.3): colored semibold
 *    text, no fill. The people stay in `text.secondary`. The ink is derived
 *    through `waRoleInk` rather than used raw — the authored swatch hexes
 *    read as fills, not as 15pt type, and 8 of the 9 fail WCAG AA if painted
 *    straight onto a row (see waRoleInk.ts for the numbers and for why we
 *    kept the authored hue instead of hashing onto `WA_SENDER_HUES`).
 *  - ALL-CAPS labels are dead (§3.2/S3.5). Segment labels and item header
 *    rows become sentence-case 15pt gray; note categories lose
 *    `textTransform` and letter-spacing. The `toUpperCase()` calls are
 *    dropped at their call sites, not here.
 *  - The All/Mine filter and the plan tabs move onto §7's pill vocabulary:
 *    selected = accent fill with `onAccent` ink; unselected = card fill with
 *    a 1px `separator` border, not a gray `surfaceSecondary` blob.
 *  - Rows take §3.2 cell anatomy — 24pt radius, 16pt padding, 54pt minimum
 *    height — and §1's `bg.card` fill on a `bg.grouped` canvas. Both halves
 *    of that pairing are set here: `NativeRunSheetView`'s own container owns
 *    the leader-tools canvas, and `ServingRunsheetScreen`'s ScrollView (which
 *    this file's other consumer already skins) owns serving mode's. On the
 *    flag-off `background` canvas the card fill was a ghost — 1.09:1 in
 *    default light, 1.03:1 in Knicks light — and an unselected white pill was
 *    invisible outright at 1.00:1. Grouped, they land at 1.12–1.47:1 in all
 *    four palettes.
 *  - Type moves onto the S7 scale (20 / 17 / 15 / 13) — the pre-pass sizes
 *    ran "1–2pt small and one weight light throughout".
 *  - Italics (`notePreview`) aren't in the system at all.
 *
 * The now-playing highlight keeps its amber: it's a transient state marker,
 * not a category color, so §7's chip ban doesn't reach it, and §1.3 reserves
 * the accent for selection/positive states.
 */
const waStyles = StyleSheet.create({
  emptyText: { fontSize: WA_TYPE_SUBTITLE, lineHeight: 21 },

  // Plan tabs + All/Mine — §7 pill vocabulary (fills set at the call sites).
  // `styles.tab`'s `maxWidth: 220` was sized for 14pt padding and no border.
  // Flag-on adds 2pt of padding and a 1px border per side, all of which count
  // inside `maxWidth` — so `{title} · {date}` truncated ~6pt sooner than
  // flag-off. Lift the cap by exactly the chrome added.
  tab: { paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1, maxWidth: 226 },
  tabText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },
  viewModePill: { paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1 },
  viewModeText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },

  // Sheet + header block
  //
  // §2 type role: this title is the SCREEN's header block, not a section
  // header — it names the whole sheet, once, at the top, and after the
  // embedded guard above it only renders in the standalone leader-tools
  // tool. §2 puts that at 22 Bold; 20-semibold is "section header (landing
  // screens)", which is the role `ServingRunsheetScreen`'s own per-plan
  // header legitimately occupies. Sizing up also fixes the direction of
  // travel: the earlier 20/600 made the title LIGHTER than flag-off's
  // 20/700, where WA-VISUAL-DELTAS S7's finding is that the pre-pass ran one
  // weight LIGHT throughout.
  planTitle: {
    fontSize: WA_TYPE_HEADER_BLOCK,
    fontWeight: WA_WEIGHT_BOLD,
  },
  ranges: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },
  editText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_SEMIBOLD },

  // Sentence-case section labels above each segment's rows (§3.2).
  segmentLabel: {
    fontSize: WA_SECTION_LABEL_SIZE,
    fontWeight: WA_WEIGHT_REGULAR,
    letterSpacing: 0,
    marginTop: WA_GROUP_SPACING,
    marginBottom: WA_SECTION_HEADER_GAP,
  },

  // Item rows (§3.2 cell anatomy)
  row: {
    borderRadius: WA_GROUP_RADIUS,
    padding: WA_CELL_PADDING,
    minHeight: WA_CELL_MIN_HEIGHT,
    gap: 12,
    marginTop: WA_SECTION_HEADER_GAP,
  },
  /**
   * "Happening now" leading strip.
   *
   * NOT `borderLeftWidth` flag-on. RN clips a border to the corner radius, and
   * at `WA_GROUP_RADIUS` (24) on a ~54–76pt row that leaves only ~6–28pt of
   * straight left edge — the "strip" renders as a thin crescent pinched at
   * both ends, which is not the marker the token's doc describes.
   *
   * An absolutely-positioned child instead, INSET clear of both corner arcs
   * (`left: 6` sits outside the arc, which reaches x≈2.2 at y=14 for r=24) so
   * it needs no `overflow: "hidden"` to look right and can't be clipped into a
   * sliver by a row height we didn't predict. It rides in the row's own 16pt
   * padding, so it never crowds the time column.
   *
   * This is the option that degrades most gracefully unverified: the
   * alternative — shrinking the radius on the current row — would change the
   * highlighted card's SHAPE relative to its neighbours, and re-shape a
   * different row every time the live clock advances.
   */
  currentStrip: {
    position: "absolute",
    left: 6,
    top: 14,
    bottom: 14,
    width: 4,
    borderRadius: 2,
  },
  timeText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },
  durationText: { fontSize: WA_TYPE_FOOTNOTE, marginTop: 2 },
  itemTitle: {
    fontSize: WA_TYPE_ROW_TITLE,
    lineHeight: 22,
    fontWeight: WA_WEIGHT_REGULAR,
  },
  meta: { fontSize: WA_TYPE_FOOTNOTE },
  desc: { fontSize: WA_TYPE_SUBTITLE, lineHeight: 20 },
  notePreview: { fontSize: WA_TYPE_FOOTNOTE, lineHeight: 18, fontStyle: "normal" },
  note: { fontSize: WA_TYPE_FOOTNOTE, lineHeight: 18 },
  noteCategory: {
    fontSize: WA_TYPE_FOOTNOTE,
    fontWeight: WA_WEIGHT_SEMIBOLD,
    textTransform: "none",
    letterSpacing: 0,
  },

  // Role assignments — stacked subtitle lines, one per role (see the block
  // comment above). No container, so there's no `assignChip`/`assignSwatch`
  // counterpart here at all.
  assignWrap: { flexDirection: "column", flexWrap: "nowrap", gap: 2, marginTop: 4 },
  assignText: { fontSize: WA_TYPE_SUBTITLE, fontWeight: WA_WEIGHT_REGULAR },
  assignRole: { fontWeight: WA_WEIGHT_SEMIBOLD },

  // In-segment collapsible header rows — another sentence-case section label.
  headerRow: { marginTop: 16, marginBottom: 4, gap: 8 },
  headerText: {
    fontSize: WA_SECTION_LABEL_SIZE,
    fontWeight: WA_WEIGHT_REGULAR,
    letterSpacing: 0,
  },
  headerTime: { fontSize: WA_TYPE_FOOTNOTE, fontWeight: WA_WEIGHT_REGULAR },
});
