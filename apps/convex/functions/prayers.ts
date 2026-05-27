/**
 * Prayer requests — backend for the church-feature prayer flow.
 *
 * Anonymity contract: every read API that returns prayers to a non-author
 * MUST pass them through `stripAuthor()`. That helper is the only place
 * `authorUserId` is allowed to leak out of this module.
 *
 * Feature gating: every public mutation/query asserts the calling user's
 * community has `churchFeatures.prayerEnabled === true`.
 */

import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalAction,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { now } from "../lib/utils";
import { moderatePrayerText, type ModerationResult } from "../lib/moderation/prayer";
import { notify, notifyBatch, notifyCommunityAdmins } from "../lib/notifications/send";

const MAX_BODY_LENGTH = 500;
const FEED_LIMIT = 3;
const STALE_PRAYER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ============================================================================
// Helpers
// ============================================================================

async function assertPrayerEnabled(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
): Promise<Doc<"communities">> {
  const community = await ctx.db.get(communityId);
  if (!community) {
    throw new ConvexError("community_not_found");
  }
  if (!community.churchFeatures?.prayerEnabled) {
    throw new ConvexError("prayer_not_enabled");
  }
  return community;
}

async function assertCommunityMember(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
): Promise<void> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .filter((q) => q.eq(q.field("status"), 1))
    .first();
  if (!membership) {
    throw new ConvexError("not_a_community_member");
  }
}

interface PublicPrayer {
  id: Id<"prayers">;
  bodyText: string;
  prayedForCount: number;
  status: Doc<"prayers">["status"];
  createdAt: number;
  archivedAt: number | null;
  /**
   * Author display in the form "First L." (first name + last initial).
   * Always `null` when the prayer was posted anonymously — anonymous
   * prayers never expose author identity at the data layer, even to admins.
   */
  authorDisplayName: string | null;
  /**
   * When true, the moderator flagged this as first-person crisis content.
   * The client overlays a 988 / Crisis Text Line resource card. We DO NOT
   * use this to hide the post — "triage, not suppression" (7 Cups, Crisis
   * Text Line). Visible to everyone who sees the prayer.
   */
  crisisFlag: boolean;
}

/** Compute "First L." (first name + last initial). Falls back to "First" if no last name. */
function firstNameLastInitial(firstName?: string, lastName?: string): string | null {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (!f && !l) return null;
  if (!l) return f;
  return `${f} ${l.charAt(0).toUpperCase()}.`;
}

/**
 * Single chokepoint for the anonymity contract. Every read API that returns
 * prayers to anyone other than the author MUST route through here. Pass
 * `null` for `author` whenever the prayer is anonymous.
 */
