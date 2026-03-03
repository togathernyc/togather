/**
 * FOUNT Service Planning Bot - Admin Queries
 *
 * Public queries with auth for the admin config page.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { requireCommunityAdmin } from "../../lib/permissions";

/**
 * Get the slack bot config for the admin page.
 */
export const getSlackBotConfig = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();

    return config;
  },
});

/**
 * Get bot status — lightweight query for status indicator.
 */
export const getSlackBotStatus = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();

    if (!config) return { configured: false, enabled: false };

    return {
      configured: true,
      enabled: config.enabled,
      devMode: config.devMode,
      teamMemberCount: config.teamMembers.length,
      lastUpdated: config.updatedAt,
    };
  },
});
