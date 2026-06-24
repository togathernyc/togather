/**
 * Claude model availability — Convex layer.
 *
 * Wraps the pure probe in `lib/ai/claudeAvailability.ts` with the bot's
 * runtime behavior. Before the Togather Bot dispatches a task to a Claude
 * model it calls `ensureModelAvailable`, which:
 *
 *   1. Probes Claude Opus, then Claude Sonnet (`selectAvailableClaudeModel`).
 *   2. Returns the first healthy model so the caller can run the task.
 *   3. If BOTH are down, posts a heads-up into the thread and starts an
 *      hourly poll (`pollModelAvailability`) that re-checks until a model
 *      recovers — then announces it's back and stops.
 *
 * `checkModelStatus` is the read-only "what's the status right now" tool.
 *
 * Availability is decided by Anthropic's Models API; the probe uses
 * `ANTHROPIC_API_KEY`. Without that key the bot can't reach Anthropic at all,
 * so the gate fails closed (reports unavailable) rather than polling forever.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  CLAUDE_POLL_INTERVAL_MS,
  selectAvailableClaudeModel,
  type ModelSelection,
} from "../../lib/ai/claudeAvailability";

/** Singleton key for the poll-state row. */
const POLL_KEY = "global";

/** Where to post availability heads-up messages, when a target is known. */
const notifyTargetArgs = {
  notifyGroupId: v.optional(v.id("groups")),
  notifyChannelSlug: v.optional(v.string()),
};

function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}

async function probeModels(apiKey: string): Promise<ModelSelection> {
  return selectAvailableClaudeModel({ apiKey });
}

async function postNotice(
  ctx: ActionCtx,
  target: { groupId?: Id<"groups">; channelSlug?: string },
  message: string,
): Promise<void> {
  if (!target.groupId) return; // No thread to notify — log-only path.
  await ctx.runAction(internal.functions.scheduledJobs.sendBotMessage, {
    groupId: target.groupId,
    message,
    targetChannelSlug: target.channelSlug,
    botType: "claude_availability",
  });
}

// ===========================================================================
// POLL STATE (singleton row)
// ===========================================================================

export const getPoll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("claudeModelPolls")
      .withIndex("by_key", (q) => q.eq("key", POLL_KEY))
      .unique();
  },
});

/**
 * Start the poll loop if one isn't already running. Idempotent: when a poll is
 * already `active`, this is a no-op and returns `{ started: false }`, so
 * repeated task requests during an outage never stack multiple poll chains.
 */
export const beginPoll = internalMutation({
  args: notifyTargetArgs,
  handler: async (ctx, args): Promise<{ started: boolean }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("claudeModelPolls")
      .withIndex("by_key", (q) => q.eq("key", POLL_KEY))
      .unique();

    if (existing?.active) return { started: false };

    if (existing) {
      await ctx.db.patch(existing._id, {
        active: true,
        notifyGroupId: args.notifyGroupId,
        notifyChannelSlug: args.notifyChannelSlug,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("claudeModelPolls", {
        key: POLL_KEY,
        active: true,
        lastCheckedAt: now,
        notifyGroupId: args.notifyGroupId,
        notifyChannelSlug: args.notifyChannelSlug,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { started: true };
  },
});

/** Record the latest probe outcome and set whether the loop keeps running. */
export const recordPollResult = internalMutation({
  args: {
    active: v.boolean(),
    lastAvailableModel: v.optional(v.string()),
    statusesJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("claudeModelPolls")
      .withIndex("by_key", (q) => q.eq("key", POLL_KEY))
      .unique();

    const patch = {
      active: args.active,
      lastCheckedAt: now,
      lastAvailableModel: args.lastAvailableModel,
      lastStatuses: args.statusesJson,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("claudeModelPolls", {
        key: POLL_KEY,
        createdAt: now,
        ...patch,
      });
    }
  },
});

// ===========================================================================
// TOOLS / ACTIONS
// ===========================================================================

/**
 * Tool: report the current availability of each Claude model and which one
 * the bot would use right now. Read-only — never schedules a poll.
 */
export const checkModelStatus = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      return {
        configured: false as const,
        selectedModel: null,
        statuses: [],
      };
    }
    const selection = await probeModels(apiKey);
    return { configured: true as const, ...selection };
  },
});

