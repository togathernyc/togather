/**
 * Message Tests for Convex-Native Messaging
 *
 * Tests message sending, editing, deleting, and pagination.
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

// Clean up fake timers after each test to prevent interference
afterEach(() => {
  vi.useRealTimers();
});

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
      role: "leader",
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

  // Add user as channel member
  await t.run(async (ctx) => {
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId,
      role: "admin",
      joinedAt: Date.now(),
      isMuted: false,
    });
  });

  const { accessToken } = await generateTokens(userId);

  return { userId, communityId, groupId, channelId, accessToken };
}

// ============================================================================
// Send Message Tests
// ============================================================================

describe("Send Message", () => {
  test("should send a text message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Hello, world!",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    expect(messageId).toBeDefined();

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.content).toBe("Hello, world!");
    expect(message?.contentType).toBe("text");
    expect(message?.isDeleted).toBe(false);
  });

  test("should send a message with attachments", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Check out this image",
      attachments: [
        {
          type: "image",
          url: "https://example.com/image.jpg",
          name: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments?.[0].type).toBe("image");
  });

  test("should set sender info on message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Test message",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.senderId).toBe(userId);
    expect(message?.senderName).toBe("Test User");
  });

  test("should reject message from non-member", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, communityId } = await seedTestData(t);

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
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: nonMemberToken,
        channelId,
        content: "Should fail",
      })
    ).rejects.toThrow();
  });

  test("should update channel lastMessageAt", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const beforeSend = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Hello!",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const afterSend = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(afterSend?.lastMessageAt).toBeDefined();
    expect(afterSend?.lastMessageAt).toBeGreaterThan(beforeSend?.lastMessageAt || 0);
  });

  test("should update channel lastMessagePreview", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "This is the preview text",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel?.lastMessagePreview).toBe("This is the preview text");
  });

  test("should truncate long message preview", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const longMessage = "A".repeat(150);

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: longMessage,
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(channelId);
    });

    expect(channel?.lastMessagePreview?.length).toBeLessThanOrEqual(100);
  });

  test("should extract mentions from message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { userId, channelId, communityId, groupId, accessToken } = await seedTestData(t);

    // Create another user to mention
    const mentionedUserId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Mentioned",
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

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: `Hey @Mentioned User, check this out!`,
      mentionedUserIds: [mentionedUserId],
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.mentionedUserIds).toContain(mentionedUserId);
  });
});

// ============================================================================
// Edit Message Tests
// ============================================================================

describe("Edit Message", () => {
  test("should edit own message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Original content",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.editMessage, {
      token: accessToken,
      messageId,
      content: "Edited content",
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.content).toBe("Edited content");
    expect(message?.editedAt).toBeDefined();
  });

  test("should not allow editing other's message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, communityId, groupId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Original content",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Create another user
    const otherUserId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Other",
        lastName: "User",
        phone: "+15555550003",
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

    const { accessToken: otherToken } = await generateTokens(otherUserId);

    await expect(
      t.mutation(api.functions.messaging.messages.editMessage, {
        token: otherToken,
        messageId,
        content: "Hacked content",
      })
    ).rejects.toThrow();
  });

  test("should update updatedAt and editedAt timestamps", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Original",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const beforeEdit = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    // Advance time for timestamp comparison
    vi.advanceTimersByTime(10);

    await t.mutation(api.functions.messaging.messages.editMessage, {
      token: accessToken,
      messageId,
      content: "Edited",
    });

    const afterEdit = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(afterEdit?.editedAt).toBeDefined();
    expect(afterEdit?.updatedAt).toBeGreaterThan(beforeEdit?.createdAt || 0);
  });
});

// ============================================================================
// Delete Message Tests
// ============================================================================

describe("Delete Message", () => {
  test("should soft delete own message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "To be deleted",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: accessToken,
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.isDeleted).toBe(true);
    expect(message?.deletedAt).toBeDefined();
    expect(message?.deletedById).toBe(userId);
  });

  test("should not allow deleting other's message as regular member", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, communityId, groupId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Cannot delete this",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Create regular member
    const memberId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Regular",
        lastName: "Member",
        phone: "+15555550004",
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

    const { accessToken: memberToken } = await generateTokens(memberId);

    await expect(
      t.mutation(api.functions.messaging.messages.deleteMessage, {
        token: memberToken,
        messageId,
      })
    ).rejects.toThrow();
  });

  test("should allow moderator to delete any message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, communityId, groupId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "To be moderated",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Create moderator
    const modId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Mod",
        lastName: "User",
        phone: "+15555550005",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: uId,
        role: "moderator",
        joinedAt: Date.now(),
        isMuted: false,
      });
      return uId;
    });

    const { accessToken: modToken } = await generateTokens(modId);

    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: modToken,
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.isDeleted).toBe(true);
  });

  test("should allow group leader to delete any message in group chat", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, communityId, groupId, accessToken } = await seedTestData(t);

    // Original user sends a message
    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Message from original user",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Create a group leader (who is only a regular member in the channel, not moderator)
    const leaderId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Leader",
        lastName: "Person",
        phone: "+15555550010",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Group leader role
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      // Regular channel member (not moderator/admin)
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: uId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      return uId;
    });

    const { accessToken: leaderToken } = await generateTokens(leaderId);

    // Group leader should be able to delete any message
    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: leaderToken,
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.isDeleted).toBe(true);
    expect(message?.deletedById).toBe(leaderId);
  });

  test("should allow group admin to delete any message in group chat", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, communityId, groupId, accessToken } = await seedTestData(t);

    // Original user sends a message
    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Message from original user",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Create a group admin (who is only a regular member in the channel, not moderator)
    const adminId = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "Person",
        phone: "+15555550011",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      // Group admin role
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "admin",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      // Regular channel member (not moderator/admin)
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: uId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      return uId;
    });

    const { accessToken: adminToken } = await generateTokens(adminId);

    // Group admin should be able to delete any message
    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: adminToken,
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.isDeleted).toBe(true);
    expect(message?.deletedById).toBe(adminId);
  });

  test("should allow leader to delete another leader's message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, communityId, groupId } = await seedTestData(t);

    // Create first leader who sends a message
    const leader1Id = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Leader",
        lastName: "One",
        phone: "+15555550012",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "leader",
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

    const { accessToken: leader1Token } = await generateTokens(leader1Id);

    // Leader 1 sends a message
    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: leader1Token,
      channelId,
      content: "Message from Leader One",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Create second leader
    const leader2Id = await t.run(async (ctx) => {
      const uId = await ctx.db.insert("users", {
        firstName: "Leader",
        lastName: "Two",
        phone: "+15555550013",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        userId: uId,
        groupId,
        role: "leader",
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

    const { accessToken: leader2Token } = await generateTokens(leader2Id);

    // Leader 2 should be able to delete Leader 1's message
    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: leader2Token,
      messageId,
    });

    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message?.isDeleted).toBe(true);
    expect(message?.deletedById).toBe(leader2Id);
  });

  test("should update channel preview when last message is deleted", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Send first message
    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "First message",
    });
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Send second message (becomes the latest)
    const msg2Id = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Second message",
    });
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Verify channel preview shows second message
    let channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.lastMessagePreview).toBe("Second message");

    // Delete the second (latest) message
    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: accessToken,
      messageId: msg2Id,
    });

    // Channel preview should now show the first message
    channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.lastMessagePreview).toBe("First message");
  });

  test("should clear channel preview when only message is deleted", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const msgId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Only message",
    });
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Delete the only message
    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: accessToken,
      messageId: msgId,
    });

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.lastMessagePreview).toBeUndefined();
    expect(channel?.lastMessageAt).toBeUndefined();
  });

  test("should not update channel preview when non-latest message is deleted", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Send first message
    const msg1Id = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "First message",
    });
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Advance time to ensure ordering
    vi.advanceTimersByTime(100);

    // Send second message
    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Second message",
    });
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Delete the first (non-latest) message
    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: accessToken,
      messageId: msg1Id,
    });

    // Channel preview should still show the second message
    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.lastMessagePreview).toBe("Second message");
  });

  test("should preserve deleted message for audit", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Audit trail message",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: accessToken,
      messageId,
    });

    // Message should still exist in DB
    const message = await t.run(async (ctx) => {
      return await ctx.db.get(messageId);
    });

    expect(message).not.toBeNull();
    expect(message?.content).toBe("Audit trail message"); // Content preserved
    expect(message?.isDeleted).toBe(true);
  });
});

// ============================================================================
// Get Messages Tests
// ============================================================================

describe("Get Messages", () => {
  test("should get messages for channel", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Send multiple messages
    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Message 1",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Message 2",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const result = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
    });

    expect(result.messages).toHaveLength(2);
  });

  test("should exclude deleted messages from results", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const msgId1 = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Keep this",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const msgId2 = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Delete this",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: accessToken,
      messageId: msgId2,
    });

    const result = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Keep this");
  });

  test("should support cursor-based pagination", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Send 5 messages
    for (let i = 1; i <= 5; i++) {
      await t.mutation(api.functions.messaging.messages.sendMessage, {
        token: accessToken,
        channelId,
        content: `Message ${i}`,
      });

      // Wait for scheduled functions to complete after each message
      vi.runAllTimers();
      await t.finishInProgressScheduledFunctions();
    }

    // Get first page
    const page1 = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      limit: 2,
    });

    expect(page1.messages).toHaveLength(2);
    expect(page1.cursor).toBeDefined();

    // Get second page
    const page2 = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      limit: 2,
      cursor: page1.cursor,
    });

    expect(page2.messages).toHaveLength(2);
    expect(page2.messages[0]._id).not.toBe(page1.messages[0]._id);
  });

  test("should return messages in chronological order (oldest first for chat UI)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "First",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Advance time for timestamp ordering
    vi.advanceTimersByTime(10);

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Second",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const result = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
    });

    // Chat UI expects oldest first (at top), newest last (at bottom)
    expect(result.messages[0].content).toBe("First");
    expect(result.messages[1].content).toBe("Second");
  });

  test("should return hasMore flag correctly", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Send 3 messages
    for (let i = 1; i <= 3; i++) {
      await t.mutation(api.functions.messaging.messages.sendMessage, {
        token: accessToken,
        channelId,
        content: `Message ${i}`,
      });

      // Wait for scheduled functions to complete after each message
      vi.runAllTimers();
      await t.finishInProgressScheduledFunctions();
    }

    const result = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      limit: 2,
    });

    expect(result.hasMore).toBe(true);

    const result2 = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      cursor: result.cursor,
    });

    expect(result2.hasMore).toBe(false);
  });
});

// ============================================================================
// Thread Tests
// ============================================================================

describe("Threading", () => {
  test("should send a thread reply", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const parentId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Parent message",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const replyId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Reply message",
      parentMessageId: parentId,
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const reply = await t.run(async (ctx) => {
      return await ctx.db.get(replyId);
    });

    expect(reply?.parentMessageId).toBe(parentId);
  });

  test("should increment thread reply count", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const parentId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Parent message",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Reply 1",
      parentMessageId: parentId,
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Reply 2",
      parentMessageId: parentId,
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const parent = await t.run(async (ctx) => {
      return await ctx.db.get(parentId);
    });

    expect(parent?.threadReplyCount).toBe(2);
  });

  test("should get thread replies", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const parentId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Parent",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Reply 1",
      parentMessageId: parentId,
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Reply 2",
      parentMessageId: parentId,
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const result = await t.query(api.functions.messaging.messages.getThreadReplies, {
      token: accessToken,
      parentMessageId: parentId,
    });

    expect(result.messages).toHaveLength(2);
  });
});

// ============================================================================
// Get Message Tests
// ============================================================================

describe("Get Single Message", () => {
  test("should get message by ID", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Test message",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const message = await t.query(api.functions.messaging.messages.getMessage, {
      token: accessToken,
      messageId,
    });

    expect(message?.content).toBe("Test message");
  });

  test("should return null for deleted message", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Send and delete a message
    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "To be deleted",
    });

    // Wait for scheduled functions to complete
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.deleteMessage, {
      token: accessToken,
      messageId,
    });

    const message = await t.query(api.functions.messaging.messages.getMessage, {
      token: accessToken,
      messageId,
    });

    // Deleted messages return null
    expect(message).toBeNull();
  });
});

// ============================================================================
// Thread Reply Count Display Tests
// ============================================================================

describe("Thread Reply Count in Message List", () => {
  test("should include threadReplyCount in getMessages response", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Send a parent message
    const parentId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Parent message",
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Send 2 replies to the parent
    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Reply 1",
      parentMessageId: parentId,
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Reply 2",
      parentMessageId: parentId,
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Fetch messages via getMessages
    const result = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
    });

    // Parent message should be in the list
    const parentMessage = result.messages.find((m: { _id: typeof parentId }) => m._id === parentId);
    expect(parentMessage).toBeDefined();

    // Parent message should include threadReplyCount = 2
    expect(parentMessage?.threadReplyCount).toBe(2);
  });

  test("should not include threadReplyCount for messages without replies", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seedTestData(t);

    // Send a message without replies
    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content: "Regular message",
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    // Fetch messages
    const result = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
    });

    const message = result.messages.find((m: { _id: typeof messageId }) => m._id === messageId);
    expect(message).toBeDefined();

    // Message without replies should have undefined or 0 threadReplyCount
    expect(message?.threadReplyCount ?? 0).toBe(0);
  });
});
