/**
 * Permission Tests
 *
 * Tests for role-based permissions using the convex-test library.
 *
 * Tests cover:
 * - Group Leader Permissions (meetings.create)
 * - Group Member Permissions (groupMembers.updateRole, groupMembers.remove)
 * - Community Admin Permissions (communities.updateMemberRole)
 *
 * Authentication Approach:
 * Since convex-test runs real function code, we generate real JWT tokens
 * using the auth library's generateTokens function for testing.
 *
 * Run with: cd convex && pnpm test __tests__/permissions.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
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

const GROUP_ROLES = {
  member: "member",
  leader: "leader",
  admin: "admin",
} as const;

// ============================================================================
// Test Setup Helper
// ============================================================================

interface TestSetup {
  adminId: Id<"users">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupId: Id<"groups">;
  announcementGroupId: Id<"groups">;
  adminMembershipId: Id<"groupMembers">;
  leaderMembershipId: Id<"groupMembers">;
  memberMembershipId: Id<"groupMembers">;
  adminCommunityMembershipId: Id<"userCommunities">;
  memberCommunityMembershipId: Id<"userCommunities">;
  // Tokens for each user
  adminToken: string;
  leaderToken: string;
  memberToken: string;
}

/**
 * Seeds the database with test users, community, groups, and memberships.
 * Also generates valid JWT tokens for each user.
 */
async function seedTestData(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    // Create users
    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      email: "admin@test.com",
      phone: "+12025551001",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const leaderId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "User",
      email: "leader@test.com",
      phone: "+12025551002",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const memberId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "User",
      email: "member@test.com",
      phone: "+12025551003",
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

    // Create regular group
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      description: "A test group",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create announcement group
    const announcementGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Community Announcements",
      description: "Official announcements",
      isArchived: false,
      isPublic: true,
      isAnnouncementGroup: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create group memberships
    const adminMembershipId = await ctx.db.insert("groupMembers", {
      groupId,
      userId: adminId,
      role: GROUP_ROLES.admin,
      joinedAt: now - 60 * 24 * 60 * 60 * 1000,
      notificationsEnabled: true,
    });

    const leaderMembershipId = await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: GROUP_ROLES.leader,
      joinedAt: now - 30 * 24 * 60 * 60 * 1000,
      notificationsEnabled: true,
    });

    const memberMembershipId = await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberId,
      role: GROUP_ROLES.member,
      joinedAt: now - 15 * 24 * 60 * 60 * 1000,
      notificationsEnabled: true,
    });

    // Create community memberships
    const adminCommunityMembershipId = await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    const memberCommunityMembershipId = await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    return {
      adminId,
      leaderId,
      memberId,
      communityId,
      groupTypeId,
      groupId,
      announcementGroupId,
      adminMembershipId,
      leaderMembershipId,
      memberMembershipId,
      adminCommunityMembershipId,
      memberCommunityMembershipId,
    };
  });

  // Generate JWT tokens for each user
  const [adminTokens, leaderTokens, memberTokens] = await Promise.all([
    generateTokens(ids.adminId),
    generateTokens(ids.leaderId),
    generateTokens(ids.memberId),
  ]);

  return {
    ...ids,
    adminToken: adminTokens.accessToken,
    leaderToken: leaderTokens.accessToken,
    memberToken: memberTokens.accessToken,
  };
}

// ============================================================================
// GROUP LEADER PERMISSION TESTS - meetings.create
// ============================================================================

