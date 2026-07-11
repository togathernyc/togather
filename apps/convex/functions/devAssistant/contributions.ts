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

/** "First Last" for thread/system messages, with a role-appropriate fallback. */
function displayName(user: Doc<"users">, fallback: string): string {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || fallback;
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
    assertNotArchived(bug);
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
    assertNotArchived(bug);
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
 * Archiving means "set aside / not doable", so the pipeline is paused: no
 * approving, building, or AI work on an archived item until it's restored.
 */
function assertNotArchived(bug: Doc<"devBugs">): void {
  if (bug.archivedAt) {
    throw new ConvexError("Restore this conversation before continuing it");
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

    // An archived item is paused: record the note but don't re-fire the spec
    // agent (no AI work / cost until it's restored).
    if (
      !bug.archivedAt &&
      (bug.status === "DRAFT" || bug.status === "IN_REVIEW")
    ) {
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

/**
 * Guard shared by confirmStaging/reportStagingIssue: the staging-check window.
 * Nothing reaches staging until the PR is merged to `main` (deploys auto-run on
 * merge), so the window opens at MERGED — not while the PR is still open. The
 * change is then live on staging and awaiting the contributor's try-it, which
 * in turn gates the manual production deploy (ADR-029).
 */
function assertStagingWindow(bug: Doc<"devBugs">): void {
  if (!bug.verifyOnStaging) {
    throw new ConvexError("This item does not require staging verification");
  }
  if (bug.stagingVerifiedAt) {
    throw new ConvexError("This item was already verified on staging");
  }
  if (bug.status !== "MERGED") {
    throw new ConvexError(
      `Staging can only be checked once the change is merged and live on staging (current status: ${bug.status})`,
    );
  }
}

/**
 * Contributor confirms the change works on staging. Valid only in the staging
 * window (verifyOnStaging set, not yet verified, already merged and live on
 * staging). Stamps stagingVerifiedAt and logs a system message; if someone
 * other than the originator confirmed, the originator gets a push (matches
 * approveSpec). The change is already merged, so there is nothing to merge
 * here — the sign-off marks the item ready for a maintainer's manual
 * production deploy (ADR-029).
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

    const name = displayName(user, "A contributor");
    await insertThreadMessage(
      ctx,
      args.id,
      "system",
      `${name} confirmed it works on staging — ready for a maintainer to deploy to production`,
    );

    await notifyOriginatorUnlessSelf(ctx, bug, user._id, {
      title: "Verified on staging 🎉",
      body: `${name} confirmed "${bug.title}" works on staging — a maintainer will ship it to production.`,
      status: bug.status,
    });

    return { ok: true };
  },
});

/**
 * Contributor hit a problem while checking staging. Same validity window as
 * confirmStaging. Logs the note as their "user" turn, then sends the item
 * BACK THROUGH THE PIPELINE (the staging-redo loop): the review-cycle state
 * is reset and the MERGED -> READY_FOR_IMPL transition dispatches a fresh
 * implement run in redo mode — it carries the conversation thread (the note
 * is the latest user turn) and opens a NEW PR against latest main, since the
 * original PR is already merged. The re-merge reopens the staging window
 * (verifyOnStaging stays set, stagingVerifiedAt stays unset).
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
      "Staging check failed — sending it back to the AI to fix",
    );

    // Reset the previous round's pipeline state so the redo starts clean:
    // the merged PR is history (a redo opens a new one), the old verdict and
    // fix-round budget belong to that PR, and clearing routineRunId orphans
    // any stale callbacks from finished runs while the redo dispatch stamps
    // a fresh id. The PERSISTED redoRounds counter is what makes this a redo:
    // dispatchBug infers redo mode from it (so retryDispatch keeps the redo
    // context) and chat idempotency keys are scoped per round.
    await ctx.db.patch(args.id, {
      prUrl: undefined,
      reviewVerdict: undefined,
      reviewSummary: undefined,
      fixRounds: 0,
      redoRounds: (bug.redoRounds ?? 0) + 1,
      routineRunId: undefined,
      activeRunMode: undefined,
      lastError: undefined,
      updatedAt: Date.now(),
    });

    const fresh = await ctx.db.get(args.id);
    if (fresh) {
      // MERGED -> READY_FOR_IMPL schedules the redo dispatch.
      await applyStatusTransition(ctx, fresh, "READY_FOR_IMPL");
    }

    await notifyOriginatorUnlessSelf(ctx, bug, user._id, {
      title: "Back to the shop",
      body: `"${bug.title}" didn't pass the staging check — the AI is working on a fix.`,
      status: "READY_FOR_IMPL",
    });

    return { ok: true };
  },
});

/**
 * Merge the change from the app (ADR-029 follow-up): any dev maintainer can
 * merge once the AI review approved the PR, instead of going to GitHub. The
 * actual GitHub merge happens in an action (actions.mergeFromApp), which
 * re-checks every gate itself and reports the outcome into the thread; the
 * MERGED transition lands through the same trusted callback path as policy
 * auto-merge.
 */
export const mergeNow = mutation({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const user = await requireContributor(ctx, args.token);

    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");
    assertNotArchived(bug);
    if (bug.status !== "READY_TO_MERGE") {
      throw new ConvexError(
        `This item isn't ready to merge (current status: ${bug.status})`,
      );
    }
    if (bug.reviewVerdict !== "approved") {
      throw new ConvexError("Code review hasn't approved this change yet");
    }
    if (!bug.prUrl) {
      throw new ConvexError("This item has no pull request to merge");
    }
    // Server-side in-flight latch: hides the merge card for EVERY viewer
    // (not just the tapping device) and blocks a concurrent second merge.
    // mergeFromApp's failure path clears it so "try again" works.
    if (bug.mergeRequestedAt) {
      throw new ConvexError("A merge is already in flight for this item");
    }

    const name = displayName(user, "A maintainer");
    await insertThreadMessage(
      ctx,
      args.id,
      "system",
      `${name} asked to merge this from the app — merging…`,
    );
    await ctx.db.patch(args.id, {
      mergeRequestedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.actions.mergeFromApp,
      { bugId: args.id },
    );

    return { ok: true };
  },
});

/**
 * The production trigger acts as a COOLDOWN, not a one-shot: a 204 from
 * workflow_dispatch only means "queued", and the workflow run itself can
 * still fail on GitHub with no callback to clear the latch. After the
 * cooldown the button returns so a maintainer can re-trigger from the app
 * instead of being stranded at "deploy triggered" forever. The mobile card
 * mirrors this constant.
 */
export const PRODUCTION_RETRIGGER_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Ship the merged, staging-verified change to production from the app.
 * Always a SILENT OTA — users pick the update up on their next app open, no
 * forced reload; anything needing a forced update still goes through the
 * GitHub workflow UI by hand. Triggers the existing deploy-to-production.yml
 * workflow, which ships everything currently on `main` (i.e. staging), not
 * just this one item.
 *
 * Staging gate: an explicit sign-off (stagingVerifiedAt) is required unless
 * the AI triaged the item as non-interactive (verifyOnStaging === false).
 * Legacy rows with verifyOnStaging UNSET don't qualify — they predate this
 * feature and are usually long since shipped, so they must not grow a live
 * "Ship to production" button retroactively.
 */
export const promoteToProduction = mutation({
  args: { token: v.string(), id: v.id("devBugs") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const user = await requireContributor(ctx, args.token);

    const bug = await ctx.db.get(args.id);
    if (!bug) throw new ConvexError("Contribution not found");
    assertNotArchived(bug);
    if (bug.status !== "MERGED") {
      throw new ConvexError(
        `Only merged changes can ship to production (current status: ${bug.status})`,
      );
    }
    if (bug.verifyOnStaging !== false && !bug.stagingVerifiedAt) {
      throw new ConvexError(
        "Confirm the change works on staging before shipping it to production",
      );
    }
    const now = Date.now();
    if (
      bug.productionRequestedAt &&
      now - bug.productionRequestedAt < PRODUCTION_RETRIGGER_COOLDOWN_MS
    ) {
      throw new ConvexError(
        "A production deploy was already triggered for this item — give it a few minutes",
      );
    }

    await ctx.db.patch(args.id, {
      productionRequestedAt: now,
      updatedAt: now,
    });

    const name = displayName(user, "A maintainer");
    await insertThreadMessage(
      ctx,
      args.id,
      "system",
      `${name} triggered the production deploy (silent update)`,
    );

    await ctx.scheduler.runAfter(
      0,
      internal.functions.devAssistant.actions.dispatchProductionDeploy,
      { bugId: args.id },
    );

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
  /** Who started the conversation — the "Everyone" view shows this. */
  originatorName: string | undefined;
};

/** Display name for a user id, or undefined when unknown/empty. */
async function originatorDisplayName(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<string | undefined> {
  const user = await ctx.db.get(userId);
  if (!user) return undefined;
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined;
}

/**
 * Attach the most recent thread message (indexed .first() per item) and the
 * originator's display name (resolved once per distinct user).
 */
async function withLastMessage(
  ctx: QueryCtx,
  bugs: Doc<"devBugs">[],
): Promise<ContributionListItem[]> {
  const distinctIds = [...new Set(bugs.map((b) => b.originatorUserId))];
  const names = new Map<Id<"users">, string | undefined>(
    await Promise.all(
      distinctIds.map(
        async (id) =>
          [id, await originatorDisplayName(ctx, id)] as const,
      ),
    ),
  );
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
        originatorName: names.get(bug.originatorUserId),
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
  handler: async (
    ctx,
    args,
  ): Promise<(Doc<"devBugs"> & { originatorName?: string }) | null> => {
    await requireContributor(ctx, args.token);
    const bug = await ctx.db.get(args.id);
    if (!bug) return null;
    return {
      ...bug,
      originatorName: await originatorDisplayName(ctx, bug.originatorUserId),
    };
  },
});
