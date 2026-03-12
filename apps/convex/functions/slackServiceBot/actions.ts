/**
 * FOUNT Service Planning Bot - Core Actions
 *
 * Three internalAction functions that drive the bot:
 * 1. createWeeklyThreads - Tuesday cron: creates threads for MHT + BK
 * 2. processThreadReply - Webhook: stateless agent loop (replaces intent classification)
 * 3. checkAndNag - Hourly cron: agent reconciles PCO + Slack and nags for missing items
 */

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import {
  postMessage,
  getThreadReplies,
  addReaction,
  type SlackMessage,
} from "./slack";
import {
  buildThreadCreationMessage,
  buildThreadIntroMessage,
} from "./ai";
import { runAgentLoop } from "./agent";
import { buildMentionPrompt, buildNagPrompt, buildCatchupSyncPrompt, computeItemStatuses } from "./prompts";
import { fetchPcoContextCore } from "./pcoSync";
import type { Doc } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";

// ============================================================================
// Helpers
// ============================================================================

function getSlackToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not configured");
  return token;
}

/** Get the upcoming Sunday's date (or today if it's Sunday) */
function getUpcomingSunday(now: Date): Date {
  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const sunday = new Date(now);
  sunday.setDate(sunday.getDate() + daysUntilSunday);
  sunday.setHours(0, 0, 0, 0);
  return sunday;
}

/** Format a date as "M.DD.YY" (e.g., "9.7.25", "10.19.25") matching Leona's format */
function formatDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = String(date.getFullYear()).slice(-2);
  return `${month}.${day}.${year}`;
}

/** Extract Eastern Time day-of-week and hour from a UTC Date.
 *  Uses Intl.DateTimeFormat.formatToParts to avoid the unreliable
 *  toLocaleString → new Date() round-trip which can mis-apply DST. */
function getEasternTime(now: Date): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const day = dayMap[parts.find((p) => p.type === "weekday")!.value];
  const hour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  return { day, hour };
}

/** Check if a response is a simple acknowledgment that doesn't need to be posted */
function isSimpleAcknowledgment(response: string): boolean {
  const lower = response.toLowerCase().trim();
  // Only suppress short responses — longer ones likely contain substantive content
  if (lower.length > 200) return false;
  return (
    lower.startsWith("got it") ||
    lower.startsWith("✅") ||
    lower.startsWith(":white_check_mark:") ||
    lower.startsWith("no changes") ||
    lower.startsWith("updated:")
  );
}

/**
 * Replace Slack mention tokens (`<@U12345>` or `<@U12345|display_name>`) with
 * the person's real name so the AI can understand who is being referenced.
 *
 * Resolution order:
 * 1. If the mention contains a display name (`<@U123|Jane Doe>`), use it.
 * 2. If the user ID matches a configured team member, use their name.
 * 3. Otherwise, leave the raw mention intact as a fallback.
 */
export function resolveSlackMentions(
  text: string,
  teamMembers: Array<{ slackUserId: string; name: string }>,
  botSlackUserId?: string
): string {
  const memberMap = new Map(teamMembers.map((m) => [m.slackUserId, m.name]));

  return text.replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_match, userId, displayName) => {
    if (botSlackUserId && userId === botSlackUserId) {
      return _match;
    }
    if (displayName) {
      return displayName;
    }
    const knownName = memberMap.get(userId);
    if (knownName) {
      return knownName;
    }
    return _match;
  });
}

/**
 * Format Slack thread messages into OpenAI conversation format.
 * Resolves Slack mentions to real names so the AI can understand
 * who is being referenced when someone uses @mentions.
 */
