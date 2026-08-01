/**
 * Pure helpers for the leader "Edit" surface inside serving mode's Tasks tab
 * (`ServingTasksScreen`'s `AuthorSection`) — let a leader add/edit/delete a
 * role's shared serving tasks from the venue, without the rostering grid.
 *
 * Extracted so the permission gate and role-scoped filtering are unit
 * testable without mounting Convex queries or the screen.
 */

/** A task segment relative to the event's service times. */
export type Segment = "before" | "during" | "after";

/**
 * Mirrors the backend gate that `createTask` / `updateTask` / `deleteTask`
 * actually enforce: `requirePlanScheduler` -> `requireGroupScheduler` ->
 * `isGroupScheduler` in `apps/convex/functions/scheduling/permissions.ts` —
 * an active group LEADER, or a community admin. (Team managers and team
 * channel admins/moderators pass `isTeamScheduler`, a WIDER check used
 * elsewhere in scheduling, but NOT the one these three mutations use — so a
 * team manager who isn't also a group leader must not see this affordance,
 * or they'd hit a permission error on every write.)
 *
 * Kept consistent with the desktop grid's identical gate
 * (`EventTasksScreen`'s `isLeader`), rather than reinvented, so the two
 * authoring surfaces agree on who can author.
 */
export function canAuthorPlanTasks(
  groupUserRole: string | null | undefined,
  isCommunityAdmin: boolean,
): boolean {
  return (
    groupUserRole === "leader" ||
    groupUserRole === "admin" ||
    isCommunityAdmin === true
  );
}

/** The slice of a `listPlanTasks` row that role-filtering needs. */
export interface AuthorableTask {
  /** Every team the task belongs to (`listPlanTasks` returns this). */
  teamIds: readonly string[];
  roleIds: readonly string[];
  segment: Segment;
  sortOrder: number;
}

/** True when a task belongs to the whole team rather than a single role. */
export function isTeamLevelTask(task: AuthorableTask): boolean {
  return task.roleIds.length === 0;
}

/**
 * Group a plan's tasks (as returned by `listPlanTasks`) into Before/During/
 * After buckets for the role the leader is currently "viewing as" in the Edit
 * surface, sorted within each bucket by `sortOrder` (matching the plan-wide
 * task order).
 *
 * TEAM-LEVEL tasks (`roleIds` empty) are included in the buckets of every role
 * **on the same team**. They aren't the selected role's tasks — they apply to
 * the whole team, and the UI labels them as such — but excluding them made the
 * Edit surface the one place a leader could neither see nor fix them: they're
 * absent from "Mine" by design (`getMyServingTasks` skips them) and live only
 * under the Shared pill, which has no authoring controls. A leader looking at
 * Edit and seeing "No tasks yet for this role" on a plan whose tasks are all
 * team-level was being told something false.
 *
 * The TEAM check is not optional. Both inputs are wider than one team:
 * `listPlanTasks({ planId })` returns every task on the plan across all teams,
 * and `buildRoleCatalog` spans every team in the group. Without it, selecting
 * (say) `Kids · Check-in` listed Worship's team-level "Sound check" captioned
 * "Whole team — not just this role" — a lie — and a single tap could DELETE it
 * (cascading its completions, and permanently unsyncing it from its template).
 *
 * `role === null` (nothing selected yet, e.g. before the role catalog has
 * loaded) returns all-empty buckets.
 */
export function tasksForRole<T extends AuthorableTask>(
  tasks: readonly T[],
  role: { roleId: string; teamId: string } | null,
): Record<Segment, T[]> {
  const result: Record<Segment, T[]> = { before: [], during: [], after: [] };
  if (!role) return result;
  for (const task of tasks) {
    const belongs = isTeamLevelTask(task)
      ? task.teamIds.includes(role.teamId)
      : task.roleIds.includes(role.roleId);
    if (belongs) result[task.segment].push(task);
  }
  (Object.keys(result) as Segment[]).forEach((segment) => {
    result[segment] = [...result[segment]].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
  });
  return result;
}

/** A team, as returned by `scheduling.teams.listTeams`. */
export interface RoleCatalogTeam {
  _id: string;
  name: string;
}

