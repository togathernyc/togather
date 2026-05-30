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
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { isLeaderRole } from "../../lib/permissions";

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

      const activeMembers = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      const messages = await ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", mainChannel._id))
        .collect();

      if (dryRun) {
        results.push({
          groupId: group._id,
          name: group.name,
          status: "would_migrate",
          convertChannelId: mainChannel._id,
          messageCount: messages.length,
          memberCount: activeMembers.length,
        });
        continue;
      }

      // 1) Convert the existing general channel -> announcements, in place.
      //    Messages and channel members stay attached (channel id unchanged).
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

      // 3) Add every active group member to the new general channel.
      let added = 0;
      for (const member of activeMembers) {
        const user = await ctx.db.get(member.userId);
        const displayName = user
          ? getDisplayName(user.firstName, user.lastName)
          : undefined;
        const profilePhoto = user ? getMediaUrl(user.profilePhoto) : undefined;
        await ctx.db.insert("chatChannelMembers", {
          channelId: newGeneralId,
          userId: member.userId,
          role: isLeaderRole(member.role) ? "admin" : "member",
          joinedAt: now,
          isMuted: false,
          displayName,
          profilePhoto,
        });
        added++;
      }
      await ctx.db.patch(newGeneralId, { memberCount: added });

      results.push({
        groupId: group._id,
        name: group.name,
        status: "migrated",
        announcementsChannelId: mainChannel._id,
        newGeneralChannelId: newGeneralId,
        messageCount: messages.length,
        memberCount: added,
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
