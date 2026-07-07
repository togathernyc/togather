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
 */
const ALLOWED_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  DRAFT: ["IN_REVIEW", "REJECTED"],
  IN_REVIEW: ["READY_FOR_IMPL", "REJECTED"],
  READY_FOR_IMPL: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["CODE_REVIEW", "REJECTED"],
  CODE_REVIEW: ["READY_TO_MERGE", "REJECTED"],
  READY_TO_MERGE: ["MERGED", "REJECTED"],
  MERGED: [],
  REJECTED: [],
};

function canTransition(from: BugStatus, to: BugStatus): boolean {
  if (from === to) return true; // idempotent re-apply
  return ALLOWED_TRANSITIONS[from].includes(to);
}

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
): Promise<Id<"devBugMessages">> {
  return await ctx.db.insert("devBugMessages", {
    bugId,
    authorType,
    userId,
    body,
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
  MERGED: "Shipped 🎉",
};

export type ThreadHistoryEntry = {
  authorType: "user" | "assistant" | "system";
  authorName?: string;
  body: string;
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
      entries.push({ authorType: m.authorType, authorName, body: m.body });
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
      dispatchedAt: Date.now(),
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { alreadyDispatched: false };
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
      lastError: undefined,
      updatedAt: Date.now(),
    });
    return { alreadyDispatched: false };
  },
});

/** Max characters of reviewSummary quoted in the thread's system message. */
const REVIEW_SUMMARY_THREAD_LIMIT = 200;

/**
 * Apply a routine callback. Validates the callback's target status against the
 * transition map; on an illegal transition we keep the current status but
 * record lastError (callbacks must never throw the HTTP handler). Always
 * refreshes prUrl/screenshots/lastCallbackAt.
 *
 * Spec-mode callbacks (ADR-029) additionally deliver `spec` + `riskLevel` and
 * the Phase 1.5 triage fields (`aiTitle`/`area`/`scope`/`verifyOnStaging`),
 * which are stored whenever provided; a MERGED transition stamps `shippedAt`.
 *
 * Review-mode callbacks deliver `reviewVerdict` (+ `reviewSummary`): an
 * "approved" verdict on a CODE_REVIEW callback promotes the target status to
 * READY_TO_MERGE (approval is what moves the bug forward); "changes_requested"
 * stores the verdict and leaves the bug in CODE_REVIEW. A GENUINE entry into
 * CODE_REVIEW (a PR opened — or a future revision re-entering it) clears any
 * stale verdict and schedules the review-mode dispatch; replayed CODE_REVIEW
 * callbacks are from === to, so they can never double-dispatch.
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
    prUrl: v.optional(v.string()),
    screenshots: v.optional(v.array(v.string())),
    spec: v.optional(v.string()),
    riskLevel: v.optional(riskLevelValidator),
    aiTitle: v.optional(v.string()),
    area: v.optional(v.string()),
    scope: v.optional(scopeValidator),
    verifyOnStaging: v.optional(v.boolean()),
    reviewVerdict: v.optional(reviewVerdictValidator),
    reviewSummary: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"devBugs"> | null> => {
    const bug = await ctx.db.get(args.bugId);
    if (!bug) return null;

    const now = Date.now();
    const patch: Partial<Doc<"devBugs">> = {
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
    if (args.verifyOnStaging !== undefined) {
      patch.verifyOnStaging = args.verifyOnStaging;
    }

    // An approved review verdict reported against the PR-open status promotes
    // the bug forward: the review run calls back with its current status
    // (CODE_REVIEW) and the verdict decides whether it advances.
    const targetStatus: BugStatus =
      args.reviewVerdict === "approved" && args.status === "CODE_REVIEW"
        ? "READY_TO_MERGE"
        : args.status;

    const transitioned = canTransition(bug.status, targetStatus);
    if (transitioned) {
      patch.status = targetStatus;
      patch.lastError = undefined;
      if (targetStatus === "MERGED" && !bug.shippedAt) {
        patch.shippedAt = now;
      }
    } else {
      patch.lastError = `Ignored callback transition ${bug.status} -> ${targetStatus}`;
    }

    // GENUINE entry into CODE_REVIEW = a PR (revision) just opened: clear any
    // stale verdict from a previous review round and fire the review-mode
    // routine (event-driven, mirrors READY_FOR_IMPL -> dispatchBug). Replayed
    // CODE_REVIEW callbacks are from === to and can't re-dispatch.
    const enteredCodeReview =
      transitioned &&
      targetStatus === "CODE_REVIEW" &&
      bug.status !== "CODE_REVIEW";
    if (enteredCodeReview) {
      patch.reviewVerdict = undefined;
      patch.reviewSummary = undefined;
      await ctx.scheduler.runAfter(
        0,
        internal.functions.devAssistant.actions.dispatchReview,
        { bugId: args.bugId },
      );
    }

    // Explicit verdict fields in the payload win over the reset above (a
    // callback carrying both is anomalous, but the payload is authoritative).
    if (args.reviewVerdict !== undefined) {
      patch.reviewVerdict = args.reviewVerdict;
    }
    if (args.reviewSummary !== undefined) {
      patch.reviewSummary = args.reviewSummary;
    }

    await ctx.db.patch(args.bugId, patch);

    // Spec text lands in the conversation as the assistant's turn. Comparing
    // against the previously stored spec is the idempotency guard for
    // re-delivered callbacks (and skips no-op revisions).
    if (args.spec !== undefined && args.spec !== bug.spec) {
      await insertThreadMessage(ctx, args.bugId, "assistant", args.spec);
    }

    // Review verdict lands as a system turn, before the status progress line
    // so an approval reads "review passed" -> "ready to merge". Same
    // changed-value guard as the spec: re-delivered callbacks don't repost.
    if (
      args.reviewVerdict !== undefined &&
      (args.reviewVerdict !== bug.reviewVerdict ||
        (args.reviewSummary !== undefined &&
          args.reviewSummary !== bug.reviewSummary))
    ) {
      let message: string;
      if (args.reviewVerdict === "approved") {
        message = "Code review passed ✓";
      } else {
        const summary = args.reviewSummary?.trim();
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

    // Progress log: only when the status genuinely changed (an idempotent
    // re-apply of the current status must not re-post).
    if (transitioned && targetStatus !== bug.status) {
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
