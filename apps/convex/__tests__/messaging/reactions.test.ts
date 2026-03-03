/**
 * Reaction Tests for Convex-Native Messaging
 *
 * Tests reaction toggling and aggregation.
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
  groupId: Id<"groups">;
  channelId: Id<"chatChannels">;
  messageId: Id<"chatMessages">;
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

  const messageId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatMessages", {
      channelId,
      senderId: userId,
      content: "Test message for reactions",
      contentType: "text",
      createdAt: Date.now(),
      isDeleted: false,
      senderName: "Test User",
    });
  });

  const { accessToken } = await generateTokens(userId);

  return { userId, communityId, groupId, channelId, messageId, accessToken };
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
// Toggle Reaction Tests
// ============================================================================

describe("Toggle Reaction", () => {
  test("should add a reaction to a message", async () => {
    const t = convexTest(schema, modules);
    const { userId, messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    const reaction = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessageReactions")
        .withIndex("by_message_user", (q) =>
          q.eq("messageId", messageId).eq("userId", userId)
        )
        .first();
    });

    expect(reaction).not.toBeNull();
    expect(reaction?.emoji).toBe("👍");
  });

  test("should remove reaction on second toggle", async () => {
    const t = convexTest(schema, modules);
    const { userId, messageId, accessToken } = await seedTestData(t);

    // Add reaction
    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    // Remove reaction
    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    const reaction = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessageReactions")
        .withIndex("by_message_user", (q) =>
          q.eq("messageId", messageId).eq("userId", userId)
        )
        .first();
    });

    expect(reaction).toBeNull();
  });

  test("should allow multiple different reactions from same user", async () => {
    const t = convexTest(schema, modules);
    const { userId, messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "❤️",
    });

    const reactions = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessageReactions")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .filter((q) => q.eq(q.field("userId"), userId))
        .collect();
    });

    expect(reactions).toHaveLength(2);
  });

  test("should reject reaction from non-channel-member", async () => {
    const t = convexTest(schema, modules);
    const { messageId, communityId } = await seedTestData(t);

    // Create non-member user
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
      t.mutation(api.functions.messaging.reactions.toggleReaction, {
        token: nonMemberToken,
        messageId,
        emoji: "👍",
      })
    ).rejects.toThrow();
  });

  test("should not allow reaction on deleted message", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    // Create a deleted message
    const deletedMessageId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: userId,
        content: "Deleted message",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: true,
        deletedAt: Date.now(),
        deletedById: userId,
      });
    });

    await expect(
      t.mutation(api.functions.messaging.reactions.toggleReaction, {
        token: accessToken,
        messageId: deletedMessageId,
        emoji: "👍",
      })
    ).rejects.toThrow();
  });
});

// ============================================================================
// Get Reactions Tests
// ============================================================================

describe("Get Reactions", () => {
  test("should get reaction summary for a message", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, channelId, messageId, accessToken } = await seedTestData(t);

    // Add reaction from first user
    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    // Add reaction from second user
    const { accessToken: secondToken } = await createSecondUser(
      t,
      communityId,
      groupId,
      channelId
    );

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: secondToken,
      messageId,
      emoji: "👍",
    });

    const reactions = await t.query(api.functions.messaging.reactions.getReactions, {
      token: accessToken,
      messageId,
    });

    expect(reactions).toHaveLength(1);
    expect(reactions[0].emoji).toBe("👍");
    expect(reactions[0].count).toBe(2);
  });

  test("should aggregate multiple emoji types", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, channelId, messageId, accessToken } = await seedTestData(t);

    // First user: 👍 and ❤️
    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "❤️",
    });

    // Second user: 👍
    const { accessToken: secondToken } = await createSecondUser(
      t,
      communityId,
      groupId,
      channelId
    );

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: secondToken,
      messageId,
      emoji: "👍",
    });

    const reactions = await t.query(api.functions.messaging.reactions.getReactions, {
      token: accessToken,
      messageId,
    });

    expect(reactions).toHaveLength(2);
    
    const thumbsUp = reactions.find((r) => r.emoji === "👍");
    const heart = reactions.find((r) => r.emoji === "❤️");
    
    expect(thumbsUp?.count).toBe(2);
    expect(heart?.count).toBe(1);
  });

  test("should include user IDs who reacted", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    const { userId: secondUserId, accessToken: secondToken } = await createSecondUser(
      t,
      communityId,
      groupId,
      channelId
    );

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: secondToken,
      messageId,
      emoji: "👍",
    });

    const reactions = await t.query(api.functions.messaging.reactions.getReactions, {
      token: accessToken,
      messageId,
    });

    expect(reactions[0].userIds).toContain(userId);
    expect(reactions[0].userIds).toContain(secondUserId);
  });

  test("should indicate if current user reacted", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, channelId, messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    // Create second user who hasn't reacted
    const { accessToken: secondToken } = await createSecondUser(
      t,
      communityId,
      groupId,
      channelId
    );

    // Query as first user (who reacted)
    const reactions1 = await t.query(api.functions.messaging.reactions.getReactions, {
      token: accessToken,
      messageId,
    });

    expect(reactions1[0].hasReacted).toBe(true);

    // Query as second user (who hasn't reacted)
    const reactions2 = await t.query(api.functions.messaging.reactions.getReactions, {
      token: secondToken,
      messageId,
    });

    expect(reactions2[0].hasReacted).toBe(false);
  });

  test("should return empty array for message with no reactions", async () => {
    const t = convexTest(schema, modules);
    const { messageId, accessToken } = await seedTestData(t);

    const reactions = await t.query(api.functions.messaging.reactions.getReactions, {
      token: accessToken,
      messageId,
    });

    expect(reactions).toHaveLength(0);
  });
});

// ============================================================================
// Reaction Edge Cases
// ============================================================================

describe("Reaction Edge Cases", () => {
  test("should handle unicode emoji", async () => {
    const t = convexTest(schema, modules);
    const { messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "🎉",
    });

    const reactions = await t.query(api.functions.messaging.reactions.getReactions, {
      token: accessToken,
      messageId,
    });

    expect(reactions[0].emoji).toBe("🎉");
  });

  test("should handle emoji shortcodes", async () => {
    const t = convexTest(schema, modules);
    const { messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: ":thumbsup:",
    });

    const reactions = await t.query(api.functions.messaging.reactions.getReactions, {
      token: accessToken,
      messageId,
    });

    expect(reactions[0].emoji).toBe(":thumbsup:");
  });

  test("should set createdAt timestamp on reaction", async () => {
    const t = convexTest(schema, modules);
    const { userId, messageId, accessToken } = await seedTestData(t);

    const before = Date.now();

    await t.mutation(api.functions.messaging.reactions.toggleReaction, {
      token: accessToken,
      messageId,
      emoji: "👍",
    });

    const after = Date.now();

    const reaction = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessageReactions")
        .withIndex("by_message_user", (q) =>
          q.eq("messageId", messageId).eq("userId", userId)
        )
        .first();
    });

    expect(reaction?.createdAt).toBeGreaterThanOrEqual(before);
    expect(reaction?.createdAt).toBeLessThanOrEqual(after);
  });
});
