/**
 * Community Membership Tests
 *
 * Tests for community join/leave/remove flows and ensuring proper cleanup
 * when a user is removed from a community.
 *
 * Run with: cd convex && pnpm test __tests__/community-membership.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Use fake timers to properly handle scheduled functions
vi.useFakeTimers();

// ============================================================================
// Constants
// ============================================================================

const COMMUNITY_ROLES = {
  MEMBER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

const MEMBERSHIP_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  BLOCKED: 3,
} as const;

/**
 * Seed a community with admin and test user
 */
async function seedCommunityWithUsers(t: ReturnType<typeof convexTest>) {
  const timestamp = Date.now();

  // Create community
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "TEST001",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Create group type for announcements
  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Announcements",
      slug: "announcements",
      description: "Community announcements",
      createdAt: timestamp,
      isActive: true,
      displayOrder: 0,
    });
  });

  // Create announcement group
  const announcementGroupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Community Announcements",
      isAnnouncementGroup: true,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Create admin user
  const adminUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Add admin to community as PRIMARY_ADMIN
  await t.run(async (ctx) => {
    await ctx.db.insert("userCommunities", {
      communityId,
      userId: adminUserId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: MEMBERSHIP_STATUS.ACTIVE,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Create test user (the one who will be removed)
  const testUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555550002",
      phoneVerified: true,
      activeCommunityId: communityId, // Key: user has this community as active
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Add test user to community as MEMBER
  await t.run(async (ctx) => {
    await ctx.db.insert("userCommunities", {
      communityId,
      userId: testUserId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: MEMBERSHIP_STATUS.ACTIVE,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // Add test user to announcement group
  const testAnnouncementGroupMemberId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupMembers", {
      groupId: announcementGroupId,
      userId: testUserId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
  });

  return {
    communityId,
    groupTypeId,
    announcementGroupId,
    adminUserId,
    testUserId,
    testAnnouncementGroupMemberId,
  };
}

// ============================================================================
// Community Member Removal Tests
// ============================================================================

describe("Community Member Removal", () => {
  test("removing a user deletes followup entries and denormalized score rows", async () => {
    const t = convexTest(schema, modules);
    const { communityId, testUserId, adminUserId, announcementGroupId, testAnnouncementGroupMemberId } =
      await seedCommunityWithUsers(t);

    const timestamp = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("memberFollowups", {
        groupMemberId: testAnnouncementGroupMemberId,
        createdById: adminUserId,
        type: "note",
        content: "Should be removed with membership cleanup",
        createdAt: timestamp,
      });

      await ctx.db.insert("memberFollowupScores", {
        groupId: announcementGroupId,
        groupMemberId: testAnnouncementGroupMemberId,
        userId: testUserId,
        firstName: "Zombie",
        lastName: "Member",
        score1: 10,
        score2: 20,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 10,
        connectionScore: 20,
        followupScore: 15,
        missedMeetings: 1,
        consecutiveMissed: 1,
        scoreIds: ["default_attendance", "default_connection"],
        updatedAt: timestamp,
        addedAt: timestamp,
        searchText: "zombie member",
      });
    });

    const { accessToken: adminToken } = await generateTokens(adminUserId);
    await t.mutation(api.functions.communities.removeMember, {
      token: adminToken,
      communityId,
      targetUserId: testUserId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [membershipAfter, followupsAfter, scoreAfter] = await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", announcementGroupId).eq("userId", testUserId)
        )
        .first();
      const followups = await ctx.db
        .query("memberFollowups")
        .withIndex("by_groupMember", (q) => q.eq("groupMemberId", testAnnouncementGroupMemberId))
        .collect();
      const score = await ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) => q.eq("groupMemberId", testAnnouncementGroupMemberId))
        .first();
      return [membership, followups, score];
    });

    expect(membershipAfter).toBeNull();
    expect(followupsAfter).toHaveLength(0);
    expect(scoreAfter).toBeNull();
  });

  test("removing a user should clear their activeCommunityId if it points to the removed community", async () => {
    /**
     * BUG REPRODUCTION:
     * 1. User is member of community with activeCommunityId set to that community
     * 2. Admin removes user from community
     * 3. User's activeCommunityId should be cleared
     * 4. User should NOT be able to access the community in a zombie state
     */
    const t = convexTest(schema, modules);
    const { communityId, testUserId, adminUserId } = await seedCommunityWithUsers(t);

    // Verify initial state: user has activeCommunityId set
    const userBefore = await t.run(async (ctx) => {
      return await ctx.db.get(testUserId);
    });
    expect(userBefore?.activeCommunityId).toBe(communityId);

    // Get admin token
    const { accessToken: adminToken } = await generateTokens(adminUserId);

    // Admin removes the test user
    await t.mutation(api.functions.communities.removeMember, {
      token: adminToken,
      communityId,
      targetUserId: testUserId,
    });

    // Run scheduled functions
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify: user's activeCommunityId should be cleared
    const userAfter = await t.run(async (ctx) => {
      return await ctx.db.get(testUserId);
    });
    expect(userAfter?.activeCommunityId).toBeUndefined();

    // Verify: user is no longer in userCommunities
    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", testUserId).eq("communityId", communityId)
        )
        .first();
    });
    expect(membership).toBeNull();
  });

  test("removed user should not be able to access community data via queries", async () => {
    /**
     * After removal, queries that check community membership should fail
     */
    const t = convexTest(schema, modules);
    const { communityId, testUserId, adminUserId, announcementGroupId } =
      await seedCommunityWithUsers(t);

    const { accessToken: adminToken } = await generateTokens(adminUserId);
    const { accessToken: testUserToken } = await generateTokens(testUserId);

    // Remove the test user
    await t.mutation(api.functions.communities.removeMember, {
      token: adminToken,
      communityId,
      targetUserId: testUserId,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify: user should NOT be a member of any groups in the community
    const groupMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", announcementGroupId).eq("userId", testUserId)
        )
        .first();
    });
    expect(groupMembership).toBeNull();

    // Verify: listing groups should return empty for this user
    const userGroups = await t.query(api.functions.groups.index.listForUser, {
      token: testUserToken,
    });
    // listForUser returns an array, not { items: [] }
    expect(userGroups).toEqual([]);
  });

  test("user leaving a community should clear their activeCommunityId if it points to that community", async () => {
    /**
     * Similar to admin removal, but when user voluntarily leaves
     */
    const t = convexTest(schema, modules);
    const { communityId, testUserId, adminUserId } = await seedCommunityWithUsers(t);

    // Make test user an admin so they can leave (non-primary admins can leave)
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", testUserId).eq("communityId", communityId)
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, {
          roles: COMMUNITY_ROLES.ADMIN, // Admin, not PRIMARY_ADMIN
        });
      }
    });

    const { accessToken: testUserToken } = await generateTokens(testUserId);

    // User leaves the community
    await t.mutation(api.functions.communities.leave, {
      token: testUserToken,
      communityId,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify: user's activeCommunityId should be cleared
    const userAfter = await t.run(async (ctx) => {
      return await ctx.db.get(testUserId);
    });
    expect(userAfter?.activeCommunityId).toBeUndefined();
  });

  test("removing user should only clear activeCommunityId if it matches the removed community", async () => {
    /**
     * If user is active in a DIFFERENT community, that should not be affected
     */
    const t = convexTest(schema, modules);
    const timestamp = Date.now();

    // Create two communities
    const community1Id = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Community 1",
        slug: "COM001",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const community2Id = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Community 2",
        slug: "COM002",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    // Create admin user
    const adminUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "User",
        phone: "+15555550010",
        phoneVerified: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    // Add admin to community 1 as PRIMARY_ADMIN
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId: community1Id,
        userId: adminUserId,
        roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
        status: MEMBERSHIP_STATUS.ACTIVE,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    // Create test user with activeCommunityId pointing to community 2 (not community 1)
    const testUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Test",
        lastName: "User",
        phone: "+15555550011",
        phoneVerified: true,
        activeCommunityId: community2Id, // Active in community 2
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    // Add test user to community 1 (where they'll be removed from)
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId: community1Id,
        userId: testUserId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: MEMBERSHIP_STATUS.ACTIVE,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    // Add test user to community 2 (where they're active)
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId: community2Id,
        userId: testUserId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: MEMBERSHIP_STATUS.ACTIVE,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const { accessToken: adminToken } = await generateTokens(adminUserId);

    // Admin removes test user from community 1
    await t.mutation(api.functions.communities.removeMember, {
      token: adminToken,
      communityId: community1Id,
      targetUserId: testUserId,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify: user's activeCommunityId should STILL point to community 2
    const userAfter = await t.run(async (ctx) => {
      return await ctx.db.get(testUserId);
    });
    expect(userAfter?.activeCommunityId).toBe(community2Id);
  });
});
