/**
 * Scheduling — My Schedule
 *
 * The volunteer-facing view: a user's own upcoming assignments joined with
 * event, role, and serving-team display info.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";

/**
 * The signed-in user's upcoming role assignments, soonest first.
 *
 * Auth: any authenticated user (returns only that user's own assignments).
 */
export const myAssignments = query({
  args: {
    token: v.string(),
    /** Include assignments whose event date is in the past (default false). */
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const assignments = await ctx.db
      .query("roleAssignments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const cutoff = startOfTodayMs();
    const visible = assignments
      .filter((a) => args.includePast || a.eventDate >= cutoff)
      .sort((a, b) => a.eventDate - b.eventDate);

    return Promise.all(
      visible.map(async (assignment) => {
        const [plan, role, team] = await Promise.all([
          ctx.db.get(assignment.planId),
          ctx.db.get(assignment.roleId),
          ctx.db.get(assignment.teamId),
        ]);
        return {
          _id: assignment._id,
          planId: assignment.planId,
          eventTitle: plan?.title ?? "Event",
          eventDate: assignment.eventDate,
          eventStatus: plan?.status ?? "draft",
          roleName: role?.name ?? "Role",
          roleColor: role?.color,
          teamName: team?.name ?? "Team",
          status: assignment.status,
          timeLabel: assignment.timeLabel,
          declineNote: assignment.declineNote,
        };
      }),
    );
  },
});

/** Midnight (local server time) at the start of today, in ms. */
function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
