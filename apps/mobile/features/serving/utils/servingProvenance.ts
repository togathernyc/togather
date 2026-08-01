/**
 * Serving-mode provenance: WHO rostered the viewer, and which of their roles
 * put each task in front of them.
 *
 * Multi-plan and multi-role rendering already worked — every same-day plan gets
 * its own section, and a task matching any role the viewer holds appears in
 * "Mine". What was missing is the answer to "why am I looking at this?": the
 * matched role and its team were computed server-side and thrown away, so a
 * volunteer holding Camera on Production AND Greeter on Hospitality saw one
 * flat, unattributed list.
 *
 * Everything here is deliberately CONDITIONAL. The overwhelming majority of
 * volunteers hold exactly one (team, role) pair on a plan, and for them every
 * row would carry the same label — pure noise. So the rules are:
 *
 *   • Label a task row only when the viewer holds MORE THAN ONE distinct
 *     (team, role) pair on the plan (`shouldShowTaskProvenance`).
 *   • Name the TEAM only when those pairs span more than one team
 *     (`shouldShowTeamNames`). Two roles on a single team need only the role
 *     names to be told apart.
 *
 * The pairs come from ONE source: the viewer's own `getCrewTasks` rows. That is
 * the only complete answer to "what do I hold on this plan?" — it emits a row
 * per (member, role) even for roles with zero tasks. The `roles` on each
 * `getMyServingTasks` item are a strict SUBSET (a role with no matching task
 * can never appear there), so unioning them in can never add a pair the crew
 * rows lack, but reading them WITHOUT the crew rows silently under-reports:
 * a viewer holding Camera + Usher on a Camera-only plan looks single-role and
 * every row loses its label.
 *
 * So the decision is deliberately all-or-nothing on the crew rows resolving
 * (`heldRolePairs` returns `null` until they do, and every rule below reads
 * `null` as "say nothing"):
 *
 *   • Two independent subscriptions meant the tasks usually landed first, and
 *     the labels then popped in a beat later — a full-list layout shift on a
 *     checklist of toggle `Pressable`s, where a tap already in flight lands on
 *     the neighbouring task's checkbox.
 *   • Offline the two sections are cached by separate effects, so `"mine"`
 *     could be present with `"crew"` missing. Deciding from the subset there
 *     would make the labels LEAST reliable at the venue — exactly where the
 *     volunteer is asking which roster a task came from. Unlabelled is honest;
 *     wrongly-unlabelled-because-we-guessed is not.
 */

/**
 * The provenance line under a plan's title: "FOUNT Brooklyn", or
 * "FOUNT Brooklyn · Production" when the viewer's teams on that plan are known.
 *
 * Every serving tab stacks one section per same-day plan, and their headers
 * used to be byte-identical ("Untitled event plan · Sun, Aug 3 · 9:00 AM") —
 * which is how a leader concluded the tasks they had just authored were
 * missing: they authored on one plan and were rostered on another. Returns
 * `null` when there is no group name (an offline cache written by an older
 * build), so nothing empty renders.
 */
export function planSubtitle(
  groupName: string | undefined,
  teamNames?: ReadonlyArray<string>,
): string | null {
  const group = (groupName ?? "").trim();
  if (!group) return null;
  const teams = (teamNames ?? []).filter(Boolean);
  return teams.length > 0 ? `${group} · ${teams.join(", ")}` : group;
}

/** One (team, role) the viewer holds — the unit of serving provenance. */
export interface RolePair {
  roleId: string;
  roleName: string;
  teamId: string;
  teamName: string;
}

/** Identity of a pair. Role ids are team-scoped, but both are kept so two teams
 *  that happen to share a role NAME never collapse into one. */
const pairKey = (p: RolePair): string => `${p.teamId}::${p.roleId}`;