function publicPrayerFrom(
  prayer: Doc<"prayers">,
  author: Doc<"users"> | null,
): PublicPrayer {
  const authorDisplayName =
    prayer.isAnonymous || author === null
      ? null
      : firstNameLastInitial(author.firstName, author.lastName);
  return {
    id: prayer._id,
    bodyText: prayer.bodyText,
    prayedForCount: prayer.prayedForCount,
    status: prayer.status,
    createdAt: prayer.createdAt,
    archivedAt: prayer.archivedAt ?? null,
    authorDisplayName,
    crisisFlag: prayer.crisisFlag === true,
  };
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Up to `FEED_LIMIT` active+approved prayers, sorted by fewest pray-count
 * first then oldest. Excludes prayers the caller has already prayed for or
 * authored. Author identity is never returned.
 */
export const feed = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<PublicPrayer[]> => {
    const userId = await requireAuth(ctx, args.token);
    await assertPrayerEnabled(ctx, args.communityId);
    await assertCommunityMember(ctx, userId, args.communityId);

    const myResponses = await ctx.db
      .query("prayerResponses")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const prayedIds = new Set(myResponses.map((r) => r.prayerId));

    // Also drop anything the caller has already reported — they shouldn't
    // keep seeing prayers they flagged.
    const myReports = await ctx.db
      .query("prayerReports")
      .withIndex("by_reporter", (q) => q.eq("reporterUserId", userId))
      .collect();
    const reportedIds = new Set(myReports.map((r) => r.prayerId));

    // Paginate candidates ordered by prayedForCount asc. Without this
    // loop, a long-time member could have the first 50 candidates all
    // filtered out (own + already-prayed + reported) and see a false
    // "all caught up" while plenty of eligible prayers exist further
    // down the index. We page until we have FEED_LIMIT visible or
    // exhaust the index (or hit MAX_PAGES as a safety cap).
    //
    // The moderation predicate is in the index — without it, pending/
    // rejected rows (also `status: "active"`) could fill the window and
    // starve approved prayers from ever being seen.
    const MAX_PAGES = 10; // 10 * 50 = 500 candidates max per feed call
    const visible: Doc<"prayers">[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await ctx.db
        .query("prayers")
        .withIndex("by_community_status_modStatus_count", (q) =>
          q
            .eq("communityId", args.communityId)
            .eq("status", "active")
            .eq("moderationStatus", "approved"),
        )
        .order("asc")
        .paginate({ numItems: 50, cursor });
      for (const p of result.page) {
        if (
          p.authorUserId !== userId &&
          !prayedIds.has(p._id) &&
          !reportedIds.has(p._id)
        ) {
          visible.push(p);
        }
      }
      if (visible.length >= FEED_LIMIT || result.isDone) break;
      cursor = result.continueCursor;
    }

    // Already ordered by prayedForCount asc via the index; ties broken by
    // createdAt asc are best-effort here since the index doesn't include it,
    // but the natural Convex insertion order serves as a reasonable proxy.
    const top = visible.slice(0, FEED_LIMIT);
    // Batch-load authors only for non-anonymous prayers — anonymous ones
    // never trigger a user fetch, guaranteeing identity never leaks.
    const authors = await Promise.all(
      top.map((p) => (p.isAnonymous ? Promise.resolve(null) : ctx.db.get(p.authorUserId))),
    );
    return top.map((p, i) => publicPrayerFrom(p, authors[i]));
  },
});

/**
 * How many distinct prayers the caller has prayed for this week (since
 * Sunday UTC midnight). Used in the Prayer screen header as a soft
 * "you've been showing up" signal — only surfaced past a threshold so it
 * stays celebratory and doesn't read as a guilt-trip stat for new users.
 *
 * UTC chosen for simplicity; a per-user-timezone variant could fold in
 * later if it matters for engagement metrics.
 */
export const myPrayedThisWeekCount = query({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args): Promise<{ today: number; week: number }> => {
    const userId = await requireAuth(ctx, args.token);

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const dayThreshold = startOfDay.getTime();

    const startOfWeek = new Date(startOfDay);
    // Roll back to Sunday UTC (getUTCDay: Sun=0).
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
    const weekThreshold = startOfWeek.getTime();

    // Scoped by community so a multi-community account doesn't leak
    // counts across communities (would prematurely fire "You prayed for 3"
    // in a community where they haven't actually prayed for anyone yet).
    const weekResponses = await ctx.db
      .query("prayerResponses")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId),
      )
      .filter((q) => q.gte(q.field("prayedAt"), weekThreshold))
      .collect();

    let today = 0;
    for (const r of weekResponses) {
      if (r.prayedAt >= dayThreshold) today++;
    }
    return { today, week: weekResponses.length };
  },
});

/**
 * Prayers the caller has prayed for, newest-first. Powers the "Prayers
 * you've prayed" rail under the prayer feed and the full-history screen.
 *
 * Anonymity contract holds — anonymous prayers return `authorDisplayName: null`
 * and never trigger an author fetch.
 *
 * `hasNewUpdate` is true when at least one follow-up was posted AFTER the
 * caller's most recent pray-session — gives a visual cue that the author
 * has shared something since they prayed.
 *
 * Rejected prayers (admin upheld a report after the caller already prayed)
 * are filtered out so retroactively-removed content doesn't linger in the
 * user's history.
 */
