/**
 * Shared Channel Tests
 *
 * Tests the invitation flow for shared channels: inviting groups,
 * responding to invitations, and removing groups from shared channels.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

// Set up environment variables
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Use fake timers globally to prevent unhandled errors from scheduled functions
vi.useFakeTimers();

// Clean up after each test
afterEach(() => {
  vi.clearAllTimers();
});

// ============================================================================
// Test Helpers
// ============================================================================

interface SharedChannelTestData {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  // Primary group (the one that owns the channel)
  primaryGroupId: Id<"groups">;
  primaryLeaderUserId: Id<"users">;
  primaryLeaderToken: string;
  primaryMemberUserId: Id<"users">;
  primaryMemberToken: string;
  // Secondary group (the one being invited)
  secondaryGroupId: Id<"groups">;
  secondaryLeaderUserId: Id<"users">;
  secondaryLeaderToken: string;
  secondaryMemberUserId: Id<"users">;
  secondaryMemberToken: string;
  // Channel on the primary group
  channelId: Id<"chatChannels">;
}

async function seedSharedChannelTestData(
  t: ReturnType<typeof convexTest>
): Promise<SharedChannelTestData> {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test-shared",
      slug: "test-shared",
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

  // --- Primary group setup ---
  const primaryGroupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Primary Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const primaryLeaderUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Primary",
      lastName: "Leader",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId: primaryLeaderUserId,
      groupId: primaryGroupId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  const primaryMemberUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Primary",
      lastName: "Member",
      phone: "+15555550002",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId: primaryMemberUserId,
      groupId: primaryGroupId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  // --- Secondary group setup ---
  const secondaryGroupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Secondary Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const secondaryLeaderUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Secondary",
      lastName: "Leader",
      phone: "+15555550003",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId: secondaryLeaderUserId,
      groupId: secondaryGroupId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  const secondaryMemberUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Secondary",
      lastName: "Member",
      phone: "+15555550004",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId: secondaryMemberUserId,
      groupId: secondaryGroupId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  // --- Create a channel on the primary group ---
  const channelId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatChannels", {
      groupId: primaryGroupId,
      slug: "shared-channel",
      channelType: "custom",
      name: "Shared Channel",
      createdById: primaryLeaderUserId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      memberCount: 2,
    });
  });

  // Add primary group members to the channel
  await t.run(async (ctx) => {
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId: primaryLeaderUserId,
      role: "admin",
      joinedAt: Date.now(),
      isMuted: false,
    });
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId: primaryMemberUserId,
      role: "member",
      joinedAt: Date.now(),
      isMuted: false,
    });
  });

  // Generate tokens
  const { accessToken: primaryLeaderToken } = await generateTokens(primaryLeaderUserId);
  const { accessToken: primaryMemberToken } = await generateTokens(primaryMemberUserId);
  const { accessToken: secondaryLeaderToken } = await generateTokens(secondaryLeaderUserId);
  const { accessToken: secondaryMemberToken } = await generateTokens(secondaryMemberUserId);

  return {
    communityId,
    groupTypeId,
    primaryGroupId,
    primaryLeaderUserId,
    primaryLeaderToken,
    primaryMemberUserId,
    primaryMemberToken,
    secondaryGroupId,
    secondaryLeaderUserId,
    secondaryLeaderToken,
    secondaryMemberUserId,
    secondaryMemberToken,
    channelId,
  };
}

// ============================================================================
// inviteGroupToChannel Tests
// ============================================================================

describe("inviteGroupToChannel", () => {
  test("leader of primary group can invite another group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // Verify the channel was updated
    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });

    expect(channel).not.toBeNull();
    expect(channel!.isShared).toBe(true);
    expect(channel!.sharedGroups).toHaveLength(1);
    expect(channel!.sharedGroups![0].groupId).toBe(data.secondaryGroupId);
    expect(channel!.sharedGroups![0].status).toBe("pending");
    expect(channel!.sharedGroups![0].invitedById).toBe(data.primaryLeaderUserId);
    expect(channel!.sharedGroups![0].invitedAt).toBeGreaterThan(0);
  });

  test("non-leader cannot invite a group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    await expect(
      t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
        token: data.primaryMemberToken,
        channelId: data.channelId,
        groupId: data.secondaryGroupId,
      })
    ).rejects.toThrow("Only group leaders can invite groups to a channel");
  });

  test("cannot invite a group that is already in sharedGroups", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // First invite
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // Second invite should fail
    await expect(
      t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
        token: data.primaryLeaderToken,
        channelId: data.channelId,
        groupId: data.secondaryGroupId,
      })
    ).rejects.toThrow("Group has already been invited to this channel");
  });

  test("cannot invite the primary group itself", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    await expect(
      t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
        token: data.primaryLeaderToken,
        channelId: data.channelId,
        groupId: data.primaryGroupId,
      })
    ).rejects.toThrow("Cannot invite the channel's own group");
  });

  test("cannot invite a group from a different community", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    const crossCommunityGroupId = await t.run(async (ctx) => {
      const otherCommunityId = await ctx.db.insert("communities", {
        name: "Other Community",
        subdomain: "other-community",
        slug: "other-community",
        timezone: "America/New_York",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const otherGroupTypeId = await ctx.db.insert("groupTypes", {
        communityId: otherCommunityId,
        name: "Other Group Type",
        slug: "other-group-type",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
      });

      return await ctx.db.insert("groups", {
        name: "Cross Community Group",
        communityId: otherCommunityId,
        groupTypeId: otherGroupTypeId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
        token: data.primaryLeaderToken,
        channelId: data.channelId,
        groupId: crossCommunityGroupId,
      })
    ).rejects.toThrow("Can only invite groups from the same community");
  });
});

// ============================================================================
// respondToChannelInvite Tests
// ============================================================================

describe("respondToChannelInvite", () => {
  test("leader of invited group can accept the invite", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // Accept the invite
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    // Verify the channel was updated
    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });

    expect(channel).not.toBeNull();
    expect(channel!.sharedGroups).toHaveLength(1);
    expect(channel!.sharedGroups![0].status).toBe("accepted");
    expect(channel!.sharedGroups![0].respondedById).toBe(data.secondaryLeaderUserId);
    expect(channel!.sharedGroups![0].respondedAt).toBeGreaterThan(0);
  });

  test("leader of invited group can decline the invite", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // Decline the invite
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "declined",
    });

    // Verify the entry was removed
    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });

    expect(channel).not.toBeNull();
    expect(channel!.sharedGroups).toHaveLength(0);
  });

  test("non-leader of invited group cannot respond", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // Non-leader tries to respond
    await expect(
      t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
        token: data.secondaryMemberToken,
        channelId: data.channelId,
        groupId: data.secondaryGroupId,
        response: "accepted",
      })
    ).rejects.toThrow("Only group leaders can respond to channel invites");
  });

  test("cannot respond to an invite for a different group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // Primary leader (leader of a different group) tries to respond for the secondary group
    await expect(
      t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
        token: data.primaryLeaderToken,
        channelId: data.channelId,
        groupId: data.secondaryGroupId,
        response: "accepted",
      })
    ).rejects.toThrow("Only group leaders can respond to channel invites");
  });

  test("accepting the last/only pending invite works correctly", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // Accept the only pending invite
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });

    expect(channel).not.toBeNull();
    expect(channel!.isShared).toBe(true);
    expect(channel!.sharedGroups).toHaveLength(1);
    expect(channel!.sharedGroups![0].status).toBe("accepted");
  });
});

// ============================================================================
// removeGroupFromChannel Tests
// ============================================================================

describe("removeGroupFromChannel", () => {
  test("leader of secondary group can remove their group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite and accept
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    // Remove the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });

    expect(channel).not.toBeNull();
    expect(channel!.sharedGroups).toHaveLength(0);
  });

  test("members only in removed group get soft-deleted from channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite and accept
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    // Add secondary group members to the channel
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: data.channelId,
        userId: data.secondaryLeaderUserId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: data.channelId,
        userId: data.secondaryMemberUserId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    // Remove the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // Verify secondary group members were soft-deleted (leftAt set)
    const secondaryLeaderMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", data.channelId).eq("userId", data.secondaryLeaderUserId)
        )
        .first();
    });
    expect(secondaryLeaderMembership).not.toBeNull();
    expect(secondaryLeaderMembership!.leftAt).toBeDefined();

    const secondaryMemberMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", data.channelId).eq("userId", data.secondaryMemberUserId)
        )
        .first();
    });
    expect(secondaryMemberMembership).not.toBeNull();
    expect(secondaryMemberMembership!.leftAt).toBeDefined();
  });

  test("members who are also in the primary group STAY in the channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Make the secondary leader also a member of the primary group
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId: data.secondaryLeaderUserId,
        groupId: data.primaryGroupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Invite and accept
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    // Add secondary group members to the channel
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: data.channelId,
        userId: data.secondaryLeaderUserId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: data.channelId,
        userId: data.secondaryMemberUserId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    // Remove the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    // The secondary leader is ALSO in the primary group, so should stay
    const secondaryLeaderMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", data.channelId).eq("userId", data.secondaryLeaderUserId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });
    expect(secondaryLeaderMembership).not.toBeNull();

    // The secondary member is NOT in the primary group, so should be removed
    const secondaryMemberMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", data.channelId).eq("userId", data.secondaryMemberUserId)
        )
        .first();
    });
    expect(secondaryMemberMembership).not.toBeNull();
    expect(secondaryMemberMembership!.leftAt).toBeDefined();
  });

  test("memberCount is updated correctly after member removal", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite and accept
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    // Add secondary group members to the channel
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: data.channelId,
        userId: data.secondaryLeaderUserId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: data.channelId,
        userId: data.secondaryMemberUserId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    // Update memberCount to reflect all 4 members (2 primary + 2 secondary)
    await t.run(async (ctx) => {
      await ctx.db.patch(data.channelId, { memberCount: 4 });
    });

    // Remove the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });

    // Should only have the 2 primary group members left
    expect(channel!.memberCount).toBe(2);
  });

  test("if sharedGroups becomes empty, isShared is set to false", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite and accept
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    // Verify isShared is true
    let channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });
    expect(channel!.isShared).toBe(true);

    // Remove the secondary group (the only shared group)
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });

    expect(channel!.isShared).toBe(false);
    expect(channel!.sharedGroups).toHaveLength(0);
  });

  test("primary group leader can also remove a secondary group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite and accept
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    // Primary leader removes the secondary group
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(data.channelId);
    });

    expect(channel).not.toBeNull();
    expect(channel!.sharedGroups).toHaveLength(0);
    expect(channel!.isShared).toBe(false);
  });
});

// ============================================================================
// addChannelMembers + shared channel membership rules
// ============================================================================

describe("addChannelMembers on shared channels", () => {
  test("adds accepted secondary-group members without adding them to primary group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite and accept secondary group so its members become eligible.
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    const result = await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      userIds: [data.secondaryMemberUserId],
    });

    expect(result.addedCount).toBe(1);

    // User should be added to channel membership.
    const channelMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", data.channelId).eq("userId", data.secondaryMemberUserId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });
    expect(channelMembership).not.toBeNull();

    // Critically, user should NOT be auto-added to the primary group.
    const primaryGroupMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", data.primaryGroupId).eq("userId", data.secondaryMemberUserId)
        )
        .first();
    });
    expect(primaryGroupMembership).toBeNull();
  });

  test("rejects users not in primary or accepted shared groups", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelTestData(t);

    // Invite and accept one secondary group.
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.primaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.channelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });

    // Create a user in the same community but in no eligible group.
    const outsiderUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Outside",
        lastName: "User",
        phone: "+15555550999",
        phoneVerified: true,
        activeCommunityId: data.communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.functions.messaging.channels.addChannelMembers, {
        token: data.primaryLeaderToken,
        channelId: data.channelId,
        userIds: [outsiderUserId],
      })
    ).rejects.toThrow(/must already belong to the primary group or an accepted shared group/i);

    const outsiderMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", data.channelId).eq("userId", outsiderUserId)
        )
        .first();
    });
    expect(outsiderMembership).toBeNull();
  });
});