function formatThreadForAgent(
  messages: SlackMessage[],
  botSlackUserId: string,
  teamMembers?: Array<{ slackUserId: string; name: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  const members = teamMembers ?? [];

  return messages
    .filter((m) => m.text && m.text.trim())
    .map((m) => {
      const isBot = m.bot_id || m.user === botSlackUserId;
      const resolvedText = resolveSlackMentions(m.text!, members, botSlackUserId);
      return {
        role: (isBot ? "assistant" : "user") as "user" | "assistant",
        content: isBot ? m.text! : `<@${m.user || "unknown"}>: ${resolvedText}`,
      };
    });
}

// ============================================================================
// Internal Queries & Mutations
// ============================================================================

/** Get existing threads for a service date, optionally filtered by channel */
export const getThreadsForDate = internalQuery({
  args: { serviceDate: v.number(), channelId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("slackServiceThreads")
      .withIndex("by_serviceDate", (q) => q.eq("serviceDate", args.serviceDate))
      .collect();
    if (args.channelId) {
      return threads.filter((t) => t.slackChannelId === args.channelId);
    }
    return threads;
  },
});

/** Get a thread by its Slack thread timestamp */
export const getThreadByTs = internalQuery({
  args: { slackThreadTs: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("slackServiceThreads")
      .withIndex("by_slackThreadTs", (q) =>
        q.eq("slackThreadTs", args.slackThreadTs)
      )
      .first();
  },
});

/** Get all active threads (this week's Sunday), optionally filtered by channel */
export const getActiveThreads = internalQuery({
  args: { channelId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = new Date();
    const sunday = getUpcomingSunday(now);
    const serviceDate = sunday.getTime();

    const threads = await ctx.db
      .query("slackServiceThreads")
      .withIndex("by_serviceDate", (q) => q.eq("serviceDate", serviceDate))
      .collect();
    if (args.channelId) {
      return threads.filter((t) => t.slackChannelId === args.channelId);
    }
    return threads;
  },
});

/** Delete thread records for a service date (for test cleanup) */
export const deleteThreadsForDate = internalMutation({
  args: { serviceDate: v.number() },
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("slackServiceThreads")
      .withIndex("by_serviceDate", (q) => q.eq("serviceDate", args.serviceDate))
      .collect();
    for (const thread of threads) {
      await ctx.db.delete(thread._id);
    }
    return { deleted: threads.length };
  },
});

/** Save a new thread record */
export const saveThread = internalMutation({
  args: {
    serviceDate: v.number(),
    location: v.string(),
    slackChannelId: v.string(),
    slackThreadTs: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("slackServiceThreads", {
      serviceDate: args.serviceDate,
      location: args.location,
      slackChannelId: args.slackChannelId,
      slackThreadTs: args.slackThreadTs,
      createdAt: Date.now(),
    });
  },
});

// ============================================================================
// Action 1: Create Weekly Threads
// ============================================================================

/**
 * Create threads for the upcoming Sunday's services.
 * Called by hourly cron; only fires on Tuesday at the configured hour (ET).
 *
 * All config comes from DB — no hardcoded fallbacks.
 * Thread creation messages are deterministic (not AI-generated).
 */
