/**
 * Prayer notifications — preferences API + cron handlers.
 *
 * The chokepoint is `shouldSendPrayerNotification`: every prayer notification
 * path (existing `notifyAuthor` / `notifyPrayedUsers` in ../prayers.ts and the
 * crons here) must consult it before calling notify(). It enforces:
 *   - master kill switch (the bell-off toggle on the prayer page)
 *   - per-type defaults (all ON in v1) and overrides
 *
 * Crons:
 *   - cronDailyDigest:  daily 14:00 UTC. One push per community member who
 *                       has the toggle on, counting prayers approved since
 *                       their last digest.
 *   - cronMondayNudge:  Monday 14:00 UTC. To users without an active prayer.
 *   - cronUpdateNudge:  daily 14:30 UTC. To authors whose prayer is ~14 days
 *                       old and still `status: "active"`, one-shot per prayer.
 */

import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { now } from "../../lib/utils";
import { notify } from "../../lib/notifications/send";

// ============================================================================
// Per-type defaults
// ============================================================================

/**
 * Default ON/OFF for each toggleable prayer notification type. All ON in v1.
 * Reading code applies these when the user's prefs row has `undefined` for
 * the field — we never eagerly backfill, so flipping the default later
 * doesn't require a migration.
 */
export const PRAYER_NOTIFICATION_DEFAULTS = {
  prayedFor: true,
  update: true,
  praiseReport: true,
  dailyDigest: true,
  mondayNudge: true,
  updateNudge: true,
} as const;

export type PrayerNotificationToggleKey = keyof typeof PRAYER_NOTIFICATION_DEFAULTS;

// Maps a notification `type` string (matches definitions.ts) to its toggle key.
const TYPE_TO_TOGGLE: Record<string, PrayerNotificationToggleKey> = {
  "prayer.prayed_for": "prayedFor",
  "prayer.update": "update",
  "prayer.praise_report": "praiseReport",
  "prayer.daily_digest": "dailyDigest",
  "prayer.monday_nudge": "mondayNudge",
  "prayer.update_nudge": "updateNudge",
};

// ============================================================================
// Internal helpers
// ============================================================================

async function getPrefs(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
): Promise<Doc<"userPrayerNotificationPreferences"> | null> {
  return ctx.db
    .query("userPrayerNotificationPreferences")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .first();
}

/**
 * Returns whether a given prayer notification should fire for this user.
 * Falls back to defaults when no prefs row exists.
 */
export const _shouldSendPrayerNotification = internalQuery({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    notificationType: v.string(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const toggleKey = TYPE_TO_TOGGLE[args.notificationType];
    if (!toggleKey) {
      // Unknown type — admin types (admin_review_needed, member_reported)
      // are not user-toggleable; let them through.
      return true;
    }
    const prefs = await getPrefs(ctx, args.userId, args.communityId);
    if (!prefs) return PRAYER_NOTIFICATION_DEFAULTS[toggleKey];
    if (prefs.masterEnabled === false) return false;
    const value = prefs[toggleKey];
    return value ?? PRAYER_NOTIFICATION_DEFAULTS[toggleKey];
  },
});

// ============================================================================
// Public queries + mutations (settings UI)
// ============================================================================

interface ResolvedPrefs {
  masterEnabled: boolean;
  prayedFor: boolean;
  update: boolean;
  praiseReport: boolean;
  dailyDigest: boolean;
  mondayNudge: boolean;
  updateNudge: boolean;
}

function resolve(prefs: Doc<"userPrayerNotificationPreferences"> | null): ResolvedPrefs {
  return {
    masterEnabled: prefs?.masterEnabled ?? true,
    prayedFor: prefs?.prayedFor ?? PRAYER_NOTIFICATION_DEFAULTS.prayedFor,
    update: prefs?.update ?? PRAYER_NOTIFICATION_DEFAULTS.update,
    praiseReport: prefs?.praiseReport ?? PRAYER_NOTIFICATION_DEFAULTS.praiseReport,
    dailyDigest: prefs?.dailyDigest ?? PRAYER_NOTIFICATION_DEFAULTS.dailyDigest,
    mondayNudge: prefs?.mondayNudge ?? PRAYER_NOTIFICATION_DEFAULTS.mondayNudge,
    updateNudge: prefs?.updateNudge ?? PRAYER_NOTIFICATION_DEFAULTS.updateNudge,
  };
}