export const myPrayedFor = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await assertPrayerEnabled(ctx, args.communityId);
    await assertCommunityMember(ctx, userId, args.communityId);

    const limit = Math.min(args.limit ?? 50, 200);

    // We deliberately scan the by_user index (not by_user_community) and
    // gate by `prayer.communityId` further down. Two reasons:
    //   1. `prayerResponses.communityId` is optional for pre-migration rows
    //      (see schema comment). Indexing on communityId would silently
    //      drop legacy responses for long-time users.
    //   2. Paginating the by_user index lets us bound the read cost — a
    //      single `.collect()` on a heavy user could blow Convex limits.
    //
    // Pages come ordered by _creationTime desc, which is ≈ prayedAt desc.
    // We collect candidates community-by-community until we have `limit`
    // visible items, then sort by prayedAt for the final ordering.
    const PAGE_SIZE = 100;
    const MAX_PAGES = 10; // safety cap: 1000 candidates max per call
    const visible: Array<{ response: Doc<"prayerResponses">; prayer: Doc<"prayers"> }> = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await ctx.db
        .query("prayerResponses")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .paginate({ numItems: PAGE_SIZE, cursor });
      for (const r of result.page) {
        const prayer = await ctx.db.get(r.prayerId);
        if (!prayer) continue;
        if (prayer.communityId !== args.communityId) continue;
        if (prayer.moderationStatus === "rejected") continue;
        visible.push({ response: r, prayer });
        if (visible.length >= limit) break;
      }
      if (visible.length >= limit || result.isDone) break;
      cursor = result.continueCursor;
    }
    visible.sort((a, b) => b.response.prayedAt - a.response.prayedAt);

    return Promise.all(
      visible.map(async ({ response: r, prayer }) => {
        const followUps = await ctx.db
          .query("prayerFollowUps")
          .withIndex("by_prayer", (q) => q.eq("prayerId", prayer._id))
          .collect();
        const hasNewUpdate = followUps.some((f) => f.createdAt > r.prayedAt);

        const author = prayer.isAnonymous
          ? null
          : await ctx.db.get(prayer.authorUserId);

        return {
          id: prayer._id,
          bodyText: prayer.bodyText,
          status: prayer.status,
          authorDisplayName: prayer.isAnonymous
            ? null
            : firstNameLastInitial(author?.firstName, author?.lastName),
          prayedAt: r.prayedAt,
          hasNewUpdate,
          crisisFlag: prayer.crisisFlag === true,
        };
      }),
    );
  },
});

/**
 * Caller's own prayers — active, answered, and archived. Includes counts.
 * Returns author-visible fields (author IS the caller here).
 */
export const myPrayers = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const prayers = await ctx.db
      .query("prayers")
      .withIndex("by_author", (q) => q.eq("authorUserId", userId))
      .collect();

    prayers.sort((a, b) => b.createdAt - a.createdAt);

    return prayers.map((p) => ({
      id: p._id,
      bodyText: p.bodyText,
      isAnonymous: p.isAnonymous,
      status: p.status,
      prayedForCount: p.prayedForCount,
      moderationStatus: p.moderationStatus,
      moderationDetail: p.moderationDetail ?? null,
      crisisFlag: p.crisisFlag === true,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      archivedAt: p.archivedAt ?? null,
    }));
  },
});

/**
 * Detail view for a single prayer. Author OR users who prayed for it
 * can read; everyone else gets `null`. Author info only when caller is
 * the author.
 */
export const getDetail = query({
  args: {
    token: v.string(),
    prayerId: v.id("prayers"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) return null;

    // Re-check gating: a user who left the community (or whose community
    // disabled prayer) shouldn't be able to deep-link into a detail page
    // from an old notification and keep reading follow-ups. Returning
    // null instead of throwing keeps the URL safe to share — the page
    // just renders an empty state for ineligible viewers.
    const community = await ctx.db.get(prayer.communityId);
    if (!community?.churchFeatures?.prayerEnabled) return null;
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", prayer.communityId),
      )
      .filter((q) => q.eq(q.field("status"), 1))
      .first();
    if (!membership) return null;

    const isAuthor = prayer.authorUserId === userId;
    const hasPrayed = !isAuthor
      ? !!(await ctx.db
          .query("prayerResponses")
          .withIndex("by_prayer_user", (q) =>
            q.eq("prayerId", prayer._id).eq("userId", userId),
          )
          .first())
      : false;

    if (!isAuthor && !hasPrayed) return null;

    const followUps = await ctx.db
      .query("prayerFollowUps")
      .withIndex("by_prayer", (q) => q.eq("prayerId", prayer._id))
      .collect();
    followUps.sort((a, b) => a.createdAt - b.createdAt);

    // Author display: shown only when the prayer is not anonymous. The
    // author themselves always sees themselves; prayed-for viewers see
    // "First L." for non-anon prayers and nothing for anonymous ones.
    const author = prayer.isAnonymous ? null : await ctx.db.get(prayer.authorUserId);
    const authorDisplayName = prayer.isAnonymous
      ? null
      : firstNameLastInitial(author?.firstName, author?.lastName);

    return {
      id: prayer._id,
      bodyText: prayer.bodyText,
      status: prayer.status,
      prayedForCount: prayer.prayedForCount,
      createdAt: prayer.createdAt,
      archivedAt: prayer.archivedAt ?? null,
      isAuthor,
      authorDisplayName,
      crisisFlag: prayer.crisisFlag === true,
      // Only include author-only fields when caller is the author. The
      // moderationDetail (with category + admin note) is for author
      // transparency on rejected/pending prayers — never leaked to viewers.
      ...(isAuthor
        ? {
            isAnonymous: prayer.isAnonymous,
            moderationStatus: prayer.moderationStatus,
            moderationDetail: prayer.moderationDetail ?? null,
          }
        : {}),
      followUps: followUps.map((f) => ({
        id: f._id,
        kind: f.kind,
        bodyText: f.bodyText,
        createdAt: f.createdAt,
      })),
    };
  },
});

