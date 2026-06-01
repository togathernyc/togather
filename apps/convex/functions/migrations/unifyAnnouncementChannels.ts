/**
 * Migration: unify announcement-group channels onto the standard two-channel model
 *
 * Historically the community-wide announcement group's "general" channel
 * (channelType "main") was treated as leaders-only via a frontend-only
 * `isAnnouncementGroup` gate. We've since shipped a proper, server-enforced
 * leaders-only "announcements" channel that every group can use. This backfill
 * converts each announcement group onto that model:
 *
 *   1. Convert the existing general channel IN PLACE: channelType "main" ->
 *      "announcements", slug "general" -> "announcements". The channel id is
 *      unchanged, so every historical message and channel member stays attached
 *      — the old leader announcements become the announcements-channel history.
 *   2. Create a fresh, empty "general" channel (channelType "main") that is
 *      open to everyone, and add all active group members to it.
 *
 * Idempotent: any announcement group that already has an "announcements"
 * channel is skipped. Pass `communityId` to scope to a single community
 * (e.g. Fount); omit to migrate every announcement group. Pass
 * `dryRun: true` to report what would change without writing.
 *
 * Usage:
 *   # dry run for one community
 *   npx convex run functions/migrations/unifyAnnouncementChannels:migrateAnnouncementGroupChannels '{"communityId":"<id>","dryRun":true}'
 *   # apply for one community
 *   npx convex run functions/migrations/unifyAnnouncementChannels:migrateAnnouncementGroupChannels '{"communityId":"<id>"}'
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";

export const migrateAnnouncementGroupChannels = internalMutation({
  args: {
    communityId: v.optional(v.id("communities")),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    const now = Date.now();

    // Collect target announcement groups.
    const announcementGroups = args.communityId
      ? await ctx.db
          .query("groups")
          .withIndex("by_community", (q) =>
            q.eq("communityId", args.communityId!)
          )
          .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
          .collect()
      : await ctx.db
          .query("groups")
          .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
          .collect();

    const results: Array<Record<string, unknown>> = [];

    for (const group of announcementGroups) {
      // Already migrated? An announcements channel already exists.
      const existingAnnouncements = await ctx.db
        .query("chatChannels")
        .withIndex("by_group_type", (q) =>
          q.eq("groupId", group._id).eq("channelType", "announcements")
        )
        .first();
      if (existingAnnouncements) {
        results.push({
          groupId: group._id,
          name: group.name,
          status: "already_migrated",
          announcementsChannelId: existingAnnouncements._id,
        });
        continue;
      }

      // Find the general/main channel to convert in place.
      const mainChannel = await ctx.db
        .query("chatChannels")
        .withIndex("by_group_type", (q) =>
          q.eq("groupId", group._id).eq("channelType", "main")
        )
        .filter((q) => q.eq(q.field("isArchived"), false))
        .first();
      if (!mainChannel) {
        results.push({
          groupId: group._id,
          name: group.name,
          status: "no_main_channel",
        });
        continue;
      }

      if (dryRun) {
        results.push({
          groupId: group._id,
          name: group.name,
          status: "would_migrate",
          convertChannelId: mainChannel._id,
        });
        continue;
      }

      // 1) Convert the existing general channel -> announcements, in place.
      //    Messages and channel members stay attached (channel id unchanged),
      //    so the announcements channel inherits the full community membership
      //    that the old general channel already had.
      await ctx.db.patch(mainChannel._id, {
        channelType: "announcements",
        slug: "announcements",
        name: "Announcements",
        description:
          "Leader announcements — visible to all members; only leaders can post.",
        isEnabled: true,
        isArchived: false,
        archivedAt: undefined,
        updatedAt: now,
      });

      // 2) Create a fresh, empty general channel open to everyone.
      const newGeneralId = await ctx.db.insert("chatChannels", {
        groupId: group._id,
        slug: "general",
        channelType: "main",
        name: `${group.name} - General`,
        description: `General chat for ${group.name}`,
        createdById: mainChannel.createdById,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 0,
      });

      // 3) Populate the new general channel with all active group members in
      //    scheduled batches. The announcement group spans the whole community
      //    (~thousands of members), so iterating them inline would exceed the
      //    per-call read limit. Batched populate sets memberCount when done.
      await ctx.scheduler.runAfter(
        0,
        internal.functions.messaging.channels.populateChannelMembersBatch,
        {
          groupId: group._id,
          channelId: newGeneralId,
          mirrorGroupRole: false,
          cursor: null,
          processed: 0,
        }
      );

      results.push({
        groupId: group._id,
        name: group.name,
        status: "migrated",
        announcementsChannelId: mainChannel._id,
        newGeneralChannelId: newGeneralId,
      });
    }

    return {
      dryRun,
      communityId: args.communityId ?? null,
      groupsProcessed: announcementGroups.length,
      results,
    };
  },
});
