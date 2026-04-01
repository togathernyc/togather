/**
 * Delete Account Tests
 *
 * Tests the deleteAccountInternal mutation that handles
 * user data cleanup during account deletion.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// ============================================================================
// Test Helpers
// ============================================================================

async function seedFullUser(t: ReturnType<typeof convexTest>) {
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
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      displayOrder: 0,
      createdAt: Date.now(),
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "+15555550001",
      phoneVerified: true,
      isActive: true,
      activeCommunityId: communityId,
      searchText: "john doe john@example.com +15555550001",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Create community membership
  await t.run(async (ctx) => {
    return await ctx.db.insert("userCommunities", {
      userId,
      communityId,
      roles: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Create group membership
  await t.run(async (ctx) => {
    return await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  // Create push token
  await t.run(async (ctx) => {
    return await ctx.db.insert("pushTokens", {
      userId,
      token: "ExponentPushToken[test123]",
      platform: "ios",
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: Date.now(),
    });
  });

  // Create notification
  await t.run(async (ctx) => {
    return await ctx.db.insert("notifications", {
      userId,
      communityId,
      notificationType: "test",
      title: "Test notification",
      body: "Test body",
      data: {},
      status: "sent",
      isRead: false,
      createdAt: Date.now(),
    });
  });

  return { communityId, groupId, userId };
}

// ============================================================================
// Tests
// ============================================================================

describe("deleteAccountInternal", () => {
  test("anonymizes user record", async () => {
    const t = convexTest(schema, modules);

    const { userId } = await seedFullUser(t);

    await t.mutation(internal.functions.users.deleteAccountInternal, {
      userId,
    });

    const user = await t.run(async (ctx) => ctx.db.get(userId));

    expect(user).not.toBeNull();
    expect(user!.firstName).toBe("Deleted");
    expect(user!.lastName).toBe("User");
    expect(user!.email).toBeUndefined();
    expect(user!.phone).toBeUndefined();
    expect(user!.password).toBeUndefined();
    expect(user!.profilePhoto).toBeUndefined();
    expect(user!.isActive).toBe(false);
    expect(user!.phoneVerified).toBe(false);
    expect(user!.activeCommunityId).toBeUndefined();
    expect(user!.searchText).toBe("deleted user");
  });

  test("removes community memberships", async () => {
    const t = convexTest(schema, modules);

    const { userId, communityId } = await seedFullUser(t);

    await t.mutation(internal.functions.users.deleteAccountInternal, {
      userId,
    });

    const memberships = await t.run(async (ctx) => {
      return await ctx.db
        .query("userCommunities")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    });

    expect(memberships).toHaveLength(0);
  });

  test("removes group memberships", async () => {
    const t = convexTest(schema, modules);

    const { userId } = await seedFullUser(t);

    await t.mutation(internal.functions.users.deleteAccountInternal, {
      userId,
    });

    const memberships = await t.run(async (ctx) => {
      return await ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    });

    expect(memberships).toHaveLength(0);
  });

  test("removes push tokens", async () => {
    const t = convexTest(schema, modules);

    const { userId } = await seedFullUser(t);

    await t.mutation(internal.functions.users.deleteAccountInternal, {
      userId,
    });

    const tokens = await t.run(async (ctx) => {
      return await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    });

    expect(tokens).toHaveLength(0);
  });

  test("removes notifications", async () => {
    const t = convexTest(schema, modules);

    const { userId } = await seedFullUser(t);

    await t.mutation(internal.functions.users.deleteAccountInternal, {
      userId,
    });

    const notifications = await t.run(async (ctx) => {
      return await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    });

    expect(notifications).toHaveLength(0);
  });

  test("removes chat blocks in both directions", async () => {
    const t = convexTest(schema, modules);

    const { userId, communityId } = await seedFullUser(t);

    // Create another user
    const otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Other",
        lastName: "User",
        phone: "+15555550002",
        phoneVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Block in both directions
    await t.run(async (ctx) => {
      await ctx.db.insert("chatUserBlocks", {
        blockerId: userId,
        blockedId: otherUserId,
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatUserBlocks", {
        blockerId: otherUserId,
        blockedId: userId,
        createdAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.users.deleteAccountInternal, {
      userId,
    });

    // Both block records should be removed
    const blockerRecords = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
        .collect();
    });

    const blockedRecords = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocked", (q) => q.eq("blockedId", userId))
        .collect();
    });

    expect(blockerRecords).toHaveLength(0);
    expect(blockedRecords).toHaveLength(0);
  });

  test("throws for non-existent user", async () => {
    const t = convexTest(schema, modules);

    // Use a fake user ID
    const fakeUserId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Temp",
        lastName: "User",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(internal.functions.users.deleteAccountInternal, {
        userId: fakeUserId,
      })
    ).rejects.toThrow("User not found");
  });

  test("removes communityPeople records and associated assignees", async () => {
    const t = convexTest(schema, modules);

    const { userId, communityId, groupId } = await seedFullUser(t);

    // Create a communityPeople record
    const cpId = await t.run(async (ctx) => {
      return await ctx.db.insert("communityPeople", {
        communityId,
        groupId,
        userId,
        firstName: "John",
        lastName: "Doe",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Create an assignee junction record
    await t.run(async (ctx) => {
      await ctx.db.insert("communityPeopleAssignees", {
        communityPersonId: cpId,
        assigneeUserId: userId,
        groupId,
        communityId,
      });
    });

    await t.mutation(internal.functions.users.deleteAccountInternal, {
      userId,
    });

    const cpRecords = await t.run(async (ctx) => {
      return await ctx.db
        .query("communityPeople")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    });

    const assigneeRecords = await t.run(async (ctx) => {
      return await ctx.db
        .query("communityPeopleAssignees")
        .withIndex("by_communityPerson", (q) => q.eq("communityPersonId", cpId))
        .collect();
    });

    expect(cpRecords).toHaveLength(0);
    expect(assigneeRecords).toHaveLength(0);
  });

  test("removes assignee junction rows where deleted user was assignee on others", async () => {
    const t = convexTest(schema, modules);

    const { communityId, groupId } = await seedFullUser(t);

    const assigneeUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Assignee",
        lastName: "Leader",
        isActive: true,
        searchText: "assignee leader",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        userId: assigneeUserId,
        communityId,
        roles: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const memberUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Member",
        lastName: "Person",
        isActive: true,
        searchText: "member person",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const otherCpId = await t.run(async (ctx) => {
      return await ctx.db.insert("communityPeople", {
        communityId,
        groupId,
        userId: memberUserId,
        firstName: "Member",
        lastName: "Person",
        assigneeId: assigneeUserId,
        assigneeIds: [assigneeUserId],
        assigneeSortKey: "Assignee Leader",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("communityPeopleAssignees", {
        communityPersonId: otherCpId,
        assigneeUserId,
        groupId,
        communityId,
      });
    });

    await t.mutation(internal.functions.users.deleteAccountInternal, {
      userId: assigneeUserId,
    });

    const junctionAfter = await t.run(async (ctx) => {
      return await ctx.db
        .query("communityPeopleAssignees")
        .withIndex("by_communityPerson", (q) =>
          q.eq("communityPersonId", otherCpId),
        )
        .collect();
    });

    const otherCpAfter = await t.run(async (ctx) => {
      return await ctx.db.get(otherCpId);
    });

    expect(junctionAfter).toHaveLength(0);
    expect(otherCpAfter?.assigneeIds).toBeUndefined();
    expect(otherCpAfter?.assigneeId).toBeUndefined();
    expect(otherCpAfter?.assigneeSortKey).toBeUndefined();
  });
});
