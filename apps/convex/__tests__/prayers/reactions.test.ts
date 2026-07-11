/**
 * Tests for emoji reactions on prayers and prayer follow-ups.
 *
 * Covers: toggle add/remove, the curated-emoji allowlist, access control
 * (author + prayed-for allowed, non-member and non-prayer rejected), follow-up
 * targets, folding into getDetail (no extra round-trip), cross-user
 * aggregation, and the "who reacted" details query.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const HEART = "❤️";
const PRAY = "🙏";

interface Seeded {
  communityId: Id<"communities">;
  prayerId: Id<"prayers">;
  followUpId: Id<"prayerFollowUps">;
  authorId: Id<"users">;
  authorToken: string;
}

async function makeUser(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  firstName: string,
  phone: string,
  { member = true }: { member?: boolean } = {},
): Promise<{ userId: Id<"users">; token: string }> {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName,
      lastName: "Tester",
      phone,
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  if (member) {
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
  }
  const { accessToken } = await generateTokens(userId);
  return { userId, token: accessToken };
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Seeded> {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      churchFeatures: { prayerEnabled: true },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const { userId: authorId, token: authorToken } = await makeUser(
    t,
    communityId,
    "Author",
    "+15555550001",
  );

  const prayerId = await t.run(async (ctx) => {
    return await ctx.db.insert("prayers", {
      communityId,
      authorUserId: authorId,
      isAnonymous: false,
      bodyText: "Please pray for my mom's surgery",
      status: "active",
      prayedForCount: 0,
      moderationStatus: "approved",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const followUpId = await t.run(async (ctx) => {
    return await ctx.db.insert("prayerFollowUps", {
      prayerId,
      authorUserId: authorId,
      kind: "praise_report",
      bodyText: "Surgery went perfectly!",
      createdAt: Date.now(),
    });
  });

  return { communityId, prayerId, followUpId, authorId, authorToken };
}

/** Give a user a prayerResponses row so they pass the "hasPrayed" gate. */
async function recordPrayed(
  t: ReturnType<typeof convexTest>,
  prayerId: Id<"prayers">,
  communityId: Id<"communities">,
  userId: Id<"users">,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("prayerResponses", {
      prayerId,
      userId,
      communityId,
      prayedAt: Date.now(),
    });
  });
}

