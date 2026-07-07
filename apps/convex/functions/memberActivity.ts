/**
 * Per-active-user billing activity.
 *
 * Togather bills $1/month per *billable active member* of a community, using
 * the same heuristic as the admin Stats "Active Members" card: people who
 * opened the app in this community within the past month. Activity is
 * per-community — userCommunities.lastLogin, stamped when the user logs in,
 * switches to the community, or foregrounds the app while it's their active
 * community (users.recordActivity) — so being active in one community never
 * makes you billable in another.
 *
 * A member is billable when all of these hold:
 *   - their membership is active (userCommunities.status === 1),
 *   - they are a real account (not an isPlaceholder provisional/demo user),
 *   - they opened the app in this community within the past month
 *     (membership.lastLogin — strictly; members who were added or imported
 *     but never opened the app here are NOT billable).
 *
 * This is entirely automatic and cannot be overridden — there is deliberately
 * no way for an admin to mark an active member as non-billable (that would let
 * a community zero out its bill while members keep using the app). The 30-day
 * activity rule is the single source of truth.
 *
 * The count is used when a demo community converts to live (initial Stripe
 * subscription quantity, see functions/ee/billing.ts convertDemoToLive) and
 * by the monthly cron that keeps the Stripe quantity in sync.
 */

import { v } from "convex/values";
import { query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { now } from "../lib/utils";

/**
 * "Opened the app in this community within the past month" — the same
 * 30-day window the admin Stats "Active Members" card uses
 * (functions/admin/stats.ts), so the number admins see is the number
 * they're billed for.
 */
export const ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Count the members of a community who count toward the per-active-user bill.
 * Exported for reuse by billing (demo conversion + monthly quantity sync).
 */
export async function countBillableActiveUsers(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
): Promise<number> {
  const cutoff = now() - ACTIVITY_WINDOW_MS;

  const memberships = await ctx.db
    .query("userCommunities")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();

  let count = 0;
  for (const membership of memberships) {
    if (membership.status !== 1) continue;

    const user = await ctx.db.get(membership.userId);
    if (!user || user.isPlaceholder) continue;

    // Per-community activity only, and strictly lastLogin: it's stamped on
    // login, community switch, join, and app foreground (users.recordActivity),
    // so anyone who actually entered the community has it. Members who were
    // added/imported (e.g. PCO sync) but never opened the app here must not
    // bill — that's the promise in the admin copy and the Stats card.
    if ((membership.lastLogin ?? 0) >= cutoff) count++;
  }
  return count;
}

/**
 * Billing-activity summary for a community — powers the go-live screen and
 * admin billing surfaces ("N active members × $1/month").
 */
export const getBillableSummary = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    // Any member may see the count (it's shown on the demo go-live screen);
    // it exposes no per-person data.
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId),
      )
      .first();
    if (!membership || membership.status !== 1) {
      throw new Error("Not a member of this community");
    }

    const billableActiveUsers = await countBillableActiveUsers(
      ctx,
      args.communityId,
    );
    return {
      billableActiveUsers,
      monthlyPriceUsd: billableActiveUsers, // $1 per active user
    };
  },
});
