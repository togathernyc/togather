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
import { getMediaUrl } from "../../lib/utils";

export const contributionKindValidator = v.union(
  v.literal("bug"),
  v.literal("feature"),
);

/** Longest title we derive from a chat-first message before the AI titles it. */
const DERIVED_TITLE_MAX = 80;

/**
 * Turn a free-form message into a one-line placeholder title (chat-first
 * filing has no title field). First non-empty line, trimmed and clipped.
 */
function deriveTitle(body: string): string {
  const firstLine =
    body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? body.trim();
  return firstLine.length > DERIVED_TITLE_MAX
    ? `${firstLine.slice(0, DERIVED_TITLE_MAX - 1).trimEnd()}…`
    : firstLine;
}

/**
 * Attached pictures from the dashboard must be our own R2 uploads. Reject
 * anything that isn't an "r2:" storage path so a caller can't stash an
 * arbitrary external URL that would later be rendered to other maintainers or
 * fetched by the spec routine (a tracking-beacon / SSRF surface).
 */
function assertR2Paths(urls: string[] | undefined): void {
  if (!urls) return;
  for (const url of urls) {
    if (!url.startsWith("r2:")) {
      throw new ConvexError("Attachments must be uploaded images");
    }
  }
}

/**
 * Resolve stored R2 paths ("r2:…") to fetchable public URLs for the client
 * (getMediaUrl passes existing http(s) URLs through unchanged, so it's safe on
 * already-resolved chat-originated attachments too). Undefined stays undefined.
 */
function resolveImageUrls(urls: string[] | undefined): string[] | undefined {
  if (!urls || urls.length === 0) return undefined;
  const resolved = urls
    .map((u) => getMediaUrl(u))
    .filter((u): u is string => !!u);
  return resolved.length > 0 ? resolved : undefined;
}

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

/**
 * Triage gate (ADR-029 P1.5), shared by approveSpec and startBuild:
 * non-buildable items must not enter the build pipeline as-is — the spec body
 * explains the proposed slices ("split") or the decisions a maintainer must
 * make first ("design_needed"). Unset scope means a pre-triage row; treat as
 * buildable for backward compat. Guarding startBuild too matters because a
 * spec revision can re-triage an already-approved item out of "buildable".
 */
function assertBuildableScope(bug: Doc<"devBugs">): void {
  if (bug.scope !== undefined && bug.scope !== "buildable") {
    throw new ConvexError(
      bug.scope === "split"
        ? "This request is too large for one build — see the spec for the proposed smaller slices"
        : "This request needs maintainer design decisions before it can be built",
    );
  }
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
    // Optional: chat-first filing (ADR-029) lets contributors just describe the
    // thing in one message — the title is derived from that message, and the
    // spec agent replaces it with a proper aiTitle. Callers may still pass an
    // explicit title.
    title: v.optional(v.string()),
    body: v.string(),
    repro: v.optional(v.string()),
    // R2 storage paths ("r2:…") for pictures/screenshots attached to the report.
    screenshotUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<Id<"devBugs">> => {
    const user = await requireContributor(ctx, args.token);

    const body = args.body.trim();
    assertR2Paths(args.screenshotUrls);
    const hasImages = !!args.screenshotUrls && args.screenshotUrls.length > 0;
    // A screenshot with no words is a valid report; require one or the other.
    if (!body && !hasImages) {
      throw new ConvexError("Add a description or a screenshot");
    }
    // Derive a title from the message when the caller didn't supply one — the
    // list shows this until the spec agent's aiTitle lands. Image-only reports
    // fall back to a generic headline.
    const title =
      args.title?.trim() ||
      (body ? deriveTitle(body) : args.kind === "feature" ? "Feature idea" : "Bug report");

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
    // report body is the opening "user" turn of the thread. The repro rides
    // along so it's visible in the conversation UI (the thread only renders
    // messages, not the row's repro field). Attached pictures ride on the
    // message so they render inline in the conversation.
    const openingTurn = args.repro
      ? `${body}\n\nHow to see it: ${args.repro}`
      : body;
    await insertThreadMessage(
      ctx,
      bugId,
      "user",
      openingTurn,
      user._id,
      args.screenshotUrls,
    );

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
    assertBuildableScope(bug);

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
    // Same scope gate as approveSpec: a spec revision may have re-triaged an
    // already-approved item out of "buildable" after the approval landed.
    assertBuildableScope(bug);

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

/**
 * Archive/unarchive is originator-only (plus staff/superuser, who can tidy the
 * shared board). Everyone can read every thread, but only the person who
 * started it — or staff — sets it aside.
 */
function assertCanArchive(user: Doc<"users">, bug: Doc<"devBugs">): void {
  const isOwner = bug.originatorUserId === user._id;
  if (!isOwner && !user.isStaff && !user.isSuperuser) {
    throw new ConvexError("Only the person who started this can archive it");
  }
}

/**
 * Set a conversation aside — the contributor abandoned it, or its scope was
 * judged not doable. Orthogonal to the pipeline status; archived items leave
 * the active dashboard tabs. Idempotent (re-archiving keeps the first stamp).
 */
export const archive = mutation({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const user = await requireContributor(ctx, args.token);
    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");
    assertCanArchive(user, bug);

    const now = Date.now();
    if (!bug.archivedAt) {
      await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });
      await insertThreadMessage(
        ctx,
        args.id,
        "system",
        "Conversation archived — set aside by the contributor.",
      );
    }
    return { ok: true };
  },
});

