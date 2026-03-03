/**
 * Blocking Tests for Convex-Native Messaging
 *
 * Tests user blocking and unblocking functionality.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";
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

  return { userId, communityId, accessToken };
}

async function createAnotherUser(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  name: string = "Another"
): Promise<{ userId: Id<"users">; accessToken: string }> {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: name,
      lastName: "User",
      phone: `+1555555${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`,
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const { accessToken } = await generateTokens(userId);
  return { userId, accessToken };
}

// ============================================================================
// Block User Tests
// ============================================================================

describe("Block User", () => {
  test("should block a user", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, accessToken } = await seedTestData(t);
    const { userId: targetId } = await createAnotherUser(t, communityId, "Target");

    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: targetId,
    });

    const block = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", userId).eq("blockedId", targetId)
        )
        .first();
    });

    expect(block).not.toBeNull();
    expect(block?.blockerId).toBe(userId);
    expect(block?.blockedId).toBe(targetId);
  });

  test("should block user with reason", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, accessToken } = await seedTestData(t);
    const { userId: targetId } = await createAnotherUser(t, communityId, "Target");

    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: targetId,
      reason: "Spam messages",
    });

    const block = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", userId).eq("blockedId", targetId)
        )
        .first();
    });

    expect(block?.reason).toBe("Spam messages");
  });

  test("should not allow blocking self", async () => {
    const t = convexTest(schema, modules);
    const { userId, accessToken } = await seedTestData(t);

    await expect(
      t.mutation(api.functions.messaging.blocking.blockUser, {
        token: accessToken,
        blockedId: userId,
      })
    ).rejects.toThrow();
  });

  test("should not create duplicate blocks", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, accessToken } = await seedTestData(t);
    const { userId: targetId } = await createAnotherUser(t, communityId, "Target");

    // Block once
    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: targetId,
    });

    // Block again - should not error but should not create duplicate
    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: targetId,
    });

    const blocks = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", userId).eq("blockedId", targetId)
        )
        .collect();
    });

    expect(blocks).toHaveLength(1);
  });

  test("should set createdAt timestamp", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, accessToken } = await seedTestData(t);
    const { userId: targetId } = await createAnotherUser(t, communityId, "Target");

    const before = Date.now();

    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: targetId,
    });

    const after = Date.now();

    const block = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", userId).eq("blockedId", targetId)
        )
        .first();
    });

    expect(block?.createdAt).toBeGreaterThanOrEqual(before);
    expect(block?.createdAt).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// Unblock User Tests
// ============================================================================

describe("Unblock User", () => {
  test("should unblock a user", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, accessToken } = await seedTestData(t);
    const { userId: targetId } = await createAnotherUser(t, communityId, "Target");

    // Block first
    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: targetId,
    });

    // Then unblock
    await t.mutation(api.functions.messaging.blocking.unblockUser, {
      token: accessToken,
      blockedId: targetId,
    });

    const block = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", userId).eq("blockedId", targetId)
        )
        .first();
    });

    expect(block).toBeNull();
  });

  test("should not error when unblocking non-blocked user", async () => {
    const t = convexTest(schema, modules);
    const { communityId, accessToken } = await seedTestData(t);
    const { userId: targetId } = await createAnotherUser(t, communityId, "Target");

    // Should not throw
    await t.mutation(api.functions.messaging.blocking.unblockUser, {
      token: accessToken,
      blockedId: targetId,
    });
  });
});

// ============================================================================
// Get Blocked Users Tests
// ============================================================================

describe("Get Blocked Users", () => {
  test("should return list of blocked users", async () => {
    const t = convexTest(schema, modules);
    const { communityId, accessToken } = await seedTestData(t);

    const { userId: target1Id } = await createAnotherUser(t, communityId, "Target1");
    const { userId: target2Id } = await createAnotherUser(t, communityId, "Target2");

    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: target1Id,
    });

    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: target2Id,
    });

    const blockedUsers = await t.query(api.functions.messaging.blocking.getBlockedUsers, {
      token: accessToken,
    });

    expect(blockedUsers).toHaveLength(2);
    expect(blockedUsers.map((u) => u._id)).toContain(target1Id);
    expect(blockedUsers.map((u) => u._id)).toContain(target2Id);
  });

  test("should return empty array when no users blocked", async () => {
    const t = convexTest(schema, modules);
    const { accessToken } = await seedTestData(t);

    const blockedUsers = await t.query(api.functions.messaging.blocking.getBlockedUsers, {
      token: accessToken,
    });

    expect(blockedUsers).toHaveLength(0);
  });

  test("should return user info for blocked users", async () => {
    const t = convexTest(schema, modules);
    const { communityId, accessToken } = await seedTestData(t);

    const { userId: targetId } = await createAnotherUser(t, communityId, "BlockedPerson");

    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: targetId,
    });

    const blockedUsers = await t.query(api.functions.messaging.blocking.getBlockedUsers, {
      token: accessToken,
    });

    expect(blockedUsers[0].firstName).toBe("BlockedPerson");
  });
});

// ============================================================================
// Is Blocked Tests
// ============================================================================

describe("Is Blocked", () => {
  test("should return true when user is blocked", async () => {
    const t = convexTest(schema, modules);
    const { communityId, accessToken } = await seedTestData(t);
    const { userId: targetId } = await createAnotherUser(t, communityId, "Target");

    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: targetId,
    });

    const isBlocked = await t.query(api.functions.messaging.blocking.isBlocked, {
      token: accessToken,
      userId: targetId,
    });

    expect(isBlocked).toBe(true);
  });

  test("should return false when user is not blocked", async () => {
    const t = convexTest(schema, modules);
    const { communityId, accessToken } = await seedTestData(t);
    const { userId: targetId } = await createAnotherUser(t, communityId, "Target");

    const isBlocked = await t.query(api.functions.messaging.blocking.isBlocked, {
      token: accessToken,
      userId: targetId,
    });

    expect(isBlocked).toBe(false);
  });

  test("should check if current user is blocked by another", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, accessToken } = await seedTestData(t);
    const { userId: blockerId, accessToken: blockerToken } = await createAnotherUser(
      t,
      communityId,
      "Blocker"
    );

    // Blocker blocks current user
    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: blockerToken,
      blockedId: userId,
    });

    // Current user checks if blocked by blocker
    const isBlocked = await t.query(api.functions.messaging.blocking.isBlockedBy, {
      token: accessToken,
      userId: blockerId,
    });

    expect(isBlocked).toBe(true);
  });
});

// ============================================================================
// Blocking Effects on Messaging Tests
// ============================================================================

describe("Blocking Effects", () => {
  test("should not receive messages from blocked user in query", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, accessToken } = await seedTestData(t);

    const groupTypeId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupTypes", {
        communityId,
        name: "Test",
        slug: "test",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
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

    const channelId = await t.run(async (ctx) => {
      const chId = await ctx.db.insert("chatChannels", {
        groupId,
        channelType: "main",
        name: "General",
        slug: "general",
        createdById: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 2,
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

    // Create blocked user and add to channel
    const { userId: blockedUserId } = await createAnotherUser(t, communityId, "Blocked");

    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: blockedUserId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    // Blocked user sends a message
    await t.run(async (ctx) => {
      await ctx.db.insert("chatMessages", {
        channelId,
        senderId: blockedUserId,
        content: "Message from blocked user",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    // Block the user
    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: accessToken,
      blockedId: blockedUserId,
    });

    // Query messages - should filter out blocked user's messages
    const result = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
    });

    expect(result.messages).toHaveLength(0);
  });
});