/** A role, as returned by `scheduling.roles.listRoles`. */
export interface RoleCatalogRole {
  _id: string;
  name: string;
}

/** One switchable entry in the Edit surface's role picker. */
export interface RoleCatalogEntry {
  roleId: string;
  roleName: string;
  teamId: string;
  teamName: string;
}

/**
 * Flatten a group's teams + per-team roles (collected via one `listRoles`
 * call per team — the same `RoleLoader` pattern `EventTasksScreen` uses for
 * the desktop grid's role picker) into a single sorted role catalog for the
 * Edit surface's role switcher. Teams with no roles loaded yet (or none)
 * contribute nothing, so the catalog fills in as each team's roles resolve.
 */
export function buildRoleCatalog(
  teams: readonly RoleCatalogTeam[],
  rolesByTeam: Readonly<Record<string, readonly RoleCatalogRole[]>>,
): RoleCatalogEntry[] {
  const out: RoleCatalogEntry[] = [];
  for (const team of teams) {
    for (const role of rolesByTeam[team._id] ?? []) {
      out.push({
        roleId: role._id,
        roleName: role.name,
        teamId: team._id,
        teamName: team.name,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.teamName.localeCompare(b.teamName) ||
      a.roleName.localeCompare(b.roleName),
  );
}

/**
 * How many tasks each role in the catalog has OF ITS OWN, for the badge on the
 * Edit surface's role pills. Keyed by `roleId`; every role in the catalog gets
 * an entry, so a role with none reads `0` rather than `undefined`.
 *
 * TEAM-LEVEL tasks (`roleIds: []`) are deliberately EXCLUDED — this count is
 * NOT `tasksForRole(...).length`. That function folds a team's team-level tasks
 * into every role on that team (on purpose — see its docblock), which is right
 * for the body list but wrong for the badge: the whole point of the badge is
 * spotting the role nobody has authored for. On a plan whose Worship team has
 * one "Sound check" team-level task, a `tasksForRole`-based count would put
 * "1" on Drums, Vocals, Bass and Keys alike and hide exactly the gap a manager
 * is scanning for. Team-level tasks are still visible — and still captioned
 * "Whole team" — in the body once a pill is selected.
 *
 * A task naming several roles counts once for each of them; that's real work
 * for each of those roles.
 */
export function roleTaskCounts(
  tasks: readonly AuthorableTask[],
  roleCatalog: readonly Pick<RoleCatalogEntry, "roleId">[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const role of roleCatalog) counts[role.roleId] = 0;
  for (const task of tasks) {
    if (isTeamLevelTask(task)) continue;
    for (const roleId of task.roleIds) {
      // Ignore roles outside the catalog: `listPlanTasks` is plan-wide and can
      // name a role on a team whose `listRoles` hasn't resolved yet.
      if (roleId in counts) counts[roleId] += 1;
    }
  }
  return counts;
}

/**
 * How many tasks COVER each role — its own tasks PLUS the team-level ones that
 * apply to it. This is `tasksForRole(...).length` per role, i.e. exactly what
 * the body list shows once a pill is tapped. Keyed by `roleId`; every role in
 * the catalog gets an entry.
 *
 * The distinction from `roleTaskCounts` is the whole point: that one answers
 * "what has been authored FOR this role" (the badge NUMBER — a role with a big
 * fat 0 is the gap a leader is scanning for), this one answers "does anything
 * reach a volunteer in this role at all". They diverge exactly when a plan is
 * authored at team level — the "Whole team" pattern — and conflating them made
 * the pill announce "no tasks yet" for a role whose list then read out tasks.
 * Only THIS count may drive an alarm, or a fully authored event reads as
 * unauthored.
 */
export function roleCoveredTaskCounts(
  tasks: readonly AuthorableTask[],
  roleCatalog: readonly Pick<RoleCatalogEntry, "roleId" | "teamId">[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const role of roleCatalog) counts[role.roleId] = 0;
  for (const task of tasks) {
    for (const role of roleCatalog) {
      const belongs = isTeamLevelTask(task)
        ? task.teamIds.includes(role.teamId)
        : task.roleIds.includes(role.roleId);
      if (belongs) counts[role.roleId] += 1;
    }
  }
  return counts;
}
