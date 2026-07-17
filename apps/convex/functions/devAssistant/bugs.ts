/**
 * Dev-Assistant — bugs module (`functions/devAssistant/bugs`).
 *
 * Two halves:
 *
 * 1. **Package re-exports.** The devBugs pipeline DB ops (status machine,
 *    callback applier, dispatch markers, GitHub webhook appliers, review-screen
 *    ops) now live in `@supa-media/dev-assistant`. They are re-exported here at
 *    exactly `functions/devAssistant/bugs` — the `functionsPath` contract the
 *    package builds its internal function references against. Renaming/dropping
 *    any of these silently breaks scheduled pipeline calls at runtime (guarded
 *    by `_instance.test.ts`).
 *
 * 2. **Local chat-plumbing.** `createBug` / `updateBug` / `setBugStatus` /
 *    `getUserAccess` / `getThreadContext` are the @Togather in-chat bot's DB ops
 *    (OpenAI loop in agent.ts/tools.ts). They stay in the app — they touch
 *    Togather's chat FKs (communities/chatChannels/chatMessages) and the
 *    dashboard-first package doesn't own the chat-origination flow.
 */

import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  MutationCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { getMediaUrl } from "../../lib/utils";
import { DEV_MAINTAINER_ROLE } from "./access";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import { devAssistant } from "./_instance";
import type {
  InternalQuery,
  InternalMutation,
  PublicQuery,
  PublicMutation,
} from "./_reexportTypes";

// ============================================================================
// Package pipeline functions (functionsPath contract — do not rename/drop)
// ============================================================================
// Direct-const re-exports with explicit registered-function types. This exact
// shape is REQUIRED: a destructured re-export (`export const { getBug } =
// devAssistant.bugs`) is dropped from Convex's generated `api`/`internal` at the
// type level (the package erases the function types through its factory return —
// see _reexportTypes.ts). Runtime is the package's real functions.
export const getThreadHistory: InternalQuery = devAssistant.bugs.getThreadHistory as any;
export const getBug: InternalQuery = devAssistant.bugs.getBug as any;
export const getBugByRoutineRunId: InternalQuery = devAssistant.bugs.getBugByRoutineRunId as any;
export const getOriginatorAttribution: InternalQuery = devAssistant.bugs.getOriginatorAttribution as any;
export const listOpenPrBugs: InternalQuery = devAssistant.bugs.listOpenPrBugs as any;
export const markDispatched: InternalMutation = devAssistant.bugs.markDispatched as any;
export const markSpecDispatched: InternalMutation = devAssistant.bugs.markSpecDispatched as any;
export const markReviewDispatched: InternalMutation = devAssistant.bugs.markReviewDispatched as any;
export const markFixDispatched: InternalMutation = devAssistant.bugs.markFixDispatched as any;
export const setGithubIssue: InternalMutation = devAssistant.bugs.setGithubIssue as any;
export const recordDispatchError: InternalMutation = devAssistant.bugs.recordDispatchError as any;
export const addSystemThreadMessage: InternalMutation = devAssistant.bugs.addSystemThreadMessage as any;
export const recordProductionDeployOutcome: InternalMutation = devAssistant.bugs.recordProductionDeployOutcome as any;
export const recordMergeFromAppFailure: InternalMutation = devAssistant.bugs.recordMergeFromAppFailure as any;
export const applyCallback: InternalMutation = devAssistant.bugs.applyCallback as any;
export const handleGithubPrClosed: InternalMutation = devAssistant.bugs.handleGithubPrClosed as any;
export const handleWorkflowRunEvent: InternalMutation = devAssistant.bugs.handleWorkflowRunEvent as any;
export const getBugForReview: PublicQuery = devAssistant.bugs.getBugForReview as any;
export const rejectBug: PublicMutation = devAssistant.bugs.rejectBug as any;
export const markBugMerged: PublicMutation = devAssistant.bugs.markBugMerged as any;
export const retryDispatch: PublicMutation = devAssistant.bugs.retryDispatch as any;

// ============================================================================
// Local chat-plumbing (the @Togather bot's create/update/status DB ops)
// ============================================================================

type BugStatus = Doc<"devBugs">["status"];

/** Statuses the chat agent's setBugStatus may set (READY_FOR_IMPL only). */
const bugStatusValidator = v.union(
  v.literal("DRAFT"),
  v.literal("IN_REVIEW"),
  v.literal("READY_FOR_IMPL"),
  v.literal("IN_PROGRESS"),
  v.literal("CODE_REVIEW"),
  v.literal("READY_TO_MERGE"),
  v.literal("MERGED"),
  v.literal("REJECTED"),
);

/**
 * Valid forward transitions — MONOTONIC (a bug only moves forward, plus
 * REJECTED). Kept locally for the chat bot's setBugStatus; the package owns the
 * authoritative copy for the pipeline. The single legal READY_FOR_IMPL the chat
 * bot drives schedules the package's dispatchBug via `applyStatusTransition`.
 */
const ALLOWED_TRANSITIONS: Record<BugStatus, BugStatus[]> = {
  DRAFT: ["IN_REVIEW", "REJECTED"],
  IN_REVIEW: ["READY_FOR_IMPL", "REJECTED"],
  READY_FOR_IMPL: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["CODE_REVIEW", "REJECTED"],
  CODE_REVIEW: ["READY_TO_MERGE", "MERGED", "REJECTED"],
  READY_TO_MERGE: ["MERGED", "REJECTED"],
  MERGED: ["READY_FOR_IMPL"],
  REJECTED: [],
};

function canTransition(from: BugStatus, to: BugStatus): boolean {
  if (from === to) return true; // idempotent re-apply
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Apply a validated status transition and persist it. When a bug lands on
 * READY_FOR_IMPL we schedule the package's dispatch action immediately
 * (event-driven, no cron) so the routine fires the instant the bug is marked
 * ready. `internal.functions.devAssistant.actions.dispatchBug` resolves to the
 * package's re-exported dispatch action.
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

  await ctx.db.patch(bug._id, {
    status: newStatus,
    updatedAt: Date.now(),
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

/**
 * Create a new bug in IN_REVIEW (chat-originated). Returns the bug id and the
 * review link the agent should surface in the thread.
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

/**
 * Lightweight access check used by the (action-side) trigger gate. Superusers
 * and staff have implicit access; delegated `dev_maintainer`s can summon the
 * assistant too (but not the superuser-only review/merge ops).
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
  args: {
    channelId: v.id("chatChannels"),
    mentionMessageId: v.id("chatMessages"),
  },
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
          b.status !== "REJECTED" &&
          // A shipped bug in a staging-redo round is non-terminal again, but
          // its brief is the payload-of-record for an in-flight rebuild — a
          // new chat mention must file a fresh bug, not mutate the redo.
          !b.shippedAt,
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
