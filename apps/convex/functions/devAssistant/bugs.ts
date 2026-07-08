/**
 * Dev-Assistant Bot — Bug DB Operations
 *
 * Tool/dispatch/callback database ops for the @Togather dev-assistant pipeline.
 * The chat thread is the system of record for intent; this table tracks the
 * devBugs lifecycle; the PR tracks code. Status transitions are validated
 * against an explicit map so the state machine is enforced at the DB layer.
 *
 * @see /apps/convex/functions/devAssistant/index.ts for the public surface.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  MutationCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getMediaUrl } from "../../lib/utils";
import { DEV_MAINTAINER_ROLE } from "./maintainers";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// Status machine
// ============================================================================

export const bugStatusValidator = v.union(
  v.literal("DRAFT"),
  v.literal("IN_REVIEW"),
  v.literal("READY_FOR_IMPL"),
  v.literal("IN_PROGRESS"),
  v.literal("CODE_REVIEW"),
  v.literal("READY_TO_MERGE"),
  v.literal("MERGED"),
  v.literal("REJECTED"),
);

/** AI-proposed blast-radius level for dashboard contributions (ADR-029). */
export const riskLevelValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

/** AI-proposed scope classification for dashboard contributions (ADR-029 P1.5). */
export const scopeValidator = v.union(
  v.literal("buildable"),
  v.literal("split"),
  v.literal("design_needed"),
);

/** Verdict reported by the review-mode routine after reviewing an open PR. */
export const reviewVerdictValidator = v.union(
  v.literal("approved"),
  v.literal("changes_requested"),
);

/**
 * Buildable slices proposed by the spec routine for a "split"-scope item, each
 * with a copy-paste-ready prompt for a fresh dev session (ADR-029).
 */
export const splitSlicesValidator = v.array(
  v.object({ title: v.string(), prompt: v.string() }),
);

/**
 * Where a callback came from. Internal-only — threaded by trusted callers
 * (handleRoutineCallback → "routine", handleGithubPrClosed → "webhook",
 * attemptAutoMerge → "automerge") and NEVER exposed through the public HTTP
 * callback, which always lands as the least-trusted "routine" source.
 */
export const callbackSourceValidator = v.union(
  v.literal("routine"),
  v.literal("webhook"),
  v.literal("automerge"),
);

type BugStatus = Doc<"devBugs">["status"];

/**
 * Valid forward transitions. The lifecycle is MONOTONIC — a bug only ever moves
 * forward (plus REJECTED from any non-terminal state). This is deliberate:
 *
 *  - Stale/reordered routine callbacks can't corrupt state. If an older
 *    CODE_REVIEW callback is replayed after the bug reached READY_TO_MERGE, the
 *    backward transition is illegal and applyCallback ignores it.
 *  - Each status is reached at most once, so the `bug:<id>:<status>` chat
 *    idempotency key is genuinely unique per lifecycle.
 *
 * The routine runs its own internal review cycle and reports forward progress
 * (CODE_REVIEW once, then READY_TO_MERGE); it never needs us to bounce backward.
 *
 * CODE_REVIEW -> MERGED is a legal forward skip: a maintainer can merge the PR
 * directly on GitHub before the AI review verdict lands, and the GitHub
 * webhook (ADR-029 Phase 2) reports that merge. Still monotonic. Note that
 * MERGED is only reachable via webhook/auto-merge callback sources (or the
 * human markBugMerged) — applyCallback rejects routine-claimed merges.
 */
const ALLOWED_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  DRAFT: ["IN_REVIEW", "REJECTED"],
  IN_REVIEW: ["READY_FOR_IMPL", "REJECTED"],
  READY_FOR_IMPL: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["CODE_REVIEW", "REJECTED"],
  CODE_REVIEW: ["READY_TO_MERGE", "MERGED", "REJECTED"],
  READY_TO_MERGE: ["MERGED", "REJECTED"],
  MERGED: [],
  REJECTED: [],
};

function canTransition(from: BugStatus, to: BugStatus): boolean {
  if (from === to) return true; // idempotent re-apply
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Statuses a GitHub-observed merge (webhook / auto-merge sources) may arrive
 * from. GitHub is ground truth for merges, so this deliberately includes
 * IN_PROGRESS — a PR merged on GitHub before the implementation callback
 * landed would otherwise strand the row — plus MERGED for idempotent
 * redeliveries. Routine-claimed merges are rejected outright instead.
 */
const GITHUB_MERGEABLE_STATUSES: BugStatus[] = [
  "IN_PROGRESS",
  "CODE_REVIEW",
  "READY_TO_MERGE",
  "MERGED",
];

/**
 * Apply a validated status transition and persist it. Throws on an illegal
 * transition. When a bug lands on READY_FOR_IMPL we schedule the dispatch
 * action immediately (event-driven, no cron) so the routine fires the instant
 * the bug is marked ready.
 */
export async function applyStatusTransition(
  ctx: MutationCtx,
  bug: Doc<"devBugs">,
  newStatus: BugStatus,
): Promise<void> {
  if (!canTransition(bug.status, newStatus)) {
    throw new Error(
      `Illegal bug status transition: ${bug.status} -> ${newStatus}`,
    );
  }
  if (newStatus === bug.status) return;

  await ctx.db.patch(bug._id, {
    status: newStatus,
    updatedAt: Date.now(),
    // "Shipped" timestamp for the contributor dashboard (ADR-029).
    ...(newStatus === "MERGED" && !bug.shippedAt
      ? { shippedAt: Date.now() }
      : {}),
  });

  if (newStatus === "READY_FOR_IMPL") {
    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.actions.dispatchBug,
      { bugId: bug._id },
    );
  }
}

