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
import { distinctRolePairs, type RolePair } from "./servingProvenance";

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
  /**
   * Every task on the plan is TEAM-LEVEL — cause #2 above. Nothing is missing
   * and nothing is misassigned; the tasks simply live on "Shared". Split out of
   * `role-mismatch`, which said they were "for other roles" — false, since
   * team-level tasks are for the viewer's OWN team.
   */
  | "team-level-only"
  /** Tasks exist; none name a role the viewer holds. */
  | "role-mismatch";

/**
 * How a plan's tasks split. `total` is what "this event has N tasks" may claim;
 * `teamLevel` is the part of it that belongs to whole TEAMS rather than roles,
 * and therefore may never be described as being "for other roles".
 */
export interface PlanTaskCounts {
  /** Distinct tasks on the whole plan (every team, every role). */
  total: number;
  /** Of `total`, the ones with no roles (`roleIds: []`) — see `teamLevel`. */
  teamLevel: number;
}

/** The facts `diagnoseMineEmpty` reasons over. `null` means "not loaded yet". */
export interface MineEmptyFacts {
  /** The plan's task split, or `null` while `getAllTeamsTasks` is unresolved. */
  planTaskCounts: PlanTaskCounts | null;
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
 * Distinct plan-wide task counts from `getAllTeamsTasks`, split by scope.
 *
 * A task that spans several teams is listed once per team, so the rows must be
 * de-duplicated by `taskId` — `taskCount` summed across teams would over-count.
 * Returns `null` while the query is unresolved.
 *
 * `getAllTeamsTasks` counts TEAM-LEVEL tasks into each team they span, with an
 * empty `roleNames` (see the `roleIds.length === 0` branch in `eventTasks.ts`).
 * They are therefore inside `total`, which is why the copy has to know how many
 * of the total they are: a sentence about "this event's N tasks" that treats
 * team-level ones as belonging to other roles contradicts itself.
 *
 * A role task that spans teams carries that team's roles in every row, so
 * "team-level" is "no row names a role".
 */
export function planTaskCountsFromAllTeams(
  teams:
    | ReadonlyArray<{
        tasks: ReadonlyArray<{ taskId: string; roleNames: readonly string[] }>;
      }>
    | undefined,
): PlanTaskCounts | null {
  if (teams === undefined) return null;
  const teamLevelById = new Map<string, boolean>();
  for (const team of teams) {
    for (const task of team.tasks) {
      const teamLevel =
        (teamLevelById.get(task.taskId) ?? true) && task.roleNames.length === 0;
      teamLevelById.set(task.taskId, teamLevel);
    }
  }
  let teamLevel = 0;
  for (const isTeamLevel of teamLevelById.values()) {
    if (isTeamLevel) teamLevel += 1;
  }
  return { total: teamLevelById.size, teamLevel };
}

/**
 * The viewer's role names on this plan, from `getCrewTasks`.
 *
 * The crew list carries one row per (member, role) for every team the viewer is
 * serving on, so the viewer's own rows name every role they hold. An empty
 * result means the viewer has no non-declined assignment at all — `getCrewTasks`
 * short-circuits to `[]` in that case. Returns `null` while unresolved.
 *
 * De-duped by (team, role), NOT by role name. Two teams may each define a role
 * called "Camera"; collapsing them told a volunteer holding both "You're
 * serving as Camera" — understating what they hold, which is exactly the doubt
 * ("did I miss a roster?") this copy exists to settle. When a role name DOES
 * appear on more than one team, it is qualified with its team ("Camera
 * (Production)"); unambiguous names stay bare so the common case reads clean.
 *
 * The final de-dupe is on the resulting DISPLAY STRING, not the pair. Nothing
 * stops ONE team defining two roles both called "Camera" (`createRole` only
 * rejects an empty name), and those two pairs qualify to the same bare
 * "Camera" — printed per-pair that reads "You're serving as Camera and
 * Camera." Collapsing identical strings keeps the cross-team case intact (the
 * team qualifier makes those strings differ) while an unsayable duplicate says
 * itself once.
 */
export function myRoleNamesFromCrew(
  crew: ReadonlyArray<{ isCurrentUser: boolean } & RolePair> | undefined,
): string[] | null {
  if (crew === undefined) return null;
  const pairs = distinctRolePairs(crew.filter((m) => m.isCurrentUser));

  const teamsPerName = new Map<string, Set<string>>();
  for (const p of pairs) {
    const teams = teamsPerName.get(p.roleName) ?? new Set<string>();
    teams.add(p.teamId);
    teamsPerName.set(p.roleName, teams);
  }

  const names: string[] = [];
  for (const p of pairs) {
    const name =
      (teamsPerName.get(p.roleName)?.size ?? 0) > 1
        ? `${p.roleName} (${p.teamName})`
        : p.roleName;
    if (!names.includes(name)) names.push(name);
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
 *     It also precedes `team-level-only`, whose copy sends the viewer to
 *     "Shared" — a tab that is empty for someone on no team at all.
 *  5. `team-level-only` — nothing is misassigned, so this must be told apart
 *     from `role-mismatch` before that one gets to blame other roles.
 *  6. `role-mismatch`.
 */
export function diagnoseMineEmpty(facts: MineEmptyFacts): MineEmptyReason {
  if (facts.myTemplateTaskCount > 0) return "has-tasks";
  if (
    facts.planTaskCounts === null ||
    facts.myRoleNames === null ||
    facts.sharedTaskCount === null
  ) {
    return "loading";
  }
  if (facts.planTaskCounts.total === 0) return "no-plan-tasks";
  if (facts.myRoleNames.length === 0) return "not-rostered";
  if (facts.planTaskCounts.teamLevel === facts.planTaskCounts.total) {
    return "team-level-only";
  }
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

    // Reachable essentially only when the viewer's assignment is REMOVED or
    // DECLINED while this screen is open (serving eligibility is what put them
    // here in the first place). "Ask your team lead to add you to the roster"
    // was wrong for the second case — telling someone who has just declined to
    // ask to be re-added. This wording is true either way.
    case "not-rostered":
      return {
        title: "You're not on the roster for this event.",
        hint: "Tasks follow roles, and you don't hold one here — your assignment was removed, or you declined it. If that's not right, check with your team lead.",
      };

    // Nothing here is anybody's mistake: the plan is authored, just entirely at
    // TEAM level. `role-mismatch` used to swallow this case and tell the viewer
    // the tasks were "for other roles" — in the same breath as pointing them at
    // "Shared … for your whole team", which is the opposite claim.
    case "team-level-only": {
      const roles = facts.myRoleNames ?? [];
      const total = facts.planTaskCounts?.total ?? 0;
      const scope =
        total === 1
          ? "This event's only task is for a whole team rather than a single role, so it isn't in Mine."
          : `All ${total} of this event's tasks are for whole teams rather than single roles, so none of them are in Mine.`;
      return {
        title: "This event's tasks are for whole teams, not roles.",
        hint: [
          roles.length > 0 ? `You're serving as ${formatRoleList(roles)}.` : null,
          scope,
          sharedHint,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }

    case "role-mismatch": {
      const roles = facts.myRoleNames ?? [];
      const roleWord = roles.length === 1 ? "role" : "roles";
      // The count is PLAN-wide, across every team. Leading with it read as
      // "20 tasks exist and you were skipped" — for a Kids volunteer on a plan
      // where Worship authored all 20 and Kids authored none, that points at a
      // non-problem. Say "across all teams" out loud instead, and restore the
      // one actionable instruction the old single-message copy had.
      //
      // The subject is spelled out as "This event's". It used to be "Its",
      // whose nearest antecedent is the ROLE named in the sentence before it —
      // so "You're serving as Camera. Its 2 tasks … are for other roles." read
      // as Camera's own tasks being for other roles, which contradicts itself.
      //
      // Only the ROLE-SCOPED tasks are for other roles. The team-level ones are
      // for whole teams — the viewer's own included — so they get counted out
      // loud and separately rather than folded into the "for other roles" claim
      // (`diagnoseMineEmpty` has already peeled off the all-team-level plan, so
      // `roleScoped` is at least 1 here).
      const counts = facts.planTaskCounts;
      const roleScoped = counts === null ? 0 : counts.total - counts.teamLevel;
      const planWide =
        counts === null
          ? null
          : counts.teamLevel === 0
            ? `This event's ${pluralTasks(roleScoped)} — across all teams — ${
                roleScoped === 1 ? "is for another role" : "are for other roles"
              }.`
            : `Of this event's ${pluralTasks(counts.total)} — across all teams — ${
                roleScoped === 1 ? "1 is for another role" : `${roleScoped} are for other roles`
              } and ${
                counts.teamLevel === 1
                  ? "1 is for a whole team"
                  : `${counts.teamLevel} are for whole teams`
              }.`;
      return {
        title: `None of this event's tasks are assigned to your ${roleWord}.`,
        hint: [
          `You're serving as ${formatRoleList(roles)}.`,
          planWide,
          `Ask your team lead to add tasks for your ${roleWord}.`,
          sharedHint,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
  }
}

/**
 * Whether the notice should offer its one-tap jump to the "Shared" tab.
 *
 * Only for the states where whole-team tasks are a genuine next place to
 * look. `no-plan-tasks` is excluded on purpose: a stale-cache mix (an empty
 * all-teams snapshot next to a cached shared list) could otherwise render
 * "This event has no tasks set up yet." directly above "Open Shared (2)".
 */
export function shouldOfferSharedJump(
  reason: MineEmptyReason,
  facts: MineEmptyFacts,
): boolean {
  if (
    reason !== "role-mismatch" &&
    reason !== "not-rostered" &&
    reason !== "team-level-only"
  ) {
    return false;
  }
  return (facts.sharedTaskCount ?? 0) > 0;
}
