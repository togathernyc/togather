/**
 * Group Archiving Tests
 *
 * Ensures archived groups are hidden from member-facing surfaces and
 * only visible/manageable by community admins.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

// Set up JWT secret for testing - must be at least 32 characters
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
} as const;

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Archiving Test Community",
      slug: "archiving-test",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    const memberId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "User",
      email: "member-arch@test.com",
      createdAt: now,
      updatedAt: now,
    });

    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      email: "admin-arch@test.com",
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

    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    const activeGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Active Group",
      description: "Visible group",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const archivedGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Archived Group",
      description: "Hidden group",
      isArchived: true,
      archivedAt: now,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    // Member is in both groups (historically)
    await ctx.db.insert("groupMembers", {
      groupId: activeGroupId,
      userId: memberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: archivedGroupId,
      userId: memberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    return {
      communityId,
      groupTypeId,
      memberId,
      adminId,
      activeGroupId,
      archivedGroupId,
    };
  });
}

describe("Group archiving behavior", () => {
  test("listForUser excludes archived groups", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const { accessToken: memberToken } = await generateTokens(ids.memberId);

    const groups = await t.query(api.functions.groups.index.listForUser, {
      token: memberToken,
      communityId: ids.communityId,
      limit: 100,
    });

    expect(groups.map((g) => g._id)).toEqual([ids.activeGroupId]);
  });

  test("listByCommunity excludes archived groups", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const groups = await t.query(api.functions.groups.index.listByCommunity, {
      communityId: ids.communityId,
      includePrivate: true,
      limit: 100,
    });

    expect(groups.map((g) => g._id)).toEqual([ids.activeGroupId]);
  });

  test("getById hides archived groups from non-admins, but allows admin access", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const { accessToken: memberToken } = await generateTokens(ids.memberId);
    const { accessToken: adminToken } = await generateTokens(ids.adminId);

    const memberView = await t.query(api.functions.groups.index.getById, {
      groupId: ids.archivedGroupId,
      token: memberToken,
    });
    expect(memberView).toBeNull();

    const adminView = await t.query(api.functions.groups.index.getById, {
      groupId: ids.archivedGroupId,
      token: adminToken,
    });
    expect(adminView).not.toBeNull();
    expect(adminView?._id).toBe(ids.archivedGroupId);
  });

  test("listArchivedByCommunity is admin-only and returns archived groups", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const { accessToken: memberToken } = await generateTokens(ids.memberId);
    const { accessToken: adminToken } = await generateTokens(ids.adminId);

    await expect(
      t.query(api.functions.groups.index.listArchivedByCommunity, {
        token: memberToken,
        communityId: ids.communityId,
        limit: 100,
      })
    ).rejects.toThrow("Community admin role required");

    const archived = await t.query(api.functions.groups.index.listArchivedByCommunity, {
      token: adminToken,
      communityId: ids.communityId,
      limit: 100,
    });

    expect(archived).toHaveLength(1);
    expect(archived[0]._id).toBe(ids.archivedGroupId as Id<"groups">);
    expect(archived[0].isArchived).toBe(true);
  });
});

// ============================================================================
// Group archive freezes the group's giving fund (security-review FIX 4,
// ADR-032 §3 "Group archive" — freeze half only, see functions/finance/
// ARCHITECTURE.md's "Known Seams & TODOs" for the deferred bank-side sweep)
// ============================================================================

describe("Group archiving freezes the group's giving fund", () => {
  test("archiving a group with an active fund (via the real update mutation) freezes it", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const ids = await seed(t);
      const { accessToken: adminToken } = await generateTokens(ids.adminId);

      const fundId = await t.run(async (ctx) => {
        const timestamp = Date.now();
        return await ctx.db.insert("funds", {
          communityId: ids.communityId,
          groupId: ids.activeGroupId,
          name: "Active Group Fund",
          type: "group",
          status: "active",
          balanceCents: 500,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      });

      // The real archive path — this is what actually cascades in
      // production, not the direct internal-mutation call the finance test
      // suite exercises separately.
      await t.mutation(api.functions.groups.mutations.update, {
        token: adminToken,
        groupId: ids.activeGroupId,
        isArchived: true,
      });

      // freezeFundForArchivedGroup is scheduled (ctx.scheduler.runAfter),
      // not run inline — drain it the same way finance-onboarding.test.ts
      // drains provisionProviders/provisionGroupFundAccount.
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const fund = await t.run((ctx) => ctx.db.get(fundId));
      expect(fund?.status).toBe("frozen");

      const auditEvents = await t.run((ctx) =>
        ctx.db
          .query("financeAuditEvents")
          .withIndex("by_fund", (q) => q.eq("fundId", fundId))
          .collect(),
      );
      expect(auditEvents.some((e) => e.action === "fund.frozen")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("archiving a group with no fund is unaffected (no fund to freeze)", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema, modules);
      const ids = await seed(t);
      const { accessToken: adminToken } = await generateTokens(ids.adminId);

      await t.mutation(api.functions.groups.mutations.update, {
        token: adminToken,
        groupId: ids.activeGroupId,
        isArchived: true,
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const group = await t.run((ctx) => ctx.db.get(ids.activeGroupId));
      expect(group?.isArchived).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

