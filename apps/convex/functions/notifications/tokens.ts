/**
 * Push Token Management Functions
 *
 * Functions for registering, unregistering, and managing push tokens.
 * Simplified model: 1 token per user per environment. Token existence = push enabled.
 */

import { v } from "convex/values";
import { mutation, internalMutation, internalQuery } from "../../_generated/server";
import { now } from "../../lib/utils";
import { platformValidator } from "../../lib/validators";
import { requireAuth } from "../../lib/auth";
import { getCurrentEnvironment } from "../../lib/notifications/send";
import { adjustEnabledCounter } from "../../lib/notifications/enabledCounter";

// ============================================================================
// Public Mutations
// ============================================================================

/**
 * Register a push token for the authenticated user
 *
 * Simplified model: 1 token per user per environment.
 * When registering a new token, any existing tokens for this user/environment are deleted.
 * Token existence = push notifications enabled.
 */
export const registerToken = mutation({
  args: {
    authToken: v.string(),
    token: v.string(),
    platform: platformValidator,
    deviceId: v.optional(v.string()),
    bundleId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.authToken);
    const timestamp = now();
    const environment = getCurrentEnvironment();

    // Delete any existing tokens for this user in this environment
    // We only keep 1 token per user per environment
    const existingTokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("environment"), environment))
      .collect();

    for (const existingToken of existingTokens) {
      await ctx.db.delete(existingToken._id);
    }

    // Create new token
    await ctx.db.insert("pushTokens", {
      userId,
      token: args.token,
      platform: args.platform,
      deviceId: args.deviceId,
      bundleId: args.bundleId,
      environment,
      isActive: true, // Always true - token existence means enabled
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    });

    // Maintain the enabled-count running tally: only increment when the user
    // transitions from 0 → 1 token in this env. If they already had a token
    // (re-register on relaunch), the count is unchanged.
    if (existingTokens.length === 0) {
      await adjustEnabledCounter(ctx, environment, 1);
    }

    return {
      success: true,
      message: "Push token registered successfully",
    };
  },
});

/**
 * Unregister a push token
 * Deletes the token (token existence = push enabled)
 */
export const unregisterToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .collect();

    // Group the to-be-deleted tokens by (userId, environment) so we can
    // decrement the enabled-count counter exactly once per (user, env) pair
    // that loses its last token in that environment.
    const affected: Array<{ userId: string; environment: string }> = [];
    for (const tokenDoc of tokens) {
      affected.push({
        userId: tokenDoc.userId,
        environment: tokenDoc.environment ?? "",
      });
    }

    let deletedCount = 0;
    for (const tokenDoc of tokens) {
      await ctx.db.delete(tokenDoc._id);
      deletedCount++;
    }

    // For each affected (user, env), check whether they still have any
    // tokens left in that env after deletion. If not, that user transitions
    // back to "disabled" → -1 on the counter. Skip rows with empty
    // environment (legacy/unscoped tokens) — they're not in the counter.
    const seen = new Set<string>();
    for (const { userId, environment } of affected) {
      if (!environment) continue;
      const key = `${userId}|${environment}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const remaining = await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", userId as any))
        .filter((q) => q.eq(q.field("environment"), environment))
        .first();
      if (!remaining) {
        await adjustEnabledCounter(ctx, environment, -1);
      }
    }

    return {
      success: deletedCount > 0,
      message: deletedCount > 0 ? "Push token unregistered" : "Token not found",
    };
  },
});

/**
 * Clean up legacy tokens that don't have an environment set.
 * These tokens were created before environment separation was implemented
 * and cause issues because they don't match any environment filter.
 *
 * This deletes them entirely since they can't be used reliably.
 */
export const cleanupLegacyTokens = mutation({
  args: {
    authToken: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.authToken);

    // Find all tokens without environment for this user
    const legacyTokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("environment"), undefined))
      .collect();

    let deletedCount = 0;
    for (const token of legacyTokens) {
      await ctx.db.delete(token._id);
      deletedCount++;
    }

    console.log(
      `[cleanupLegacyTokens] Deleted ${deletedCount} legacy tokens for user ${userId}`
    );

    return {
      success: true,
      deletedCount,
      message: deletedCount > 0
        ? `Deleted ${deletedCount} legacy tokens without environment`
        : "No legacy tokens found",
    };
  },
});

/**
 * Global cleanup of ALL legacy tokens (no environment set).
 * This is an internal mutation - run from dashboard or script.
 *
 * After running this, users will automatically re-register tokens
 * with correct environment when they open the app.
 */
export const cleanupAllLegacyTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find ALL tokens without environment
    const legacyTokens = await ctx.db
      .query("pushTokens")
      .filter((q) => q.eq(q.field("environment"), undefined))
      .collect();

    const totalCount = legacyTokens.length;
    console.log(`[cleanupAllLegacyTokens] Found ${totalCount} legacy tokens to delete`);

    let deletedCount = 0;
    const affectedUsers = new Set<string>();

    for (const token of legacyTokens) {
      affectedUsers.add(token.userId);
      await ctx.db.delete(token._id);
      deletedCount++;

      // Log progress every 100 tokens
      if (deletedCount % 100 === 0) {
        console.log(`[cleanupAllLegacyTokens] Deleted ${deletedCount}/${totalCount} tokens...`);
      }
    }

    console.log(
      `[cleanupAllLegacyTokens] Complete! Deleted ${deletedCount} legacy tokens ` +
      `affecting ${affectedUsers.size} users`
    );

    return {
      success: true,
      deletedCount,
      affectedUserCount: affectedUsers.size,
    };
  },
});

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Get push token for a user
 * Used by notification actions to send push notifications
 *
 * Simplified model: 1 token per user per environment.
 * Token existence = push enabled (isActive is ignored).
 */
export const getActiveTokensForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const environment = getCurrentEnvironment();

    // Get token for this user in current environment
    // With 1 token per user per environment, this returns 0 or 1 tokens
    const tokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("environment"), environment))
      .collect();

    return tokens;
  },
});

/**
 * Get push tokens for multiple users
 *
 * Simplified model: 1 token per user per environment.
 * Token existence = push enabled (isActive is ignored).
 */
export const getActiveTokensForUsers = internalQuery({
  args: {
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    if (args.userIds.length === 0) {
      return [];
    }

    const environment = getCurrentEnvironment();

    // Fetch tokens for all users in parallel
    const tokenPromises = args.userIds.map(async (userId) => {
      const tokens = await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.eq(q.field("environment"), environment))
        .collect();

      return { userId, tokens };
    });

    const allResults = await Promise.all(tokenPromises);

    // Build results array, filtering out users with no tokens
    const results: Array<{ userId: string; tokens: string[] }> = [];
    for (const { userId, tokens } of allResults) {
      if (tokens.length > 0) {
        results.push({
          userId,
          tokens: tokens.map((t) => t.token),
        });
      }
    }

    return results;
  },
});
