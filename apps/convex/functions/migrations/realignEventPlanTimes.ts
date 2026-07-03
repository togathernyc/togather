/**
 * Migration: realign eventPlans.times[].startsAt onto the plan's eventDate
 *
 * Root cause (fixed separately in events.ts updateEvent): rescheduling a plan
 * patched `eventDate` WITHOUT recomputing `times[].startsAt`, so the service
 * times were stranded on the OLD calendar day. `duplicateEvent` then faithfully
 * propagated that fixed gap into every weekly copy — so a whole series of plans
 * drifted by a constant whole-day (usually whole-week) offset. The `label`
 * strings ("9:00 AM") stayed correct; only the absolute `startsAt` timestamps
 * were wrong, which silently decouples the serving window
 * (`scheduling/serving.getServingEligibility`, which keys off `times[].startsAt`)
 * from the real event date so day-of serving mode never activates.
 *
 * This backfill re-lands each service time on `eventDate`'s day while preserving
 * its own time-of-day. The shift is a whole number of days:
 *
 *   dayShift    = round((eventDate - startsAt) / DAY)   // days, sign included
 *   newStartsAt = startsAt + dayShift * DAY
 *
 * Rounding is timezone- and DST-agnostic: the corruption is always a whole-day
 * (whole-week) drift, and rounding absorbs the sub-day remainder between the
 * plan's eventDate anchor (its default 9 AM) and each service's own time-of-day.
 * A time already on the right day (|gap| < ~12h) rounds to 0 and is left alone,
 * so the migration is idempotent. NOTE: this assumes services sit within ~12h of
 * the eventDate anchor (true for all current data — morning services). A service
 * more than ~12h from the anchor on the SAME day could be mis-shifted, so the
 * dry-run output lists every change for review before applying.
 *
 * Idempotent: re-running finds nothing to change once aligned.
 * Pass `communityId` to scope to one community; omit to scan every plan.
 * Pass `dryRun: true` to report the exact before/after without writing.
 *
 * Usage:
 *   # dry run for one community
 *   npx convex run functions/migrations/realignEventPlanTimes:realignEventPlanTimes '{"communityId":"<id>","dryRun":true}'
 *   # apply for one community
 *   npx convex run functions/migrations/realignEventPlanTimes:realignEventPlanTimes '{"communityId":"<id>"}'
 *   # dry run for the whole deployment
 *   npx convex run functions/migrations/realignEventPlanTimes:realignEventPlanTimes '{"dryRun":true}'
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";

const DAY = 86_400_000;

export const realignEventPlanTimes = internalMutation({
  args: {
    communityId: v.optional(v.id("communities")),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const now = Date.now();

    const plans = args.communityId
      ? await ctx.db
          .query("eventPlans")
          .withIndex("by_community_date", (q) =>
            q.eq("communityId", args.communityId!),
          )
          .collect()
      : await ctx.db.query("eventPlans").collect();

    const changes: Array<Record<string, unknown>> = [];
    let scanned = 0;
    let changedPlans = 0;
    let changedTimes = 0;

    for (const plan of plans) {
      scanned++;
      if (!plan.times || plan.times.length === 0) continue;

      let planChanged = false;
      const newTimes = plan.times.map((t) => {
        const dayShift = Math.round((plan.eventDate - t.startsAt) / DAY);
        if (dayShift === 0) return t;
        planChanged = true;
        changedTimes++;
        return { ...t, startsAt: t.startsAt + dayShift * DAY };
      });

      if (!planChanged) continue;
      changedPlans++;

      changes.push({
        planId: plan._id,
        title: plan.title,
        status: plan.status,
        eventDate: new Date(plan.eventDate).toISOString(),
        before: plan.times.map((t) => ({
          label: t.label,
          startsAt: new Date(t.startsAt).toISOString(),
        })),
        after: newTimes.map((t) => ({
          label: t.label,
          startsAt: new Date(t.startsAt).toISOString(),
        })),
      });

      if (!dryRun) {
        await ctx.db.patch(plan._id, { times: newTimes, updatedAt: now });
      }
    }

    return {
      dryRun,
      scanned,
      changedPlans,
      changedTimes,
      changes,
    };
  },
});