// ============================================================================
// Conversation thread (devBugMessages, ADR-029 Phase 1.5)
// ============================================================================

/**
 * Append a message to a contribution's conversation thread. `userId` is only
 * meaningful for authorType === "user".
 */
export async function insertThreadMessage(
  ctx: MutationCtx,
  bugId: Id<"devBugs">,
  authorType: "user" | "assistant" | "system",
  body: string,
  userId?: Id<"users">,
  imageUrls?: string[],
): Promise<Id<"devBugMessages">> {
  return await ctx.db.insert("devBugMessages", {
    bugId,
    authorType,
    userId,
    body,
    // Store only a non-empty array — keeps text-only messages clean.
    ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
    createdAt: Date.now(),
  });
}

/**
 * One-line system messages posted into the thread when a callback-applied
 * transition lands, so the conversation reads as a running progress log.
 */
const STATUS_SYSTEM_MESSAGES: Partial<Record<BugStatus, string>> = {
  IN_PROGRESS: "Build started",
  CODE_REVIEW: "Pull request opened",
  READY_TO_MERGE: "Ready to merge",
  // Merge auto-deploys to staging; production is a separate manual step, so the
  // honest line is "live on staging", not "shipped" (ADR-029).
  MERGED: "Merged — live on staging",
};

export type ThreadHistoryEntry = {
  authorType: "user" | "assistant" | "system";
  authorName?: string;
  body: string;
  // R2 storage paths for any pictures on this message (unresolved — the
  // dispatch action resolves them to public URLs for the routine).
  imageUrls?: string[];
};

/**
 * Full conversation history for a contribution, oldest first — shipped to the
 * spec-mode routine so revision rounds see the whole back-and-forth.
 */
export const getThreadHistory = internalQuery({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<ThreadHistoryEntry[]> => {
    const messages = await ctx.db
      .query("devBugMessages")
      .withIndex("by_bug", (q) => q.eq("bugId", args.bugId))
      .order("asc")
      .collect();

    const entries: ThreadHistoryEntry[] = [];
    for (const m of messages) {
      let authorName: string | undefined;
      if (m.authorType === "user" && m.userId) {
        const user = await ctx.db.get(m.userId);
        authorName = user
          ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined
          : undefined;
      }
      entries.push({
        authorType: m.authorType,
        authorName,
        body: m.body,
        ...(m.imageUrls && m.imageUrls.length > 0
          ? { imageUrls: m.imageUrls }
          : {}),
      });
    }
    return entries;
  },
});

// ============================================================================
// Auth helper (mirrors admin/featureFlags.ts)
// ============================================================================

async function requireSuperuser(
  ctx: { db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> } },
  userId: Id<"users">,
): Promise<void> {
  const user = await ctx.db.get(userId);
  if (!user?.isStaff && !user?.isSuperuser) {
    throw new Error("Superuser access required");
  }
}

// ============================================================================
// Tool / agent DB ops
// ============================================================================

/**
 * Create a new bug in IN_REVIEW. Returns the bug id and the review link the
 * agent should surface in the thread.
 */
export const createBug = internalMutation({
  args: {
    communityId: v.id("communities"),
    channelId: v.id("chatChannels"),
    threadRootMessageId: v.optional(v.id("chatMessages")),
    originatorUserId: v.id("users"),
    title: v.string(),
    body: v.string(),
    repro: v.optional(v.string()),
    screenshotUrls: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ bugId: Id<"devBugs">; reviewLink: string; reviewUrl: string }> => {
    const now = Date.now();
    const bugId = await ctx.db.insert("devBugs", {
      communityId: args.communityId,
      channelId: args.channelId,
      threadRootMessageId: args.threadRootMessageId,
      originatorUserId: args.originatorUserId,
      status: "IN_REVIEW",
      kind: "bug",
      source: "chat",
      title: args.title,
      body: args.body,
      repro: args.repro,
      screenshotUrls: args.screenshotUrls,
      createdAt: now,
      updatedAt: now,
    });

    // In-app router path (used for navigation inside the app, where the
    // `(user)` route group is meaningful to Expo Router).
    const reviewLink = `/(user)/admin/bugs/${bugId}`;
    await ctx.db.patch(bugId, { reviewLink });

    // Absolute, human-facing URL for the chat reply. Built from the centralized
    // domain config (togather.nyc) so the bot never fabricates a domain, and
    // without the `(user)` route group, which is not a real URL segment.
    const reviewUrl = `${DOMAIN_CONFIG.appUrl}/admin/bugs/${bugId}`;

    return { bugId, reviewLink, reviewUrl };
  },
});

/**
 * Patch a bug's brief. Only allowed while still in DRAFT/IN_REVIEW — once a bug
 * is ready/dispatched the brief is frozen (the routine is consuming it).
 */