export const createWeeklyThreads = internalAction({
  args: {
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = new Date();
    const { day: etDay, hour: etHour } = getEasternTime(now);

    // Get all enabled bot configs
    const allConfigs = await ctx.runQuery(
      internal.functions.slackServiceBot.index.getAllConfigs
    );

    if (allConfigs.length === 0) {
      return { skipped: true, reason: "No configs in DB" };
    }

    const allResults: Array<{ communityId: string; results: Array<{ location: string; threadTs: string; created: boolean }> }> = [];

    for (const config of allConfigs) {
      if (!config.enabled) {
        try {
          await ctx.runMutation(
            internal.functions.slackServiceBot.index.appendActivityLog,
            {
              configId: config._id,
              entry: {
                trigger: "thread_creation",
                toolCalls: [],
                iterations: 0,
                status: "skipped",
                skipReason: "Bot disabled",
                durationMs: 0,
                timestamp: Date.now(),
              },
            }
          );
        } catch (logErr) {
          console.error("[SlackServiceBot] Failed to log skip activity:", logErr);
        }
        continue;
      }

      // Skip thread creation in dev mode to prevent dev deployments from
      // posting to the real Slack channel alongside the production deployment
      if (config.devMode && !args.force) {
        console.log("[SlackServiceBot] Skipping thread creation — devMode is enabled");
        continue;
      }

      // Only run on the configured day at the configured hour (unless forced)
      if (
        !args.force &&
        (etDay !== config.threadCreation.dayOfWeek ||
        etHour !== config.threadCreation.hourET)
      ) {
        continue;
      }

      const token = getSlackToken();
      const channelId = config.slackChannelId;
      const sunday = getUpcomingSunday(now);
      const serviceDate = sunday.getTime();
      const sundayFormatted = formatDate(sunday);

      // Idempotency check — filter by this config's channel to avoid cross-community contamination
      const existingThreads = await ctx.runQuery(
        internal.functions.slackServiceBot.actions.getThreadsForDate,
        { serviceDate, channelId }
      );

      const locations = ["Manhattan", "Brooklyn"] as const;
      const results: Array<{ location: string; threadTs: string; created: boolean }> = [];

      for (const location of locations) {
        const locationStartTime = Date.now();
        const existing = existingThreads.find((t: { location: string }) => t.location === location);
        if (existing) {
          results.push({ location, threadTs: existing.slackThreadTs, created: false });
          try {
            await ctx.runMutation(
              internal.functions.slackServiceBot.index.appendActivityLog,
              {
                configId: config._id,
                entry: {
                  trigger: "thread_creation",
                  location,
                  threadTs: existing.slackThreadTs,
                  toolCalls: [],
                  iterations: 0,
                  status: "skipped",
                  skipReason: "Thread already exists for this date",
                  durationMs: Date.now() - locationStartTime,
                  timestamp: Date.now(),
                },
              }
            );
          } catch (logErr) {
            console.error("[SlackServiceBot] Failed to log skip activity:", logErr);
          }
          continue;
        }

        try {
          // Post thread opener — mentions come from DB config
          const message = buildThreadCreationMessage(location, sundayFormatted, config.threadMentions);
          const threadTs = await postMessage(token, channelId, message);

          const intro = buildThreadIntroMessage(location, config.botSlackUserId);
          await postMessage(token, channelId, intro, threadTs);

          await ctx.runMutation(
            internal.functions.slackServiceBot.actions.saveThread,
            { serviceDate, location, slackChannelId: channelId, slackThreadTs: threadTs }
          );

          results.push({ location, threadTs, created: true });

          try {
            await ctx.runMutation(
              internal.functions.slackServiceBot.index.appendActivityLog,
              {
                configId: config._id,
                entry: {
                  trigger: "thread_creation",
                  location,
                  threadTs,
                  toolCalls: [],
                  iterations: 0,
                  status: "success",
                  durationMs: Date.now() - locationStartTime,
                  timestamp: Date.now(),
                },
              }
            );
          } catch (logErr) {
            console.error("[SlackServiceBot] Failed to log success activity:", logErr);
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`[SlackServiceBot] Failed to create ${location} thread:`, errorMsg);

          try {
            await ctx.runMutation(
              internal.functions.slackServiceBot.index.appendActivityLog,
              {
                configId: config._id,
                entry: {
                  trigger: "thread_creation",
                  location,
                  toolCalls: [],
                  iterations: 0,
                  status: "error",
                  error: errorMsg,
                  durationMs: Date.now() - locationStartTime,
                  timestamp: Date.now(),
                },
              }
            );
          } catch (logErr) {
            console.error("[SlackServiceBot] Failed to log error activity:", logErr);
          }
        }
      }

      // Reset nag tracking only when new threads were created
      if (results.some((r) => r.created)) {
        await ctx.runMutation(
          internal.functions.slackServiceBot.index.resetNagTracking,
          { configId: config._id }
        );
      }

      allResults.push({ communityId: config.communityId, results });
    }

    console.log("[SlackServiceBot] Thread creation results:", allResults);
    return { results: allResults };
  },
});

// ============================================================================
// Action 2: Process Thread Reply (Stateless Agent)
// ============================================================================

/**
 * Process a single reply in a service thread using the stateless agent loop.
 *
 * Replaces the old intent-classification approach. The agent:
 * 1. Reads the full Slack thread for context
 * 2. Fetches PCO plan state for ground truth
 * 3. Uses OpenAI tool-use to decide actions (react, reply, sync to PCO)
 * 4. Executes all actions inline via tools
 */
