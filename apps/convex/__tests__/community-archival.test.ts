/**
 * Community Archival Tests
 *
 * Tests for archiving (closing) a whole community:
 * - archiveCommunity mutation: only the Primary Admin may archive; sets the
 *   isArchived flag idempotently.
 * - Archived communities cannot be joined (communities.join).
 * - Archived communities are hidden from discovery: listForUser, listPublic,
 *   and resources.communitySearch.
 * - getCommunitySettings exposes the isArchived flag.
 *
 * Run with: cd apps/convex && pnpm test __tests__/community-archival.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

// Set up JWT secret for testing - must be at least 32 characters
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const COMMUNITY_ROLES = {
  MEMBER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

interface TestSetup {
  primaryAdminId: Id<"users">;
  adminId: Id<"users">;
  memberId: Id<"users">;
  outsiderId: Id<"users">;
  communityId: Id<"communities">;
  primaryAdminToken: string;
  adminToken: string;
  memberToken: string;
  outsiderToken: string;
}

async function seedTestData(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const primaryAdminId = await ctx.db.insert("users", {
      firstName: "Primary",
      lastName: "Admin",
      phone: "+12025551001",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const adminId = await ctx.db.insert("users", {
      firstName: "Regular",
      lastName: "Admin",
      phone: "+12025551002",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const memberId = await ctx.db.insert("users", {
      firstName: "Regular",
      lastName: "Member",
      phone: "+12025551003",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // A user with no membership in the community (used to test joining).
    const outsiderId = await ctx.db.insert("users", {
      firstName: "Outside",
      lastName: "User",
      phone: "+12025551004",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const communityId = await ctx.db.insert("communities", {
      name: "Grace Fellowship",
      slug: "grace-fellowship",
      subdomain: "grace",
      searchText: "grace fellowship grace",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: primaryAdminId,
      communityId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    return { primaryAdminId, adminId, memberId, outsiderId, communityId };
  });

  const [primaryAdminTokens, adminTokens, memberTokens, outsiderTokens] =
    await Promise.all([
      generateTokens(ids.primaryAdminId),
      generateTokens(ids.adminId),
      generateTokens(ids.memberId),
      generateTokens(ids.outsiderId),
    ]);

  return {
    ...ids,
    primaryAdminToken: primaryAdminTokens.accessToken,
    adminToken: adminTokens.accessToken,
    memberToken: memberTokens.accessToken,
    outsiderToken: outsiderTokens.accessToken,
  };
}

// ============================================================================
// archiveCommunity MUTATION
// ============================================================================

describe("archiveCommunity mutation", () => {
  test("primary admin can archive the community", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    expect(result?.isArchived).toBe(true);
    expect(result?.archivedAt).toBeGreaterThan(0);
    expect(result?.archivedById).toBe(setup.primaryAdminId);
  });

  test("regular admin (not primary) cannot archive", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await expect(
      t.mutation(api.functions.admin.settings.archiveCommunity, {
        token: setup.adminToken,
        communityId: setup.communityId,
      })
    ).rejects.toThrow("Primary Admin role required");

    // Community remains un-archived
    const community = await t.run((ctx) => ctx.db.get(setup.communityId));
    expect(community?.isArchived ?? false).toBe(false);
  });

  test("regular member cannot archive", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await expect(
      t.mutation(api.functions.admin.settings.archiveCommunity, {
        token: setup.memberToken,
        communityId: setup.communityId,
      })
    ).rejects.toThrow("Primary Admin role required");
  });

  test("archiving is idempotent (archiving twice succeeds)", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    const second = await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    expect(second?.isArchived).toBe(true);
  });

  test("getCommunitySettings exposes the isArchived flag", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const before = await t.query(api.functions.admin.settings.getCommunitySettings, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });
    expect(before.isArchived).toBe(false);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    const after = await t.query(api.functions.admin.settings.getCommunitySettings, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });
    expect(after.isArchived).toBe(true);
  });
});

// ============================================================================
// Archived communities block entry / joining
// ============================================================================

describe("archived communities block access", () => {
  test("cannot join an archived community", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    await expect(
      t.mutation(api.functions.communities.join, {
        token: setup.outsiderToken,
        communityId: setup.communityId,
      })
    ).rejects.toThrow("not available to join");
  });

  test("can join a non-archived community (control)", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Should not throw for an active community.
    await t.mutation(api.functions.communities.join, {
      token: setup.outsiderToken,
      communityId: setup.communityId,
    });

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", setup.outsiderId).eq("communityId", setup.communityId)
        )
        .first();
    });
    expect(membership?.status).toBe(1);
  });
});

// ============================================================================
// Archived communities hidden from discovery
// ============================================================================

describe("archived communities hidden from discovery", () => {
  test("listForUser omits archived communities", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const before = await t.query(api.functions.communities.listForUser, {
      token: setup.primaryAdminToken,
    });
    expect(before.some((c: any) => c?._id === setup.communityId)).toBe(true);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    const after = await t.query(api.functions.communities.listForUser, {
      token: setup.primaryAdminToken,
    });
    expect(after.some((c: any) => c?._id === setup.communityId)).toBe(false);
  });

  test("listPublic omits archived communities", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    const result = await t.query(api.functions.communities.listPublic, {});
    expect(result.items.some((c: any) => c._id === setup.communityId)).toBe(false);
  });

  test("communitySearch omits archived communities", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const before = await t.query(api.functions.resources.communitySearch, {
      query: "grace",
    });
    expect(before.data.some((c) => c.id === setup.communityId)).toBe(true);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    const after = await t.query(api.functions.resources.communitySearch, {
      query: "grace",
    });
    expect(after.data.some((c) => c.id === setup.communityId)).toBe(false);
  });

  test("communitySearchBySubdomain rejects archived communities", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Resolvable by exact subdomain before archiving.
    const before = await t.query(
      api.functions.resources.communitySearchBySubdomain,
      { subdomain: "grace" }
    );
    expect(before.id).toBe(setup.communityId);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    // Exact-subdomain lookup no longer returns the archived community.
    await expect(
      t.query(api.functions.resources.communitySearchBySubdomain, {
        subdomain: "grace",
      })
    ).rejects.toThrow("Community not found");
  });
});

// ============================================================================
// Additional entry-path guards (regression coverage)
// ============================================================================

describe("archived communities block additional entry paths", () => {
  test("selectCommunityForUser rejects an archived community", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    // Even an existing member can't re-enter via the direct picker mutation.
    await expect(
      t.mutation(api.functions.authInternal.selectCommunityForUser, {
        token: setup.memberToken,
        communityId: setup.communityId,
      })
    ).rejects.toThrow("archived");
  });

  test("password signup cannot create a session in an archived community", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    // The signup action delegates to createUserWithPasswordInternal, which is
    // where the guard lives — exercise it directly.
    await expect(
      t.mutation(internal.functions.authInternal.createUserWithPasswordInternal, {
        firstName: "New",
        lastName: "User",
        email: "newuser@test.com",
        passwordHash: "hashed",
        dateOfBirth: 0,
        phone: "+12025559999",
        phoneVerified: true,
        communityId: setup.communityId,
      })
    ).rejects.toThrow("not available");
  });
});

// ============================================================================
// A live session scoped to an archived community is hard-blocked
// ============================================================================

describe("archived communities are inaccessible to a live session", () => {
  test("requireAuth rejects a request scoped to an archived community", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);
    // A real login mints a token scoped to the active community.
    const scopedToken = (
      await generateTokens(setup.memberId, setup.communityId)
    ).accessToken;

    // Works before archiving.
    await t.mutation(api.functions.users.recordActivity, { token: scopedToken });

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    // Any community-scoped request is now hard-blocked, even with a still-valid
    // 30-day access token.
    await expect(
      t.mutation(api.functions.users.recordActivity, { token: scopedToken })
    ).rejects.toThrow("COMMUNITY_ARCHIVED");
  });

  test("escape hatches still work with an archived-scoped token", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);
    const scopedToken = (
      await generateTokens(setup.memberId, setup.communityId)
    ).accessToken;

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    // Listing communities and clearing the active community must still work so
    // the stuck user can get to community selection.
    await expect(
      t.query(api.functions.communities.listForUser, { token: scopedToken })
    ).resolves.toBeDefined();
    await expect(
      t.mutation(api.functions.users.clearActiveCommunity, { token: scopedToken })
    ).resolves.toEqual({ success: true });
  });

  test("users.me hides an archived active community and flags it", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);
    // Point the member's stored active community at the one we'll archive.
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.memberId, {
        activeCommunityId: setup.communityId,
      });
    });

    await t.mutation(api.functions.admin.settings.archiveCommunity, {
      token: setup.primaryAdminToken,
      communityId: setup.communityId,
    });

    const me = await t.query(api.functions.users.me, {
      token: setup.memberToken,
    });
    expect(me?.activeCommunityArchived).toBe(true);
    expect(me?.activeCommunityId).toBeNull();
    expect(
      (me?.communityMemberships ?? []).some(
        (m: any) => m.communityId === setup.communityId
      )
    ).toBe(false);
  });
});
