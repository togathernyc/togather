/**
 * Visual harness for the run sheet's expandable rows (the chevron "dropdowns").
 *
 * The real sheet (`PlanRunSheet`) reads its event + items from Convex, so it
 * can't be exercised without a backend. This route renders the real
 * `RunSheetItemList` — the component that owns the expand/collapse state and
 * the chevrons — over fixture items, so `pnpm --filter mobile web` + Playwright
 * can click the chevrons on web and confirm rows actually expand
 * (`tests/e2e/run-sheet-expand.spec.ts`). See CLAUDE.md's "Visual Verification".
 */
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useTheme } from "@hooks/useTheme";
import {
  RunSheetItemList,
  useRunSheetExpansion,
  type RunSheetItem,
  type Segment,
} from "@features/leader-tools/components/NativeRunSheetView";

/** Namespaced so the harness's persisted collapse state can't hit a real group. */
const HARNESS_GROUP_ID = "ui-test-run-sheet-expand" as never;

const NOTE_TEXT =
  "hello there i am a test comment hello there i am a test comment hello there i am a test comment";

function item(
  id: string,
  title: string,
  segment: Segment,
  extra: Partial<RunSheetItem> = {},
): RunSheetItem {
  return {
    _id: id as RunSheetItem["_id"],
    segment,
    type: "item",
    title,
    description: null,
    durationSec: 300,
    notes: [],
    songDetails: null,
    assignments: [],
    ...extra,
  };
}

const LONG_TEXT = Array.from(
  { length: 8 },
  (_, i) => `Line ${i + 1}: the run sheet note keeps going well past two lines.`,
).join(" ");

const ITEMS: RunSheetItem[] = [
  item("before-1", "New item", "before", {
    notes: [{ category: "", content: NOTE_TEXT }],
  }),
  item("before-2", "New item", "before"),
  item("before-3", "New item", "before", { description: NOTE_TEXT }),
  item("before-4", "New item", "before"),
  item("before-5", "Long note", "before", {
    notes: [{ category: "Tech", content: LONG_TEXT }],
  }),
  item("before-6", "Long description", "before", { description: LONG_TEXT }),
  item("during-header", "Setup", "during", { type: "header" }),
  item("during-1", "New item", "during", {
    notes: [{ category: "", content: NOTE_TEXT }],
  }),
];

const ITEMS_BY_SEGMENT: Record<Segment, RunSheetItem[]> = {
  before: ITEMS.filter((i) => i.segment === "before"),
  during: ITEMS.filter((i) => i.segment === "during"),
  after: [],
};

const CLOCK_TIMES: Record<string, number | null> = Object.fromEntries(
  ITEMS.map((i) => [i._id as string, Date.UTC(2026, 7, 2, 13, 0, 0)]),
);

export default function RunSheetExpandHarness() {
  const { colors } = useTheme();
  // Same hook the real screen uses, on a harness-only group id so its persisted
  // collapsed-header key can't collide with a real group's.
  const expansion = useRunSheetExpansion(HARNESS_GROUP_ID);
  return (
    <ScrollView
      testID="run-sheet-expand-harness"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
    >
      <Text style={[styles.title, { color: colors.text }]}>
        Untitled event plan
      </Text>
      <RunSheetItemList
        itemsBySegment={ITEMS_BY_SEGMENT}
        clockTimes={CLOCK_TIMES}
        peopleByRole={{}}
        viewMode="all"
        viewerRoleIds={new Set()}
        hasAnyViewerRole={false}
        mineHasContent
        currentItemId={null}
        expansion={expansion}
      />
      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 20, fontWeight: "700" },
  spacer: { height: 80 },
});
