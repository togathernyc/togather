/**
 * FOUNT Service Planning Bot - Native Sync
 *
 * Native-rostering read/write layer for the service planning bot. Mirrors the
 * PCO read/write helpers in `pcoSync.ts`, but sources plan context from — and
 * writes assignments + run-sheet items to — Togather's own native scheduling
 * tables (`eventPlans`, `teams`, `teamRoles`, `roleAssignments`, `eventItems`).
 *
 * Routing lives in `pcoSync.ts`: each public entry point tries native first
 * (when the location's campus group has an upcoming `eventPlans`) and falls
 * back to PCO otherwise. Every write mutation here returns a `handled` flag —
 * `false` means "no upcoming native plan, fall back to PCO"; `true` means the
 * native path owns the outcome (`success`/`detail` describe it).
 *
 * Auth: the bot runs system-level (no user token), exactly like the PCO path
 * which authenticates via the community's OAuth credentials. These internal
 * functions therefore skip the per-user `requireAuth`/`requirePlanScheduler`
 * gates used by the interactive scheduling mutations, and attribute writes to
 * the plan's `createdById`. They still schedule the same team-channel
 * reconciliation jobs the native assign/unassign paths schedule, so bot-made
 * assignments mirror into serving-team channels just like human-made ones.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { internal } from "../../_generated/api";
import type { PcoContext } from "./pcoSync";

// ============================================================================
// Shared helpers (read side — QueryCtx | MutationCtx)
// ============================================================================

/** Start of the current UTC day, in Unix ms. Events on/after this are "upcoming". */
function startOfTodayMs(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** Display name for a user, matching the rest of the app ("first last"). */
function displayName(user: Doc<"users"> | null): string {
  if (!user) return "Someone";
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Someone";
}

/**
 * Resolve the campus group for a community by name (case-insensitive substring
 * match against `groups.name`). Returns the first non-archived match.
 */
async function resolveCampusGroup(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  campusGroupName: string,
): Promise<Doc<"groups"> | null> {
  const needle = campusGroupName.toLowerCase();
  const groups = await ctx.db
    .query("groups")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  return (
    groups.find(
      (g) => !g.isArchived && g.name.toLowerCase().includes(needle),
    ) ?? null
  );
}

/**
 * Find the next upcoming native plan for a campus group — the earliest
 * `eventPlans` row whose `eventDate` is today or later. Draft and published
 * plans both count (a draft plan still means the community rosters natively).
 * Returns null when the group has no upcoming plan → callers fall back to PCO.
 */
async function findUpcomingPlan(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
): Promise<Doc<"eventPlans"> | null> {
  const cutoff = startOfTodayMs();
  const plans = await ctx.db
    .query("eventPlans")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  const upcoming = plans
    .filter((p) => p.eventDate >= cutoff)
    .sort((a, b) => a.eventDate - b.eventDate);
  return upcoming[0] ?? null;
}

/** Find a serving team in a group by name (case-insensitive substring). */
async function findTeamByName(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
  teamName: string,
): Promise<Doc<"teams"> | null> {
  const needle = teamName.toLowerCase();
  const teams = await ctx.db
    .query("teams")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  return (
    teams.find(
      (tm) => tm.isArchived !== true && tm.name.toLowerCase().includes(needle),
    ) ?? null
  );
}

/** Find a role on a team by name (case-insensitive exact match). */
async function findRoleByName(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
  roleName: string,
): Promise<Doc<"teamRoles"> | null> {
  const needle = roleName.toLowerCase();
  const roles = await ctx.db
    .query("teamRoles")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .collect();
  return (
    roles.find(
      (r) => r.isArchived !== true && r.name.toLowerCase() === needle,
    ) ?? null
  );
}

/** Whether a group membership is active (present, not left, request accepted). */
function isActiveMembership(m: Doc<"groupMembers">): boolean {
  return (
    !m.leftAt && (!m.requestStatus || m.requestStatus === "accepted")
  );
}

/**
 * Resolve a person by name to an active member of the campus group. Match is
 * case-insensitive: exact full-name first, then a partial match (full name
 * includes the query, or the query is just the first name). Returns null when
 * no unambiguous active group member matches.
 *
 * Unlike the PCO path (`findOrCreatePcoPerson`, which creates a PCO person on
 * miss), native assignment requires the person to already be an active member
 * of the campus group — `roleAssignments` reference a real `users` row and the
 * team-channel sync derives membership from them. A miss returns a clear
 * message so the bot can ask for a full name / add-to-group first.
 */
async function resolvePersonInGroup(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
  name: string,
): Promise<Doc<"users"> | null> {
  const query = name.trim().toLowerCase();
  if (!query) return null;

  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  const active = memberships.filter(isActiveMembership);

  const candidates: Array<{ user: Doc<"users">; full: string; first: string }> =
    [];
  for (const m of active) {
    const user = await ctx.db.get(m.userId);
    if (!user) continue;
    candidates.push({
      user,
      full: displayName(user).toLowerCase(),
      first: (user.firstName ?? "").trim().toLowerCase(),
    });
  }

  // 1. Exact full-name match.
  const exact = candidates.find((c) => c.full === query);
  if (exact) return exact.user;

  // 2. Partial: the stored name contains the query, or the query starts with
  //    the person's first name (handles "Kevin" → "Kevin Myers").
  const partial = candidates.filter(
    (c) =>
      c.full.includes(query) ||
      query.includes(c.full) ||
      (c.first && (query === c.first || query.startsWith(`${c.first} `))),
  );
  // Only return a partial match when it's unambiguous.
  return partial.length === 1 ? partial[0].user : null;
}

// ============================================================================
// Native Context Reader (parallels fetchPcoContextCore)
// ============================================================================

/** Run-sheet item segment ordering, mirroring `eventItems.listItems`. */
const SEGMENT_RANK: Record<string, number> = { before: 0, during: 1, after: 2 };

/**
 * Read the upcoming native plan's context for a community + campus group and
 * shape it exactly like `PcoContext` so the bot's prompt/status logic works
 * unchanged. Returns null when there's no native campus group or no upcoming
 * native plan — the signal to the caller to fall back to PCO.
 */
export const getNativeContext = internalQuery({
  args: {
    communityId: v.id("communities"),
    campusGroupName: v.string(),
  },
  handler: async (ctx, args): Promise<PcoContext | null> => {
    const group = await resolveCampusGroup(
      ctx,
      args.communityId,
      args.campusGroupName,
    );
    if (!group) return null;

    const plan = await findUpcomingPlan(ctx, group._id);
    if (!plan) return null;

    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();

    const teamMembers: PcoContext["teamMembers"] = [];
    const platformRoles: Record<string, string> = {};
    const platformRolesAll: Record<string, { name: string; status: string }> =
      {};

    for (const a of assignments) {
      const [role, team, user] = await Promise.all([
        ctx.db.get(a.roleId),
        ctx.db.get(a.teamId),
        ctx.db.get(a.userId),
      ]);
      const name = displayName(user);
      const position = role?.name ?? null;
      const teamName = team?.name ?? null;
      // Map native status to the PCO letter codes the prompt logic expects:
      // confirmed → "C", unconfirmed → "U", declined → "D".
      const status =
        a.status === "confirmed" ? "C" : a.status === "declined" ? "D" : "U";

      teamMembers.push({
        name,
        status,
        position,
        teamName,
        // `pcoPersonId` doubles as "an actual person is assigned" (vs a PCO
        // 'Needed' placeholder). Native rows always have a real user.
        pcoPersonId: a.userId as string,
      });

      // Only the Platform team's positions are "platform roles" (preacher,
      // meeting leader, …) — the same gate the PCO path applies
      // (pcoSync teamName.includes("platform")). Without it, every rostered
      // position on every team (Worship, Production, …) would be surfaced as a
      // platform role and a same-named role on another team could collide.
      if (position && teamName?.toLowerCase().includes("platform")) {
        if (status === "C") platformRoles[position] = name;
        if (status === "C" || status === "U") {
          platformRolesAll[position] = { name, status };
        }
      }
    }

    const rawItems = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    const segRank = (s: string | undefined) => SEGMENT_RANK[s ?? "during"] ?? 1;
    rawItems.sort(
      (a, b) => segRank(a.segment) - segRank(b.segment) || a.sequence - b.sequence,
    );

    const items: PcoContext["items"] = rawItems.map((i) => ({
      title: i.title,
      itemType: i.type,
      description: i.description ?? null,
      notes:
        i.notes && i.notes.length > 0
          ? i.notes.map((n) => n.content).filter(Boolean).join("\n") || null
          : null,
      length: i.durationSec ?? null,
    }));

    return {
      planId: plan._id as string,
      // No PCO service type for a native plan — carry the campus group id so the
      // shape is populated and debuggable.
      serviceTypeId: group._id as string,
      planDate: new Date(plan.eventDate).toISOString().split("T")[0],
      teamMembers,
      platformRoles,
      platformRolesAll,
      items,
    };
  },
});

/** People-search result shape shared with the PCO path. */
export interface NativePeopleResult {
  results: Array<{ name: string; position: string | null }>;
}

/**
 * Search active members of the campus group by name, annotating anyone already
 * rostered on the upcoming plan with their role/position. Native analog of
 * `searchPcoPeopleCore`. Returns null when there's no upcoming native plan
 * (caller falls back to PCO search).
 */
export const searchNativePeople = internalQuery({
  args: {
    communityId: v.id("communities"),
    campusGroupName: v.string(),
    query: v.string(),
  },
  handler: async (ctx, args): Promise<NativePeopleResult | null> => {
    const group = await resolveCampusGroup(
      ctx,
      args.communityId,
      args.campusGroupName,
    );
    if (!group) return null;
    const plan = await findUpcomingPlan(ctx, group._id);
    if (!plan) return null;

    const needle = args.query.trim().toLowerCase();

    // Positions on the upcoming plan, by user id.
    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    const positionByUser = new Map<string, string>();
    for (const a of assignments) {
      const role = await ctx.db.get(a.roleId);
      if (role) positionByUser.set(a.userId as string, role.name);
    }

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .collect();

    const results: NativePeopleResult["results"] = [];
    for (const m of memberships.filter(isActiveMembership)) {
      const user = await ctx.db.get(m.userId);
      if (!user) continue;
      const name = displayName(user);
      if (needle && !name.toLowerCase().includes(needle)) continue;
      results.push({
        name,
        position: positionByUser.get(user._id as string) ?? null,
      });
    }

    return { results };
  },
});

// ============================================================================
// Native Write Mutations (parallel the sync*ToPCO / *Core writers)
// ============================================================================

/** Common return shape for native writers: `handled: false` ⇒ fall back to PCO. */
interface NativeWriteResult {
  handled: boolean;
  success: boolean;
  detail: string;
}

/** Schedule the same team-channel reconciliation the native assign path uses. */
async function scheduleTeamChannelReconcile(
  ctx: MutationCtx,
  teamId: Id<"teams">,
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
    { teamId },
  );
  await ctx.scheduler.runAfter(
    0,
    internal.functions.scheduling.teamChannelSync
      .reconcileCrossTeamChannelsForSource,
    { sourceTeamId: teamId },
  );
}

