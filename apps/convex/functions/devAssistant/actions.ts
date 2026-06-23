/**
 * Dev-Assistant Bot — Actions
 *
 * Orchestration that needs an ActionCtx: running the agent loop against a
 * thread mention, dispatching ready bugs to the Claude Code Routine, and
 * applying signed routine callbacks back into the thread.
 */

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { buildDevAssistantPrompt } from "./prompts";
import { runAgentLoop, buildThreadMessages } from "./agent";
import { bugStatusValidator } from "./bugs";
import type { ToolExecutionContext } from "./tools";

const FLAG_KEY = "dev-assistant-bot";

// ============================================================================
// Thread mention → agent loop
// ============================================================================

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

    // Staff gate — the bot only ever works for Togather staff/superusers.
    const access = await ctx.runQuery(
      internal.functions.devAssistant.bugs.getUserAccess,
      { userId: args.originatorUserId },
    );
    if (!access.isStaff && !access.isSuperuser) return;

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

// ============================================================================
// Dispatch a ready bug to the Claude Code Routine
// ============================================================================

export const dispatchBug = internalAction({
  args: { bugId: v.id("devBugs"), forceRedispatch: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<void> => {
    const bug = await ctx.runQuery(internal.functions.devAssistant.bugs.getBug, {
      bugId: args.bugId,
    });
    if (!bug) return;

    const triggerUrl = process.env.CLAUDE_ROUTINES_TRIGGER_URL;
    const token = process.env.CLAUDE_ROUTINES_TOKEN;
    if (!triggerUrl || !token) {
      console.error("[DevAssistant] CLAUDE_ROUTINES_* env not configured");
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordDispatchError,
        { bugId: args.bugId, error: "Routine trigger env not configured" },
      );
      return;
    }

    // A normal dispatch reuses the existing routineRunId on retry; a fresh
    // dispatch generates one and flips to IN_PROGRESS before the POST so a
    // crash can't double-run the routine.
    let routineRunId = bug.routineRunId;
    if (!args.forceRedispatch || !routineRunId) {
      routineRunId = routineRunId ?? crypto.randomUUID();
      const marked = await ctx.runMutation(
        internal.functions.devAssistant.bugs.markDispatched,
        { bugId: args.bugId, routineRunId },
      );
      if (marked.alreadyDispatched && !args.forceRedispatch) return;
    }

    const callbackUrl = `${process.env.CONVEX_SITE_URL}/dev-assistant/callback`;
    const payload = {
      bugId: args.bugId,
      routineRunId,
      title: bug.title,
      body: bug.body,
      repro: bug.repro,
      screenshotUrls: bug.screenshotUrls,
      callbackUrl,
    };

    try {
      const res = await fetch(triggerUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = await res.text();
        // Stay IN_PROGRESS + record error — never auto-revert. A failed POST
        // that actually reached the routine must not re-dispatch; recovery is
        // the manual "Retry dispatch" action.
        await ctx.runMutation(
          internal.functions.devAssistant.bugs.recordDispatchError,
          { bugId: args.bugId, error: `Routine POST ${res.status}: ${errBody}` },
        );
      }
    } catch (error) {
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordDispatchError,
        { bugId: args.bugId, error: String(error) },
      );
    }
  },
});

// ============================================================================
// Routine callback → thread message
// ============================================================================

function defaultCallbackMessage(
  status: string,
  prUrl: string | undefined,
): string {
  switch (status) {
    case "CODE_REVIEW":
      return prUrl
        ? `🛠️ Code's up and the review cycle is running.\nPR: ${prUrl}`
        : "🛠️ Code's up and the review cycle is running.";
    case "READY_TO_MERGE":
      return prUrl
        ? `🚀 This is ready to merge.\nMerge it here: ${prUrl}`
        : "🚀 This is ready to merge.";
    case "MERGED":
      return "🎉 Merged. Thanks!";
    case "REJECTED":
      return "This bug was rejected.";
    default:
      return `Status update: ${status}`;
  }
}

export const handleRoutineCallback = internalAction({
  args: {
    bugId: v.id("devBugs"),
    routineRunId: v.string(),
    status: bugStatusValidator,
    prUrl: v.optional(v.string()),
    screenshots: v.optional(v.array(v.string())),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    // Correlate by routineRunId and verify it matches the claimed bugId.
    const bug = await ctx.runQuery(
      internal.functions.devAssistant.bugs.getBugByRoutineRunId,
      { routineRunId: args.routineRunId },
    );
    if (!bug || bug._id !== args.bugId) {
      console.error(
        "[DevAssistant] Callback bug/routineRunId mismatch",
        args.routineRunId,
        args.bugId,
      );
      return;
    }

    const updated = await ctx.runMutation(
      internal.functions.devAssistant.bugs.applyCallback,
      {
        bugId: args.bugId,
        status: args.status,
        prUrl: args.prUrl,
        screenshots: args.screenshots,
      },
    );
    if (!updated) return;

    const content = args.message ?? defaultCallbackMessage(args.status, args.prUrl);
    const mentionedUserIds: Id<"users">[] | undefined =
      args.status === "READY_TO_MERGE" ? [updated.originatorUserId] : undefined;

    await ctx.runMutation(internal.functions.scheduledJobs.insertBotMessage, {
      channelId: updated.channelId,
      content,
      botType: "dev_assistant",
      contentType: "bot",
      bugId: args.bugId,
      parentMessageId: updated.threadRootMessageId,
      mentionedUserIds,
      // Idempotency: re-delivered callbacks for the same status are dropped.
      sourceKey: `bug:${args.bugId}:${args.status}`,
    });
  },
});
