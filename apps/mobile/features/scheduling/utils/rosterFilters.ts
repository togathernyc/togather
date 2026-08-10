/**
 * People-view filter predicates for the rostering grid (RosterGridScreen).
 *
 * Extracted as pure functions so the composed "scope to my teams -> filter to
 * non-responders -> tap to text" workflow is unit-testable without mounting
 * the grid. Two independent predicates, ANDed together (with search /
 * "also in group" / "open only") in `visibleMembers`:
 *
 *  - `memberInTeamScope` — does this person belong to a team within the
 *    current `teamScope`? The agreed basis (per the stakeholder discussion)
 *    is the teams a leader explicitly manages via `teamManagers` — NOT
 *    "has this person served on my team before" (breaks for a person who
 *    hasn't been assigned yet) and NOT group leadership (too broad — a
 *    leader may lead several unrelated groups). A person is in scope if they
 *    hold a role assignment, in any visible cell, on a role belonging to a
 *    team in scope. `visibleTeamIds === null` means "every team" — the
 *    All-teams view, and the fallback a leader/community admin who manages
 *    no team here already gets (see RosterGridScreen's `visibleTeamIds`) —
 *    so a leader/admin is never locked out.
 *
 *  - `memberNeedsAvailability` — has this person left at least one visible
 *    date with no response at all? ("Absence of a row means no response" —
 *    see `eventAvailability` in schema.ts.) This is the inverse of the
 *    existing "Available only" chip and backs the "Needs availability"
 *    filter: "a list of people that haven't filled out yet... these are the
 *    10 people I need to text."
 */

export type RosterFilterAvailability = "available" | "unavailable" | "no_response";

export interface RosterFilterAssignment {
  roleId: string;
}

export interface RosterFilterCell {
  availability: RosterFilterAvailability;
  assignments: RosterFilterAssignment[];
}

/**
 * Is `cells` (a member's per-event cells) in team scope?
 *
 * `visibleTeamIds === null` means every team is in scope (matches everyone).
 * Otherwise a match requires at least one assignment, in any cell, whose
 * role resolves (via `roleTeamMap`) to a team id in `visibleTeamIds`.
 */
export function memberInTeamScope(
  cells: Record<string, RosterFilterCell>,
  visibleTeamIds: ReadonlySet<string> | null,
  roleTeamMap: ReadonlyMap<string, string>,
): boolean {
  if (!visibleTeamIds) return true;
  return Object.values(cells).some((cell) =>
    cell.assignments.some((a) => {
      const teamId = roleTeamMap.get(a.roleId);
      return teamId !== undefined && visibleTeamIds.has(teamId);
    }),
  );
}

/**
 * Does this member need an availability follow-up — no response recorded on
 * ANY of the given (visible) event ids? Mirrors the "Open only" chip's
 * some-event shape: a single unanswered upcoming date is enough to be worth
 * texting, rather than requiring every date to be unanswered.
 */
export function memberNeedsAvailability(
  cells: Record<string, RosterFilterCell>,
  eventIds: readonly string[],
): boolean {
  // A missing cell (shouldn't happen — the grid builds one per plan per
  // active member — but a defensive default matches the domain rule: no row
  // means no response) counts as unanswered, same as an explicit
  // "no_response".
  return eventIds.some(
    (id) => (cells[id]?.availability ?? "no_response") === "no_response",
  );
}
