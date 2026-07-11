/**
 * Emoji reactions on prayer requests and their follow-ups.
 *
 * Mirrors `messaging/reactions.ts`, but the target is polymorphic: a reaction
 * lives on either a `prayers` row (`targetType: "prayer"`) or a
 * `prayerFollowUps` row (`targetType: "followUp"`). See the `prayerReactions`
 * table in schema.ts.
 *
 * Two differences from chat reactions, both deliberate for the tender prayer
 * context:
 *   1. `emoji` is validated against a small server-side allowlist
 *      (`PRAYER_REACTION_EMOJIS`) — only the curated set is accepted.
 *   2. Access reuses the exact prayer visibility gate from `getDetail`: only a
 *      community member who is the author or who has already prayed for the
 *      prayer may react (or read the reactor list).
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, type QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { now } from "../../lib/utils";

/**
 * Curated reaction set for prayers — a warm, tight 6, narrower than chat's 14
 * because prayer is a more tender context than group chat. This is the single
 * source of truth for both the picker bar (frontend imports it) and the
 * server-side allowlist. Adjusting the product choice is a one-line edit here.
 */
export const PRAYER_REACTION_EMOJIS = [
  "❤️", // Love & support — "I'm with you"
  "🙏", // Praying with you / amen
  "🎉", // Celebrate — answered prayers & praise reports
  "🙌", // Praise / hallelujah
  "🕊️", // Peace & comfort
  "🥹", // Deeply moved / touched
] as const;

const ALLOWED_EMOJIS = new Set<string>(PRAYER_REACTION_EMOJIS);

export type PrayerReactionTargetType = "prayer" | "followUp";

/** Aggregated reaction shape returned to the client (mirrors chat's shape). */
export interface AggregatedReaction {
  emoji: string;
  count: number;
  hasReacted: boolean;
}

// ============================================================================
// Access control (mirrors prayers.getDetail's gate)
// ============================================================================

/**
 * Resolve the `prayers` row that owns a reaction target and confirm the caller
 * may see it. Returns the prayer when the caller is a member of its community
 * and is either the author or has a `prayerResponses` row on an **approved**
 * prayer; otherwise `null`.
 *
 * This is the same gate `prayers.getDetail` enforces — reactions are strictly
 * a subset of "can view this prayer detail" — plus a moderation guard so a
 * stale detail screen or deep link can't keep reacting to a prayer that was
 * later admin-rejected (see below).
 */
async function resolveAccessiblePrayer(
  ctx: QueryCtx,
  userId: Id<"users">,
  targetType: PrayerReactionTargetType,
  targetId: string,
): Promise<Doc<"prayers"> | null> {
  // `targetId` is a bare string (the target is polymorphic, so it can't be a
  // typed `v.id`). `normalizeId` returns null for a malformed id instead of
  // letting `ctx.db.get` throw Convex's "invalid id" error — a bad id should
  // deny cleanly, not surface a raw 500.
  let prayer: Doc<"prayers"> | null;
  if (targetType === "prayer") {
    const prayerId = ctx.db.normalizeId("prayers", targetId);
    if (!prayerId) return null;
    prayer = await ctx.db.get(prayerId);
  } else {
    const followUpId = ctx.db.normalizeId("prayerFollowUps", targetId);
    if (!followUpId) return null;
    const followUp = await ctx.db.get(followUpId);
    if (!followUp) return null;
    prayer = await ctx.db.get(followUp.prayerId);
  }
  if (!prayer) return null;

  // Community must still have prayer enabled and the caller must still be a
  // member — same deep-link safety check as getDetail.
  const community = await ctx.db.get(prayer.communityId);
  if (!community?.churchFeatures?.prayerEnabled) return null;

  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", prayer!.communityId),
    )
    .filter((q) => q.eq(q.field("status"), 1))
    .first();
  if (!membership) return null;

  const isAuthor = prayer.authorUserId === userId;
  if (isAuthor) return prayer;

  const hasPrayed = !!(await ctx.db
    .query("prayerResponses")
    .withIndex("by_prayer_user", (q) =>
      q.eq("prayerId", prayer!._id).eq("userId", userId),
    )
    .first());
  if (!hasPrayed) return null;

  // Non-author viewers may only react to (or read reactors of) an approved
  // prayer. The feed and `myPrayedFor` already hide rejected/pending prayers,
  // but a previously-prayed prayer that was later admin-rejected could still be
  // reached via a stale detail screen or notification deep link — without this
  // guard, removed/moderated content would keep accumulating visible
  // reactions. The author keeps access to their own prayer (matching
  // getDetail) regardless of moderation state.
  return prayer.moderationStatus === "approved" ? prayer : null;
}

// ============================================================================
// Aggregation helper (shared with prayers.getDetail)
// ============================================================================