/**
 * Assign a person (by name) to a semantic role on the upcoming native plan.
 * Resolves semantic role → native team + role, resolves the person to an active
 * campus-group member, inserts an `unconfirmed` `roleAssignments` row, and
 * schedules the team-channel reconcile. Idempotent: a re-assign of the same
 * person to the same role is reported as already-assigned, not an error.
 */
export const nativeAssignRole = internalMutation({
  args: {
    communityId: v.id("communities"),
    campusGroupName: v.string(),
    teamName: v.string(),
    roleName: v.string(),
    personName: v.string(),
  },
  handler: async (ctx, args): Promise<NativeWriteResult> => {
    const group = await resolveCampusGroup(
      ctx,
      args.communityId,
      args.campusGroupName,
    );
    if (!group) return { handled: false, success: false, detail: "No native campus group" };
    const plan = await findUpcomingPlan(ctx, group._id);
    if (!plan) return { handled: false, success: false, detail: "No upcoming native plan" };

    const team = await findTeamByName(ctx, group._id, args.teamName);
    if (!team) {
      return {
        handled: true,
        success: false,
        detail: `No native team matching "${args.teamName}" in ${group.name}`,
      };
    }
    const role = await findRoleByName(ctx, team._id, args.roleName);
    if (!role) {
      return {
        handled: true,
        success: false,
        detail: `No native role "${args.roleName}" on team ${team.name}`,
      };
    }

    const user = await resolvePersonInGroup(ctx, group._id, args.personName);
    if (!user) {
      return {
        handled: true,
        success: false,
        detail: `Could not find "${args.personName}" as an active member of ${group.name}`,
      };
    }

    // Idempotency: same person already on this role for this plan.
    const existing = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan_role", (q) =>
        q.eq("planId", plan._id).eq("roleId", role._id),
      )
      .collect();
    const existingForUser = existing.find((a) => a.userId === user._id);
    if (existingForUser) {
      if (existingForUser.status === "declined") {
        // Reopen a previously declined assignment. Returning a no-op success
        // here would tell Slack the person is assigned while the status
        // builders + placeholder resolver (which exclude declined rows) still
        // treat the role as unfilled and the team channel is never restored.
        await ctx.db.patch(existingForUser._id, {
          status: "unconfirmed",
          declineNote: undefined,
          respondedAt: undefined,
          assignedById: plan.createdById,
          assignedAt: Date.now(),
        });
        await scheduleTeamChannelReconcile(ctx, team._id);
        return {
          handled: true,
          success: true,
          detail: `Re-assigned ${displayName(user)} as ${args.roleName} (was declined)`,
        };
      }
      return {
        handled: true,
        success: true,
        detail: `${args.personName} already assigned to ${args.roleName}`,
      };
    }

    await ctx.db.insert("roleAssignments", {
      planId: plan._id,
      teamId: team._id,
      roleId: role._id,
      userId: user._id,
      eventDate: plan.eventDate,
      status: "unconfirmed",
      // Bot writes are system-level; attribute to the plan's creator (mirrors
      // how the PCO path acts as the community, not a specific user).
      assignedById: plan.createdById,
      assignedAt: Date.now(),
    });

    await scheduleTeamChannelReconcile(ctx, team._id);

    return {
      handled: true,
      success: true,
      detail: `Assigned ${displayName(user)} as ${args.roleName} (native)`,
    };
  },
});

