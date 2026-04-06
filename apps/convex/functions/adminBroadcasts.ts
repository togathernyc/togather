/**
 * Admin Broadcast functions — targeted notifications with 2-party approval
 *
 * Targeting runs in internalActions (server-side) to avoid Convex read limits.
 * Each targeting type has its own bounded internalQuery so the system scales
 * to tens of thousands of users.
 */

import { v } from "convex/values";
import { action, query, mutation, internalQuery, internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { requireCommunityAdmin } from "../lib/permissions";
import { now } from "../lib/utils";

// ============================================================================
// Target criteria type
// ============================================================================

const targetCriteriaValidator = v.object({
  type: v.string(),
  groupTypeSlug: v.optional(v.string()),
  daysThreshold: v.optional(v.number()),
});

// ============================================================================
// Queries
// ============================================================================

/**
 * List broadcasts for a community
 */
export const list = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    statusFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const broadcasts = await ctx.db
      .query("adminBroadcasts")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const filtered = args.statusFilter
      ? broadcasts.filter((b) => b.status === args.statusFilter)
      : broadcasts;

    filtered.sort((a, b) => b.createdAt - a.createdAt);

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
 * List group types for the community (used by targeting dropdown)
 */
export const listGroupTypes = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const groupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    return groupTypes
      .filter((gt) => gt.isActive)
      .map((gt) => ({ id: gt._id, name: gt.name, slug: gt.slug }));
  },
});

// ============================================================================
// Preview targeting (action — runs server-side, no read limit per call)
// ============================================================================

/**
 * Preview targeting count. Runs as an action so each targeting type
 * gets its own internal query with a fresh read budget.
 */
export const previewTargeting = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    targetCriteria: targetCriteriaValidator,
  },
  handler: async (ctx, args) => {
    // Auth check via internal query
    const authResult = await ctx.runQuery(
      internal.functions.adminBroadcasts.checkAdminAuth,
      { token: args.token, communityId: args.communityId }
    );
    if (!authResult.authorized) throw new Error("Not authorized");

    const { userIds } = await resolveTargetUsersAction(ctx, args.communityId, args.targetCriteria);
    return { count: userIds.length };
  },
});

// ============================================================================
// Mutations (client-facing)
// ============================================================================

/**
 * Create a broadcast draft — resolves targeting via action for count
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

    const timestamp = now();
    const id = await ctx.db.insert("adminBroadcasts", {
      communityId: args.communityId,
      createdById: userId,
      targetCriteria: args.targetCriteria,
      targetUserCount: 0, // Will be updated by resolveAndUpdateCount action
      title: args.title,
      body: args.body,
      channels: args.channels,
      deepLink: args.deepLink,
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Resolve count async
    await ctx.scheduler.runAfter(0, internal.functions.adminBroadcasts.resolveAndUpdateCount, {
      broadcastId: id,
    });

    return { id, targetUserCount: 0 };
  },
});

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

    // Resolve per-user deep link for the test user so special links (e.g. per_user_group) work
    await ctx.scheduler.runAfter(0, internal.functions.adminBroadcasts.resolveAndTestSelf, {
      broadcastId: args.broadcastId,
      userId,
    });
    return { success: true };
  },
});

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

    await ctx.db.patch(args.broadcastId, {
      status: "pending_approval",
      updatedAt: now(),
    });

    // Refresh count async
    await ctx.scheduler.runAfter(0, internal.functions.adminBroadcasts.resolveAndUpdateCount, {
      broadcastId: args.broadcastId,
    });

    return { success: true };
  },
});

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

    await ctx.db.patch(args.broadcastId, { status: "rejected", updatedAt: now() });
    return { success: true };
  },
});

/**
 * Send an approved broadcast — resolves targets via action for scale
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

    await ctx.db.patch(args.broadcastId, {
      status: "sent",
      sentAt: now(),
      updatedAt: now(),
    });

    // Resolve targets + send via action (no read limit)
    await ctx.scheduler.runAfter(0, internal.functions.adminBroadcasts.resolveAndSend, {
      broadcastId: args.broadcastId,
    });

    return { success: true };
  },
});

/**
 * Delete a draft or rejected broadcast
 */