/**
 * Get the caller's prayer notification preferences for a community,
 * with all defaults resolved. Returns null-safe defaults if no row exists.
 */
export const getPrayerNotificationPreferences = query({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args): Promise<ResolvedPrefs> => {
    const userId = await requireAuth(ctx, args.token);
    const prefs = await getPrefs(ctx, userId, args.communityId);
    return resolve(prefs);
  },
});

async function upsertPrefs(
  ctx: MutationCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
  patch: Partial<Omit<Doc<"userPrayerNotificationPreferences">, "_id" | "_creationTime" | "userId" | "communityId">>,
): Promise<void> {
  const existing = await getPrefs(ctx, userId, communityId);
  const ts = now();
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: ts });
  } else {
    await ctx.db.insert("userPrayerNotificationPreferences", {
      userId,
      communityId,
      masterEnabled: patch.masterEnabled ?? true,
      prayedFor: patch.prayedFor,
      update: patch.update,
      praiseReport: patch.praiseReport,
      dailyDigest: patch.dailyDigest,
      mondayNudge: patch.mondayNudge,
      updateNudge: patch.updateNudge,
      updatedAt: ts,
    });
  }
}

/**
 * Flip the master kill switch. `false` silences ALL prayer notifications for
 * this user in this community, regardless of per-type toggles. The prayer
 * page bell icon calls this.
 */
export const setMasterPrayerNotifications = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await upsertPrefs(ctx, userId, args.communityId, {
      masterEnabled: args.enabled,
    });
    return { ok: true };
  },
});

/**
 * Toggle one per-type preference. The settings sheet uses this.
 */
export const setPrayerNotificationToggle = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    toggle: v.union(
      v.literal("prayedFor"),
      v.literal("update"),
      v.literal("praiseReport"),
      v.literal("dailyDigest"),
      v.literal("mondayNudge"),
      v.literal("updateNudge"),
    ),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const patch: Record<string, boolean> = {};
    patch[args.toggle] = args.enabled;
    await upsertPrefs(
      ctx,
      userId,
      args.communityId,
      patch as Partial<Doc<"userPrayerNotificationPreferences">>,
    );
    return { ok: true };
  },
});

// ============================================================================
// Cron: Daily digest
// ============================================================================

function utcDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoWeekKey(ts: number): string {
  // ISO week: Thursday-anchored. Good enough for "did we send this Monday".
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  // Move to Thursday in current week (Mon=1, Sun=0 → 4)
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Returns IDs of all communities that have the prayer feature enabled.
 * Used to bound the cron scans.
 */
export const _getPrayerEnabledCommunities = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ id: Id<"communities">; name: string }>> => {
    // No index on churchFeatures (it's a nested object). Acceptable: this
    // is at most ~hundreds of rows and runs once per cron tick.
    const all = await ctx.db.query("communities").collect();
    return all
      .filter((c) => c.churchFeatures?.prayerEnabled === true)
      .map((c) => ({ id: c._id, name: c.name ?? "" }));
  },
});

export const _getCommunityMemberIds = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args): Promise<Id<"users">[]> => {
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("status"), 1))
      .collect();
    return memberships.map((m) => m.userId);
  },
});

/**
 * Returns the active+approved prayers in a community, with the effective
 * "published-at" timestamp (`approvedAt`, falling back to `createdAt` for
 * pre-migration rows). Per-user filtering happens in the cron.
 *
 * Returning author id + prayer id lets the cron exclude per-recipient:
 *   - prayers the recipient authored (they can't pray for themselves)
 *   - prayers the recipient has already prayed for
 * — so the digest count matches what the recipient would actually see in
 * their feed when they tap the push.
 */
