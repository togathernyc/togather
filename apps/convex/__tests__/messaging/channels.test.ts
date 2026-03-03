/**
 * Channel Tests for Convex-Native Messaging
 *
 * Tests channel creation, membership management, and access control.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";
import { generateChannelSlug, isValidSlug, RESERVED_SLUGS } from "../../lib/slugs";
import { isAutoChannel, isCustomChannel, getChannelCategory, AUTO_CHANNEL_TYPES } from "../../lib/helpers";

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
      firstName: "Test",
      lastName: "User",
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

  // Add user as member of group
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

// ============================================================================
// Channel Creation Tests
// ============================================================================

describe("Channel Creation", () => {
  test("should create a main channel for a group", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, accessToken } = await seedTestData(t);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "General Chat",
    });

    expect(channelId).toBeDefined();

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel).not.toBeNull();
    expect(channel?.name).toBe("General Chat");
    expect(channel?.channelType).toBe("main");
    expect(channel?.groupId).toBe(groupId);
    expect(channel?.isArchived).toBe(false);
    expect(channel?.memberCount).toBe(0);
  });

  test("should create a leaders channel for a group", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, accessToken } = await seedTestData(t);

    // Need a leader to create leaders channel
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "leaders",
      name: "Leaders Hub",
    });

    expect(channelId).toBeDefined();

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel?.channelType).toBe("leaders");
  });

  test("should reject channel creation by non-member", async () => {
    const t = convexTest(schema, modules);
    const { groupId, communityId } = await seedTestData(t);

    // Create a non-member user
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

    await expect(
      t.mutation(api.functions.messaging.channels.createChannel, {
        token: nonMemberToken,
        groupId,
        channelType: "main",
        name: "Should Fail",
      })
    ).rejects.toThrow();
  });

  test("should reject leaders channel creation by non-leader", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seedTestData(t);

    // Regular member trying to create leaders channel
    await expect(
      t.mutation(api.functions.messaging.channels.createChannel, {
        token: accessToken,
        groupId,
        channelType: "leaders",
        name: "Should Fail",
      })
    ).rejects.toThrow();
  });

  test("should set createdById on channel creation", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, accessToken } = await seedTestData(t);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "Test Channel",
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel?.createdById).toBe(userId);
  });
});

// ============================================================================
// Channel Query Tests
// ============================================================================

describe("Channel Queries", () => {
  test("should get channel by ID", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, accessToken } = await seedTestData(t);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "Query Test Channel",
    });

    const channel = await t.query(api.functions.messaging.channels.getChannel, {
      token: accessToken,
      channelId,
    });

    expect(channel).not.toBeNull();
    expect(channel?.name).toBe("Query Test Channel");
  });

  test("should get channels by group", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, accessToken } = await seedTestData(t);

    // Create main channel
    await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "Main Channel",
    });

    // Create leaders channel (need leader)
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);
    await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "leaders",
      name: "Leaders Channel",
    });

    const channels = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: leaderToken,
      groupId,
    });

    expect(channels).toHaveLength(2);
  });

  test("should only return main channel for regular members", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, accessToken } = await seedTestData(t);

    // Create both channels as leader
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);
    
    await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "main",
      name: "Main Channel",
    });

    await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "leaders",
      name: "Leaders Channel",
    });

    // Query as regular member
    const channels = await t.query(api.functions.messaging.channels.getChannelsByGroup, {
      token: accessToken,
      groupId,
    });

    expect(channels).toHaveLength(1);
    expect(channels[0].channelType).toBe("main");
  });

  test("should get user's channels across groups", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupTypeId, groupId, accessToken } = await seedTestData(t);

    // Create a second group
    const groupId2 = await t.run(async (ctx) => {
      const gId = await ctx.db.insert("groups", {
        name: "Second Group",
        communityId,
        groupTypeId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId,
        groupId: gId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return gId;
    });

    // Create channel in first group
    const channelId1 = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "Group 1 Main",
    });

    // Add user to channel 1
    await t.mutation(api.functions.messaging.channels.addMember, {
      token: accessToken,
      channelId: channelId1,
      userId,
      role: "member",
    });

    // Create channel in second group
    const channelId2 = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId: groupId2,
      channelType: "main",
      name: "Group 2 Main",
    });

    // Add user to channel 2
    await t.mutation(api.functions.messaging.channels.addMember, {
      token: accessToken,
      channelId: channelId2,
      userId,
      role: "member",
    });

    const channels = await t.query(api.functions.messaging.channels.getUserChannels, {
      token: accessToken,
    });

    expect(channels.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Channel Membership Tests
// ============================================================================

describe("Channel Membership", () => {
  test("should add member to channel", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, communityId, accessToken } = await seedTestData(t);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "Test Channel",
    });

    // Create another user to add
    const newUserId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "New",
        lastName: "Member",
        phone: "+15555550003",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Add to group first
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return uId;
    });

    await t.mutation(api.functions.messaging.channels.addMember, {
      token: accessToken,
      channelId,
      userId: newUserId,
      role: "member",
    });

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", newUserId)
        )
        .first();
    });

    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("member");
  });

  test("should remove member from channel", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, accessToken } = await seedTestData(t);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "Test Channel",
    });

    // Add self as member
    await t.mutation(api.functions.messaging.channels.addMember, {
      token: accessToken,
      channelId,
      userId,
      role: "member",
    });

    // Remove self
    await t.mutation(api.functions.messaging.channels.removeMember, {
      token: accessToken,
      channelId,
      userId,
    });

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    expect(membership?.leftAt).toBeDefined();
  });

  test("should update member role", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, communityId, accessToken } = await seedTestData(t);

    // Create as leader
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(
      t,
      communityId,
      groupId
    );

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "main",
      name: "Test Channel",
    });

    // Add regular user
    await t.mutation(api.functions.messaging.channels.addMember, {
      token: leaderToken,
      channelId,
      userId,
      role: "member",
    });

    // Update to moderator
    await t.mutation(api.functions.messaging.channels.updateMemberRole, {
      token: leaderToken,
      channelId,
      userId,
      role: "moderator",
    });

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    expect(membership?.role).toBe("moderator");
  });

  test("should increment memberCount when adding member", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, accessToken } = await seedTestData(t);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "Test Channel",
    });

    await t.mutation(api.functions.messaging.channels.addMember, {
      token: accessToken,
      channelId,
      userId,
      role: "member",
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel?.memberCount).toBe(1);
  });

  test("should decrement memberCount when removing member", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, accessToken } = await seedTestData(t);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: accessToken,
      groupId,
      channelType: "main",
      name: "Test Channel",
    });

    await t.mutation(api.functions.messaging.channels.addMember, {
      token: accessToken,
      channelId,
      userId,
      role: "member",
    });

    await t.mutation(api.functions.messaging.channels.removeMember, {
      token: accessToken,
      channelId,
      userId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel?.memberCount).toBe(0);
  });
});

// ============================================================================
// Channel Archive Tests
// ============================================================================

describe("Channel Archive", () => {
  test("should archive a channel", async () => {
    const t = convexTest(schema, modules);
    const { groupId, communityId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "main",
      name: "To Archive",
    });

    await t.mutation(api.functions.messaging.channels.archiveChannel, {
      token: leaderToken,
      channelId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel?.isArchived).toBe(true);
    expect(channel?.archivedAt).toBeDefined();
  });

  test("should not allow non-admin to archive channel", async () => {
    const t = convexTest(schema, modules);
    const { groupId, communityId, accessToken } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "main",
      name: "To Archive",
    });

    await expect(
      t.mutation(api.functions.messaging.channels.archiveChannel, {
        token: accessToken, // Regular member
        channelId,
      })
    ).rejects.toThrow();
  });
});

// ============================================================================
// Channel Update Tests
// ============================================================================

describe("Channel Updates", () => {
  test("should update channel name and description", async () => {
    const t = convexTest(schema, modules);
    const { groupId, communityId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "main",
      name: "Original Name",
    });

    await t.mutation(api.functions.messaging.channels.updateChannel, {
      token: leaderToken,
      channelId,
      name: "Updated Name",
      description: "New description",
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel?.name).toBe("Updated Name");
    expect(channel?.description).toBe("New description");
  });

  test("should update updatedAt timestamp on channel update", async () => {
    const t = convexTest(schema, modules);
    const { groupId, communityId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const channelId = await t.mutation(api.functions.messaging.channels.createChannel, {
      token: leaderToken,
      groupId,
      channelType: "main",
      name: "Original Name",
    });

    const beforeUpdate = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    // Advance time to ensure different timestamp
    vi.advanceTimersByTime(10);

    await t.mutation(api.functions.messaging.channels.updateChannel, {
      token: leaderToken,
      channelId,
      name: "Updated Name",
    });

    const afterUpdate = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(afterUpdate?.updatedAt).toBeGreaterThan(beforeUpdate?.updatedAt || 0);
  });
});

// ============================================================================
// Slug Utilities Tests
// ============================================================================

describe("Slug Utilities", () => {
  describe("generateChannelSlug", () => {
    test("converts name to lowercase slug", () => {
      expect(generateChannelSlug("Directors", [])).toBe("directors");
    });

    test("replaces spaces with hyphens", () => {
      expect(generateChannelSlug("BK Sunday Service", [])).toBe("bk-sunday-service");
    });

    test("handles reserved words by appending -channel", () => {
      expect(generateChannelSlug("Create", [])).toBe("create-channel");
      expect(generateChannelSlug("general", [])).toBe("general-channel");
      expect(generateChannelSlug("Leaders", [])).toBe("leaders-channel");
      expect(generateChannelSlug("Settings", [])).toBe("settings-channel");
      expect(generateChannelSlug("Members", [])).toBe("members-channel");
    });

    test("handles collisions by appending -2, -3", () => {
      expect(generateChannelSlug("Directors", ["directors"])).toBe("directors-2");
      expect(generateChannelSlug("Directors", ["directors", "directors-2"])).toBe("directors-3");
      expect(generateChannelSlug("Directors", ["directors", "directors-2", "directors-3"])).toBe("directors-4");
    });

    test("case-insensitive collision detection", () => {
      expect(generateChannelSlug("DIRECTORS", ["Directors"])).toBe("directors-2");
      expect(generateChannelSlug("directors", ["DIRECTORS"])).toBe("directors-2");
    });

    test("truncates to 50 characters", () => {
      const longName = "a".repeat(100);
      expect(generateChannelSlug(longName, []).length).toBeLessThanOrEqual(50);
    });

    test("removes special characters", () => {
      expect(generateChannelSlug("Test!@#$%Channel", [])).toBe("test-channel");
    });

    test("handles multiple consecutive special characters", () => {
      expect(generateChannelSlug("Test!!!Channel", [])).toBe("test-channel");
    });

    test("removes leading and trailing hyphens", () => {
      expect(generateChannelSlug("---Test---", [])).toBe("test");
      expect(generateChannelSlug("@@@Test@@@", [])).toBe("test");
    });

    test("handles numeric names", () => {
      expect(generateChannelSlug("123", [])).toBe("123");
      expect(generateChannelSlug("2024 Group", [])).toBe("2024-group");
    });

    test("handles mixed case with special chars", () => {
      expect(generateChannelSlug("BK's Sunday Service!", [])).toBe("bk-s-sunday-service");
    });
  });

  describe("isValidSlug", () => {
    test("accepts valid slugs", () => {
      expect(isValidSlug("directors")).toBe(true);
      expect(isValidSlug("bk-sunday-service")).toBe(true);
      expect(isValidSlug("group-123")).toBe(true);
      expect(isValidSlug("a")).toBe(true);
      expect(isValidSlug("123")).toBe(true);
    });

    test("rejects uppercase slugs", () => {
      expect(isValidSlug("UPPERCASE")).toBe(false);
      expect(isValidSlug("Directors")).toBe(false);
    });

    test("rejects slugs with spaces", () => {
      expect(isValidSlug("has spaces")).toBe(false);
      expect(isValidSlug("has space")).toBe(false);
    });

    test("rejects slugs with special characters", () => {
      expect(isValidSlug("special!chars")).toBe(false);
      expect(isValidSlug("test@channel")).toBe(false);
      expect(isValidSlug("test#channel")).toBe(false);
    });

    test("rejects slugs starting or ending with hyphen", () => {
      expect(isValidSlug("-starts")).toBe(false);
      expect(isValidSlug("ends-")).toBe(false);
      expect(isValidSlug("-both-")).toBe(false);
    });

    test("rejects slugs with consecutive hyphens", () => {
      expect(isValidSlug("double--hyphen")).toBe(false);
      expect(isValidSlug("triple---hyphen")).toBe(false);
    });

    test("rejects slugs over 50 characters", () => {
      const longSlug = "a".repeat(51);
      expect(isValidSlug(longSlug)).toBe(false);
    });

    test("accepts slugs at exactly 50 characters", () => {
      const exactSlug = "a".repeat(50);
      expect(isValidSlug(exactSlug)).toBe(true);
    });
  });

  describe("RESERVED_SLUGS", () => {
    test("includes expected reserved words", () => {
      expect(RESERVED_SLUGS).toContain("general");
      expect(RESERVED_SLUGS).toContain("leaders");
      expect(RESERVED_SLUGS).toContain("create");
      expect(RESERVED_SLUGS).toContain("settings");
      expect(RESERVED_SLUGS).toContain("members");
    });
  });
});

// ============================================================================
// Channel Helper Functions Tests
// ============================================================================

describe("Channel Helper Functions", () => {
  describe("isAutoChannel", () => {
    test("returns true for main channel", () => {
      expect(isAutoChannel("main")).toBe(true);
    });

    test("returns true for leaders channel", () => {
      expect(isAutoChannel("leaders")).toBe(true);
    });

    test("returns false for custom channel", () => {
      expect(isAutoChannel("custom")).toBe(false);
    });

    test("returns false for unknown channel types", () => {
      expect(isAutoChannel("unknown")).toBe(false);
      expect(isAutoChannel("")).toBe(false);
    });
  });

  describe("isCustomChannel", () => {
    test("returns true only for custom", () => {
      expect(isCustomChannel("custom")).toBe(true);
    });

    test("returns false for main", () => {
      expect(isCustomChannel("main")).toBe(false);
    });

    test("returns false for leaders", () => {
      expect(isCustomChannel("leaders")).toBe(false);
    });

    test("returns false for unknown types", () => {
      expect(isCustomChannel("unknown")).toBe(false);
    });
  });

  describe("getChannelCategory", () => {
    test("returns 'auto' for main and leaders", () => {
      expect(getChannelCategory("main")).toBe("auto");
      expect(getChannelCategory("leaders")).toBe("auto");
    });

    test("returns 'custom' for custom channels", () => {
      expect(getChannelCategory("custom")).toBe("custom");
    });

    test("returns 'custom' for unknown channel types", () => {
      expect(getChannelCategory("unknown")).toBe("custom");
    });
  });

  describe("AUTO_CHANNEL_TYPES", () => {
    test("contains main and leaders", () => {
      expect(AUTO_CHANNEL_TYPES).toContain("main");
      expect(AUTO_CHANNEL_TYPES).toContain("leaders");
    });

    test("does not contain custom", () => {
      expect(AUTO_CHANNEL_TYPES).not.toContain("custom");
    });
  });
});

// ============================================================================
// createCustomChannel Mutation Tests
// ============================================================================

describe("createCustomChannel", () => {
  test("creates channel with generated slug", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    expect(result.channelId).toBeDefined();
    expect(result.slug).toBe("directors");

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });

    expect(channel?.channelType).toBe("custom");
    expect(channel?.name).toBe("Directors");
    expect(channel?.slug).toBe("directors");
  });

  test("rejects non-leaders", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seedTestData(t);

    await expect(
      t.mutation(api.functions.messaging.channels.createCustomChannel, {
        token: accessToken, // Regular member
        groupId,
        name: "Directors",
      })
    ).rejects.toThrow("Only group leaders can create channels");
  });

  test("enforces 20 channel limit", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create 20 channels directly (including main and leaders = 2, so we need 18 more)
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 20; i++) {
        await ctx.db.insert("chatChannels", {
          groupId,
          slug: `channel-${i}`,
          channelType: i < 2 ? (i === 0 ? "main" : "leaders") : "custom",
          name: `Channel ${i}`,
          createdById: leaderId,
          createdAt: now,
          updatedAt: now,
          isArchived: false,
          memberCount: 0,
        });
      }
    });

    await expect(
      t.mutation(api.functions.messaging.channels.createCustomChannel, {
        token: leaderToken,
        groupId,
        name: "One More Channel",
      })
    ).rejects.toThrow("maximum of 20 channels");
  });

  test("validates name length - empty name", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    await expect(
      t.mutation(api.functions.messaging.channels.createCustomChannel, {
        token: leaderToken,
        groupId,
        name: "",
      })
    ).rejects.toThrow("1-50 characters");
  });

  test("validates name length - whitespace only", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    await expect(
      t.mutation(api.functions.messaging.channels.createCustomChannel, {
        token: leaderToken,
        groupId,
        name: "   ",
      })
    ).rejects.toThrow("1-50 characters");
  });

  test("validates name length - too long", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    await expect(
      t.mutation(api.functions.messaging.channels.createCustomChannel, {
        token: leaderToken,
        groupId,
        name: "a".repeat(51),
      })
    ).rejects.toThrow("1-50 characters");
  });

  test("creator becomes owner", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", leaderId)
        )
        .first();
    });

    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("owner");
  });

  test("handles collision with existing slug", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create first channel named Directors
    const result1 = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    expect(result1.slug).toBe("directors");

    // Create second channel also named Directors
    const result2 = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    expect(result2.slug).toBe("directors-2");
  });

  test("sets memberCount to 1 on creation", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });

    expect(channel?.memberCount).toBe(1);
  });
});

// ============================================================================
// leaveChannel Mutation Tests
// ============================================================================

describe("leaveChannel", () => {
  test("allows leaving custom channels", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Leave the channel
    await t.mutation(api.functions.messaging.channels.leaveChannel, {
      token: leaderToken,
      channelId: result.channelId,
    });

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", leaderId)
        )
        .first();
    });

    expect(membership?.leftAt).toBeDefined();
  });

  test("blocks leaving main channel with helpful error", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, accessToken } = await seedTestData(t);

    // Create main channel
    const channelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId,
        slug: "general",
        channelType: "main",
        name: "General",
        createdById: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
    });

    // Add membership
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    await expect(
      t.mutation(api.functions.messaging.channels.leaveChannel, {
        token: accessToken,
        channelId,
      })
    ).rejects.toThrow(/leave the group entirely/);
  });

  test("blocks leaving leaders channel with helpful error", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create leaders channel
    const channelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId,
        slug: "leaders",
        channelType: "leaders",
        name: "Leaders",
        createdById: leaderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
    });

    // Add membership
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: leaderId,
        role: "admin",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    await expect(
      t.mutation(api.functions.messaging.channels.leaveChannel, {
        token: leaderToken,
        channelId,
      })
    ).rejects.toThrow(/change your role/);
  });

  test("promotes oldest member when owner leaves", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add regular user as second member
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Create a third member (newer)
    const thirdUserId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Third",
        lastName: "Member",
        phone: "+15555550333",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return uId;
    });

    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [thirdUserId],
    });

    // Owner leaves
    await t.mutation(api.functions.messaging.channels.leaveChannel, {
      token: leaderToken,
      channelId: result.channelId,
    });

    // Check that the oldest member (userId, added first) is now owner
    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });

    expect(membership?.role).toBe("owner");
  });

  test("archives channel when last member leaves", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel (creator is the only member)
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Solo Channel",
    });

    // Leave the channel
    await t.mutation(api.functions.messaging.channels.leaveChannel, {
      token: leaderToken,
      channelId: result.channelId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });

    expect(channel?.isArchived).toBe(true);
    expect(channel?.archivedAt).toBeDefined();
  });

  test("updates memberCount when leaving", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add another member
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Verify memberCount is 2
    let channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });
    expect(channel?.memberCount).toBe(2);

    // User leaves
    await t.mutation(api.functions.messaging.channels.leaveChannel, {
      token: accessToken,
      channelId: result.channelId,
    });

    // Verify memberCount is now 1
    channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });
    expect(channel?.memberCount).toBe(1);
  });
});

// ============================================================================
// addChannelMembers Mutation Tests
// ============================================================================

describe("addChannelMembers", () => {
  test("adds group members to custom channel", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add user to channel
    const addResult = await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    expect(addResult.addedCount).toBe(1);

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", userId)
        )
        .first();
    });

    expect(membership).not.toBeNull();
    expect(membership?.role).toBe("member");
  });

  test("auto-adds non-group members to group when adding to channel", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Create user NOT in group
    const nonGroupUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Non",
        lastName: "GroupMember",
        phone: "+15555550555",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Adding to channel should auto-add user to the group
    const addResult = await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [nonGroupUserId],
    });

    expect(addResult.addedCount).toBe(1);

    // Verify user was added to the group
    const groupMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", groupId).eq("userId", nonGroupUserId)
        )
        .first();
    });

    expect(groupMembership).not.toBeNull();
    expect(groupMembership?.role).toBe("member");
    expect(groupMembership?.leftAt).toBeUndefined();

    // Verify user was added to the channel
    const channelMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", nonGroupUserId)
        )
        .first();
    });

    expect(channelMembership).not.toBeNull();
    expect(channelMembership?.role).toBe("member");
  });

  test("reactivates previously removed members", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add user (this schedules a welcome message)
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });
    // Finish any scheduled functions from addChannelMembers
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } catch {
      // Ignore errors from scheduled functions that call external APIs
    }

    // User leaves
    await t.mutation(api.functions.messaging.channels.leaveChannel, {
      token: accessToken,
      channelId: result.channelId,
    });
    // Finish any scheduled functions from leaveChannel
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } catch {
      // Ignore errors from scheduled functions that call external APIs
    }

    // Verify user has leftAt set
    let membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", userId)
        )
        .first();
    });
    expect(membership?.leftAt).toBeDefined();

    // Re-add user (this schedules a welcome message)
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });
    // Finish any scheduled functions from addChannelMembers
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } catch {
      // Ignore errors from scheduled functions that call external APIs
    }

    // Verify leftAt is cleared
    membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", userId)
        )
        .first();
    });
    expect(membership?.leftAt).toBeUndefined();
  });

  test("requires channel owner or group leader permission", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add regular user to channel
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Create another group member to try to add
    const anotherUserId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Another",
        lastName: "User",
        phone: "+15555550666",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return uId;
    });

    // Regular member (not owner) tries to add someone
    await expect(
      t.mutation(api.functions.messaging.channels.addChannelMembers, {
        token: accessToken,
        channelId: result.channelId,
        userIds: [anotherUserId],
      })
    ).rejects.toThrow(/channel owner or group leaders/);
  });

  test("only works on custom channels", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create main channel
    const channelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId,
        slug: "general",
        channelType: "main",
        name: "General",
        createdById: leaderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 0,
      });
    });

    await expect(
      t.mutation(api.functions.messaging.channels.addChannelMembers, {
        token: leaderToken,
        channelId,
        userIds: [userId],
      })
    ).rejects.toThrow(/only add members to custom channels/);
  });

  test("updates memberCount after adding members", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel (starts with 1 member - creator)
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add user
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });

    expect(channel?.memberCount).toBe(2);
  });

  test("skips already active members without error", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add user
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Try to add same user again
    const addResult = await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Should report 0 added (user was already active)
    expect(addResult.addedCount).toBe(0);
  });
});

// ============================================================================
// removeChannelMember Mutation Tests
// ============================================================================

describe("removeChannelMember", () => {
  test("removes member from custom channel", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add user
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Remove user
    await t.mutation(api.functions.messaging.channels.removeChannelMember, {
      token: leaderToken,
      channelId: result.channelId,
      userId,
    });

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", userId)
        )
        .first();
    });

    expect(membership?.leftAt).toBeDefined();
  });

  test("promotes next member when removing owner", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add another user
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Remove owner (leader) - the owner removes themselves
    await t.mutation(api.functions.messaging.channels.removeChannelMember, {
      token: leaderToken, // Owner removing themselves
      channelId: result.channelId,
      userId: leaderId,
    });

    // Check that user is now owner
    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", userId)
        )
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
    });

    expect(membership?.role).toBe("owner");
  });

  test("archives channel when removing last member", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel with single member (owner)
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Solo Channel",
    });

    // Remove the only member (self)
    await t.mutation(api.functions.messaging.channels.removeChannelMember, {
      token: leaderToken,
      channelId: result.channelId,
      userId: leaderId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });

    expect(channel?.isArchived).toBe(true);
    expect(channel?.memberCount).toBe(0);
  });

  test("requires channel owner or group leader permission", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add user and make them a member (not owner)
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Create another member
    const anotherUserId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Another",
        lastName: "User",
        phone: "+15555550777",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return uId;
    });

    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [anotherUserId],
    });

    // Regular member tries to remove someone
    await expect(
      t.mutation(api.functions.messaging.channels.removeChannelMember, {
        token: accessToken, // Regular member, not owner
        channelId: result.channelId,
        userId: anotherUserId,
      })
    ).rejects.toThrow(/channel owner or group leaders/);
  });

  test("only works on custom channels", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create main channel
    const channelId = await t.run(async (ctx) => {
      const chId = await ctx.db.insert("chatChannels", {
        groupId,
        slug: "general",
        channelType: "main",
        name: "General",
        createdById: leaderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
      // Add membership
      await ctx.db.insert("chatChannelMembers", {
        channelId: chId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      return chId;
    });

    await expect(
      t.mutation(api.functions.messaging.channels.removeChannelMember, {
        token: leaderToken,
        channelId,
        userId,
      })
    ).rejects.toThrow(/only remove members from custom channels/);
  });
});

// ============================================================================
// listGroupChannels Query Tests
// ============================================================================

describe("listGroupChannels", () => {
  test("returns all channels with membership status", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create channels
    const mainChannelId = await t.run(async (ctx) => {
      const chId = await ctx.db.insert("chatChannels", {
        groupId,
        slug: "general",
        channelType: "main",
        name: "General",
        createdById: leaderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: chId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      return chId;
    });

    const customResult = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add user to custom channel
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: customResult.channelId,
      userIds: [userId],
    });

    // Query as user
    const channels = await t.query(api.functions.messaging.channels.listGroupChannels, {
      token: accessToken,
      groupId,
    });

    expect(channels.length).toBeGreaterThanOrEqual(2);

    const mainChannel = channels.find((c) => c.channelType === "main");
    const customChannel = channels.find((c) => c.channelType === "custom");

    expect(mainChannel).toBeDefined();
    expect(mainChannel?.isMember).toBe(true);

    expect(customChannel).toBeDefined();
    expect(customChannel?.isMember).toBe(true);
  });

  test("sorts: main first, leaders second, custom alphabetically", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create channels in random order
    await t.run(async (ctx) => {
      const now = Date.now();
      // Create main
      const mainId = await ctx.db.insert("chatChannels", {
        groupId,
        slug: "general",
        channelType: "main",
        name: "General",
        createdById: leaderId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: mainId,
        userId: leaderId,
        role: "admin",
        joinedAt: now,
        isMuted: false,
      });

      // Create leaders
      const leadersId = await ctx.db.insert("chatChannels", {
        groupId,
        slug: "leaders",
        channelType: "leaders",
        name: "Leaders",
        createdById: leaderId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: leadersId,
        userId: leaderId,
        role: "admin",
        joinedAt: now,
        isMuted: false,
      });
    });

    // Create custom channels
    await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Zebra Channel",
    });

    await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Apple Channel",
    });

    const channels = await t.query(api.functions.messaging.channels.listGroupChannels, {
      token: leaderToken,
      groupId,
    });

    // First should be main
    expect(channels[0].channelType).toBe("main");

    // Second should be leaders
    expect(channels[1].channelType).toBe("leaders");

    // Custom channels should be sorted alphabetically
    const customChannels = channels.filter((c) => c.channelType === "custom");
    expect(customChannels[0].name).toBe("Apple Channel");
    expect(customChannels[1].name).toBe("Zebra Channel");
  });

  test("hides leaders channel from non-leaders", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create main and leaders channels
    await t.run(async (ctx) => {
      const now = Date.now();
      const mainId = await ctx.db.insert("chatChannels", {
        groupId,
        slug: "general",
        channelType: "main",
        name: "General",
        createdById: leaderId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 2,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: mainId,
        userId,
        role: "member",
        joinedAt: now,
        isMuted: false,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: mainId,
        userId: leaderId,
        role: "admin",
        joinedAt: now,
        isMuted: false,
      });

      const leadersId = await ctx.db.insert("chatChannels", {
        groupId,
        slug: "leaders",
        channelType: "leaders",
        name: "Leaders",
        createdById: leaderId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: leadersId,
        userId: leaderId,
        role: "admin",
        joinedAt: now,
        isMuted: false,
      });
    });

    // Query as regular member
    const channels = await t.query(api.functions.messaging.channels.listGroupChannels, {
      token: accessToken,
      groupId,
    });

    const leadersChannel = channels.find((c) => c.channelType === "leaders");
    expect(leadersChannel).toBeUndefined();
  });

  test("excludes archived channels by default", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create an archived channel
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("chatChannels", {
        groupId,
        slug: "archived-channel",
        channelType: "custom",
        name: "Archived Channel",
        createdById: leaderId,
        createdAt: now,
        updatedAt: now,
        isArchived: true,
        archivedAt: now,
        memberCount: 0,
      });
    });

    const channels = await t.query(api.functions.messaging.channels.listGroupChannels, {
      token: leaderToken,
      groupId,
    });

    const archivedChannel = channels.find((c) => c.slug === "archived-channel");
    expect(archivedChannel).toBeUndefined();
  });
});

// ============================================================================
// getChannelBySlug Query Tests
// ============================================================================

describe("getChannelBySlug", () => {
  test("finds channel by groupId + slug", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    const channel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: leaderToken,
      groupId,
      slug: "directors",
    });

    expect(channel).not.toBeNull();
    expect(channel?._id).toEqual(result.channelId);
    expect(channel?.slug).toBe("directors");
  });

  test("handles backwards compatibility for general", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { userId: leaderId } = await createLeaderUser(t, communityId, groupId);

    // Create main channel with channelType "main" (no explicit slug or slug different from "general")
    await t.run(async (ctx) => {
      const now = Date.now();
      const chId = await ctx.db.insert("chatChannels", {
        groupId,
        slug: "old-general-slug", // Different slug to test fallback
        channelType: "main",
        name: "General",
        createdById: leaderId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: chId,
        userId,
        role: "member",
        joinedAt: now,
        isMuted: false,
      });
    });

    // Query using "general" slug (backwards compatibility)
    const channel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: accessToken,
      groupId,
      slug: "general",
    });

    expect(channel).not.toBeNull();
    expect(channel?.channelType).toBe("main");
  });

  test("handles backwards compatibility for leaders", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create leaders channel
    await t.run(async (ctx) => {
      const now = Date.now();
      const chId = await ctx.db.insert("chatChannels", {
        groupId,
        slug: "old-leaders-slug", // Different slug to test fallback
        channelType: "leaders",
        name: "Leaders",
        createdById: leaderId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: chId,
        userId: leaderId,
        role: "admin",
        joinedAt: now,
        isMuted: false,
      });
    });

    // Query using "leaders" slug (backwards compatibility)
    const channel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: leaderToken,
      groupId,
      slug: "leaders",
    });

    expect(channel).not.toBeNull();
    expect(channel?.channelType).toBe("leaders");
  });

  test("returns membership info", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel
    await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    const channel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: leaderToken,
      groupId,
      slug: "directors",
    });

    expect(channel?.isMember).toBe(true);
    expect(channel?.role).toBe("owner");
    expect(channel?.userGroupRole).toBe("leader");
  });

  test("returns null for non-existent slug", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seedTestData(t);

    const channel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: accessToken,
      groupId,
      slug: "non-existent",
    });

    expect(channel).toBeNull();
  });

  test("returns null for archived channels", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, accessToken } = await seedTestData(t);
    const { userId: leaderId } = await createLeaderUser(t, communityId, groupId);

    // Create archived channel
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("chatChannels", {
        groupId,
        slug: "archived-channel",
        channelType: "custom",
        name: "Archived Channel",
        createdById: leaderId,
        createdAt: now,
        updatedAt: now,
        isArchived: true,
        archivedAt: now,
        memberCount: 0,
      });
    });

    const channel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: accessToken,
      groupId,
      slug: "archived-channel",
    });

    expect(channel).toBeNull();
  });

  test("returns null for custom channels where user is not a member", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, accessToken } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel (leader is member, regular user is not)
    await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Regular user tries to access
    const channel = await t.query(api.functions.messaging.channels.getChannelBySlug, {
      token: accessToken,
      groupId,
      slug: "directors",
    });

    expect(channel).toBeNull();
  });
});

// ============================================================================
// archiveCustomChannel Mutation Tests
// ============================================================================

describe("archiveCustomChannel", () => {
  test("archives custom channel successfully", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    await t.mutation(api.functions.messaging.channels.archiveCustomChannel, {
      token: leaderToken,
      channelId: result.channelId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });

    expect(channel?.isArchived).toBe(true);
    expect(channel?.archivedAt).toBeDefined();
  });

  test("rejects archiving auto channels", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create main channel
    const channelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId,
        slug: "general",
        channelType: "main",
        name: "General",
        createdById: leaderId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
    });

    await expect(
      t.mutation(api.functions.messaging.channels.archiveCustomChannel, {
        token: leaderToken,
        channelId,
      })
    ).rejects.toThrow(/can't archive auto channels/);
  });

  test("allows channel owner to archive", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel by leader
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add regular user and make them owner
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Transfer ownership by making user the owner
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", result.channelId).eq("userId", userId)
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { role: "owner" });
      }
    });

    // User (now owner) archives
    await t.mutation(api.functions.messaging.channels.archiveCustomChannel, {
      token: accessToken,
      channelId: result.channelId,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(result.channelId);
    });

    expect(channel?.isArchived).toBe(true);
  });

  test("rejects non-owner non-leader trying to archive", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, accessToken } = await seedTestData(t);
    const { accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create custom channel by leader
    const result = await t.mutation(api.functions.messaging.channels.createCustomChannel, {
      token: leaderToken,
      groupId,
      name: "Directors",
    });

    // Add regular user as member (not owner)
    await t.mutation(api.functions.messaging.channels.addChannelMembers, {
      token: leaderToken,
      channelId: result.channelId,
      userIds: [userId],
    });

    // Regular member tries to archive
    await expect(
      t.mutation(api.functions.messaging.channels.archiveCustomChannel, {
        token: accessToken,
        channelId: result.channelId,
      })
    ).rejects.toThrow(/channel owner or group leaders/);
  });
});

// ============================================================================
// Auto Channel Config Tests
// ============================================================================

describe("updateAutoChannelConfig", () => {
  test("updates filter-based config correctly", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create a PCO auto channel with filter-based config
    const channelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        name: "Worship Team",
        groupId,
        channelType: "pco_services",
        memberCount: 0,
        createdById: leaderId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        slug: "worship-team",
      });
    });

    // Create the auto channel config with filters
    await t.run(async (ctx) => {
      await ctx.db.insert("autoChannelConfigs", {
        communityId,
        channelId,
        integrationType: "pco_services",
        config: {
          filters: {
            serviceTypeIds: ["service1"],
            serviceTypeNames: ["Sunday Service"],
            teamIds: ["team1"],
            teamNames: ["Worship"],
            positions: ["Vocalist"],
          },
          // Legacy fields
          serviceTypeId: "service1",
          serviceTypeName: "Sunday Service",
          syncScope: "single_team",
          teamIds: ["team1"],
          teamNames: ["Worship"],
          addMembersDaysBefore: 5,
          removeMembersDaysAfter: 1,
        },
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Add leader as channel member
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: leaderId,
        role: "member",
        isMuted: false,
        joinedAt: Date.now(),
      });
    });

    // Update the config with new filters
    await t.mutation(api.functions.messaging.channels.updateAutoChannelConfig, {
      token: leaderToken,
      channelId,
      config: {
        filters: {
          serviceTypeIds: ["service2", "service3"],
          serviceTypeNames: ["Saturday Service", "Wednesday Service"],
          teamIds: ["team2"],
          teamNames: ["Band"],
          positions: ["Drummer", "Bassist"],
        },
        // Update legacy fields too
        serviceTypeId: "service2",
        serviceTypeName: "Saturday Service",
        syncScope: "multi_team",
        teamIds: ["team2"],
        teamNames: ["Band"],
        addMembersDaysBefore: 7,
        removeMembersDaysAfter: 2,
      },
    });

    // Verify the config was updated
    const updatedConfig = await t.run(async (ctx) => {
      return await ctx.db
        .query("autoChannelConfigs")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .unique();
    });

    expect(updatedConfig).not.toBeNull();
    // Verify filters were updated (this was the bug - filters weren't being saved)
    expect(updatedConfig!.config.filters).toBeDefined();
    expect(updatedConfig!.config.filters?.serviceTypeIds).toEqual(["service2", "service3"]);
    expect(updatedConfig!.config.filters?.serviceTypeNames).toEqual(["Saturday Service", "Wednesday Service"]);
    expect(updatedConfig!.config.filters?.teamIds).toEqual(["team2"]);
    expect(updatedConfig!.config.filters?.teamNames).toEqual(["Band"]);
    expect(updatedConfig!.config.filters?.positions).toEqual(["Drummer", "Bassist"]);
    // Verify legacy fields were also updated
    expect(updatedConfig!.config.serviceTypeId).toBe("service2");
    expect(updatedConfig!.config.addMembersDaysBefore).toBe(7);
    expect(updatedConfig!.config.removeMembersDaysAfter).toBe(2);
  });

  test("preserves filters when only updating legacy fields", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedTestData(t);
    const { userId: leaderId, accessToken: leaderToken } = await createLeaderUser(t, communityId, groupId);

    // Create a PCO auto channel with filter-based config
    const channelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        name: "Tech Team",
        groupId,
        channelType: "pco_services",
        memberCount: 0,
        createdById: leaderId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        slug: "tech-team",
      });
    });

    // Create the auto channel config with filters
    await t.run(async (ctx) => {
      await ctx.db.insert("autoChannelConfigs", {
        communityId,
        channelId,
        integrationType: "pco_services",
        config: {
          filters: {
            serviceTypeIds: ["service1"],
            serviceTypeNames: ["Sunday Service"],
            positions: ["Sound Engineer"],
          },
          serviceTypeId: "service1",
          serviceTypeName: "Sunday Service",
          syncScope: "all_teams",
          addMembersDaysBefore: 5,
          removeMembersDaysAfter: 1,
        },
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Add leader as channel member
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: leaderId,
        role: "member",
        isMuted: false,
        joinedAt: Date.now(),
      });
    });

    // Update ONLY timing fields (not filters)
    await t.mutation(api.functions.messaging.channels.updateAutoChannelConfig, {
      token: leaderToken,
      channelId,
      config: {
        addMembersDaysBefore: 10,
        removeMembersDaysAfter: 3,
      },
    });

    // Verify the config was updated
    const updatedConfig = await t.run(async (ctx) => {
      return await ctx.db
        .query("autoChannelConfigs")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .unique();
    });

    expect(updatedConfig).not.toBeNull();
    // Verify filters were preserved (not overwritten)
    expect(updatedConfig!.config.filters).toBeDefined();
    expect(updatedConfig!.config.filters?.serviceTypeIds).toEqual(["service1"]);
    expect(updatedConfig!.config.filters?.positions).toEqual(["Sound Engineer"]);
    // Verify timing fields were updated
    expect(updatedConfig!.config.addMembersDaysBefore).toBe(10);
    expect(updatedConfig!.config.removeMembersDaysAfter).toBe(3);
  });

  test("rejects non-leader trying to update config", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, userId, accessToken } = await seedTestData(t);

    // Create a PCO auto channel
    const channelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        name: "Test Channel",
        groupId,
        channelType: "pco_services",
        memberCount: 0,
        createdById: userId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        slug: "test-channel",
      });
    });

    // Create the auto channel config
    await t.run(async (ctx) => {
      await ctx.db.insert("autoChannelConfigs", {
        communityId,
        channelId,
        integrationType: "pco_services",
        config: {
          serviceTypeId: "service1",
          addMembersDaysBefore: 5,
          removeMembersDaysAfter: 1,
        },
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Add regular user as channel member
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId,
        role: "member",
        isMuted: false,
        joinedAt: Date.now(),
      });
    });

    // Regular member tries to update - should be rejected
    await expect(
      t.mutation(api.functions.messaging.channels.updateAutoChannelConfig, {
        token: accessToken,
        channelId,
        config: {
          addMembersDaysBefore: 10,
        },
      })
    ).rejects.toThrow(/Only group leaders can update/);
  });
});