describe("prayer reactions", () => {
  test("author can add a reaction; toggling again removes it", async () => {
    const t = convexTest(schema, modules);
    const { prayerId, authorToken } = await seed(t);

    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: authorToken,
      targetType: "prayer",
      targetId: prayerId,
      emoji: HEART,
    });

    let rows = await t.run(async (ctx) =>
      ctx.db.query("prayerReactions").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe(HEART);
    expect(rows[0].targetType).toBe("prayer");

    // Toggle off
    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: authorToken,
      targetType: "prayer",
      targetId: prayerId,
      emoji: HEART,
    });
    rows = await t.run(async (ctx) =>
      ctx.db.query("prayerReactions").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("double add of the same emoji nets to one row then none", async () => {
    const t = convexTest(schema, modules);
    const { prayerId, authorToken } = await seed(t);

    // Two toggles = add then remove = zero rows, never two.
    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: authorToken,
      targetType: "prayer",
      targetId: prayerId,
      emoji: PRAY,
    });
    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: authorToken,
      targetType: "prayer",
      targetId: prayerId,
      emoji: PRAY,
    });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("prayerReactions").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("rejects an emoji outside the curated allowlist", async () => {
    const t = convexTest(schema, modules);
    const { prayerId, authorToken } = await seed(t);

    await expect(
      t.mutation(api.functions.prayers.reactions.toggleReaction, {
        token: authorToken,
        targetType: "prayer",
        targetId: prayerId,
        emoji: "💩",
      }),
    ).rejects.toThrow(/invalid_reaction_emoji/);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("prayerReactions").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("a member who has not prayed cannot react", async () => {
    const t = convexTest(schema, modules);
    const { prayerId, communityId } = await seed(t);
    const { token } = await makeUser(
      t,
      communityId,
      "Bystander",
      "+15555550002",
    );

    await expect(
      t.mutation(api.functions.prayers.reactions.toggleReaction, {
        token,
        targetType: "prayer",
        targetId: prayerId,
        emoji: HEART,
      }),
    ).rejects.toThrow(/prayer_not_accessible/);
  });

  test("a non-member cannot react even after (impossibly) prayed", async () => {
    const t = convexTest(schema, modules);
    const { prayerId } = await seed(t);
    // User in NO community.
    const nonMemberId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        firstName: "Outsider",
        phone: "+15555550003",
        phoneVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const { accessToken } = await generateTokens(nonMemberId);

    await expect(
      t.mutation(api.functions.prayers.reactions.toggleReaction, {
        token: accessToken,
        targetType: "prayer",
        targetId: prayerId,
        emoji: HEART,
      }),
    ).rejects.toThrow(/prayer_not_accessible/);
  });

  test("a member who prayed can react on the request and a follow-up", async () => {
    const t = convexTest(schema, modules);
    const { prayerId, followUpId, communityId } = await seed(t);
    const { userId, token } = await makeUser(
      t,
      communityId,
      "Prayed",
      "+15555550004",
    );
    await recordPrayed(t, prayerId, communityId, userId);

    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token,
      targetType: "prayer",
      targetId: prayerId,
      emoji: HEART,
    });
    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token,
      targetType: "followUp",
      targetId: followUpId,
      emoji: PRAY,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db.query("prayerReactions").collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.targetType).sort()).toEqual([
      "followUp",
      "prayer",
    ]);
  });

  test("getDetail folds aggregated reactions onto the request and follow-ups", async () => {
    const t = convexTest(schema, modules);
    const { prayerId, followUpId, communityId, authorId, authorToken } =
      await seed(t);
    const { userId: reactorId, token: reactorToken } = await makeUser(
      t,
      communityId,
      "Reactor",
      "+15555550005",
    );
    await recordPrayed(t, prayerId, communityId, reactorId);

    // Author + reactor both heart the request; reactor prays on the follow-up.
    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: authorToken,
      targetType: "prayer",
      targetId: prayerId,
      emoji: HEART,
    });
    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: reactorToken,
      targetType: "prayer",
      targetId: prayerId,
      emoji: HEART,
    });
    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: reactorToken,
      targetType: "followUp",
      targetId: followUpId,
      emoji: PRAY,
    });

    // Reactor's view: shared count of 2, hasReacted true on the request.
    const detail = await t.query(api.functions.prayers.getDetail, {
      token: reactorToken,
      prayerId,
    });
    expect(detail).not.toBeNull();
    expect(detail!.reactions).toEqual([
      { emoji: HEART, count: 2, hasReacted: true },
    ]);
    expect(detail!.followUps[0].reactions).toEqual([
      { emoji: PRAY, count: 1, hasReacted: true },
    ]);

    // Author's view: same shared count, but hasReacted false on the follow-up.
    const authorView = await t.query(api.functions.prayers.getDetail, {
      token: authorToken,
      prayerId,
    });
    expect(authorView!.reactions).toEqual([
      { emoji: HEART, count: 2, hasReacted: true },
    ]);
    expect(authorView!.followUps[0].reactions).toEqual([
      { emoji: PRAY, count: 1, hasReacted: false },
    ]);
    expect(authorId).toBeDefined();
  });

  test("getReactionDetails lists who reacted with an emoji", async () => {
    const t = convexTest(schema, modules);
    const { prayerId, communityId, authorToken } = await seed(t);
    const { userId: reactorId, token: reactorToken } = await makeUser(
      t,
      communityId,
      "Grace",
      "+15555550006",
    );
    await recordPrayed(t, prayerId, communityId, reactorId);

    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: authorToken,
      targetType: "prayer",
      targetId: prayerId,
      emoji: HEART,
    });
    await t.mutation(api.functions.prayers.reactions.toggleReaction, {
      token: reactorToken,
      targetType: "prayer",
      targetId: prayerId,
      emoji: HEART,
    });

    const reactors = await t.query(
      api.functions.prayers.reactions.getReactionDetails,
      {
        token: reactorToken,
        targetType: "prayer",
        targetId: prayerId,
        emoji: HEART,
      },
    );
    expect(reactors).toHaveLength(2);
    const names = reactors.map((r) => r.displayName).sort();
    expect(names).toEqual(["Author Tester", "Grace Tester"]);
  });
});
