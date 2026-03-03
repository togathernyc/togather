/**
 * Admin People Page Tests
 *
 * Tests for the admin people management functionality:
 * - getCommunityMemberById should correctly count group memberships (detail view)
 * - listCommunityMembers should be fast (no group counts in list view)
 * - updateLastActivity should update lastLogin timestamp
 *
 * Run with: cd apps/convex && pnpm test __tests__/admin-people.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

// Set up JWT secret for testing - must be at least 32 characters
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Role Constants
// ============================================================================

const COMMUNITY_ROLES = {
  MEMBER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

// ============================================================================
// Test Setup Helper
// ============================================================================

interface TestSetup {
  adminId: Id<"users">;
  memberId: Id<"users">;
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  group1Id: Id<"groups">;
  group2Id: Id<"groups">;
  group3Id: Id<"groups">;
  memberCommunityMembershipId: Id<"userCommunities">;
  adminToken: string;
}

/**
 * Seeds the database with test users, community, groups, and memberships.
 * Creates a member with memberships in 3 groups - some with requestStatus undefined,
 * some with null, some with "accepted" to test the filtering logic.
 */
async function seedTestData(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    // Create admin user
    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      email: "admin@test.com",
      phone: "+12025551001",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create member user
    const memberId = await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "Member",
      email: "member@test.com",
      phone: "+12025551002",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create community
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    // Create group type
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    // Create 3 groups
    const group1Id = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group 1",
      description: "Test group 1",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const group2Id = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group 2",
      description: "Test group 2",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const group3Id = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group 3",
      description: "Test group 3",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create admin community membership
    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: 1, // active
      createdAt: now,
    });

    // Create member community membership
    const memberCommunityMembershipId = await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1, // active
      createdAt: now,
    });

    // Create group memberships for the member with different requestStatus values:
    // - Group 1: requestStatus undefined (not set - this is the common case)
    // - Group 2: requestStatus undefined (another common case)
    // - Group 3: requestStatus "accepted"
    await ctx.db.insert("groupMembers", {
      groupId: group1Id,
      userId: memberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
      // requestStatus not set - should be undefined
    });

    await ctx.db.insert("groupMembers", {
      groupId: group2Id,
      userId: memberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
      // requestStatus not set - should be undefined
    });

    await ctx.db.insert("groupMembers", {
      groupId: group3Id,
      userId: memberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
      requestStatus: "accepted", // explicitly accepted
    });

    return {
      adminId,
      memberId,
      communityId,
      groupTypeId,
      group1Id,
      group2Id,
      group3Id,
      memberCommunityMembershipId,
    };
  });

  // Generate token for admin user
  const adminTokens = await generateTokens(ids.adminId, ids.communityId);

  return { ...ids, adminToken: adminTokens.accessToken };
}

// ============================================================================
// Tests for getCommunityMemberById - Group Membership Count Bug
// ============================================================================

describe("getCommunityMemberById - group memberships", () => {
  test("should include all active group memberships regardless of requestStatus value", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Call getCommunityMemberById to get member details
    const memberDetails = await t.query(api.functions.admin.index.getCommunityMemberById, {
      token: setup.adminToken,
      communityId: setup.communityId,
      targetUserId: setup.memberId,
    });

    // Should have 3 active groups:
    // - Group 1 (requestStatus undefined)
    // - Group 2 (requestStatus undefined)
    // - Group 3 (requestStatus "accepted")
    expect(memberDetails.activeGroups).toHaveLength(3);

    // Verify the group names are present
    const groupNames = memberDetails.activeGroups.map((g: any) => g.groupName).sort();
    expect(groupNames).toEqual(["Group 1", "Group 2", "Group 3"]);
  });

  test("should not include memberships with requestStatus 'pending' or 'denied'", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Add a 4th group and membership with pending status
    await t.run(async (ctx) => {
      const group4Id = await ctx.db.insert("groups", {
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        name: "Group 4",
        description: "Test group 4",
        isArchived: false,
        isPublic: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("groupMembers", {
        groupId: group4Id,
        userId: setup.memberId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
        requestStatus: "pending",
      });
    });

    // Wait a bit for consistency
    const memberDetails = await t.query(api.functions.admin.index.getCommunityMemberById, {
      token: setup.adminToken,
      communityId: setup.communityId,
      targetUserId: setup.memberId,
    });

    // Should still have 3 active groups (pending should be excluded)
    // The member already has 3 memberships with valid requestStatus
    expect(memberDetails.activeGroups).toHaveLength(3);
  });

  test("should not include memberships with leftAt set", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Mark one membership as left
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .filter((q) =>
          q.and(
            q.eq(q.field("userId"), setup.memberId),
            q.eq(q.field("groupId"), setup.group1Id)
          )
        )
        .first();

      if (membership) {
        await ctx.db.patch(membership._id, { leftAt: Date.now() });
      }
    });

    const memberDetails = await t.query(api.functions.admin.index.getCommunityMemberById, {
      token: setup.adminToken,
      communityId: setup.communityId,
      targetUserId: setup.memberId,
    });

    // Should have 2 active groups (one was marked as left)
    expect(memberDetails.activeGroups).toHaveLength(2);
  });
});

// ============================================================================
// Tests for listCommunityMembers - Performance Optimization
// ============================================================================

describe("listCommunityMembers - performance", () => {
  test("should return members quickly without fetching group counts", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.query(api.functions.admin.index.listCommunityMembers, {
      token: setup.adminToken,
      communityId: setup.communityId,
      pageSize: 50,
      page: 1,
    });

    expect(result.members).toBeDefined();
    expect(result.members.length).toBeGreaterThan(0);

    // Verify groupsCount field exists but is 0 (not computed in list view for performance)
    // Actual group counts are shown in the detail view (getCommunityMemberById)
    for (const member of result.members) {
      expect(member).toHaveProperty("groupsCount");
      expect(member.groupsCount).toBe(0); // Not fetched in list view
    }

    // Verify essential fields are present
    const testMember = result.members.find((m: any) => m.id === setup.memberId);
    expect(testMember).toBeDefined();
    expect(testMember?.firstName).toBe("Test");
    expect(testMember?.lastName).toBe("Member");
  });
});

// ============================================================================
// Tests for updateLastActivity - Last Login Fix
// ============================================================================

describe("updateLastActivity - last login tracking", () => {
  test("should update lastLogin timestamp when called", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Get initial lastLogin value
    const initialMembership = await t.run(async (ctx) => {
      return ctx.db.get(setup.memberCommunityMembershipId);
    });

    const initialLastLogin = initialMembership?.lastLogin ?? null;

    // Wait a small amount to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Generate token for member
    const memberTokens = await generateTokens(setup.memberId, setup.communityId);
    const memberToken = memberTokens.accessToken;

    // Call updateLastActivity action
    await t.action(api.functions.auth.index.updateLastActivity, {
      token: memberToken,
    });

    // Verify lastLogin was updated
    const updatedMembership = await t.run(async (ctx) => {
      return ctx.db.get(setup.memberCommunityMembershipId);
    });

    expect(updatedMembership?.lastLogin).toBeDefined();
    expect(updatedMembership?.lastLogin).not.toEqual(initialLastLogin);

    // LastLogin should be recent (within last second)
    const now = Date.now();
    expect(updatedMembership?.lastLogin).toBeGreaterThan(now - 1000);
    expect(updatedMembership?.lastLogin).toBeLessThanOrEqual(now);
  });
});
