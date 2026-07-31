/**
 * Why the serving-mode "Mine" tab is empty — and what to say about it.
 *
 * The Tasks tab used to render ONE message for every empty "Mine" list:
 * "No preloaded task. Please contact your team lead to add tasks." That
 * sentence implies tasks exist and are misconfigured, which is wrong in two of
 * the three situations that actually produce it, and it gave a debugging
 * engineer nothing to go on either. The three live causes are:
 *
 *  1. The plan has NO `eventTasks` rows at all. `createEventDraftImpl` makes
 *     plans with no `taskTemplateId` and no tasks, and nothing backfills them —
 *     tasks only appear when a leader links a task template
 *     (`setPlanTaskTemplate`) or duplicates an event. So a freshly created
 *     event is empty for EVERYONE, forever, until someone populates it.
 *  2. The plan's tasks are TEAM-LEVEL (`roleIds: []`). `getMyServingTasks`
 *     deliberately skips those — they live on the "Shared" tab — but the screen
 *     opens on "Mine", so the viewer never sees them.
 *  3. Role mismatch — tasks exist, but none of them name a role this viewer
 *     holds on this plan.
 *
 * A fourth, rarer state is worth separating out: the viewer holds no
 * non-declined role assignment on the plan at all. That's a ROSTERING gap, not
 * a task-authoring gap, and a different person fixes it.
 *
 * Everything here is derived from the four queries the screen already runs —
 * no new backend surface:
 *   • plan-wide task count  ← `getAllTeamsTasks` (plan-wide; every task belongs
 *     to >= 1 team, so a task appears under at least one team row)
 *   • the viewer's roles    ← `getCrewTasks` (the `isCurrentUser` rows; the
 *     query returns [] when the viewer has no non-declined assignment)
 *   • shared task count     ← `getSharedTeamTasks`
 *   • the viewer's own list ← `getMyServingTasks`
 */

/**
 * Which empty-state story to tell. Precedence is deliberate — see
 * `diagnoseMineEmpty`.
 */
export type MineEmptyReason =
  /** The viewer has preloaded tasks; no notice belongs on screen. */
  | "has-tasks"
  /** Not enough data has loaded to say anything honest yet. */
  | "loading"
  /** The plan has zero tasks — nobody sees anything, for any role. */
  | "no-plan-tasks"
  /** The viewer holds no non-declined role on this plan (rostering gap). */
  | "not-rostered"
  /** Tasks exist; none name a role the viewer holds. */
  | "role-mismatch";

/** The facts `diagnoseMineEmpty` reasons over. `null` means "not loaded yet". */
export interface MineEmptyFacts {
  /** Distinct tasks on the whole plan (every team, every role). */
  planTaskCount: number | null;
  /** Names of the roles the viewer holds on this plan, in display order. */
  myRoleNames: string[] | null;
  /** Preloaded (non-personal) tasks in the viewer's own "Mine" list. */
  myTemplateTaskCount: number;
  /**
   * Team-level tasks the viewer can see on the "Shared" tab.
   *
   * Nullable for the same reason the two above are: `getSharedTeamTasks` is
   * `undefined` until it resolves, and offline it stays `undefined` whenever
   * that section was never cached (the stale-cache read returns `null`). A
   * defaulted `0` made the shared hint and the "Open Shared (N)" jump silently
   * wrong — a pop-in on first paint, and permanently absent offline, which is
   * exactly when that pointer is most useful.
   */
  sharedTaskCount: number | null;
}

/**
 * Distinct plan-wide task count from `getAllTeamsTasks`.
 *
 * A task that spans several teams is listed once per team, so the rows must be
 * de-duplicated by `taskId` — `taskCount` summed across teams would over-count.
 * Returns `null` while the query is unresolved.
 */
export function planTaskCountFromAllTeams(
  teams: ReadonlyArray<{ tasks: ReadonlyArray<{ taskId: string }> }> | undefined,
): number | null {
  if (teams === undefined) return null;
  const ids = new Set<string>();
  for (const team of teams) {
    for (const task of team.tasks) ids.add(task.taskId);
  }
  return ids.size;
}

/**
 * The viewer's role names on this plan, from `getCrewTasks`.
 *
 * The crew list carries one row per (member, role) for every team the viewer is
 * serving on, so the viewer's own rows name every role they hold. An empty
 * result means the viewer has no non-declined assignment at all — `getCrewTasks`
 * short-circuits to `[]` in that case. Returns `null` while unresolved.
 */