/**
 * Remove a person (by name) from a semantic role on the upcoming native plan.
 * Hard-deletes the matching `roleAssignments` row (the slot reopens) and
 * schedules the team-channel reconcile — the native `unassign` behavior.
 */
export const nativeUnassignRole = internalMutation({
  args: {
    communityId: v.id("communities"),
    campusGroupName: v.string(),
    teamName: v.string(),
    roleName: v.string(),
    personName: v.string(),
  },
  handler: async (ctx, args): Promise<NativeWriteResult> => {
    const group = await resolveCampusGroup(
      ctx,
      args.communityId,
      args.campusGroupName,
    );
    if (!group) return { handled: false, success: false, detail: "No native campus group" };
    const plan = await findUpcomingPlan(ctx, group._id);
    if (!plan) return { handled: false, success: false, detail: "No upcoming native plan" };

    const team = await findTeamByName(ctx, group._id, args.teamName);
    const role = team ? await findRoleByName(ctx, team._id, args.roleName) : null;
    if (!team || !role) {
      return {
        handled: true,
        success: false,
        detail: `No native team/role for ${args.teamName} / ${args.roleName}`,
      };
    }

    const rows = await ctx.db
      .query("roleAssignments")
      .withIndex("by_plan_role", (q) =>
        q.eq("planId", plan._id).eq("roleId", role._id),
      )
      .collect();

    const needle = args.personName.trim().toLowerCase();
    const withNames = await Promise.all(
      rows.map(async (a) => ({
        a,
        name: displayName(await ctx.db.get(a.userId)).toLowerCase(),
      })),
    );
    // Prefer an exact full-name match; fall back to an unambiguous partial.
    // Never delete on a loose match when several people match the needle —
    // this is a hard-delete, so "remove Jon" must not delete Jonathan.
    let matches = withNames.filter((m) => m.name === needle);
    if (matches.length === 0) {
      matches = withNames.filter(
        (m) => m.name.includes(needle) || needle.includes(m.name),
      );
    }
    if (matches.length > 1) {
      return {
        handled: true,
        success: false,
        detail: `"${args.personName}" matches ${matches.length} people on ${args.roleName} — be more specific`,
      };
    }
    let removed: Id<"roleAssignments"> | null = null;
    if (matches.length === 1) {
      await ctx.db.delete(matches[0].a._id);
      removed = matches[0].a._id;
    }

    if (!removed) {
      return {
        handled: true,
        success: false,
        detail: `No ${args.roleName} named "${args.personName}" on the native plan`,
      };
    }

    await scheduleTeamChannelReconcile(ctx, team._id);
    return {
      handled: true,
      success: true,
      detail: `Removed ${args.personName} from ${args.roleName} (native)`,
    };
  },
});