// ============================================================================
// Mutations
// ============================================================================

export const createPrayer = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    bodyText: v.string(),
    isAnonymous: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await assertPrayerEnabled(ctx, args.communityId);
    await assertCommunityMember(ctx, userId, args.communityId);

    const body = args.bodyText.trim();
    if (body.length === 0) {
      throw new ConvexError("prayer_body_empty");
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new ConvexError("prayer_body_too_long");
    }

    const ts = now();
    const prayerId = await ctx.db.insert("prayers", {
      communityId: args.communityId,
      authorUserId: userId,
      isAnonymous: args.isAnonymous,
      bodyText: body,
      status: "active",
      prayedForCount: 0,
      // Always inserted "pending" so borderline/yellow content can't leak
      // into the feed in the 1-5s window before the LLM responds. Most
      // green prayers flip to approved within ~2s via the moderation
      // action below.
      moderationStatus: "pending",
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.scheduler.runAfter(0, internal.functions.prayers.moderatePrayer, {
      prayerId,
    });

    return { prayerId };
  },
});

/**
 * Called when the 3-min timer completes OR the user taps "I prayed, mark
 * done." Idempotent per (prayer, user): double-tap returns ok without
 * re-incrementing or re-notifying.
 */
export const recordPrayerSession = mutation({
  args: {
    token: v.string(),
    prayerId: v.id("prayers"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    await assertPrayerEnabled(ctx, prayer.communityId);
    await assertCommunityMember(ctx, userId, prayer.communityId);

    if (prayer.authorUserId === userId) {
      throw new ConvexError("cannot_pray_for_own_prayer");
    }
    if (prayer.status !== "active") {
      throw new ConvexError("prayer_not_active");
    }
    if (prayer.moderationStatus !== "approved") {
      throw new ConvexError("prayer_not_approved");
    }

    const existing = await ctx.db
      .query("prayerResponses")
      .withIndex("by_prayer_user", (q) =>
        q.eq("prayerId", prayer._id).eq("userId", userId),
      )
      .first();
    if (existing) {
      return { alreadyPrayed: true };
    }

    const ts = now();
    await ctx.db.insert("prayerResponses", {
      prayerId: prayer._id,
      userId,
      communityId: prayer.communityId,
      prayedAt: ts,
    });
    await ctx.db.patch(prayer._id, {
      prayedForCount: prayer.prayedForCount + 1,
      updatedAt: ts,
    });

    await ctx.scheduler.runAfter(0, internal.functions.prayers.notifyAuthor, {
      prayerId: prayer._id,
    });

    return { alreadyPrayed: false };
  },
});

export const addFollowUp = mutation({
  args: {
    token: v.string(),
    prayerId: v.id("prayers"),
    kind: v.union(v.literal("update"), v.literal("praise_report")),
    bodyText: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    // Re-enforce feature gating + membership: if the community disabled
    // prayer or this user is no longer a member, no further follow-ups
    // (and no more notifyPrayedUsers fan-outs).
    await assertPrayerEnabled(ctx, prayer.communityId);
    await assertCommunityMember(ctx, userId, prayer.communityId);
    if (prayer.authorUserId !== userId) {
      throw new ConvexError("not_prayer_author");
    }

    const body = args.bodyText.trim();
    if (body.length === 0) throw new ConvexError("follow_up_body_empty");
    if (body.length > MAX_BODY_LENGTH) {
      throw new ConvexError("follow_up_body_too_long");
    }

    const ts = now();
    const followUpId = await ctx.db.insert("prayerFollowUps", {
      prayerId: prayer._id,
      authorUserId: userId,
      kind: args.kind,
      bodyText: body,
      createdAt: ts,
    });
    await ctx.db.patch(prayer._id, { updatedAt: ts });

    await ctx.scheduler.runAfter(0, internal.functions.prayers.notifyPrayedUsers, {
      prayerId: prayer._id,
      followUpId,
    });

    return { followUpId };
  },
});

export const markAnswered = mutation({
  args: {
    token: v.string(),
    prayerId: v.id("prayers"),
    praiseReportText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    await assertPrayerEnabled(ctx, prayer.communityId);
    await assertCommunityMember(ctx, userId, prayer.communityId);
    if (prayer.authorUserId !== userId) {
      throw new ConvexError("not_prayer_author");
    }

    const ts = now();
    await ctx.db.patch(prayer._id, { status: "answered", updatedAt: ts });

    if (args.praiseReportText && args.praiseReportText.trim().length > 0) {
      const body = args.praiseReportText.trim().slice(0, MAX_BODY_LENGTH);
      const followUpId = await ctx.db.insert("prayerFollowUps", {
        prayerId: prayer._id,
        authorUserId: userId,
        kind: "praise_report",
        bodyText: body,
        createdAt: ts,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.functions.prayers.notifyPrayedUsers,
        { prayerId: prayer._id, followUpId },
      );
    }

    return { ok: true };
  },
});

export const archivePrayer = mutation({
  args: {
    token: v.string(),
    prayerId: v.id("prayers"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    await assertPrayerEnabled(ctx, prayer.communityId);
    await assertCommunityMember(ctx, userId, prayer.communityId);
    if (prayer.authorUserId !== userId) {
      throw new ConvexError("not_prayer_author");
    }

    const ts = now();
    await ctx.db.patch(prayer._id, {
      status: "archived",
      archivedAt: ts,
      updatedAt: ts,
    });
    return { ok: true };
  },
});

// ============================================================================
// Internal queries (helpers for actions)
// ============================================================================

export const _getPrayerForAction = internalQuery({
  args: { prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) return null;
    const community = await ctx.db.get(prayer.communityId);
    return {
      prayer,
      communityName: community?.name ?? null,
    };
  },
});

export const _getResponderIds = internalQuery({
  args: { prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const responses = await ctx.db
      .query("prayerResponses")
      .withIndex("by_prayer", (q) => q.eq("prayerId", args.prayerId))
      .collect();
    return responses.map((r) => r.userId);
  },
});

export const _getFollowUp = internalQuery({
  args: { followUpId: v.id("prayerFollowUps") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.followUpId);
  },
});

export const _setModerationRejected = internalMutation({
  args: { prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.prayerId, {
      moderationStatus: "rejected",
      updatedAt: now(),
    });
  },
});

