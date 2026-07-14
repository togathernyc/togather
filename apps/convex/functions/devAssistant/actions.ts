/**
 * Dev-Assistant Bot — Actions
 *
 * Orchestration that needs an ActionCtx: running the agent loop against a
 * thread mention, dispatching ready bugs to the Claude Code Routine, and
 * applying signed routine callbacks back into the thread.
 */

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { getMediaUrl } from "../../lib/utils";
import { buildDevAssistantPrompt } from "./prompts";
import { runAgentLoop, buildThreadMessages } from "./agent";
import {
  bugStatusValidator,
  callbackSourceValidator,
  reviewVerdictValidator,
  riskLevelValidator,
  scopeValidator,
  splitSlicesValidator,
} from "./bugs";
import { AUTO_MERGE_SEVERITY_ORDER } from "./maintainers";
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

/**
 * Per-mode Routine trigger credentials (spec / implement / review run as
 * separate Routines with least-privilege credentials — see
 * docs/dev-assistant/ROUTINE-PROMPT.md), falling back to the legacy single
 * CLAUDE_ROUTINES_TRIGGER_URL/TOKEN so a one-Routine setup keeps working.
 */
function routineTrigger(mode: "spec" | "implement" | "review"): {
  triggerUrl: string | undefined;
  token: string | undefined;
} {
  const perMode =
    mode === "spec"
      ? {
          triggerUrl: process.env.CLAUDE_ROUTINES_TRIGGER_URL_SPEC,
          token: process.env.CLAUDE_ROUTINES_TOKEN_SPEC,
        }
      : mode === "implement"
        ? {
            triggerUrl: process.env.CLAUDE_ROUTINES_TRIGGER_URL_IMPL,
            token: process.env.CLAUDE_ROUTINES_TOKEN_IMPL,
          }
        : {
            triggerUrl: process.env.CLAUDE_ROUTINES_TRIGGER_URL_REVIEW,
            token: process.env.CLAUDE_ROUTINES_TOKEN_REVIEW,
          };
  return {
    triggerUrl: perMode.triggerUrl ?? process.env.CLAUDE_ROUTINES_TRIGGER_URL,
    token: perMode.token ?? process.env.CLAUDE_ROUTINES_TOKEN,
  };
}

/** Repo the dev dashboard mirrors issues into (ADR-029 Phase 2). */
const GITHUB_ISSUES_ENDPOINT =
  "https://api.github.com/repos/togathernyc/togather/issues";

/** Same repo's pulls endpoint — used by policy auto-merge (ADR-029 Phase 3). */
const GITHUB_PULLS_ENDPOINT =
  "https://api.github.com/repos/togathernyc/togather/pulls";

/**
 * GitHub PAT used for issue mirroring and Phase 3 auto-merge. The owner named
 * the secret GH_MIRROR_TOKEN; GITHUB_MIRROR_TOKEN is the legacy fallback.
 */
function githubMirrorToken(): string | undefined {
  return process.env.GH_MIRROR_TOKEN ?? process.env.GITHUB_MIRROR_TOKEN;
}

/**
 * Body for the mirrored GitHub issue: the approved spec when there is one,
 * otherwise the raw brief (+ repro), plus a provenance footer.
 */
function buildGithubIssueBody(bug: {
  spec?: string;
  body: string;
  repro?: string;
}): string {
  const sections: string[] = [];
  if (bug.spec) {
    sections.push(bug.spec);
  } else {
    sections.push(bug.body);
    if (bug.repro) sections.push(`## Repro\n\n${bug.repro}`);
  }
  sections.push(
    "---\n_Filed via the Togather dev dashboard " +
      "([ADR-029](https://github.com/togathernyc/togather/blob/main/docs/architecture/ADR-029-contributor-dev-dashboard.md))._",
  );
  return sections.join("\n\n");
}

