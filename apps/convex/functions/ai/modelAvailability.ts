/**
 * Claude model availability — Convex layer.
 *
 * Wraps the pure probe in `lib/ai/claudeAvailability.ts` with the bot's
 * runtime behavior. Before the Togather Bot dispatches a task to a Claude
 * model it calls `ensureModelAvailable`, which:
 *
 *   1. Probes Claude Opus, then Claude Sonnet (`selectAvailableClaudeModel`).
 *   2. Returns the first healthy model so the caller can run the task.
 *   3. If BOTH are down, posts a heads-up into the calling thread and starts an
 *      hourly poll (`pollModelAvailability`) that re-checks until a model
 *      recovers — then announces it's back to every affected thread and stops.
 *
 * Multiple threads can trip the gate during the same outage; each is recorded
 * once in `notifyTargets` and gets exactly one heads-up and one back-online
 * notice. Whichever path notices recovery first (a later gate retry, or the
 * hourly poll) announces to all of them and clears the loop.
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

interface NotifyTarget {
  groupId: Id<"groups">;
  channelSlug?: string;
}

/** A single thread to notify, as accepted from a calling task. */
const notifyTargetArgs = {
  notifyGroupId: v.optional(v.id("groups")),
  notifyChannelSlug: v.optional(v.string()),
};

/** Identity key for deduping notify targets by thread. */
function targetKey(t: NotifyTarget): string {
  return `${t.groupId}::${t.channelSlug ?? ""}`;
}

function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}

async function probeModels(apiKey: string): Promise<ModelSelection> {
  return selectAvailableClaudeModel({ apiKey });
}

async function postNotice(
  ctx: ActionCtx,
  target: NotifyTarget,
  message: string,
): Promise<void> {
  await ctx.runAction(internal.functions.scheduledJobs.sendBotMessage, {
    groupId: target.groupId,
    message,
    targetChannelSlug: target.channelSlug,
    botType: "claude_availability",
  });
}

const OUTAGE_MESSAGE =
  "⚠️ Claude is temporarily unavailable — both Opus and Sonnet are unreachable. I'll keep checking every hour and resume automatically once one is back.";