export const processThreadReply = internalAction({
  args: {
    channelId: v.string(),
    threadTs: v.string(),
    messageTs: v.string(),
    text: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    // Verify this is a tracked thread
    const thread = await ctx.runQuery(
      internal.functions.slackServiceBot.actions.getThreadByTs,
      { slackThreadTs: args.threadTs }
    );

    if (!thread) {
      return { skipped: true, reason: "Not a tracked service thread" };
    }

    const location = thread.location as "Manhattan" | "Brooklyn";

    // Read config from DB by channel
    const config = await ctx.runQuery(
      internal.functions.slackServiceBot.index.getConfigByChannel,
      { slackChannelId: args.channelId }
    );

    if (!config) {
      console.error("[SlackServiceBot] No config found for channel", args.channelId);
      return { skipped: true, reason: "No config for this channel" };
    }

    if (!config.enabled) {
      try {
        await ctx.runMutation(
          internal.functions.slackServiceBot.index.appendActivityLog,
          {
            configId: config._id,
            entry: {
              trigger: "thread_reply",
              location,
              threadTs: args.threadTs,
              messageTs: args.messageTs,
              userId: args.userId,
              toolCalls: [],
              iterations: 0,
              status: "skipped",
              skipReason: "Bot is disabled",
              durationMs: Date.now() - startTime,
              timestamp: startTime,
            },
          }
        );
      } catch (logError) {
        console.error("[SlackServiceBot] Failed to log skip activity:", logError);
      }
      return { skipped: true, reason: "Bot is disabled" };
    }

    // Dedup check — skip if this message was already processed
    const alreadyProcessed = await ctx.runQuery(
      internal.functions.slackServiceBot.index.isMessageProcessed,
      { configId: config._id, messageTs: args.messageTs }
    );
    if (alreadyProcessed) {
      console.log(`[SlackServiceBot] Skipping duplicate message: ${args.messageTs}`);
      try {
        await ctx.runMutation(
          internal.functions.slackServiceBot.index.appendActivityLog,
          {
            configId: config._id,
            entry: {
              trigger: "thread_reply",
              location,
              threadTs: args.threadTs,
              messageTs: args.messageTs,
              userId: args.userId,
              toolCalls: [],
              iterations: 0,
              status: "skipped",
              skipReason: "Already processed",
              durationMs: Date.now() - startTime,
              timestamp: startTime,
            },
          }
        );
      } catch (logError) {
        console.error("[SlackServiceBot] Failed to log skip activity:", logError);
      }
      return { skipped: true, reason: "Already processed" };
    }

    const slackToken = getSlackToken();

    // Declare outside try so catch can include agent data if error occurs after agent completes
    let agentToolCallDetails: Array<{ tool: string; args: unknown; result: unknown; durationMs: number }> = [];
    let agentIterations = 0;

    try {
      // Fetch Slack thread history
      const messages = await getThreadReplies(
        slackToken,
        args.channelId,
        args.threadTs
      );

      // Fetch PCO plan state for ground truth
      let pcoContext = null;
      try {
        pcoContext = await fetchPcoContextCore(ctx, location, config.pcoConfig, config.communityId);
      } catch (error) {
        console.warn("[SlackServiceBot] Failed to fetch PCO context:", error);
      }

      // Build system prompt
      const systemPrompt = buildMentionPrompt(config, pcoContext);

      // Format thread messages for agent
      const threadMessages = formatThreadForAgent(messages, config.botSlackUserId, config.teamMembers);

      // Run agent loop
      const result = await runAgentLoop(ctx, {
        systemPrompt,
        threadMessages,
        executionContext: {
          config,
          slackToken,
          channelId: args.channelId,
          threadTs: args.threadTs,
          messageTs: args.messageTs,
          location,
        },
      });

      // Capture for potential use in catch block
      agentToolCallDetails = result.toolCallDetails;
      agentIterations = result.iterations;

      // Ensure the bot always acknowledges @mentions with a reaction and reply
      const didReact = result.toolsUsed.includes("add_reaction");
      const didReply = result.toolsUsed.includes("reply_in_thread");

      if (!didReact) {
        try {
          await addReaction(slackToken, args.channelId, args.messageTs, "white_check_mark");
        } catch (e) {
          console.warn("[SlackServiceBot] Failed to add fallback reaction:", e);
        }
      }

      // Only post fallback reply if the agent produced a response but didn't use reply_in_thread
      // (This covers edge cases where the agent returns text instead of using the tool)
      // Skip if the response looks like a simple acknowledgment
      if (!didReply && result.response && !isSimpleAcknowledgment(result.response)) {
        try {
          await postMessage(slackToken, args.channelId, result.response, args.threadTs);
        } catch (e) {
          console.warn("[SlackServiceBot] Failed to post fallback reply:", e);
        }
      }

      // Mark message as processed (dedup)
      await ctx.runMutation(
        internal.functions.slackServiceBot.index.markMessageProcessed,
        { configId: config._id, messageTs: args.messageTs }
      );

      // Log success — wrapped so logging failure doesn't trigger the error catch
      try {
        await ctx.runMutation(
          internal.functions.slackServiceBot.index.appendActivityLog,
          {
            configId: config._id,
            entry: {
              trigger: "thread_reply",
              location,
              threadTs: args.threadTs,
              messageTs: args.messageTs,
              userId: args.userId,
              toolCalls: result.toolCallDetails,
              agentResponse: result.response ?? undefined,
              iterations: result.iterations,
              status: "success",
              durationMs: Date.now() - startTime,
              timestamp: startTime,
            },
          }
        );
      } catch (logError) {
        console.error(`[SlackServiceBot] Failed to log success for ${location}:`, logError);
      }

      console.log(
        `[SlackServiceBot] Agent processed ${location} thread: ${result.toolsUsed.length} tools used in ${result.iterations} iterations`
      );

      return {
        location,
        toolsUsed: result.toolsUsed,
        iterations: result.iterations,
      };
    } catch (error) {
      // Log error - includes agent data if error occurred after agent completed
      try {
        await ctx.runMutation(
          internal.functions.slackServiceBot.index.appendActivityLog,
          {
            configId: config._id,
            entry: {
              trigger: "thread_reply",
              location,
              threadTs: args.threadTs,
              messageTs: args.messageTs,
              userId: args.userId,
              toolCalls: agentToolCallDetails,
              iterations: agentIterations,
              status: "error",
              error: error instanceof Error ? error.message : String(error),
              durationMs: Date.now() - startTime,
              timestamp: startTime,
            },
          }
        );
      } catch (logError) {
        console.error(`[SlackServiceBot] Failed to log error for ${location}:`, logError);
      }
      throw error;
    }
  },
});

