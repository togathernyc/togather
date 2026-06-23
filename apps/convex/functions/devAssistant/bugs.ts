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

type BugStatus = Doc<"devBugs">["status"];

/** Valid forward transitions. Empty arrays are terminal states. */
const ALLOWED_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  DRAFT: ["IN_REVIEW", "REJECTED"],
  IN_REVIEW: ["READY_FOR_IMPL", "REJECTED"],
  READY_FOR_IMPL: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["CODE_REVIEW", "REJECTED"],
  CODE_REVIEW: ["READY_TO_MERGE", "IN_PROGRESS", "REJECTED"],
  READY_TO_MERGE: ["MERGED", "CODE_REVIEW", "REJECTED"],
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
async function applyStatusTransition(
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

  await ctx.db.patch(bug._id, { status: newStatus, updatedAt: Date.now() });

  if (newStatus === "READY_FOR_IMPL") {
    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.actions.dispatchBug,
      { bugId: bug._id },
    );
  }
}

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
  handler: async (ctx, args): Promise<{ bugId: Id<"devBugs">; reviewLink: string }> => {
    const now = Date.now();
    const bugId = await ctx.db.insert("devBugs", {
      communityId: args.communityId,
      channelId: args.channelId,
      threadRootMessageId: args.threadRootMessageId,
      originatorUserId: args.originatorUserId,
      status: "IN_REVIEW",
      title: args.title,
      body: args.body,
      repro: args.repro,
      screenshotUrls: args.screenshotUrls,
      createdAt: now,
      updatedAt: now,
    });

    const reviewLink = `/(user)/admin/bugs/${bugId}`;
    await ctx.db.patch(bugId, { reviewLink });

    return { bugId, reviewLink };
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
 * Apply a routine callback. Validates the callback's target status against the
 * transition map; on an illegal transition we keep the current status but
 * record lastError (callbacks must never throw the HTTP handler). Always
 * refreshes prUrl/screenshots/lastCallbackAt.
 */
export const applyCallback = internalMutation({
  args: {
    bugId: v.id("devBugs"),
    status: bugStatusValidator,
    prUrl: v.optional(v.string()),
    screenshots: v.optional(v.array(v.string())),
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

    if (canTransition(bug.status, args.status)) {
      patch.status = args.status;
      patch.lastError = undefined;
    } else {
      patch.lastError = `Ignored callback transition ${bug.status} -> ${args.status}`;
    }

    await ctx.db.patch(args.bugId, patch);
    return await ctx.db.get(args.bugId);
  },
});

// ============================================================================
// Thread context for the agent
// ============================================================================

/** Lightweight staff/superuser check used by the (action-side) gate. */
export const getUserAccess = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<{ isStaff: boolean; isSuperuser: boolean }> => {
    const user = await ctx.db.get(args.userId);
    return {
      isStaff: user?.isStaff ?? false,
      isSuperuser: user?.isSuperuser ?? false,
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
