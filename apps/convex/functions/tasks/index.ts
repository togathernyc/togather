import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isActiveMembership, isLeaderRole } from "../../lib/helpers";
import { now } from "../../lib/utils";

const openStatuses = new Set(["open", "snoozed"]);

const sourceTypeValidator = v.union(
  v.literal("manual"),
  v.literal("bot_task_reminder"),
  v.literal("reach_out"),
  v.literal("followup"),
);

const responsibilityTypeValidator = v.union(
  v.literal("group"),
  v.literal("person"),
);

const targetTypeValidator = v.union(
  v.literal("none"),
  v.literal("member"),
  v.literal("group"),
);

const snoozePresetValidator = v.union(
  v.literal("1_day"),
  v.literal("3_days"),
  v.literal("1_week"),
);

const snoozePresetMs: Record<"1_day" | "3_days" | "1_week", number> = {
  "1_day": 24 * 60 * 60 * 1000,
  "3_days": 3 * 24 * 60 * 60 * 1000,
  "1_week": 7 * 24 * 60 * 60 * 1000,
};

type TaskSourceType = "manual" | "bot_task_reminder" | "reach_out" | "followup";

function normalizeTags(tags: string[] | undefined): string[] {
  return (tags ?? [])
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean)
    .slice(0, 20);
}

async function appendTaskEvent(
  ctx: { db: any },
  args: {
    taskId: Id<"tasks">;
    groupId: Id<"groups">;
    type: string;
    performedById?: Id<"users">;
    payload?: unknown;
  },
) {
  await ctx.db.insert("taskEvents", {
    taskId: args.taskId,
    groupId: args.groupId,
    type: args.type,
    performedById: args.performedById,
    payload: args.payload,
    createdAt: now(),
  });
}

async function getLeaderMembership(
  ctx: { db: any },
  groupId: Id<"groups">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", groupId).eq("userId", userId),
    )
    .first();
  if (!isActiveMembership(membership) || !isLeaderRole(membership.role)) {
    throw new ConvexError("Leader access required");
  }
  return membership;
}

async function getActiveLeaderGroupIds(
  ctx: { db: any },
  userId: Id<"users">,
): Promise<Id<"groups">[]> {
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .collect();
  return memberships
    .filter(
      (membership: any) =>
        isActiveMembership(membership) && isLeaderRole(membership.role),
    )
    .map((membership: any) => membership.groupId);
}

async function getTaskOrThrow(ctx: { db: any }, taskId: Id<"tasks">) {
  const task = await ctx.db.get(taskId);
  if (!task) {
    throw new ConvexError("Task not found");
  }
  return task;
}

function assertTargetArgs(
  targetType: "none" | "member" | "group",
  targetMemberId: Id<"users"> | undefined,
  targetGroupId: Id<"groups"> | undefined,
) {
  if (targetType === "none" && (targetMemberId || targetGroupId)) {
    throw new ConvexError(
      "targetMemberId and targetGroupId must be omitted when targetType=none",
    );
  }
  if (targetType === "member" && !targetMemberId) {
    throw new ConvexError("targetMemberId is required when targetType=member");
  }
  if (targetType === "member" && targetGroupId) {
    throw new ConvexError("targetGroupId is not allowed when targetType=member");
  }
  if (targetType === "group" && !targetGroupId) {
    throw new ConvexError("targetGroupId is required when targetType=group");
  }
  if (targetType === "group" && targetMemberId) {
    throw new ConvexError("targetMemberId is not allowed when targetType=group");
  }
}

type TaskFilterArgs = {
  sourceType?: TaskSourceType;
  tag?: string;
  searchText?: string;
};

type FilterableTask = {
  sourceType: string;
  tags?: string[];
  title: string;
  description?: string;
  groupName?: string;
  targetMemberName?: string;
  targetGroupName?: string;
};