export const dispatchBug = internalAction({
  args: { bugId: v.id("devBugs"), forceRedispatch: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<void> => {
    const bug = await ctx.runQuery(internal.functions.devAssistant.bugs.getBug, {
      bugId: args.bugId,
    });
    if (!bug) return;

    // Staging-redo round (reportStagingIssue): the item's original PR is
    // already merged, but the contributor found problems on staging. Inferred
    // from the PERSISTED counter — not a dispatch arg — so the redo context
    // survives every re-entry point (including the manual "Retry dispatch").
    // The payload carries the conversation thread + instructions to fix the
    // reported problems and open a NEW PR against latest main.
    const stagingRedo = (bug.redoRounds ?? 0) > 0;

    const { triggerUrl, token } = routineTrigger("implement");
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

    // GitHub issue mirroring (ADR-029 Phase 2): create the tracking issue
    // BEFORE firing the Routine so the payload can carry its number (the
    // Routine writes "Closes #N" in the PR body and GitHub auto-closes the
    // issue on merge). Skipped silently when GH_MIRROR_TOKEN is unset
    // (feature not enabled) or the bug already has an issue (retry paths).
    // Failures are non-fatal: log + lastError breadcrumb, keep dispatching.
    let githubIssueNumber = bug.githubIssueNumber;
    const mirrorToken = githubMirrorToken();
    if (mirrorToken && githubIssueNumber === undefined) {
      try {
        const res = await fetch(GITHUB_ISSUES_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mirrorToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: bug.aiTitle ?? bug.title,
            body: buildGithubIssueBody(bug),
          }),
        });
        if (!res.ok) {
          throw new Error(`GitHub issue POST ${res.status}: ${await res.text()}`);
        }
        const issue = (await res.json()) as {
          number?: number;
          html_url?: string;
        };
        if (typeof issue.number !== "number") {
          throw new Error("GitHub issue response missing `number`");
        }
        githubIssueNumber = issue.number;
        await ctx.runMutation(
          internal.functions.devAssistant.bugs.setGithubIssue,
          {
            bugId: args.bugId,
            githubIssueNumber: issue.number,
            githubIssueUrl:
              typeof issue.html_url === "string" ? issue.html_url : undefined,
          },
        );
      } catch (error) {
        console.error("[DevAssistant] GitHub issue mirroring failed:", error);
        await ctx.runMutation(
          internal.functions.devAssistant.bugs.recordDispatchError,
          {
            bugId: args.bugId,
            error: `GitHub issue mirroring failed (non-fatal): ${String(error)}`,
          },
        );
      }
    }

    // Originator attribution for the Co-authored-by trailer (ADR-029 Phase 2).
    const originator = await ctx.runQuery(
      internal.functions.devAssistant.bugs.getOriginatorAttribution,
      { bugId: args.bugId },
    );

    // A staging-redo run needs the conversation: the latest user messages
    // describe what went wrong on staging.
    const thread = stagingRedo
      ? await ctx.runQuery(
          internal.functions.devAssistant.bugs.getThreadHistory,
          { bugId: args.bugId },
        )
      : null;

    // Redo rounds also carry every picture in play — the report's shots PLUS
    // any attached to thread replies (contributors screenshot the broken
    // staging behavior right before tapping "Something's off"). Mirrors
    // dispatchSpec's resolution: de-dupe, then resolve r2: paths to public
    // URLs the vision-capable routine can fetch.
    const redoShots = stagingRedo
      ? Array.from(
          new Set([
            ...(bug.screenshotUrls ?? []),
            ...(thread ?? []).flatMap((m) => m.imageUrls ?? []),
          ]),
        )
          .map((u) => getMediaUrl(u))
          .filter((u): u is string => !!u)
      : null;

    // The report's own screenshots, resolved to fetchable URLs. bug.screenshotUrls
    // holds raw r2: storage paths the (vision-capable) routine can't fetch, so
    // resolve before dispatch — same as the spec/redo paths above. (getMediaUrl
    // passes existing http(s) URLs through unchanged.)
    const reportShots = (bug.screenshotUrls ?? [])
      .map((u) => getMediaUrl(u))
      .filter((u): u is string => !!u);

    const callbackUrl = `${process.env.CONVEX_SITE_URL}/dev-assistant/callback`;
    const payload = {
      bugId: args.bugId,
      routineRunId,
      title: bug.title,
      body: bug.body,
      repro: bug.repro,
      screenshotUrls:
        redoShots && redoShots.length > 0
          ? redoShots
          : reportShots.length > 0
            ? reportShots
            : undefined,
      // Approved spec + risk level so the Routine builds against the plan the
      // contributor signed off on (undefined for chat-originated bugs).
      spec: bug.spec,
      riskLevel: bug.riskLevel,
      // The Routine references the mirrored issue ("Closes #N") in its PR.
      githubIssueNumber,
      // Attribution for the Co-authored-by commit trailer.
      originatorName: originator?.name,
      originatorGithubUsername: originator?.githubUsername,
      callbackUrl,
      ...(stagingRedo && thread
        ? {
            redo: true,
            thread: thread.map((m) => ({
              authorType: m.authorType,
              ...(m.authorName ? { authorName: m.authorName } : {}),
              body: m.body,
            })),
            instructions:
              "REDO ROUND: an earlier PR for this item was already merged, " +
              "but the contributor found problems while trying the change on " +
              "staging — the latest user messages in `thread` describe " +
              "what's wrong (screenshotUrls includes any pictures they " +
              "attached). Start from the latest main (the merged code is " +
              "already in it), fix the reported problems, and open a NEW " +
              "pull request on a fresh claude/devbug-<bugId> branch. Report " +
              "callbacks as usual (IN_PROGRESS when you start, CODE_REVIEW " +
              "with the new prUrl once the PR is open and CI is green). " +
              "Never merge the PR.",
          }
        : {}),
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

    const { triggerUrl, token } = routineTrigger("spec");
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
      "why and propose 2-3 smaller buildable slices AND you MUST return a " +
      "`splitSlices` array (one entry per slice) where each entry is { title, " +
      "prompt }: `title` is the slice's short name and `prompt` is a " +
      "self-contained instruction a maintainer can paste straight into a fresh " +
      "dev session to build THAT slice alone (state the slice's goal, the " +
      "files/areas involved, the done-when checklist, and that it is one slice " +
      'of a larger split so the other slices are out of scope); for ' +
      '"design_needed", the spec body should explain what architectural ' +
      "decisions a maintainer must make first; and verifyOnStaging (boolean — " +
      "true for anything interactive, false for pure copy/color). Report back " +
      'by POSTing the signed callback with { bugId, routineRunId, status: ' +
      '"IN_REVIEW", spec, riskLevel, aiTitle, area, scope, splitSlices?, ' +
      "verifyOnStaging }.";
    const instructions = args.revision
      ? "REVISION ROUND: this contribution already has a spec draft — the " +
        "payload's `spec` field carries its CURRENT full text (the thread " +
        "only contains short pointers to it, not the plan itself) — and the " +
        "contributor replied in the conversation thread (see `thread` — the " +
        "latest user message is what you must respond to). Revise that spec " +
        "and triage accordingly. " +
        baseInstructions
      : baseInstructions;

    // Pictures reach the (vision-capable) routine as fetchable URLs: gather
    // the report's shots plus any attached to thread replies, de-dupe, and
    // resolve the stored R2 paths to public URLs (getMediaUrl passes existing
    // http(s) URLs through unchanged, so chat-originated shots stay valid).
    const rawShots = [
      ...(bug.screenshotUrls ?? []),
      ...thread.flatMap((m) => m.imageUrls ?? []),
    ];
    const screenshotUrls = Array.from(new Set(rawShots))
      .map((u) => getMediaUrl(u))
      .filter((u): u is string => !!u);

    const payload = {
      mode: "spec",
      ...(args.revision ? { revision: true } : {}),
      bugId: args.bugId,
      routineRunId,
      kind: bug.kind ?? "bug",
      title: bug.title,
      body: bug.body,
      repro: bug.repro,
      // The current spec draft, so revision rounds see the plan they're
      // revising. The thread no longer carries the spec text (it holds only
      // short "plan ready/updated" pointers), so omitting this would leave
      // the reviser blind to what it's amending.
      spec: bug.spec,
      screenshotUrls: screenshotUrls.length > 0 ? screenshotUrls : undefined,
      // Full conversation history: [{ authorType, authorName?, body }, ...].
      // (Image paths are folded into screenshotUrls above, not the thread.)
      thread: thread.map((m) => ({
        authorType: m.authorType,
        ...(m.authorName ? { authorName: m.authorName } : {}),
        body: m.body,
      })),
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
// Dispatch an opened PR to the Routine in review mode
// ============================================================================

/**
 * Fire the Claude Code Routine in "review" mode after an implementation run
 * opens a PR (scheduled by applyCallback on a GENUINE transition into
 * CODE_REVIEW). The review run checks out the PR, reviews the diff against
 * the spec with parallel reviewer subagents, posts its surviving findings as
 * real GitHub PR review comments itself, and reports a verdict back via the
 * signed callback (`reviewVerdict` "approved" | "changes_requested" +
 * `reviewSummary`).
 *
 * Stamps a FRESH routineRunId before the POST (markReviewDispatched) so the
 * review run owns callback correlation from here on — stale callbacks from
 * the superseded implementation run fall on the floor. Mirrors dispatchSpec's
 * env-missing/error handling: never throws; failures land in lastError.
 */
export const dispatchReview = internalAction({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<void> => {
    const bug = await ctx.runQuery(internal.functions.devAssistant.bugs.getBug, {
      bugId: args.bugId,
    });
    if (!bug) return;

    // A review needs a PR to review. CODE_REVIEW without a prUrl is anomalous
    // (the implementation callback should always carry it) — leave a
    // breadcrumb instead of firing a routine with nothing to check out.
    if (!bug.prUrl) {
      console.error(
        "[DevAssistant] dispatchReview skipped: bug has no prUrl",
        args.bugId,
      );
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordDispatchError,
        { bugId: args.bugId, error: "Review dispatch skipped: bug has no prUrl" },
      );
      return;
    }

    const { triggerUrl, token } = routineTrigger("review");
    if (!triggerUrl || !token) {
      console.error("[DevAssistant] CLAUDE_ROUTINES_* env not configured");
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordDispatchError,
        { bugId: args.bugId, error: "Routine trigger env not configured" },
      );
      return;
    }

    // Stamp a fresh routineRunId before the POST (same crash-safety pattern as
    // markDispatched/markSpecDispatched). A failed POST leaves lastError on
    // the row; recovery is manual, never an automatic re-fire.
    const routineRunId = crypto.randomUUID();
    const marked = await ctx.runMutation(
      internal.functions.devAssistant.bugs.markReviewDispatched,
      { bugId: args.bugId, routineRunId },
    );
    if (marked.alreadyDispatched) return;

    const callbackUrl = `${process.env.CONVEX_SITE_URL}/dev-assistant/callback`;
    const instructions =
      "Review mode: do NOT implement changes — review the open pull request. " +
      "(a) Check out the PR and review its diff against the spec using " +
      "parallel reviewer subagents, one each for correctness, security, " +
      "spec-fidelity/UX, and tests; adversarially verify every finding " +
      "before reporting it and discard anything that doesn't survive. " +
      "(b) Post the surviving findings as GitHub PR review comments (inline " +
      "on the relevant lines where possible) so the review is publicly " +
      "visible on the PR. (c) Report back by POSTing the signed callback " +
      'with { bugId, routineRunId, status: "CODE_REVIEW", reviewVerdict, ' +
      'reviewSummary }: reviewVerdict is "approved" (no blocking findings) ' +
      'or "changes_requested", and reviewSummary is a short one-to-two ' +
      "sentence summary of the review outcome.";

    const payload = {
      mode: "review",
      bugId: args.bugId,
      routineRunId,
      prUrl: bug.prUrl,
      title: bug.title,
      aiTitle: bug.aiTitle,
      spec: bug.spec,
      riskLevel: bug.riskLevel,
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
// Dispatch a review-rejected PR to the Routine in fix mode
// ============================================================================

/**
 * Fire the Claude Code Routine in "fix" mode after a review run reports
 * `changes_requested` (scheduled by applyCallback while the fix-round budget
 * lasts — ADR-029 Phase 3). The fix run reads the PR's review comments,
 * addresses every finding (or replies on the comment explaining why not),
 * pushes to the SAME branch, gets CI green, and reports back with a
 * CODE_REVIEW callback — which applyCallback turns into a fresh review round.
 *
 * Uses the implement-Routine credentials (routineTrigger("implement")) since
 * fixing needs push access. Stamps a FRESH routineRunId + increments
 * fixRounds via markFixDispatched BEFORE the POST (same crash-safety pattern
 * as the other dispatchers); failures land in lastError, never throw.
 */
export const dispatchFix = internalAction({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<void> => {
    const bug = await ctx.runQuery(internal.functions.devAssistant.bugs.getBug, {
      bugId: args.bugId,
    });
    if (!bug) return;

    // A fix run needs a PR to fix — mirrors dispatchReview's anomaly handling.
    if (!bug.prUrl) {
      console.error(
        "[DevAssistant] dispatchFix skipped: bug has no prUrl",
        args.bugId,
      );
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordDispatchError,
        { bugId: args.bugId, error: "Fix dispatch skipped: bug has no prUrl" },
      );
      return;
    }

    const { triggerUrl, token } = routineTrigger("implement");
    if (!triggerUrl || !token) {
      console.error("[DevAssistant] CLAUDE_ROUTINES_* env not configured");
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordDispatchError,
        { bugId: args.bugId, error: "Routine trigger env not configured" },
      );
      return;
    }

    // Stamp a fresh routineRunId + count the round BEFORE the POST. From here
    // on the fix run owns callback correlation; stale callbacks from the
    // superseded review run fall on the floor. markFixDispatched also logs the
    // "round N of 3" system message so the thread reflects real dispatches.
    const routineRunId = crypto.randomUUID();
    const marked = await ctx.runMutation(
      internal.functions.devAssistant.bugs.markFixDispatched,
      { bugId: args.bugId, routineRunId },
    );
    if (marked.alreadyDispatched) return;

    const callbackUrl = `${process.env.CONVEX_SITE_URL}/dev-assistant/callback`;
    const instructions =
      "Fix mode: the code review requested changes on the open pull request — " +
      "do NOT open a new PR. Read the PR's review comments, address every " +
      "finding with a code change (or reply on the comment explaining why no " +
      "change is needed), push your fixes to the SAME branch, and get CI " +
      "green. Then report back by POSTing the signed callback with { bugId, " +
      'routineRunId, status: "CODE_REVIEW" } — a fresh review round is ' +
      "dispatched from that callback. Never merge the PR.";

    const payload = {
      mode: "fix",
      bugId: args.bugId,
      routineRunId,
      prUrl: bug.prUrl,
      spec: bug.spec,
      riskLevel: bug.riskLevel,
      reviewSummary: bug.reviewSummary,
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
// Policy auto-merge (ADR-029 Phase 3)
// ============================================================================

/** Standard GitHub REST headers, shared by every call in this module. */
function githubJsonHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/**
 * Human-readable failure detail from a GitHub error response:
 * "<prefix> returned <status> (<message>)" when the body carries a message.
 */
async function githubErrorDetail(
  res: Response,
  prefix: string,
): Promise<string> {
  let detail = `${prefix} returned ${res.status}`;
  try {
    const errBody = (await res.json()) as { message?: string };
    if (errBody?.message) detail = `${detail} (${errBody.message})`;
  } catch {
    // Non-JSON error body; the status code is reason enough.
  }
  return detail;
}

/**
 * Merge a PR via the GitHub REST API with the configured merge method
 * (AUTO_MERGE_METHOD, default squash), retrying once with a plain merge on
 * 405 ("merge method not allowed"). Shared by policy auto-merge and the
 * maintainer-triggered in-app merge.
 */
async function mergePullRequestOnGithub(
  prNumber: string,
  token: string,
): Promise<Response> {
  const mergePr = async (mergeMethod: string): Promise<Response> =>
    await fetch(`${GITHUB_PULLS_ENDPOINT}/${prNumber}/merge`, {
      method: "PUT",
      headers: githubJsonHeaders(token),
      body: JSON.stringify({ merge_method: mergeMethod }),
    });

  const method = process.env.AUTO_MERGE_METHOD ?? "squash";
  let res = await mergePr(method);
  if (res.status === 405 && method !== "merge") {
    res = await mergePr("merge");
  }
  return res;
}

/**
 * Read a PR's merge state from GitHub: whether it's already merged (plus its
 * merge commit SHA) AND why a merge PUT might be blocked (`mergeable_state`).
 *
 * Two callers, two needs:
 *  - the tie-breaker when a merge PUT fails — the in-app merge and policy
 *    auto-merge can race (both pass their gates while the row is still
 *    READY_TO_MERGE), and the loser's 405 must not post a failure message for
 *    a change that actually merged; the `merge_commit_sha` correlates the
 *    staging deploy observation (ADR-029 follow-up).
 *  - the diagnosis behind the smarter in-app merge button: `mergeableState`
 *    ("behind" / "dirty" / "clean" / "blocked" / …) says whether the button
 *    can auto-recover (update a behind branch) or must give up with a plain
 *    explanation.
 *
 * Returns null when the state can't be determined (report the original failure).
 */
async function fetchPrMerged(
  prNumber: string,
  token: string,
): Promise<{
  merged: boolean;
  mergeCommitSha?: string;
  mergeableState?: string;
} | null> {
  try {
    const res = await fetch(`${GITHUB_PULLS_ENDPOINT}/${prNumber}`, {
      headers: githubJsonHeaders(token),
    });
    if (!res.ok) return null;
    const pr = (await res.json()) as {
      merged?: boolean;
      merge_commit_sha?: string;
      mergeable_state?: string;
    };
    return {
      merged: pr.merged === true,
      mergeCommitSha:
        typeof pr.merge_commit_sha === "string"
          ? pr.merge_commit_sha
          : undefined,
      mergeableState:
        typeof pr.mergeable_state === "string"
          ? pr.mergeable_state
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Update a PR's branch by merging the base branch (`main`) into it — the GitHub
 * equivalent of the "Update branch" button. This re-triggers CI on the freshly
 * updated head and clears a `mergeable_state: "behind"` block. The token needs
 * Contents: write (GH_MIRROR_TOKEN already has it, since it merges PRs).
 * Returns the raw Response so the caller can distinguish a real conflict (409)
 * or a permission error (401/403) from success.
 */
async function updatePullRequestBranch(
  prNumber: string,
  token: string,
): Promise<Response> {
  return await fetch(`${GITHUB_PULLS_ENDPOINT}/${prNumber}/update-branch`, {
    method: "PUT",
    headers: githubJsonHeaders(token),
  });
}

/**
 * Turn a merge-block diagnosis into a plain-language thread message a
 * non-coder can act on — replacing GitHub's raw "merge returned 405 (…)" text.
 * Every user-facing in-app-merge failure routes through here so the wording
 * (and the "what to do next") stays consistent.
 */
function describeMergeBlock(
  kind: "conflict" | "failing" | "permission" | "unknown",
): string {
  switch (kind) {
    case "conflict":
      return "This PR conflicts with `main` and needs code changes before it can merge.";
    case "failing":
      return "A required check on this PR is failing — it needs a code fix before it can merge.";
    case "permission":
      return "I couldn't update the branch — the merge bot may be missing repo access. A maintainer needs to check its permissions.";
    case "unknown":
      return "GitHub couldn't merge this PR — a maintainer may need to check it on GitHub.";
  }
}

/**
 * Whether a PR's `mergeable_state` means GitHub will accept a merge PUT.
 * Both `clean` (all checks green) AND `unstable` merge — `unstable` means the
 * required checks are satisfied and only optional (non-required) checks are
 * failing or pending, which GitHub still allows merging. Treating `unstable`
 * as a required-check failure would strand a genuinely-mergeable PR in the
 * recovery poll until the cap and then mislabel it as "a required check is
 * failing".
 */
function isMergeableState(state: string | undefined): boolean {
  return state === "clean" || state === "unstable";
}

/** Progress line posted when the button auto-updates a behind branch. */
const MERGE_BEHIND_RECOVERING_MESSAGE =
  "Your branch was behind main — I've updated it and CI is re-running. I'll merge automatically once checks pass.";

/**
 * Bounded recovery poll budget: after updating a behind branch we re-read its
 * mergeability up to this many times, then give up (checks never went green)
 * rather than spinning forever. A handful of polls with backoff ≈ a few
 * minutes total.
 */
const MERGE_RECOVERY_MAX_POLLS = 6;

/** Backoff between recovery polls: 15s, 30s, 45s, 60s… capped at 60s. */
function mergeRecoveryPollDelayMs(attempt: number): number {
  return Math.min(15_000 * (attempt + 1), 60_000);
}

/**
 * Parse the `sha` (the squash-merge commit) from a successful GitHub merge PUT
 * response body. Best-effort — a missing/garbled body just yields undefined
 * (the reconcile cron + workflow_run correlation degrade gracefully without it).
 */
async function readMergeCommitSha(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { sha?: string };
    return typeof body.sha === "string" ? body.sha : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attempt to merge a bug's PR under the Phase 3 auto-merge policy. Scheduled
 * (never inlined) whenever a gate might have just been satisfied: a genuine
 * entry into READY_TO_MERGE (applyCallback) and staging sign-off
 * (confirmStaging). The action re-reads the bug and re-checks EVERY gate
 * itself, so double-scheduling is harmless.
 *
 * Gates (all must hold): AUTO_MERGE_ENABLED === "true" (master safety switch —
 * anything else means the feature is off), status READY_TO_MERGE, reviewVerdict
 * "approved", prUrl set, and the bug's riskLevel at or below the auto-merge cap
 * configured for its originator (default "low"; "none" opts out). Staging is
 * NOT a gate — it happens post-merge.
 *
 * Merges via the GitHub REST API with GH_MIRROR_TOKEN (the PAT needs Contents
 * read/write in addition to Issues). On success it posts a system thread
 * message and applies the MERGED transition itself through the trusted
 * "automerge" callback source — waiting on the /github/webhook alone would
 * strand the row at READY_TO_MERGE whenever webhook delivery is missing or
 * delayed. Webhook redelivery stays idempotent (already-MERGED rows no-op).
 * On failure (branch protection, conflict, auth) it posts an "Auto-merge
 * blocked" message for a maintainer — no retry loop.
 */
export const attemptAutoMerge = internalAction({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<void> => {
    if (process.env.AUTO_MERGE_ENABLED !== "true") {
      console.log(
        "[DevAssistant] Auto-merge skipped: AUTO_MERGE_ENABLED is not \"true\"",
      );
      return;
    }

    const bug = await ctx.runQuery(internal.functions.devAssistant.bugs.getBug, {
      bugId: args.bugId,
    });
    if (!bug) return;

    // Central policy gate — trigger points schedule freely and rely on this.
    // Staging is NOT a merge gate (ADR-029): nothing reaches staging until the
    // merge, so the staging try-it happens post-merge and gates the manual
    // production deploy instead. Merge gates on review + CI + low-risk only.
    if (
      bug.status !== "READY_TO_MERGE" ||
      bug.reviewVerdict !== "approved" ||
      !bug.prUrl
    ) {
      console.log(
        "[DevAssistant] Auto-merge gates not met for bug",
        args.bugId,
      );
      return;
    }

    // Per-person severity cap (ADR-029 Phase 3): a contribution auto-merges only
    // when its risk level is at or below the cap configured for its originator
    // on the maintainers screen (default "low"; "none" opts them out entirely).
    const cap = await ctx.runQuery(
      internal.functions.devAssistant.maintainers.getAutoMergeCapForUser,
      { userId: bug.originatorUserId },
    );
    const riskRank =
      bug.riskLevel !== undefined
        ? AUTO_MERGE_SEVERITY_ORDER[bug.riskLevel]
        : undefined;
    if (riskRank === undefined || riskRank > AUTO_MERGE_SEVERITY_ORDER[cap]) {
      console.log("[DevAssistant] Auto-merge blocked by severity cap", args.bugId, {
        riskLevel: bug.riskLevel,
        cap,
      });
      return;
    }

    const blocked = async (reason: string): Promise<void> => {
      console.error("[DevAssistant] Auto-merge blocked:", reason, args.bugId);
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.addSystemThreadMessage,
        {
          bugId: args.bugId,
          body: `Auto-merge blocked: ${reason} — needs a maintainer`,
        },
      );
    };

    const prMatch = /\/pull\/(\d+)/.exec(bug.prUrl);
    if (!prMatch) {
      await blocked(`could not parse a PR number from ${bug.prUrl}`);
      return;
    }

    const mirrorToken = githubMirrorToken();
    if (!mirrorToken) {
      await blocked("GH_MIRROR_TOKEN not configured");
      return;
    }

    try {
      const res = await mergePullRequestOnGithub(prMatch[1], mirrorToken);

      if (res.ok) {
        const mergeCommitSha = await readMergeCommitSha(res);
        await ctx.runMutation(
          internal.functions.devAssistant.bugs.addSystemThreadMessage,
          {
            bugId: args.bugId,
            body: "Auto-merged ✓ — all gates passed (low risk, review approved)",
          },
        );
        await applyGithubConfirmedMerge(ctx, bug, mergeCommitSha);
        return;
      }

      // Lost a race? The in-app merge (or a human on GitHub) may have merged
      // the PR between this action's gates and its PUT — the resulting 405
      // must not read as a failure for a change that actually merged.
      const raced = await fetchPrMerged(prMatch[1], mirrorToken);
      if (raced?.merged) {
        await applyGithubConfirmedMerge(ctx, bug, raced.mergeCommitSha);
        return;
      }

      await blocked(await githubErrorDetail(res, "GitHub merge"));
    } catch (error) {
      await blocked(String(error));
    }
  },
});

/**
 * Apply MERGED through the trusted "automerge" callback source after GitHub
 * confirmed a merge. Routing through handleRoutineCallback makes the shipped
 * push + chat bot message fire too; rows with no run to correlate fall back
 * to a direct applyCallback. Idempotent on already-MERGED rows (and the
 * webhook redelivery no-ops afterward).
 */
async function applyGithubConfirmedMerge(
  ctx: ActionCtx,
  bug: Pick<Doc<"devBugs">, "_id" | "routineRunId">,
  mergeCommitSha?: string,
): Promise<void> {
  if (bug.routineRunId) {
    await ctx.runAction(
      internal.functions.devAssistant.actions.handleRoutineCallback,
      {
        bugId: bug._id,
        routineRunId: bug.routineRunId,
        status: "MERGED",
        source: "automerge",
        mergeCommitSha,
      },
    );
  } else {
    await ctx.runMutation(internal.functions.devAssistant.bugs.applyCallback, {
      bugId: bug._id,
      status: "MERGED",
      source: "automerge",
      mergeCommitSha,
    });
  }
}

/**
 * Maintainer-triggered merge from the app (scheduled by contributions.mergeNow).
 * Unlike policy auto-merge this is an explicit human decision, so it skips the
 * AUTO_MERGE_ENABLED switch and the per-user severity cap — but it re-checks
 * the hard gates itself (READY_TO_MERGE + review approved + prUrl), so a stale
 * tap after the state moved on is a polite thread message, not a rogue merge.
 *
 * Smarter than a raw merge PUT: when the merge is blocked ONLY because the
 * branch is behind `main` (the common friction — GitHub returns 405 "Required
 * status check … is expected"), it auto-recovers — updates the branch, lets CI
 * re-run, and merges once it's green (see retryMergeAfterUpdate). For blocks it
 * genuinely can't fix (real conflict, failing check, permission), it posts a
 * plain-language explanation instead of GitHub's raw error. Success lands
 * MERGED through the same trusted "automerge" callback source as policy
 * auto-merge.
 */
export const mergeFromApp = internalAction({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<void> => {
    const bug = await ctx.runQuery(internal.functions.devAssistant.bugs.getBug, {
      bugId: args.bugId,
    });
    if (!bug) return;

    // Terminal failure path: posts the (already plain-language) reason AND
    // clears mergeRequestedAt so the merge card returns. Used only for blocks
    // we can't auto-recover — the auto-recover flow keeps the latch SET.
    const failed = async (reason: string): Promise<void> => {
      console.error("[DevAssistant] In-app merge failed:", reason, args.bugId);
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordMergeFromAppFailure,
        { bugId: args.bugId, reason },
      );
    };

    // Already merged (auto-merge or a human won the race before this action
    // ran) — the tap achieved its goal; nothing to do and nothing to report.
    if (bug.status === "MERGED") return;

    if (
      bug.status !== "READY_TO_MERGE" ||
      bug.reviewVerdict !== "approved" ||
      !bug.prUrl
    ) {
      await failed("This item is no longer ready to merge.");
      return;
    }

    const prMatch = /\/pull\/(\d+)/.exec(bug.prUrl);
    if (!prMatch) {
      await failed(describeMergeBlock("unknown"));
      return;
    }
    const prNumber = prMatch[1];

    const mirrorToken = githubMirrorToken();
    if (!mirrorToken) {
      await failed(describeMergeBlock("permission"));
      return;
    }

    try {
      const res = await mergePullRequestOnGithub(prNumber, mirrorToken);

      // A failed PUT can still mean "merged": policy auto-merge (scheduled on
      // the same READY_TO_MERGE entry) or a human may have merged first, and
      // the loser's 405 must not tell the thread a successful merge failed.
      if (res.ok) {
        // GitHub confirmed the merge — apply MERGED through the trusted
        // "automerge" source (same as attemptAutoMerge) so the shipped push,
        // system message, and chat bot message all fire; the webhook
        // redelivery no-ops on a MERGED row.
        await applyGithubConfirmedMerge(ctx, bug, await readMergeCommitSha(res));
        return;
      }

      // Log the raw GitHub reason for the breadcrumb, then diagnose *why* the
      // merge was blocked from the PR's mergeability rather than surfacing the
      // raw 405 to the maintainer.
      console.error(
        "[DevAssistant] In-app merge PUT failed:",
        await githubErrorDetail(res, "GitHub merge"),
        args.bugId,
      );

      const status = await fetchPrMerged(prNumber, mirrorToken);
      if (status?.merged) {
        await applyGithubConfirmedMerge(ctx, bug, status.mergeCommitSha);
        return;
      }

      const state = status?.mergeableState;

      // Behind `main` (the case that dead-ended on the raw 405) — or an
      // otherwise-clean PR whose merge lost a "base branch was modified" race:
      // recover automatically. Update the branch so CI re-runs, then poll until
      // it's green and merge. Keep the latch SET the whole time so the card
      // never flips back to "Merge" mid-recovery.
      if (state === "behind" || isMergeableState(state)) {
        if (state === "behind") {
          const upd = await updatePullRequestBranch(prNumber, mirrorToken);
          if (upd.status === 401 || upd.status === 403) {
            await failed(describeMergeBlock("permission"));
            return;
          }
          if (upd.status === 409) {
            await failed(describeMergeBlock("conflict"));
            return;
          }
          if (!upd.ok) {
            await failed(describeMergeBlock("failing"));
            return;
          }
          // The branch is actually updated now — post the progress line.
          await ctx.runMutation(
            internal.functions.devAssistant.bugs.addSystemThreadMessage,
            { bugId: args.bugId, body: MERGE_BEHIND_RECOVERING_MESSAGE },
          );
        }
        await ctx.scheduler.runAfter(
          mergeRecoveryPollDelayMs(0),
          internal.functions.devAssistant.actions.retryMergeAfterUpdate,
          { bugId: args.bugId, attempt: 0 },
        );
        return; // latch stays set — recovery is in flight
      }

      // Real conflict → no retry loop; needs code changes.
      if (state === "dirty") {
        await failed(describeMergeBlock("conflict"));
        return;
      }

      // blocked / draft → a required check is genuinely failing;
      // null → GitHub state couldn't be read. Either way, give up cleanly.
      // (`clean`/`unstable` are handled above as mergeable; `behind`/`dirty`
      // each have their own branch.)
      await failed(describeMergeBlock(state ? "failing" : "unknown"));
    } catch (error) {
      console.error("[DevAssistant] In-app merge threw:", error, args.bugId);
      await failed(describeMergeBlock("unknown"));
    }
  },
});

/**
 * Bounded recovery poll for the smarter in-app merge button (scheduled by
 * mergeFromApp after it updates a behind branch). Re-reads the PR's
 * mergeability and, when it becomes `clean`, retries the merge → success. A
 * real conflict stops immediately; checks that never go green stop at the poll
 * cap (never an infinite loop). The in-flight latch (mergeRequestedAt) stays
 * SET across the whole recovery and is released only on the final success
 * (MERGED transition) or the final give-up (recordMergeFromAppFailure).
 */
export const retryMergeAfterUpdate = internalAction({
  args: { bugId: v.id("devBugs"), attempt: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const bug = await ctx.runQuery(internal.functions.devAssistant.bugs.getBug, {
      bugId: args.bugId,
    });
    if (!bug) return;
    if (bug.status === "MERGED") return;

    const failed = async (reason: string): Promise<void> => {
      console.error(
        "[DevAssistant] In-app merge recovery failed:",
        reason,
        args.bugId,
      );
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordMergeFromAppFailure,
        { bugId: args.bugId, reason },
      );
    };

    // The item must still be the approved, ready-to-merge PR we started on.
    if (
      bug.status !== "READY_TO_MERGE" ||
      bug.reviewVerdict !== "approved" ||
      !bug.prUrl
    ) {
      await failed("This item is no longer ready to merge.");
      return;
    }

    const prMatch = /\/pull\/(\d+)/.exec(bug.prUrl);
    if (!prMatch) {
      await failed(describeMergeBlock("unknown"));
      return;
    }
    const prNumber = prMatch[1];

    const mirrorToken = githubMirrorToken();
    if (!mirrorToken) {
      await failed(describeMergeBlock("permission"));
      return;
    }

    const status = await fetchPrMerged(prNumber, mirrorToken);
    if (status?.merged) {
      await applyGithubConfirmedMerge(ctx, bug, status.mergeCommitSha);
      return;
    }

    const state = status?.mergeableState;

    // Schedule another bounded poll, or give up once the cap is reached
    // (checks never went green). Used both when checks haven't settled yet and
    // when a merge PUT fails transiently on an otherwise-mergeable PR.
    const pollAgainOrGiveUp = async (): Promise<void> => {
      if (args.attempt + 1 >= MERGE_RECOVERY_MAX_POLLS) {
        await failed(describeMergeBlock("failing"));
        return;
      }
      await ctx.scheduler.runAfter(
        mergeRecoveryPollDelayMs(args.attempt + 1),
        internal.functions.devAssistant.actions.retryMergeAfterUpdate,
        { bugId: args.bugId, attempt: args.attempt + 1 },
      );
    };

    // Mergeable now (clean or unstable) → retry the merge.
    if (isMergeableState(state)) {
      const res = await mergePullRequestOnGithub(prNumber, mirrorToken);
      if (res.ok) {
        await applyGithubConfirmedMerge(ctx, bug, await readMergeCommitSha(res));
        return;
      }
      const raced = await fetchPrMerged(prNumber, mirrorToken);
      if (raced?.merged) {
        await applyGithubConfirmedMerge(ctx, bug, raced.mergeCommitSha);
        return;
      }
      // The PUT failed but the PR isn't merged and GitHub still reports it as
      // mergeable — a transient failure (a 5xx, or a "base branch was modified"
      // race). Poll again rather than a terminal give-up; the cap still bounds
      // it. Only if we exhaust the cap do we surface the failing-check message.
      await pollAgainOrGiveUp();
      return;
    }

    // A conflict appeared after the update → stop, needs code changes.
    if (state === "dirty") {
      await failed(describeMergeBlock("conflict"));
      return;
    }

    // Still behind / blocked / unknown → checks haven't settled. Poll again
    // until the cap, then give up (checks never went green).
    await pollAgainOrGiveUp();
  },
});

// ============================================================================
// In-app production deploy (silent OTA)
// ============================================================================

/**
 * The manual production pipeline's workflow_dispatch endpoint. The in-app
 * "Ship to production" button fires the SAME workflow a maintainer would run
 * from the GitHub Actions UI — nothing bespoke ships from here.
 */
const GITHUB_PROD_DEPLOY_WORKFLOW_ENDPOINT =
  "https://api.github.com/repos/togathernyc/togather/actions/workflows/deploy-to-production.yml/dispatches";

/**
 * Trigger the production deploy workflow (scheduled by
 * contributions.promoteToProduction). Always update_mode "silent" — the
 * in-app button never forces a reload on users; forced updates remain a
 * hand-run workflow decision. Requires GH_MIRROR_TOKEN to ALSO have
 * Actions: read/write on the repo (in addition to Issues + Contents).
 * The outcome lands in the thread via recordProductionDeployOutcome, which
 * clears productionRequestedAt on failure so the button comes back.
 */
export const dispatchProductionDeploy = internalAction({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<void> => {
    const outcome = async (ok: boolean, detail?: string): Promise<void> => {
      if (!ok) {
        console.error(
          "[DevAssistant] Production deploy dispatch failed:",
          detail,
          args.bugId,
        );
      }
      await ctx.runMutation(
        internal.functions.devAssistant.bugs.recordProductionDeployOutcome,
        { bugId: args.bugId, ok, detail },
      );
    };

    const token = githubMirrorToken();
    if (!token) {
      await outcome(false, "GH_MIRROR_TOKEN not configured");
      return;
    }

    try {
      const res = await fetch(GITHUB_PROD_DEPLOY_WORKFLOW_ENDPOINT, {
        method: "POST",
        headers: githubJsonHeaders(token),
        body: JSON.stringify({
          ref: "main",
          // The workflow's own safety gate expects the literal "deploy";
          // update_mode is pinned to silent by design (see doc comment).
          inputs: { confirm: "deploy", update_mode: "silent" },
        }),
      });

      // A successful workflow_dispatch returns 204 No Content.
      if (res.status === 204) {
        await outcome(true);
        return;
      }
      await outcome(
        false,
        await githubErrorDetail(res, "GitHub workflow dispatch"),
      );
    } catch (error) {
      await outcome(false, String(error));
    }
  },
});

/**
 * Reconcile open dev-dashboard PRs against GitHub (ADR-029 Phase 3 backstop).
 *
 * The /github/webhook flips a bug to MERGED when its PR merges, but webhook
 * delivery isn't guaranteed (unconfigured repo, secret mismatch, transient
 * failure), and items that don't auto-merge (higher risk than their cap) wait on
 * a human merge the dashboard would otherwise never notice. This cron polls each
 * open-PR bug's merge state directly and applies merges through the same
 * webhook-correlation path, so a manual GitHub merge always reflects within a
 * cron interval even with no webhook configured at all. Idempotent:
 * already-MERGED rows no-op inside handleGithubPrClosed.
 */
export const reconcileMergedPrs = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const token = githubMirrorToken();
    if (!token) return; // GitHub integration not configured — nothing to poll.

    const bugs = await ctx.runQuery(
      internal.functions.devAssistant.bugs.listOpenPrBugs,
      {},
    );
    for (const bug of bugs) {
      if (!bug.prUrl) continue;
      const prMatch = /\/pull\/(\d+)/.exec(bug.prUrl);
      if (!prMatch) continue;
      try {
        const merged = await fetchPrMerged(prMatch[1], token);
        if (merged?.merged) {
          // Reuse the webhook path: an empty branchRef falls through to the
          // prUrl-match fallback, which scans exactly these open-PR states and
          // applies MERGED idempotently. Carry the merge SHA so deploy
          // observation can correlate the staging workflow_run events.
          await ctx.runMutation(
            internal.functions.devAssistant.bugs.handleGithubPrClosed,
            {
              branchRef: "",
              prUrl: bug.prUrl,
              merged: true,
              mergeCommitSha: merged.mergeCommitSha,
            },
          );
        }
      } catch (error) {
        console.error(
          "[DevAssistant] reconcileMergedPrs failed for",
          bug.prUrl,
          String(error),
        );
      }
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
      // means one "PR opened" push, not two. Nothing is on staging yet (the PR
      // is still open), so this stays an honest "in code review" note — the
      // "try it on staging" ask waits until the staging deploy actually goes
      // live (bugs.ts stagingLivePush, fired by handleWorkflowRunEvent).
      return {
        title: "Your contribution is in code review",
        body: `A pull request is open for "${bug.title}".`,
      };
    // NOTE: MERGED intentionally returns null. A merge only *triggers* the
    // staging deploy — the "live on staging"/"try it" push now fires from
    // handleWorkflowRunEvent (bugs.ts) once the deploy workflows actually
    // succeed, so we never invite a contributor to test something that isn't
    // up yet.
    default:
      return null;
  }
}

export const handleRoutineCallback = internalAction({
  args: {
    bugId: v.id("devBugs"),
    routineRunId: v.string(),
    status: bugStatusValidator,
    // Trusted-caller channel: handleGithubPrClosed passes "webhook",
    // attemptAutoMerge passes "automerge". The public HTTP callback never
    // forwards this field, so external callers always land as "routine" —
    // the only source applyCallback's MERGED gate rejects.
    source: v.optional(callbackSourceValidator),
    // Only meaningful on a MERGED apply — the squash-merge commit SHA, stored
    // so the staging workflow_run events correlate to this bug.
    mergeCommitSha: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    screenshots: v.optional(v.array(v.string())),
    message: v.optional(v.string()),
    spec: v.optional(v.string()),
    riskLevel: v.optional(riskLevelValidator),
    aiTitle: v.optional(v.string()),
    area: v.optional(v.string()),
    scope: v.optional(scopeValidator),
    splitSlices: v.optional(splitSlicesValidator),
    verifyOnStaging: v.optional(v.boolean()),
    reviewVerdict: v.optional(reviewVerdictValidator),
    reviewSummary: v.optional(v.string()),
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
        source: args.source,
        mergeCommitSha: args.mergeCommitSha,
        prUrl: args.prUrl,
        screenshots: args.screenshots,
        spec: args.spec,
        riskLevel: args.riskLevel,
        aiTitle: args.aiTitle,
        area: args.area,
        scope: args.scope,
        splitSlices: args.splitSlices,
        verifyOnStaging: args.verifyOnStaging,
        reviewVerdict: args.reviewVerdict,
        reviewSummary: args.reviewSummary,
      },
    );
    if (!updated) return;

    // applyCallback rejects out-of-policy callbacks (illegal transition,
    // status the run's mode may not deliver, routine-claimed MERGED) by
    // recording lastError and persisting nothing else; a successful apply
    // always clears lastError. Don't post/push for a callback that didn't
    // apply (e.g. a CODE_REVIEW callback arriving after a human rejected the
    // bug while the routine was running).
    if (updated.lastError !== undefined) {
      console.warn(
        `[DevAssistant] Rejected callback ${args.status} for bug ${args.bugId}: ${updated.lastError}`,
      );
      return;
    }

    // An "approved" review verdict on a CODE_REVIEW callback promotes the bug
    // to READY_TO_MERGE inside applyCallback (unless the verdict was ignored,
    // e.g. echoed by a fix run), so the expected post-callback status can
    // differ from the payload's status. Read the promotion off the row.
    const promoted =
      args.reviewVerdict === "approved" &&
      args.status === "CODE_REVIEW" &&
      updated.status === "READY_TO_MERGE";
    const effectiveStatus = promoted ? "READY_TO_MERGE" : args.status;
    if (updated.status !== effectiveStatus) {
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
    // A spec REVISION lands without a status change (IN_REVIEW re-apply) but
    // still needs a push — the plan the contributor is waiting on moved.
    // Compare against the pre-callback spec so re-delivered callbacks (which
    // carry the already-stored text) can't re-push.
    const specChanged = args.spec !== undefined && args.spec !== bug.spec;
    if (!updated.channelId) {
      if (statusChanged) {
        const push = contributorPushForStatus(effectiveStatus, updated);
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
                status: effectiveStatus,
                ...(updated.prUrl ? { prUrl: updated.prUrl } : {}),
              },
            },
          );
        }
      } else if (specChanged) {
        await ctx.runAction(
          internal.functions.notifications.actions.sendPushNotification,
          {
            userId: updated.originatorUserId,
            title: "Updated plan ready",
            body: `The updated plan for "${updated.aiTitle ?? updated.title}" is ready — review and approve it.`,
            notificationType: "dev_contribution_update",
            data: { bugId: args.bugId, status: effectiveStatus },
          },
        );
      }
    }

    // Dashboard-originated items have no chat thread to post into — the push
    // above (plus the dashboard itself) is their notification surface.
    if (!updated.channelId) return;

    const content =
      args.message ?? defaultCallbackMessage(effectiveStatus, args.prUrl ?? updated.prUrl);
    const mentionedUserIds: Id<"users">[] | undefined =
      effectiveStatus === "READY_TO_MERGE" ? [updated.originatorUserId] : undefined;

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
      // Staging-redo rounds re-reach statuses from earlier rounds, so the key
      // is scoped per round — otherwise round 2's "PR opened"/"merged" posts
      // would be silently deduped against round 1's.
      sourceKey:
        (updated.redoRounds ?? 0) > 0
          ? `bug:${args.bugId}:${effectiveStatus}:r${updated.redoRounds}`
          : `bug:${args.bugId}:${effectiveStatus}`,
    });
  },
});
