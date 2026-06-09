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
import React, { useMemo, useState } from "react";
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
import { useTheme } from "@hooks/useTheme";
import { useCommunityTheme } from "@hooks/useCommunityTheme";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { DEFAULT_ROLE_COLOR, formatEventDate } from "@features/scheduling/utils/format";
import {
  computeSegmentedClockTimes,
  formatClockTime,
  formatDuration,
  formatServiceRanges,
  totalDurationSec,
} from "@features/scheduling/utils/runSheetTiming";

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
}: {
  groupId: Id<"groups">;
  /** Show the "Edit in Rostering" shortcut (group leaders / admins). */
  canEdit: boolean;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();
  const router = useRouter();

  const plans = useAuthenticatedQuery(
    api.functions.scheduling.events.listEvents,
    { groupId },
  ) as PlanSummary[] | undefined;

  const [selectedId, setSelectedId] = useState<Id<"eventPlans"> | null>(null);
  const activePlanId = selectedId ?? plans?.[0]?._id ?? null;

  if (plans === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (plans.length === 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="list-outline" size={28} color={colors.textTertiary} />
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No upcoming event plans. Create one in Rostering to build its run
          sheet.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Upcoming-plan tabs (only when there's more than one) */}
      {plans.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {plans.map((p) => {
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
          onEdit={() =>
            router.push(
              `/rostering/${groupId}/run-sheet/${activePlanId}` as never,
            )
          }
        />
      ) : null}
    </View>
  );
}

function PlanRunSheet({
  planId,
  canEdit,
  onEdit,
}: {
  planId: Id<"eventPlans">;
  groupId: Id<"groups">;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { colors } = useTheme();
  const { primaryColor } = useCommunityTheme();

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

  const times = event?.times ?? [];
  const earliestStart = useMemo(
    () => (times.length > 0 ? Math.min(...times.map((t) => t.startsAt)) : Date.now()),
    [times],
  );
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
  const peopleByRole = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of event?.roles ?? []) {
      map[r.roleId as string] = r.assignments
        .filter((a) => a.status !== "declined")
        .map((a) => a.userName);
    }
    return map;
  }, [event?.roles]);

  if (event === undefined || items === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }
  if (!event || !items) {
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
            {event.title}
          </Text>
          {times.length > 0 ? (
            <Text style={[styles.ranges, { color: colors.textSecondary }]}>
              {formatServiceRanges(times, duringTotalSec)}
            </Text>
          ) : null}
        </View>
        {canEdit ? (
          <Pressable onPress={onEdit} hitSlop={8} accessibilityRole="button">
            <View style={styles.editRow}>
              <Ionicons name="create-outline" size={16} color={primaryColor} />
              <Text style={[styles.editText, { color: primaryColor }]}>Edit</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {items.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          This event plan's run sheet is empty.
        </Text>
      ) : (
        SEGMENT_OPTIONS.map((seg) => {
          const segItems = itemsBySegment[seg.key];
          if (segItems.length === 0) return null;
          return (
            <View key={seg.key}>
              <Text style={[styles.segmentLabel, { color: colors.textSecondary }]}>
                {seg.label.toUpperCase()}
              </Text>
              {segItems.map((item) => (
                <ReadOnlyRow
                  key={item._id}
                  item={item}
                  clockMs={clockTimes[item._id]}
                  peopleByRole={peopleByRole}
                  colors={colors}
                />
              ))}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function ReadOnlyRow({
  item,
  clockMs,
  peopleByRole,
  colors,
}: {
  item: RunSheetItem;
  clockMs: number | null;
  peopleByRole: Record<string, string[]>;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const isHeader = item.type === "header";
  const duration = formatDuration(item.durationSec);

  if (isHeader) {
    return (
      <View style={styles.headerRow}>
        <Text style={[styles.headerText, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.title.toUpperCase()}
        </Text>
        {clockMs != null ? (
          <Text style={[styles.headerTime, { color: colors.textTertiary }]}>
            {formatClockTime(clockMs)}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.row, { backgroundColor: colors.surfaceSecondary }]}>
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
        <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
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
        {item.description ? (
          <Text style={[styles.desc, { color: colors.textSecondary }]}>{item.description}</Text>
        ) : null}
        {item.notes.map((n, i) => (
          <Text key={i} style={[styles.note, { color: colors.textSecondary }]}>
            {n.category ? `${n.category}: ` : ""}
            {n.content}
          </Text>
        ))}
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
  itemTitle: { fontSize: 15, fontWeight: "600" },
  meta: { fontSize: 12 },
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
    justifyContent: "space-between",
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  headerText: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, flexShrink: 1 },
  headerTime: { fontSize: 11, fontWeight: "600" },
});
