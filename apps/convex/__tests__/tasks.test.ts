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
  secondLeaderId: Id<"users">;
  memberId: Id<"users">;
  memberGroupMembershipId: Id<"groupMembers">;
  leadersChannelId: Id<"chatChannels">;
  reachOutChannelId: Id<"chatChannels">;
  leaderToken: string;
  secondLeaderToken: string;
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

    const secondLeaderId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "Two",
      phone: "+12025550103",
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

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: secondLeaderId,
      role: "leader",
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
      secondLeaderId,
      memberId,
      memberGroupMembershipId,
      leadersChannelId,
      reachOutChannelId,
    };
  });

  const [
    { accessToken: leaderToken },
    { accessToken: secondLeaderToken },
    { accessToken: memberToken },
  ] = await Promise.all([
      generateTokens(ids.leaderId),
      generateTokens(ids.secondLeaderId),
      generateTokens(ids.memberId),
    ]);

  return {
    ...ids,
    leaderToken,
    secondLeaderToken,
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

  test("hasLeaderAccess differentiates leader and member", async () => {
    const t = convexTest(schema, modules);
    const { communityId, leaderToken, memberToken } = await seedData(t);

    const [leaderAccess, memberAccess] = await Promise.all([
      t.query(api.functions.tasks.index.hasLeaderAccess, {
        token: leaderToken,
        communityId,
      }),
      t.query(api.functions.tasks.index.hasLeaderAccess, {
        token: memberToken,
        communityId,
      }),
    ]);

    expect(leaderAccess).toBe(true);
    expect(memberAccess).toBe(false);
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

  test("my tasks aggregates assignments across multiple led groups", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, leaderToken, leaderId } = await seedData(t);

    const groupTypeId = await t.run(async (ctx) => {
      const groupType = await ctx.db
        .query("groupTypes")
        .withIndex("by_community_slug", (q) =>
          q.eq("communityId", communityId).eq("slug", "small-groups"),
        )
        .first();
      if (!groupType) throw new Error("group type not found");
      return groupType._id;
    });

    const secondGroupId = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const insertedGroupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Second Queue Group",
        isArchived: false,
        isPublic: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("groupMembers", {
        groupId: insertedGroupId,
        userId: leaderId,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      return insertedGroupId;
    });

    await Promise.all([
      t.mutation(api.functions.tasks.index.create, {
        token: leaderToken,
        groupId,
        title: "Task A",
        responsibilityType: "person",
        assignedToId: leaderId,
      }),
      t.mutation(api.functions.tasks.index.create, {
        token: leaderToken,
        groupId: secondGroupId,
        title: "Task B",
        responsibilityType: "person",
        assignedToId: leaderId,
      }),
    ]);

    const mine = await t.query(api.functions.tasks.index.listMine, {
      token: leaderToken,
    });

    expect(mine.length).toBe(2);
    expect(new Set(mine.map((task) => task.groupId.toString())).size).toBe(2);
  });

  test("create validates title and target cardinality", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderToken, memberId } = await seedData(t);

    await expect(
      t.mutation(api.functions.tasks.index.create, {
        token: leaderToken,
        groupId,
        title: "   ",
      }),
    ).rejects.toThrow("title is required");

    await expect(
      t.mutation(api.functions.tasks.index.create, {
        token: leaderToken,
        groupId,
        title: "Bad target",
        targetType: "none",
        targetMemberId: memberId,
      }),
    ).rejects.toThrow(
      "targetMemberId and targetGroupId must be omitted when targetType=none",
    );

    await expect(
      t.mutation(api.functions.tasks.index.create, {
        token: leaderToken,
        groupId,
        title: "Bad target combo",
        targetType: "member",
        targetMemberId: memberId,
        targetGroupId: groupId,
      }),
    ).rejects.toThrow("targetGroupId is not allowed when targetType=member");
  });

  test("create rejects parent tasks from another group", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, leaderToken, leaderId } = await seedData(t);

    const groupTypeId = await t.run(async (ctx) => {
      const groupType = await ctx.db
        .query("groupTypes")
        .withIndex("by_community_slug", (q) =>
          q.eq("communityId", communityId).eq("slug", "small-groups"),
        )
        .first();
      if (!groupType) throw new Error("group type not found");
      return groupType._id;
    });

    const { otherGroupId } = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const insertedGroupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Other Group",
        isArchived: false,
        isPublic: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("groupMembers", {
        groupId: insertedGroupId,
        userId: leaderId,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      return { otherGroupId: insertedGroupId };
    });

    const parentTaskId = await t.mutation(api.functions.tasks.index.create, {
      token: leaderToken,
      groupId: otherGroupId,
      title: "Parent",
    });

    await expect(
      t.mutation(api.functions.tasks.index.create, {
        token: leaderToken,
        groupId,
        title: "Child",
        parentTaskId,
      }),
    ).rejects.toThrow("parent task must belong to the same group");
  });

  test("leader can assign to another leader and unassign", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderToken, secondLeaderId } = await seedData(t);

    const taskId = await t.mutation(api.functions.tasks.index.create, {
      token: leaderToken,
      groupId,
      title: "Assign me",
    });

    await t.mutation(api.functions.tasks.index.assign, {
      token: leaderToken,
      taskId,
      assigneeId: secondLeaderId,
    });

    let task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.assignedToId).toBe(secondLeaderId);
    expect(task?.responsibilityType).toBe("person");

    await t.mutation(api.functions.tasks.index.assign, {
      token: leaderToken,
      taskId,
    });

    task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.assignedToId).toBeUndefined();
    expect(task?.responsibilityType).toBe("group");
  });

  test("list queries support source, tag, and search filters", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderToken, leaderId } = await seedData(t);

    await t.mutation(api.functions.tasks.index.create, {
      token: leaderToken,
      groupId,
      title: "Call Sarah",
      tags: ["Prayer Request", "Care"],
      targetType: "member",
      targetMemberId: leaderId,
    });

    await t.mutation(internal.functions.tasks.index.createFromBotReminder, {
      groupId,
      assignedToId: leaderId,
      title: "Send weekly update",
      sourceKey: "bot-task-filter-test",
    });

    const sourceFiltered = await t.query(api.functions.tasks.index.listMine, {
      token: leaderToken,
      sourceType: "bot_task_reminder",
    });
    expect(sourceFiltered.length).toBe(1);
    expect(sourceFiltered[0].sourceType).toBe("bot_task_reminder");

    const tagFiltered = await t.query(api.functions.tasks.index.listGroup, {
      token: leaderToken,
      groupId,
      tag: "prayer request",
    });
    expect(tagFiltered.length).toBe(1);
    expect(tagFiltered[0].tags).toContain("prayer_request");

    const searchFiltered = await t.query(api.functions.tasks.index.listGroup, {
      token: leaderToken,
      groupId,
      searchText: "weekly update",
    });
    expect(searchFiltered.length).toBe(1);
    expect(searchFiltered[0].title).toContain("weekly update");
  });

  test("listAssignableLeaders returns only active leaders", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderToken } = await seedData(t);

    const leaders = await t.query(api.functions.tasks.index.listAssignableLeaders, {
      token: leaderToken,
      groupId,
    });

    expect(leaders.length).toBe(2);
    expect(leaders.every((leader) => leader.name.length > 0)).toBe(true);
  });

  test("task claim conflict keeps authoritative assignee", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderToken, secondLeaderToken, leaderId, secondLeaderId } =
      await seedData(t);

    const taskId = await t.mutation(api.functions.tasks.index.create, {
      token: leaderToken,
      groupId,
      title: "Claim race",
    });

    await t.mutation(api.functions.tasks.index.claim, {
      token: leaderToken,
      taskId,
    });

    await expect(
      t.mutation(api.functions.tasks.index.claim, {
        token: secondLeaderToken,
        taskId,
      }),
    ).rejects.toThrow("Task is already assigned");

    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect([leaderId, secondLeaderId]).toContain(task?.assignedToId);
    expect(task?.assignedToId).toBe(leaderId);
  });

  test("non-leaders cannot mutate existing tasks", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderToken, memberToken } = await seedData(t);

    const taskId = await t.mutation(api.functions.tasks.index.create, {
      token: leaderToken,
      groupId,
      title: "Secure task",
    });

    await expect(
      t.mutation(api.functions.tasks.index.claim, {
        token: memberToken,
        taskId,
      }),
    ).rejects.toThrow("Leader access required");

    await expect(
      t.mutation(api.functions.tasks.index.markDone, {
        token: memberToken,
        taskId,
      }),
    ).rejects.toThrow("Leader access required");

    await expect(
      t.mutation(api.functions.tasks.index.assign, {
        token: memberToken,
        taskId,
      }),
    ).rejects.toThrow("Leader access required");
  });

  test("leader cannot mutate tasks for groups they do not lead", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, leaderToken, secondLeaderToken, secondLeaderId } =
      await seedData(t);

    const taskInOriginalGroup = await t.mutation(api.functions.tasks.index.create, {
      token: leaderToken,
      groupId,
      title: "Original group task",
    });
    await expect(
      t.mutation(api.functions.tasks.index.markDone, {
        token: secondLeaderToken,
        taskId: taskInOriginalGroup,
      }),
    ).resolves.toEqual({ success: true });

    const isolatedGroupId = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const groupType = await ctx.db
        .query("groupTypes")
        .withIndex("by_community_slug", (q) =>
          q.eq("communityId", communityId).eq("slug", "small-groups"),
        )
        .first();
      if (!groupType) throw new Error("group type not found");
      const newGroupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId: groupType._id,
        name: "Isolated Group",
        isArchived: false,
        isPublic: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("groupMembers", {
        groupId: newGroupId,
        userId: secondLeaderId,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      return newGroupId;
    });

    const isolatedTaskId = await t.mutation(api.functions.tasks.index.create, {
      token: secondLeaderToken,
      groupId: isolatedGroupId,
      title: "Isolated task",
    });

    await expect(
      t.mutation(api.functions.tasks.index.assign, {
        token: leaderToken,
        taskId: isolatedTaskId,
      }),
    ).rejects.toThrow("Leader access required");
  });
});
