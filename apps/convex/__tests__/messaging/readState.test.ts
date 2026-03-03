/**
 * Read State Tests for Convex-Native Messaging
 *
 * Tests unread counts and mark as read functionality.
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

async function createAnotherUserWithMembership(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  groupId: Id<"groups">,
  channelId: Id<"chatChannels">
): Promise<{ userId: Id<"users">; accessToken: string }> {
  const userId = await t.run(async (ctx) => {
    const uId = await ctx.db.insert("users", {
      firstName: "Another",
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

async function sendMessage(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"chatChannels">,
  senderId: Id<"users">,
  content: string
): Promise<Id<"chatMessages">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("chatMessages", {
      channelId,
      senderId,
      content,
      contentType: "text",
      createdAt: Date.now(),
      isDeleted: false,
      senderName: "Test User",
    });
  });
}

// ============================================================================
// Get Unread Count Tests
// ============================================================================

describe("Get Unread Count", () => {
  test("should return 0 for new channel", async () => {
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const unreadCount = await t.query(api.functions.messaging.readState.getUnreadCount, {
      token: accessToken,
      channelId,
    });

    expect(unreadCount).toBe(0);
  });

  test("should count messages as unread when not marked as read", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    // Create another user to send messages
    const { userId: senderId, accessToken: senderToken } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    // Send 3 messages from another user
    await sendMessage(t, channelId, senderId, "Message 1");
    await sendMessage(t, channelId, senderId, "Message 2");
    await sendMessage(t, channelId, senderId, "Message 3");

    const unreadCount = await t.query(api.functions.messaging.readState.getUnreadCount, {
      token: accessToken,
      channelId,
    });

    expect(unreadCount).toBe(3);
  });

  test("should not count own messages as unread", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    // Send messages from self
    await sendMessage(t, channelId, userId, "My message 1");
    await sendMessage(t, channelId, userId, "My message 2");

    const unreadCount = await t.query(api.functions.messaging.readState.getUnreadCount, {
      token: accessToken,
      channelId,
    });

    expect(unreadCount).toBe(0);
  });
});

// ============================================================================
// Mark As Read Tests
// ============================================================================

describe("Mark As Read", () => {
  test("should mark channel as read", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    // Create another user and send messages
    const { userId: senderId } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    const msgId = await sendMessage(t, channelId, senderId, "Unread message");

    // Verify unread
    const beforeRead = await t.query(api.functions.messaging.readState.getUnreadCount, {
      token: accessToken,
      channelId,
    });
    expect(beforeRead).toBe(1);

    // Mark as read
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: accessToken,
      channelId,
    });

    // Verify read
    const afterRead = await t.query(api.functions.messaging.readState.getUnreadCount, {
      token: accessToken,
      channelId,
    });
    expect(afterRead).toBe(0);
  });

  test("should mark as read up to specific message", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    const { userId: senderId } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    const msg1 = await sendMessage(t, channelId, senderId, "Message 1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const msg2 = await sendMessage(t, channelId, senderId, "Message 2");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const msg3 = await sendMessage(t, channelId, senderId, "Message 3");

    // Mark read up to msg1
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: accessToken,
      channelId,
      messageId: msg1,
    });

    // Should still have 2 unread
    const unreadCount = await t.query(api.functions.messaging.readState.getUnreadCount, {
      token: accessToken,
      channelId,
    });
    expect(unreadCount).toBe(2);
  });

  test("should update lastReadAt timestamp", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    const before = Date.now();

    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: accessToken,
      channelId,
    });

    const after = Date.now();

    const readState = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    expect(readState?.lastReadAt).toBeGreaterThanOrEqual(before);
    expect(readState?.lastReadAt).toBeLessThanOrEqual(after);
  });

  test("should create read state if not exists", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    // Verify no read state exists
    const before = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });
    expect(before).toBeNull();

    // Mark as read
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: accessToken,
      channelId,
    });

    // Verify read state created
    const after = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });
    expect(after).not.toBeNull();
  });

  test("should update existing read state", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    const { userId: senderId } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    // Send first batch and mark as read
    await sendMessage(t, channelId, senderId, "Message 1");
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: accessToken,
      channelId,
    });

    const readState1 = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Send more messages and mark as read again
    await sendMessage(t, channelId, senderId, "Message 2");
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: accessToken,
      channelId,
    });

    const readState2 = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatReadState")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", userId)
        )
        .first();
    });

    // Should be same document with updated timestamp
    expect(readState2?._id).toBe(readState1?._id);
    expect(readState2?.lastReadAt).toBeGreaterThan(readState1?.lastReadAt || 0);
  });
});

// ============================================================================
// Get Unread Counts Tests
// ============================================================================

describe("Get Unread Counts", () => {
  test("should get unread counts for all user channels", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, groupTypeId, channelId, accessToken } = await seedTestData(t);

    // Create a second channel
    const channelId2 = await t.run(async (ctx) => {
      const chId = await ctx.db.insert("chatChannels", {
        groupId,
        channelType: "main",
        name: "Second Channel",
        slug: "second-channel",
        createdById: userId,
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

    // Create sender and send messages to both channels
    const { userId: senderId } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: channelId2,
        userId: senderId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    await sendMessage(t, channelId, senderId, "Channel 1 msg 1");
    await sendMessage(t, channelId, senderId, "Channel 1 msg 2");
    await sendMessage(t, channelId2, senderId, "Channel 2 msg 1");

    const unreadCounts = await t.query(api.functions.messaging.readState.getUnreadCounts, {
      token: accessToken,
    });

    expect(unreadCounts[channelId]).toBe(2);
    expect(unreadCounts[channelId2]).toBe(1);
  });

  test("should return empty object for user with no unread", async () => {
    const t = convexTest(schema, modules);
    const { accessToken } = await seedTestData(t);

    const unreadCounts = await t.query(api.functions.messaging.readState.getUnreadCounts, {
      token: accessToken,
    });

    expect(Object.keys(unreadCounts)).toHaveLength(0);
  });
});

// ============================================================================
// Mark All As Read Tests
// ============================================================================

describe("Mark All As Read", () => {
  test("should mark all channels as read", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    // Create second channel
    const channelId2 = await t.run(async (ctx) => {
      const chId = await ctx.db.insert("chatChannels", {
        groupId,
        channelType: "main",
        name: "Second Channel",
        slug: "second-channel",
        createdById: userId,
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

    // Send unread messages
    const { userId: senderId } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: channelId2,
        userId: senderId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    await sendMessage(t, channelId, senderId, "Unread 1");
    await sendMessage(t, channelId2, senderId, "Unread 2");

    // Verify unread
    const beforeCounts = await t.query(api.functions.messaging.readState.getUnreadCounts, {
      token: accessToken,
    });
    expect(Object.values(beforeCounts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    // Mark all as read
    await t.mutation(api.functions.messaging.readState.markAllAsRead, {
      token: accessToken,
    });

    // Verify all read
    const afterCounts = await t.query(api.functions.messaging.readState.getUnreadCounts, {
      token: accessToken,
    });
    expect(Object.values(afterCounts).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

// ============================================================================
// Get Message Read By Tests
// ============================================================================

describe("Get Message Read By", () => {
  test("should return 0 when no one has read the message", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    // Create another user
    const { userId: user2Id } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    // User 1 sends a message
    const messageId = await sendMessage(t, channelId, userId, "Test message");

    // Check read status immediately
    const result = await t.query(api.functions.messaging.readState.getMessageReadBy, {
      token: accessToken,
      messageId,
      channelId,
    });

    expect(result.readByCount).toBe(0);
    expect(result.totalMembers).toBe(1); // Only user2, sender is excluded
  });

  test("should return correct count when some users have read", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    // Create two additional users
    const { userId: user2Id, accessToken: user2Token } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );
    const { userId: user3Id, accessToken: user3Token } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    // User 1 sends a message
    const messageId = await sendMessage(t, channelId, userId, "Test message");

    // User 2 marks as read
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: user2Token,
      channelId,
      messageId,
    });

    // Check read status
    const result = await t.query(api.functions.messaging.readState.getMessageReadBy, {
      token: accessToken,
      messageId,
      channelId,
    });

    expect(result.readByCount).toBe(1); // Only user2
    expect(result.totalMembers).toBe(2); // user2 and user3, sender excluded
  });

  test("should exclude the sender from the count", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    // Create another user
    await createAnotherUserWithMembership(t, communityId, groupId, channelId);

    // User 1 sends a message and marks it as read
    const messageId = await sendMessage(t, channelId, userId, "Test message");
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: accessToken,
      channelId,
      messageId,
    });

    // Check read status
    const result = await t.query(api.functions.messaging.readState.getMessageReadBy, {
      token: accessToken,
      messageId,
      channelId,
    });

    // Sender's read state should not count
    expect(result.readByCount).toBe(0);
    expect(result.totalMembers).toBe(1);
  });

  test("should work correctly for messages with different timestamps", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    const { userId: user2Id, accessToken: user2Token } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    // Send three messages with delays
    const msg1Id = await sendMessage(t, channelId, userId, "Message 1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const msg2Id = await sendMessage(t, channelId, userId, "Message 2");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const msg3Id = await sendMessage(t, channelId, userId, "Message 3");

    // User 2 marks channel as read up to msg2
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: user2Token,
      channelId,
      messageId: msg2Id,
    });

    // Check msg1 - should be read
    const result1 = await t.query(api.functions.messaging.readState.getMessageReadBy, {
      token: accessToken,
      messageId: msg1Id,
      channelId,
    });
    expect(result1.readByCount).toBe(1);

    // Check msg2 - should be read
    const result2 = await t.query(api.functions.messaging.readState.getMessageReadBy, {
      token: accessToken,
      messageId: msg2Id,
      channelId,
    });
    expect(result2.readByCount).toBe(1);

    // Check msg3 - should NOT be read
    const result3 = await t.query(api.functions.messaging.readState.getMessageReadBy, {
      token: accessToken,
      messageId: msg3Id,
      channelId,
    });
    expect(result3.readByCount).toBe(0);
  });

  test("should count all members when everyone has read", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, groupId, channelId, accessToken } = await seedTestData(t);

    const { userId: user2Id, accessToken: user2Token } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );
    const { userId: user3Id, accessToken: user3Token } = await createAnotherUserWithMembership(
      t,
      communityId,
      groupId,
      channelId
    );

    // User 1 sends a message
    const messageId = await sendMessage(t, channelId, userId, "Test message");

    // Both other users mark as read
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: user2Token,
      channelId,
      messageId,
    });
    await t.mutation(api.functions.messaging.readState.markAsRead, {
      token: user3Token,
      channelId,
      messageId,
    });

    // Check read status
    const result = await t.query(api.functions.messaging.readState.getMessageReadBy, {
      token: accessToken,
      messageId,
      channelId,
    });

    expect(result.readByCount).toBe(2); // Both user2 and user3
    expect(result.totalMembers).toBe(2);
  });

  test("should throw error if user is not a member of the channel", async () => {
    const t = convexTest(schema, modules);
    const { communityId, channelId } = await seedTestData(t);

    // Create a user not in the channel
    const unauthorizedUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Unauthorized",
        lastName: "User",
        phone: "+15555550099",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken: unauthorizedToken } = await generateTokens(unauthorizedUserId);

    const messageId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: unauthorizedUserId,
        content: "Test",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    await expect(
      t.query(api.functions.messaging.readState.getMessageReadBy, {
        token: unauthorizedToken,
        messageId,
        channelId,
      })
    ).rejects.toThrow("Not a member of this channel");
  });

  test("should throw error if message does not exist", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    // Create a message and then delete it to get a valid but non-existent ID
    const messageId = await sendMessage(t, channelId, userId, "Test");
    await t.run(async (ctx) => {
      await ctx.db.delete(messageId);
    });

    await expect(
      t.query(api.functions.messaging.readState.getMessageReadBy, {
        token: accessToken,
        messageId,
        channelId,
      })
    ).rejects.toThrow("Message not found");
  });

  test("should throw error if message does not belong to channel", async () => {
    const t = convexTest(schema, modules);
    const { userId, groupId, channelId, accessToken } = await seedTestData(t);

    // Create another channel
    const otherChannelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId,
        channelType: "main",
        name: "Other Channel",
        slug: "other-channel",
        createdById: userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
    });

    // Send message in the other channel
    const messageId = await sendMessage(t, otherChannelId, userId, "Test message");

    await expect(
      t.query(api.functions.messaging.readState.getMessageReadBy, {
        token: accessToken,
        messageId,
        channelId, // Wrong channel
      })
    ).rejects.toThrow("Message does not belong to this channel");
  });
});
