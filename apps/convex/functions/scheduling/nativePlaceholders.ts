/**
 * Native rostering resolution for communication-bot message placeholders.
 *
 * Communication bots let leaders write messages with position placeholders that
 * get expanded into the first names of whoever is scheduled, e.g.
 *   "Hey {{Worship > Vocals}}, you're on this Sunday!"
 *
 * Historically these resolved against Planning Center (PCO) `team_members`.
 * This module is the NATIVE-FIRST path: it resolves against the app's own
 * scheduling data (`teams` → `teamRoles` → upcoming `eventPlans` →
 * `roleAssignments`). The PCO resolver in `pcoServices/actions.ts` remains as
 * the fallback for communities with no native match.
 *
 * Placeholder formats accepted:
 *   - Native 2-part:  {{Team > Role}}
 *   - Legacy 3-part:  {{ServiceType > Team > Position}}  (last two segments
 *     are treated as Team/Role, so the same string resolves either way)
 */

import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";

/** Assignment statuses that count as "scheduled" (mirrors the PCO non-declined rule). */
const SCHEDULED_STATUSES = new Set(["confirmed", "unconfirmed"]);

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Format a list of names with proper grammar. Parallels
 * `formatNamesList` in `pcoServices/actions.ts` so native and PCO output match.
 */
export function formatNamesList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export interface NativePlaceholder {
  fullMatch: string;
  teamName: string;
  roleName: string;
  /** Present only for legacy 3-part placeholders; enables PCO fallback. */
  serviceTypeName?: string;
}

/**
 * Parse `{{...}}` placeholders from a message, accepting BOTH the native
 * 2-part (`Team > Role`) and legacy 3-part (`ServiceType > Team > Position`)
 * shapes. For 3-part, the last two segments are used as Team/Role.
 */
export function parseNativePlaceholders(message: string): NativePlaceholder[] {
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  const placeholders: NativePlaceholder[] = [];

  let match;
  while ((match = placeholderRegex.exec(message)) !== null) {
    const segments = match[1].split(">").map((s) => s.trim());
    if (segments.length === 2) {
      placeholders.push({
        fullMatch: match[0],
        teamName: segments[0],
        roleName: segments[1],
      });
    } else if (segments.length >= 3) {
      // Legacy 3-part: last two segments are Team/Role; keep the leading
      // ServiceType so the caller can fall back to PCO if native misses.
      placeholders.push({
        fullMatch: match[0],
        serviceTypeName: segments.slice(0, -2).join(" > "),
        teamName: segments[segments.length - 2],
        roleName: segments[segments.length - 1],
      });
    }
    // 1-segment placeholders (`{{Foo}}`) are not position placeholders; skip.
  }

  return placeholders;
}

/**
 * Pick the plan to resolve against for a group: the next upcoming plan
 * (eventDate >= today), preferring a published one over a draft.
 */
function pickUpcomingPlan(plans: Doc<"eventPlans">[]): Doc<"eventPlans"> | null {
  const cutoff = startOfTodayMs();
  const upcoming = plans
    .filter((p) => p.eventDate >= cutoff)
    .sort((a, b) => a.eventDate - b.eventDate);
  if (upcoming.length === 0) return null;
  const published = upcoming.find((p) => p.status === "published");
  return published ?? upcoming[0];
}

/**
 * Resolve a batch of placeholders against native rostering data.
 *
 * For each placeholder we match `teams.name` (case-insensitive), then
 * `teamRoles.name` within that team, then read the non-declined
 * `roleAssignments` on that team's next upcoming plan. `matched` is true when a
 * team+role was found in native data — the caller uses it to decide whether to
 * fall back to PCO (fallback only when `matched` is false).
 */
