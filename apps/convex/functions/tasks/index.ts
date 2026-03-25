import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isActiveMembership, isLeaderRole } from "../../lib/helpers";
import { searchCommunityMembersInternal } from "../../lib/memberSearch";
import { now } from "../../lib/utils";

const openStatuses = new Set(["open", "snoozed"]);

const sourceTypeValidator = v.union(
  v.literal("manual"),
  v.literal("bot_task_reminder"),
  v.literal("reach_out"),
  v.literal("followup"),
  v.literal("workflow_template"),
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

type TaskSourceType =
  | "manual"
  | "bot_task_reminder"
  | "reach_out"
  | "followup"
  | "workflow_template";

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

/**
 * Target person for a group task must belong to the group's community (not necessarily the group).
 * Used for onboarding workflows before someone joins the group.
 */
async function requireTargetUserInGroupCommunity(
  ctx: { db: any },
  groupId: Id<"groups">,
  targetUserId: Id<"users">,
) {
  const group = await ctx.db.get(groupId);
  if (!group) {
    throw new ConvexError("Group not found");
  }
  const uc = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", targetUserId).eq("communityId", group.communityId),
    )
    .first();
  if (!uc || uc.status !== 1) {
    throw new ConvexError(
      "Target person must be an active member of this community",
    );
  }
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
    throw new ConvexError(
      "targetGroupId is not allowed when targetType=member",
    );
  }
  if (targetType === "group" && !targetGroupId) {
    throw new ConvexError("targetGroupId is required when targetType=group");
  }
  if (targetType === "group" && targetMemberId) {
    throw new ConvexError(
      "targetMemberId is not allowed when targetType=group",
    );
  }
}

type TaskFilterArgs = {
  sourceType?: TaskSourceType;
  tag?: string;
  searchText?: string;
};

const listScopeValidator = v.optional(
  v.union(v.literal("active"), v.literal("completed")),
);

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

type SubtaskInfo = {
  _id: Id<"tasks">;
  title: string;
  status: string;
  assignedToName?: string;
};

type SubtaskProgressEntry = {
  total: number;
  completed: number;
  subtasks: SubtaskInfo[];
};

/**
 * Build subtask counts + lightweight subtask arrays from an already-loaded
 * group task list (e.g. listGroup) so we do not re-query the whole group.
 */
function buildSubtaskProgressMapFromGroupTasks(
  candidates: Array<{ _id: Id<"tasks"> }>,
  allTasksInGroup: Array<{
    _id: Id<"tasks">;
    parentTaskId?: Id<"tasks">;
    status: string;
    title: string;
    orderKey?: number;
    assignedToId?: Id<"users">;
  }>,
  userMap: Map<string, string>,
): Map<string, SubtaskProgressEntry> {
  const progressMap = new Map<string, SubtaskProgressEntry>();
  if (candidates.length === 0) return progressMap;

  const candidateIds = new Set(candidates.map((t) => t._id.toString()));
  for (const t of allTasksInGroup) {
    if (!t.parentTaskId) continue;
    const pid = t.parentTaskId.toString();
    if (!candidateIds.has(pid)) continue;
    const cur = progressMap.get(pid) ?? { total: 0, completed: 0, subtasks: [] };
    cur.total += 1;
    if (t.status === "done") cur.completed += 1;
    cur.subtasks.push({
      _id: t._id,
      title: t.title,
      status: t.status,
      assignedToName: t.assignedToId
        ? userMap.get(t.assignedToId.toString())
        : undefined,
    });
    progressMap.set(pid, cur);
  }
  // Pre-build orderKey lookup for O(1) access during sort
  const orderKeyMap = new Map<string, number>();
  for (const t of allTasksInGroup) {
    orderKeyMap.set(t._id.toString(), t.orderKey ?? 0);
  }
  // Sort subtasks by orderKey
  for (const entry of progressMap.values()) {
    entry.subtasks.sort((a, b) => {
      return (orderKeyMap.get(a._id.toString()) ?? 0) - (orderKeyMap.get(b._id.toString()) ?? 0);
    });
  }
  return progressMap;
}

