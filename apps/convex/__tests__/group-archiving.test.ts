/**
 * Group Archiving Tests
 *
 * Ensures archived groups are hidden from member-facing surfaces and
 * only visible/manageable by community admins.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
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

