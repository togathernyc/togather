/**
 * Admin migration functions
 *
 * Functions for data migration and synchronization (e.g., Supabase to Convex sync)
 */

import { v } from "convex/values";
import { mutation, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { now } from "../../lib/utils";
import { requireAuth } from "../../lib/auth";
import { resolveChannelCommunityId } from "../../lib/messaging/communityScope";

// ============================================================================
// Migration Functions (for Supabase to Convex sync)
// ============================================================================

/**
 * Upsert a group type from legacy Supabase data
 * Returns the Convex ID (creates new or updates existing)
 */
export const upsertGroupTypeFromLegacy = mutation({
  args: {
    token: v.string(),
    legacyId: v.string(),
    communityId: v.id("communities"),
    name: v.string(),
    slug: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    isActive: v.boolean(),
    displayOrder: v.number(),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Verify authentication (admin-only migration function)
    await requireAuth(ctx, args.token);

    // Check if group type already exists by legacyId
    const existing = await ctx.db
      .query("groupTypes")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    const timestamp = now();
    const data = {
      legacyId: args.legacyId,
      communityId: args.communityId,
      name: args.name,
      slug: args.slug,
      description: args.description,
      icon: args.icon || "people",
      isActive: args.isActive,
      displayOrder: args.displayOrder,
      createdAt: args.createdAt ?? timestamp,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }

    return await ctx.db.insert("groupTypes", data);
  },
});

// ============================================================================
// Group Role Migration
// ============================================================================

/**
 * Migrate legacy "admin" group members to "leader" role.
 *
 * The "admin" role was a stale concept — functionally identical to "leader"
 * but not in the groupRoleValidator. This migration converts any remaining
 * admin-role group members to leader.
 *
 * Idempotent: safe to run multiple times. Skips already-migrated records.
 */
export const migrateAdminGroupMembersToLeader = internalMutation({
  args: {},
  handler: async (ctx) => {
    const adminMembers = await ctx.db
      .query("groupMembers")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .collect();

    let migrated = 0;
    for (const member of adminMembers) {
      await ctx.db.patch(member._id, { role: "leader" });
      migrated++;
    }

    return { migrated, total: adminMembers.length };
  },
});

// ============================================================================
// chatMessages.communityId backfill
// ============================================================================

/**
 * Backfill `chatMessages.communityId` for legacy rows written before the field
 * existed. New messages set it at write time (see `resolveChannelCommunityId`),
 * so this only needs to run once after deploy to make historical messages
 * searchable under the community-scoped `search_content` index.
 *
 * Processes one page at a time and reschedules itself until the table is
 * exhausted, so a single `npx convex run` invocation backfills everything
 * without exceeding per-mutation limits. Idempotent: rows that already have a
 * communityId are skipped, so re-running is safe.
 */
export const backfillMessageCommunityId = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 200;
    const page = await ctx.db
      .query("chatMessages")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    // Cache channel→community lookups within the batch; many messages share a
    // channel, so this avoids redundant reads.
    const communityByChannel = new Map<string, Id<"communities"> | undefined>();
    let patched = 0;
    for (const message of page.page) {
      if (message.communityId) continue;
      if (!communityByChannel.has(message.channelId)) {
        communityByChannel.set(
          message.channelId,
          await resolveChannelCommunityId(ctx, message.channelId),
        );
      }
      const communityId = communityByChannel.get(message.channelId);
      if (communityId) {
        await ctx.db.patch(message._id, { communityId });
        patched++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.admin.migrations.backfillMessageCommunityId,
        { cursor: page.continueCursor, batchSize },
      );
    }

    return { patched, scanned: page.page.length, isDone: page.isDone };
  },
});
