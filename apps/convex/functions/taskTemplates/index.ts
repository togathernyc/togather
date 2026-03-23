import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isActiveMembership, isLeaderRole } from "../../lib/helpers";
import { now } from "../../lib/utils";

const stepValidator = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  orderIndex: v.number(),
});

function normalizeTags(tags: string[] | undefined): string[] {
  return (tags ?? [])
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean)
    .slice(0, 20);
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

export const list = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await getLeaderMembership(ctx, args.groupId, userId);

    const templates = await ctx.db
      .query("taskTemplates")
      .withIndex("by_group_active", (q: any) =>
        q.eq("groupId", args.groupId).eq("isActive", true),
      )
      .collect();

    return templates.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const listAll = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const leaderGroupIds = await getActiveLeaderGroupIds(ctx, userId);
    if (leaderGroupIds.length === 0) return [];

    const results: any[] = [];

    for (const groupId of leaderGroupIds) {
      const templates = await ctx.db
        .query("taskTemplates")
        .withIndex("by_group", (q: any) => q.eq("groupId", groupId))
        .collect();
      results.push(...templates);
    }

    const groupIds = [...new Set(results.map((t) => t.groupId.toString()))];
    const groups = await Promise.all(
      groupIds.map((gid) => ctx.db.get(gid as Id<"groups">)),
    );
    const groupNameById = new Map<string, string>();
    groupIds.forEach((gid, i) => {
      const g = groups[i];
      groupNameById.set(gid, g && "name" in g ? g.name : "Group");
    });

    return results
      .map((t) => ({
        ...t,
        groupName: groupNameById.get(t.groupId.toString()) ?? "Group",
      }))
      .sort((a, b) => {
        const g = a.groupName.localeCompare(b.groupName);
        if (g !== 0) return g;
        return b.updatedAt - a.updatedAt;
      });
  },
});

export const get = query({
  args: {
    token: v.string(),
    templateId: v.id("taskTemplates"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new ConvexError("Template not found");
    }
    await getLeaderMembership(ctx, template.groupId, userId);
    return template;
  },
});

export const create = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    title: v.string(),
    description: v.optional(v.string()),
    steps: v.array(stepValidator),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await getLeaderMembership(ctx, args.groupId, userId);

    const title = args.title.trim();
    if (!title) {
      throw new ConvexError("title is required");
    }
    if (args.steps.length === 0) {
      throw new ConvexError("At least one step is required");
    }

    const normalizedTags = normalizeTags(args.tags);
    const timestamp = now();
    const templateId = await ctx.db.insert("taskTemplates", {
      groupId: args.groupId,
      title,
      description: args.description?.trim(),
      createdById: userId,
      steps: args.steps.map((s, i) => ({
        title: s.title.trim(),
        description: s.description?.trim(),
        orderIndex: s.orderIndex ?? i,
      })),
      tags: normalizedTags.length > 0 ? normalizedTags : undefined,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return templateId;
  },
});

export const update = mutation({
  args: {
    token: v.string(),
    templateId: v.id("taskTemplates"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    steps: v.optional(v.array(stepValidator)),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new ConvexError("Template not found");
    }
    await getLeaderMembership(ctx, template.groupId, userId);

    const patch: Record<string, unknown> = {
      updatedAt: now(),
    };

    if (args.title !== undefined) {
      const trimmed = args.title.trim();
      if (!trimmed) {
        throw new ConvexError("title is required");
      }
      patch.title = trimmed;
    }

    if (args.description !== undefined) {
      patch.description = args.description?.trim() || undefined;
    }

    if (args.steps !== undefined) {
      if (args.steps.length === 0) {
        throw new ConvexError("At least one step is required");
      }
      patch.steps = args.steps.map((s, i) => ({
        title: s.title.trim(),
        description: s.description?.trim(),
        orderIndex: s.orderIndex ?? i,
      }));
    }

    if (args.tags !== undefined) {
      const normalizedTags = normalizeTags(args.tags);
      patch.tags = normalizedTags.length > 0 ? normalizedTags : undefined;
    }

    await ctx.db.patch(args.templateId, patch);
    return { success: true };
  },
});

export const remove = mutation({
  args: {
    token: v.string(),
    templateId: v.id("taskTemplates"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const template = await ctx.db.get(args.templateId);
    if (!template) {
      throw new ConvexError("Template not found");
    }
    await getLeaderMembership(ctx, template.groupId, userId);

    await ctx.db.patch(args.templateId, {
      isActive: false,
      updatedAt: now(),
    });
    return { success: true };
  },
});
