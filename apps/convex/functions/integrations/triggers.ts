/**
 * Marketing integration sync triggers.
 *
 * Helper internal actions that fan out Clearstream + Flodesk sync for a user
 * across all the communities they're an active member of. Used by the
 * profile-update mutation — community-join sites schedule the per-platform
 * syncs directly since they already know the community ID.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";

/** Active membership status. `userCommunities.status === 1` */
const ACTIVE_MEMBERSHIP_STATUS = 1;

export const _getActiveCommunityIdsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return memberships
      .filter((m) => m.status === ACTIVE_MEMBERSHIP_STATUS)
      .map((m) => m.communityId);
  },
});

/**
 * Schedule Clearstream + Flodesk sync for a user across all their active
 * communities. Called when a user's profile data (firstName/lastName) changes
 * globally and we need to refresh every linked marketing list/segment.
 *
 * Each per-community sync is a no-op if that community has no marketing
 * integration connected, so over-firing is cheap.
 */
export const syncUserAllCommunities = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<void> => {
    const communityIds = await ctx.runQuery(
      internal.functions.integrations.triggers._getActiveCommunityIdsForUser,
      { userId: args.userId },
    );
    for (const communityId of communityIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.integrations.clearstream.syncUser,
        { communityId, userId: args.userId },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.functions.integrations.flodesk.syncUser,
        { communityId, userId: args.userId },
      );
    }
  },
});
