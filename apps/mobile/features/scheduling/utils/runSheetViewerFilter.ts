/**
 * "All / Mine" filter for the native run sheet (ADR-026).
 *
 * "Mine" narrows a run sheet down to the rows a given viewer is actually
 * involved in — a worship leader sees their songs and the worship moment, a
 * meeting leader sees transitions and their script, without platform
 * briefing / broadcast testing / other teams' rows in the way. Verbatim from
 * the stakeholder meeting: "it would just be two views... all, and mine."
 *
 * A header carries no `assignments` of its own — it's a section divider, not
 * content — so it always matches. Dropping headers in "Mine" would turn the
 * sheet into a contextless list of rows; keeping them preserves the shape of
 * the service while the content under them narrows.
 */

/** The minimum an item needs to be filtered: its type and role assignments. */
export interface ViewerFilterItem {
  type: string;
  assignments: Array<{ roleId: string }>;
}

/**
 * Does `item` belong in the viewer's "Mine" run sheet?
 *
 * - Headers always match (structural, not content).
 * - An unassigned content item never matches — there's no role to attribute
 *   it to the viewer.
 * - Otherwise, matches if the viewer holds ANY of the item's roles (a
 *   multi-role item, or a viewer with more than one role on the plan, unions).
 */
export function runSheetItemMatchesViewer(
  item: ViewerFilterItem,
  viewerRoleIds: ReadonlySet<string>,
): boolean {
  if (item.type === "header") return true;
  if (item.assignments.length === 0) return false;
  return item.assignments.some((a) => viewerRoleIds.has(a.roleId));
}

/**
 * Does this group of items (e.g. a run sheet segment) have any actual
 * CONTENT for "Mine" — i.e. at least one non-header item the viewer matches?
 *
 * Headers always pass `runSheetItemMatchesViewer`, so filtering a segment
 * with that alone can leave a segment that's "matching" but empty of
 * content — a header with nothing under it. Callers that decide whether to
 * render a "Mine" segment at all (as opposed to filtering its rows) should
 * use this instead of checking the filtered list's length.
 */
export function segmentHasContentForViewer(
  items: ReadonlyArray<ViewerFilterItem>,
  viewerRoleIds: ReadonlySet<string>,
): boolean {
  return items.some(
    (it) => it.type !== "header" && runSheetItemMatchesViewer(it, viewerRoleIds),
  );
}