/**
 * Gate: confirm a Claude model is reachable before executing a task.
 *
 * Returns `{ available: true, model }` with the first healthy model, or
 * `{ available: false }` after notifying the thread and starting the hourly
 * poll. Callers should treat `available: false` as "don't dispatch yet".
 */
export const ensureModelAvailable = internalAction({
  args: notifyTargetArgs,
  handler: async (
    ctx,
    args,
  ): Promise<
    | { available: true; model: string; statuses: ModelSelection["statuses"] }
    | { available: false; reason: string; statuses: ModelSelection["statuses"] }
  > => {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      console.warn(
        "[claude-availability] ANTHROPIC_API_KEY not set — cannot reach Claude; reporting unavailable.",
      );
      return {
        available: false,
        reason: "ANTHROPIC_API_KEY not configured",
        statuses: [],
      };
    }

    const selection = await probeModels(apiKey);

    if (selection.selectedModel) {
      // A healthy model means any prior outage is over — clear an active poll.
      await ctx.runMutation(
        internal.functions.ai.modelAvailability.recordPollResult,
        {
          active: false,
          lastAvailableModel: selection.selectedModel,
          statusesJson: JSON.stringify(selection.statuses),
        },
      );
      return {
        available: true,
        model: selection.selectedModel,
        statuses: selection.statuses,
      };
    }

    // Both models down. Start one poll loop and announce it only on the
    // transition into the outage (beginPoll is idempotent), so repeated task
    // requests during the same outage don't spam the thread.
    const { started } = await ctx.runMutation(
      internal.functions.ai.modelAvailability.beginPoll,
      args,
    );
    if (started) {
      await ctx.runMutation(
        internal.functions.ai.modelAvailability.recordPollResult,
        { active: true, statusesJson: JSON.stringify(selection.statuses) },
      );
      await postNotice(
        ctx,
        { groupId: args.notifyGroupId, channelSlug: args.notifyChannelSlug },
        "⚠️ Claude is temporarily unavailable — both Opus and Sonnet are unreachable. I'll keep checking every hour and resume automatically once one is back.",
      );
      await ctx.scheduler.runAfter(
        CLAUDE_POLL_INTERVAL_MS,
        internal.functions.ai.modelAvailability.pollModelAvailability,
        args,
      );
    }

    return {
      available: false,
      reason: "no Claude model available",
      statuses: selection.statuses,
    };
  },
});

/**
 * Hourly poll loop. Re-checks the fallback chain; on recovery it announces the
 * model and stops, otherwise it reschedules itself one hour out. Guarded by
 * the poll-state row so a recovered (or cancelled) loop doesn't keep running.
 */
export const pollModelAvailability = internalAction({
  args: notifyTargetArgs,
  handler: async (ctx, args): Promise<void> => {
    const poll = await ctx.runQuery(
      internal.functions.ai.modelAvailability.getPoll,
      {},
    );
    if (!poll?.active) return; // Recovered or cancelled out-of-band; stop.

    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      // No key means polling can never succeed — stop and let a future
      // ensureModelAvailable restart it once the key is configured.
      await ctx.runMutation(
        internal.functions.ai.modelAvailability.recordPollResult,
        { active: false },
      );
      return;
    }

    const selection = await probeModels(apiKey);

    if (selection.selectedModel) {
      await ctx.runMutation(
        internal.functions.ai.modelAvailability.recordPollResult,
        {
          active: false,
          lastAvailableModel: selection.selectedModel,
          statusesJson: JSON.stringify(selection.statuses),
        },
      );
      await postNotice(
        ctx,
        { groupId: args.notifyGroupId, channelSlug: args.notifyChannelSlug },
        `✅ Claude is back online (using ${selection.selectedModel}). I'll resume from here.`,
      );
      return;
    }

    // Still down — record and try again in an hour.
    await ctx.runMutation(
      internal.functions.ai.modelAvailability.recordPollResult,
      { active: true, statusesJson: JSON.stringify(selection.statuses) },
    );
    await ctx.scheduler.runAfter(
      CLAUDE_POLL_INTERVAL_MS,
      internal.functions.ai.modelAvailability.pollModelAvailability,
      args,
    );
  },
});
