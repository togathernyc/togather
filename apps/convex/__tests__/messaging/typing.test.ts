/**
 * Typing Indicator Tests for Convex-Native Messaging
 *
 * Tests typing indicators and automatic cleanup.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
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
  groupId: Id<"groups">;
  channelId: Id<"chatChannels">;
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

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  const channelId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatChannels", {
      groupId,
      channelType: "main",
      name: "General",
      slug: "general",
      createdById: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      memberCount: 1,
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId,
      role: "member",
      joinedAt: Date.now(),
      isMuted: false,
    });
  });

  const { accessToken } = await generateTokens(userId);

  return { userId, communityId, groupId, channelId, accessToken };
}

async function createSecondUser(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  groupId: Id<"groups">,
  channelId: Id<"chatChannels">
): Promise<{ userId: Id<"users">; accessToken: string }> {
  const userId = await t.run(async (ctx) => {
    const uId = await ctx.db.insert("users", {
      firstName: "Second",
      lastName: "User",
      phone: "+15555550002",
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
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId: uId,
      role: "member",
      joinedAt: Date.now(),
      isMuted: false,
    });
    return uId;
  });

  const { accessToken } = await generateTokens(userId);
  return { userId, accessToken };
}

// ============================================================================
// Start Typing Tests
// ============================================================================

describe("Start Typing", () => {
  test("should create typing indicator", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: accessToken,
      channelId,
    });

    const indicator = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatTypingIndicators")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    expect(indicator).not.toBeNull();
    expect(indicator?.channelId).toBe(channelId);
    expect(indicator?.userId).toBe(userId);
  });

  test("should set expiresAt in the future", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    const before = Date.now();

    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: accessToken,
      channelId,
    });

    const indicator = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatTypingIndicators")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    // Expires at should be ~5 seconds in the future
    expect(indicator?.expiresAt).toBeGreaterThan(before);
    expect(indicator?.expiresAt).toBeLessThanOrEqual(before + 10000); // Within 10s
  });

  test("should update existing typing indicator", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    // Start typing first time
    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: accessToken,
      channelId,
    });

    const indicator1 = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatTypingIndicators")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Start typing again
    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: accessToken,
      channelId,
    });

    const indicator2 = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatTypingIndicators")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    // Should be same document with updated expiresAt
    expect(indicator2?._id).toBe(indicator1?._id);
    expect(indicator2?.expiresAt).toBeGreaterThan(indicator1?.expiresAt || 0);
  });

  test("should reject from non-channel-member", async () => {
    const t = convexTest(schema, modules);
    const { channelId, communityId } = await seedTestData(t);

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
      t.mutation(api.functions.messaging.typing.startTyping, {
        token: nonMemberToken,
        channelId,
      })
    ).rejects.toThrow();
  });
});

// ============================================================================
// Stop Typing Tests
// ============================================================================

describe("Stop Typing", () => {
  test("should remove typing indicator", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    // Start typing
    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: accessToken,
      channelId,
    });

    // Stop typing
    await t.mutation(api.functions.messaging.typing.stopTyping, {
      token: accessToken,
      channelId,
    });

    const indicator = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatTypingIndicators")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    expect(indicator).toBeNull();
  });

  test("should not error when no indicator exists", async () => {
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Should not throw
    await t.mutation(api.functions.messaging.typing.stopTyping, {
      token: accessToken,
      channelId,
    });
  });
});

// ============================================================================
// Get Typing Users Tests
// ============================================================================

describe("Get Typing Users", () => {
  test("should get list of typing users", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, channelId, accessToken } = await seedTestData(t);

    // Start typing as first user
    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: accessToken,
      channelId,
    });

    // Create and start typing as second user
    const { accessToken: secondToken } = await createSecondUser(
      t,
      communityId,
      groupId,
      channelId
    );

    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: secondToken,
      channelId,
    });

    // Query from first user's perspective - should see second user (self is excluded)
    const typingUsersFromFirst = await t.query(api.functions.messaging.typing.getTypingUsers, {
      token: accessToken,
      channelId,
    });

    expect(typingUsersFromFirst).toHaveLength(1);

    // Query from second user's perspective - should see first user
    const typingUsersFromSecond = await t.query(api.functions.messaging.typing.getTypingUsers, {
      token: secondToken,
      channelId,
    });

    expect(typingUsersFromSecond).toHaveLength(1);
  });

  test("should not include self in typing users", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: accessToken,
      channelId,
    });

    const typingUsers = await t.query(api.functions.messaging.typing.getTypingUsers, {
      token: accessToken,
      channelId,
    });

    // Self should be excluded
    expect(typingUsers.map((u) => u._id)).not.toContain(userId);
  });

  test("should return user info for typing users", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, channelId, accessToken } = await seedTestData(t);

    const { userId: secondUserId, accessToken: secondToken } = await createSecondUser(
      t,
      communityId,
      groupId,
      channelId
    );

    await t.mutation(api.functions.messaging.typing.startTyping, {
      token: secondToken,
      channelId,
    });

    const typingUsers = await t.query(api.functions.messaging.typing.getTypingUsers, {
      token: accessToken,
      channelId,
    });

    expect(typingUsers).toHaveLength(1);
    expect(typingUsers[0].firstName).toBe("Second");
  });

  test("should not include expired indicators", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    // Create expired indicator directly in DB
    await t.run(async (ctx) => {
      await ctx.db.insert("chatTypingIndicators", {
        channelId,
        userId,
        startedAt: Date.now() - 10000, // 10 seconds ago
        expiresAt: Date.now() - 5000, // Expired 5 seconds ago
      });
    });

    const typingUsers = await t.query(api.functions.messaging.typing.getTypingUsers, {
      token: accessToken,
      channelId,
    });

    expect(typingUsers).toHaveLength(0);
  });
});

// ============================================================================
// Cleanup Expired Indicators Tests
// ============================================================================

describe("Cleanup Expired Indicators", () => {
  test("should remove expired typing indicators", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId } = await seedTestData(t);

    // Create expired indicator
    await t.run(async (ctx) => {
      await ctx.db.insert("chatTypingIndicators", {
        channelId,
        userId,
        startedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000, // Expired
      });
    });

    // Run cleanup
    await t.mutation(internal.functions.messaging.typing.cleanupExpiredIndicators, {});

    const indicators = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatTypingIndicators")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect();
    });

    expect(indicators).toHaveLength(0);
  });

  test("should not remove active indicators", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId } = await seedTestData(t);

    // Create active indicator
    await t.run(async (ctx) => {
      await ctx.db.insert("chatTypingIndicators", {
        channelId,
        userId,
        startedAt: Date.now(),
        expiresAt: Date.now() + 5000, // Not expired
      });
    });

    // Run cleanup
    await t.mutation(internal.functions.messaging.typing.cleanupExpiredIndicators, {});

    const indicators = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatTypingIndicators")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect();
    });

    expect(indicators).toHaveLength(1);
  });

  test("should handle multiple expired indicators", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId } = await seedTestData(t);

    // Create another user
    const secondUserId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Second",
        lastName: "User",
        phone: "+15555550003",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return uId;
    });

    // Create multiple expired indicators
    await t.run(async (ctx) => {
      await ctx.db.insert("chatTypingIndicators", {
        channelId,
        userId,
        startedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
      });
      await ctx.db.insert("chatTypingIndicators", {
        channelId,
        userId: secondUserId,
        startedAt: Date.now() - 10000,
        expiresAt: Date.now() - 3000,
      });
    });

    // Run cleanup
    await t.mutation(internal.functions.messaging.typing.cleanupExpiredIndicators, {});

    const indicators = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatTypingIndicators")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect();
    });

    expect(indicators).toHaveLength(0);
  });
});
