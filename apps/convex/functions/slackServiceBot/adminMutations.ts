/**
 * FOUNT Service Planning Bot - Admin Mutations & Actions
 *
 * Public mutations/actions with auth for the admin config page.
 */

import { v } from "convex/values";
import { mutation, action, internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";
import { requireCommunityAdmin } from "../../lib/permissions";
import { listWorkspaceMembers, listWorkspaceChannels } from "./slack";
import { type ServicePlanItemV2, v2ToV1Fields } from "./configHelpers";
import {
  getValidAccessToken,
  fetchTeamsForServiceType,
  fetchUpcomingPlans,
  fetchPlanItems,
} from "../../lib/pcoServicesApi";
import { Id } from "../../_generated/dataModel";

/**
 * Toggle the slack bot on/off.
 */
export const toggleSlackBot = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });

    return { success: true, enabled: args.enabled };
  },
});

/**
 * Update team members list.
 */
export const updateTeamMembers = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    teamMembers: v.array(
      v.object({
        name: v.string(),
        slackUserId: v.string(),
        roles: v.array(v.string()),
        locations: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      teamMembers: args.teamMembers,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update thread mentions (per-location).
 */
export const updateThreadMentions = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    threadMentions: v.record(v.string(), v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      threadMentions: args.threadMentions,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update nag schedule.
 */
export const updateNagSchedule = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    nagSchedule: v.array(
      v.object({
        dayOfWeek: v.number(),
        hourET: v.number(),
        urgency: v.string(),
        label: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      nagSchedule: args.nagSchedule,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update AI/prompt configuration.
 */
export const updatePrompts = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    aiConfig: v.object({
      model: v.string(),
      botPersonality: v.string(),
      responseRules: v.string(),
      nagToneByLevel: v.record(v.string(), v.string()),
      teamContext: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      aiConfig: args.aiConfig,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update PCO configuration.
 */
export const updatePcoConfig = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    pcoConfig: v.object({
      communityId: v.string(),
      serviceTypeIds: v.record(v.string(), v.string()),
      roleMappings: v.record(
        v.string(),
        v.object({
          teamNamePattern: v.string(),
          positionName: v.string(),
        })
      ),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      pcoConfig: args.pcoConfig,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Toggle dev mode.
 */
export const toggleDevMode = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    devMode: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      devMode: args.devMode,
      updatedAt: Date.now(),
    });

    return { success: true, devMode: args.devMode };
  },
});

/**
 * Update service plan items (V2 format).
 * Writes both V2 array and syncs back to V1 fields for backward compatibility.
 */
export const updateServicePlanItems = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    items: v.array(v.object({
      id: v.string(),
      label: v.string(),
      responsibleRoles: v.array(v.string()),
      actionType: v.string(),
      pcoTeamNamePattern: v.optional(v.string()),
      pcoPositionName: v.optional(v.string()),
      pcoItemTitlePattern: v.optional(v.string()),
      pcoItemField: v.optional(v.string()),
      preserveSections: v.optional(v.array(v.string())),
      aiInstructions: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    // Validate actionType values
    const validActionTypes = ["assign_role", "update_plan_item", "none"];
    for (const item of args.items) {
      if (!validActionTypes.includes(item.actionType)) {
        throw new Error(
          `Invalid actionType "${item.actionType}" for item "${item.id}". Must be one of: ${validActionTypes.join(", ")}`
        );
      }
    }

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    // Sync V2 → V1 for backward compat
    const v1Fields = v2ToV1Fields(args.items as ServicePlanItemV2[]);

    await ctx.db.patch(config._id, {
      servicePlanItemsV2: args.items,
      servicePlanItems: v1Fields.servicePlanItems,
      servicePlanLabels: v1Fields.servicePlanLabels,
      itemResponsibleRoles: v1Fields.itemResponsibleRoles,
      pcoConfig: {
        ...config.pcoConfig,
        roleMappings: v1Fields.roleMappings,
      },
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update thread creation schedule (day of week + hour).
 */
export const updateThreadCreation = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    threadCreation: v.object({
      dayOfWeek: v.number(),
      hourET: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    if (args.threadCreation.dayOfWeek < 0 || args.threadCreation.dayOfWeek > 6) {
      throw new Error("dayOfWeek must be 0-6 (Sun-Sat)");
    }
    if (args.threadCreation.hourET < 0 || args.threadCreation.hourET > 23) {
      throw new Error("hourET must be 0-23");
    }

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      threadCreation: args.threadCreation,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update the Slack channel ID for thread posting.
 */
export const updateSlackChannelId = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    slackChannelId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const config = await ctx.db
      .query("slackBotConfig")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
    if (!config) throw new Error("Slack bot not configured for this community");

    await ctx.db.patch(config._id, {
      slackChannelId: args.slackChannelId,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// ============================================================================
// Auth helper for actions (actions can't access DB directly)
// ============================================================================

/**
 * Verify that the caller is a community admin.
 * Used by actions that need auth + admin check.
 */
export const verifyAdminAccess = internalMutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    return { userId };
  },
});

// ============================================================================
// Admin Actions (external API calls)
// ============================================================================

/**
 * List Slack workspace members for the team member picker dropdown.
 * Returns non-bot, non-deleted members with their name and profile image.
 */
export const listSlackMembers = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    // Verify admin access
    await ctx.runMutation(
      internal.functions.slackServiceBot.index.verifyAdminAccess,
      { token: args.token, communityId: args.communityId }
    );

    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken) throw new Error("SLACK_BOT_TOKEN not configured");

    return await listWorkspaceMembers(slackToken);
  },
});

/**
 * Fetch PCO teams and plan item titles for the admin config dropdowns.
 * Returns teams (with positions) and item titles from the nearest upcoming plan.
 */
export const fetchPcoTeamsAndItems = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    // Verify admin access
    await ctx.runMutation(
      internal.functions.slackServiceBot.index.verifyAdminAccess,
      { token: args.token, communityId: args.communityId }
    );

    // Read config to get service type IDs
    const config = await ctx.runQuery(
      internal.functions.slackServiceBot.index.getConfig,
      { communityId: args.communityId }
    );
    if (!config) throw new Error("Slack bot not configured");

    const accessToken = await getValidAccessToken(ctx, args.communityId);

    // Fetch teams and plan items across all locations, deduped by name.
    // Location is intentionally omitted: these are used as pattern suggestions
    // for matching across locations, so attaching one location would be misleading.
    const serviceTypeIds = config.pcoConfig.serviceTypeIds as Record<string, string>;
    const teamNames = new Set<string>();
    const teams: Array<{ id: string; name: string }> = [];
    const itemTitleSet = new Set<string>();
    const planItemTitles: Array<{ title: string }> = [];

    for (const [, serviceTypeId] of Object.entries(serviceTypeIds)) {
      // Teams
      const locationTeams = await fetchTeamsForServiceType(accessToken, serviceTypeId);
      for (const t of locationTeams) {
        if (!teamNames.has(t.attributes.name)) {
          teamNames.add(t.attributes.name);
          teams.push({ id: t.id, name: t.attributes.name });
        }
      }

      // Plan items from nearest upcoming plan
      const plans = await fetchUpcomingPlans(accessToken, serviceTypeId, 1);
      if (plans.length > 0) {
        const items = await fetchPlanItems(accessToken, serviceTypeId, plans[0].id);
        for (const item of items.data) {
          if (!itemTitleSet.has(item.attributes.title)) {
            itemTitleSet.add(item.attributes.title);
            planItemTitles.push({ title: item.attributes.title });
          }
        }
      }
    }

    return { teams, planItemTitles };
  },
});

/**
 * Manually trigger a nag for active service threads.
 * Used from the admin UI to re-send after a bad nag or test.
 */
export const sendNag = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    location: v.optional(v.string()),
    urgency: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    await ctx.runMutation(
      internal.functions.slackServiceBot.index.verifyAdminAccess,
      { token: args.token, communityId: args.communityId }
    );

    const config: { slackChannelId: string } | null = await ctx.runQuery(
      internal.functions.slackServiceBot.index.getConfig,
      { communityId: args.communityId }
    );
    if (!config) throw new Error("Slack bot not configured");

    const result: unknown = await ctx.runAction(
      internal.functions.slackServiceBot.index.triggerNag,
      {
        channelId: config.slackChannelId,
        location: args.location,
        urgency: args.urgency,
      }
    );

    return result;
  },
});

/**
 * List Slack workspace channels for the channel picker dropdown.
 * Returns public, non-archived channels.
 */
export const listSlackChannels = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    // Verify admin access
    await ctx.runMutation(
      internal.functions.slackServiceBot.index.verifyAdminAccess,
      { token: args.token, communityId: args.communityId }
    );

    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken) throw new Error("SLACK_BOT_TOKEN not configured");

    return await listWorkspaceChannels(slackToken);
  },
});
