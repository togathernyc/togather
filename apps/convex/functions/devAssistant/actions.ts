/**
 * Dev-Assistant — actions module (`functions/devAssistant/actions`).
 *
 * Two halves:
 *
 * 1. **Package re-exports.** The pipeline orchestration actions (dispatch spec/
 *    implement/review/fix, policy auto-merge, in-app merge + recovery, in-app
 *    production deploy, the reconcile backstop, and the signed-callback applier)
 *    now live in `@supa-media/dev-assistant`. Re-exported here at exactly
 *    `functions/devAssistant/actions` (the `functionsPath` contract).
 *
 * 2. **Local chat-plumbing.** `processThreadMention` runs the @Togather in-chat
 *    bot's OpenAI tool-use loop against a thread mention. It stays in the app
 *    (OpenAI + chat FKs) and drives the local chat DB ops in bugs.ts.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { buildDevAssistantPrompt } from "./prompts";
import { runAgentLoop, buildThreadMessages } from "./agent";
import type { ToolExecutionContext } from "./tools";
import "./config"; // side-effect: sets config before any handler here runs

// ============================================================================
// Package pipeline actions (functionsPath contract — do not rename/drop)
// ============================================================================
// Genuine builder-output consts re-exported directly from the package. Runtime
// is the package's real actions; no cast needed (see bugs.ts for why).
export {
  dispatchBug,
  dispatchSpec,
  dispatchReview,
  dispatchFix,
  attemptAutoMerge,
  mergeFromApp,
  retryMergeAfterUpdate,
  dispatchProductionDeploy,
  reconcileMergedPrs,
  handleRoutineCallback,
} from "@supa-media/dev-assistant/functions/actions";

// ============================================================================
// Local chat-plumbing — @Togather thread mention → agent loop
// ============================================================================

const FLAG_KEY = "dev-assistant-bot";

export const processThreadMention = internalAction({
  args: {
    channelId: v.id("chatChannels"),
    mentionMessageId: v.id("chatMessages"),
    originatorUserId: v.id("users"),
  },
  handler: async (ctx, args): Promise<void> => {
    // Feature-flag gate.
    const enabled = await ctx.runQuery(
      api.functions.admin.featureFlags.getFeatureFlag,
      { key: FLAG_KEY },
    );
    if (!enabled) return;

    // Access gate — the bot works for Togather staff/superusers and for
    // delegated dev maintainers (granted via /(user)/admin/maintainers).
    const access = await ctx.runQuery(
      internal.functions.devAssistant.bugs.getUserAccess,
      { userId: args.originatorUserId },
    );
    if (!access.isStaff && !access.isSuperuser && !access.isMaintainer) return;

    // Load the thread window + screenshots + any existing bug.
    const threadCtx = await ctx.runQuery(
      internal.functions.devAssistant.bugs.getThreadContext,
      { channelId: args.channelId, mentionMessageId: args.mentionMessageId },
    );
    if (!threadCtx) return;

    const systemPrompt = buildDevAssistantPrompt({
      existingBug: threadCtx.existingBug,
    });
    const threadMessages = buildThreadMessages(threadCtx.messages);

    const execCtx: ToolExecutionContext = {
      communityId: threadCtx.communityId,
      channelId: args.channelId,
      threadRootMessageId: threadCtx.threadRootMessageId,
      originatorUserId: args.originatorUserId,
      screenshotUrls: threadCtx.screenshotUrls,
      currentBugId: threadCtx.existingBug?.bugId,
    };

    let result;
    try {
      result = await runAgentLoop(ctx, {
        systemPrompt,
        threadMessages,
        executionContext: execCtx,
      });
    } catch (error) {
      console.error("[DevAssistant] Agent loop failed:", error);
      await ctx.runMutation(internal.functions.scheduledJobs.insertBotMessage, {
        channelId: args.channelId,
        content:
          "I hit an error processing that — try again in a moment, or ping a maintainer.",
        botType: "dev_assistant",
        contentType: "bot",
        parentMessageId: threadCtx.threadRootMessageId,
      });
      return;
    }

    // Fallback: the model produced text but never called reply_in_thread.
    if (result.response && !result.toolsUsed.includes("reply_in_thread")) {
      await ctx.runMutation(internal.functions.scheduledJobs.insertBotMessage, {
        channelId: args.channelId,
        content: result.response,
        botType: "dev_assistant",
        contentType: "bot",
        bugId: execCtx.currentBugId,
        parentMessageId: threadCtx.threadRootMessageId,
      });
    }
  },
});