// ============================================================================
// Action 3: Check and Nag (Two-Phase Stateless Agent)
// ============================================================================

interface NagThreadResult {
  toolsUsed: string[];
  toolCallDetails: Array<{ tool: string; args: unknown; result: unknown; durationMs: number }>;
  iterations: number;
  nagged: boolean;
}

/**
 * Two-phase nag for a single thread:
 *
 * Phase 1 (Catchup sync): Read thread history + current PCO state. If thread
 * mentions info not yet in PCO (from failed previous syncs), sync it now.
 *
 * Phase 2 (Status report): Re-fetch PCO context, pre-compute item statuses
 * in code (not AI), then have the agent format and post the status message.
 */
async function nagThread(
  ctx: ActionCtx,
  config: Doc<"slackBotConfig">,
  thread: { location: string; slackChannelId: string; slackThreadTs: string },
  nagLevel: { urgency: string; label: string },
  slackToken: string
): Promise<NagThreadResult> {
  const location = thread.location;

  // Fetch Slack thread history
  const messages = await getThreadReplies(
    slackToken,
    thread.slackChannelId,
    thread.slackThreadTs
  );
  const threadMessages = formatThreadForAgent(messages, config.botSlackUserId, config.teamMembers);

  // ── Phase 1: Catchup sync ──────────────────────────────────────────────
  // Read thread + PCO, sync any info the thread has but PCO doesn't.
  let pcoContext = null;
  try {
    pcoContext = await fetchPcoContextCore(ctx, location, config.pcoConfig, config.communityId);
  } catch (error) {
    console.warn(`[SlackServiceBot] Failed to fetch PCO context for ${location}:`, error);
  }

  const catchupPrompt = buildCatchupSyncPrompt(config, pcoContext, location);
  const catchupResult = await runAgentLoop(ctx, {
    systemPrompt: catchupPrompt,
    threadMessages,
    executionContext: {
      config,
      slackToken,
      channelId: thread.slackChannelId,
      threadTs: thread.slackThreadTs,
      messageTs: thread.slackThreadTs,
      location,
    },
    // Full PCO tools for syncing, but NO Slack reply/reaction tools
    allowedTools: ["assign_to_pco", "remove_from_pco", "update_plan_item", "search_pco_people"],
  });

  if (catchupResult.toolsUsed.length > 0) {
    console.log(
      `[SlackServiceBot] Catchup sync for ${location}: ${catchupResult.toolsUsed.length} tools used`
    );
  }

  // ── Phase 2: Status report ─────────────────────────────────────────────
  // Re-fetch PCO context if catchup made changes, then pre-compute statuses.
  let freshPcoContext = pcoContext;
  if (catchupResult.toolsUsed.length > 0) {
    try {
      freshPcoContext = await fetchPcoContextCore(ctx, location, config.pcoConfig, config.communityId);
    } catch (error) {
      console.warn(`[SlackServiceBot] Failed to re-fetch PCO context for ${location}:`, error);
    }
  }

  // Pre-compute item statuses deterministically from PCO data
  const itemStatuses = computeItemStatuses(config, freshPcoContext, location);

  // Build nag prompt with pre-computed statuses (AI formats, doesn't decide)
  const nagPrompt = buildNagPrompt(config, nagLevel, freshPcoContext, location, itemStatuses);

  const nagResult = await runAgentLoop(ctx, {
    systemPrompt: nagPrompt,
    threadMessages,
    executionContext: {
      config,
      slackToken,
      channelId: thread.slackChannelId,
      threadTs: thread.slackThreadTs,
      messageTs: thread.slackThreadTs,
      location,
    },
    // Status report only — no PCO writes
    allowedTools: ["reply_in_thread", "add_reaction"],
  });

  return {
    toolsUsed: [...catchupResult.toolsUsed, ...nagResult.toolsUsed],
    toolCallDetails: [...catchupResult.toolCallDetails, ...nagResult.toolCallDetails],
    iterations: catchupResult.iterations + nagResult.iterations,
    nagged: nagResult.toolsUsed.includes("reply_in_thread"),
  };
}