describe("Group Leader Permissions - meetings.create", () => {
  test("throws 'Only group leaders can create events' when non-leader tries to create", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    await expect(
      t.mutation(api.functions.meetings.index.create, {
        token: setup.memberToken,
        groupId: setup.groupId,
        scheduledAt: Date.now() + 86400000,
        meetingType: 1,
      })
    ).rejects.toThrow("Only group leaders can create events");
  });

  test("succeeds when leader creates event", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: setup.leaderToken,
      groupId: setup.groupId,
      scheduledAt: Date.now() + 86400000,
      meetingType: 1,
    });

    expect(meetingId).toBeDefined();

    // Verify meeting was created
    const meeting = await t.run(async (ctx) => {
      return await ctx.db.get(meetingId);
    });

    expect(meeting).toBeDefined();
    expect(meeting?.groupId).toBe(setup.groupId);
    expect(meeting?.status).toBe("scheduled");
    expect(meeting?.createdById).toBe(setup.leaderId);

    // Finish all scheduled functions (notifications for meeting creation)
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  test("succeeds when admin role in group creates event", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: setup.adminToken,
      groupId: setup.groupId,
      scheduledAt: Date.now() + 86400000,
      meetingType: 1,
    });

    expect(meetingId).toBeDefined();

    // Finish all scheduled functions (notifications for meeting creation)
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  test("throws when non-member tries to create event", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Create a user who is not a member of the group
    const nonMemberId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "NonMember",
        lastName: "User",
        email: "nonmember@test.com",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken: nonMemberToken } = await generateTokens(nonMemberId);

    await expect(
      t.mutation(api.functions.meetings.index.create, {
        token: nonMemberToken,
        groupId: setup.groupId,
        scheduledAt: Date.now() + 86400000,
        meetingType: 1,
      })
    ).rejects.toThrow("Only group leaders can create events");
  });

  test("throws when former member (leftAt set) tries to create event", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Update leader's membership to have leftAt set (former leader)
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.leaderMembershipId, {
        leftAt: Date.now() - 24 * 60 * 60 * 1000, // Left yesterday
      });
    });

    await expect(
      t.mutation(api.functions.meetings.index.create, {
        token: setup.leaderToken,
        groupId: setup.groupId,
        scheduledAt: Date.now() + 86400000,
        meetingType: 1,
      })
    ).rejects.toThrow("Only group leaders can create events");
  });
});

// ============================================================================
// GROUP MEMBER PERMISSION TESTS - groupMembers.updateRole
// ============================================================================

describe("Group Member Permissions - groupMembers.updateRole", () => {
  test("throws when non-leader tries to update member roles", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Create a new user to be the target of the role change
    const newUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        firstName: "New",
        lastName: "User",
        email: "new@test.com",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Add as member
      await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId,
        role: GROUP_ROLES.member,
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return userId;
    });

    await expect(
      t.mutation(api.functions.groupMembers.updateRole, {
        token: setup.memberToken,
        groupId: setup.groupId,
        userId: newUserId,
        role: "leader",
      })
    ).rejects.toThrow("Only group leaders or community admins can update member roles");
  });

  test("succeeds when leader updates member role", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.groupMembers.updateRole, {
      token: setup.leaderToken,
      groupId: setup.groupId,
      userId: setup.memberId,
      role: "leader",
    });

    expect(result).toBeDefined();
    expect(result.role).toBe("leader");

    // Verify the role was actually updated in the database
    const membership = await t.run(async (ctx) => {
      return await ctx.db.get(setup.memberMembershipId);
    });

    expect(membership?.role).toBe("leader");

    // Finish all scheduled functions (notification for leader promotion)
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  test("succeeds when leader has historical inactive membership row", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Simulate leave/rejoin: old membership inactive, newer membership active.
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.leaderMembershipId, {
        leftAt: Date.now() - 60_000,
      });
      await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId: setup.leaderId,
        role: GROUP_ROLES.leader,
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    const result = await t.mutation(api.functions.groupMembers.updateRole, {
      token: setup.leaderToken,
      groupId: setup.groupId,
      userId: setup.memberId,
      role: "leader",
    });

    expect(result).toBeDefined();
    expect(result.role).toBe("leader");

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  test("succeeds when target member has historical inactive membership row", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Simulate leave/rejoin for the target member.
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.memberMembershipId, {
        leftAt: Date.now() - 60_000,
      });
      await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId: setup.memberId,
        role: GROUP_ROLES.member,
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    const result = await t.mutation(api.functions.groupMembers.updateRole, {
      token: setup.leaderToken,
      groupId: setup.groupId,
      userId: setup.memberId,
      role: "leader",
    });

    expect(result).toBeDefined();
    expect(result.role).toBe("leader");

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
  });

  test("throws when former leader tries to update roles", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Mark leader as having left the group
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.leaderMembershipId, {
        leftAt: Date.now() - 24 * 60 * 60 * 1000,
      });
    });

    await expect(
      t.mutation(api.functions.groupMembers.updateRole, {
        token: setup.leaderToken,
        groupId: setup.groupId,
        userId: setup.memberId,
        role: "leader",
      })
    ).rejects.toThrow("Only group leaders or community admins can update member roles");
  });
});