export function myRoleNamesFromCrew(
  crew: ReadonlyArray<{ isCurrentUser: boolean; roleName: string }> | undefined,
): string[] | null {
  if (crew === undefined) return null;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const member of crew) {
    if (!member.isCurrentUser) continue;
    if (seen.has(member.roleName)) continue;
    seen.add(member.roleName);
    names.push(member.roleName);
  }
  return names;
}

/**
 * Classify why "Mine" is empty.
 *
 * Precedence, most-root-cause first:
 *  1. `has-tasks` — nothing to explain.
 *  2. `loading` — refuse to guess while the plan-wide, crew, or shared data is
 *     missing. Shared counts because the notice POINTS AT it; a defaulted 0
 *     produced a confidently wrong hint that never corrected itself offline.
 *  3. `no-plan-tasks` — checked BEFORE rostering because it is the root cause
 *     when both are true: a plan with no tasks shows nothing to anybody, so
 *     fixing the roster wouldn't help, and telling a rostered leader "you're
 *     not on the roster" would send them after the wrong problem.
 *  4. `not-rostered` — must precede `role-mismatch`, which would otherwise
 *     claim "none of these tasks match your role" to someone holding no role.
 *  5. `role-mismatch`.
 */
export function diagnoseMineEmpty(facts: MineEmptyFacts): MineEmptyReason {
  if (facts.myTemplateTaskCount > 0) return "has-tasks";
  if (
    facts.planTaskCount === null ||
    facts.myRoleNames === null ||
    facts.sharedTaskCount === null
  ) {
    return "loading";
  }
  if (facts.planTaskCount === 0) return "no-plan-tasks";
  if (facts.myRoleNames.length === 0) return "not-rostered";
  return "role-mismatch";
}

/** "Greeter", "Greeter and Usher", "Greeter, Usher and Camera 1". */
function formatRoleList(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "1 task" / "3 tasks". */
function pluralTasks(n: number): string {
  return n === 1 ? "1 task" : `${n} tasks`;
}

/** The copy shown for an empty "Mine" tab. */
export interface MineEmptyCopy {
  /** The headline — states plainly which situation the viewer is in. */
  title: string;
  /** Secondary line — where to look next, or who fixes it. */
  hint: string;
}

/**
 * The user-facing wording for a diagnosis. Returns `null` for the two states
 * that render no notice at all (`has-tasks`, `loading`).
 *
 * Kept here rather than in the component so every string is unit-testable
 * against the facts that produced it.
 */
export function mineEmptyCopy(
  reason: MineEmptyReason,
  facts: MineEmptyFacts,
): MineEmptyCopy | null {
  const shared = facts.sharedTaskCount;
  // `null` = unresolved: say nothing about Shared rather than guess. (In
  // practice `diagnoseMineEmpty` returns `loading` first; this keeps the copy
  // honest for any caller.)
  const sharedHint =
    shared === null
      ? null
      : shared > 0
        ? `Shared has ${pluralTasks(shared)} for your whole team.`
        : "Check All teams to see the rest of the event.";

  switch (reason) {
    case "has-tasks":
    case "loading":
      return null;

    case "no-plan-tasks":
      return {
        title: "This event has no tasks set up yet.",
        hint: "Nobody has added tasks to it, so there's nothing to show for any role. You can still add your own tasks below.",
      };

    case "not-rostered":
      return {
        title: "You're not on the roster for this event.",
        hint: `The event has ${pluralTasks(facts.planTaskCount ?? 0)}, but tasks follow roles and you don't hold one here. Ask your team lead to add you to the roster.`,
      };

    case "role-mismatch": {
      const roles = facts.myRoleNames ?? [];
      const roleWord = roles.length === 1 ? "role" : "roles";
      return {
        title: `This event has ${pluralTasks(facts.planTaskCount ?? 0)}, but none are assigned to your ${roleWord}.`,
        hint: [`You're serving as ${formatRoleList(roles)}.`, sharedHint]
          .filter(Boolean)
          .join(" "),
      };
    }
  }
}

/**
 * Whether the notice should offer its one-tap jump to the "Shared" tab.
 *
 * Only for the two states where whole-team tasks are a genuine next place to
 * look. `no-plan-tasks` is excluded on purpose: a stale-cache mix (an empty
 * all-teams snapshot next to a cached shared list) could otherwise render
 * "This event has no tasks set up yet." directly above "Open Shared (2)".
 */
export function shouldOfferSharedJump(
  reason: MineEmptyReason,
  facts: MineEmptyFacts,
): boolean {
  if (reason !== "role-mismatch" && reason !== "not-rostered") return false;
  return (facts.sharedTaskCount ?? 0) > 0;
}
