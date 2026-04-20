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
import { getCurrentEnvironment } from "../lib/notifications/send";

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
  handler: async (ctx, args): Promise<{ count: number; reachable: { push: number; email: number } }> => {
    // Auth check via internal query
    const authResult = await ctx.runQuery(
      internal.functions.adminBroadcasts.checkAdminAuth,
      { token: args.token, communityId: args.communityId }
    );
    if (!authResult.authorized) throw new Error("Not authorized");

    const { userIds } = await resolveTargetUsersAction(ctx, args.communityId, args.targetCriteria);

    // Page the reachability query to stay under the per-query read budget
    // (2 reads per user — user doc + pushTokens).
    const reachable = { push: 0, email: 0 };
    for (let i = 0; i < userIds.length; i += 500) {
      const batch = userIds.slice(i, i + 500);
      const batchReach: { push: number; email: number } = await ctx.runQuery(
        internal.functions.adminBroadcasts.getChannelReachability,
        { userIds: batch }
      );
      reachable.push += batchReach.push;
      reachable.email += batchReach.email;
    }

    return { count: userIds.length, reachable };
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

    if (args.channels.length === 0) {
      throw new Error("At least one channel must be selected");
    }
    for (const channel of args.channels) {
      if (channel !== "push" && channel !== "email") {
        throw new Error(`Unsupported channel: ${channel}. Admin broadcasts support push and email only.`);
      }
    }

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

    for (const channel of broadcast.channels) {
      if (channel !== "push" && channel !== "email") {
        throw new Error(
          `Broadcast has unsupported channel "${channel}". Admin broadcasts support push and email only.`,
        );
      }
    }

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

    // Reject legacy broadcasts that still carry unsupported channels (e.g. "sms"
    // from before SMS was removed). Without this, sendToUsers would silently
    // no-op for SMS-only broadcasts and flip the status to "sent".
    for (const channel of broadcast.channels) {
      if (channel !== "push" && channel !== "email") {
        throw new Error(
          `Broadcast has unsupported channel "${channel}". Admin broadcasts support push and email only.`,
        );
      }
    }

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
    const logPrefix = `[broadcast ${args.broadcastId}]`;
    try {
      const broadcast = await ctx.runQuery(internal.functions.adminBroadcasts.getBroadcast, {
        broadcastId: args.broadcastId,
      });
      if (!broadcast) {
        console.error(`${logPrefix} resolveAndSend: broadcast not found`);
        return;
      }
      console.log(
        `${logPrefix} resolveAndSend start: community=${broadcast.communityId} criteria=${JSON.stringify(broadcast.targetCriteria)} channels=${broadcast.channels.join(",")}`
      );

      const { userIds, perUserDeepLinks } = await resolveTargetUsersAction(ctx, broadcast.communityId as Id<"communities">, broadcast.targetCriteria);
      console.log(
        `${logPrefix} resolveAndSend: resolved ${userIds.length} target users` +
          (perUserDeepLinks ? ` (${perUserDeepLinks.size} per-user deep links)` : "")
      );

      if (userIds.length === 0) {
        console.warn(
          `${logPrefix} resolveAndSend: targeting produced 0 users — nothing to deliver`
        );
      }

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
      console.log(`${logPrefix} resolveAndSend: complete`);
    } catch (err) {
      console.error(
        `${logPrefix} resolveAndSend FAILED:`,
        err instanceof Error ? err.stack || err.message : String(err)
      );
      throw err;
    }
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
    const logPrefix = `[broadcast ${args.broadcastId}${args.isTest ? " TEST" : ""}]`;
    const broadcast = await ctx.runQuery(internal.functions.adminBroadcasts.getBroadcast, {
      broadcastId: args.broadcastId,
    });
    if (!broadcast) {
      console.error(`${logPrefix} sendToUsers: broadcast not found`);
      return;
    }
    console.log(
      `${logPrefix} sendToUsers start: ${args.userIds.length} users, channels=${broadcast.channels.join(",")}`
    );

    const perUserLinks = (args.perUserDeepLinks || {}) as Record<string, string>;
    const results = { pushSucceeded: 0, pushFailed: 0, emailSucceeded: 0, emailFailed: 0 };

    // Track per-user delivery outcome for each channel so notification rows
    // reflect actual success rather than blanket "sent".
    const pushOutcome = new Map<Id<"users">, "sent" | "failed">();
    const emailOutcome = new Map<Id<"users">, "sent" | "failed">();

    if (broadcast.channels.includes("push")) {
      const tokenResults: Array<{ userId: string; tokens: string[] }> =
        await ctx.runQuery(
          internal.functions.notifications.tokens.getActiveTokensForUsers,
          { userIds: args.userIds }
        );

      const totalTokens = tokenResults.reduce((sum, r) => sum + r.tokens.length, 0);
      console.log(
        `${logPrefix} push: ${tokenResults.length}/${args.userIds.length} users have tokens in env=${getCurrentEnvironment()} (${totalTokens} tokens total)`
      );
      if (tokenResults.length === 0 && args.userIds.length > 0) {
        console.warn(
          `${logPrefix} push: ZERO users have active push tokens in env=${getCurrentEnvironment()} — broadcast will not deliver via push`
        );
      }

      const notifications = tokenResults.flatMap(
        (result: { userId: string; tokens: string[] }) =>
          result.tokens.map((token: string) => ({
            token,
            title: broadcast.title,
            body: broadcast.body,
            data: {
              type: "admin_broadcast",
              communityId: broadcast.communityId,
              broadcastId: args.broadcastId,
              // Per-user deep link if available, otherwise broadcast default (skip non-URL markers)
              url: perUserLinks[result.userId] || (broadcast.deepLink?.startsWith("/") ? broadcast.deepLink : undefined),
            },
          }))
      );

      const tickets: Array<{ ok: boolean; id?: string; error?: string }> =
        notifications.length === 0
          ? []
          : (
              await ctx.runAction(
                internal.functions.notifications.internal.sendBatchPushNotifications,
                { notifications }
              )
            ).tickets ?? [];

      // Map per-ticket outcomes back to users. Each user may own multiple
      // tokens; mark the user "sent" if at least one token delivered ok.
      let ticketIdx = 0;
      for (const { userId, tokens } of tokenResults) {
        let anyOk = false;
        for (let i = 0; i < tokens.length; i++) {
          if (tickets[ticketIdx]?.ok) anyOk = true;
          ticketIdx++;
        }
        pushOutcome.set(userId as Id<"users">, anyOk ? "sent" : "failed");
      }

      results.pushSucceeded = tickets.filter((t) => t.ok).length;
      results.pushFailed = tickets.length - results.pushSucceeded;

      // Log a sample of error messages so malformed-payload or token-invalid
      // failures are visible without dumping every ticket.
      const errorSamples = tickets
        .filter((t) => !t.ok && t.error)
        .slice(0, 5)
        .map((t) => t.error);
      console.log(
        `${logPrefix} push: sent ${results.pushSucceeded}/${tickets.length} tickets ok` +
          (errorSamples.length > 0 ? ` | first errors: ${errorSamples.join(" | ")}` : "")
      );
    }

    if (broadcast.channels.includes("email")) {
      const userEmails: Array<{ userId: Id<"users">; email: string | null }> = await ctx.runQuery(
        internal.functions.adminBroadcasts.getUserEmails,
        { userIds: args.userIds }
      );
      const eligible = userEmails.filter(
        (u): u is { userId: Id<"users">; email: string } => !!u.email,
      );
      console.log(
        `${logPrefix} email: ${eligible.length}/${args.userIds.length} users eligible (have address + opted in)`
      );
      if (eligible.length === 0 && args.userIds.length > 0) {
        console.warn(
          `${logPrefix} email: ZERO eligible recipients — broadcast will not deliver via email`
        );
      }

      const emails = eligible.map((u) => ({
        to: u.email,
        subject: broadcast.title,
        htmlBody: `<h1>${broadcast.title}</h1><p>${broadcast.body}</p>`,
      }));

      if (emails.length > 0) {
        const emailResults: Array<{ success: boolean }> = await ctx.runAction(
          internal.functions.notifications.internal.sendEmails,
          { emails }
        );
        results.emailSucceeded = emailResults.filter((r) => r.success).length;
        results.emailFailed = emailResults.filter((r) => !r.success).length;

        eligible.forEach((u, i) => {
          emailOutcome.set(u.userId, emailResults[i]?.success ? "sent" : "failed");
        });
        console.log(
          `${logPrefix} email: sent ${results.emailSucceeded}/${emails.length} ok`
        );
      }
    }

    const allReachedUserIds = new Set<Id<"users">>([
      ...pushOutcome.keys(),
      ...emailOutcome.keys(),
    ]);
    console.log(
      `${logPrefix} summary: push ${results.pushSucceeded}/${results.pushSucceeded + results.pushFailed} ok, email ${results.emailSucceeded}/${results.emailSucceeded + results.emailFailed} ok, ${allReachedUserIds.size} unique users touched`
    );

    if (!args.isTest && allReachedUserIds.size === 0) {
      console.warn(
        `${logPrefix} no notification rows written — no user was reached on any channel. Check earlier logs for reason.`
      );
    }

    if (!args.isTest && allReachedUserIds.size > 0) {
      const notificationRecords = Array.from(allReachedUserIds).map((userId) => {
        const pushOk = pushOutcome.get(userId) === "sent";
        const emailOk = emailOutcome.get(userId) === "sent";
        // Row is "sent" if at least one selected channel succeeded for this user.
        const status = pushOk || emailOk ? "sent" : "failed";
        return {
          userId,
          communityId: broadcast.communityId as Id<"communities">,
          notificationType: "admin_broadcast",
          title: broadcast.title,
          body: broadcast.body,
          data: {
            broadcastId: args.broadcastId,
            channels: broadcast.channels,
            url: perUserLinks[userId] || (broadcast.deepLink?.startsWith("/") ? broadcast.deepLink : undefined),
          },
          status,
        };
      });

      // Chunk to keep each mutation well under Convex write limits
      const CHUNK = 200;
      for (let i = 0; i < notificationRecords.length; i += CHUNK) {
        await ctx.runMutation(
          internal.functions.notifications.mutations.createNotificationsBatch,
          { notifications: notificationRecords.slice(i, i + CHUNK) }
        );
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

export const getUserEmails = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const users = await Promise.all(args.userIds.map((id) => ctx.db.get(id)));
    return users
      .filter((u): u is NonNullable<typeof u> => u !== null)
      .map((u) => ({
        userId: u._id,
        // Opted-out users (emailNotificationsEnabled === false) are excluded
        // here so the send path and previewTargeting agree on reachability.
        email: u.email && u.emailNotificationsEnabled !== false ? u.email : null,
      }));
  },
});

