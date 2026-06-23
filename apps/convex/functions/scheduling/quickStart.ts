/**
 * Scheduling — one-tap rostering quick-start (ADR-025).
 *
 * A leader who opens rostering on a brand-new group hits a blank slate: they
 * must manually create a team, add roles, then create an event plan before
 * anything is usable. `quickStartRostering` collapses that into a single tap
 * by composing the existing creation paths:
 *
 *   1. a starter serving team (via `createServingTeamImpl`, the same path
 *      `createServingTeam` uses — including its chat channel),
 *   2. suggested starter roles on it (from `suggestStarterRolesForName` —
 *      a generic name yields Team Lead + Volunteer),
 *   3. a draft event plan dated with the SAME neutral default the manual
 *      "New event plan" flow uses (next Sunday at 9 AM, local). The group's
 *      cadence is deliberately NOT read — a service date is leader-owned and
 *      meaningful, so the leader tunes it in the editor.
 *   4. that plan's needed roles, seeded from the team's role defaults.
 *
 * It is strictly additive and idempotent: if the group already has any
 * rostering data (a team OR an event plan) it does nothing and returns
 * `{ alreadySetUp: true }`, so the UI never double-creates. It never deletes
 * or overwrites anything.
 *
 * Auth: campus group leader or community admin (same gate as the rostering
 * hub and `createServingTeam` / `createEvent`).
 */

import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { requireGroupScheduler } from "./permissions";
import { createServingTeamImpl } from "./teams";
import { createEventDraftImpl, seedNeededRolesFromDefaultsImpl } from "./events";
import { suggestStarterRolesForName } from "./starterRoles";

/** Default starter team name — generic so any group fits; leader can rename. */
const STARTER_TEAM_NAME = "Serving Team";

/**
 * Next Sunday at 9:00 AM local time. Mirrors the client `nextSundayAtNine`
 * default in `EventListScreen` so a quick-started plan and a manually-created
 * one share the same neutral placeholder date.
 */
function nextSundayAtNine(): Date {
  const d = new Date();
  const daysUntilSunday = (7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSunday);
  d.setHours(9, 0, 0, 0);
  return d;
}

export const quickStartRostering = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const group = await requireGroupScheduler(ctx, args.groupId, userId);

    // Idempotency: only bootstrap a truly blank slate. If the group already
    // has any team OR any event plan, do nothing destructive — signal a no-op
    // so the UI just refreshes into the populated hub.
    const existingTeam = await ctx.db
      .query("teams")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .first();
    const existingPlan = await ctx.db
      .query("eventPlans")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .first();
    if (existingTeam || existingPlan) {
      return { alreadySetUp: true, teamId: null, planId: null };
    }

    // 1. Starter team (with its chat channel) via the normal team path.
    const { teamId } = await createServingTeamImpl(ctx, {
      groupId: args.groupId,
      communityId: group.communityId,
      name: STARTER_TEAM_NAME,
      createdById: userId,
    });

    // 2. Suggested starter roles on the team — the same set TeamSetupScreen
    // offers. A generic name → Team Lead + Volunteer. Colors are left unset
    // (optional, cosmetic); the leader can color roles later, exactly as the
    // manual `createRole` path allows.
    const starterRoles = suggestStarterRolesForName(STARTER_TEAM_NAME);
    const now = Date.now();
    for (let i = 0; i < starterRoles.length; i++) {
      const role = starterRoles[i];
      await ctx.db.insert("teamRoles", {
        teamId,
        communityId: group.communityId,
        name: role.name,
        sortOrder: i,
        defaultNeeded: role.defaultNeeded,
        isArchived: false,
        createdAt: now,
        createdById: userId,
      });
    }

    // 3. A draft event plan dated with the neutral manual default. The leader
    // owns the real date and edits it in the editor.
    const eventDate = nextSundayAtNine().getTime();
    const planId = await createEventDraftImpl(ctx, {
      groupId: args.groupId,
      communityId: group.communityId,
      title: "Untitled event plan",
      eventDate,
      times: [{ label: "9:00 AM", startsAt: eventDate }],
      createdById: userId,
    });

    // 4. Seed the plan's needed roles from the team's role defaults. The team
    // was just created above, so it provably belongs to this group — the
    // group-team check the mutation enforces is satisfied by construction.
    await seedNeededRolesFromDefaultsImpl(ctx, planId, [teamId]);

    return { alreadySetUp: false, teamId, planId };
  },
});
