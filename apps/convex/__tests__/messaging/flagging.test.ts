/**
 * Flagging Tests for Convex-Native Messaging
 *
 * Tests message/user reporting and moderation workflow.
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
  adminId: Id<"users">;
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  channelId: Id<"chatChannels">;
  messageId: Id<"chatMessages">;
  accessToken: string;
  adminToken: string;
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

  // Create regular user
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

  // Create admin user
  const adminId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      phone: "+15555550099",
      phoneVerified: true,
      activeCommunityId: communityId,
      roles: 3, // Admin role
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
    await ctx.db.insert("groupMembers", {
      userId: adminId,
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
      memberCount: 2,
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
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId: adminId,
      role: "admin",
      joinedAt: Date.now(),
      isMuted: false,
    });
  });

  const messageId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatMessages", {
      channelId,
      senderId: userId,
      content: "Test message to flag",
      contentType: "text",
      createdAt: Date.now(),
      isDeleted: false,
      senderName: "Test User",
    });
  });

  const { accessToken } = await generateTokens(userId);
  const { accessToken: adminToken } = await generateTokens(adminId);

  return {
    userId,
    adminId,
    communityId,
    groupId,
    channelId,
    messageId,
    accessToken,
    adminToken,
  };
}

// ============================================================================
// Flag Message Tests
// ============================================================================

describe("Flag Message", () => {
  test("should flag a message", async () => {
    const t = convexTest(schema, modules);
    const { userId, messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.flagging.flagMessage, {
      token: accessToken,
      messageId,
      reason: "spam",
    });

    const flag = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessageFlags")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .first();
    });

    expect(flag).not.toBeNull();
    expect(flag?.reason).toBe("spam");
    expect(flag?.status).toBe("pending");
    expect(flag?.reportedById).toBe(userId);
  });

  test("should flag message with details", async () => {
    const t = convexTest(schema, modules);
    const { messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.flagging.flagMessage, {
      token: accessToken,
      messageId,
      reason: "harassment",
      details: "This user has been sending threatening messages",
    });

    const flag = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessageFlags")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .first();
    });

    expect(flag?.details).toBe("This user has been sending threatening messages");
  });

  test("should not allow duplicate flags from same user", async () => {
    const t = convexTest(schema, modules);
    const { messageId, accessToken } = await seedTestData(t);

    await t.mutation(api.functions.messaging.flagging.flagMessage, {
      token: accessToken,
      messageId,
      reason: "spam",
    });

    // Second flag should update, not create duplicate
    await t.mutation(api.functions.messaging.flagging.flagMessage, {
      token: accessToken,
      messageId,
      reason: "inappropriate",
    });

    const flags = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessageFlags")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .collect();
    });

    expect(flags).toHaveLength(1);
    expect(flags[0].reason).toBe("inappropriate");
  });

  test("should set createdAt timestamp", async () => {
    const t = convexTest(schema, modules);
    const { messageId, accessToken } = await seedTestData(t);

    const before = Date.now();

    await t.mutation(api.functions.messaging.flagging.flagMessage, {
      token: accessToken,
      messageId,
      reason: "spam",
    });

    const after = Date.now();

    const flag = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessageFlags")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .first();
    });

    expect(flag?.createdAt).toBeGreaterThanOrEqual(before);
    expect(flag?.createdAt).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// Flag User Tests
// ============================================================================

describe("Flag User", () => {
  test("should flag a user", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, channelId, adminToken } = await seedTestData(t);

    // Create user to flag
    const targetId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Bad",
        lastName: "User",
        phone: "+15555550003",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(api.functions.messaging.flagging.flagUser, {
      token: adminToken,
      userId: targetId,
      reason: "harassment",
      channelId,
    });

    const flag = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserFlags")
        .withIndex("by_user", (q) => q.eq("userId", targetId))
        .first();
    });

    expect(flag).not.toBeNull();
    expect(flag?.reason).toBe("harassment");
    expect(flag?.status).toBe("pending");
  });

  test("should flag user with channel context", async () => {
    const t = convexTest(schema, modules);
    const { communityId, channelId, adminToken } = await seedTestData(t);

    const targetId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Target",
        lastName: "User",
        phone: "+15555550004",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(api.functions.messaging.flagging.flagUser, {
      token: adminToken,
      userId: targetId,
      reason: "spam",
      channelId,
    });

    const flag = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserFlags")
        .withIndex("by_user", (q) => q.eq("userId", targetId))
        .first();
    });

    expect(flag?.channelId).toBe(channelId);
  });

  test("should flag user without channel context", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedTestData(t);

    const targetId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Target",
        lastName: "User",
        phone: "+15555550005",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(api.functions.messaging.flagging.flagUser, {
      token: adminToken,
      userId: targetId,
      reason: "inappropriate",
    });

    const flag = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserFlags")
        .withIndex("by_user", (q) => q.eq("userId", targetId))
        .first();
    });

    expect(flag?.channelId).toBeUndefined();
  });
});

// ============================================================================
// Get Pending Flags Tests
// ============================================================================

describe("Get Pending Flags", () => {
  test("should get all pending message flags", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, adminToken } = await seedTestData(t);

    // Create multiple messages and flag them
    const msgId1 = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: userId,
        content: "Flagged message 1",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    const msgId2 = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: userId,
        content: "Flagged message 2",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("chatMessageFlags", {
        messageId: msgId1,
        reportedById: userId,
        reason: "spam",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatMessageFlags", {
        messageId: msgId2,
        reportedById: userId,
        reason: "harassment",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    const flags = await t.query(api.functions.messaging.flagging.getPendingFlags, {
      token: adminToken,
    });

    expect(flags.messageFlags).toHaveLength(2);
  });

  test("should get all pending user flags", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, adminToken } = await seedTestData(t);

    // Create users and flag them
    const target1 = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Target1",
        lastName: "User",
        phone: "+15555550006",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const target2 = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Target2",
        lastName: "User",
        phone: "+15555550007",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("chatUserFlags", {
        userId: target1,
        reportedById: userId,
        reason: "spam",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatUserFlags", {
        userId: target2,
        reportedById: userId,
        reason: "harassment",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    const flags = await t.query(api.functions.messaging.flagging.getPendingFlags, {
      token: adminToken,
    });

    expect(flags.userFlags).toHaveLength(2);
  });

  test("should not include reviewed flags", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, adminId, adminToken } = await seedTestData(t);

    const msgId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: userId,
        content: "Reviewed message",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    // Create a reviewed flag
    await t.run(async (ctx) => {
      await ctx.db.insert("chatMessageFlags", {
        messageId: msgId,
        reportedById: userId,
        reason: "spam",
        status: "reviewed",
        reviewedById: adminId,
        reviewedAt: Date.now(),
        createdAt: Date.now(),
      });
    });

    const flags = await t.query(api.functions.messaging.flagging.getPendingFlags, {
      token: adminToken,
    });

    expect(flags.messageFlags).toHaveLength(0);
  });
});

// ============================================================================
// Review Flag Tests
// ============================================================================

describe("Review Flag", () => {
  test("should review a message flag", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, adminId, adminToken } = await seedTestData(t);

    const msgId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: userId,
        content: "Flagged",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    const flagId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessageFlags", {
        messageId: msgId,
        reportedById: userId,
        reason: "spam",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    await t.mutation(api.functions.messaging.flagging.reviewMessageFlag, {
      token: adminToken,
      flagId,
      action: "dismissed",
    });

    const flag = await t.run(async (ctx) => {
      return await ctx.db.get(flagId);
    });

    expect(flag?.status).toBe("dismissed");
    expect(flag?.reviewedById).toBe(adminId);
    expect(flag?.reviewedAt).toBeDefined();
  });

  test("should take action on flagged message", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, adminToken } = await seedTestData(t);

    const msgId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: userId,
        content: "To be deleted",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    const flagId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessageFlags", {
        messageId: msgId,
        reportedById: userId,
        reason: "spam",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    await t.mutation(api.functions.messaging.flagging.reviewMessageFlag, {
      token: adminToken,
      flagId,
      action: "actioned",
      actionDetails: "Message deleted",
    });

    const flag = await t.run(async (ctx) => {
      return await ctx.db.get(flagId);
    });

    expect(flag?.status).toBe("actioned");
    expect(flag?.actionTaken).toBe("Message deleted");
  });

  test("should review a user flag", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, adminId, adminToken } = await seedTestData(t);

    const targetId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Target",
        lastName: "User",
        phone: "+15555550008",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const flagId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatUserFlags", {
        userId: targetId,
        reportedById: userId,
        reason: "harassment",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    await t.mutation(api.functions.messaging.flagging.reviewUserFlag, {
      token: adminToken,
      flagId,
      action: "reviewed",
    });

    const flag = await t.run(async (ctx) => {
      return await ctx.db.get(flagId);
    });

    expect(flag?.status).toBe("reviewed");
    expect(flag?.reviewedById).toBe(adminId);
  });

  test("should reject non-admin review", async () => {
    const t = convexTest(schema, modules);
    const { userId, channelId, accessToken } = await seedTestData(t);

    const msgId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: userId,
        content: "Flagged",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    const flagId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessageFlags", {
        messageId: msgId,
        reportedById: userId,
        reason: "spam",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.functions.messaging.flagging.reviewMessageFlag, {
        token: accessToken, // Regular user token
        flagId,
        action: "dismissed",
      })
    ).rejects.toThrow();
  });
});

// ============================================================================
// Get Flags for Message/User Tests
// ============================================================================

describe("Get Flags for Message/User", () => {
  test("should get all flags for a message", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, channelId, adminToken } = await seedTestData(t);

    const msgId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatMessages", {
        channelId,
        senderId: userId,
        content: "Multi-flagged",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    // Create another reporter
    const reporter2 = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Reporter2",
        lastName: "User",
        phone: "+15555550009",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Multiple flags from different users
    await t.run(async (ctx) => {
      await ctx.db.insert("chatMessageFlags", {
        messageId: msgId,
        reportedById: userId,
        reason: "spam",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatMessageFlags", {
        messageId: msgId,
        reportedById: reporter2,
        reason: "harassment",
        status: "pending",
        createdAt: Date.now(),
      });
    });

    const flags = await t.query(api.functions.messaging.flagging.getFlagsForMessage, {
      token: adminToken,
      messageId: msgId,
    });

    expect(flags).toHaveLength(2);
  });

  test("should get all flags for a user", async () => {
    const t = convexTest(schema, modules);
    const { userId, communityId, adminToken } = await seedTestData(t);

    const targetId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Flagged",
        lastName: "User",
        phone: "+15555550010",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("chatUserFlags", {
        userId: targetId,
        reportedById: userId,
        reason: "spam",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatUserFlags", {
        userId: targetId,
        reportedById: userId,
        reason: "harassment",
        status: "reviewed",
        createdAt: Date.now() - 10000,
      });
    });

    const flags = await t.query(api.functions.messaging.flagging.getFlagsForUser, {
      token: adminToken,
      userId: targetId,
    });

    expect(flags).toHaveLength(2);
  });
});