/**
 * Update a run-sheet item on the upcoming native plan, matching the item by a
 * title pattern ("a|b|c", case-insensitive substring — same convention as the
 * PCO path). Writes to the item's `description` or its categorized `notes`,
 * optionally preserving named sections (e.g. keep GIVING when replacing
 * ANNOUNCEMENTS). Native analog of `updatePlanItemCore`'s item write.
 */
export const nativeUpdateItem = internalMutation({
  args: {
    communityId: v.id("communities"),
    campusGroupName: v.string(),
    titlePattern: v.string(),
    field: v.string(), // "description" | "notes"
    content: v.string(),
    preserveSections: v.optional(v.array(v.string())),
    noteCategory: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<NativeWriteResult> => {
    const group = await resolveCampusGroup(
      ctx,
      args.communityId,
      args.campusGroupName,
    );
    if (!group) return { handled: false, success: false, detail: "No native campus group" };
    const plan = await findUpcomingPlan(ctx, group._id);
    if (!plan) return { handled: false, success: false, detail: "No upcoming native plan" };

    const patterns = args.titlePattern
      .split("|")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    const items = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();
    const item = items.find((i) =>
      patterns.some((p) => i.title.toLowerCase().includes(p)),
    );
    if (!item) {
      return {
        handled: true,
        success: false,
        detail: `No native run-sheet item matching "${args.titlePattern}"`,
      };
    }

    const field = args.field === "notes" ? "notes" : "description";

    if (field === "notes") {
      const category = args.noteCategory || "Notes";
      await ctx.db.patch(item._id, {
        notes: [{ category, content: args.content }],
        updatedAt: Date.now(),
      });
    } else {
      let finalContent = args.content;
      if (args.preserveSections && args.preserveSections.length > 0) {
        const existing = item.description ?? "";
        const preserved = extractPreservedSections(existing, args.preserveSections);
        if (preserved.length > 0) {
          finalContent = `${args.content}\n\n${preserved.join("\n\n")}`;
        }
      }
      await ctx.db.patch(item._id, {
        description: finalContent,
        updatedAt: Date.now(),
      });
    }

    return {
      handled: true,
      success: true,
      detail: `Updated "${item.title}" ${field} on the native plan`,
    };
  },
});

/**
 * Pull the text of named sections out of an existing description so a replace
 * can re-append them (e.g. keep GIVING when overwriting ANNOUNCEMENTS). Mirrors
 * the preserve-section logic in `updatePlanItemCore`.
 */
function extractPreservedSections(existing: string, sections: string[]): string[] {
  const preserved: string[] = [];
  const allHeaders = sections.map((s) => `\\b${s}\\b`).join("|");
  for (const section of sections) {
    const regex = new RegExp(
      `\\n?(\\b${section}\\b[\\s\\S]*?)(?=\\n(?:${allHeaders})|$)`,
      "i",
    );
    const match = existing.match(regex);
    if (match) preserved.push(match[1].trimEnd());
  }
  return preserved;
}

/**
 * Add setlist songs to the upcoming native plan's run sheet as `song` items
 * (native analog of `syncSetlistToPCO`). Appends each new title to the end of
 * the "during" segment, skipping titles already present as song items so a
 * re-sync doesn't duplicate. Returns the number actually added.
 */
export const nativeSyncSetlist = internalMutation({
  args: {
    communityId: v.id("communities"),
    campusGroupName: v.string(),
    songs: v.array(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<NativeWriteResult & { songsAdded?: number }> => {
    const group = await resolveCampusGroup(
      ctx,
      args.communityId,
      args.campusGroupName,
    );
    if (!group) return { handled: false, success: false, detail: "No native campus group" };
    const plan = await findUpcomingPlan(ctx, group._id);
    if (!plan) return { handled: false, success: false, detail: "No upcoming native plan" };

    const existing = await ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", plan._id))
      .collect();

    const existingSongTitles = new Set(
      existing
        .filter((i) => i.type === "song")
        .map((i) => i.title.trim().toLowerCase()),
    );
    // Append new songs after the last "during" item.
    let nextSequence =
      existing.reduce(
        (max, i) =>
          (i.segment ?? "during") === "during" ? Math.max(max, i.sequence) : max,
        -1,
      ) + 1;

    let added = 0;
    const nowMs = Date.now();
    for (const raw of args.songs) {
      const title = raw.trim();
      if (!title || existingSongTitles.has(title.toLowerCase())) continue;
      await ctx.db.insert("eventItems", {
        planId: plan._id,
        communityId: group.communityId,
        segment: "during",
        sequence: nextSequence++,
        type: "song",
        title,
        durationSec: 0,
        createdAt: nowMs,
        createdById: plan.createdById,
        updatedAt: nowMs,
      });
      existingSongTitles.add(title.toLowerCase());
      added += 1;
    }

    return {
      handled: true,
      success: true,
      detail: `Added ${added} song${added === 1 ? "" : "s"} to the native run sheet`,
      songsAdded: added,
    };
  },
});