function applyTaskFilters<T extends FilterableTask>(
  tasks: T[],
  filters: TaskFilterArgs,
): T[] {
  const normalizedTag = filters.tag?.trim().toLowerCase().replace(/\s+/g, "_");
  const normalizedSearch = filters.searchText?.trim().toLowerCase();

  return tasks.filter((task) => {
    if (filters.sourceType && task.sourceType !== filters.sourceType) {
      return false;
    }
    if (normalizedTag && !(task.tags ?? []).includes(normalizedTag)) {
      return false;
    }
    if (normalizedSearch) {
      const searchableText = [
        task.title,
        task.description,
        task.groupName,
        task.targetMemberName,
        task.targetGroupName,
        ...(task.tags ?? []),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();
      if (!searchableText.includes(normalizedSearch)) {
        return false;
      }
    }
    return true;
  });
}

function formatUserName(user: any) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");
  return name || "Member";
}

async function enrichTasks<T extends { groupId: Id<"groups">; assignedToId?: Id<"users">; targetMemberId?: Id<"users">; targetGroupId?: Id<"groups"> }>(
  ctx: { db: any },
  tasks: T[],
): Promise<Array<T & { groupName: string; assignedToName?: string; targetMemberName?: string; targetGroupName?: string }>> {
  if (tasks.length === 0) return [];

  const groupIdStrings = [
    ...new Set(
      tasks.flatMap((task) => [
        task.groupId.toString(),
        task.targetGroupId?.toString(),
      ]),
    ),
  ].filter(Boolean) as string[];
  const userIdStrings = [
    ...new Set(
      tasks.flatMap((task) => [
        task.assignedToId?.toString(),
        task.targetMemberId?.toString(),
      ]),
    ),
  ].filter(Boolean) as string[];

  const [groups, users] = await Promise.all([
    Promise.all(
      groupIdStrings.map((groupId) => ctx.db.get(groupId as Id<"groups">)),
    ),
    Promise.all(userIdStrings.map((userId) => ctx.db.get(userId as Id<"users">))),
  ]);

  const groupMap = new Map<string, any>();
  groups.forEach((group, index) => {
    if (group) groupMap.set(groupIdStrings[index], group);
  });
  const userMap = new Map<string, any>();
  users.forEach((user, index) => {
    if (user) userMap.set(userIdStrings[index], user);
  });

  return tasks.map((task) => {
    const groupName = groupMap.get(task.groupId.toString())?.name ?? "Group";
    const assignedToName = task.assignedToId
      ? [userMap.get(task.assignedToId.toString())?.firstName, userMap.get(task.assignedToId.toString())?.lastName]
          .filter(Boolean)
          .join(" ")
      : undefined;
    const targetMemberName = task.targetMemberId
      ? [userMap.get(task.targetMemberId.toString())?.firstName, userMap.get(task.targetMemberId.toString())?.lastName]
          .filter(Boolean)
          .join(" ")
      : undefined;
    const targetGroupName = task.targetGroupId
      ? groupMap.get(task.targetGroupId.toString())?.name
      : undefined;

    return {
      ...task,
      groupName,
      assignedToName: assignedToName || undefined,
      targetMemberName: targetMemberName || undefined,
      targetGroupName,
    };
  });
}

export const hasLeaderAccess = query({
  args: {
    token: v.string(),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const leaderGroupIds = await getActiveLeaderGroupIds(ctx, userId);
    if (leaderGroupIds.length === 0) return false;
    if (!args.communityId) return true;

    const groups = await Promise.all(
      leaderGroupIds.map((groupId) => ctx.db.get(groupId)),
    );
    return groups.some((group) => group?.communityId === args.communityId);
  },
});

