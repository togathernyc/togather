import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

interface SeedData {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  memberGroupMembershipId: Id<"groupMembers">;
  leadersChannelId: Id<"chatChannels">;
  reachOutChannelId: Id<"chatChannels">;
  leaderToken: string;
  memberToken: string;
}

async function seedData(t: ReturnType<typeof convexTest>): Promise<SeedData> {
  const ids = await t.run(async (ctx) => {
    const timestamp = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Tasks Community",
      slug: "tasks-community",
      subdomain: "tasks",
      timezone: "America/New_York",
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      displayOrder: 1,
      createdAt: timestamp,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Tasks Group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const leaderId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "One",
      phone: "+12025550101",
      activeCommunityId: communityId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const memberId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "One",
      phone: "+12025550102",
      activeCommunityId: communityId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    const memberGroupMembershipId = await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    await ctx.db.insert("chatChannels", {
      groupId,
      slug: "general",
      channelType: "main",
      name: "General",
      createdById: leaderId,
      createdAt: timestamp,
      updatedAt: timestamp,
      isArchived: false,
      memberCount: 2,
    });

    const leadersChannelId = await ctx.db.insert("chatChannels", {
      groupId,
      slug: "leaders",
      channelType: "leaders",
      name: "Leaders",
      createdById: leaderId,
      createdAt: timestamp,
      updatedAt: timestamp,
      isArchived: false,
      memberCount: 1,
    });

    const reachOutChannelId = await ctx.db.insert("chatChannels", {
      groupId,
      slug: "reach-out",
      channelType: "reach_out",
      name: "Reach Out",
      createdById: leaderId,
      createdAt: timestamp,
      updatedAt: timestamp,
      isArchived: false,
      memberCount: 2,
    });

    return {
      communityId,
      groupId,
      leaderId,
      memberId,
      memberGroupMembershipId,
      leadersChannelId,
      reachOutChannelId,
    };
  });

  const [{ accessToken: leaderToken }, { accessToken: memberToken }] =
    await Promise.all([
      generateTokens(ids.leaderId),
      generateTokens(ids.memberId),
    ]);

  return {
    ...ids,
    leaderToken,
    memberToken,
  };
}

describe("tasks functions", () => {
  test("leader can create, claim, and complete tasks", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderToken } = await seedData(t);

    const taskId = await t.mutation(api.functions.tasks.index.create, {
      token: leaderToken,
      groupId,
      title: "Call newcomer",
      responsibilityType: "group",
      tags: ["care", "first contact"],
    });

    const claimableBefore = await t.query(
      api.functions.tasks.index.listClaimable,
      {
        token: leaderToken,
      },
    );
    expect(claimableBefore.some((task) => task._id === taskId)).toBe(true);

    await t.mutation(api.functions.tasks.index.claim, {
      token: leaderToken,
      taskId,
    });

    const mine = await t.query(api.functions.tasks.index.listMine, {
      token: leaderToken,
    });
    expect(mine.some((task) => task._id === taskId)).toBe(true);

    await t.mutation(api.functions.tasks.index.markDone, {
      token: leaderToken,
      taskId,
    });

    const mineAfterDone = await t.query(api.functions.tasks.index.listMine, {
      token: leaderToken,
    });
    expect(mineAfterDone.some((task) => task._id === taskId)).toBe(false);
  });

  test("non-leader cannot create group tasks", async () => {
    const t = convexTest(schema, modules);
    const { groupId, memberToken } = await seedData(t);

    await expect(
      t.mutation(api.functions.tasks.index.create, {
        token: memberToken,
        groupId,
        title: "Should fail",
      }),
    ).rejects.toThrow("Leader access required");
  });

  test("reach-out internal sync mirrors task lifecycle", async () => {
    const t = convexTest(schema, modules);
    const {
      groupId,
      leaderId,
      memberId,
      memberGroupMembershipId,
      leadersChannelId,
      reachOutChannelId,
    } = await seedData(t);

    const timestamp = Date.now();
    const requestId = await t.run(async (ctx) => {
      return await ctx.db.insert("reachOutRequests", {
        groupId,
        channelId: reachOutChannelId,
        leadersChannelId,
        submittedById: memberId,
        groupMemberId: memberGroupMembershipId,
        content: "Need prayer this week",
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const taskId = await t.mutation(
      internal.functions.tasks.index.createFromReachOutRequest,
      {
        groupId,
        submittedById: memberId,
        requestId,
        content: "Need prayer this week",
      },
    );

    await t.mutation(internal.functions.tasks.index.syncReachOutTask, {
      requestId,
      status: "assigned",
      performedById: leaderId,
      assignedToId: leaderId,
    });

    let task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe("open");
    expect(task?.assignedToId).toBe(leaderId);
    expect(task?.responsibilityType).toBe("person");

    await t.mutation(internal.functions.tasks.index.syncReachOutTask, {
      requestId,
      status: "resolved",
      performedById: leaderId,
    });

    task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe("done");
    expect(task?.completedAt).toBeDefined();
  });

  test("bot reminder task creation is idempotent by sourceKey", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderId } = await seedData(t);

    const sourceKey = "bot_task_reminder:cfg1:2026-03-10:taskA:userA";
    const firstTaskId = await t.mutation(
      internal.functions.tasks.index.createFromBotReminder,
      {
        groupId,
        assignedToId: leaderId,
        title: "Send weekly update",
        description: "Bot-generated task",
        sourceKey,
      },
    );

    const secondTaskId = await t.mutation(
      internal.functions.tasks.index.createFromBotReminder,
      {
        groupId,
        assignedToId: leaderId,
        title: "Send weekly update",
        description: "Bot-generated task",
        sourceKey,
      },
    );

    expect(secondTaskId).toBe(firstTaskId);
  });
});
