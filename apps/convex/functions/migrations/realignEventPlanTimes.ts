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
 * To avoid ever corrupting a *legitimately* same-day service, we only realign
 * when the drift is an unambiguous whole-day gap of **>= 2 days** (`MIN_DRIFT`).
 * Real corruption in the data is always multiple days (observed 4–28 days), while
 * any genuine same-day or adjacent-day service sits within ~24h of the eventDate
 * anchor — so a late-evening service (e.g. 10 PM, or a US late service whose UTC
 * timestamp lands on the next UTC day) is never mistaken for drift and moved.
 *
 * DST note: adding whole UTC days preserves the wall-clock time only when the
 * stranded time and its target date are in the same DST period. All target data
 * is single-period (June–July, EDT), so this is exact; the dry-run below lists
 * every before/after so a cross-DST wall-clock shift would be caught in review
 * before applying. (A fully DST-general fix would need a per-plan timezone, which
 * eventPlans does not carry.)
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
/**
 * Minimum whole-day drift (in days) before we realign a service time. Anything
 * smaller is treated as a legitimate same-day/adjacent-day offset and left
 * alone, so a late-evening service is never mistaken for corruption. Real drift
 * in the data is always several days (whole weeks), so this loses nothing.
 */
const MIN_DRIFT_DAYS = 2;

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
        // Only realign unambiguous multi-day drift; leave same-day/adjacent
        // services (incl. legitimate late-evening ones) untouched.
        if (Math.abs(dayShift) < MIN_DRIFT_DAYS) return t;
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