export const listMine = query({
  args: {
    token: v.string(),
    sourceType: v.optional(sourceTypeValidator),
    tag: v.optional(v.string()),
    searchText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const leaderGroupIds = await getActiveLeaderGroupIds(ctx, userId);
    if (leaderGroupIds.length === 0) return [];

    const leaderGroupIdSet = new Set(leaderGroupIds.map((id) => id.toString()));
    const [openTasks, snoozedTasks] = await Promise.all([
      ctx.db
        .query("tasks")
        .withIndex("by_assignee_status", (q: any) =>
          q.eq("assignedToId", userId).eq("status", "open"),
        )
        .collect(),
      ctx.db
        .query("tasks")
        .withIndex("by_assignee_status", (q: any) =>
          q.eq("assignedToId", userId).eq("status", "snoozed"),
        )
        .collect(),
    ]);

    const tasks = [...openTasks, ...snoozedTasks].filter((task) =>
      leaderGroupIdSet.has(task.groupId.toString()),
    );

    const enrichedTasks = await enrichTasks(ctx, tasks);
    return applyTaskFilters(enrichedTasks, args).sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === "open" ? -1 : 1;
        }
        const orderA = a.orderKey ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.orderKey ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return b.createdAt - a.createdAt;
      });
  },
});

export const listAll = query({
  args: {
    token: v.string(),
    sourceType: v.optional(sourceTypeValidator),
    tag: v.optional(v.string()),
    searchText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const leaderGroupIds = await getActiveLeaderGroupIds(ctx, userId);
    if (leaderGroupIds.length === 0) return [];

    const leaderGroupIdSet = new Set(leaderGroupIds.map((id) => id.toString()));
    const [groupOpenTasks, groupSnoozedTasks, personOpenTasks, personSnoozedTasks] =
      await Promise.all([
        ctx.db
          .query("tasks")
          .withIndex("by_responsibility_status", (q: any) =>
            q.eq("responsibilityType", "group").eq("status", "open"),
          )
          .collect(),
        ctx.db
          .query("tasks")
          .withIndex("by_responsibility_status", (q: any) =>
            q.eq("responsibilityType", "group").eq("status", "snoozed"),
          )
          .collect(),
        ctx.db
          .query("tasks")
          .withIndex("by_responsibility_status", (q: any) =>
            q.eq("responsibilityType", "person").eq("status", "open"),
          )
          .collect(),
        ctx.db
          .query("tasks")
          .withIndex("by_responsibility_status", (q: any) =>
            q.eq("responsibilityType", "person").eq("status", "snoozed"),
          )
          .collect(),
      ]);

    const tasks = [
      ...groupOpenTasks,
      ...groupSnoozedTasks,
      ...personOpenTasks,
      ...personSnoozedTasks,
    ].filter((task) => leaderGroupIdSet.has(task.groupId.toString()));

    const enrichedTasks = await enrichTasks(ctx, tasks);
    return applyTaskFilters(enrichedTasks, args).sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      const orderA = a.orderKey ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.orderKey ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return b.createdAt - a.createdAt;
    });
  },
});

export const listClaimable = query({
  args: {
    token: v.string(),
    sourceType: v.optional(sourceTypeValidator),
    tag: v.optional(v.string()),
    searchText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const leaderGroupIds = await getActiveLeaderGroupIds(ctx, userId);
    if (leaderGroupIds.length === 0) return [];

    const leaderGroupIdSet = new Set(leaderGroupIds.map((id) => id.toString()));
    const claimableTasks = await ctx.db
      .query("tasks")
      .withIndex("by_responsibility_status", (q: any) =>
        q.eq("responsibilityType", "group").eq("status", "open"),
      )
      .collect();

    const tasks = claimableTasks.filter(
      (task) =>
        !task.assignedToId && leaderGroupIdSet.has(task.groupId.toString()),
    );
    const enrichedTasks = await enrichTasks(ctx, tasks);
    return applyTaskFilters(enrichedTasks, args).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  },
});

