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
import { bugStatusValidator, riskLevelValidator, scopeValidator } from "./bugs";
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
          // Required on every api.anthropic.com endpoint, including the
          // Claude Code routine fire endpoint — without it the gateway
          // rejects the request with 400 "anthropic-version: header is required".
          "anthropic-version": "2023-06-01",
        },
        // The routine fire endpoint delivers the per-invocation `text` string
        // as the routine's triggering message and ignores any other top-level
        // fields. The routine parses the bug brief out of that message, so the
        // payload must be JSON-stringified into `text` (not sent as the body).
        body: JSON.stringify({ text: JSON.stringify(payload) }),
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
// Dispatch a dashboard contribution to the Routine in spec-drafting mode
// ============================================================================

/**
 * Fire the Claude Code Routine in "spec" mode for a dashboard-submitted
 * contribution (ADR-029). Unlike dispatchBug, the routine must NOT write code:
 * it investigates the codebase, drafts an implementation spec, proposes a risk
 * level plus the Phase 1.5 triage fields (aiTitle/area/scope/verifyOnStaging),
 * and reports them back via the signed /dev-assistant/callback with status
 * IN_REVIEW. The row stays DRAFT until that callback lands.
 *
 * `revision: true` (ADR-029 Phase 1.5) re-fires the routine after the
 * contributor replied in the conversation thread: the payload carries the full
 * thread history and the instructions tell the routine this is a revision
 * round responding to the latest user message.
 *
 * Mirrors dispatchBug's env-missing/error handling: never throws; failures are
 * recorded on the row via recordDispatchError.
 */
