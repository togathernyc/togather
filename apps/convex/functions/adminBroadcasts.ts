/**
 * Admin Broadcast functions
 *
 * Targeted notifications with 2-party approval for community admins.
 * Supports targeting by criteria (no profile pic, new users, etc.),
 * multiple channels (push/email/SMS), and deep linking.
 */

import { v } from "convex/values";
import { query, mutation, internalQuery, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { requireCommunityAdmin, COMMUNITY_ADMIN_THRESHOLD } from "../lib/permissions";
import { now } from "../lib/utils";

// ============================================================================
// Target criteria type
// ============================================================================

const targetCriteriaValidator = v.object({
  type: v.string(),
  groupTypeSlug: v.optional(v.string()),
  daysThreshold: v.optional(v.number()),
});

// Preset deep link options (for frontend dropdown)
export const DEEP_LINK_PRESETS = [
  { value: "/profile/edit", label: "Edit Profile" },
  { value: "/(tabs)/search?view=groups", label: "Browse Groups" },
  { value: "/(tabs)/search?view=events", label: "Browse Events" },
] as const;

// ============================================================================
// Queries
// ============================================================================

/**
 * List broadcasts for a community
 */
export const list = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    statusFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("adminBroadcasts")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId));

    const broadcasts = await q.collect();

    // Filter by status if provided
    const filtered = args.statusFilter
      ? broadcasts.filter((b) => b.status === args.statusFilter)
      : broadcasts;

    // Sort by createdAt desc
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    // Fetch creator/approver names
    const userIds = new Set<Id<"users">>();
    for (const b of filtered) {
      userIds.add(b.createdById);
      if (b.approvedById) userIds.add(b.approvedById);
    }
    const users = await Promise.all([...userIds].map((id) => ctx.db.get(id)));
    const nameMap = new Map<string, string>();
    [...userIds].forEach((id, i) => {
      const u = users[i];
      if (u) nameMap.set(id, `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown");
    });

    return filtered.map((b) => ({
      ...b,
      createdByName: nameMap.get(b.createdById) || "Unknown",
      approvedByName: b.approvedById ? nameMap.get(b.approvedById) || "Unknown" : undefined,
    }));
  },
});

/**
 * Preview targeting — returns count of matched users (no PII)
 */
export const previewTargeting = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    targetCriteria: targetCriteriaValidator,
  },
  handler: async (ctx, args) => {
    const userIds = await resolveTargetUsers(ctx, args.communityId, args.targetCriteria);
    return { count: userIds.length };
  },
});

// ============================================================================
// Mutations (client-facing)
// ============================================================================

/**
 * Create a broadcast draft
 */
export const create = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetCriteria: targetCriteriaValidator,
    title: v.string(),
    body: v.string(),
    channels: v.array(v.string()),
    deepLink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Preview count
    const targetUsers = await resolveTargetUsers(ctx, args.communityId, args.targetCriteria);

    const timestamp = now();
    const id = await ctx.db.insert("adminBroadcasts", {
      communityId: args.communityId,
      createdById: userId,
      targetCriteria: args.targetCriteria,
      targetUserCount: targetUsers.length,
      title: args.title,
      body: args.body,
      channels: args.channels,
      deepLink: args.deepLink,
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return { id, targetUserCount: targetUsers.length };
  },
});

/**
 * Send a test notification to the requesting admin only
 */
export const sendTestToSelf = mutation({
  args: {
    token: v.string(),
    broadcastId: v.id("adminBroadcasts"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) throw new Error("Broadcast not found");

    await requireCommunityAdmin(ctx, broadcast.communityId, userId);

    // Schedule the test send
    await ctx.scheduler.runAfter(
      0,
      internal.functions.adminBroadcasts.sendToUsers,
      {
        broadcastId: args.broadcastId,
        userIds: [userId],
        isTest: true,
      }
    );

    return { success: true };
  },
});

/**
 * Request approval from another admin
 */
export const requestApproval = mutation({
  args: {
    token: v.string(),
    broadcastId: v.id("adminBroadcasts"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) throw new Error("Broadcast not found");
    if (broadcast.status !== "draft") throw new Error("Broadcast must be in draft status");

    await requireCommunityAdmin(ctx, broadcast.communityId, userId);

    // Refresh target count
    const targetUsers = await resolveTargetUsers(ctx, broadcast.communityId, broadcast.targetCriteria);

    await ctx.db.patch(args.broadcastId, {
      status: "pending_approval",
      targetUserCount: targetUsers.length,
      updatedAt: now(),
    });

    return { success: true };
  },
});

/**
 * Approve a broadcast (must be different admin from creator)
 */
export const approve = mutation({
  args: {
    token: v.string(),
    broadcastId: v.id("adminBroadcasts"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) throw new Error("Broadcast not found");
    if (broadcast.status !== "pending_approval") throw new Error("Broadcast is not pending approval");

    await requireCommunityAdmin(ctx, broadcast.communityId, userId);

    // 2-party control: approver must be different from creator
    if (broadcast.createdById === userId) {
      throw new Error("You cannot approve your own broadcast. Another admin must approve it.");
    }

    await ctx.db.patch(args.broadcastId, {
      status: "approved",
      approvedById: userId,
      updatedAt: now(),
    });

    return { success: true };
  },
});

/**
 * Reject a broadcast
 */
export const reject = mutation({
  args: {
    token: v.string(),
    broadcastId: v.id("adminBroadcasts"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) throw new Error("Broadcast not found");
    if (broadcast.status !== "pending_approval") throw new Error("Broadcast is not pending approval");

    await requireCommunityAdmin(ctx, broadcast.communityId, userId);

    if (broadcast.createdById === userId) {
      throw new Error("You cannot reject your own broadcast");
    }

    await ctx.db.patch(args.broadcastId, {
      status: "rejected",
      updatedAt: now(),
    });

    return { success: true };
  },
});

/**
 * Send an approved broadcast
 */
export const sendBroadcast = mutation({
  args: {
    token: v.string(),
    broadcastId: v.id("adminBroadcasts"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) throw new Error("Broadcast not found");
    if (broadcast.status !== "approved") throw new Error("Broadcast must be approved before sending");

    await requireCommunityAdmin(ctx, broadcast.communityId, userId);

    // Resolve target users
    const targetUsers = await resolveTargetUsers(ctx, broadcast.communityId, broadcast.targetCriteria);

    // Update status to sending
    await ctx.db.patch(args.broadcastId, {
      status: "sent",
      sentAt: now(),
      targetUserCount: targetUsers.length,
      updatedAt: now(),
    });

    // Schedule the actual send
    await ctx.scheduler.runAfter(
      0,
      internal.functions.adminBroadcasts.sendToUsers,
      {
        broadcastId: args.broadcastId,
        userIds: targetUsers,
        isTest: false,
      }
    );

    return { success: true, targetUserCount: targetUsers.length };
  },
});

// ============================================================================
// Internal action (does the actual sending)
// ============================================================================

export const sendToUsers = internalAction({
  args: {
    broadcastId: v.id("adminBroadcasts"),
    userIds: v.array(v.id("users")),
    isTest: v.boolean(),
  },
  handler: async (ctx, args) => {
    const broadcast = await ctx.runQuery(
      internal.functions.adminBroadcasts.getBroadcast,
      { broadcastId: args.broadcastId }
    );
    if (!broadcast) return;

    const results = { pushSucceeded: 0, pushFailed: 0, emailSucceeded: 0, emailFailed: 0, smsSucceeded: 0, smsFailed: 0 };

    // Send push notifications
    if (broadcast.channels.includes("push")) {
      const tokenResults: Array<{ userId: string; tokens: string[] }> =
        await ctx.runQuery(
          internal.functions.notifications.tokens.getActiveTokensForUsers,
          { userIds: args.userIds }
        );

      const notifications = tokenResults.flatMap(
        (result: { userId: string; tokens: string[] }) =>
          result.tokens.map((token: string) => ({
            token,
            title: broadcast.title,
            body: broadcast.body,
            data: {
              type: "admin_broadcast",
              communityId: broadcast.communityId,
              url: broadcast.deepLink || undefined,
            },
          }))
      );

      if (notifications.length > 0) {
        const pushResult = await ctx.runAction(
          internal.functions.notifications.internal.sendBatchPushNotifications,
          { notifications }
        );
        results.pushSucceeded = pushResult.success ? notifications.length : 0;
        results.pushFailed = pushResult.success ? 0 : notifications.length;
      }
    }

    // Send SMS
    if (broadcast.channels.includes("sms")) {
      const userPhones: Array<{ userId: string; phone: string | null }> =
        await ctx.runQuery(
          internal.functions.adminBroadcasts.getUserPhones,
          { userIds: args.userIds }
        );

      for (const { phone } of userPhones) {
        if (!phone) continue;
        try {
          await ctx.runAction(
            internal.functions.auth.phoneOtp.sendSMS,
            { phone, message: `${broadcast.title}\n\n${broadcast.body}` }
          );
          results.smsSucceeded++;
        } catch {
          results.smsFailed++;
        }
      }
    }

    // Send email
    if (broadcast.channels.includes("email")) {
      const userEmails: Array<{ email: string | null }> =
        await ctx.runQuery(
          internal.functions.adminBroadcasts.getUserEmails,
          { userIds: args.userIds }
        );

      const emails = userEmails
        .filter((u): u is { email: string } => !!u.email)
        .map((u) => ({
          to: u.email,
          subject: broadcast.title,
          htmlBody: `<h1>${broadcast.title}</h1><p>${broadcast.body}</p>`,
        }));

      if (emails.length > 0) {
        const emailResults = await ctx.runAction(
          internal.functions.notifications.internal.sendEmails,
          { emails }
        );
        results.emailSucceeded = emailResults.filter((r: { success: boolean }) => r.success).length;
        results.emailFailed = emailResults.filter((r: { success: boolean }) => !r.success).length;
      }
    }

    // Update broadcast with results (only for non-test sends)
    if (!args.isTest) {
      await ctx.runMutation(
        internal.functions.adminBroadcasts.updateResults,
        { broadcastId: args.broadcastId, results }
      );
    }
  },
});

// ============================================================================
// Internal helpers
// ============================================================================

export const getBroadcast = internalQuery({
  args: { broadcastId: v.id("adminBroadcasts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.broadcastId);
  },
});

export const getUserPhones = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const users = await Promise.all(args.userIds.map((id) => ctx.db.get(id)));
    return users.map((u) => ({ userId: u?._id, phone: u?.phone || null }));
  },
});

export const getUserEmails = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const users = await Promise.all(args.userIds.map((id) => ctx.db.get(id)));
    return users.map((u) => ({ email: u?.email || null }));
  },
});

import { internalMutation } from "../_generated/server";

export const updateResults = internalMutation({
  args: {
    broadcastId: v.id("adminBroadcasts"),
    results: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, {
      results: args.results,
      updatedAt: now(),
    });
  },
});

// ============================================================================
// Targeting logic
// ============================================================================

/**
 * Resolve target user IDs based on criteria.
 * Used by both preview and send flows.
 */
async function resolveTargetUsers(
  ctx: { db: any },
  communityId: Id<"communities">,
  criteria: { type: string; groupTypeSlug?: string; daysThreshold?: number }
): Promise<Id<"users">[]> {
  // Get all active community members
  const allMembers = await ctx.db
    .query("userCommunities")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .filter((q: any) => q.eq(q.field("status"), 1))
    .collect();

  const allUserIds: Id<"users">[] = allMembers.map((m: any) => m.userId);

  switch (criteria.type) {
    case "all_users":
      return allUserIds;

    case "new_users": {
      const threshold = criteria.daysThreshold || 30;
      const cutoff = now() - threshold * 24 * 60 * 60 * 1000;
      return allMembers
        .filter((m: any) => m.createdAt && m.createdAt >= cutoff)
        .map((m: any) => m.userId);
    }

    case "no_profile_pic": {
      const users = await Promise.all(allUserIds.map((id: Id<"users">) => ctx.db.get(id)));
      return allUserIds.filter((_: any, i: number) => {
        const user = users[i];
        return user && !user.profilePhoto;
      });
    }

    case "no_group_of_type": {
      if (!criteria.groupTypeSlug) return [];
      // Find groups of this type in the community
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
        .collect();

      // Get the group type ID from slug
      const groupTypes = await ctx.db
        .query("groupTypes")
        .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
        .collect();

      const targetType = groupTypes.find((gt: any) => gt.slug === criteria.groupTypeSlug);
      if (!targetType) return [];

      const typeGroups = groups.filter((g: any) => g.groupType === targetType._id);
      const typeGroupIds = new Set(typeGroups.map((g: any) => g._id.toString()));

      // Find users who are NOT in any group of this type
      const usersInType = new Set<string>();
      for (const group of typeGroups) {
        const members = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q: any) => q.eq("groupId", group._id))
          .filter((q: any) => q.eq(q.field("leftAt"), undefined))
          .collect();
        for (const m of members) {
          usersInType.add(m.userId.toString());
        }
      }

      return allUserIds.filter((id: Id<"users">) => !usersInType.has(id.toString()));
    }

    case "leaders_no_group_image": {
      // Find leaders whose groups have no preview image
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
        .collect();

      const leaderIds = new Set<string>();
      for (const group of groups) {
        if (group.preview) continue; // Has image, skip
        const members = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q: any) => q.eq("groupId", group._id))
          .filter((q: any) => q.eq(q.field("leftAt"), undefined))
          .collect();
        for (const m of members) {
          if (m.role === "leader") {
            leaderIds.add(m.userId.toString());
          }
        }
      }

      return allUserIds.filter((id: Id<"users">) => leaderIds.has(id.toString()));
    }

    default:
      return [];
  }
}