export const _getApprovedPrayers = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ id: Id<"prayers">; authorUserId: Id<"users">; effectiveTime: number }>> => {
    const rows = await ctx.db
      .query("prayers")
      .withIndex("by_community_status_modStatus_count", (q) =>
        q
          .eq("communityId", args.communityId)
          .eq("status", "active")
          .eq("moderationStatus", "approved"),
      )
      .collect();
    return rows.map((p) => ({
      id: p._id,
      authorUserId: p.authorUserId,
      effectiveTime: p.approvedAt ?? p.createdAt,
    }));
  },
});

/**
 * IDs of the prayers this user has already prayed for in a given community,
 * used by the daily-digest cron to subtract them from the new-prayer count.
 */
export const _getUserPrayedForIds = internalQuery({
  args: { userId: v.id("users"), communityId: v.id("communities") },
  handler: async (ctx, args): Promise<Id<"prayers">[]> => {
    // Use the per-user index; filter by community in memory. The
    // `by_user_community` index exists but communityId is optional on
    // pre-migration responses, so scanning by_user is the safer bet
    // (matches the same approach used by `myPrayedFor`).
    const responses = await ctx.db
      .query("prayerResponses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return responses
      .filter((r) => r.communityId === args.communityId)
      .map((r) => r.prayerId);
  },
});

export const _userHasActivePrayer = internalQuery({
  args: { userId: v.id("users"), communityId: v.id("communities") },
  handler: async (ctx, args): Promise<boolean> => {
    const mine = await ctx.db
      .query("prayers")
      .withIndex("by_author", (q) => q.eq("authorUserId", args.userId))
      .collect();
    // Rejected prayers keep `status: "active"` (only moderationStatus
    // changes), so without the moderation filter a user whose only
    // submission was rejected would never get the Monday nudge until the
    // 30-day archive cron rotated the prayer out.
    return mine.some(
      (p) =>
        p.communityId === args.communityId &&
        p.status === "active" &&
        p.moderationStatus !== "rejected",
    );
  },
});

export const _getOrInitState = internalQuery({
  args: { userId: v.id("users"), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("userPrayerNotificationState")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId),
      )
      .first();
  },
});

export const _markDailyDigestSent = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    dateKey: v.string(),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPrayerNotificationState")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        dailyDigestLastSentDateKey: args.dateKey,
        dailyDigestLastSentAt: args.ts,
      });
    } else {
      await ctx.db.insert("userPrayerNotificationState", {
        userId: args.userId,
        communityId: args.communityId,
        dailyDigestLastSentDateKey: args.dateKey,
        dailyDigestLastSentAt: args.ts,
      });
    }
  },
});

export const _markMondayNudgeSent = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    weekKey: v.string(),
    ts: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPrayerNotificationState")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        mondayNudgeLastSentWeekKey: args.weekKey,
        mondayNudgeLastSentAt: args.ts,
      });
    } else {
      await ctx.db.insert("userPrayerNotificationState", {
        userId: args.userId,
        communityId: args.communityId,
        mondayNudgeLastSentWeekKey: args.weekKey,
        mondayNudgeLastSentAt: args.ts,
      });
    }
  },
});

/**
 * Daily digest. Runs daily at 14:00 UTC. For each prayer-enabled community,
 * pushes one notification per eligible member summarizing how many new
 * approved prayers have landed since the user's last digest.
 *
 * Per-user filtering keeps the count honest: we subtract prayers the
 * recipient authored (they can't pray for themselves) and ones they've
 * already prayed for, so tapping the push lands on a feed that actually
 * has that many prayers in it.
 *
 * "New since" uses each prayer's `approvedAt` timestamp, not `createdAt` —
 * a prayer held in `pending_review` across a digest boundary surfaces to
 * members on the digest immediately after the admin approves it.
 *
 * First-time recipients (no state row yet) have `since = 0`, so their
 * digest reflects every approved prayer in the community right now, not
 * just the last 24h. After that the cutoff naturally narrows.
 */