export const listGroup = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    sourceType: v.optional(sourceTypeValidator),
    tag: v.optional(v.string()),
    searchText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await getLeaderMembership(ctx, args.groupId, userId);

    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_group", (q: any) => q.eq("groupId", args.groupId))
      .collect();
    const enrichedTasks = await enrichTasks(ctx, tasks);
    return applyTaskFilters(enrichedTasks, args).sort((a, b) => {
      const aRank = a.status === "open" ? 0 : a.status === "snoozed" ? 1 : 2;
      const bRank = b.status === "open" ? 0 : b.status === "snoozed" ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      const orderA = a.orderKey ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.orderKey ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return b.createdAt - a.createdAt;
    });
  },
});

export const listAssignableLeaders = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await getLeaderMembership(ctx, args.groupId, userId);

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q: any) => q.eq("groupId", args.groupId))
      .collect();
    const leaders = memberships.filter(
      (membership) =>
        isActiveMembership(membership) && isLeaderRole(membership.role),
    );
    const users = await Promise.all(
      leaders.map((membership) => ctx.db.get(membership.userId)),
    );

    return users
      .map((user) => {
        if (!user) return null;
        const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
        return {
          userId: user._id,
          name: name || "Leader",
        };
      })
      .filter((leader): leader is { userId: Id<"users">; name: string } =>
        Boolean(leader),
      );
  },
});

export const getTaskCard = query({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);

    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q: any) =>
        q.eq("groupId", task.groupId).eq("userId", userId),
      )
      .first();

    const isLeader = isActiveMembership(membership) && isLeaderRole(membership.role);
    const isTargetMember = task.targetMemberId === userId;
    if (!isLeader && !isTargetMember) {
      throw new ConvexError("Access denied");
    }

    const [assigneeUser, targetMemberUser] = await Promise.all([
      task.assignedToId ? ctx.db.get(task.assignedToId) : Promise.resolve(null),
      task.targetMemberId ? ctx.db.get(task.targetMemberId) : Promise.resolve(null),
    ]);

    return {
      _id: task._id,
      groupId: task.groupId,
      title: task.title,
      description: task.description,
      status: task.status,
      sourceType: task.sourceType,
      responsibilityType: task.responsibilityType,
      assignedToId: task.assignedToId,
      assignedToName: assigneeUser ? formatUserName(assigneeUser) : undefined,
      targetMemberId: task.targetMemberId,
      targetMemberName: targetMemberUser ? formatUserName(targetMemberUser) : undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      viewerCanManage: isLeader,
      viewerCanWithdraw:
        task.sourceType === "reach_out" &&
        isTargetMember &&
        task.status !== "done" &&
        task.status !== "canceled",
    };
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    title: v.string(),
    description: v.optional(v.string()),
    responsibilityType: v.optional(responsibilityTypeValidator),
    assignedToId: v.optional(v.id("users")),
    targetType: v.optional(targetTypeValidator),
    targetMemberId: v.optional(v.id("users")),
    targetGroupId: v.optional(v.id("groups")),
    tags: v.optional(v.array(v.string())),
    parentTaskId: v.optional(v.id("tasks")),
    dueAt: v.optional(v.number()),
    orderKey: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await getLeaderMembership(ctx, args.groupId, userId);

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("title is required");
    }

    const responsibilityType = args.responsibilityType ?? "group";
    if (responsibilityType === "person" && !args.assignedToId) {
      throw new ConvexError(
        "assignedToId is required when responsibilityType=person",
      );
    }
    if (args.assignedToId) {
      await getLeaderMembership(ctx, args.groupId, args.assignedToId);
    }

    const targetType = args.targetType ?? "none";
    assertTargetArgs(targetType, args.targetMemberId, args.targetGroupId);
    if (targetType === "member" && args.targetMemberId) {
      const targetMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q: any) =>
          q.eq("groupId", args.groupId).eq("userId", args.targetMemberId),
        )
        .first();
      if (!isActiveMembership(targetMembership)) {
        throw new ConvexError("target member must be active in this group");
      }
    }
    if (targetType === "group" && args.targetGroupId) {
      const targetGroup = await ctx.db.get(args.targetGroupId);
      if (!targetGroup) {
        throw new ConvexError("target group not found");
      }
      const currentGroup = await ctx.db.get(args.groupId);
      if (!currentGroup || targetGroup.communityId !== currentGroup.communityId) {
        throw new ConvexError("target group must be in the same community");
      }
    }
    if (args.parentTaskId) {
      const parentTask = await ctx.db.get(args.parentTaskId);
      if (!parentTask) {
        throw new ConvexError("parent task not found");
      }
      if (parentTask.groupId !== args.groupId) {
        throw new ConvexError("parent task must belong to the same group");
      }
    }

    const timestamp = now();
    const taskId = await ctx.db.insert("tasks", {
      groupId: args.groupId,
      title,
      description: args.description?.trim(),
      status: "open",
      responsibilityType,
      assignedToId: args.assignedToId,
      createdById: userId,
      sourceType: "manual",
      sourceRef: undefined,
      sourceKey: undefined,
      targetType,
      targetMemberId: targetType === "member" ? args.targetMemberId : undefined,
      targetGroupId: targetType === "group" ? args.targetGroupId : undefined,
      tags: normalizeTags(args.tags),
      parentTaskId: args.parentTaskId,
      orderKey: args.orderKey,
      dueAt: args.dueAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId,
      groupId: args.groupId,
      type: "created",
      performedById: userId,
      payload: { sourceType: "manual" },
    });

    return taskId;
  },
});