// ============================================================================
// GROUP MEMBER PERMISSION TESTS - groupMembers.remove
// ============================================================================

describe("Group Member Permissions - groupMembers.remove", () => {
  test("throws when non-leader tries to remove another member", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Create another member to be removed
    const targetUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        firstName: "Target",
        lastName: "User",
        email: "target@test.com",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId,
        role: GROUP_ROLES.member,
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return userId;
    });

    await expect(
      t.mutation(api.functions.groupMembers.remove, {
        token: setup.memberToken,
        groupId: setup.groupId,
        userId: targetUserId,
      })
    ).rejects.toThrow("Only group leaders can remove other members");
  });

  test("succeeds when leader removes a member", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.groupMembers.remove, {
      token: setup.leaderToken,
      groupId: setup.groupId,
      userId: setup.memberId,
    });

    expect(result).toEqual({ success: true });

    // Verify the membership now has leftAt set
    const membership = await t.run(async (ctx) => {
      return await ctx.db.get(setup.memberMembershipId);
    });

    expect(membership?.leftAt).toBeDefined();
  });

  test("succeeds when member removes themselves (self-removal/leaving)", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.groupMembers.remove, {
      token: setup.memberToken,
      groupId: setup.groupId,
      userId: setup.memberId, // Same as authenticated user
    });

    expect(result).toEqual({ success: true });

    // Verify the membership now has leftAt set
    const membership = await t.run(async (ctx) => {
      return await ctx.db.get(setup.memberMembershipId);
    });

    expect(membership?.leftAt).toBeDefined();
  });

  test("throws when trying to leave announcement group", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Add member to announcement group
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId: setup.announcementGroupId,
        userId: setup.memberId,
        role: GROUP_ROLES.member,
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    await expect(
      t.mutation(api.functions.groupMembers.remove, {
        token: setup.memberToken,
        groupId: setup.announcementGroupId,
        userId: setup.memberId,
      })
    ).rejects.toThrow("You cannot leave Community Announcements");
  });

  test("throws when former leader tries to remove others", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Mark leader as having left the group
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.leaderMembershipId, {
        leftAt: Date.now() - 24 * 60 * 60 * 1000,
      });
    });

    await expect(
      t.mutation(api.functions.groupMembers.remove, {
        token: setup.leaderToken,
        groupId: setup.groupId,
        userId: setup.memberId,
      })
    ).rejects.toThrow("Only group leaders can remove other members");
  });
});

// ============================================================================
// COMMUNITY ADMIN PERMISSION TESTS - communities.updateMemberRole
// ============================================================================