export const cronDailyDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const ts = now();
    const dateKey = utcDateKey(ts);

    const communities = await ctx.runQuery(
      internal.functions.prayers.notifications._getPrayerEnabledCommunities,
      {},
    );

    for (const community of communities) {
      const prayers = await ctx.runQuery(
        internal.functions.prayers.notifications._getApprovedPrayers,
        { communityId: community.id },
      );
      if (prayers.length === 0) continue;

      const memberIds = await ctx.runQuery(
        internal.functions.prayers.notifications._getCommunityMemberIds,
        { communityId: community.id },
      );

      for (const userId of memberIds) {
        const allowed = await ctx.runQuery(
          internal.functions.prayers.notifications._shouldSendPrayerNotification,
          {
            userId,
            communityId: community.id,
            notificationType: "prayer.daily_digest",
          },
        );
        if (!allowed) continue;

        const state = await ctx.runQuery(
          internal.functions.prayers.notifications._getOrInitState,
          { userId, communityId: community.id },
        );
        if (state?.dailyDigestLastSentDateKey === dateKey) continue;

        const since = state?.dailyDigestLastSentAt ?? 0;
        const prayedForIds = await ctx.runQuery(
          internal.functions.prayers.notifications._getUserPrayedForIds,
          { userId, communityId: community.id },
        );
        const prayedForSet = new Set(prayedForIds.map((id) => String(id)));

        const count = prayers.filter(
          (p) =>
            p.effectiveTime >= since &&
            p.authorUserId !== userId &&
            !prayedForSet.has(String(p.id)),
        ).length;
        if (count === 0) continue;

        await notify(ctx, {
          type: "prayer.daily_digest",
          userId,
          communityId: community.id,
          data: {
            communityId: String(community.id),
            communityName: community.name,
            count,
          },
        });
        await ctx.runMutation(
          internal.functions.prayers.notifications._markDailyDigestSent,
          { userId, communityId: community.id, dateKey, ts },
        );
      }
    }
  },
});

/**
 * Monday nudge. Runs Monday at 14:00 UTC. Sent to community members in
 * prayer-enabled communities who do NOT currently have an active prayer.
 *
 * "Active" = status === "active" — answered or archived prayers don't count.
 */
export const cronMondayNudge = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const ts = now();
    const dayOfWeek = new Date(ts).getUTCDay(); // 0=Sunday, 1=Monday
    // Defensive: the cron schedule already only runs Monday, but if anyone
    // wires it differently in dev, skip non-Monday invocations.
    if (dayOfWeek !== 1) return;
    const weekKey = isoWeekKey(ts);

    const communities = await ctx.runQuery(
      internal.functions.prayers.notifications._getPrayerEnabledCommunities,
      {},
    );

    for (const community of communities) {
      const memberIds = await ctx.runQuery(
        internal.functions.prayers.notifications._getCommunityMemberIds,
        { communityId: community.id },
      );

      for (const userId of memberIds) {
        const allowed = await ctx.runQuery(
          internal.functions.prayers.notifications._shouldSendPrayerNotification,
          {
            userId,
            communityId: community.id,
            notificationType: "prayer.monday_nudge",
          },
        );
        if (!allowed) continue;

        const state = await ctx.runQuery(
          internal.functions.prayers.notifications._getOrInitState,
          { userId, communityId: community.id },
        );
        if (state?.mondayNudgeLastSentWeekKey === weekKey) continue;

        const hasActive = await ctx.runQuery(
          internal.functions.prayers.notifications._userHasActivePrayer,
          { userId, communityId: community.id },
        );
        if (hasActive) continue;

        await notify(ctx, {
          type: "prayer.monday_nudge",
          userId,
          communityId: community.id,
          data: {
            communityId: String(community.id),
            communityName: community.name,
          },
        });
        await ctx.runMutation(
          internal.functions.prayers.notifications._markMondayNudgeSent,
          { userId, communityId: community.id, weekKey, ts },
        );
      }
    }
  },
});

// ============================================================================
// Cron: Update nudge (T+14d to author of still-active prayers)
// ============================================================================