/**
 * One small by_parent query per listed task — avoids loading every task in each group
 * (unlike scanning by_group for each distinct group).
 * Returns progress counts + lightweight subtask arrays with assignee names.
 */
async function buildSubtaskProgressMapByParentIndex(
  ctx: { db: any },
  candidates: Array<{ _id: Id<"tasks"> }>,
): Promise<Map<string, SubtaskProgressEntry>> {
  const progressMap = new Map<string, SubtaskProgressEntry>();
  if (candidates.length === 0) return progressMap;

  // Gather all children
  const allChildren: Array<{ parentId: string; child: any }> = [];
  await Promise.all(
    candidates.map(async (task) => {
      const children = await ctx.db
        .query("tasks")
        .withIndex("by_parent", (q: any) => q.eq("parentTaskId", task._id))
        .collect();
      for (const child of children) {
        allChildren.push({ parentId: task._id.toString(), child });
      }
    }),
  );

  if (allChildren.length === 0) return progressMap;

  // Batch-fetch assignee names
  const assigneeIds = [
    ...new Set(
      allChildren
        .map((c) => c.child.assignedToId?.toString())
        .filter(Boolean) as string[],
    ),
  ];
  const assigneeUsers = await Promise.all(
    assigneeIds.map((id) => ctx.db.get(id as Id<"users">)),
  );
  const assigneeNameById = new Map<string, string>();
  assigneeIds.forEach((id, i) => {
    const u = assigneeUsers[i];
    assigneeNameById.set(id, u ? formatUserName(u) : "Member");
  });

  // Build entries
  for (const { parentId, child } of allChildren) {
    const cur = progressMap.get(parentId) ?? { total: 0, completed: 0, subtasks: [] };
    cur.total += 1;
    if (child.status === "done") cur.completed += 1;
    cur.subtasks.push({
      _id: child._id,
      title: child.title,
      status: child.status,
      assignedToName: child.assignedToId
        ? assigneeNameById.get(child.assignedToId.toString())
        : undefined,
    });
    progressMap.set(parentId, cur);
  }

  // Pre-build orderKey lookup for O(1) access during sort
  const orderKeyMap = new Map<string, number>();
  for (const { child } of allChildren) {
    orderKeyMap.set(child._id.toString(), child.orderKey ?? 0);
  }
  // Sort subtasks by orderKey
  for (const entry of progressMap.values()) {
    entry.subtasks.sort((a, b) => {
      return (orderKeyMap.get(a._id.toString()) ?? 0) - (orderKeyMap.get(b._id.toString()) ?? 0);
    });
  }

  return progressMap;
}

function subtaskProgressOrNull(
  taskId: string,
  progressMap: Map<string, SubtaskProgressEntry>,
): { total: number; completed: number } | null {
  const p = progressMap.get(taskId);
  if (!p || p.total === 0) return null;
  return { total: p.total, completed: p.completed };
}

function subtasksOrNull(
  taskId: string,
  progressMap: Map<string, SubtaskProgressEntry>,
): SubtaskInfo[] | undefined {
  const p = progressMap.get(taskId);
  if (!p || p.subtasks.length === 0) return undefined;
  return p.subtasks;
}

async function enrichTasks<
  T extends {
    groupId: Id<"groups">;
    assignedToId?: Id<"users">;
    targetMemberId?: Id<"users">;
    targetGroupId?: Id<"groups">;
  },
>(
  ctx: { db: any },
  tasks: T[],
): Promise<
  Array<
    T & {
      groupName: string;
      assignedToName?: string;
      targetMemberName?: string;
      targetGroupName?: string;
    }
  >
