/**
 * Group resource enhancement tests.
 *
 * Covers the fields/behaviors added for inbox display, link redirects, and
 * additional icons:
 *   - create/update persist `linkUrl` (trimmed; blank -> undefined) and
 *     `showInInbox`
 *   - getInboxResourcesForUser returns only `showInInbox` resources visible to
 *     the user, grouped by group, scoped to the community, honoring visibility
 *
 * Run with: cd apps/convex && pnpm test __tests__/group-resources.test.ts
 */

import { vi, expect, test, describe } from "vitest";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) throw new Error("Invalid token");
    return { payload: { userId: match[1], type: "access" } };
  }),
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock-signed-token"),
  })),
  decodeJwt: vi.fn((token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) return null;
    return { userId: match[1], type: "access" };
  }),
}));

import { convexTest } from "convex-test";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";
import { api } from "../_generated/api";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

interface Fixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  leaderToken: string;
  memberToken: string;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const ts = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Resources Community",
      slug: "resources",
      isPublic: true,
      createdAt: ts,
      updatedAt: ts,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "General",
      slug: "general",
      isActive: true,
      displayOrder: 0,
      createdAt: ts,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      name: "Test Group",
      groupTypeId,
      isArchived: false,
      createdAt: ts,
      updatedAt: ts,
    });

    const mk = async (firstName: string, phone: string) =>
      ctx.db.insert("users", {
        firstName,
        lastName: "T",
        phone,
        createdAt: ts,
        updatedAt: ts,
      });

    const leaderId = await mk("Leader", "+15553330001");
    const memberId = await mk("Member", "+15553330002");

    const inGroup = async (uid: Id<"users">, role: string) => {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: uid,
        role,
        joinedAt: ts,
        notificationsEnabled: true,
      });
    };
    await inGroup(leaderId, "leader");
    await inGroup(memberId, "member");

    return {
      communityId,
      groupId,
      leaderId,
      memberId,
      leaderToken: `test-token-${leaderId}`,
      memberToken: `test-token-${memberId}`,
    };
  });
}

describe("groupResources: linkUrl + showInInbox fields", () => {
  test("create persists linkUrl and showInInbox", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const resourceId = await t.mutation(
      api.functions.groupResources.index.create,
      {
        groupId: f.groupId,
        title: "Give",
        icon: "cash-outline",
        linkUrl: "https://example.com/give",
        showInInbox: true,
        visibility: { type: "everyone" },
        token: f.leaderToken,
      },
    );

    const resource = await t.run((ctx) => ctx.db.get(resourceId));
    expect(resource?.linkUrl).toBe("https://example.com/give");
    expect(resource?.showInInbox).toBe(true);
    expect(resource?.icon).toBe("cash-outline");
  });

  test("create trims linkUrl and drops a blank link", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const resourceId = await t.mutation(
      api.functions.groupResources.index.create,
      {
        groupId: f.groupId,
        title: "No Link",
        linkUrl: "   ",
        visibility: { type: "everyone" },
        token: f.leaderToken,
      },
    );

    const resource = await t.run((ctx) => ctx.db.get(resourceId));
    expect(resource?.linkUrl).toBeUndefined();
  });

  test("normalizes a scheme-less linkUrl to https on create and update", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    // No scheme -> https:// prefix added so Linking.openURL works on native.
    const resourceId = await t.mutation(
      api.functions.groupResources.index.create,
      {
        groupId: f.groupId,
        title: "Give",
        linkUrl: "example.com/give",
        visibility: { type: "everyone" },
        token: f.leaderToken,
      },
    );
    expect((await t.run((ctx) => ctx.db.get(resourceId)))?.linkUrl).toBe(
      "https://example.com/give",
    );

    // An existing scheme is preserved (not double-prefixed).
    await t.mutation(api.functions.groupResources.index.update, {
      resourceId,
      linkUrl: "mailto:give@example.com",
      token: f.leaderToken,
    });
    expect((await t.run((ctx) => ctx.db.get(resourceId)))?.linkUrl).toBe(
      "mailto:give@example.com",
    );

    // Update without a scheme is normalized too.
    await t.mutation(api.functions.groupResources.index.update, {
      resourceId,
      linkUrl: "donate.example.org",
      token: f.leaderToken,
    });
    expect((await t.run((ctx) => ctx.db.get(resourceId)))?.linkUrl).toBe(
      "https://donate.example.org",
    );
  });

  test("update can set then clear linkUrl and toggle showInInbox", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const resourceId = await t.mutation(
      api.functions.groupResources.index.create,
      {
        groupId: f.groupId,
        title: "Resource",
        visibility: { type: "everyone" },
        token: f.leaderToken,
      },
    );

    await t.mutation(api.functions.groupResources.index.update, {
      resourceId,
      linkUrl: "  https://example.com/page  ",
      showInInbox: true,
      token: f.leaderToken,
    });

    let resource = await t.run((ctx) => ctx.db.get(resourceId));
    expect(resource?.linkUrl).toBe("https://example.com/page");
    expect(resource?.showInInbox).toBe(true);

    // Blank link clears the redirect; toggle inbox back off.
    await t.mutation(api.functions.groupResources.index.update, {
      resourceId,
      linkUrl: "",
      showInInbox: false,
      token: f.leaderToken,
    });

    resource = await t.run((ctx) => ctx.db.get(resourceId));
    expect(resource?.linkUrl).toBeUndefined();
    expect(resource?.showInInbox).toBe(false);
  });
});