/**
 * Check active threads and send nag/status messages for missing items.
 * Called hourly; reads config from DB for schedule and nag tracking.
 *
 * Two-phase approach per thread:
 * 1. Catchup sync — find unsynced thread info and push to PCO
 * 2. Status report — pre-compute statuses from PCO, then post nag
 */
export const checkAndNag = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    skipped?: boolean;
    reason?: string;
    allResults?: Array<{
      communityId: string;
      nag: string;
      results: Array<{ location: string; toolsUsed: string[]; nagged: boolean }>;
    }>;
  }> => {
    const now = new Date();
    const { day: dayOfWeek, hour } = getEasternTime(now);

    // Get all enabled bot configs
    const allConfigs = await ctx.runQuery(
      internal.functions.slackServiceBot.index.getAllConfigs
    );

    if (allConfigs.length === 0) {
      return { skipped: true, reason: "No configs in DB" };
    }

    const allResults: Array<{
      communityId: string;
      nag: string;
      results: Array<{ location: string; toolsUsed: string[]; nagged: boolean }>;
    }> = [];

    for (const config of allConfigs) {
      if (!config.enabled) continue;

      // Skip nag checks in dev mode to prevent dev deployments from
      // posting to the real Slack channel alongside the production deployment
      if (config.devMode) {
        console.log("[SlackServiceBot] Skipping nag check — devMode is enabled");
        continue;
      }

      // Check if a nag is due right now based on this config's schedule
      const nagDue = config.nagSchedule.find(
        (nag: { dayOfWeek: number; hourET: number; urgency: string; label: string }) =>
          nag.dayOfWeek === dayOfWeek && nag.hourET === hour
      );

      if (!nagDue) continue;

      const slackToken = getSlackToken();

      // Get active threads for this week — filter by this config's channel
      const threads = await ctx.runQuery(
        internal.functions.slackServiceBot.actions.getActiveThreads,
        { channelId: config.slackChannelId }
      );

      if (threads.length === 0) continue;

      const results: Array<{
        location: string;
        toolsUsed: string[];
        nagged: boolean;
      }> = [];

      for (const thread of threads) {
        const location = thread.location as "Manhattan" | "Brooklyn";
        const nagStartTime = Date.now();

        try {
          const alreadySent = await ctx.runQuery(
            internal.functions.slackServiceBot.index.isNagSent,
            { configId: config._id, threadTs: thread.slackThreadTs, urgency: nagDue.urgency }
          );

          if (alreadySent) {
            console.log(`[SlackServiceBot] Nag ${nagDue.urgency} already sent for ${location}`);
            try {
              await ctx.runMutation(
                internal.functions.slackServiceBot.index.appendActivityLog,
                {
                  configId: config._id,
                  entry: {
                    trigger: "nag_check",
                    location,
                    threadTs: thread.slackThreadTs,
                    nagUrgency: nagDue.urgency,
                    nagLabel: nagDue.label,
                    toolCalls: [],
                    iterations: 0,
                    status: "skipped",
                    skipReason: "Nag already sent",
                    durationMs: Date.now() - nagStartTime,
                    timestamp: nagStartTime,
                  },
                }
              );
            } catch (logError) {
              console.error("[SlackServiceBot] Failed to log skip activity:", logError);
            }
            results.push({ location, toolsUsed: [], nagged: false });
            continue;
          }

          // Run two-phase nag
          const result = await nagThread(ctx, config, thread, nagDue, slackToken);

          // Only mark nag as sent if the agent actually posted a message
          if (result.nagged) {
            await ctx.runMutation(
              internal.functions.slackServiceBot.index.markNagSent,
              { configId: config._id, threadTs: thread.slackThreadTs, urgency: nagDue.urgency }
            );
          }

          // Log nag result
          try {
            await ctx.runMutation(
              internal.functions.slackServiceBot.index.appendActivityLog,
              {
                configId: config._id,
                entry: {
                  trigger: "nag_check",
                  location,
                  threadTs: thread.slackThreadTs,
                  nagUrgency: nagDue.urgency,
                  nagLabel: nagDue.label,
                  toolCalls: result.toolCallDetails,
                  iterations: result.iterations,
                  status: "success",
                  durationMs: Date.now() - nagStartTime,
                  timestamp: nagStartTime,
                },
              }
            );
          } catch (logError) {
            console.error(`[SlackServiceBot] Failed to log nag success for ${location}:`, logError);
          }

          results.push({ location, toolsUsed: result.toolsUsed, nagged: result.nagged });
        } catch (error) {
          console.error(`[SlackServiceBot] Error nagging ${location}:`, error);
          try {
            await ctx.runMutation(
              internal.functions.slackServiceBot.index.appendActivityLog,
              {
                configId: config._id,
                entry: {
                  trigger: "nag_check",
                  location,
                  threadTs: thread.slackThreadTs,
                  nagUrgency: nagDue.urgency,
                  nagLabel: nagDue.label,
                  toolCalls: [],
                  iterations: 0,
                  status: "error",
                  error: error instanceof Error ? error.message : String(error),
                  durationMs: Date.now() - nagStartTime,
                  timestamp: nagStartTime,
                },
              }
            );
          } catch (logError) {
            console.error(`[SlackServiceBot] Failed to log nag error for ${location}:`, logError);
          }
          results.push({ location, toolsUsed: [], nagged: false });
        }
      }

      console.log(`[SlackServiceBot] Nag check (${nagDue.label}):`, results);
      allResults.push({ communityId: config.communityId, nag: nagDue.label, results });
    }

    if (allResults.length === 0) {
      return { skipped: true, reason: "No nag due now" };
    }

    return { allResults };
  },
});