> {
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
    Promise.all(
      userIdStrings.map((userId) => ctx.db.get(userId as Id<"users">)),
    ),
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
      ? [
          userMap.get(task.assignedToId.toString())?.firstName,
          userMap.get(task.assignedToId.toString())?.lastName,
        ]
          .filter(Boolean)
          .join(" ")
      : undefined;
    const targetMemberName = task.targetMemberId
      ? [
          userMap.get(task.targetMemberId.toString())?.firstName,
          userMap.get(task.targetMemberId.toString())?.lastName,
        ]
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
    listScope: listScopeValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const leaderGroupIds = await getActiveLeaderGroupIds(ctx, userId);
    if (leaderGroupIds.length === 0) return [];

    const leaderGroupIdSet = new Set(leaderGroupIds.map((id) => id.toString()));
    const scope = args.listScope ?? "active";

    let tasks: any[];
    if (scope === "completed") {
      const doneTasks = await ctx.db
        .query("tasks")
        .withIndex("by_assignee_status", (q: any) =>
          q.eq("assignedToId", userId).eq("status", "done"),
        )
        .collect();
      tasks = doneTasks.filter((task) =>
        leaderGroupIdSet.has(task.groupId.toString()),
      );
    } else {
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
      tasks = [...openTasks, ...snoozedTasks].filter((task) =>
        leaderGroupIdSet.has(task.groupId.toString()),
      );
    }

    const enrichedTasks = await enrichTasks(ctx, tasks);
    const filtered = applyTaskFilters(enrichedTasks, args).sort((a, b) => {
      if (scope === "completed") {
        const ca = a.completedAt ?? 0;
        const cb = b.completedAt ?? 0;
        if (ca !== cb) return cb - ca;
        return b.createdAt - a.createdAt;
      }
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      const orderA = a.orderKey ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.orderKey ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return b.createdAt - a.createdAt;
    });
    const progressMap = await buildSubtaskProgressMapByParentIndex(
      ctx,
      filtered,
    );
    return filtered.map((t) => ({
      ...t,
      subtaskProgress: subtaskProgressOrNull(t._id.toString(), progressMap),
      subtasks: subtasksOrNull(t._id.toString(), progressMap),
    }));
  },
});

