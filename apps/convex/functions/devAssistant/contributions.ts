/**
 * Contributor Dev Dashboard — dashboard-originated devBugs (ADR-029, Phase 1).
 *
 * Contributors (== dev maintainers; everyone who passes canUseDevAssistant)
 * submit bugs/feature ideas from the in-app dashboard. Each submission is a
 * platform-level devBugs row (no communityId/channelId/thread) that flows
 * through the existing status machine:
 *
 *   DRAFT --(spec agent, dispatchSpec)--> IN_REVIEW --(approveSpec)-->
 *     READY_FOR_IMPL (auto when riskLevel === "low", else via startBuild)
 *     --> IN_PROGRESS -> CODE_REVIEW -> READY_TO_MERGE -> MERGED
 *
 * The spec agent and the implementation agent are the same Claude Code Routine
 * fired in different modes (see actions.ts dispatchSpec / dispatchBug); both
 * report back through the signed /dev-assistant/callback in http.ts.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuthUser } from "../../lib/auth";
import { canUseDevAssistant } from "./maintainers";
import { applyStatusTransition } from "./bugs";

export const contributionKindValidator = v.union(
  v.literal("bug"),
  v.literal("feature"),
);

/**
 * Auth gate for the whole dashboard surface. Per the ADR-029 decision update
 * there is no separate contributor role — contributors ARE dev maintainers
 * (plus staff/superusers, who pass canUseDevAssistant implicitly).
 */
async function requireContributor(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"users">> {
  const user = await requireAuthUser(ctx, token);
  if (!canUseDevAssistant(user)) {
    throw new ConvexError("Not authorized: dev maintainer access required");
  }
  return user;
}

/**
 * Schedule a "your item moved forward" push to the originator — but never for
 * the originator's own direct action (they just tapped the button).
 */
async function notifyOriginatorUnlessSelf(
  ctx: MutationCtx,
  bug: Doc<"devBugs">,
  actorId: Id<"users">,
  push: { title: string; body: string; status: string },
): Promise<void> {
  if (bug.originatorUserId === actorId) return;
  await ctx.scheduler.runAfter(
    0,
    internal.functions.notifications.actions.sendPushNotification,
    {
      userId: bug.originatorUserId,
      title: push.title,
      body: push.body,
      notificationType: "dev_contribution_update",
      data: { bugId: bug._id, status: push.status },
    },
  );
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Submit a new contribution from the dashboard. Creates a platform-level
 * DRAFT row and immediately hands it to the spec agent, which investigates
 * and reports a spec + proposed risk level back via the signed callback
 * (moving the row to IN_REVIEW).
 */
export const submit = mutation({
  args: {
    token: v.string(),
    kind: contributionKindValidator,
    title: v.string(),
    body: v.string(),
    repro: v.optional(v.string()),
    screenshotUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<Id<"devBugs">> => {
    const user = await requireContributor(ctx, args.token);

    const title = args.title.trim();
    const body = args.body.trim();
    if (!title) throw new ConvexError("Title is required");
    if (!body) throw new ConvexError("Description is required");

    const now = Date.now();
    const bugId = await ctx.db.insert("devBugs", {
      // Dashboard items are platform-level: no communityId/channelId/thread.
      originatorUserId: user._id,
      status: "DRAFT",
      kind: args.kind,
      source: "dashboard",
      title,
      body,
      repro: args.repro,
      screenshotUrls: args.screenshotUrls,
      createdAt: now,
      updatedAt: now,
    });

    // Fire the spec agent (event-driven, no cron — mirrors READY_FOR_IMPL ->
    // dispatchBug in bugs.ts).
    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.actions.dispatchSpec,
      { bugId },
    );

    return bugId;
  },
});

/**
 * Contributor sign-off on the AI-drafted spec. Low-risk items auto-dispatch to
 * implementation; medium/high/unknown risk stays IN_REVIEW until someone
 * explicitly calls startBuild.
 */
export const approveSpec = mutation({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; autoDispatched: boolean }> => {
    const user = await requireContributor(ctx, args.token);

    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");
    if (bug.status !== "IN_REVIEW") {
      throw new ConvexError(
        `Spec can only be approved while in review (current status: ${bug.status})`,
      );
    }
    if (!bug.spec) {
      throw new ConvexError("This item has no spec to approve yet");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, { specApprovedAt: now, updatedAt: now });

    // Risk-gated auto-dispatch (ADR-029 decision update): only low-risk items
    // start building on approval. applyStatusTransition schedules dispatchBug.
    const autoDispatched = bug.riskLevel === "low";
    if (autoDispatched) {
      await applyStatusTransition(ctx, bug, "READY_FOR_IMPL");
      await notifyOriginatorUnlessSelf(ctx, bug, user._id, {
        title: "Build started",
        body: `The spec for "${bug.title}" was approved and implementation has started.`,
        status: "READY_FOR_IMPL",
      });
    }

    return { ok: true, autoDispatched };
  },
});

/**
 * Explicitly start implementation for an approved medium/high/unknown-risk
 * item. Any contributor/maintainer may call this once the spec is approved.
 */
export const startBuild = mutation({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const user = await requireContributor(ctx, args.token);

    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");
    if (!bug.specApprovedAt) {
      throw new ConvexError("Spec must be approved before starting a build");
    }
    if (bug.status !== "IN_REVIEW") {
      throw new ConvexError(
        `Build can only be started from review (current status: ${bug.status})`,
      );
    }

    // Schedules dispatchBug via the READY_FOR_IMPL hook in bugs.ts.
    await applyStatusTransition(ctx, bug, "READY_FOR_IMPL");
    await notifyOriginatorUnlessSelf(ctx, bug, user._id, {
      title: "Build started",
      body: `Implementation has started for "${bug.title}".`,
      status: "READY_FOR_IMPL",
    });

    return { ok: true };
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * The caller's own contributions — ALL sources (dashboard submissions and
 * chat-originated bugs they reported), newest first.
 */
export const myContributions = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Doc<"devBugs">[]> => {
    const user = await requireContributor(ctx, args.token);
    return await ctx.db
      .query("devBugs")
      .withIndex("by_originator", (q) => q.eq("originatorUserId", user._id))
      .order("desc")
      .collect();
  },
});

/** Every contribution across all originators, newest first (capped at 200). */
export const listAll = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Doc<"devBugs">[]> => {
    await requireContributor(ctx, args.token);
    return await ctx.db.query("devBugs").order("desc").take(200);
  },
});

/** A single contribution — any dev maintainer may view any item. */
export const getContribution = query({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (ctx, args): Promise<Doc<"devBugs"> | null> => {
    await requireContributor(ctx, args.token);
    return await ctx.db.get(args.id);
  },
});