/**
 * Aggregate reactions for a batch of targets in one round-trip (one index scan
 * per target — the same shape as chat's `getReactionsForMessages`). Returns a
 * map keyed by `targetId` to the `{ emoji, count, hasReacted }[]` list. Used by
 * `getDetail` so both prayer detail screens fetch the request card + every
 * follow-up card's reactions without an extra query.
 */
export async function aggregateReactionsForTargets(
  ctx: QueryCtx,
  userId: Id<"users">,
  targets: Array<{ targetType: PrayerReactionTargetType; targetId: string }>,
): Promise<Record<string, AggregatedReaction[]>> {
  const result: Record<string, AggregatedReaction[]> = {};

  await Promise.all(
    targets.map(async ({ targetType, targetId }) => {
      const rows = await ctx.db
        .query("prayerReactions")
        .withIndex("by_target", (q) =>
          q.eq("targetType", targetType).eq("targetId", targetId),
        )
        .collect();

      const emojiMap = new Map<string, { count: number; hasReacted: boolean }>();
      for (const row of rows) {
        const existing = emojiMap.get(row.emoji);
        if (existing) {
          existing.count++;
          if (row.userId === userId) existing.hasReacted = true;
        } else {
          emojiMap.set(row.emoji, {
            count: 1,
            hasReacted: row.userId === userId,
          });
        }
      }

      // Order by the curated emoji list so badges render consistently.
      result[targetId] = PRAYER_REACTION_EMOJIS.filter((e) =>
        emojiMap.has(e),
      ).map((emoji) => {
        const data = emojiMap.get(emoji)!;
        return { emoji, count: data.count, hasReacted: data.hasReacted };
      });
    }),
  );

  return result;
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Toggle a reaction on a prayer request or one of its follow-ups. Inserts the
 * row if the caller hasn't reacted with this emoji on this target, deletes it
 * if they have. One row per (target, user, emoji).
 *
 * No notification is sent — reactions are silent in v1, like chat.
 */
export const toggleReaction = mutation({
  args: {
    token: v.string(),
    targetType: v.union(v.literal("prayer"), v.literal("followUp")),
    targetId: v.string(),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    if (!ALLOWED_EMOJIS.has(args.emoji)) {
      throw new ConvexError("invalid_reaction_emoji");
    }

    const prayer = await resolveAccessiblePrayer(
      ctx,
      userId,
      args.targetType,
      args.targetId,
    );
    if (!prayer) {
      throw new ConvexError("prayer_not_accessible");
    }

    // Anonymity guard: the author of an *anonymous* prayer must not react to
    // their own request or follow-ups. Reactors are attributed by real name in
    // the "who reacted" list, so a self-reaction would surface the author's
    // identity there (and via `hasReacted`/counts) and defeat the prayer's
    // anonymity. Reacting to *other* people's prayers is unaffected; this only
    // blocks a self-reaction that would unmask an anonymous author. The mobile
    // UI hides the reaction affordance on an anonymous author's own cards, so
    // this is defense in depth against a stale client or deep link.
    if (prayer.isAnonymous && prayer.authorUserId === userId) {
      throw new ConvexError("anonymous_author_cannot_react");
    }

    const existing = await ctx.db
      .query("prayerReactions")
      .withIndex("by_target_user", (q) =>
        q
          .eq("targetType", args.targetType)
          .eq("targetId", args.targetId)
          .eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("emoji"), args.emoji))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("prayerReactions", {
        communityId: prayer.communityId,
        targetType: args.targetType,
        targetId: args.targetId,
        userId,
        emoji: args.emoji,
        createdAt: now(),
      });
    }
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * Who reacted with a given emoji on a target — powers the long-press "who
 * reacted" list, mirroring chat's `getReactionDetails`. Attribution is by
 * design: reacting is a social action and is never anonymous, independent of
 * the prayer author's own anonymity.
 */
export const getReactionDetails = query({
  args: {
    token: v.string(),
    targetType: v.union(v.literal("prayer"), v.literal("followUp")),
    targetId: v.string(),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const prayer = await resolveAccessiblePrayer(
      ctx,
      userId,
      args.targetType,
      args.targetId,
    );
    if (!prayer) return [];

    const reactions = await ctx.db
      .query("prayerReactions")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId),
      )
      .filter((q) => q.eq(q.field("emoji"), args.emoji))
      .collect();

    const users = await Promise.all(
      reactions.map(async (reaction) => {
        const user = await ctx.db.get(reaction.userId);
        if (!user) return null;
        const displayName =
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.username ||
          "Unknown";
        return {
          userId: reaction.userId,
          displayName,
          profilePhoto: user.profilePhoto ?? null,
        };
      }),
    );

    return users.filter((u): u is NonNullable<typeof u> => u !== null);
  },
});