function recoveryMessage(model: string): string {
  return `✅ Claude is back online (using ${model}). I'll resume from here.`;
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
 * Start the poll loop if one isn't already running and record the calling
 * thread as an outage target. Idempotent on both axes:
 *   - `started`: true only when the loop transitioned from off → on, so poll
 *     chains never stack.
 *   - `targetAdded`: true only when this thread wasn't already a target, so a
 *     thread is warned at most once per outage.
 */
export const beginPoll = internalMutation({
  args: { ...notifyTargetArgs, statusesJson: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ started: boolean; targetAdded: boolean }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("claudeModelPolls")
      .withIndex("by_key", (q) => q.eq("key", POLL_KEY))
      .unique();

    const target: NotifyTarget | null = args.notifyGroupId
      ? { groupId: args.notifyGroupId, channelSlug: args.notifyChannelSlug }
      : null;

    const current: NotifyTarget[] = existing?.notifyTargets ?? [];
    const targetAdded =
      target !== null && !current.some((t) => targetKey(t) === targetKey(target));
    const notifyTargets = targetAdded ? [...current, target] : current;
    const started = !existing?.active;

    if (existing) {
      await ctx.db.patch(existing._id, {
        active: true,
        notifyTargets,
        lastCheckedAt: now,
        lastStatuses: args.statusesJson ?? existing.lastStatuses,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("claudeModelPolls", {
        key: POLL_KEY,
        active: true,
        lastCheckedAt: now,
        lastStatuses: args.statusesJson,
        notifyTargets,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { started, targetAdded };
  },
});

/** Record a poll tick that did NOT recover (loop keeps running, or stops on no-key). */
export const recordTick = internalMutation({
  args: { active: v.boolean(), statusesJson: v.optional(v.string()) },
  handler: async (ctx, args): Promise<void> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("claudeModelPolls")
      .withIndex("by_key", (q) => q.eq("key", POLL_KEY))
      .unique();
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      active: args.active,
      lastCheckedAt: now,
      lastStatuses: args.statusesJson ?? existing.lastStatuses,
      updatedAt: now,
    });
  },
});

/**
 * Clear an active poll on recovery and hand back the threads that need a
 * back-online notice. Returns `wasActive: false` (with no targets) when there
 * was no outage in progress, so the healthy path stays a cheap no-op and only
 * one caller ever announces recovery.
 */
export const resolveRecovery = internalMutation({
  args: { lastAvailableModel: v.string(), statusesJson: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ wasActive: boolean; targets: NotifyTarget[] }> => {
    const existing = await ctx.db
      .query("claudeModelPolls")
      .withIndex("by_key", (q) => q.eq("key", POLL_KEY))
      .unique();
    if (!existing?.active) return { wasActive: false, targets: [] };

    const targets = existing.notifyTargets ?? [];
    await ctx.db.patch(existing._id, {
      active: false,
      notifyTargets: [],
      lastAvailableModel: args.lastAvailableModel,
      lastCheckedAt: Date.now(),
      lastStatuses: args.statusesJson ?? existing.lastStatuses,
      updatedAt: Date.now(),
    });
    return { wasActive: true, targets };
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
 * `{ available: false }` after notifying the calling thread and starting the
 * hourly poll. Callers should treat `available: false` as "don't dispatch yet".
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
    const statusesJson = JSON.stringify(selection.statuses);

    if (selection.selectedModel) {
      // Healthy. If this retry is the first to see Claude recover, clear the
      // active poll and deliver the back-online notice to every affected
      // thread (the scheduled poll will then exit as a no-op).
      const recovery = await ctx.runMutation(
        internal.functions.ai.modelAvailability.resolveRecovery,
        { lastAvailableModel: selection.selectedModel, statusesJson },
      );
      if (recovery.wasActive) {
        await announceRecovery(ctx, recovery.targets, selection.selectedModel);
      }
      return {
        available: true,
        model: selection.selectedModel,
        statuses: selection.statuses,
      };
    }

    // Both models down. Record this thread as a target (idempotently) and start
    // one poll loop. Notify any newly-affected thread once, regardless of
    // whether this call is the one that started the loop.
    const { started, targetAdded } = await ctx.runMutation(
      internal.functions.ai.modelAvailability.beginPoll,
      { ...args, statusesJson },
    );
    if (targetAdded && args.notifyGroupId) {
      await postNotice(
        ctx,
        { groupId: args.notifyGroupId, channelSlug: args.notifyChannelSlug },
        OUTAGE_MESSAGE,
      );
    }
    if (started) {
      await ctx.scheduler.runAfter(
        CLAUDE_POLL_INTERVAL_MS,
        internal.functions.ai.modelAvailability.pollModelAvailability,
        {},
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
 * model to every affected thread and stops, otherwise it reschedules itself one
 * hour out. Reads its notify targets from the poll-state row, so it covers
 * every thread that tripped the gate during the outage.
 */
export const pollModelAvailability = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
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
        internal.functions.ai.modelAvailability.recordTick,
        { active: false },
      );
      return;
    }

    const selection = await probeModels(apiKey);
    const statusesJson = JSON.stringify(selection.statuses);

    if (selection.selectedModel) {
      const recovery = await ctx.runMutation(
        internal.functions.ai.modelAvailability.resolveRecovery,
        { lastAvailableModel: selection.selectedModel, statusesJson },
      );
      if (recovery.wasActive) {
        await announceRecovery(ctx, recovery.targets, selection.selectedModel);
      }
      return;
    }

    // Still down — record and try again in an hour.
    await ctx.runMutation(internal.functions.ai.modelAvailability.recordTick, {
      active: true,
      statusesJson,
    });
    await ctx.scheduler.runAfter(
      CLAUDE_POLL_INTERVAL_MS,
      internal.functions.ai.modelAvailability.pollModelAvailability,
      {},
    );
  },
});

async function announceRecovery(
  ctx: ActionCtx,
  targets: NotifyTarget[],
  model: string,
): Promise<void> {
  for (const target of targets) {
    await postNotice(ctx, target, recoveryMessage(model));
  }
}
