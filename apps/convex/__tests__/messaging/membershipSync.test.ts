/**
 * Membership Sync Tests for Convex-Native Messaging
 *
 * Tests automatic channel membership sync when group membership changes:
 * - User joins group → Added to main channel
 * - User leaves group → Removed from all group channels
 * - User promoted to leader → Added to leaders channel
 * - User demoted from leader → Removed from leaders channel
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach, vi, afterEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

// Use fake timers to properly handle scheduled functions
vi.useFakeTimers();

// Clean up after each test to prevent unhandled errors from scheduled functions
afterEach(async () => {
  // Note: We don't have access to the test instance here, so scheduled functions
  // from tests that intentionally skip finishAllScheduledFunctions may still exist.
  // Using fake timers prevents them from actually executing.
  vi.clearAllTimers();
});

// Helper to directly sync channel memberships in tests
// This bypasses the scheduler since it doesn't work synchronously in tests
async function syncChannelMemberships(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  groupId: Id<"groups">
) {
  await t.action(api.functions.messaging.channels.testSyncUserChannelMemberships, {
    userId,
    groupId,
  });
  // Wait for all scheduled functions (including those from the mutation hooks)
  // Using vi.runAllTimers as recommended by convex-test docs
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

// Helper to sync memberships (including announcement group) in tests
async function syncMemberships(
  t: ReturnType<typeof convexTest>,
  args: {
    userId: Id<"users">;
    groupId?: Id<"groups">;
    syncAnnouncementGroup?: boolean;
    communityId?: Id<"communities">;
  }
) {
  await t.action(api.functions.sync.memberships.testSyncMemberships, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

// Set up environment variables
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Test Helpers
// ============================================================================

interface TestData {
  userId: Id<"users">;
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupId: Id<"groups">;
  mainChannelId: Id<"chatChannels">;
  leadersChannelId: Id<"chatChannels">;
  accessToken: string;
}

async function seedTestDataWithChannels(t: ReturnType<typeof convexTest>): Promise<TestData> {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    });
  });

  // Create a user who will be the group creator/leader
  const creatorId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Creator",
      lastName: "User",
      phone: "+15555550000",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Test Group",
      communityId,
      groupTypeId,
      isPublic: true,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Add creator as leader
  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId: creatorId,
      groupId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  // Create main and leaders channels
  const mainChannelId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatChannels", {
      groupId,
      channelType: "main",
      name: "General",
      slug: "general",
      createdById: creatorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      memberCount: 0,
    });
  });

  const leadersChannelId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatChannels", {
      groupId,
      channelType: "leaders",
      name: "Leaders Hub",
      slug: "leaders",
      createdById: creatorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      memberCount: 0,
    });
  });

  // Create a test user (not yet a member)
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const { accessToken } = await generateTokens(userId);

  return {
    userId,
    communityId,
    groupTypeId,
    groupId,
    mainChannelId,
    leadersChannelId,
    accessToken,
  };
}

async function getChannelMembership(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"chatChannels">,
  userId: Id<"users">
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId)
      )
      .first();
  });
}

// ============================================================================
// Join Group → Channel Membership Tests
// ============================================================================

describe("Join Group → Channel Membership Sync", () => {
  test("should add user to main channel when joining a group", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, mainChannelId, accessToken } = await seedTestDataWithChannels(t);

    // Verify user is NOT in main channel before joining
    const beforeJoin = await getChannelMembership(t, mainChannelId, userId);
    expect(beforeJoin).toBeNull();

    // User joins the group
    await t.mutation(api.functions.groups.index.join, {
      token: accessToken,
      groupId,
    });

    // Sync channel memberships (bypasses scheduler for tests)
    await syncChannelMemberships(t, userId, groupId);

    // Verify user IS now in main channel
    const afterJoin = await getChannelMembership(t, mainChannelId, userId);
    expect(afterJoin).not.toBeNull();
    expect(afterJoin?.leftAt).toBeUndefined();
    expect(afterJoin?.role).toBe("member");
  });

  test("should NOT add regular member to leaders channel when joining a group", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, leadersChannelId, accessToken } = await seedTestDataWithChannels(t);

    // User joins the group as regular member
    await t.mutation(api.functions.groups.index.join, {
      token: accessToken,
      groupId,
    });

    // Sync channel memberships (bypasses scheduler for tests)
    await syncChannelMemberships(t, userId, groupId);

    // Verify user is NOT in leaders channel
    const membership = await getChannelMembership(t, leadersChannelId, userId);
    expect(membership).toBeNull();
  });

  test("should re-add user to main channel when rejoining a group", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, mainChannelId, accessToken } = await seedTestDataWithChannels(t);

    // User joins the group
    await t.mutation(api.functions.groups.index.join, {
      token: accessToken,
      groupId,
    });
    await syncChannelMemberships(t, userId, groupId);

    // User leaves the group
    await t.mutation(api.functions.groups.index.leave, {
      token: accessToken,
      groupId,
    });
    await syncChannelMemberships(t, userId, groupId);

    // Verify user's channel membership is soft-deleted
    const afterLeave = await getChannelMembership(t, mainChannelId, userId);
    expect(afterLeave?.leftAt).toBeDefined();

    // User rejoins the group
    await t.mutation(api.functions.groups.index.join, {
      token: accessToken,
      groupId,
    });
    await syncChannelMemberships(t, userId, groupId);

    // Verify user's channel membership is reactivated
    const afterRejoin = await getChannelMembership(t, mainChannelId, userId);
    expect(afterRejoin?.leftAt).toBeUndefined();
  });
});

// ============================================================================
// Leave Group → Channel Membership Tests
// ============================================================================

describe("Leave Group → Channel Membership Sync", () => {
  test("should remove user from main channel when leaving a group", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, mainChannelId, accessToken } = await seedTestDataWithChannels(t);

    // User joins the group
    await t.mutation(api.functions.groups.index.join, {
      token: accessToken,
      groupId,
    });
    await syncChannelMemberships(t, userId, groupId);

    // Verify user is in main channel
    const afterJoin = await getChannelMembership(t, mainChannelId, userId);
    expect(afterJoin?.leftAt).toBeUndefined();

    // User leaves the group
    await t.mutation(api.functions.groups.index.leave, {
      token: accessToken,
      groupId,
    });
    await syncChannelMemberships(t, userId, groupId);

    // Verify user's channel membership is soft-deleted
    const afterLeave = await getChannelMembership(t, mainChannelId, userId);
    expect(afterLeave?.leftAt).toBeDefined();
  });

  test("should remove user from leaders channel when leaving a group", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, mainChannelId, leadersChannelId, communityId } = await seedTestDataWithChannels(t);

    // Create a leader user
    const leaderId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Leader",
        lastName: "User",
        phone: "+15555550002",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken: leaderToken } = await generateTokens(leaderId);

    // Add as leader to group
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId: leaderId,
        groupId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Manually add to channels (simulating what should happen automatically)
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: mainChannelId,
        userId: leaderId,
        role: "admin",
        joinedAt: Date.now(),
        isMuted: false,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: leadersChannelId,
        userId: leaderId,
        role: "admin",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    // Demote from leader first (required to leave)
    // For this test, we'll directly modify the role
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", leaderId)
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { role: "member" });
      }
    });

    // User leaves the group
    await t.mutation(api.functions.groups.index.leave, {
      token: leaderToken,
      groupId,
    });
    await syncChannelMemberships(t, leaderId, groupId);

    // Verify user is removed from both channels
    const mainMembership = await getChannelMembership(t, mainChannelId, leaderId);
    const leadersMembership = await getChannelMembership(t, leadersChannelId, leaderId);

    expect(mainMembership?.leftAt).toBeDefined();
    expect(leadersMembership?.leftAt).toBeDefined();
  });
});

// ============================================================================
// Role Change → Channel Membership Tests
// ============================================================================

describe("Role Change → Channel Membership Sync", () => {
  test("should add user to leaders channel when promoted to leader", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, leadersChannelId, communityId } = await seedTestDataWithChannels(t);

    // Create an existing leader to promote the user
    const existingLeaderId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Existing",
        lastName: "Leader",
        phone: "+15555550003",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: id,
        groupId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return id;
    });

    const { accessToken: leaderToken } = await generateTokens(existingLeaderId);

    // Add user as regular member
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Verify user is NOT in leaders channel
    const beforePromotion = await getChannelMembership(t, leadersChannelId, userId);
    expect(beforePromotion).toBeNull();

    // Promote user to leader
    await t.mutation(api.functions.groups.index.updateMemberRole, {
      token: leaderToken,
      groupId,
      targetUserId: userId,
      role: "leader",
    });
    await syncChannelMemberships(t, userId, groupId);

    // Verify user IS now in leaders channel
    const afterPromotion = await getChannelMembership(t, leadersChannelId, userId);
    expect(afterPromotion).not.toBeNull();
    expect(afterPromotion?.leftAt).toBeUndefined();
  });

  test("should remove user from leaders channel when demoted from leader", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, leadersChannelId, communityId } = await seedTestDataWithChannels(t);

    // Create an existing leader to demote the user
    const existingLeaderId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Existing",
        lastName: "Leader",
        phone: "+15555550004",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: id,
        groupId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return id;
    });

    const { accessToken: leaderToken } = await generateTokens(existingLeaderId);

    // Add user as leader with channel membership
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId,
        groupId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: leadersChannelId,
        userId,
        role: "admin",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    // Verify user IS in leaders channel
    const beforeDemotion = await getChannelMembership(t, leadersChannelId, userId);
    expect(beforeDemotion?.leftAt).toBeUndefined();

    // Demote user to member
    await t.mutation(api.functions.groups.index.updateMemberRole, {
      token: leaderToken,
      groupId,
      targetUserId: userId,
      role: "member",
    });
    await syncChannelMemberships(t, userId, groupId);

    // Verify user is removed from leaders channel
    const afterDemotion = await getChannelMembership(t, leadersChannelId, userId);
    expect(afterDemotion?.leftAt).toBeDefined();
  });

  test("should keep user in main channel when role changes", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, mainChannelId, communityId } = await seedTestDataWithChannels(t);

    // Create an existing leader
    const existingLeaderId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Existing",
        lastName: "Leader",
        phone: "+15555550005",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: id,
        groupId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return id;
    });

    const { accessToken: leaderToken } = await generateTokens(existingLeaderId);

    // Add user as member with channel membership
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: mainChannelId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    // Promote user to leader
    await t.mutation(api.functions.groups.index.updateMemberRole, {
      token: leaderToken,
      groupId,
      targetUserId: userId,
      role: "leader",
    });
    await syncChannelMemberships(t, userId, groupId);

    // Verify user is still in main channel
    const afterPromotion = await getChannelMembership(t, mainChannelId, userId);
    expect(afterPromotion?.leftAt).toBeUndefined();

    // Demote user back to member
    await t.mutation(api.functions.groups.index.updateMemberRole, {
      token: leaderToken,
      groupId,
      targetUserId: userId,
      role: "member",
    });
    await syncChannelMemberships(t, userId, groupId);

    // Verify user is still in main channel
    const afterDemotion = await getChannelMembership(t, mainChannelId, userId);
    expect(afterDemotion?.leftAt).toBeUndefined();
  });
});

// ============================================================================
// Announcement Group Sync Tests
// ============================================================================

describe("Announcement Group Sync", () => {
  interface AnnouncementTestData extends TestData {
    announcementGroupId: Id<"groups">;
    announcementMainChannelId: Id<"chatChannels">;
    announcementLeadersChannelId: Id<"chatChannels">;
  }

  async function seedTestDataWithAnnouncementGroup(
    t: ReturnType<typeof convexTest>
  ): Promise<AnnouncementTestData> {
    const baseData = await seedTestDataWithChannels(t);

    // Create announcement group
    const announcementGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Community Announcements",
        communityId: baseData.communityId,
        groupTypeId: baseData.groupTypeId,
        isAnnouncementGroup: true,
        isPublic: true,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Get the creator ID to use for channel creation
    const creatorId = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", baseData.groupId))
        .filter((q) => q.eq(q.field("role"), "leader"))
        .first();
      return member?.userId;
    });

    // Create channels for announcement group
    const announcementMainChannelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId: announcementGroupId,
        channelType: "main",
        name: "Announcements General",
        slug: "general",
        createdById: creatorId!,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 0,
      });
    });

    const announcementLeadersChannelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId: announcementGroupId,
        channelType: "leaders",
        name: "Announcements Leaders",
        slug: "leaders",
        createdById: creatorId!,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 0,
      });
    });

    return {
      ...baseData,
      announcementGroupId,
      announcementMainChannelId,
      announcementLeadersChannelId,
    };
  }

  async function getGroupMembership(
    t: ReturnType<typeof convexTest>,
    groupId: Id<"groups">,
    userId: Id<"users">
  ) {
    return await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", userId)
        )
        .first();
    });
  }

  test("should add user to announcement group when joining community", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, announcementGroupId } =
      await seedTestDataWithAnnouncementGroup(t);

    // Verify user is NOT in announcement group initially
    const beforeJoin = await getGroupMembership(t, announcementGroupId, userId);
    expect(beforeJoin).toBeNull();

    // Add user to community
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId,
        roles: 1, // Member
        status: 1, // Active
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Sync announcement group membership
    await syncMemberships(t, {
      userId,
      syncAnnouncementGroup: true,
      communityId,
    });

    // Verify user IS now in announcement group as member
    const afterJoin = await getGroupMembership(t, announcementGroupId, userId);
    expect(afterJoin).not.toBeNull();
    expect(afterJoin?.leftAt).toBeUndefined();
    expect(afterJoin?.role).toBe("member");
  });

  test("should remove user from announcement group when leaving community", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, announcementGroupId } =
      await seedTestDataWithAnnouncementGroup(t);

    // Add user to community and announcement group
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId,
        roles: 1,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: announcementGroupId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Verify user is in announcement group
    const beforeLeave = await getGroupMembership(t, announcementGroupId, userId);
    expect(beforeLeave?.leftAt).toBeUndefined();

    // Mark user as inactive in community
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", communityId)
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { status: 2 }); // Inactive
      }
    });

    // Sync announcement group membership
    await syncMemberships(t, {
      userId,
      syncAnnouncementGroup: true,
      communityId,
    });

    // Verify user is removed from announcement group
    const afterLeave = await getGroupMembership(t, announcementGroupId, userId);
    expect(afterLeave?.leftAt).toBeDefined();
  });

  test("should promote to leader when promoted to community admin", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, announcementGroupId } =
      await seedTestDataWithAnnouncementGroup(t);

    // Add user to community as regular member
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId,
        roles: 1, // Regular member
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: announcementGroupId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Verify user is member in announcement group
    const beforePromotion = await getGroupMembership(t, announcementGroupId, userId);
    expect(beforePromotion?.role).toBe("member");

    // Promote user to admin in community
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", communityId)
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { roles: 3 }); // Admin
      }
    });

    // Sync announcement group membership
    await syncMemberships(t, {
      userId,
      syncAnnouncementGroup: true,
      communityId,
    });

    // Verify user is now leader in announcement group
    const afterPromotion = await getGroupMembership(t, announcementGroupId, userId);
    expect(afterPromotion?.role).toBe("leader");
  });

  test("should demote to member when demoted from community admin", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, announcementGroupId } =
      await seedTestDataWithAnnouncementGroup(t);

    // Add user to community as admin
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId,
        roles: 3, // Admin
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: announcementGroupId,
        userId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Verify user is leader in announcement group
    const beforeDemotion = await getGroupMembership(t, announcementGroupId, userId);
    expect(beforeDemotion?.role).toBe("leader");

    // Demote user to regular member in community
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", communityId)
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { roles: 1 }); // Member
      }
    });

    // Sync announcement group membership
    await syncMemberships(t, {
      userId,
      syncAnnouncementGroup: true,
      communityId,
    });

    // Verify user is now member in announcement group
    const afterDemotion = await getGroupMembership(t, announcementGroupId, userId);
    expect(afterDemotion?.role).toBe("member");
  });

  test("should be idempotent - multiple calls have same result", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, announcementGroupId } =
      await seedTestDataWithAnnouncementGroup(t);

    // Add user to community
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId,
        roles: 3, // Admin
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Call sync multiple times
    await syncMemberships(t, { userId, syncAnnouncementGroup: true, communityId });
    await syncMemberships(t, { userId, syncAnnouncementGroup: true, communityId });
    await syncMemberships(t, { userId, syncAnnouncementGroup: true, communityId });

    // Verify only one membership exists
    const memberships = await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", announcementGroupId).eq("userId", userId)
        )
        .collect();
    });

    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("leader");
    expect(memberships[0]?.leftAt).toBeUndefined();
  });

  test("should sync announcement group channels when membership changes", async () => {
    const t = convexTest(schema, modules);
    const {
      userId,
      communityId,
      announcementGroupId,
      announcementMainChannelId,
      announcementLeadersChannelId,
    } = await seedTestDataWithAnnouncementGroup(t);

    // Add user to community as admin
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId,
        roles: 3, // Admin
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Sync announcement group membership
    await syncMemberships(t, {
      userId,
      syncAnnouncementGroup: true,
      communityId,
    });

    // Verify user is in both announcement channels (main + leaders as admin)
    const mainMembership = await getChannelMembership(t, announcementMainChannelId, userId);
    const leadersMembership = await getChannelMembership(t, announcementLeadersChannelId, userId);

    expect(mainMembership).not.toBeNull();
    expect(mainMembership?.leftAt).toBeUndefined();
    expect(leadersMembership).not.toBeNull();
    expect(leadersMembership?.leftAt).toBeUndefined();
  });
});

// ============================================================================
// Group Channel Sync via groupMembers Functions Tests
// ============================================================================

describe("Group Channel Sync via groupMembers functions", () => {
  test("should sync channels when adding member via groupMembers.add", async () => {
    const t = convexTest(schema, modules);
    const { groupId, mainChannelId, communityId } = await seedTestDataWithChannels(t);

    // Create a new user
    const newUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "New",
        lastName: "User",
        phone: "+15555550100",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Get a leader token
    const leaderId = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .filter((q) => q.eq(q.field("role"), "leader"))
        .first();
      return member?.userId;
    });

    const { accessToken: leaderToken } = await generateTokens(leaderId!);

    // Verify user is NOT in channel before
    const beforeAdd = await getChannelMembership(t, mainChannelId, newUserId);
    expect(beforeAdd).toBeNull();

    // Add member via groupMembers.add
    await t.mutation(api.functions.groupMembers.add, {
      token: leaderToken,
      groupId,
      userId: newUserId,
    });

    // Run scheduled functions (including the sync)
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify user IS now in channel
    const afterAdd = await getChannelMembership(t, mainChannelId, newUserId);
    expect(afterAdd).not.toBeNull();
    expect(afterAdd?.leftAt).toBeUndefined();
  });

  test("should sync channels when removing member via groupMembers.remove", async () => {
    const t = convexTest(schema, modules);
    const { groupId, mainChannelId, communityId } = await seedTestDataWithChannels(t);

    // Create a user and add them to the group with channel membership
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Member",
        lastName: "ToRemove",
        phone: "+15555550101",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: id,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: mainChannelId,
        userId: id,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      return id;
    });

    const { accessToken } = await generateTokens(userId);

    // Verify user IS in channel before
    const beforeRemove = await getChannelMembership(t, mainChannelId, userId);
    expect(beforeRemove?.leftAt).toBeUndefined();

    // Remove member via groupMembers.remove (self-removal/leave)
    await t.mutation(api.functions.groupMembers.remove, {
      token: accessToken,
      groupId,
      userId,
    });

    // Run scheduled functions (including the sync)
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify user is removed from channel
    const afterRemove = await getChannelMembership(t, mainChannelId, userId);
    expect(afterRemove?.leftAt).toBeDefined();
  });

  test("should sync channels when updating role via groupMembers.updateRole", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leadersChannelId, communityId } = await seedTestDataWithChannels(t);

    // Create a user as regular member
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Member",
        lastName: "ToPromote",
        phone: "+15555550102",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: id,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return id;
    });

    // Get a leader token
    const leaderId = await t.run(async (ctx) => {
      const member = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .filter((q) => q.eq(q.field("role"), "leader"))
        .first();
      return member?.userId;
    });

    const { accessToken: leaderToken } = await generateTokens(leaderId!);

    // Verify user is NOT in leaders channel before
    const beforeUpdate = await getChannelMembership(t, leadersChannelId, userId);
    expect(beforeUpdate).toBeNull();

    // Update role via groupMembers.updateRole
    await t.mutation(api.functions.groupMembers.updateRole, {
      token: leaderToken,
      groupId,
      userId,
      role: "leader",
    });

    // Run scheduled functions (including the sync)
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Verify user IS now in leaders channel
    const afterUpdate = await getChannelMembership(t, leadersChannelId, userId);
    expect(afterUpdate).not.toBeNull();
    expect(afterUpdate?.leftAt).toBeUndefined();
  });
});

// ============================================================================
// Announcement Group Role Protection Tests
// ============================================================================

describe("Announcement Group Role Protection", () => {
  interface AnnouncementTestData extends TestData {
    announcementGroupId: Id<"groups">;
    leaderId: Id<"users">;
    leaderToken: string;
  }

  async function seedAnnouncementGroupWithLeader(
    t: ReturnType<typeof convexTest>
  ): Promise<AnnouncementTestData> {
    const baseData = await seedTestDataWithChannels(t);

    // Create announcement group
    const announcementGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Community Announcements",
        communityId: baseData.communityId,
        groupTypeId: baseData.groupTypeId,
        isAnnouncementGroup: true,
        isPublic: true,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Create a leader user (community admin)
    const leaderId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "User",
        phone: "+15555559000",
        phoneVerified: true,
        activeCommunityId: baseData.communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Add as community admin
      await ctx.db.insert("userCommunities", {
        communityId: baseData.communityId,
        userId: id,
        roles: 3, // Admin
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Add as leader in announcement group
      await ctx.db.insert("groupMembers", {
        groupId: announcementGroupId,
        userId: id,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return id;
    });

    // Add test user as member in announcement group
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId: baseData.communityId,
        userId: baseData.userId,
        roles: 1, // Regular member
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: announcementGroupId,
        userId: baseData.userId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    const { accessToken: leaderToken } = await generateTokens(leaderId);

    return {
      ...baseData,
      announcementGroupId,
      leaderId,
      leaderToken,
    };
  }

  test("should reject role changes via groupMembers.updateRole in announcement groups", async () => {
    const t = convexTest(schema, modules);
    const { userId, announcementGroupId, leaderToken } =
      await seedAnnouncementGroupWithLeader(t);

    // Attempt to promote user to leader in announcement group
    await expect(
      t.mutation(api.functions.groupMembers.updateRole, {
        token: leaderToken,
        groupId: announcementGroupId,
        userId,
        role: "leader",
      })
    ).rejects.toThrow("Cannot manually change roles in announcement groups");
  });

  test("should reject role changes via groups.updateMemberRole in announcement groups", async () => {
    const t = convexTest(schema, modules);
    const { userId, announcementGroupId, leaderToken } =
      await seedAnnouncementGroupWithLeader(t);

    // Attempt to promote user to leader in announcement group
    await expect(
      t.mutation(api.functions.groups.index.updateMemberRole, {
        token: leaderToken,
        groupId: announcementGroupId,
        targetUserId: userId,
        role: "leader",
      })
    ).rejects.toThrow("Cannot manually change roles in announcement groups");
  });

  test("should allow role changes in regular groups (not announcement)", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, communityId } = await seedTestDataWithChannels(t);

    // Create a leader
    const leaderId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Leader",
        lastName: "User",
        phone: "+15555559001",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: id,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return id;
    });

    const { accessToken: leaderToken } = await generateTokens(leaderId);

    // Add test user as member
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Should succeed in regular group
    await t.mutation(api.functions.groupMembers.updateRole, {
      token: leaderToken,
      groupId,
      userId,
      role: "leader",
    });

    // Verify role was changed
    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", userId)
        )
        .first();
    });

    expect(membership?.role).toBe("leader");
  });

  test("should only allow sync to change announcement group roles", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, announcementGroupId } =
      await seedAnnouncementGroupWithLeader(t);

    // Verify user is currently a member
    const beforeSync = await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", announcementGroupId).eq("userId", userId)
        )
        .first();
    });
    expect(beforeSync?.role).toBe("member");

    // Promote user to admin in community
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", communityId)
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { roles: 3 }); // Admin
      }
    });

    // Sync should update the role to leader
    await syncMemberships(t, {
      userId,
      syncAnnouncementGroup: true,
      communityId,
    });

    // Verify role was changed by sync
    const afterSync = await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", announcementGroupId).eq("userId", userId)
        )
        .first();
    });
    expect(afterSync?.role).toBe("leader");
  });
});

// ============================================================================
// Transactional Sync Tests (Race Condition Prevention)
// ============================================================================

describe("Transactional Sync - No Race Conditions", () => {
  test("approved join request user can immediately access channel (no waiting)", async () => {
    const t = convexTest(schema, modules);
    const { groupId, mainChannelId, communityId } = await seedTestDataWithChannels(t);

    // Create a private group for this test
    const privateGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Private Test Group",
        communityId,
        groupTypeId: (await ctx.db.get(groupId))!.groupTypeId!,
        isPublic: false, // Private group requires approval
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Create main channel for the private group
    const privateChannelId = await t.run(async (ctx) => {
      const creator = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .filter((q) => q.eq(q.field("role"), "leader"))
        .first();
      return await ctx.db.insert("chatChannels", {
        groupId: privateGroupId,
        channelType: "main",
        name: "General",
        slug: "general",
        createdById: creator!.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 0,
      });
    });

    // Create a user who will request to join
    const requesterId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Requester",
        lastName: "User",
        phone: "+15555550200",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Create a pending join request (member record with requestStatus: "pending" and leftAt set)
    const membershipId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupMembers", {
        groupId: privateGroupId,
        userId: requesterId,
        role: "member",
        joinedAt: Date.now(),
        leftAt: Date.now(), // Inactive until approved
        notificationsEnabled: true,
        requestStatus: "pending",
        requestedAt: Date.now(),
      });
    });

    // Create admin to approve the request
    const adminId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "User",
        phone: "+15555550201",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Make them a community admin
      await ctx.db.insert("userCommunities", {
        communityId,
        userId: id,
        roles: 3, // Admin
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return id;
    });

    const { accessToken: adminToken } = await generateTokens(adminId);

    // Verify user is NOT in channel before approval
    const beforeApproval = await getChannelMembership(t, privateChannelId, requesterId);
    expect(beforeApproval).toBeNull();

    // Approve the join request - this should synchronously sync channel membership
    await t.mutation(api.functions.admin.index.reviewPendingRequest, {
      token: adminToken,
      communityId,
      membershipId,
      action: "accept",
    });

    // CRITICAL: Do NOT call finishAllScheduledFunctions or syncChannelMemberships here!
    // The sync should have happened transactionally within the mutation.

    // Verify user IS now in channel IMMEDIATELY after approval
    const afterApproval = await getChannelMembership(t, privateChannelId, requesterId);
    expect(afterApproval).not.toBeNull();
    expect(afterApproval?.leftAt).toBeUndefined();
    expect(afterApproval?.role).toBe("member");
  });

  test("user joining group can immediately access channel (no waiting)", async () => {
    const t = convexTest(schema, modules);
    const { groupId, mainChannelId, accessToken, userId } = await seedTestDataWithChannels(t);

    // Verify user is NOT in channel before joining
    const beforeJoin = await getChannelMembership(t, mainChannelId, userId);
    expect(beforeJoin).toBeNull();

    // Join the group - this should synchronously sync channel membership
    await t.mutation(api.functions.groups.index.join, {
      token: accessToken,
      groupId,
    });

    // CRITICAL: Do NOT call finishAllScheduledFunctions or syncChannelMemberships here!

    // Verify user IS now in channel IMMEDIATELY after joining
    const afterJoin = await getChannelMembership(t, mainChannelId, userId);
    expect(afterJoin).not.toBeNull();
    expect(afterJoin?.leftAt).toBeUndefined();
    expect(afterJoin?.role).toBe("member");
  });

  test("user leaving group loses channel access immediately (no waiting)", async () => {
    const t = convexTest(schema, modules);
    const { groupId, mainChannelId, accessToken, userId } = await seedTestDataWithChannels(t);

    // Join and manually add to channel
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: mainChannelId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    // Verify user IS in channel before leaving
    const beforeLeave = await getChannelMembership(t, mainChannelId, userId);
    expect(beforeLeave?.leftAt).toBeUndefined();

    // Leave the group - this should synchronously remove from channel
    await t.mutation(api.functions.groups.index.leave, {
      token: accessToken,
      groupId,
    });

    // CRITICAL: Do NOT call finishAllScheduledFunctions here!

    // Verify user is removed from channel IMMEDIATELY after leaving
    const afterLeave = await getChannelMembership(t, mainChannelId, userId);
    expect(afterLeave?.leftAt).toBeDefined();
  });
});