export const deleteBroadcast = mutation({
  args: {
    token: v.string(),
    broadcastId: v.id("adminBroadcasts"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const broadcast = await ctx.db.get(args.broadcastId);
    if (!broadcast) throw new Error("Broadcast not found");
    if (broadcast.status !== "draft" && broadcast.status !== "rejected") {
      throw new Error("Only draft or rejected broadcasts can be deleted");
    }
    await requireCommunityAdmin(ctx, broadcast.communityId, userId);
    await ctx.db.delete(args.broadcastId);
    return { success: true };
  },
});

// ============================================================================
// Internal actions (server-side, no read limits)
// ============================================================================

/**
 * Resolve per-user deep links and send test to self
 */
export const resolveAndTestSelf = internalAction({
  args: { broadcastId: v.id("adminBroadcasts"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const broadcast = await ctx.runQuery(internal.functions.adminBroadcasts.getBroadcast, {
      broadcastId: args.broadcastId,
    });
    if (!broadcast) return;

    const { perUserDeepLinks } = await resolveTargetUsersAction(ctx, broadcast.communityId as Id<"communities">, broadcast.targetCriteria);

    const deepLinksObj: Record<string, string> = {};
    if (perUserDeepLinks) {
      for (const [k, v] of perUserDeepLinks) deepLinksObj[k] = v;
    }

    await ctx.runAction(internal.functions.adminBroadcasts.sendToUsers, {
      broadcastId: args.broadcastId,
      userIds: [args.userId],
      isTest: true,
      perUserDeepLinks: Object.keys(deepLinksObj).length > 0 ? deepLinksObj : undefined,
    });
  },
});

/**
 * Resolve target users and update the broadcast count
 */
export const resolveAndUpdateCount = internalAction({
  args: { broadcastId: v.id("adminBroadcasts") },
  handler: async (ctx, args) => {
    const broadcast = await ctx.runQuery(internal.functions.adminBroadcasts.getBroadcast, {
      broadcastId: args.broadcastId,
    });
    if (!broadcast) return;

    const { userIds } = await resolveTargetUsersAction(ctx, broadcast.communityId as Id<"communities">, broadcast.targetCriteria);
    await ctx.runMutation(internal.functions.adminBroadcasts.updateTargetCount, {
      broadcastId: args.broadcastId,
      count: userIds.length,
    });
  },
});

/**
 * Resolve target users and send the broadcast
 */
export const resolveAndSend = internalAction({
  args: { broadcastId: v.id("adminBroadcasts") },
  handler: async (ctx, args) => {
    const broadcast = await ctx.runQuery(internal.functions.adminBroadcasts.getBroadcast, {
      broadcastId: args.broadcastId,
    });
    if (!broadcast) return;

    const { userIds, perUserDeepLinks } = await resolveTargetUsersAction(ctx, broadcast.communityId as Id<"communities">, broadcast.targetCriteria);

    await ctx.runMutation(internal.functions.adminBroadcasts.updateTargetCount, {
      broadcastId: args.broadcastId,
      count: userIds.length,
    });

    // Convert Map to plain object for serialization
    const deepLinksObj: Record<string, string> = {};
    if (perUserDeepLinks) {
      for (const [k, v] of perUserDeepLinks) deepLinksObj[k] = v;
    }

    // Delegate to sendToUsers
    await ctx.runAction(internal.functions.adminBroadcasts.sendToUsers, {
      broadcastId: args.broadcastId,
      userIds,
      isTest: false,
      perUserDeepLinks: Object.keys(deepLinksObj).length > 0 ? deepLinksObj : undefined,
    });
  },
});

export const sendToUsers = internalAction({
  args: {
    broadcastId: v.id("adminBroadcasts"),
    userIds: v.array(v.id("users")),
    isTest: v.boolean(),
    perUserDeepLinks: v.optional(v.any()), // Record<string, string> — userId → deep link URL
  },
  handler: async (ctx, args) => {
    const broadcast = await ctx.runQuery(internal.functions.adminBroadcasts.getBroadcast, {
      broadcastId: args.broadcastId,
    });
    if (!broadcast) return;

    const perUserLinks = (args.perUserDeepLinks || {}) as Record<string, string>;
    const results = { pushSucceeded: 0, pushFailed: 0, emailSucceeded: 0, emailFailed: 0, smsSucceeded: 0, smsFailed: 0 };

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
              // Per-user deep link if available, otherwise broadcast default (skip non-URL markers)
              url: perUserLinks[result.userId] || (broadcast.deepLink?.startsWith("/") ? broadcast.deepLink : undefined),
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

    if (broadcast.channels.includes("sms")) {
      const userPhones = await ctx.runQuery(
        internal.functions.adminBroadcasts.getUserPhones,
        { userIds: args.userIds }
      );

      // Build SMS with context prefix and character limit
      const community = await ctx.runQuery(internal.functions.adminBroadcasts.getCommunity, {
        communityId: broadcast.communityId as Id<"communities">,
      });
      const communityName = community?.name || "Your community";
      const smsPrefix = `${communityName} sent a new message:\n\n`;
      const rawBody = `${broadcast.title}\n\n${broadcast.body}`;
      const maxBodyLen = 1600 - smsPrefix.length;
      const truncatedBody = rawBody.length > maxBodyLen
        ? rawBody.slice(0, maxBodyLen - 1) + "…"
        : rawBody;
      const smsMessage = smsPrefix + truncatedBody;

      for (const { phone } of userPhones as Array<{ phone: string | null }>) {
        if (!phone) continue;
        try {
          await ctx.runAction(internal.functions.auth.phoneOtp.sendSMS, {
            phone,
            message: smsMessage,
          });
          results.smsSucceeded++;
        } catch {
          results.smsFailed++;
        }
      }
    }

    if (broadcast.channels.includes("email")) {
      const userEmails = await ctx.runQuery(
        internal.functions.adminBroadcasts.getUserEmails,
        { userIds: args.userIds }
      );
      const emails = (userEmails as Array<{ email: string | null }>)
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

    if (!args.isTest) {
      await ctx.runMutation(internal.functions.adminBroadcasts.updateResults, {
        broadcastId: args.broadcastId,
        results,
      });
    }
  },
});

// ============================================================================
// Internal queries (each with its own read budget)
// ============================================================================

export const checkAdminAuth = internalQuery({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    try {
      const userId = await requireAuth(ctx, args.token);
      await requireCommunityAdmin(ctx, args.communityId, userId);
      return { authorized: true, userId };
    } catch {
      return { authorized: false, userId: null };
    }
  },
});

export const getBroadcast = internalQuery({
  args: { broadcastId: v.id("adminBroadcasts") },
  handler: async (ctx, args) => ctx.db.get(args.broadcastId),
});

export const getCommunity = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => ctx.db.get(args.communityId),
});