export const updateBug = internalMutation({
  args: {
    bugId: v.id("devBugs"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    repro: v.optional(v.string()),
    screenshotUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return { ok: false, reason: "Bug not found" };
    if (bug.status !== "DRAFT" && bug.status !== "IN_REVIEW") {
      return {
        ok: false,
        reason: `Bug is ${bug.status}; brief can only be edited while in review`,
      };
    }
    await ctx.db.patch(args.bugId, {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.body !== undefined ? { body: args.body } : {}),
      ...(args.repro !== undefined ? { repro: args.repro } : {}),
      ...(args.screenshotUrls !== undefined
        ? { screenshotUrls: args.screenshotUrls }
        : {}),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Status transition driven by the agent. The agent may ONLY mark a bug
 * READY_FOR_IMPL — every other transition is owned by dispatch, callbacks, or a
 * human via the review screen.
 */
export const setBugStatus = internalMutation({
  args: {
    bugId: v.id("devBugs"),
    status: bugStatusValidator,
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    if (args.status !== "READY_FOR_IMPL") {
      return { ok: false, reason: "Agent may only set READY_FOR_IMPL" };
    }
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return { ok: false, reason: "Bug not found" };
    try {
      await applyStatusTransition(ctx, bug, args.status);
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
    return { ok: true };
  },
});

export const getBug = internalQuery({
  args: { bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<Doc<"devBugs"> | null> => {
    return await ctx.db.get(args.bugId);
  },
});

// ============================================================================
// Mobile review screen (token-authed, staff only)
// ============================================================================

export const getBugForReview = query({
  args: { token: v.string(), bugId: v.id("devBugs") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireSuperuser(ctx, userId);

    const bug = await ctx.db.get(args.bugId);
    if (!bug) return null;

    const originator = await ctx.db.get(bug.originatorUserId);
    return {
      ...bug,
      originatorName: originator
        ? `${originator.firstName ?? ""} ${originator.lastName ?? ""}`.trim()
        : "Unknown",
    };
  },
});

/** Reject a bug (human, from the review screen). Terminal. */
export const rejectBug = mutation({
  args: { token: v.string(), bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireSuperuser(ctx, userId);
    const bug = await ctx.db.get(args.bugId);
    if (!bug) throw new Error("Bug not found");
    await applyStatusTransition(ctx, bug, "REJECTED");
    // Stop any in-flight Routine run from correlating: callbacks match by
    // routineRunId, so clearing it (and the run's mode) makes them fall on
    // the floor instead of leaving lastError noise on a terminal row.
    await ctx.db.patch(args.bugId, {
      routineRunId: undefined,
      activeRunMode: undefined,
    });
    return { ok: true };
  },
});

/** Mark a bug merged (human, from the review screen). Terminal. */
export const markBugMerged = mutation({
  args: { token: v.string(), bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireSuperuser(ctx, userId);
    const bug = await ctx.db.get(args.bugId);
    if (!bug) throw new Error("Bug not found");
    await applyStatusTransition(ctx, bug, "MERGED");
    return { ok: true };
  },
});

/**
 * Manual "Retry dispatch" — recovery when an outbound POST to the routine
 * failed (the bug stays IN_PROGRESS with lastError; we never auto-revert).
 * Re-fires the dispatch action against the existing routineRunId.
 */
export const retryDispatch = mutation({
  args: { token: v.string(), bugId: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireSuperuser(ctx, userId);
    const bug = await ctx.db.get(args.bugId);
    if (!bug) throw new Error("Bug not found");
    if (bug.status !== "IN_PROGRESS" && bug.status !== "READY_FOR_IMPL") {
      throw new Error(`Cannot retry dispatch from status ${bug.status}`);
    }
    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.actions.dispatchBug,
      { bugId: bug._id, forceRedispatch: true },
    );
    return { ok: true };
  },
});

// ============================================================================
// Dispatch / callback DB ops
// ============================================================================

export const getBugByRoutineRunId = internalQuery({
  args: { routineRunId: v.string() },
  handler: async (ctx, args): Promise<Doc<"devBugs"> | null> => {
    return await ctx.db
      .query("devBugs")
      .withIndex("by_routineRunId", (q) =>
        q.eq("routineRunId", args.routineRunId),
      )
      .first();
  },
});

/**
 * Flip a bug to IN_PROGRESS and stamp the routineRunId BEFORE the outbound POST
 * so a crash mid-dispatch can't double-run the routine. No-op (alreadyDispatched)
 * if the bug has already moved past READY_FOR_IMPL.
 */
export const markDispatched = internalMutation({
  args: { bugId: v.id("devBugs"), routineRunId: v.string() },
  handler: async (ctx, args): Promise<{ alreadyDispatched: boolean }> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return { alreadyDispatched: true };
    if (bug.status !== "READY_FOR_IMPL") {
      return { alreadyDispatched: true };
    }
    await ctx.db.patch(args.bugId, {
      status: "IN_PROGRESS",
      routineRunId: args.routineRunId,
      activeRunMode: "implement",
      dispatchedAt: Date.now(),
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { alreadyDispatched: false };
  },
});

/**
 * Store the mirrored GitHub issue on the bug (ADR-029 Phase 2). Written by
 * dispatchBug right after it creates the issue, so the Routine payload and the
 * dashboard's deep link both see it.
 */
export const setGithubIssue = internalMutation({
  args: {
    bugId: v.id("devBugs"),
    githubIssueNumber: v.number(),
    githubIssueUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.bugId, {
      githubIssueNumber: args.githubIssueNumber,
      githubIssueUrl: args.githubIssueUrl,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Originator attribution for the implementation dispatch payload (ADR-029
 * Phase 2): the Routine writes a Co-authored-by trailer from these.
 */
export const getOriginatorAttribution = internalQuery({
  args: { bugId: v.id("devBugs") },
  handler: async (
    ctx,
    args,
  ): Promise<{ name?: string; githubUsername?: string } | null> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return null;
    const user = await ctx.db.get(bug.originatorUserId);
    if (!user) return null;
    const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
    return {
      name: name || undefined,
      githubUsername: user.githubUsername || undefined,
    };
  },
});

/** Thread message posted when a PR is closed on GitHub without merging. */
export const PR_CLOSED_UNMERGED_MESSAGE =
  "Pull request closed without merging — needs a maintainer look";

/**
 * Apply a GitHub `pull_request` closed event (POST /github/webhook, ADR-029
 * Phase 2). Correlates the PR to a devBug by the Routine's branch naming
 * convention `claude/devbug-<bugId>`; when the branch doesn't parse, falls
 * back to matching the PR's html_url against prUrl on the bounded set of
 * PR-open bugs (by_status is indexed and CODE_REVIEW/READY_TO_MERGE are the
 * only states a live PR can be in).
 *
 * merged === true replays the bug's own routineRunId through the existing
 * handleRoutineCallback machinery with source "webhook" (the trusted channel
 * allowed to apply MERGED), which validates the transition, stamps shippedAt,
 * logs the "Merged — live on staging" system turn, pushes the originator, and
 * (for chat items) posts the sourceKey-idempotent bot message. The early-return on an
 * already-MERGED bug makes replayed webhooks — and the race with the
 * auto-merge action's own MERGED apply — no-ops.
 *
 * merged === false leaves the status untouched and posts a system thread
 * message flagging the item for a maintainer (deduped against an immediate
 * webhook redelivery).
 */
export const handleGithubPrClosed = internalMutation({
  args: {
    branchRef: v.string(),
    prUrl: v.optional(v.string()),
    merged: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    // Primary correlation: the implementation Routine names its branch
    // claude/devbug-<bugId>.
    let bug: Doc<"devBugs"> | null = null;
    const branchMatch = /^claude\/devbug-(.+)$/.exec(args.branchRef);
    if (branchMatch) {
      const bugId = ctx.db.normalizeId("devBugs", branchMatch[1]);
      if (bugId) bug = await ctx.db.get(bugId);
    }

    // Fallback: match the PR URL against the stored prUrl of PR-open bugs.
    if (!bug && args.prUrl) {
      for (const status of ["CODE_REVIEW", "READY_TO_MERGE"] as const) {
        const candidates = await ctx.db
          .query("devBugs")
          .withIndex("by_status", (q) => q.eq("status", status))
          .collect();
        bug = candidates.find((b) => b.prUrl === args.prUrl) ?? null;
        if (bug) break;
      }
    }

    if (!bug) {
      console.log(
        "[DevAssistant] GitHub PR-closed webhook did not correlate to a devBug",
        args.branchRef,
        args.prUrl,
      );
      return;
    }
    // `bug` is a `let`; re-bind as const so closures below stay narrowed.
    const target = bug;

    if (args.merged) {
      // Idempotent with auto-merge's own MERGED apply (and with webhook
      // redeliveries): once merged, there is nothing left to apply.
      if (target.status === "MERGED") return;
      if (target.routineRunId) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.devAssistant.actions.handleRoutineCallback,
          {
            bugId: target._id,
            routineRunId: target.routineRunId,
            status: "MERGED",
            // GitHub is ground truth for merges: the webhook source is the
            // ONLY channel (besides auto-merge) allowed to apply MERGED, and
            // it may do so from any PR-live state — including IN_PROGRESS,
            // where an early merge would otherwise strand the row.
            source: "webhook",
          },
        );
      } else {
        // A PR without a Routine run shouldn't exist, but don't lose the
        // merge: apply the transition (stamps shippedAt) + progress line.
        // Same ground-truth rule as above: any PR-live state may merge.
        if (GITHUB_MERGEABLE_STATUSES.includes(target.status)) {
          await ctx.db.patch(target._id, {
            status: "MERGED",
            ...(target.shippedAt ? {} : { shippedAt: Date.now() }),
            updatedAt: Date.now(),
          });
          await insertThreadMessage(
            ctx,
            target._id,
            "system",
            "Merged — live on staging",
          );
        } else {
          console.error(
            "[DevAssistant] GitHub merge webhook ignored: bug in status",
            target.status,
          );
        }
      }
      return;
    }

    // Closed without merging: needs a human. Status is left as-is — the
    // monotonic machine has no backward state for this, and a maintainer may
    // reopen the PR or reject the bug from the review screen.
    const last = await ctx.db
      .query("devBugMessages")
      .withIndex("by_bug", (q) => q.eq("bugId", target._id))
      .order("desc")
      .first();
    if (last?.body !== PR_CLOSED_UNMERGED_MESSAGE) {
      await insertThreadMessage(
        ctx,
        target._id,
        "system",
        PR_CLOSED_UNMERGED_MESSAGE,
      );
      await ctx.db.patch(target._id, { updatedAt: Date.now() });
    }
  },
});

/** Record that an outbound dispatch POST failed (stays IN_PROGRESS). */
export const recordDispatchError = internalMutation({
  args: { bugId: v.id("devBugs"), error: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.bugId, {
      lastError: args.error,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Stamp the routineRunId for a spec-drafting dispatch BEFORE the outbound POST
 * (mirrors markDispatched) so a crash mid-dispatch can't double-run the spec
 * routine. The row stays DRAFT — the spec callback moves it to IN_REVIEW.
 *
 * Revision rounds (`revision: true`, ADR-029 Phase 1.5) re-fire the spec
 * routine after the contributor replies in the thread, so they're valid from
 * DRAFT *or* IN_REVIEW and always stamp a FRESH routineRunId — callbacks
 * correlate by routineRunId, so this makes stale callbacks from the superseded
 * spec run fall on the floor instead of overwriting the newer revision.
 */
export const markSpecDispatched = internalMutation({
  args: {
    bugId: v.id("devBugs"),
    routineRunId: v.string(),
    revision: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ alreadyDispatched: boolean }> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return { alreadyDispatched: true };
    if (args.revision) {
      if (bug.status !== "DRAFT" && bug.status !== "IN_REVIEW") {
        return { alreadyDispatched: true };
      }
    } else if (bug.status !== "DRAFT" || bug.routineRunId) {
      return { alreadyDispatched: true };
    }
    await ctx.db.patch(args.bugId, {
      routineRunId: args.routineRunId,
      activeRunMode: "spec",
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { alreadyDispatched: false };
  },
});

/**
 * Stamp the routineRunId for a review-mode dispatch BEFORE the outbound POST
 * (mirrors markSpecDispatched). Always stamps a FRESH routineRunId: callbacks
 * correlate by routineRunId, so from here on the review run owns the callback
 * channel and stale callbacks from the superseded implementation run fall on
 * the floor. Valid only while the bug is in CODE_REVIEW (the PR-open state
 * the review is about); anything else is a no-op.
 */
export const markReviewDispatched = internalMutation({
  args: { bugId: v.id("devBugs"), routineRunId: v.string() },
  handler: async (ctx, args): Promise<{ alreadyDispatched: boolean }> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return { alreadyDispatched: true };
    if (bug.status !== "CODE_REVIEW") {
      return { alreadyDispatched: true };
    }
    await ctx.db.patch(args.bugId, {
      routineRunId: args.routineRunId,
      activeRunMode: "review",
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { alreadyDispatched: false };
  },
});

/**
 * Stamp the routineRunId for a fix-mode dispatch BEFORE the outbound POST
 * (mirrors markReviewDispatched — from here on the fix run owns callback
 * correlation) and count the round. Valid only while the bug is in
 * CODE_REVIEW (the PR-open state the fix is about); anything else is a
 * no-op. Also logs the "round N of 3" system message here, next to the
 * increment, so the thread only records fix rounds that actually dispatched.
 */
export const markFixDispatched = internalMutation({
  args: { bugId: v.id("devBugs"), routineRunId: v.string() },
  handler: async (ctx, args): Promise<{ alreadyDispatched: boolean }> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug || bug.status !== "CODE_REVIEW") {
      return { alreadyDispatched: true };
    }
    const fixRound = (bug.fixRounds ?? 0) + 1;
    await ctx.db.patch(args.bugId, {
      routineRunId: args.routineRunId,
      activeRunMode: "fix",
      fixRounds: fixRound,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    await insertThreadMessage(
      ctx,
      args.bugId,
      "system",
      `AI is addressing the review feedback (round ${fixRound} of ${MAX_FIX_ROUNDS})`,
    );
    return { alreadyDispatched: false };
  },
});

/**
 * Append a system message to a bug's conversation thread from an action
 * (insertThreadMessage needs a MutationCtx). Used by attemptAutoMerge for its
 * merged/blocked outcome lines.
 */
export const addSystemThreadMessage = internalMutation({
  args: { bugId: v.id("devBugs"), body: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return;
    await insertThreadMessage(ctx, args.bugId, "system", args.body);
    await ctx.db.patch(args.bugId, { updatedAt: Date.now() });
  },
});

/** Max characters of reviewSummary quoted in the thread's system message. */
const REVIEW_SUMMARY_THREAD_LIMIT = 200;

/** Fix-round budget: auto-fix dispatches per bug before escalating to a human. */
export const MAX_FIX_ROUNDS = 3;

/** Thread message posted when the fix-round budget is exhausted. */
export const FIX_ROUNDS_EXHAUSTED_MESSAGE =
  `Code review still failing after ${MAX_FIX_ROUNDS} fix rounds — needs a human`;

/**
 * Apply a routine/webhook/auto-merge callback. Never throws back to the HTTP
 * handler: out-of-policy callbacks record `lastError` and persist NOTHING
 * else (no status, no prUrl/spec/verdict smuggling).
 *
 * What a callback may do is decided by two things:
 *
 * 1. `source` — who is reporting. MERGED is WEBHOOK/AUTO-MERGE-ONLY (GitHub
 *    is ground truth for merges): those sources may apply MERGED from any
 *    PR-live state (IN_PROGRESS / CODE_REVIEW / READY_TO_MERGE — see
 *    GITHUB_MERGEABLE_STATUSES), while a routine-source MERGED is rejected.
 *
 * 2. `activeRunMode` — which run holds the correlated routineRunId (stamped
 *    at dispatch). Per-mode policy for routine-source callbacks:
 *
 *    | mode      | statuses allowed          | reviewVerdict                |
 *    | --------- | ------------------------- | ---------------------------- |
 *    | spec      | IN_REVIEW                 | rejected                     |
 *    | implement | IN_PROGRESS, CODE_REVIEW  | rejected                     |
 *    | review    | CODE_REVIEW               | honored (approved promotes   |
 *    |           |                           | to READY_TO_MERGE)           |
 *    | fix       | CODE_REVIEW               | IGNORED (stripped, no error) |
 *    | (unset)   | legacy permissive         | honored                      |
 *
 *    READY_TO_MERGE from an implement run is rejected explicitly — the review
 *    pipeline owns that promotion. Unset mode covers rows dispatched before
 *    stamping existed and keeps their old behavior (minus MERGED).
 *
 * Spec-delivering callbacks store `spec` + `riskLevel` and the Phase 1.5
 * triage fields (`aiTitle`/`area`/`scope`/`verifyOnStaging`); a CHANGED spec
 * also clears `specApprovedAt` (the contributor approved a different plan)
 * and logs a "needs your approval again" system turn.
 *
 * A GENUINE entry into CODE_REVIEW (a PR opened — or a revision re-entering
 * it) clears any stale verdict and schedules the review-mode dispatch;
 * replayed CODE_REVIEW callbacks are from === to, so they can never
 * double-dispatch. A fix run's CODE_REVIEW callback while the previous
 * round's changes_requested verdict is pending means "fixes pushed": the
 * verdict is cleared (that clearing is the replay guard) and a fresh review
 * round is dispatched. A genuine entry into READY_TO_MERGE schedules the
 * Phase 3 auto-merge attempt (self-gating); "changes_requested" kicks off a
 * fix run — or escalates to a human once MAX_FIX_ROUNDS is spent.
 *
 * Thread side effects (ADR-029 Phase 1.5):
 *  - a delivered spec is appended as an "assistant" message (skipped when the
 *    spec text is unchanged, so re-delivered callbacks don't duplicate it);
 *  - a delivered review verdict is appended as a "system" message (same
 *    changed-value idempotency guard);
 *  - genuine status transitions append a one-line "system" progress message.
 */
export const applyCallback = internalMutation({
  args: {
    bugId: v.id("devBugs"),
    status: bugStatusValidator,
    // Trusted-caller channel discriminator; defaults to "routine" (the
    // least-trusted source, and the only one reachable from the public HTTP
    // callback — which never forwards this field).
    source: v.optional(callbackSourceValidator),
    prUrl: v.optional(v.string()),
    screenshots: v.optional(v.array(v.string())),
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
  handler: async (ctx, args): Promise<Doc<"devBugs"> | null> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return null;

    const source = args.source ?? "routine";
    const mode = bug.activeRunMode;
    const now = Date.now();

    // Out-of-policy callbacks record lastError and persist NOTHING else — a
    // rejected callback must not smuggle fields onto the row either.
    const reject = async (reason: string): Promise<Doc<"devBugs"> | null> => {
      await ctx.db.patch(args.bugId, { lastError: reason, updatedAt: now });
      return await ctx.db.get(args.bugId);
    };

    // MERGED is webhook/auto-merge-only: GitHub is ground truth for merges,
    // so no routine run may claim one (the webhook reports the real merge).
    if (args.status === "MERGED" && source === "routine") {
      return await reject(
        "Rejected callback: MERGED is applied only from the GitHub webhook or auto-merge",
      );
    }

    // Per-run-mode policy (see the table in the doc comment). Unset mode =
    // legacy pre-stamping row: keep the old permissive behavior minus MERGED.
    if (source === "routine" && mode !== undefined) {
      let policyError: string | null = null;
      if (mode === "spec") {
        if (args.status !== "IN_REVIEW") {
          policyError = `spec run may not deliver status ${args.status}`;
        } else if (args.reviewVerdict !== undefined) {
          policyError = "spec run may not deliver a review verdict";
        }
      } else if (mode === "implement") {
        if (args.status === "READY_TO_MERGE") {
          policyError =
            "implement run may not deliver READY_TO_MERGE — the review pipeline owns that promotion";
        } else if (
          args.status !== "IN_PROGRESS" &&
          args.status !== "CODE_REVIEW"
        ) {
          policyError = `implement run may not deliver status ${args.status}`;
        } else if (args.reviewVerdict !== undefined) {
          policyError = "implement run may not deliver a review verdict";
        }
      } else if (mode === "review" && args.status !== "CODE_REVIEW") {
        policyError = `review run may not deliver status ${args.status}`;
      } else if (mode === "fix" && args.status !== "CODE_REVIEW") {
        policyError = `fix run may not deliver status ${args.status}`;
      }
      if (policyError) {
        return await reject(`Rejected callback: ${policyError}`);
      }
    }

    // A fix run has no review authority: a verdict in its callback (e.g. the
    // run echoing the feedback it just addressed) is IGNORED, never stored —
    // fix completion is detected from the run mode + status instead.
    const ignoreVerdict = source === "routine" && mode === "fix";
    const reviewVerdict = ignoreVerdict ? undefined : args.reviewVerdict;
    const reviewSummary = ignoreVerdict ? undefined : args.reviewSummary;

    // An approved review verdict reported against the PR-open status promotes
    // the bug forward: the review run calls back with its current status
    // (CODE_REVIEW) and the verdict decides whether it advances.
    const targetStatus: BugStatus =
      reviewVerdict === "approved" && args.status === "CODE_REVIEW"
        ? "READY_TO_MERGE"
        : args.status;

    // Webhook/auto-merge merges may arrive from any PR-live state (GitHub is
    // ground truth); everything else follows the monotonic transition map.
    const transitionOk =
      targetStatus === "MERGED" && source !== "routine"
        ? GITHUB_MERGEABLE_STATUSES.includes(bug.status)
        : canTransition(bug.status, targetStatus);
    if (!transitionOk) {
      return await reject(
        `Ignored callback transition ${bug.status} -> ${targetStatus}`,
      );
    }
    const genuineTransition = targetStatus !== bug.status;

    const patch: Partial<Doc<"devBugs">> = {
      status: targetStatus,
      lastError: undefined,
      lastCallbackAt: now,
      updatedAt: now,
    };
    if (args.prUrl !== undefined) patch.prUrl = args.prUrl;
    if (args.screenshots !== undefined) patch.screenshotUrls = args.screenshots;
    if (args.spec !== undefined) patch.spec = args.spec;
    if (args.riskLevel !== undefined) patch.riskLevel = args.riskLevel;
    if (args.aiTitle !== undefined) patch.aiTitle = args.aiTitle;
    if (args.area !== undefined) patch.area = args.area;
    if (args.scope !== undefined) patch.scope = args.scope;
    // Split slices track the scope: a routine explicitly delivers them (only
    // meaningful for "split"), and a revision that re-triages to any non-split
    // scope (buildable or design_needed) clears the now-stale slices.
    if (args.splitSlices !== undefined) {
      patch.splitSlices = args.splitSlices;
    } else if (args.scope !== undefined && args.scope !== "split") {
      patch.splitSlices = undefined;
    }
    if (args.verifyOnStaging !== undefined) {
      patch.verifyOnStaging = args.verifyOnStaging;
    }
    if (targetStatus === "MERGED" && !bug.shippedAt) {
      patch.shippedAt = now;
    }

    // Stale approval guard: a REVISED spec invalidates an existing sign-off —
    // the contributor approved a different plan and must re-approve this one.
    const specChanged = args.spec !== undefined && args.spec !== bug.spec;
    if (specChanged && bug.specApprovedAt) {
      patch.specApprovedAt = undefined;
    }

    // GENUINE entry into CODE_REVIEW = a PR (revision) just opened: clear any
    // stale verdict from a previous review round and fire the review-mode
    // routine (event-driven, mirrors READY_FOR_IMPL -> dispatchBug). Replayed
    // CODE_REVIEW callbacks are from === to and can't re-dispatch.
    const enteredCodeReview =
      genuineTransition && targetStatus === "CODE_REVIEW";
    if (enteredCodeReview) {
      patch.reviewVerdict = undefined;
      patch.reviewSummary = undefined;
      await ctx.scheduler.runAfter(
        0,
        internal.functions.devAssistant.actions.dispatchReview,
        { bugId: args.bugId },
      );
    }

    // Fix run reporting back (ADR-029 Phase 3): the fix run's CODE_REVIEW
    // callback while the previous round's changes_requested verdict is still
    // pending is "fixes pushed" (it correlated by the fix run's routineRunId
    // upstream). Not a genuine transition, so handle it explicitly: clear the
    // stale verdict/summary and dispatch a fresh review round. The cleared
    // verdict is the replay guard — a re-delivered callback from the same fix
    // run finds no pending verdict and does nothing, so review can never
    // double-dispatch. Legacy rows without a stamped mode keep the old
    // payload-shape inference (a CODE_REVIEW callback carrying no verdict).
    const fixesPushed =
      !enteredCodeReview &&
      args.status === "CODE_REVIEW" &&
      bug.status === "CODE_REVIEW" &&
      bug.reviewVerdict === "changes_requested" &&
      (mode === "fix" ||
        (mode === undefined && args.reviewVerdict === undefined));
    if (fixesPushed) {
      patch.reviewVerdict = undefined;
      patch.reviewSummary = undefined;
      await ctx.scheduler.runAfter(
        0,
        internal.functions.devAssistant.actions.dispatchReview,
        { bugId: args.bugId },
      );
    }

    // Explicit (honored) verdict fields in the payload win over the resets
    // above (a callback carrying both is anomalous, but the payload is
    // authoritative for the modes allowed to carry one).
    if (reviewVerdict !== undefined) {
      patch.reviewVerdict = reviewVerdict;
    }
    if (reviewSummary !== undefined) {
      patch.reviewSummary = reviewSummary;
    }

    await ctx.db.patch(args.bugId, patch);

    if (fixesPushed) {
      await insertThreadMessage(
        ctx,
        args.bugId,
        "system",
        "Fixes pushed — running code review again",
      );
    }

    // Spec text lands in the conversation as the assistant's turn. Comparing
    // against the previously stored spec is the idempotency guard for
    // re-delivered callbacks (and skips no-op revisions). When the change
    // invalidated an approval, say so right below the new plan.
    if (args.spec !== undefined && args.spec !== bug.spec) {
      await insertThreadMessage(ctx, args.bugId, "assistant", args.spec);
      if (bug.specApprovedAt) {
        await insertThreadMessage(
          ctx,
          args.bugId,
          "system",
          "Plan updated — needs your approval again",
        );
      }
    }

    // Review verdict lands as a system turn, before the status progress line
    // so an approval reads "review passed" -> "ready to merge". Same
    // changed-value guard as the spec: re-delivered callbacks don't repost.
    if (
      reviewVerdict !== undefined &&
      (reviewVerdict !== bug.reviewVerdict ||
        (reviewSummary !== undefined && reviewSummary !== bug.reviewSummary))
    ) {
      let message: string;
      if (reviewVerdict === "approved") {
        message = "Code review passed ✓";
      } else {
        const summary = reviewSummary?.trim();
        const quoted =
          summary && summary.length > REVIEW_SUMMARY_THREAD_LIMIT
            ? `${summary.slice(0, REVIEW_SUMMARY_THREAD_LIMIT)}…`
            : summary;
        message = quoted
          ? `Code review requested changes — ${quoted}`
          : "Code review requested changes";
      }
      await insertThreadMessage(ctx, args.bugId, "system", message);
    }

    // Review → fix → re-review loop (ADR-029 Phase 3): a changes_requested
    // verdict that GENUINELY lands (changed-state guard — a re-delivered
    // callback carries the verdict already stored on the row) dispatches a
    // fix run while the round budget lasts; past the cap it escalates to a
    // human instead. dispatchFix increments fixRounds and posts the
    // "round N of 3" thread line via markFixDispatched.
    const verdictBecameChangesRequested =
      reviewVerdict === "changes_requested" &&
      bug.reviewVerdict !== "changes_requested" &&
      targetStatus === "CODE_REVIEW";
    if (verdictBecameChangesRequested) {
      if ((bug.fixRounds ?? 0) < MAX_FIX_ROUNDS) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.devAssistant.actions.dispatchFix,
          { bugId: args.bugId },
        );
      } else {
        await insertThreadMessage(
          ctx,
          args.bugId,
          "system",
          FIX_ROUNDS_EXHAUSTED_MESSAGE,
        );
        await ctx.scheduler.runAfter(
          0,
          internal.functions.notifications.actions.sendPushNotification,
          {
            userId: bug.originatorUserId,
            title: "Code review needs a human",
            body: `"${bug.title}" is still failing code review after ${MAX_FIX_ROUNDS} fix rounds.`,
            notificationType: "dev_contribution_update",
            data: { bugId: args.bugId, status: targetStatus },
          },
        );
      }
    }

    // Policy auto-merge (ADR-029 Phase 3): a genuine entry into
    // READY_TO_MERGE may have satisfied the last merge gate. Schedule the
    // attempt — the action re-reads the bug and re-checks every gate itself,
    // so double-scheduling is harmless.
    if (genuineTransition && targetStatus === "READY_TO_MERGE") {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.devAssistant.actions.attemptAutoMerge,
        { bugId: args.bugId },
      );
    }

    // Progress log: only when the status genuinely changed (an idempotent
    // re-apply of the current status must not re-post).
    if (genuineTransition) {
      const systemMessage = STATUS_SYSTEM_MESSAGES[targetStatus];
      if (systemMessage) {
        await insertThreadMessage(ctx, args.bugId, "system", systemMessage);
      }
    }

    return await ctx.db.get(args.bugId);
  },
});

// ============================================================================
// Thread context for the agent
// ============================================================================

/**
 * Lightweight access check used by the (action-side) trigger gate. Superusers
 * and staff have implicit access; delegated `dev_maintainer`s can summon the
 * assistant too (but not the superuser-only review/merge ops — see
 * maintainers.ts).
 */
export const getUserAccess = internalQuery({
  args: { userId: v.id("users") },
  handler: async (
    ctx,
    args,
  ): Promise<{ isStaff: boolean; isSuperuser: boolean; isMaintainer: boolean }> => {
    const user = await ctx.db.get(args.userId);
    return {
      isStaff: user?.isStaff ?? false,
      isSuperuser: user?.isSuperuser ?? false,
      isMaintainer: user?.platformRoles?.includes(DEV_MAINTAINER_ROLE) ?? false,
    };
  },
});

export type ThreadMessageView = {
  senderName: string;
  content: string;
  imageUrls: string[];
};

/**
 * Collect the thread window + image attachments the agent reasons over, plus
 * any existing (non-terminal) bug already opened for this thread so iteration
 * updates the same bug rather than creating a duplicate.
 */
export const getThreadContext = internalQuery({
  args: { channelId: v.id("chatChannels"), mentionMessageId: v.id("chatMessages") },
  handler: async (ctx, args) => {
    const channel = await ctx.db.get(args.channelId);
    if (!channel) return null;

    // Resolve community (ad-hoc channels carry communityId; group channels
    // resolve it through the group).
    let communityId: Id<"communities"> | null = channel.communityId ?? null;
    if (!communityId && channel.groupId) {
      const group = await ctx.db.get(channel.groupId);
      communityId = group?.communityId ?? null;
    }
    if (!communityId) return null;

    const mention = await ctx.db.get(args.mentionMessageId);
    if (!mention) return null;
    const threadRootMessageId = mention.parentMessageId ?? args.mentionMessageId;

    // Root message + its replies, oldest first, capped to a sane window.
    const root = await ctx.db.get(threadRootMessageId);
    const replies = await ctx.db
      .query("chatMessages")
      .withIndex("by_parentMessage", (q) =>
        q.eq("parentMessageId", threadRootMessageId),
      )
      .collect();

    const ordered = [root, ...replies]
      .filter((m): m is Doc<"chatMessages"> => !!m && !m.isDeleted)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-30);

    const messages: ThreadMessageView[] = ordered.map((m) => ({
      senderName: m.senderName ?? "Someone",
      content: m.content,
      // Resolve stored R2 paths (r2:chat/...) to public HTTP URLs so the
      // OpenAI image_url payload, the routine payload, and the admin preview
      // all receive fetchable URIs. Drop anything that can't be resolved.
      imageUrls: (m.attachments ?? [])
        .filter((a) => a.type === "image")
        .map((a) => getMediaUrl(a.url))
        .filter((url): url is string => !!url),
    }));

    const screenshotUrls = messages.flatMap((m) => m.imageUrls);

    // Existing non-terminal bug for this thread (so iteration reuses it).
    const channelBugs = await ctx.db
      .query("devBugs")
      .withIndex("by_channel", (q) => q.eq("channelId", args.channelId))
      .collect();
    const existing = channelBugs
      .filter(
        (b) =>
          b.threadRootMessageId === threadRootMessageId &&
          b.status !== "MERGED" &&
          b.status !== "REJECTED",
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    return {
      communityId,
      threadRootMessageId,
      messages,
      screenshotUrls,
      existingBug: existing
        ? { bugId: existing._id, status: existing.status, title: existing.title }
        : null,
    };
  },
});