describe("groupResources: getInboxResourcesForUser", () => {
  test("returns only showInInbox resources, grouped, with link metadata", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    // Inbox resource (visible to everyone).
    await t.mutation(api.functions.groupResources.index.create, {
      groupId: f.groupId,
      title: "Give",
      icon: "cash-outline",
      linkUrl: "https://example.com/give",
      showInInbox: true,
      visibility: { type: "everyone" },
      token: f.leaderToken,
    });

    // Not flagged for inbox -> excluded.
    await t.mutation(api.functions.groupResources.index.create, {
      groupId: f.groupId,
      title: "Toolbar Only",
      showInInbox: false,
      visibility: { type: "everyone" },
      token: f.leaderToken,
    });

    const result = await t.query(
      api.functions.groupResources.index.getInboxResourcesForUser,
      { communityId: f.communityId, token: f.memberToken },
    );

    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe(f.groupId);
    expect(result[0].resources).toHaveLength(1);
    expect(result[0].resources[0].title).toBe("Give");
    expect(result[0].resources[0].linkUrl).toBe("https://example.com/give");
    expect(result[0].resources[0].icon).toBe("cash-outline");
  });

  test("excludes resources hidden by visibility rules", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    // Only visible to members who joined within 1 day. The member's joinedAt is
    // "now" in the fixture, so make this clearly stale by backdating membership.
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", f.groupId).eq("userId", f.memberId),
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, {
          joinedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        });
      }
    });

    await t.mutation(api.functions.groupResources.index.create, {
      groupId: f.groupId,
      title: "New Members Only",
      showInInbox: true,
      visibility: { type: "joined_within", daysWithin: 1 },
      token: f.leaderToken,
    });

    const result = await t.query(
      api.functions.groupResources.index.getInboxResourcesForUser,
      { communityId: f.communityId, token: f.memberToken },
    );

    expect(result).toHaveLength(0);
  });

  test("excludes resources for groups with a pending join request", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    // Member's join request is still pending (not yet admitted).
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", f.groupId).eq("userId", f.memberId),
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { requestStatus: "pending" });
      }
    });

    await t.mutation(api.functions.groupResources.index.create, {
      groupId: f.groupId,
      title: "Give",
      linkUrl: "https://example.com/give",
      showInInbox: true,
      visibility: { type: "everyone" },
      token: f.leaderToken,
    });

    const result = await t.query(
      api.functions.groupResources.index.getInboxResourcesForUser,
      { communityId: f.communityId, token: f.memberToken },
    );

    expect(result).toHaveLength(0);
  });

  test("scopes results to the requested community", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.mutation(api.functions.groupResources.index.create, {
      groupId: f.groupId,
      title: "Give",
      showInInbox: true,
      visibility: { type: "everyone" },
      token: f.leaderToken,
    });

    // A different community the member doesn't belong to.
    const otherCommunityId = await t.run((ctx) =>
      ctx.db.insert("communities", {
        name: "Other",
        slug: "other",
        isPublic: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const result = await t.query(
      api.functions.groupResources.index.getInboxResourcesForUser,
      { communityId: otherCommunityId, token: f.memberToken },
    );

    expect(result).toHaveLength(0);
  });
});