describe("Community Admin Permissions - communities.updateMemberRole", () => {
  test("throws when non-admin tries to update community roles", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Create a target user in the community
    const targetUserId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        firstName: "Target",
        lastName: "User",
        email: "target@test.com",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("userCommunities", {
        userId,
        communityId: setup.communityId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return userId;
    });

    await expect(
      t.mutation(api.functions.communities.updateMemberRole, {
        token: setup.memberToken,
        communityId: setup.communityId,
        targetUserId,
        roles: COMMUNITY_ROLES.MODERATOR,
      })
    ).rejects.toThrow("Community admin role required");
  });

  test("throws when moderator (role 2) tries to update roles", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Create a moderator user
    const moderatorId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        firstName: "Moderator",
        lastName: "User",
        email: "mod@test.com",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("userCommunities", {
        userId,
        communityId: setup.communityId,
        roles: COMMUNITY_ROLES.MODERATOR,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return userId;
    });

    const { accessToken: moderatorToken } = await generateTokens(moderatorId);

    await expect(
      t.mutation(api.functions.communities.updateMemberRole, {
        token: moderatorToken,
        communityId: setup.communityId,
        targetUserId: setup.memberId,
        roles: COMMUNITY_ROLES.ADMIN,
      })
    ).rejects.toThrow("Community admin role required");
  });

  test("succeeds when admin updates member role", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    const result = await t.mutation(api.functions.communities.updateMemberRole, {
      token: setup.adminToken,
      communityId: setup.communityId,
      targetUserId: setup.memberId,
      roles: COMMUNITY_ROLES.MODERATOR,
    });

    expect(result).toBe(true);

    // Verify the role was updated
    const membership = await t.run(async (ctx) => {
      return await ctx.db.get(setup.memberCommunityMembershipId);
    });

    expect(membership?.roles).toBe(COMMUNITY_ROLES.MODERATOR);
  });

  test("throws when inactive admin tries to update roles", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Make admin inactive
    await t.run(async (ctx) => {
      await ctx.db.patch(setup.adminCommunityMembershipId, {
        status: 2, // Inactive
      });
    });

    await expect(
      t.mutation(api.functions.communities.updateMemberRole, {
        token: setup.adminToken,
        communityId: setup.communityId,
        targetUserId: setup.memberId,
        roles: COMMUNITY_ROLES.MODERATOR,
      })
    ).rejects.toThrow("Community admin role required");
  });

  test("throws when target user is not a community member", async () => {
    const t = convexTest(schema, modules);
    const setup = await seedTestData(t);

    // Create a user who is NOT a community member
    const nonMemberId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "NonMember",
        lastName: "User",
        email: "nonmember@test.com",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.functions.communities.updateMemberRole, {
        token: setup.adminToken,
        communityId: setup.communityId,
        targetUserId: nonMemberId,
        roles: COMMUNITY_ROLES.MODERATOR,
      })
    ).rejects.toThrow("Not a member of this community");
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe("Permission Edge Cases", () => {
  describe("Role hierarchy in groups", () => {
    test("admin role in group can perform leader actions", async () => {
      vi.useFakeTimers();
      const t = convexTest(schema, modules);
      const setup = await seedTestData(t);

      const meetingId = await t.mutation(api.functions.meetings.index.create, {
        token: setup.adminToken,
        groupId: setup.groupId,
        scheduledAt: Date.now() + 86400000,
        meetingType: 1,
      });

      expect(meetingId).toBeDefined();

      // Finish all scheduled functions (notifications for meeting creation)
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      vi.useRealTimers();
    });
  });
});

// ============================================================================
// INTEGRATION-LIKE PERMISSION FLOW TESTS
// ============================================================================

describe("Permission Flow Integration", () => {
  describe("Leader workflow", () => {
    test("leader can create event", async () => {
      vi.useFakeTimers();
      const t = convexTest(schema, modules);
      const setup = await seedTestData(t);

      // Create event
      const meetingId = await t.mutation(api.functions.meetings.index.create, {
        token: setup.leaderToken,
        groupId: setup.groupId,
        scheduledAt: Date.now() + 86400000,
        meetingType: 1,
      });

      expect(meetingId).toBeDefined();

      // Verify meeting was created correctly
      const meeting = await t.run(async (ctx) => {
        return await ctx.db.get(meetingId);
      });

      expect(meeting?.groupId).toBe(setup.groupId);
      expect(meeting?.status).toBe("scheduled");

      // Finish all scheduled functions (notifications for meeting creation)
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      vi.useRealTimers();
    });
  });

  describe("Member limitations", () => {
    test("member can only leave group, cannot perform leader actions", async () => {
      const t = convexTest(schema, modules);
      const setup = await seedTestData(t);

      // Cannot create events
      await expect(
        t.mutation(api.functions.meetings.index.create, {
          token: setup.memberToken,
          groupId: setup.groupId,
          scheduledAt: Date.now() + 86400000,
          meetingType: 1,
        })
      ).rejects.toThrow("Only group leaders can create events");

      // But CAN leave (self-removal)
      const leaveResult = await t.mutation(api.functions.groupMembers.remove, {
        token: setup.memberToken,
        groupId: setup.groupId,
        userId: setup.memberId, // Removing self
      });

      expect(leaveResult).toEqual({ success: true });
    });
  });
});