export const resolveNativePlaceholders = internalQuery({
  args: {
    communityId: v.id("communities"),
    /** Optional bot group — when set, teams/plans are scoped to this group. */
    groupId: v.optional(v.id("groups")),
    placeholders: v.array(
      v.object({
        fullMatch: v.string(),
        teamName: v.string(),
        roleName: v.string(),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{ fullMatch: string; matched: boolean; names: string[] }>
  > => {
    // Candidate teams: scoped to the bot's group when provided, else the whole
    // community. Archived teams never resolve.
    const teams = (
      args.groupId
        ? await ctx.db
            .query("teams")
            .withIndex("by_group", (q) => q.eq("groupId", args.groupId!))
            .collect()
        : await ctx.db
            .query("teams")
            .withIndex("by_community", (q) =>
              q.eq("communityId", args.communityId),
            )
            .collect()
    ).filter((t) => !t.isArchived);

    // Cache upcoming-plan and role lookups per group/team to avoid rework when
    // several placeholders target the same team.
    const plansByGroup = new Map<string, Doc<"eventPlans"> | null>();
    const rolesByTeam = new Map<string, Doc<"teamRoles">[]>();

    const getUpcomingPlan = async (
      groupId: Id<"groups">,
    ): Promise<Doc<"eventPlans"> | null> => {
      const key = groupId as string;
      if (plansByGroup.has(key)) return plansByGroup.get(key) ?? null;
      const plans = await ctx.db
        .query("eventPlans")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      const plan = pickUpcomingPlan(plans);
      plansByGroup.set(key, plan);
      return plan;
    };

    const getRoles = async (
      teamId: Id<"teams">,
    ): Promise<Doc<"teamRoles">[]> => {
      const key = teamId as string;
      const cached = rolesByTeam.get(key);
      if (cached) return cached;
      const roles = (
        await ctx.db
          .query("teamRoles")
          .withIndex("by_team", (q) => q.eq("teamId", teamId))
          .collect()
      ).filter((r) => !r.isArchived);
      rolesByTeam.set(key, roles);
      return roles;
    };

    // Resolve each unique placeholder once.
    const resultByMatch = new Map<
      string,
      { matched: boolean; names: string[] }
    >();

    for (const ph of args.placeholders) {
      if (resultByMatch.has(ph.fullMatch)) continue;

      const teamName = ph.teamName.toLowerCase();
      const roleName = ph.roleName.toLowerCase();

      let resolved: { matched: boolean; names: string[] } = {
        matched: false,
        names: [],
      };

      for (const team of teams) {
        if (team.name.trim().toLowerCase() !== teamName) continue;
        const roles = await getRoles(team._id);
        const role = roles.find(
          (r) => r.name.trim().toLowerCase() === roleName,
        );
        if (!role) continue;

        // Team + role found natively — this is a match regardless of whether
        // anyone is currently scheduled.
        const plan = await getUpcomingPlan(team.groupId);
        let names: string[] = [];
        if (plan) {
          const assignments = await ctx.db
            .query("roleAssignments")
            .withIndex("by_plan_role", (q) =>
              q.eq("planId", plan._id).eq("roleId", role._id),
            )
            .collect();
          const users = await Promise.all(
            assignments
              .filter((a) => SCHEDULED_STATUSES.has(a.status))
              .map((a) => ctx.db.get(a.userId)),
          );
          names = users
            .filter((u): u is Doc<"users"> => u !== null)
            .map((u) => (u.firstName ?? "").trim())
            .filter((n) => n.length > 0);
        }
        resolved = { matched: true, names };
        break;
      }

      resultByMatch.set(ph.fullMatch, resolved);
    }

    return args.placeholders.map((ph) => ({
      fullMatch: ph.fullMatch,
      ...(resultByMatch.get(ph.fullMatch) ?? { matched: false, names: [] }),
    }));
  },
});

/**
 * Native position suggestions for the communication-bot autocomplete:
 * every non-archived team × role in the community (or a single group), shaped
 * as `Team > Role` placeholder suggestions. Parallels the PCO
 * `getAvailablePositions` action but reads native rostering data.
 *
 * Community-member gated (the bot config UI is leader-facing).
 */
export const getNativePositions = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    /** Optional — scope suggestions to a single group's teams. */
    groupId: v.optional(v.id("groups")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{ teamName: string; roleName: string; displayName: string }>
  > => {
    const userId = await requireAuth(ctx, args.token);

    // Require active community membership.
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId),
      )
      .first();
    if (!membership || membership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    const teams = (
      args.groupId
        ? await ctx.db
            .query("teams")
            .withIndex("by_group", (q) => q.eq("groupId", args.groupId!))
            .collect()
        : await ctx.db
            .query("teams")
            .withIndex("by_community", (q) =>
              q.eq("communityId", args.communityId),
            )
            .collect()
    ).filter((t) => !t.isArchived);

    const suggestions: Array<{
      teamName: string;
      roleName: string;
      displayName: string;
    }> = [];

    for (const team of teams) {
      const roles = (
        await ctx.db
          .query("teamRoles")
          .withIndex("by_team", (q) => q.eq("teamId", team._id))
          .collect()
      ).filter((r) => !r.isArchived);
      for (const role of roles) {
        suggestions.push({
          teamName: team.name,
          roleName: role.name,
          displayName: `${team.name} > ${role.name}`,
        });
      }
    }

    suggestions.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return suggestions;
  },
});