export const assign = mutation({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
    assigneeId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await getLeaderMembership(ctx, task.groupId, userId);

    if (!openStatuses.has(task.status)) {
      throw new ConvexError("Only open or snoozed tasks can be assigned");
    }
    if (args.assigneeId) {
      await getLeaderMembership(ctx, task.groupId, args.assigneeId);
    }

    await ctx.db.patch(args.taskId, {
      assignedToId: args.assigneeId,
      responsibilityType: args.assigneeId ? "person" : "group",
      updatedAt: now(),
    });

    await appendTaskEvent(ctx, {
      taskId: args.taskId,
      groupId: task.groupId,
      type: "assigned",
      performedById: userId,
      payload: { assigneeId: args.assigneeId ?? null },
    });

    return { success: true };
  },
});

export const claim = mutation({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await getLeaderMembership(ctx, task.groupId, userId);

    if (!openStatuses.has(task.status)) {
      throw new ConvexError("Only open or snoozed tasks can be claimed");
    }
    if (task.assignedToId && task.assignedToId !== userId) {
      throw new ConvexError("Task is already assigned");
    }

    await ctx.db.patch(args.taskId, {
      assignedToId: userId,
      responsibilityType: "person",
      updatedAt: now(),
    });

    await appendTaskEvent(ctx, {
      taskId: args.taskId,
      groupId: task.groupId,
      type: "claimed",
      performedById: userId,
    });

    return { success: true };
  },
});

function canResolvePersonTask(
  task: { assignedToId?: Id<"users">; responsibilityType: string },
  userId: Id<"users">,
  role: string,
) {
  if (task.responsibilityType !== "person") return true;
  if (!task.assignedToId) return true;
  return task.assignedToId === userId || role === "admin";
}

export const markDone = mutation({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    const membership = await getLeaderMembership(ctx, task.groupId, userId);

    if (!openStatuses.has(task.status)) {
      throw new ConvexError("Only open or snoozed tasks can be completed");
    }
    if (!canResolvePersonTask(task, userId, membership.role)) {
      throw new ConvexError(
        "Only the assignee or an admin can complete this task",
      );
    }

    const timestamp = now();
    await ctx.db.patch(args.taskId, {
      status: "done",
      completedAt: timestamp,
      snoozedUntil: undefined,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId: args.taskId,
      groupId: task.groupId,
      type: "done",
      performedById: userId,
    });

    return { success: true };
  },
});

