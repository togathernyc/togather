/**
 * Scheduling — teams
 *
 * A "serving team" is just a chat channel with `isServingTeam = true`
 * (ADR-023, channel-as-team model). These functions opt a channel in/out of
 * being a team and list a campus group's team channels.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { isScheduler } from "./permissions";

/**
 * Mark (or unmark) a channel as a serving team.
 *
 * Auth: channel admin/moderator, campus group leader, or community admin.
 * Returns the channel id and its new `isServingTeam` value.
 */
export const markChannelAsTeam = mutation({
  args: {
    token: v.string(),
    channelId: v.id("chatChannels"),
    /** Defaults to `true` (mark as team). Pass `false` to unmark. */
    isTeam: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const channel = await ctx.db.get(args.channelId);
    if (!channel) {
      throw new ConvexError("Channel not found");
    }
    if (!(await isScheduler(ctx, channel, userId))) {
      throw new ConvexError(
        "You must be a team admin, group leader, or community admin to set up a serving team",
      );
    }

    const isTeam = args.isTeam ?? true;
    await ctx.db.patch(args.channelId, {
      isServingTeam: isTeam,
      updatedAt: Date.now(),
    });

    return { channelId: args.channelId, isServingTeam: isTeam };
  },
});

/**
 * List the serving-team channels for a campus group.
 *
 * Auth: any active member of the group (read-only roster info).
 */
export const listTeamChannels = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.token);

    const channels = await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    return channels
      .filter((channel) => channel.isServingTeam === true)
      .map((channel) => ({
        _id: channel._id,
        name: channel.name,
        channelType: channel.channelType,
        memberCount: channel.memberCount,
      }));
  },
});