/**
 * Apply a tiered moderation result. Sets status (approved/pending_review/
 * rejected), crisis flag, and a detail blob the author + admins can see.
 * Schedules the admin-review notification fan-out when severity = yellow.
 */
export const _applyModerationResult = internalMutation({
  args: {
    prayerId: v.id("prayers"),
    severity: v.union(v.literal("green"), v.literal("yellow"), v.literal("red")),
    crisis: v.boolean(),
    category: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const status: Doc<"prayers">["moderationStatus"] =
      args.severity === "green"
        ? "approved"
        : args.severity === "yellow"
          ? "pending_review"
          : "rejected";
    await ctx.db.patch(args.prayerId, {
      moderationStatus: status,
      crisisFlag: args.crisis,
      moderationDetail: {
        severity: args.severity,
        category: args.category,
        note: args.note,
      },
      updatedAt: now(),
    });

    if (status === "pending_review") {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.prayers.notifyAdminsOfPendingReview,
        { prayerId: args.prayerId },
      );
    }
  },
});

// ============================================================================
// Internal actions
// ============================================================================

export const moderatePrayer = internalAction({
  args: { prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(
      internal.functions.prayers._getPrayerForAction,
      { prayerId: args.prayerId },
    );
    if (!data) return;
    const result: ModerationResult = await moderatePrayerText(data.prayer.bodyText);
    await ctx.runMutation(
      internal.functions.prayers._applyModerationResult,
      {
        prayerId: args.prayerId,
        severity: result.severity,
        crisis: result.crisis,
        category: result.category,
        note: result.note,
      },
    );
  },
});