export const snooze = mutation({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
    preset: snoozePresetValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    const membership = await getLeaderMembership(ctx, task.groupId, userId);

    if (!openStatuses.has(task.status)) {
      throw new ConvexError("Only open or snoozed tasks can be snoozed");
    }
    if (!canResolvePersonTask(task, userId, membership.role)) {
      throw new ConvexError(
        "Only the assignee or an admin can snooze this task",
      );
    }

    const timestamp = now();
    const snoozedUntil = timestamp + snoozePresetMs[args.preset];
    await ctx.db.patch(args.taskId, {
      status: "snoozed",
      snoozedUntil,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId: args.taskId,
      groupId: task.groupId,
      type: "snoozed",
      performedById: userId,
      payload: { preset: args.preset, snoozedUntil },
    });

    return { success: true, snoozedUntil };
  },
});

export const cancel = mutation({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    const membership = await getLeaderMembership(ctx, task.groupId, userId);

    if (!openStatuses.has(task.status)) {
      throw new ConvexError("Only open or snoozed tasks can be canceled");
    }
    if (!canResolvePersonTask(task, userId, membership.role)) {
      throw new ConvexError(
        "Only the assignee or an admin can cancel this task",
      );
    }

    const timestamp = now();
    await ctx.db.patch(args.taskId, {
      status: "canceled",
      canceledAt: timestamp,
      snoozedUntil: undefined,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId: args.taskId,
      groupId: task.groupId,
      type: "canceled",
      performedById: userId,
    });

    return { success: true };
  },
});

export const withdrawReachOut = mutation({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);

    if (task.sourceType !== "reach_out") {
      throw new ConvexError("Only reach-out tasks can be withdrawn");
    }
    if (task.targetMemberId !== userId) {
      throw new ConvexError("Only the requester can withdraw this task");
    }
    if (task.status === "done") {
      throw new ConvexError("Cannot withdraw a resolved request");
    }
    if (task.status === "canceled") {
      return { success: true };
    }
    if (!openStatuses.has(task.status)) {
      throw new ConvexError("Only open requests can be withdrawn");
    }

    const timestamp = now();
    await ctx.db.patch(args.taskId, {
      status: "canceled",
      canceledAt: timestamp,
      snoozedUntil: undefined,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId: args.taskId,
      groupId: task.groupId,
      type: "canceled",
      performedById: userId,
      payload: { source: "reach_out", reason: "withdrawn_by_member" },
    });

    return { success: true };
  },
});