/** Restore an archived conversation back into the active dashboard. */
export const unarchive = mutation({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const user = await requireContributor(ctx, args.token);
    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");
    assertCanArchive(user, bug);

    if (bug.archivedAt) {
      const now = Date.now();
      await ctx.db.patch(args.id, { archivedAt: undefined, updatedAt: now });
      await insertThreadMessage(ctx, args.id, "system", "Conversation restored.");
    }
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
  args: {
    token: v.string(),
    id: v.id("devBugs"),
    body: v.string(),
    // R2 storage paths for pictures attached to this reply (optional).
    imageUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<Id<"devBugMessages">> => {
    const user = await requireContributor(ctx, args.token);

    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");

    const body = args.body.trim();
    assertR2Paths(args.imageUrls);
    const hasImages = !!args.imageUrls && args.imageUrls.length > 0;
    // A picture with no words is a valid message; require text only otherwise.
    if (!body && !hasImages) {
      throw new ConvexError("Message body is required");
    }

    const messageId = await insertThreadMessage(
      ctx,
      args.id,
      "user",
      body,
      user._id,
      args.imageUrls,
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

    // Policy auto-merge (ADR-029 Phase 3): staging sign-off may have been the
    // last unsatisfied merge gate. Schedule the attempt — the action re-reads
    // the bug and re-checks every gate itself, so this is always safe.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.actions.attemptAutoMerge,
      { bugId: args.id },
    );

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
  handler: async (
    ctx,
    args,
  ): Promise<(Doc<"devBugMessages"> & { imageUrls?: string[] })[]> => {
    await requireContributor(ctx, args.token);
    const messages = await ctx.db
      .query("devBugMessages")
      .withIndex("by_bug", (q) => q.eq("bugId", args.id))
      .order("asc")
      .collect();
    // Resolve stored R2 paths to public URLs the app can render.
    return messages.map((m) => ({
      ...m,
      imageUrls: resolveImageUrls(m.imageUrls),
    }));
  },
});

/**
 * The caller's own contributions — ALL sources (dashboard submissions and
 * chat-originated bugs they reported), newest first (capped at 200, matching
 * listAll, so a prolific reporter can't make the query unbounded).
 */
export const myContributions = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<ContributionListItem[]> => {
    const user = await requireContributor(ctx, args.token);
    const bugs = await ctx.db
      .query("devBugs")
      .withIndex("by_originator", (q) => q.eq("originatorUserId", user._id))
      .order("desc")
      .take(200);
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