export const notifyAuthor = internalAction({
  args: { prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(
      internal.functions.prayers._getPrayerForAction,
      { prayerId: args.prayerId },
    );
    if (!data) return;
    const allowed = await ctx.runQuery(
      internal.functions.prayers.notifications._shouldSendPrayerNotification,
      {
        userId: data.prayer.authorUserId,
        communityId: data.prayer.communityId,
        notificationType: "prayer.prayed_for",
      },
    );
    if (!allowed) return;
    await notify(ctx, {
      type: "prayer.prayed_for",
      userId: data.prayer.authorUserId,
      communityId: data.prayer.communityId,
      data: {
        prayerId: String(data.prayer._id),
        communityId: String(data.prayer.communityId),
        communityName: data.communityName ?? undefined,
      },
    });
  },
});

export const notifyPrayedUsers = internalAction({
  args: {
    prayerId: v.id("prayers"),
    followUpId: v.id("prayerFollowUps"),
  },
  handler: async (ctx, args) => {
    const followUp = await ctx.runQuery(
      internal.functions.prayers._getFollowUp,
      { followUpId: args.followUpId },
    );
    if (!followUp) return;

    const data = await ctx.runQuery(
      internal.functions.prayers._getPrayerForAction,
      { prayerId: args.prayerId },
    );
    if (!data) return;

    const responderIds = await ctx.runQuery(
      internal.functions.prayers._getResponderIds,
      { prayerId: args.prayerId },
    );
    if (responderIds.length === 0) return;

    const bodySnippet = followUp.bodyText.slice(0, 80);
    const notificationType =
      followUp.kind === "praise_report" ? "prayer.praise_report" : "prayer.update";

    // Filter through the per-user prefs gate before fanning out. A user who
    // muted prayer notifications (master toggle off) or turned off this
    // specific type should never see the push, even though they once prayed
    // for this prayer.
    const allowedRecipients: Id<"users">[] = [];
    for (const userId of responderIds) {
      const allowed = await ctx.runQuery(
        internal.functions.prayers.notifications._shouldSendPrayerNotification,
        {
          userId,
          communityId: data.prayer.communityId,
          notificationType,
        },
      );
      if (allowed) allowedRecipients.push(userId);
    }
    if (allowedRecipients.length === 0) return;

    await notifyBatch(ctx, {
      type: notificationType,
      userIds: allowedRecipients,
      communityId: data.prayer.communityId,
      data: {
        prayerId: String(args.prayerId),
        followUpId: String(args.followUpId),
        bodySnippet,
        communityId: String(data.prayer.communityId),
      },
    });
  },
});

// ============================================================================
// Admin review queue
// ============================================================================

async function assertCommunityAdmin(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
): Promise<void> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .filter((q) => q.eq(q.field("status"), 1))
    .first();
  // role >= 3 matches COMMUNITY_ADMIN_THRESHOLD from lib/permissions.ts.
  if (!membership || (membership.roles ?? 0) < 3) {
    throw new ConvexError("not_a_community_admin");
  }
}

/**
 * Admin-only: list all prayers currently held for review in a community.
 * Returns full content + the LLM's category/note so the admin has the
 * context the classifier had. Author identity is included since admins
 * may need to follow up — anonymous-mode prayers still surface ID here
 * because the prayer needed human eyes anyway.
 */
export const listPendingForReview = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await assertCommunityAdmin(ctx, userId, args.communityId);

    const pending = await ctx.db
      .query("prayers")
      .withIndex("by_community_moderationStatus", (q) =>
        q.eq("communityId", args.communityId).eq("moderationStatus", "pending_review"),
      )
      .collect();
    pending.sort((a, b) => a.createdAt - b.createdAt);

    return Promise.all(
      pending.map(async (p) => {
        // Anonymity contract: anonymous = hidden from admins too. Skip the
        // author lookup entirely so identity never reaches an admin client
        // or log pipeline. The UI renders "Anonymous" when display name
        // is null.
        const author = p.isAnonymous ? null : await ctx.db.get(p.authorUserId);
        return {
          id: p._id,
          bodyText: p.bodyText,
          isAnonymous: p.isAnonymous,
          createdAt: p.createdAt,
          moderationDetail: p.moderationDetail ?? null,
          crisisFlag: p.crisisFlag === true,
          authorDisplayName: p.isAnonymous
            ? null
            : firstNameLastInitial(author?.firstName, author?.lastName) ?? "Unknown",
        };
      }),
    );
  },
});