export const getUserPhones = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const users = await Promise.all(args.userIds.map((id) => ctx.db.get(id)));
    return users
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => ({ userId: u._id as string, phone: u.phone || null }));
  },
});

export const getUserEmails = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const users = await Promise.all(args.userIds.map((id) => ctx.db.get(id)));
    return users.map((u) => ({ email: u?.email || null }));
  },
});

export const updateResults = internalMutation({
  args: { broadcastId: v.id("adminBroadcasts"), results: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, { results: args.results, updatedAt: now() });
  },
});

export const updateTargetCount = internalMutation({
  args: { broadcastId: v.id("adminBroadcasts"), count: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.broadcastId, { targetUserCount: args.count, updatedAt: now() });
  },
});

// ============================================================================
// Targeting internal queries — each runs with its own 4096 read budget
// ============================================================================

/**
 * Get community member IDs in pages to stay under Convex's 8192 return limit.
 * Returns { userIds, createdAts, hasMore, cursor }.
 */
export const getCommunityMemberPage = internalQuery({
  args: {
    communityId: v.id("communities"),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.pageSize || 4000;
    let query = ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("status"), 1));

    const result = await query.paginate({ numItems: limit, cursor: args.cursor || null });

    return {
      members: result.page.map((m) => ({ userId: m.userId, createdAt: m.createdAt })),
      cursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Get IDs of users without profile pic from a small batch (max ~500 IDs).
 */
export const getUsersWithoutProfilePicPage = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const users = await Promise.all(args.userIds.map((id) => ctx.db.get(id)));
    const result: Id<"users">[] = [];
    for (let j = 0; j < args.userIds.length; j++) {
      if (users[j] && !users[j]!.profilePhoto) result.push(args.userIds[j]);
    }
    return result;
  },
});

/**
 * Count/resolve users NOT in a group of a specific type.
 * Fetches group members internally — no large array args needed.
 */
export const countUsersNotInGroupType = internalQuery({
  args: { communityId: v.id("communities"), groupTypeSlug: v.string() },
  handler: async (ctx, args) => {
    const groupTypes = await ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    const targetType = groupTypes.find((gt) => gt.slug === args.groupTypeSlug);
    if (!targetType) return { count: 0, usersInType: [] as string[] };

    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("groupTypeId"), targetType._id))
      .collect();

    const usersInType = new Set<string>();
    for (const group of groups) {
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();
      for (const m of members) usersInType.add(m.userId.toString());
    }

    return { usersInTypeSet: [...usersInType] };
  },
});