export const listAll = query({
  args: {
    token: v.string(),
    sourceType: v.optional(sourceTypeValidator),
    tag: v.optional(v.string()),
    searchText: v.optional(v.string()),
    listScope: listScopeValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const leaderGroupIds = await getActiveLeaderGroupIds(ctx, userId);
    if (leaderGroupIds.length === 0) return [];

    const leaderGroupIdSet = new Set(leaderGroupIds.map((id) => id.toString()));
    const scope = args.listScope ?? "active";

    let tasks: any[];
    if (scope === "completed") {
      const [groupDoneTasks, personDoneTasks] = await Promise.all([
        ctx.db
          .query("tasks")
          .withIndex("by_responsibility_status", (q: any) =>
            q.eq("responsibilityType", "group").eq("status", "done"),
          )
          .collect(),
        ctx.db
          .query("tasks")
          .withIndex("by_responsibility_status", (q: any) =>
            q.eq("responsibilityType", "person").eq("status", "done"),
          )
          .collect(),
      ]);
      tasks = [...groupDoneTasks, ...personDoneTasks].filter((task) =>
        leaderGroupIdSet.has(task.groupId.toString()),
      );
    } else {
      const [
        groupOpenTasks,
        groupSnoozedTasks,
        personOpenTasks,
        personSnoozedTasks,
      ] = await Promise.all([
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

      tasks = [
        ...groupOpenTasks,
        ...groupSnoozedTasks,
        ...personOpenTasks,
        ...personSnoozedTasks,
      ].filter((task) => leaderGroupIdSet.has(task.groupId.toString()));
    }

    const enrichedTasks = await enrichTasks(ctx, tasks);
    const filtered = applyTaskFilters(enrichedTasks, args).sort((a, b) => {
      if (scope === "completed") {
        const ca = a.completedAt ?? 0;
        const cb = b.completedAt ?? 0;
        if (ca !== cb) return cb - ca;
        return b.createdAt - a.createdAt;
      }
      if (a.status !== b.status) {
        return a.status === "open" ? -1 : 1;
      }
      const orderA = a.orderKey ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.orderKey ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return b.createdAt - a.createdAt;
    });
    const progressMap = await buildSubtaskProgressMapByParentIndex(
      ctx,
      filtered,
    );
    return filtered.map((t) => ({
      ...t,
      subtaskProgress: subtaskProgressOrNull(t._id.toString(), progressMap),
      subtasks: subtasksOrNull(t._id.toString(), progressMap),
    }));
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
    const filtered = applyTaskFilters(enrichedTasks, args).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const progressMap = await buildSubtaskProgressMapByParentIndex(
      ctx,
      filtered,
    );
    return filtered.map((t) => ({
      ...t,
      subtaskProgress: subtaskProgressOrNull(t._id.toString(), progressMap),
      subtasks: subtasksOrNull(t._id.toString(), progressMap),
    }));
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
    const filtered = applyTaskFilters(enrichedTasks, args).sort((a, b) => {
      const aRank = a.status === "open" ? 0 : a.status === "snoozed" ? 1 : 2;
      const bRank = b.status === "open" ? 0 : b.status === "snoozed" ? 1 : 2;
      if (aRank !== bRank) return aRank - bRank;
      const orderA = a.orderKey ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.orderKey ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return b.createdAt - a.createdAt;
    });
    // Build a user name map from enriched tasks for subtask assignee names
    const userNameMap = new Map<string, string>();
    for (const t of enrichedTasks) {
      if (t.assignedToId && t.assignedToName) {
        userNameMap.set(t.assignedToId.toString(), t.assignedToName);
      }
    }
    // Also fetch assignee names for subtasks whose assignees aren't in the parent list
    const subtaskAssigneeIds = new Set<string>();
    for (const t of tasks) {
      if (t.parentTaskId && t.assignedToId) {
        const aid = t.assignedToId.toString();
        if (!userNameMap.has(aid)) subtaskAssigneeIds.add(aid);
      }
    }
    if (subtaskAssigneeIds.size > 0) {
      const extraUsers = await Promise.all(
        [...subtaskAssigneeIds].map((id) => ctx.db.get(id as Id<"users">)),
      );
      [...subtaskAssigneeIds].forEach((id, i) => {
        const u = extraUsers[i];
        userNameMap.set(id, u ? formatUserName(u) : "Member");
      });
    }

    const progressMap = buildSubtaskProgressMapFromGroupTasks(filtered, tasks, userNameMap);
    return filtered.map((t) => ({
      ...t,
      subtaskProgress: subtaskProgressOrNull(t._id.toString(), progressMap),
      subtasks: subtasksOrNull(t._id.toString(), progressMap),
    }));
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

async function searchGroupMembers(
  ctx: { db: any },
  groupId: Id<"groups">,
  searchText: string,
  options: {
    limit: number;
    requireLeaderRole: boolean;
    fallbackName: string;
  },
): Promise<{ userId: Id<"users">; name: string }[]> {
  const normalizedSearch = searchText.trim().toLowerCase();
  if (!normalizedSearch) {
    return [];
  }

  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
    .collect();
  const filteredMemberships = memberships.filter((membership: any) =>
    options.requireLeaderRole
      ? isActiveMembership(membership) && isLeaderRole(membership.role)
      : isActiveMembership(membership),
  );
  const users = await Promise.all(
    filteredMemberships.map((membership: any) => ctx.db.get(membership.userId)),
  );

  return users
    .map((user) => {
      if (!user) return null;
      const fullName = [user.firstName, user.lastName]
        .filter(Boolean)
        .join(" ");
      const searchableText = [
        fullName,
        user.firstName,
        user.lastName,
        user.email,
        user.phone,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();
      if (!searchableText.includes(normalizedSearch)) {
        return null;
      }
      return {
        userId: user._id,
        name: fullName || options.fallbackName,
      };
    })
    .filter((result): result is { userId: Id<"users">; name: string } =>
      Boolean(result),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, options.limit);
}

export const searchAssignableLeaders = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    searchText: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await getLeaderMembership(ctx, args.groupId, userId);

    return searchGroupMembers(ctx, args.groupId, args.searchText, {
      limit: Math.min(args.limit ?? 25, 100),
      requireLeaderRole: true,
      fallbackName: "Leader",
    });
  },
});

export const searchRelevantMembers = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    searchText: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await getLeaderMembership(ctx, args.groupId, userId);

    const group = await ctx.db.get(args.groupId);
    if (!group) {
      throw new ConvexError("Group not found");
    }

    const limit = Math.min(args.limit ?? 30, 100);
    const matches = await searchCommunityMembersInternal(ctx, {
      communityId: group.communityId,
      search: args.searchText,
      limit,
      includeAdminFields: false,
    });

    return matches
      .map((m) => ({
        userId: m.id,
        name:
          [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || "Member",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
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

    const isLeader =
      isActiveMembership(membership) && isLeaderRole(membership.role);
    const isTargetMember = task.targetMemberId === userId;
    if (!isLeader && !isTargetMember) {
      throw new ConvexError("Access denied");
    }

    const [assigneeUser, targetMemberUser] = await Promise.all([
      task.assignedToId ? ctx.db.get(task.assignedToId) : Promise.resolve(null),
      task.targetMemberId
        ? ctx.db.get(task.targetMemberId)
        : Promise.resolve(null),
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
      targetMemberName: targetMemberUser
        ? formatUserName(targetMemberUser)
        : undefined,
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

export const getDetail = query({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await getLeaderMembership(ctx, task.groupId, userId);

    const [
      group,
      createdBy,
      assignedTo,
      targetMember,
      targetGroup,
      parentTask,
      subtasksRaw,
    ] = await Promise.all([
      ctx.db.get(task.groupId),
      task.createdById ? ctx.db.get(task.createdById) : Promise.resolve(null),
      task.assignedToId ? ctx.db.get(task.assignedToId) : Promise.resolve(null),
      task.targetMemberId
        ? ctx.db.get(task.targetMemberId)
        : Promise.resolve(null),
      task.targetGroupId
        ? ctx.db.get(task.targetGroupId)
        : Promise.resolve(null),
      task.parentTaskId ? ctx.db.get(task.parentTaskId) : Promise.resolve(null),
      ctx.db
        .query("tasks")
        .withIndex("by_parent", (q: any) => q.eq("parentTaskId", args.taskId))
        .collect(),
    ]);

    const sortedSubtasks = [...subtasksRaw].sort(
      (a, b) => (a.orderKey ?? 0) - (b.orderKey ?? 0),
    );
    const assigneeIds = [
      ...new Set(
        sortedSubtasks
          .map((s) => s.assignedToId?.toString())
          .filter(Boolean) as string[],
      ),
    ];
    const assigneeUsers = await Promise.all(
      assigneeIds.map((id) => ctx.db.get(id as Id<"users">)),
    );
    const assigneeNameById = new Map<string, string>();
    assigneeIds.forEach((id, i) => {
      const u = assigneeUsers[i];
      assigneeNameById.set(id, u ? formatUserName(u) : "Member");
    });

    const subtasks = sortedSubtasks.map((s) => ({
      _id: s._id,
      title: s.title,
      status: s.status,
      description: s.description,
      assignedToId: s.assignedToId,
      assignedToName: s.assignedToId
        ? (assigneeNameById.get(s.assignedToId.toString()) ?? undefined)
        : undefined,
      orderKey: s.orderKey,
    }));

    const subTotal = subtasksRaw.length;
    const subCompleted = subtasksRaw.filter((s) => s.status === "done").length;
    const subtaskProgress =
      subTotal > 0
        ? { total: subTotal, completed: subCompleted }
        : null;

    return {
      ...task,
      groupName: group && "name" in group ? group.name : "Group",
      createdByName: createdBy ? formatUserName(createdBy) : undefined,
      assignedToName: assignedTo ? formatUserName(assignedTo) : undefined,
      targetMemberName: targetMember ? formatUserName(targetMember) : undefined,
      targetGroupName:
        targetGroup && "name" in targetGroup ? targetGroup.name : undefined,
      parentTaskTitle:
        parentTask && "title" in parentTask ? parentTask.title : undefined,
      subtaskProgress,
      subtasks,
    };
  },
});

export const listHistory = query({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await getLeaderMembership(ctx, task.groupId, userId);

    const events = await ctx.db
      .query("taskEvents")
      .withIndex("by_task_createdAt", (q: any) => q.eq("taskId", args.taskId))
      .collect();

    const performerIds = [
      ...new Set(events.map((event) => event.performedById?.toString())),
    ].filter(Boolean) as string[];
    const performers = await Promise.all(
      performerIds.map((performerId) => ctx.db.get(performerId as Id<"users">)),
    );
    const performerMap = new Map<string, string>();
    performers.forEach((performer, index) => {
      if (!performer) return;
      performerMap.set(performerIds[index], formatUserName(performer));
    });

    return events
      .map((event) => ({
        ...event,
        performedByName: event.performedById
          ? (performerMap.get(event.performedById.toString()) ?? "Leader")
          : undefined,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
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
      await requireTargetUserInGroupCommunity(
        ctx,
        args.groupId,
        args.targetMemberId,
      );
    }
    if (targetType === "group" && args.targetGroupId) {
      const targetGroup = await ctx.db.get(args.targetGroupId);
      if (!targetGroup) {
        throw new ConvexError("target group not found");
      }
      const currentGroup = await ctx.db.get(args.groupId);
      if (
        !currentGroup ||
        targetGroup.communityId !== currentGroup.communityId
      ) {
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

export const update = mutation({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    tags: v.optional(v.array(v.string())),
    relevantMemberId: v.optional(v.union(v.id("users"), v.null())),
    parentTaskId: v.optional(v.union(v.id("tasks"), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    await getLeaderMembership(ctx, task.groupId, userId);

    const patch: Record<string, unknown> = {
      updatedAt: now(),
    };

    if (args.title !== undefined) {
      const trimmedTitle = args.title.trim();
      if (!trimmedTitle) {
        throw new ConvexError("title is required");
      }
      patch.title = trimmedTitle;
    }

    if (args.description !== undefined) {
      const trimmedDescription = args.description?.trim();
      patch.description = trimmedDescription || undefined;
    }

    if (args.tags !== undefined) {
      patch.tags = normalizeTags(args.tags);
    }

    if (args.relevantMemberId !== undefined) {
      if (args.relevantMemberId) {
        await requireTargetUserInGroupCommunity(
          ctx,
          task.groupId,
          args.relevantMemberId as Id<"users">,
        );
        patch.targetType = "member";
        patch.targetMemberId = args.relevantMemberId;
        patch.targetGroupId = undefined;
      } else if (task.targetType === "member") {
        patch.targetType = "group";
        patch.targetMemberId = undefined;
        patch.targetGroupId = task.groupId;
      }
    }

    if (args.parentTaskId !== undefined) {
      if (args.parentTaskId) {
        if (args.parentTaskId === task._id) {
          throw new ConvexError("task cannot be its own parent");
        }
        const parentTask = await ctx.db.get(args.parentTaskId as Id<"tasks">);
        if (!parentTask) {
          throw new ConvexError("parent task not found");
        }
        if (parentTask.groupId !== task.groupId) {
          throw new ConvexError("parent task must belong to the same group");
        }
        patch.parentTaskId = args.parentTaskId;
      } else {
        patch.parentTaskId = undefined;
      }
    }

    await ctx.db.patch(args.taskId, patch);
    await appendTaskEvent(ctx, {
      taskId: args.taskId,
      groupId: task.groupId,
      type: "updated",
      performedById: userId,
      payload: {
        changedFields: Object.keys(patch).filter(
          (field) => field !== "updatedAt",
        ),
      },
    });

    return { success: true };
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
  return task.assignedToId === userId || isLeaderRole(role);
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
        "Only the assignee or a group leader can complete this task",
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

export const reopen = mutation({
  args: {
    token: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const task = await getTaskOrThrow(ctx, args.taskId);
    const membership = await getLeaderMembership(ctx, task.groupId, userId);

    if (task.status !== "done") {
      throw new ConvexError("Only completed tasks can be reopened");
    }
    if (!canResolvePersonTask(task, userId, membership.role)) {
      throw new ConvexError(
        "Only the assignee or a group leader can reopen this task",
      );
    }

    const timestamp = now();
    await ctx.db.patch(args.taskId, {
      status: "open",
      completedAt: undefined,
      updatedAt: timestamp,
    });

    await appendTaskEvent(ctx, {
      taskId: args.taskId,
      groupId: task.groupId,
      type: "updated",
      performedById: userId,
      payload: { reopened: true },
    });

    return { success: true };
  },
});

export const createFromTemplate = mutation({
  args: {
    token: v.string(),
    templateId: v.id("taskTemplates"),
    targetMemberId: v.id("users"),
    assignedToId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const template = await ctx.db.get(args.templateId);
    if (!template || !template.isActive) {
      throw new ConvexError("Template not found or inactive");
    }
    await getLeaderMembership(ctx, template.groupId, userId);

    await requireTargetUserInGroupCommunity(
      ctx,
      template.groupId,
      args.targetMemberId,
    );

    if (args.assignedToId) {
      await getLeaderMembership(ctx, template.groupId, args.assignedToId);
    }

    const targetUser = await ctx.db.get(args.targetMemberId);
    const memberName = targetUser ? formatUserName(targetUser) : "Member";
    const parentTitle = `${template.title}: ${memberName}`;

    const responsibilityType = args.assignedToId ? "person" : "group";
    const timestamp = now();
    const sourceRef = args.templateId.toString();
    const templateTags = normalizeTags(template.tags);
    const tagsValue = templateTags.length > 0 ? templateTags : undefined;

    const parentTaskId = await ctx.db.insert("tasks", {
      groupId: template.groupId,
      title: parentTitle,
      description: template.description,
      status: "open",
      responsibilityType,
      assignedToId: args.assignedToId,
      createdById: userId,
      sourceType: "workflow_template",
      sourceRef,
      sourceKey: undefined,
      targetType: "member",
      targetMemberId: args.targetMemberId,
      targetGroupId: undefined,
      tags: tagsValue,
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
      taskId: parentTaskId,
      groupId: template.groupId,
      type: "created",
      performedById: userId,
      payload: { sourceType: "workflow_template", templateId: sourceRef },
    });

    const sortedSteps = [...template.steps].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );

    for (const step of sortedSteps) {
      const subId = await ctx.db.insert("tasks", {
        groupId: template.groupId,
        title: step.title,
        description: step.description,
        status: "open",
        responsibilityType,
        assignedToId: args.assignedToId,
        createdById: userId,
        sourceType: "workflow_template",
        sourceRef,
        sourceKey: undefined,
        targetType: "member",
        targetMemberId: args.targetMemberId,
        targetGroupId: undefined,
        tags: tagsValue,
        parentTaskId,
        orderKey: step.orderIndex,
        dueAt: undefined,
        snoozedUntil: undefined,
        completedAt: undefined,
        canceledAt: undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await appendTaskEvent(ctx, {
        taskId: subId,
        groupId: template.groupId,
        type: "created",
        performedById: userId,
        payload: { sourceType: "workflow_template", parentTaskId },
      });
    }

    return parentTaskId;
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
        "Only the assignee or a group leader can snooze this task",
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
        "Only the assignee or a group leader can cancel this task",
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