// ============================================================================
// Action 4: Manual Nag Trigger
// ============================================================================

/**
 * Manually trigger a nag for active threads. Skips schedule and dedup checks.
 * Useful for re-sending after a bad nag or testing.
 *
 * Usage:
 *   npx convex run functions/slackServiceBot/actions:triggerNag '{}'
 *   npx convex run functions/slackServiceBot/actions:triggerNag '{"location":"Manhattan","urgency":"direct"}'
 */
export const triggerNag = internalAction({
  args: {
    channelId: v.optional(v.string()),
    location: v.optional(v.string()),
    urgency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get all configs (or filter by channel)
    const allConfigs = await ctx.runQuery(
      internal.functions.slackServiceBot.index.getAllConfigs
    );

    const configs = args.channelId
      ? allConfigs.filter((c: { slackChannelId: string }) => c.slackChannelId === args.channelId)
      : allConfigs.filter((c: { enabled: boolean }) => c.enabled);

    if (configs.length === 0) {
      return { error: "No matching config found" };
    }

    const urgency = args.urgency || "gentle";
    const nagLevel = { urgency, label: `Manual nag (${urgency})` };
    const slackToken = getSlackToken();

    const allResults: Array<{
      communityId: string;
      results: Array<{ location: string; toolsUsed: string[]; nagged: boolean }>;
    }> = [];

    for (const config of configs) {
      const threads = await ctx.runQuery(
        internal.functions.slackServiceBot.actions.getActiveThreads,
        { channelId: config.slackChannelId }
      );

      if (threads.length === 0) {
        allResults.push({ communityId: config.communityId, results: [] });
        continue;
      }

      // Filter by location if specified
      const targetThreads = args.location
        ? threads.filter((t: { location: string }) => t.location === args.location)
        : threads;

      const results: Array<{ location: string; toolsUsed: string[]; nagged: boolean }> = [];

      for (const thread of targetThreads) {
        const nagStartTime = Date.now();
        try {
          const result = await nagThread(ctx, config, thread, nagLevel, slackToken);

          try {
            await ctx.runMutation(
              internal.functions.slackServiceBot.index.appendActivityLog,
              {
                configId: config._id,
                entry: {
                  trigger: "manual_nag",
                  location: thread.location,
                  threadTs: thread.slackThreadTs,
                  nagUrgency: urgency,
                  nagLabel: nagLevel.label,
                  toolCalls: result.toolCallDetails,
                  iterations: result.iterations,
                  status: "success",
                  durationMs: Date.now() - nagStartTime,
                  timestamp: nagStartTime,
                },
              }
            );
          } catch (logError) {
            console.error(`[SlackServiceBot] Failed to log manual nag:`, logError);
          }

          results.push({ location: thread.location, toolsUsed: result.toolsUsed, nagged: result.nagged });
        } catch (error) {
          console.error(`[SlackServiceBot] Error in manual nag for ${thread.location}:`, error);
          results.push({ location: thread.location, toolsUsed: [], nagged: false });
        }
      }

      console.log(`[SlackServiceBot] Manual nag results:`, results);
      allResults.push({ communityId: config.communityId, results });
    }

    return { allResults };
  },
});