export const createFromReachOutSubmission = internalMutation({
  args: {
    groupId: v.id("groups"),
    submittedById: v.id("users"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const timestamp = now();
    const title =
      args.content.length > 120
        ? `${args.content.slice(0, 117)}...`
        : args.content;
    const taskId = await ctx.db.insert("tasks", {
      groupId: args.groupId,
      title,
      description: args.content,
      status: "open",
      responsibilityType: "group",
      assignedToId: undefined,
      createdById: args.submittedById,
      sourceType: "reach_out",
      sourceRef: undefined,
      sourceKey: `reach_out:${args.groupId}:${args.submittedById}:${timestamp}`,
      targetType: "member",
      targetMemberId: args.submittedById,
      targetGroupId: undefined,
      tags: ["reach_out"],
      parentTaskId: undefined,
      orderKey: undefined,
      dueAt: undefined,
      snoozedUntil: undefined,
      completedAt: undefined,
      canceledAt: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId,
      groupId: args.groupId,
      type: "created",
      performedById: args.submittedById,
      payload: { sourceType: "reach_out" },
    });

    return taskId;
  },
});

export const createFromReachOutRequest = internalMutation({
  args: {
    groupId: v.id("groups"),
    submittedById: v.id("users"),
    requestId: v.id("reachOutRequests"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const sourceKey = `reach_out:${args.requestId}`;
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
      .first();
    if (existing) return existing._id;

    const timestamp = now();
    const title =
      args.content.length > 120
        ? `${args.content.slice(0, 117)}...`
        : args.content;
    const taskId = await ctx.db.insert("tasks", {
      groupId: args.groupId,
      title,
      description: args.content,
      status: "open",
      responsibilityType: "group",
      assignedToId: undefined,
      createdById: args.submittedById,
      sourceType: "reach_out",
      sourceRef: args.requestId.toString(),
      sourceKey,
      targetType: "member",
      targetMemberId: args.submittedById,
      targetGroupId: undefined,
      tags: ["reach_out"],
      parentTaskId: undefined,
      orderKey: undefined,
      dueAt: undefined,
      snoozedUntil: undefined,
      completedAt: undefined,
      canceledAt: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId,
      groupId: args.groupId,
      type: "created",
      performedById: args.submittedById,
      payload: {
        sourceType: "reach_out",
        sourceRef: args.requestId.toString(),
      },
    });

    return taskId;
  },
});

export const syncReachOutTask = internalMutation({
  args: {
    requestId: v.id("reachOutRequests"),
    status: v.union(
      v.literal("pending"),
      v.literal("assigned"),
      v.literal("resolved"),
      v.literal("revoked"),
    ),
    performedById: v.optional(v.id("users")),
    assignedToId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const sourceKey = `reach_out:${args.requestId}`;
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
      .first();
    if (!task) return null;

    const timestamp = now();
    if (args.status === "pending") {
      await ctx.db.patch(task._id, {
        status: "open",
        responsibilityType: "group",
        assignedToId: undefined,
        completedAt: undefined,
        canceledAt: undefined,
        updatedAt: timestamp,
      });
      await appendTaskEvent(ctx, {
        taskId: task._id,
        groupId: task.groupId,
        type: "updated",
        performedById: args.performedById,
        payload: { reachOutStatus: "pending" },
      });
      return task._id;
    }

    if (args.status === "assigned") {
      await ctx.db.patch(task._id, {
        status: "open",
        responsibilityType: "person",
        assignedToId: args.assignedToId,
        completedAt: undefined,
        canceledAt: undefined,
        updatedAt: timestamp,
      });
      await appendTaskEvent(ctx, {
        taskId: task._id,
        groupId: task.groupId,
        type: "assigned",
        performedById: args.performedById,
        payload: { assigneeId: args.assignedToId ?? null },
      });
      return task._id;
    }

    if (args.status === "resolved") {
      await ctx.db.patch(task._id, {
        status: "done",
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      await appendTaskEvent(ctx, {
        taskId: task._id,
        groupId: task.groupId,
        type: "done",
        performedById: args.performedById,
        payload: { source: "reach_out" },
      });
      return task._id;
    }

    await ctx.db.patch(task._id, {
      status: "canceled",
      canceledAt: timestamp,
      updatedAt: timestamp,
    });
    await appendTaskEvent(ctx, {
      taskId: task._id,
      groupId: task.groupId,
      type: "canceled",
      performedById: args.performedById,
      payload: { source: "reach_out", reason: "revoked" },
    });
    return task._id;
  },
});

export const createFromBotReminder = internalMutation({
  args: {
    groupId: v.id("groups"),
    assignedToId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    sourceKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_sourceKey", (q) => q.eq("sourceKey", args.sourceKey))
      .first();
    if (existing) return existing._id;

    const timestamp = now();
    const taskId = await ctx.db.insert("tasks", {
      groupId: args.groupId,
      title: args.title,
      description: args.description,
      status: "open",
      responsibilityType: "person",
      assignedToId: args.assignedToId,
      createdById: undefined,
      sourceType: "bot_task_reminder",
      sourceRef: args.sourceKey,
      sourceKey: args.sourceKey,
      targetType: "member",
      targetMemberId: args.assignedToId,
      targetGroupId: undefined,
      tags: ["bot_task_reminder"],
      parentTaskId: undefined,
      orderKey: undefined,
      dueAt: undefined,
      snoozedUntil: undefined,
      completedAt: undefined,
      canceledAt: undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId,
      groupId: args.groupId,
      type: "created",
      payload: { sourceType: "bot_task_reminder" },
    });

    return taskId;
  },
});
