/**
 * FOUNT Service Planning Bot - Database Config
 *
 * Reads/writes bot configuration from the slackBotConfig table.
 * Replaces hardcoded config.ts for runtime values.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../../_generated/server";

/** Max processed message timestamps to keep (circular buffer) */
const MAX_PROCESSED_MESSAGES = 100;

// ============================================================================
// Config Read/Write
// ============================================================================

/**
 * Get the slack bot config for a community.
 * Returns null if no config exists (bot not set up for this community).
 */
export const getConfig = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
  },
});

/**
 * Get all slack bot configs. Used by crons that need to iterate over all communities.
 */
export const getAllConfigs = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("slackBotConfig").collect();
  },
});

/**
 * Get config by looking up community from a known slack channel ID.
 * Used by the webhook handler which only knows the channel.
 */
export const getConfigByChannel = internalQuery({
  args: { slackChannelId: v.string() },
  handler: async (ctx, args) => {
    // slackBotConfig is small (one per community), scan is fine
    const configs = await ctx.db.query("slackBotConfig").collect();
    const matching = configs.filter((c) => c.slackChannelId === args.slackChannelId);
    if (matching.length > 1) {
      console.warn(
        `[SlackServiceBot] Multiple configs share channel ${args.slackChannelId}: ` +
        `${matching.map((c) => c.communityId).join(", ")}. Using first match.`
      );
    }
    return matching[0] ?? null;
  },
});

// ============================================================================
// Message Dedup
// ============================================================================

/**
 * Check if a message has already been processed (dedup).
 */
export const isMessageProcessed = internalQuery({
  args: {
    configId: v.id("slackBotConfig"),
    messageTs: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.configId);
    if (!config) return false;
    return config.processedMessageTs.includes(args.messageTs);
  },
});

/**
 * Mark a message as processed (circular buffer, keeps last N).
 */
export const markMessageProcessed = internalMutation({
  args: {
    configId: v.id("slackBotConfig"),
    messageTs: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.configId);
    if (!config) return;

    const timestamps = [...config.processedMessageTs, args.messageTs];
    // Keep only the last N entries
    const trimmed =
      timestamps.length > MAX_PROCESSED_MESSAGES
        ? timestamps.slice(-MAX_PROCESSED_MESSAGES)
        : timestamps;

    await ctx.db.patch(args.configId, {
      processedMessageTs: trimmed,
      updatedAt: Date.now(),
    });
  },
});

// ============================================================================
// Activity Log
// ============================================================================

/** Max activity log entries to keep (circular buffer) */
const MAX_ACTIVITY_LOG = 50;

/**
 * Append an entry to the activity log (circular buffer, keeps last 50).
 */
export const appendActivityLog = internalMutation({
  args: {
    configId: v.id("slackBotConfig"),
    entry: v.object({
      trigger: v.string(),
      location: v.optional(v.string()),
      threadTs: v.optional(v.string()),
      messageTs: v.optional(v.string()),
      userId: v.optional(v.string()),
      nagUrgency: v.optional(v.string()),
      nagLabel: v.optional(v.string()),
      toolCalls: v.array(v.object({
        tool: v.string(),
        args: v.any(),
        result: v.any(),
        durationMs: v.number(),
      })),
      agentResponse: v.optional(v.string()),
      iterations: v.number(),
      status: v.string(),
      error: v.optional(v.string()),
      skipReason: v.optional(v.string()),
      durationMs: v.number(),
      timestamp: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.configId);
    if (!config) return;

    const log = [...(config.activityLog ?? []), args.entry];
    const trimmed = log.length > MAX_ACTIVITY_LOG ? log.slice(-MAX_ACTIVITY_LOG) : log;

    await ctx.db.patch(args.configId, {
      activityLog: trimmed,
      updatedAt: Date.now(),
    });
  },
});

// ============================================================================
// Nag Tracking
// ============================================================================

/**
 * Check if a nag at a given urgency level was already sent for a thread.
 */
export const isNagSent = internalQuery({
  args: {
    configId: v.id("slackBotConfig"),
    threadTs: v.string(),
    urgency: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.configId);
    if (!config) return false;
    const sent = config.nagsSent[args.threadTs];
    return sent ? sent.includes(args.urgency) : false;
  },
});

/**
 * Mark a nag as sent for a thread at a given urgency level.
 */
export const markNagSent = internalMutation({
  args: {
    configId: v.id("slackBotConfig"),
    threadTs: v.string(),
    urgency: v.string(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db.get(args.configId);
    if (!config) return;

    const nagsSent = { ...config.nagsSent };
    const existing = nagsSent[args.threadTs] ?? [];
    if (!existing.includes(args.urgency)) {
      nagsSent[args.threadTs] = [...existing, args.urgency];
    }

    await ctx.db.patch(args.configId, {
      nagsSent,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Reset nag tracking for a new week (called when creating new threads).
 */
export const resetNagTracking = internalMutation({
  args: { configId: v.id("slackBotConfig") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.configId, {
      nagsSent: {},
      updatedAt: Date.now(),
    });
  },
});