const UPDATE_NUDGE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const UPDATE_NUDGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const UPDATE_NUDGE_EVENT_TYPE = "update_nudge_sent";

/**
 * Find prayers eligible for the update nudge: active, between 14 and 30 days
 * old (capped so very stale prayers don't all fire at once on initial
 * rollout), and missing a `prayerNotificationEvents` row marking the nudge
 * as already sent.
 *
 * The 30-day cap also lets the existing `archiveStalePrayers` cron handle
 * 30d+ prayers — we don't want to nudge then immediately archive.
 */
export const _getUpdateNudgeCandidates = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const minCreated = args.now - UPDATE_NUDGE_MAX_AGE_MS;
    const maxCreated = args.now - UPDATE_NUDGE_AGE_MS;

    const candidates: Array<{
      prayerId: Id<"prayers">;
      authorUserId: Id<"users">;
      communityId: Id<"communities">;
    }> = [];

    // No compound index covers (status, createdAt) — scan all active
    // prayers via the existing index and filter by age. Bounded by status:
    // active, which is small (answered/archived rotate out).
    //
    // We page so a community with thousands of active prayers doesn't blow
    // the transaction limit.
    const PAGE = 200;
    const MAX_PAGES = 25;
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const result = await ctx.db
        .query("prayers")
        .filter((q) =>
          q.and(
            q.eq(q.field("status"), "active"),
            q.eq(q.field("moderationStatus"), "approved"),
            q.lt(q.field("createdAt"), maxCreated),
            q.gte(q.field("createdAt"), minCreated),
          ),
        )
        .paginate({ numItems: PAGE, cursor });
      for (const p of result.page) {
        const sent = await ctx.db
          .query("prayerNotificationEvents")
          .withIndex("by_prayer_type", (q) =>
            q.eq("prayerId", p._id).eq("type", UPDATE_NUDGE_EVENT_TYPE),
          )
          .first();
        if (sent) continue;
        candidates.push({
          prayerId: p._id,
          authorUserId: p.authorUserId,
          communityId: p.communityId,
        });
      }
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    return candidates;
  },
});

export const _markUpdateNudgeSent = internalMutation({
  args: { prayerId: v.id("prayers"), ts: v.number() },
  handler: async (ctx, args) => {
    // Double-check inside the mutation in case two cron ticks raced (the
    // cron is idempotent per prayer thanks to this guard).
    const existing = await ctx.db
      .query("prayerNotificationEvents")
      .withIndex("by_prayer_type", (q) =>
        q.eq("prayerId", args.prayerId).eq("type", UPDATE_NUDGE_EVENT_TYPE),
      )
      .first();
    if (existing) return { alreadySent: true };
    await ctx.db.insert("prayerNotificationEvents", {
      prayerId: args.prayerId,
      type: UPDATE_NUDGE_EVENT_TYPE,
      sentAt: args.ts,
    });
    return { alreadySent: false };
  },
});

export const cronUpdateNudge = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const ts = now();
    const candidates = await ctx.runQuery(
      internal.functions.prayers.notifications._getUpdateNudgeCandidates,
      { now: ts },
    );

    for (const c of candidates) {
      const allowed = await ctx.runQuery(
        internal.functions.prayers.notifications._shouldSendPrayerNotification,
        {
          userId: c.authorUserId,
          communityId: c.communityId,
          notificationType: "prayer.update_nudge",
        },
      );
      if (!allowed) continue;

      // Reserve before sending so a partial failure (push fails mid-fan-out)
      // still records the attempt and we don't re-nudge tomorrow.
      const reserve = await ctx.runMutation(
        internal.functions.prayers.notifications._markUpdateNudgeSent,
        { prayerId: c.prayerId, ts },
      );
      if (reserve.alreadySent) continue;

      await notify(ctx, {
        type: "prayer.update_nudge",
        userId: c.authorUserId,
        communityId: c.communityId,
        data: {
          prayerId: String(c.prayerId),
          communityId: String(c.communityId),
        },
      });
    }
  },
});

// Suppress unused-import warnings for symbols the types pull in indirectly.
void ConvexError;
