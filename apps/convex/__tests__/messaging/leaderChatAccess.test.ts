/**
 * Leader Chat Access Tests
 *
 * Tests for leader channel access control - ensuring only leaders can see
 * and access leader channels, and that access is properly revoked when
 * users are demoted.
 *
 * TEST COVERAGE:
 * 1. Basic access control (getChannel query)
 *    - Leaders can access leader channels
 *    - Regular members cannot access leader channels
 *    - Non-group members cannot access any channel
 *
 * 2. Slug-based access control (getChannelBySlug query)
 *    - Non-group members cannot access channels via slug
 *
 * 3. Channel visibility (getChannelsByGroup query)
 *    - Leaders see both main and leaders channels
 *    - Regular members only see main channel
 *
 * 4. Role change scenarios
 *    - Promotion: member -> leader gains access
 *    - Demotion: leader -> member loses access
 *
 * 5. Channel membership sync
 *    - Verify syncUserChannelMemberships correctly adds/removes users
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

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
  accessToken: string;
}

async function seedTestData(t: ReturnType<typeof convexTest>): Promise<TestData> {
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

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Regular",
      lastName: "Member",
      phone: "+15555550001",
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
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Add user as regular member of group
  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  const { accessToken } = await generateTokens(userId);

  return { userId, communityId, groupTypeId, groupId, accessToken };
}

async function createLeaderUser(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  groupId: Id<"groups">
): Promise<{ userId: Id<"users">; accessToken: string }> {
  const userId = await t.run(async (ctx) => {
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

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  const { accessToken } = await generateTokens(userId);
  return { userId, accessToken };
}

async function createBothChannels(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  leaderToken: string
): Promise<{ mainChannelId: Id<"chatChannels">; leadersChannelId: Id<"chatChannels"> }> {
  const mainChannelId = await t.mutation(api.functions.messaging.channels.createChannel, {
    token: leaderToken,
    groupId,
    channelType: "main",
    name: "General Chat",
  });

  const leadersChannelId = await t.mutation(api.functions.messaging.channels.createChannel, {
    token: leaderToken,
    groupId,
    channelType: "leaders",
    name: "Leaders Hub",
  });

  return { mainChannelId, leadersChannelId };
}

// ============================================================================
// Leader Channel Access Control Tests
// ============================================================================

describe("Leader Channel Access Control", () => {
  test("leaders can access their group's leader channel via getChannel", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Leader should be able to get the leaders channel
    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: leaderToken,
      channelId: leadersChannelId,
    });

    expect(channel).not.toBeNull();
    expect(channel?.channelType).toBe("leaders");
    expect(channel?.name).toBe("Leaders Hub");
  });

  test("regular members CANNOT access the leader channel via getChannel", async () => {
    const t = convexTest(schema, modules);
    const { accessToken: memberToken, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Regular member should NOT be able to get the leaders channel
    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: memberToken,
      channelId: leadersChannelId,
    });

    expect(channel).toBeNull();
  });

  test("regular members CAN access the main channel", async () => {
    const t = convexTest(schema, modules);
    const { accessToken: memberToken, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { mainChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Regular member should be able to get the main channel
    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: memberToken,
      channelId: mainChannelId,
    });

    expect(channel).not.toBeNull();
    expect(channel?.channelType).toBe("main");
  });

  test("non-group members CANNOT access any channel", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { mainChannelId, leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Create a user who is NOT a member of the group
    const nonMemberId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Non",
        lastName: "Member",
        phone: "+15555550099",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken: nonMemberToken } = await generateTokens(nonMemberId);

    // Non-member should NOT be able to get any channel
    // BUG: Currently this returns the channel instead of null
    const mainChannel = await t.query(api.functions.messaging.channels.getChannel, {
      token: nonMemberToken,
      channelId: mainChannelId,
    });
    expect(mainChannel).toBeNull();

    const leadersChannel = await t.query(api.functions.messaging.channels.getChannel, {
      token: nonMemberToken,
      channelId: leadersChannelId,
    });
    expect(leadersChannel).toBeNull();
  });
});

// ============================================================================
// Leader Channel Visibility in getChannelsByGroup Tests
// ============================================================================

describe("Leader Channel Visibility in getChannelsByGroup", () => {
  test("leader channel IS returned for leaders in getChannelsByGroup", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    await createBothChannels(t, groupId, leaderToken);

    const channels = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: leaderToken,
      groupId,
    });

    expect(channels).toHaveLength(2);
    const channelTypes = channels.map((c) => c.channelType);
    expect(channelTypes).toContain("main");
    expect(channelTypes).toContain("leaders");
  });

  test("leader channel is NOT returned for regular members in getChannelsByGroup", async () => {
    const t = convexTest(schema, modules);
    const { accessToken: memberToken, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    await createBothChannels(t, groupId, leaderToken);

    const channels = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: memberToken,
      groupId,
    });

    expect(channels).toHaveLength(1);
    expect(channels[0].channelType).toBe("main");
    // Ensure leaders channel is NOT visible
    const hasLeadersChannel = channels.some((c) => c.channelType === "leaders");
    expect(hasLeadersChannel).toBe(false);
  });

  test("admin can see leader channel in getChannelsByGroup", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);

    // Create an admin user
    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "User",
        phone: "+15555550003",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId: adminId,
        groupId,
        role: "admin",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    const { accessToken: adminToken } = await generateTokens(adminId);

    // Create channels (admin can create leaders channel too)
    await createBothChannels(t, groupId, adminToken);

    const channels = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: adminToken,
      groupId,
    });

    expect(channels).toHaveLength(2);
    const channelTypes = channels.map((c) => c.channelType);
    expect(channelTypes).toContain("leaders");
  });
});

// ============================================================================
// Role Change Tests - Promotion/Demotion
// ============================================================================

describe("Leader Channel Access After Role Changes", () => {
  test("when user is promoted to leader, they gain access to leader channel", async () => {
    const t = convexTest(schema, modules);
    const { userId: memberId, accessToken: memberToken, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Initially, member cannot see leader channel
    const channelsBefore = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: memberToken,
      groupId,
    });
    expect(channelsBefore.some((c) => c.channelType === "leaders")).toBe(false);

    // Promote member to leader
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", memberId))
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { role: "leader" });
      }
    });

    // After promotion, they should see the leader channel
    const channelsAfter = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: memberToken,
      groupId,
    });
    expect(channelsAfter).toHaveLength(2);
    expect(channelsAfter.some((c) => c.channelType === "leaders")).toBe(true);

    // And they should be able to access it directly
    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: memberToken,
      channelId: leadersChannelId,
    });
    expect(channel).not.toBeNull();
    expect(channel?.channelType).toBe("leaders");
  });

  test("when user is demoted from leader to member, they lose access to leader channel", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Initially, leader can see leader channel
    const channelsBefore = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: leaderToken,
      groupId,
    });
    expect(channelsBefore.some((c) => c.channelType === "leaders")).toBe(true);

    // Demote leader to member
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", leaderId))
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { role: "member" });
      }
    });

    // After demotion, they should NOT see the leader channel in list
    const channelsAfter = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: leaderToken,
      groupId,
    });
    expect(channelsAfter).toHaveLength(1);
    expect(channelsAfter[0].channelType).toBe("main");
    expect(channelsAfter.some((c) => c.channelType === "leaders")).toBe(false);

    // And they should NOT be able to access it directly
    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: leaderToken,
      channelId: leadersChannelId,
    });
    expect(channel).toBeNull();
  });

  test("when admin is demoted to member, they lose access to leader channel", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);

    // Create an admin user
    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "User",
        phone: "+15555550004",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId: adminId,
        groupId,
        role: "admin",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    const { accessToken: adminToken } = await generateTokens(adminId);

    const { leadersChannelId } = await createBothChannels(t, groupId, adminToken);

    // Initially, admin can see leader channel
    const channelsBefore = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: adminToken,
      groupId,
    });
    expect(channelsBefore.some((c) => c.channelType === "leaders")).toBe(true);

    // Demote admin to member
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", adminId))
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { role: "member" });
      }
    });

    // After demotion, they should NOT see the leader channel
    const channelsAfter = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: adminToken,
      groupId,
    });
    expect(channelsAfter.some((c) => c.channelType === "leaders")).toBe(false);

    // And they should NOT be able to access it directly
    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: adminToken,
      channelId: leadersChannelId,
    });
    expect(channel).toBeNull();
  });
});

// ============================================================================
// Channel Membership Sync Tests
// ============================================================================

describe("Channel Membership Sync on Role Changes", () => {
  test("syncing channel memberships adds leader to leaders channel when promoted", async () => {
    const t = convexTest(schema, modules);
    const { userId: memberId, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Promote member to leader
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", memberId))
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { role: "leader" });
      }
    });

    // Sync channel memberships (this should add them to leaders channel)
    await t.action(api.functions.messaging.channels.testSyncUserChannelMemberships, {
      userId: memberId,
      groupId,
    });

    // Verify they are now a member of the leaders channel
    const channelMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", leadersChannelId).eq("userId", memberId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });

    expect(channelMembership).not.toBeNull();
    expect(channelMembership?.role).toBe("admin"); // Leaders get admin role in channels
  });

  test("syncing channel memberships removes demoted user from leaders channel", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // First sync to ensure leader is in the channel
    await t.action(api.functions.messaging.channels.testSyncUserChannelMemberships, {
      userId: leaderId,
      groupId,
    });

    // Verify leader is in the channel
    const membershipBefore = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", leadersChannelId).eq("userId", leaderId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });
    expect(membershipBefore).not.toBeNull();

    // Demote leader to member
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", leaderId))
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { role: "member" });
      }
    });

    // Sync channel memberships (this should remove them from leaders channel)
    await t.action(api.functions.messaging.channels.testSyncUserChannelMemberships, {
      userId: leaderId,
      groupId,
    });

    // Verify they are no longer an active member of the leaders channel
    const membershipAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", leadersChannelId).eq("userId", leaderId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });

    expect(membershipAfter).toBeNull();
  });

  test("syncing keeps user in main channel regardless of role", async () => {
    const t = convexTest(schema, modules);
    const { userId: memberId, communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { mainChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Sync for both users
    await t.action(api.functions.messaging.channels.testSyncUserChannelMemberships, {
      userId: memberId,
      groupId,
    });
    await t.action(api.functions.messaging.channels.testSyncUserChannelMemberships, {
      userId: leaderId,
      groupId,
    });

    // Both should be in the main channel
    const memberMainMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", mainChannelId).eq("userId", memberId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });

    const leaderMainMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", mainChannelId).eq("userId", leaderId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });

    expect(memberMainMembership).not.toBeNull();
    expect(leaderMainMembership).not.toBeNull();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Leader Channel Access Edge Cases", () => {
  test("user who left the group cannot access leader channel even if they were a leader", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Mark the leader as having left the group
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) => q.eq("groupId", groupId).eq("userId", leaderId))
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { leftAt: Date.now() });
      }
    });

    // Former leader should NOT be able to access leader channel
    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: leaderToken,
      channelId: leadersChannelId,
    });

    expect(channel).toBeNull();

    // And should not see it in the list (should return empty since they left)
    const channels = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: leaderToken,
      groupId,
    });

    expect(channels).toHaveLength(0);
  });

  test("archived leader channel is not returned even for leaders", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const { leadersChannelId } = await createBothChannels(t, groupId, leaderToken);

    // Archive the leaders channel
    await t.mutation(api.functions.messaging.channels.archiveChannel, {
      token: leaderToken,
      channelId: leadersChannelId,
    });

    // Leader should not see archived channel in list
    const channels = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: leaderToken,
      groupId,
    });

    expect(channels).toHaveLength(1);
    expect(channels[0].channelType).toBe("main");
  });

  test("multiple groups - leader in one group cannot access leader channel in another", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupTypeId, groupId: group1Id } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, group1Id);

    // Create a second group
    const group2Id = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Second Group",
        communityId,
        groupTypeId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Make our leader just a member in group 2
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId: leaderId,
        groupId: group2Id,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Create another leader for group 2 to create channels
    const group2LeaderId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        firstName: "Group2",
        lastName: "Leader",
        phone: "+15555550010",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: uid,
        groupId: group2Id,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return uid;
    });

    const { accessToken: group2LeaderToken } = await generateTokens(group2LeaderId);

    // Create channels in group 2
    const { leadersChannelId: group2LeadersChannelId } = await createBothChannels(t, group2Id, group2LeaderToken);

    // Leader from group 1 (who is just a member in group 2) should NOT access group 2's leaders channel
    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: leaderToken,
      channelId: group2LeadersChannelId,
    });

    expect(channel).toBeNull();

    // And should not see leaders channel when listing group 2 channels
    const channels = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: leaderToken,
      groupId: group2Id,
    });

    expect(channels).toHaveLength(1);
    expect(channels[0].channelType).toBe("main");
  });
});

// ============================================================================
// Slug-Based Access Control Tests (getChannelBySlug)
// ============================================================================

describe("Slug-Based Channel Access Control", () => {
  test("non-group members CANNOT access main channel via slug", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    await createBothChannels(t, groupId, leaderToken);

    // Create a user who is NOT a member of the group
    const nonMemberId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Non",
        lastName: "Member",
        phone: "+15555550088",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken: nonMemberToken } = await generateTokens(nonMemberId);

    // Non-member should NOT be able to get the main channel by slug
    const mainChannel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: nonMemberToken,
      groupId,
      slug: "general",
    });
    expect(mainChannel).toBeNull();

    // Non-member should NOT be able to get the leaders channel by slug
    const leadersChannel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: nonMemberToken,
      groupId,
      slug: "leaders",
    });
    expect(leadersChannel).toBeNull();
  });
});
