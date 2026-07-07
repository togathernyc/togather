/**
 * Contributor Dev Dashboard — dashboard-originated devBugs (ADR-029, Phase 1
 * + Phase 1.5 conversation layer).
 *
 * Contributors (== dev maintainers; everyone who passes canUseDevAssistant)
 * submit bugs/feature ideas from the in-app dashboard. Each submission is a
 * platform-level devBugs row (no communityId/channelId/thread) that flows
 * through the existing status machine, and every contribution is a
 * conversation with the AI (devBugMessages: the report is the first "user"
 * turn, spec drafts arrive as "assistant" turns, lifecycle transitions log
 * "system" turns):
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
import { applyStatusTransition, insertThreadMessage } from "./bugs";

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
// GitHub attribution (ADR-029 Phase 2)
// ============================================================================

/**
 * GitHub's username rules: alphanumeric and hyphens only, no leading/trailing
 * or consecutive hyphens. Length (max 39) is checked separately — a quantifier
 * on the hyphen-separated groups can't express "39 chars total".
 */
const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
const GITHUB_USERNAME_MAX_LENGTH = 39;

/** The caller's own self-entered GitHub username (null when unset). */
export const getGithubUsername = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const user = await requireContributor(ctx, args.token);
    return user.githubUsername ?? null;
  },
});

/**
 * Set (or clear, with an empty string) the caller's GitHub username. It's
 * honor-system attribution, not authentication (ADR-029): the implementation
 * Routine uses it for the Co-authored-by trailer so shipped contributions
 * land on the contributor's GitHub profile.
 */