/** Distinct pairs in first-seen order. */
export function distinctRolePairs(
  pairs: ReadonlyArray<RolePair>,
): RolePair[] {
  const seen = new Set<string>();
  const out: RolePair[] = [];
  for (const p of pairs) {
    const key = pairKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Every (team, role) pair the viewer holds on a plan, from their own
 * `getCrewTasks` rows — the one complete source (see the module header).
 *
 * `null` means "not known yet": the query hasn't resolved and, offline, no
 * cached copy exists. Callers must render no provenance at all in that state
 * rather than deciding from the task rows, which can only under-report.
 */
export function heldRolePairs(
  crew: ReadonlyArray<{ isCurrentUser: boolean } & RolePair> | undefined,
): RolePair[] | null {
  if (crew === undefined) return null;
  const pairs: RolePair[] = [];
  for (const row of crew) {
    if (!row.isCurrentUser) continue;
    // Projected, not spread: a crew row carries a member's whole card, and
    // leaking that through would make two structurally different objects for
    // the same pair.
    pairs.push({
      roleId: row.roleId,
      roleName: row.roleName,
      teamId: row.teamId,
      teamName: row.teamName,
    });
  }
  return distinctRolePairs(pairs);
}

/**
 * Whether task rows should say which role they came from. False for the
 * single-role volunteer — their list stays exactly as clean as it was — and
 * false while `heldPairs` is `null` (unresolved), so the answer never flips
 * mid-scroll.
 *
 * Counted by (team, role NAME), not by pair: nothing stops ONE team defining
 * two roles both called "Camera", and stamping an identical "Camera" under
 * every row resolves nothing — it is noise dressed as an explanation. Two
 * TEAMS with a same-named role still count as two, because the label then
 * names the team and the rows really do read differently.
 */
export function shouldShowTaskProvenance(
  heldPairs: ReadonlyArray<RolePair> | null,
): boolean {
  if (!heldPairs) return false;
  return new Set(heldPairs.map((p) => `${p.teamId}::${p.roleName}`)).size > 1;
}

/** Whether the team needs naming too — only when the viewer spans >1 team. */
export function shouldShowTeamNames(
  heldPairs: ReadonlyArray<RolePair> | null,
): boolean {
  if (!heldPairs) return false;
  return new Set(heldPairs.map((p) => p.teamId)).size > 1;
}

/** "Camera", "Camera & Usher", "Camera, Usher & Greeter". */
function joinRoleNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/**
 * The provenance label for one task row, or `null` when there is nothing worth
 * saying (no matched roles — e.g. a personal task the viewer added themselves).
 *
 * A task names several roles, so the viewer can match on more than one; ALL
 * matches are shown rather than an arbitrary first, because "this task is yours
 * twice over" is the honest reading and hiding a match would recreate the very
 * doubt this exists to remove.
 *
 * Team-first when `includeTeam`, since the team is the coarser question:
 *   "Production · Camera & Usher, Hospitality · Greeter"
 * Role-only otherwise:
 *   "Camera & Usher"
 */
export function formatTaskProvenance(
  roles: ReadonlyArray<RolePair> | undefined,
  includeTeam: boolean,
): string | null {
  const pairs = distinctRolePairs(roles ?? []);
  if (pairs.length === 0) return null;

  if (!includeTeam) {
    const names: string[] = [];
    for (const p of pairs) if (!names.includes(p.roleName)) names.push(p.roleName);
    return joinRoleNames(names);
  }

  // Group by team, preserving first-seen order of both teams and roles.
  const byTeam = new Map<string, { teamName: string; roleNames: string[] }>();
  for (const p of pairs) {
    const entry =
      byTeam.get(p.teamId) ??
      byTeam.set(p.teamId, { teamName: p.teamName, roleNames: [] }).get(p.teamId)!;
    if (!entry.roleNames.includes(p.roleName)) entry.roleNames.push(p.roleName);
  }
  return [...byTeam.values()]
    .map((t) => `${t.teamName} · ${joinRoleNames(t.roleNames)}`)
    .join(", ");
}

/**
 * The label for a whole-team ("Shared") task, or `null` when the viewer is on a
 * single team and naming it would only add chrome.
 *
 * `teamNames` are the task's OWN teams (a team-level task can span several),
 * which is the provenance question being answered — not the viewer's teams.
 * `null` heldPairs (unresolved) means the plain "Team task" copy stands.
 */
export function formatSharedTaskTeams(
  teamNames: ReadonlyArray<string> | undefined,
  heldPairs: ReadonlyArray<RolePair> | null,
): string | null {
  if (!shouldShowTeamNames(heldPairs)) return null;
  const names = (teamNames ?? []).filter(Boolean);
  if (names.length === 0) return null;
  return names.join(", ");
}