// ============================================================================
// Test Helper: Create Threads in a Test Channel
// ============================================================================

/**
 * Create service threads in a specified channel (for testing).
 * Skips the day-of-week gate but uses the same message format,
 * postMessage helper, and DB save logic as the real cron.
 */
export const createTestThreads = internalAction({
  args: {
    channelId: v.string(),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    // Read config from DB — by community if provided, otherwise by channel
    let config;
    if (args.communityId) {
      config = await ctx.runQuery(
        internal.functions.slackServiceBot.index.getConfig,
        { communityId: args.communityId }
      );
    } else {
      config = await ctx.runQuery(
        internal.functions.slackServiceBot.index.getConfigByChannel,
        { slackChannelId: args.channelId }
      );
    }

    if (!config) {
      throw new Error("No slack bot config in DB — run seedConfig first");
    }

    const token = getSlackToken();
    const now = new Date();
    const sunday = getUpcomingSunday(now);
    const serviceDate = sunday.getTime();
    const sundayFormatted = formatDate(sunday);

    // Idempotency: check existing threads for this date — filter by channel
    const existingThreads = await ctx.runQuery(
      internal.functions.slackServiceBot.actions.getThreadsForDate,
      { serviceDate, channelId: args.channelId }
    );

    const locations = ["Manhattan", "Brooklyn"] as const;
    const results: Array<{ location: string; threadTs: string; created: boolean }> = [];

    for (const location of locations) {
      const existing = existingThreads.find((t: { location: string }) => t.location === location);
      if (existing) {
        results.push({ location, threadTs: existing.slackThreadTs, created: false });
        continue;
      }

      const message = buildThreadCreationMessage(location, sundayFormatted, config.threadMentions);
      const threadTs = await postMessage(token, args.channelId, message);

      const intro = buildThreadIntroMessage(location, config.botSlackUserId);
      await postMessage(token, args.channelId, intro, threadTs);

      await ctx.runMutation(
        internal.functions.slackServiceBot.actions.saveThread,
        {
          serviceDate,
          location,
          slackChannelId: args.channelId,
          slackThreadTs: threadTs,
        }
      );

      results.push({ location, threadTs, created: true });
    }

    console.log("[SlackServiceBot] Test thread creation results:", results);
    return { results, serviceDate, sundayFormatted };
  },
});