/**
 * Get leaders of groups without images.
 * Returns map of userId → first groupId without image (for per-user deep links).
 */
export const getLeaderIdsWithoutGroupImage = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // Map userId → first groupId they lead that has no image
    const leaderToGroup = new Map<string, string>();
    for (const group of groups) {
      if (group.preview) continue;
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();
      for (const m of members) {
        if (m.role === "leader" && !leaderToGroup.has(m.userId.toString())) {
          leaderToGroup.set(m.userId.toString(), group._id.toString());
        }
      }
    }

    return [...leaderToGroup.entries()].map(([userId, groupId]) => ({ userId, groupId }));
  },
});

// ============================================================================
// Targeting resolver (used by actions — calls internal queries)
// ============================================================================

/**
 * Fetch all community member IDs by paginating the internal query.
 * Handles communities with 10k+ members.
 */
async function getAllCommunityMembers(
  ctx: { runQuery: any },
  communityId: Id<"communities">
): Promise<Array<{ userId: Id<"users">; createdAt?: number }>> {
  const allMembers: Array<{ userId: Id<"users">; createdAt?: number }> = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const page: { members: Array<{ userId: Id<"users">; createdAt?: number }>; cursor: string; isDone: boolean } =
      await ctx.runQuery(internal.functions.adminBroadcasts.getCommunityMemberPage, {
        communityId,
        cursor,
        pageSize: 4000,
      });
    allMembers.push(...page.members);
    if (page.isDone) break;
    cursor = page.cursor;
  }

  return allMembers;
}

interface TargetResult {
  userIds: Id<"users">[];
  /** Per-user deep links (userId string → URL). If set, overrides broadcast.deepLink for that user. */
  perUserDeepLinks?: Map<string, string>;
}

async function resolveTargetUsersAction(
  ctx: { runQuery: any },
  communityId: Id<"communities">,
  criteria: { type: string; groupTypeSlug?: string; daysThreshold?: number }
): Promise<TargetResult> {
  const members = await getAllCommunityMembers(ctx, communityId);
  const allUserIds = members.map((m) => m.userId);

  switch (criteria.type) {
    case "all_users":
      return { userIds: allUserIds };

    case "new_users": {
      const threshold = criteria.daysThreshold || 30;
      const cutoff = Date.now() - threshold * 24 * 60 * 60 * 1000;
      return {
        userIds: members
          .filter((m) => m.createdAt && m.createdAt >= cutoff)
          .map((m) => m.userId),
      };
    }

    case "no_profile_pic": {
      const result: Id<"users">[] = [];
      for (let i = 0; i < allUserIds.length; i += 500) {
        const batch = allUserIds.slice(i, i + 500);
        const batchResult: Id<"users">[] = await ctx.runQuery(
          internal.functions.adminBroadcasts.getUsersWithoutProfilePicPage,
          { userIds: batch }
        );
        result.push(...batchResult);
      }
      return { userIds: result };
    }

    case "no_group_of_type": {
      if (!criteria.groupTypeSlug) return { userIds: [] };
      const { usersInTypeSet }: { usersInTypeSet: string[] } = await ctx.runQuery(
        internal.functions.adminBroadcasts.countUsersNotInGroupType,
        { communityId, groupTypeSlug: criteria.groupTypeSlug }
      );
      const inTypeSet = new Set(usersInTypeSet);
      return { userIds: allUserIds.filter((id) => !inTypeSet.has(id.toString())) };
    }

    case "leaders_no_group_image": {
      const leaderGroups: Array<{ userId: string; groupId: string }> = await ctx.runQuery(
        internal.functions.adminBroadcasts.getLeaderIdsWithoutGroupImage,
        { communityId }
      );
      const leaderMap = new Map<string, string>();
      for (const { userId, groupId } of leaderGroups) {
        leaderMap.set(userId, groupId);
      }
      const perUserDeepLinks = new Map<string, string>();
      const targetUserIds = allUserIds.filter((id) => {
        if (leaderMap.has(id.toString())) {
          const groupId = leaderMap.get(id.toString())!;
          perUserDeepLinks.set(id.toString(), `/groups/${groupId}/edit`);
          return true;
        }
        return false;
      });
      return { userIds: targetUserIds, perUserDeepLinks };
    }

    default:
      return { userIds: [] };
  }
}