/**
 * Count how many of the given users are reachable via each channel.
 * Push: user has an active push token in the current environment.
 * Email: user has a non-empty email and hasn't opted out (emailNotificationsEnabled !== false).
 */
export const getChannelReachability = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const environment = getCurrentEnvironment();

    let push = 0;
    let email = 0;

    for (const userId of args.userIds) {
      const [user, tokens] = await Promise.all([
        ctx.db.get(userId),
        ctx.db
          .query("pushTokens")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .filter((q) => q.eq(q.field("environment"), environment))
          .collect(),
      ]);

      if (tokens.length > 0) push++;
      if (user?.email && user.emailNotificationsEnabled !== false) email++;
    }

    return { push, email };
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
    const seen = new Set<Id<"users">>();
    const results: Array<{ userId: Id<"users">; groupId: Id<"groups"> }> = [];
    for (const group of groups) {
      if (group.preview && group.preview.trim() !== "") continue;
      const members = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();
      for (const m of members) {
        if (m.role === "leader" && !seen.has(m.userId)) {
          seen.add(m.userId);
          results.push({ userId: m.userId, groupId: group._id });
        }
      }
    }

    return results;
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
      const leaderGroups: Array<{ userId: Id<"users">; groupId: Id<"groups"> }> =
        await ctx.runQuery(internal.functions.adminBroadcasts.getLeaderIdsWithoutGroupImage, {
          communityId,
        });
      // Use leader list directly — don't filter through allUserIds
      // since leaders ARE community members by virtue of being in groups
      const perUserDeepLinks = new Map<string, string>();
      const targetUserIds: Id<"users">[] = [];
      for (const { userId, groupId } of leaderGroups) {
        targetUserIds.push(userId);
        perUserDeepLinks.set(userId, `/groups/${groupId}/edit`);
      }
      return { userIds: targetUserIds, perUserDeepLinks };
    }

    default:
      return { userIds: [] };
  }
}