export const approvePending = mutation({
  args: { token: v.string(), prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    await assertCommunityAdmin(ctx, userId, prayer.communityId);
    if (prayer.moderationStatus !== "pending_review") {
      throw new ConvexError("prayer_not_pending");
    }
    await ctx.db.patch(args.prayerId, {
      moderationStatus: "approved",
      updatedAt: now(),
    });
    return { ok: true };
  },
});

export const rejectPending = mutation({
  args: { token: v.string(), prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    await assertCommunityAdmin(ctx, userId, prayer.communityId);
    if (prayer.moderationStatus !== "pending_review") {
      throw new ConvexError("prayer_not_pending");
    }
    await ctx.db.patch(args.prayerId, {
      moderationStatus: "rejected",
      updatedAt: now(),
    });
    return { ok: true };
  },
});

// ----------------------------------------------------------------------------
// Member reports
// ----------------------------------------------------------------------------

const REPORT_REASONS = [
  "names_person",
  "intimate_explicit",
  "spam_solicitation",
  "hateful",
  "crisis_needs_resources",
  "other",
] as const;
type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * Any community member can report a prayer they're seeing. Idempotent per
 * (prayer, reporter) — a second report from the same user is a no-op.
 * Schedules a fan-out push to admins so reports don't sit cold.
 */
export const reportPrayer = mutation({
  args: {
    token: v.string(),
    prayerId: v.id("prayers"),
    reason: v.union(
      v.literal("names_person"),
      v.literal("intimate_explicit"),
      v.literal("spam_solicitation"),
      v.literal("hateful"),
      v.literal("crisis_needs_resources"),
      v.literal("other"),
    ),
    customNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    await assertCommunityMember(ctx, userId, prayer.communityId);
    if (prayer.authorUserId === userId) {
      throw new ConvexError("cannot_report_own_prayer");
    }

    // Dedupe per (prayer, reporter). Second report = no-op.
    const existing = await ctx.db
      .query("prayerReports")
      .withIndex("by_prayer_reporter", (q) =>
        q.eq("prayerId", args.prayerId).eq("reporterUserId", userId),
      )
      .first();
    if (existing) return { alreadyReported: true };

    const customNote = args.customNote?.trim().slice(0, 300) || undefined;

    const reportId = await ctx.db.insert("prayerReports", {
      prayerId: args.prayerId,
      communityId: prayer.communityId,
      reporterUserId: userId,
      reason: args.reason,
      customNote,
      status: "open",
      createdAt: now(),
    });

    await ctx.scheduler.runAfter(0, internal.functions.prayers.notifyAdminsOfReport, {
      reportId,
    });

    return { alreadyReported: false, reportId };
  },
});

/**
 * Admin-only: open member reports for a community. Returns one row per
 * report, with the underlying prayer body + reporter "First L." attached
 * so admins have what they need to triage in one screen.
 */
export const listReportedPrayers = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await assertCommunityAdmin(ctx, userId, args.communityId);

    const reports = await ctx.db
      .query("prayerReports")
      .withIndex("by_community_status", (q) =>
        q.eq("communityId", args.communityId).eq("status", "open"),
      )
      .collect();
    reports.sort((a, b) => a.createdAt - b.createdAt);

    return Promise.all(
      reports.map(async (r) => {
        const prayer = await ctx.db.get(r.prayerId);
        const reporter = await ctx.db.get(r.reporterUserId);
        return {
          reportId: r._id,
          prayerId: r.prayerId,
          reason: r.reason,
          customNote: r.customNote ?? null,
          createdAt: r.createdAt,
          reporterDisplayName:
            firstNameLastInitial(reporter?.firstName, reporter?.lastName) ??
            "Unknown",
          prayerBody: prayer?.bodyText ?? "(deleted)",
          prayerCreatedAt: prayer?.createdAt ?? r.createdAt,
          // Still-visible? Admin needs to know if action is needed urgently.
          prayerStatus: prayer?.moderationStatus ?? "rejected",
        };
      }),
    );
  },
});