export const dispatchSpec = internalAction({
  args: { bugId: v.id("devBugs"), revision: v.optional(v.boolean()) },
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

    // Stamp the routineRunId before the POST so a crash or double-schedule
    // can't double-run the spec routine (same pattern as markDispatched). A
    // failed POST leaves lastError on the row; recovery is manual, never an
    // automatic re-fire (mirrors the impl dispatch policy). Revision rounds
    // stamp a fresh routineRunId, orphaning stale callbacks from the
    // superseded run (see markSpecDispatched).
    const routineRunId = crypto.randomUUID();
    const marked = await ctx.runMutation(
      internal.functions.devAssistant.bugs.markSpecDispatched,
      { bugId: args.bugId, routineRunId, revision: args.revision },
    );
    if (marked.alreadyDispatched) return;

    // Full conversation history so revision rounds (and first drafts, once the
    // report seeds the thread) see the whole back-and-forth.
    const thread = await ctx.runQuery(
      internal.functions.devAssistant.bugs.getThreadHistory,
      { bugId: args.bugId },
    );

    const callbackUrl = `${process.env.CONVEX_SITE_URL}/dev-assistant/callback`;
    const baseInstructions =
      "Spec-drafting mode: do NOT write code or open a PR. Investigate the " +
      "codebase, draft an implementation spec (markdown), and propose a risk " +
      'level ("low" = single-screen UI/copy only; "medium" = one feature\'s ' +
      'logic on one side of the stack, nothing shared; "high" = shared ' +
      "components, frontend + backend together, schema/auth/notifications/" +
      "offline). Also triage the request: aiTitle (short imperative headline, " +
      'e.g. "Fix RSVP message after tapping Going"); area (one of: "events", ' +
      '"chat", "groups", "prayer", "settings", "other"); scope ("buildable" | ' +
      '"split" | "design_needed") — requests too large for one pipeline run ' +
      'must NOT be specced as-is: for "split", the spec body should explain ' +
      'why and propose 2-3 smaller buildable slices; for "design_needed", the ' +
      "spec body should explain what architectural decisions a maintainer " +
      "must make first; and verifyOnStaging (boolean — true for anything " +
      "interactive, false for pure copy/color). Report back by POSTing the " +
      'signed callback with { bugId, routineRunId, status: "IN_REVIEW", spec, ' +
      "riskLevel, aiTitle, area, scope, verifyOnStaging }.";
    const instructions = args.revision
      ? "REVISION ROUND: this contribution already has a spec draft, and the " +
        "contributor replied in the conversation thread (see `thread` — the " +
        "latest user message is what you must respond to). Revise the spec " +
        "and triage accordingly. " +
        baseInstructions
      : baseInstructions;

    const payload = {
      mode: "spec",
      ...(args.revision ? { revision: true } : {}),
      bugId: args.bugId,
      routineRunId,
      kind: bug.kind ?? "bug",
      title: bug.title,
      body: bug.body,
      repro: bug.repro,
      screenshotUrls: bug.screenshotUrls,
      // Full conversation history: [{ authorType, authorName?, body }, ...].
      thread,
      callbackUrl,
      instructions,
    };

    try {
      const res = await fetch(triggerUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Required on every api.anthropic.com endpoint — see dispatchBug.
          "anthropic-version": "2023-06-01",
        },
        // The fire endpoint reads the per-invocation payload from `text` and
        // ignores other top-level fields — see dispatchBug.
        body: JSON.stringify({ text: JSON.stringify(payload) }),
      });
      if (!res.ok) {
        const errBody = await res.text();
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

/**
 * Push copy for the contributor-facing transitions (ADR-029). Returns null for
 * transitions contributors don't need a push for.
 */
function contributorPushForStatus(
  status: string,
  bug: {
    kind?: "bug" | "feature";
    title: string;
    spec?: string;
    verifyOnStaging?: boolean;
  },
): { title: string; body: string } | null {
  const noun = bug.kind === "feature" ? "feature idea" : "bug report";
  switch (status) {
    case "IN_REVIEW":
      // Only meaningful when the spec agent actually delivered a spec.
      if (!bug.spec) return null;
      return {
        title: "Spec ready for review",
        body: `The plan for your ${noun} "${bug.title}" is ready — review and approve it.`,
      };
    case "CODE_REVIEW":
      // The module treats CODE_REVIEW as "the PR exists" (READY_TO_MERGE is a
      // later, maintainer-facing step) — pushing here and not on READY_TO_MERGE
      // means one "PR opened" push, not two.
      // Staging gate (ADR-029 P1.5): interactive changes ask the originator to
      // verify on staging rather than just announcing the PR.
      if (bug.verifyOnStaging) {
        return {
          title: "Ready to test on staging",
          body: `"${bug.title}" is built — try it on staging and confirm it works.`,
        };
      }
      return {
        title: "Your contribution is in code review",
        body: `A pull request is open for "${bug.title}".`,
      };
    case "MERGED":
      return {
        title: "Your contribution shipped 🎉",
        body: `"${bug.title}" was merged. Thanks for making Togather better!`,
      };
    default:
      return null;
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
    spec: v.optional(v.string()),
    riskLevel: v.optional(riskLevelValidator),
    aiTitle: v.optional(v.string()),
    area: v.optional(v.string()),
    scope: v.optional(scopeValidator),
    verifyOnStaging: v.optional(v.boolean()),
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
        spec: args.spec,
        riskLevel: args.riskLevel,
        aiTitle: args.aiTitle,
        area: args.area,
        scope: args.scope,
        verifyOnStaging: args.verifyOnStaging,
      },
    );
    if (!updated) return;

    // If the transition was illegal, applyCallback kept the prior status and
    // only recorded lastError — don't post a status message for a transition
    // that didn't happen (e.g. a CODE_REVIEW callback arriving after a human
    // rejected the bug while the routine was running).
    if (updated.status !== args.status) {
      console.warn(
        `[DevAssistant] Ignored callback ${args.status} for bug ${args.bugId} (current status ${updated.status})`,
      );
      return;
    }

    // Push the originator on the transitions they care about (spec ready, PR
    // opened, shipped). Only when the status genuinely changed — a re-delivered
    // callback for the current status (bug.status === args.status is a legal
    // idempotent re-apply) must not re-push. Chat-originated items are excluded:
    // the thread bot message below already notifies the channel.
    const statusChanged = bug.status !== updated.status;
    if (statusChanged && !updated.channelId) {
      const push = contributorPushForStatus(args.status, updated);
      if (push) {
        await ctx.runAction(
          internal.functions.notifications.actions.sendPushNotification,
          {
            userId: updated.originatorUserId,
            title: push.title,
            body: push.body,
            notificationType: "dev_contribution_update",
            data: {
              bugId: args.bugId,
              status: args.status,
              ...(updated.prUrl ? { prUrl: updated.prUrl } : {}),
            },
          },
        );
      }
    }

    // Dashboard-originated items have no chat thread to post into — the push
    // above (plus the dashboard itself) is their notification surface.
    if (!updated.channelId) return;

    const content = args.message ?? defaultCallbackMessage(args.status, args.prUrl);
    const mentionedUserIds: Id<"users">[] | undefined =
      args.status === "READY_TO_MERGE" ? [updated.originatorUserId] : undefined;

    // KNOWN LIMITATION (MVP, accepted): these status posts (PR links, "Code's
    // up", merge link) are plain bot messages, so they're visible to — and push
    // to — every member of the channel, not just staff. Unlike the bug card,
    // they are not staff-gated. @Togather is therefore intended for staff-only
    // channels; mentioning it in a channel with non-staff members will surface
    // internal PR links/status to them. See docs/secrets.md.
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