export const setGithubUsername = mutation({
  args: { token: v.string(), username: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const user = await requireContributor(ctx, args.token);

    // Be forgiving about the two ways people paste their handle: whitespace
    // and a leading "@".
    let username = args.username.trim();
    if (username.startsWith("@")) username = username.slice(1).trim();

    if (username === "") {
      await ctx.db.patch(user._id, {
        githubUsername: undefined,
        updatedAt: Date.now(),
      });
      return { ok: true };
    }

    if (
      username.length > GITHUB_USERNAME_MAX_LENGTH ||
      !GITHUB_USERNAME_REGEX.test(username)
    ) {
      throw new ConvexError(
        "Invalid GitHub username: use letters, numbers, and hyphens only " +
          "(no leading, trailing, or consecutive hyphens; max 39 characters)",
      );
    }

    await ctx.db.patch(user._id, {
      githubUsername: username,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

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

    // Every contribution is a conversation with the AI (ADR-029 P1.5): the
    // report body is the opening "user" turn of the thread.
    await insertThreadMessage(ctx, bugId, "user", body, user._id);

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
    // Triage gate (ADR-029 P1.5): non-buildable items must not enter the build
    // pipeline as-is — the spec body explains the proposed slices ("split") or
    // the decisions a maintainer must make first ("design_needed"). Unset
    // scope means a pre-triage row; treat as buildable for backward compat.
    if (bug.scope !== undefined && bug.scope !== "buildable") {
      throw new ConvexError(
        bug.scope === "split"
          ? "This request is too large for one build — see the spec for the proposed smaller slices"
          : "This request needs maintainer design decisions before it can be built",
      );
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
// Conversation thread (ADR-029 Phase 1.5)
// ============================================================================

/**
 * Post a reply into a contribution's conversation thread. While the item is
 * still in the spec phase (DRAFT/IN_REVIEW), the reply also kicks off a
 * spec-revision round: the routine re-runs with the full thread history and
 * responds to the latest user message via the signed callback.
 */
export const postMessage = mutation({
  args: { token: v.string(), id: v.id("devBugs"), body: v.string() },
  handler: async (ctx, args): Promise<Id<"devBugMessages">> => {
    const user = await requireContributor(ctx, args.token);

    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");

    const body = args.body.trim();
    if (!body) throw new ConvexError("Message body is required");

    const messageId = await insertThreadMessage(
      ctx,
      args.id,
      "user",
      body,
      user._id,
    );

    if (bug.status === "DRAFT" || bug.status === "IN_REVIEW") {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.devAssistant.actions.dispatchSpec,
        { bugId: args.id, revision: true },
      );
    }

    // The conversation list orders by updatedAt — a reply floats the thread.
    await ctx.db.patch(args.id, { updatedAt: Date.now() });

    return messageId;
  },
});

/** Guard shared by confirmStaging/reportStagingIssue: the staging-check window. */
function assertStagingWindow(bug: Doc<"devBugs">): void {
  if (!bug.verifyOnStaging) {
    throw new ConvexError("This item does not require staging verification");
  }
  if (bug.stagingVerifiedAt) {
    throw new ConvexError("This item was already verified on staging");
  }
  if (bug.status !== "CODE_REVIEW" && bug.status !== "READY_TO_MERGE") {
    throw new ConvexError(
      `Staging can only be checked once the PR is up (current status: ${bug.status})`,
    );
  }
}

/**
 * Contributor confirms the change works on staging. Valid only in the staging
 * window (verifyOnStaging set, not yet verified, PR up). Stamps
 * stagingVerifiedAt and logs a system message; if someone other than the
 * originator confirmed, the originator gets a push (matches approveSpec).
 */
export const confirmStaging = mutation({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const user = await requireContributor(ctx, args.token);

    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");
    assertStagingWindow(bug);

    const now = Date.now();
    await ctx.db.patch(args.id, { stagingVerifiedAt: now, updatedAt: now });

    const name =
      `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "A contributor";
    await insertThreadMessage(
      ctx,
      args.id,
      "system",
      `${name} confirmed it works on staging`,
    );

    await notifyOriginatorUnlessSelf(ctx, bug, user._id, {
      title: "Verified on staging",
      body: `${name} confirmed "${bug.title}" works on staging.`,
      status: bug.status,
    });

    return { ok: true };
  },
});

/**
 * Contributor hit a problem while checking staging. Same validity window as
 * confirmStaging. Logs the note as their "user" turn plus a system marker —
 * no automated re-fix dispatch (the spec-revision path only exists for
 * DRAFT/IN_REVIEW, and the item is past that); a maintainer picks it up from
 * the thread.
 */
export const reportStagingIssue = mutation({
  args: { token: v.string(), id: v.id("devBugs"), note: v.string() },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const user = await requireContributor(ctx, args.token);

    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");
    assertStagingWindow(bug);

    const note = args.note.trim();
    if (!note) throw new ConvexError("A note describing the issue is required");

    await insertThreadMessage(ctx, args.id, "user", note, user._id);
    await insertThreadMessage(
      ctx,
      args.id,
      "system",
      "Staging check failed — needs another look",
    );

    await ctx.db.patch(args.id, { updatedAt: Date.now() });

    return { ok: true };
  },
});

// ============================================================================
// Queries
// ============================================================================

/** List-item shape: the devBugs doc plus a preview of the latest thread turn. */
export type ContributionListItem = Doc<"devBugs"> & {
  lastMessageBody: string | undefined;
  lastMessageAuthorType: "user" | "assistant" | "system" | undefined;
};

/** Attach the most recent thread message (indexed .first() per item). */
async function withLastMessage(
  ctx: QueryCtx,
  bugs: Doc<"devBugs">[],
): Promise<ContributionListItem[]> {
  return await Promise.all(
    bugs.map(async (bug) => {
      const last = await ctx.db
        .query("devBugMessages")
        .withIndex("by_bug", (q) => q.eq("bugId", bug._id))
        .order("desc")
        .first();
      return {
        ...bug,
        lastMessageBody: last?.body,
        lastMessageAuthorType: last?.authorType,
      };
    }),
  );
}

/** A contribution's conversation thread, oldest first. */
export const getThread = query({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (ctx, args): Promise<Doc<"devBugMessages">[]> => {
    await requireContributor(ctx, args.token);
    return await ctx.db
      .query("devBugMessages")
      .withIndex("by_bug", (q) => q.eq("bugId", args.id))
      .order("asc")
      .collect();
  },
});

/**
 * The caller's own contributions — ALL sources (dashboard submissions and
 * chat-originated bugs they reported), newest first.
 */
export const myContributions = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<ContributionListItem[]> => {
    const user = await requireContributor(ctx, args.token);
    const bugs = await ctx.db
      .query("devBugs")
      .withIndex("by_originator", (q) => q.eq("originatorUserId", user._id))
      .order("desc")
      .collect();
    return await withLastMessage(ctx, bugs);
  },
});

/** Every contribution across all originators, newest first (capped at 200). */
export const listAll = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<ContributionListItem[]> => {
    await requireContributor(ctx, args.token);
    const bugs = await ctx.db.query("devBugs").order("desc").take(200);
    return await withLastMessage(ctx, bugs);
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
