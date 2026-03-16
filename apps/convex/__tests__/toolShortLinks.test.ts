import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

interface SeedData {
  groupId: Id<"groups">;
  otherGroupId: Id<"groups">;
  taskId: Id<"tasks">;
  leaderToken: string;
  outsiderToken: string;
}

async function seedData(t: ReturnType<typeof convexTest>): Promise<SeedData> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const communityId = await ctx.db.insert("communities", {
      name: "Tool Links Community",
      slug: "tool-links-community",
      subdomain: "toollinks",
      timezone: "America/New_York",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      displayOrder: 1,
      createdAt: now,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Leaders Group",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const otherGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Other Group",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const leaderId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "User",
      phone: "+12025550111",
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    });

    const outsiderId = await ctx.db.insert("users", {
      firstName: "Outside",
      lastName: "User",
      phone: "+12025550112",
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });

    const taskId = await ctx.db.insert("tasks", {
      groupId,
      title: "Follow up with new member",
      description: "Send welcome text",
      status: "open",
      responsibilityType: "group",
      sourceType: "manual",
      targetType: "group",
      tags: ["care"],
      createdById: leaderId,
      createdAt: now,
      updatedAt: now,
    });

    return { groupId, otherGroupId, taskId, leaderId, outsiderId };
  });

  const [{ accessToken: leaderToken }, { accessToken: outsiderToken }] = await Promise.all([
    generateTokens(ids.leaderId),
    generateTokens(ids.outsiderId),
  ]);

  return {
    groupId: ids.groupId,
    otherGroupId: ids.otherGroupId,
    taskId: ids.taskId,
    leaderToken,
    outsiderToken,
  };
}

describe("toolShortLinks task links", () => {
  test("creates and reuses a task short link", async () => {
    const t = convexTest(schema, modules);
    const { groupId, taskId, leaderToken } = await seedData(t);

    const shortId = await t.mutation(api.functions.toolShortLinks.index.getOrCreate, {
      token: leaderToken,
      groupId,
      toolType: "task",
      taskId,
    });

    const sameShortId = await t.mutation(api.functions.toolShortLinks.index.getOrCreate, {
      token: leaderToken,
      groupId,
      toolType: "task",
      taskId,
    });

    expect(sameShortId).toBe(shortId);

    const resolved = await t.query(api.functions.toolShortLinks.index.getByShortId, {
      shortId,
    });

    expect(resolved?.toolType).toBe("task");
    expect(resolved?.taskId).toBe(taskId);
    expect(resolved?.taskTitle).toBe("Follow up with new member");
    expect(resolved?.taskStatus).toBe("open");
  });

  test("rejects creating a task link for a different group", async () => {
    const t = convexTest(schema, modules);
    const { otherGroupId, taskId, leaderToken } = await seedData(t);

    await expect(
      t.mutation(api.functions.toolShortLinks.index.getOrCreate, {
        token: leaderToken,
        groupId: otherGroupId,
        toolType: "task",
        taskId,
      }),
    ).rejects.toThrow("Task does not belong to this group");
  });

  test("requires active membership to create task links", async () => {
    const t = convexTest(schema, modules);
    const { groupId, taskId, outsiderToken } = await seedData(t);

    await expect(
      t.mutation(api.functions.toolShortLinks.index.getOrCreate, {
        token: outsiderToken,
        groupId,
        toolType: "task",
        taskId,
      }),
    ).rejects.toThrow("You must be a member of this group to share tools");
  });
});