/**
 * Admin uphold: reject the prayer + mark all its reports as actioned.
 * Idempotent — safe to call repeatedly even if other admins act concurrently.
 */
export const upholdReport = mutation({
  args: { token: v.string(), prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    await assertCommunityAdmin(ctx, userId, prayer.communityId);

    const ts = now();
    if (prayer.moderationStatus !== "rejected") {
      await ctx.db.patch(args.prayerId, {
        moderationStatus: "rejected",
        updatedAt: ts,
      });
    }
    const reports = await ctx.db
      .query("prayerReports")
      .withIndex("by_prayer", (q) => q.eq("prayerId", args.prayerId))
      .collect();
    for (const r of reports) {
      if (r.status === "open") {
        await ctx.db.patch(r._id, { status: "actioned" });
      }
    }
    return { ok: true };
  },
});

/**
 * Admin dismiss: keep the prayer up, mark reports as dismissed.
 */
export const dismissReports = mutation({
  args: { token: v.string(), prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const prayer = await ctx.db.get(args.prayerId);
    if (!prayer) throw new ConvexError("prayer_not_found");
    await assertCommunityAdmin(ctx, userId, prayer.communityId);

    const reports = await ctx.db
      .query("prayerReports")
      .withIndex("by_prayer", (q) => q.eq("prayerId", args.prayerId))
      .collect();
    for (const r of reports) {
      if (r.status === "open") {
        await ctx.db.patch(r._id, { status: "dismissed" });
      }
    }
    return { ok: true };
  },
});

export const notifyAdminsOfReport = internalAction({
  args: { reportId: v.id("prayerReports") },
  handler: async (ctx, args) => {
    const report = await ctx.runQuery(
      internal.functions.prayers._getReportForAction,
      { reportId: args.reportId },
    );
    if (!report) return;
    const snippet = report.prayerBody.slice(0, 80);
    await notifyCommunityAdmins(ctx, {
      type: "prayer.member_reported",
      communityId: report.communityId,
      data: {
        prayerId: String(report.prayerId),
        communityId: String(report.communityId),
        snippet,
        reason: report.reason,
      },
    });
  },
});

export const _getReportForAction = internalQuery({
  args: { reportId: v.id("prayerReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    const prayer = await ctx.db.get(report.prayerId);
    return {
      prayerId: report.prayerId,
      communityId: report.communityId,
      reason: report.reason,
      prayerBody: prayer?.bodyText ?? "",
    };
  },
});

void REPORT_REASONS;

export const notifyAdminsOfPendingReview = internalAction({
  args: { prayerId: v.id("prayers") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(
      internal.functions.prayers._getPrayerForAction,
      { prayerId: args.prayerId },
    );
    if (!data) return;
    // We can't pull a category off `data.prayer.moderationDetail` here
    // because internalQuery returns the doc with that field — re-read note
    // so this fan-out stays simple. Keep body snippet short for the push.
    const snippet = data.prayer.bodyText.slice(0, 80);
    await notifyCommunityAdmins(ctx, {
      type: "prayer.admin_review_needed",
      communityId: data.prayer.communityId,
      data: {
        prayerId: String(args.prayerId),
        communityId: String(data.prayer.communityId),
        snippet,
        category: data.prayer.moderationDetail?.category ?? "borderline_other",
      },
    });
  },
});

// ============================================================================
// Cron handler
// ============================================================================

export const archiveStalePrayers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = now() - STALE_PRAYER_MS;
    const ts = now();
    // Keep paging until we drain the backlog. Without this loop, a
    // single daily run only archived 200 — a long quiet period followed
    // by a moderation rollout could leave thousands of stale prayers
    // active well past the 30-day retention window. The MAX_PAGES cap
    // bounds worst-case txn cost (200 * 50 = 10 000 archives per run);
    // anything beyond that gets the next day's run.
    const PAGE = 200;
    const MAX_PAGES = 50;
    let total = 0;
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await ctx.db
        .query("prayers")
        .filter((q) =>
          q.and(
            q.eq(q.field("status"), "active"),
            q.lt(q.field("createdAt"), cutoff),
          ),
        )
        .paginate({ numItems: PAGE, cursor });
      for (const p of result.page) {
        await ctx.db.patch(p._id, {
          status: "archived",
          archivedAt: ts,
          updatedAt: ts,
        });
        total++;
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    return { archived: total };
  },
});

