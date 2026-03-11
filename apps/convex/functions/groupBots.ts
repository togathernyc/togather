/**
 * Group Bot functions
 *
 * Handles bot configuration for groups:
 * - List available bots
 * - List bots enabled for a group
 * - Get/update bot config
 * - Enable/disable bots
 */

import { v } from "convex/values";
import { query, mutation, action } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { now } from "../lib/utils";
import { calculateCommunicationBotNextSchedule, calculateNextScheduledTimeForDayOfWeek } from "../lib/scheduling";
import { requireAuth, requireAuthFromToken } from "../lib/auth";
import { isActiveMembership, isLeaderRole } from "../lib/helpers";

// ============================================================================
// Bot Definitions
// ============================================================================

/**
 * Bot definition type
 */
interface ConfigFieldDefinition {
  key: string;
  label: string;
  type: "text" | "textarea" | "boolean" | "number" | "select" | "leader_select" | "channel_select";
  placeholder?: string;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
  showWhen?: { field: string; value: string | string[] };
}

interface BotDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  triggerType: "cron" | "event";
  defaultConfig?: Record<string, unknown>;
  configFields?: ConfigFieldDefinition[];
  customConfigUI?: boolean;
}

/**
 * Bot definitions - these should match the jobs app registry
 */
const botDefinitions: Record<string, BotDefinition> = {
  birthday: {
    id: "birthday",
    name: "Birthday Bot",
    description: "Celebrates member birthdays in group chat",
    icon: "🎂",
    triggerType: "cron",
    defaultConfig: {
      message: "🎂 Happy Birthday, [[birthday_names]]! 🎉",
      mode: "leader_reminder",
      assignmentMode: "round_robin",
    },
    configFields: [
      {
        key: "message",
        label: "Birthday Message",
        type: "textarea",
        placeholder: "🎂 Happy Birthday, [[birthday_names]]! 🎉",
        helpText:
          "Available placeholders: [[birthday_names]], [[leader_name]], [[group_name]], [[community_name]]",
      },
      {
        key: "mode",
        label: "Delivery Mode",
        type: "select",
        options: [
          { value: "general_chat", label: "Post to general chat" },
          { value: "leader_reminder", label: "Remind a leader" },
        ],
        helpText:
          "Choose whether to post directly or remind a leader to send personally",
      },
      {
        key: "targetChannelSlug",
        label: "Target Channel",
        type: "channel_select",
        helpText:
          "Select which channel the bot posts to. Leave empty to use the default based on delivery mode.",
      },
      {
        key: "assignmentMode",
        label: "Leader Assignment",
        type: "select",
        options: [
          { value: "round_robin", label: "Round robin" },
          { value: "specific_leader", label: "Specific leader" },
        ],
        helpText: "How to choose which leader receives the reminder",
        showWhen: { field: "mode", value: "leader_reminder" },
      },
      {
        key: "specificLeaderId",
        label: "Select Leader",
        type: "leader_select",
        helpText: "Choose which leader should receive birthday reminders",
        showWhen: { field: "assignmentMode", value: "specific_leader" },
      },
    ],
  },
  welcome: {
    id: "welcome",
    name: "Welcome Bot",
    description: "Welcomes new members to the group",
    icon: "👋",
    triggerType: "event",
    defaultConfig: {
      message: "Welcome to [[group_name]], [[first_name]]! 👋",
    },
    configFields: [
      {
        key: "message",
        label: "Welcome Message",
        type: "textarea",
        placeholder: "Welcome to [[group_name]], [[first_name]]!",
        helpText:
          "Available placeholders: [[first_name]], [[group_name]], [[community_name]]",
      },
      {
        key: "targetChannelSlug",
        label: "Target Channel",
        type: "channel_select",
        helpText:
          "Select which channel the bot posts to. Defaults to General if not set.",
      },
    ],
  },
  "task-reminder": {
    id: "task-reminder",
    name: "Task Reminder Bot",
    description: "Sends daily reminders to role-assigned members",
    icon: "📋",
    triggerType: "cron",
    customConfigUI: true,
    defaultConfig: {
      roles: [],
      schedule: {
        monday: [],
        tuesday: [],
        wednesday: [],
        thursday: [],
        friday: [],
        saturday: [],
        sunday: [],
      },
    },
    configFields: [
      {
        key: "targetChannelSlug",
        label: "Target Channel",
        type: "channel_select",
        helpText:
          "Select which channel the bot posts to. Defaults to Leaders if not set.",
      },
    ],
  },
  communication: {
    id: "communication",
    name: "Communication Bot",
    description: "Sends scheduled messages with PCO role mentions",
    icon: "💬",
    triggerType: "cron",
    customConfigUI: true, // Uses custom modal instead of configFields
    defaultConfig: {
      // New format: array of messages (supports multiple scheduled messages)
      messages: [],
    },
  },
};

// ============================================================================
// Bot Queries
// ============================================================================

/**
 * List all available bots
 */
export const listAvailable = query({
  args: {},
  handler: async (): Promise<Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    triggerType: "cron" | "event";
    configFields: ConfigFieldDefinition[] | undefined;
    hasConfig: boolean;
    customConfigUI: boolean;
  }>> => {
    return Object.values(botDefinitions).map((bot) => ({
      id: bot.id,
      name: bot.name,
      description: bot.description,
      icon: bot.icon,
      triggerType: bot.triggerType,
      configFields: bot.configFields,
      hasConfig: !!bot.configFields && bot.configFields.length > 0,
      customConfigUI: bot.customConfigUI ?? false,
    }));
  },
});

/**
 * List bots enabled for a group
 */
export const listForGroup = query({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args): Promise<Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    triggerType: "cron" | "event";
    enabled: boolean;
    configFields: ConfigFieldDefinition[] | undefined;
    hasConfig: boolean;
    customConfigUI: boolean;
  }>> => {
    // Get bot configs for this group
    const configs = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();

    // Merge with definitions
    return Object.values(botDefinitions).map((bot) => {
      const config = configs.find((c) => c.botType === bot.id);
      return {
        id: bot.id,
        name: bot.name,
        description: bot.description,
        icon: bot.icon,
        triggerType: bot.triggerType,
        enabled: config?.enabled ?? false,
        configFields: bot.configFields,
        hasConfig: !!bot.configFields && bot.configFields.length > 0,
        customConfigUI: bot.customConfigUI ?? false,
      };
    });
  },
});

/**
 * Get config for a specific bot
 */
export const getConfig = query({
  args: {
    groupId: v.id("groups"),
    botId: v.string(),
  },
  handler: async (ctx, args): Promise<{
    config: Record<string, unknown>;
    defaultConfig: Record<string, unknown>;
    configFields: ConfigFieldDefinition[];
    enabled: boolean;
  }> => {
    const bot = botDefinitions[args.botId];
    if (!bot) {
      throw new Error("Bot not found");
    }

    // Get the group's custom config
    const botConfig = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_group_botType", (q) =>
        q.eq("groupId", args.groupId).eq("botType", args.botId)
      )
      .first();

    // Merge default config with group's custom config
    const groupConfig = (botConfig?.config as Record<string, unknown>) || {};
    const mergedConfig = { ...(bot.defaultConfig || {}), ...groupConfig };

    return {
      config: mergedConfig,
      defaultConfig: bot.defaultConfig || {},
      configFields: bot.configFields || [],
      enabled: botConfig?.enabled ?? false,
    };
  },
});

// ============================================================================
// Bot Mutations
// ============================================================================

async function requireLeaderForGroup(
  ctx: { db: any },
  groupId: Id<"groups">,
  userId: Id<"users">
) {
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", groupId).eq("userId", userId)
    )
    .first();
  if (!isActiveMembership(membership) || !isLeaderRole(membership.role)) {
    throw new Error("Only group leaders can manage bot configuration");
  }
}

/**
 * Update config for a bot (leaders only)
 */
export const updateConfig = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    botId: v.string(),
    config: v.any(), // Flexible config object
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireLeaderForGroup(ctx, args.groupId, userId);
    const timestamp = now();

    const bot = botDefinitions[args.botId];
    if (!bot) {
      throw new Error("Bot not found");
    }

    // Check for existing config
    const existing = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_group_botType", (q) =>
        q.eq("groupId", args.groupId).eq("botType", args.botId)
      )
      .first();

    // For scheduled bots, calculate next scheduled time
    let nextScheduledAt: number | undefined;
    if (args.botId === "task-reminder" || args.botId === "birthday") {
      // Get community timezone
      const group = await ctx.db.get(args.groupId);
      if (!group) {
        throw new Error("Group not found");
      }
      const community = await ctx.db.get(group.communityId);
      const timezone = community?.timezone || "America/New_York";
      nextScheduledAt = calculateNext9AMInTimezone(timezone);
    } else if (args.botId === "communication") {
      // Communication bot: find earliest next scheduled time across all enabled messages
      const group = await ctx.db.get(args.groupId);
      if (!group) {
        throw new Error("Group not found");
      }
      const community = await ctx.db.get(group.communityId);
      const timezone = community?.timezone || "America/New_York";
      nextScheduledAt = calculateCommunicationBotNextSchedule(args.config, timezone);
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: args.config,
        updatedAt: timestamp,
        ...(nextScheduledAt && { nextScheduledAt }),
      });
    } else {
      await ctx.db.insert("groupBotConfigs", {
        groupId: args.groupId,
        botType: args.botId,
        enabled: true,
        config: args.config,
        state: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        nextScheduledAt,
      });
    }

    return { success: true };
  },
});

/**
 * Enable/disable a bot for a group (leaders only)
 */
export const toggle = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    botId: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireLeaderForGroup(ctx, args.groupId, userId);
    const timestamp = now();

    // Verify bot exists
    if (!botDefinitions[args.botId]) {
      throw new Error("Bot not found");
    }

    // Check for existing config
    const existing = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_group_botType", (q) =>
        q.eq("groupId", args.groupId).eq("botType", args.botId)
      )
      .first();

    // For scheduled bots, calculate next scheduled time when enabling
    let nextScheduledAt: number | undefined;
    if ((args.botId === "task-reminder" || args.botId === "birthday") && args.enabled) {
      const group = await ctx.db.get(args.groupId);
      if (!group) {
        throw new Error("Group not found");
      }
      const community = await ctx.db.get(group.communityId);
      const timezone = community?.timezone || "America/New_York";
      nextScheduledAt = calculateNext9AMInTimezone(timezone);
    } else if (args.botId === "communication" && args.enabled) {
      // Communication bot uses custom schedule
      const group = await ctx.db.get(args.groupId);
      if (!group) {
        throw new Error("Group not found");
      }
      const community = await ctx.db.get(group.communityId);
      const timezone = community?.timezone || "America/New_York";
      // Use existing schedule from config if available, otherwise use default
      const existingConfig = existing?.config as { schedule?: { dayOfWeek: number; hour: number; minute: number } } | undefined;
      const schedule = existingConfig?.schedule || { dayOfWeek: 6, hour: 9, minute: 0 };
      nextScheduledAt = calculateNextScheduledTimeForDayOfWeek(schedule, timezone);
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        updatedAt: timestamp,
        ...(nextScheduledAt && { nextScheduledAt }),
      });
    } else {
      const bot = botDefinitions[args.botId];
      await ctx.db.insert("groupBotConfigs", {
        groupId: args.groupId,
        botType: args.botId,
        enabled: args.enabled,
        config: bot.defaultConfig || {},
        state: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        nextScheduledAt,
      });
    }

    return { success: true };
  },
});

/**
 * Reset bot config to defaults
 */
export const resetConfig = mutation({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    botId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireLeaderForGroup(ctx, args.groupId, userId);
    const timestamp = now();

    const bot = botDefinitions[args.botId];
    if (!bot) {
      throw new Error("Bot not found");
    }

    const existing = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_group_botType", (q) =>
        q.eq("groupId", args.groupId).eq("botType", args.botId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        config: bot.defaultConfig || {},
        updatedAt: timestamp,
      });
    }

    return { success: true };
  },
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate the next 9 AM in a given timezone
 * Returns Unix timestamp in milliseconds
 */
function calculateNext9AMInTimezone(timezone: string): number {
  const now = new Date();

  // Create formatters for the timezone
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Get current hour in the timezone
  const currentHour = parseInt(hourFormatter.format(now), 10);

  // Calculate days to add
  let daysToAdd = 0;
  if (currentHour >= 9) {
    daysToAdd = 1; // Already past 9 AM, schedule for tomorrow
  }

  // Create the target date
  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + daysToAdd);

  // Get the date components in the target timezone
  const parts = dateFormatter.formatToParts(targetDate);
  const year = parseInt(parts.find((p) => p.type === "year")?.value || "2024");
  const month = parseInt(
    parts.find((p) => p.type === "month")?.value || "1"
  );
  const day = parseInt(parts.find((p) => p.type === "day")?.value || "1");

  // Build an ISO-like string for 9 AM in the target timezone
  // Format: YYYY-MM-DDTHH:mm:ss
  const dateStr = `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T09:00:00`;

  // Use Intl to get the timezone offset at 9 AM on that date
  // Create a reference date in UTC to calculate the offset
  const refDate = new Date(`${dateStr}Z`); // Parse as UTC first

  // Get the formatted time in the target timezone
  const tzFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });

  // Binary search for the correct UTC time that equals 9 AM in target timezone
  // Start with an estimate based on common timezone offsets
  let low = refDate.getTime() - 14 * 60 * 60 * 1000; // UTC-14
  let high = refDate.getTime() + 14 * 60 * 60 * 1000; // UTC+14

  // More efficient: calculate offset directly
  // Create a date at midnight UTC and check the hour in the target timezone
  const testDate = new Date(`${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T00:00:00Z`);
  const hourAtMidnightUTC = parseInt(tzFormatter.format(testDate), 10);

  // The offset in hours (positive means timezone is ahead of UTC)
  // If midnight UTC = 19:00 in timezone, then timezone is UTC-5 (offset = -5)
  // offset = hourAtMidnightUTC (if < 12) or hourAtMidnightUTC - 24 (if >= 12)
  let offsetHours = hourAtMidnightUTC;
  if (offsetHours > 12) {
    offsetHours = offsetHours - 24;
  }

  // 9 AM in timezone = (9 - offset) in UTC
  // e.g., 9 AM in UTC-5 = 9 - (-5) = 14:00 UTC
  const utcHour = 9 - offsetHours;

  // Create the final UTC timestamp
  const result = new Date(
    Date.UTC(year, month - 1, day, utcHour, 0, 0, 0)
  );

  return result.getTime();
}

// calculateNextScheduledTimeForDayOfWeek is now imported from ../lib/scheduling

// ============================================================================
// Developer Tools - Test Functions
// ============================================================================

/**
 * Send a test task reminder message.
 * Used by the developer tools to test the task reminder bot flow.
 */
export const testTaskReminder = action({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    mentionUserId: v.id("users"),
    message: v.string(),
    // Keep chatType for backwards compat, but prefer targetChannelSlug
    chatType: v.optional(v.union(v.literal("main"), v.literal("leaders"))),
    targetChannelSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { success: true; channelId: string; messageId: string }
    | { success: false; error: string }
  > => {
    // Verify auth - throws if invalid
    const userId = await requireAuthFromToken(args.token);

    // Verify user is a leader/admin of this group
    const membership = await ctx.runQuery(
      internal.functions.groups.internal.getMembershipInternal,
      { groupId: args.groupId, userId: userId as Id<"users"> }
    );
    if (!membership || membership.leftAt) {
      throw new Error("You must be a member of this group");
    }
    if (membership.role !== "leader" && membership.role !== "admin") {
      throw new Error("Only group leaders can use this test function");
    }

    // Get the mentioned user's name for the mention format
    const mentionedUser = await ctx.runQuery(
      internal.functions.scheduledJobs.getUserById,
      { userId: args.mentionUserId }
    );
    if (!mentionedUser) {
      throw new Error("Mentioned user not found");
    }

    const displayName: string = [mentionedUser.firstName, mentionedUser.lastName]
      .filter(Boolean)
      .join(" ");
    const mentionName: string = displayName || "Member";

    // Build the message with @[Name] mention
    const fullMessage: string = `📋 **Task Reminder (Test)**\n\nHey @[${mentionName}], you have a task:\n\n${args.message}`;

    // Determine target channel with backwards compatibility
    // Priority: 1) targetChannelSlug, 2) chatType mapped to slug, 3) default to leaders
    let targetSlug: string;
    if (args.targetChannelSlug) {
      targetSlug = args.targetChannelSlug;
    } else if (args.chatType) {
      targetSlug = args.chatType === "main" ? "general" : args.chatType;
    } else {
      targetSlug = "leaders";
    }

    // Send the bot message with mention
    const result = await ctx.runAction(
      internal.functions.scheduledJobs.sendBotMessage,
      {
        groupId: args.groupId,
        message: fullMessage,
        targetChannelSlug: targetSlug,
        botType: "task_reminder",
        mentionedUserIds: [args.mentionUserId],
      }
    );

    // Convert Convex IDs to strings for the return type
    if (result.success) {
      return {
        success: true,
        channelId: result.channelId as string,
        messageId: result.messageId as string,
      };
    }
    return result;
  },
});

/**
 * Send a communication bot message immediately (bypassing the cron schedule).
 * Used by leaders to manually trigger a scheduled message.
 */
export const sendCommunicationNow = action({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    message: v.string(),
    targetChannelSlug: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<
    | { success: true; channelId: string; messageId: string }
    | { success: false; error: string }
  > => {
    // Verify auth
    const userId = await requireAuthFromToken(args.token);

    // Verify user is a leader/admin of this group
    const membership = await ctx.runQuery(
      internal.functions.groups.internal.getMembershipInternal,
      { groupId: args.groupId, userId: userId as Id<"users"> }
    );
    if (!membership || membership.leftAt) {
      throw new Error("You must be a member of this group");
    }
    if (membership.role !== "leader" && membership.role !== "admin") {
      throw new Error("Only group leaders can send communication messages");
    }

    // Get the group to find communityId for placeholder resolution
    const group = await ctx.runQuery(
      internal.functions.scheduledJobs.getGroupById,
      { groupId: args.groupId }
    );
    if (!group) {
      throw new Error("Group not found");
    }

    // Resolve PCO position placeholders
    let resolvedMessage = args.message;
    try {
      resolvedMessage = await ctx.runAction(
        internal.functions.pcoServices.actions.resolvePositionPlaceholdersInternal,
        { communityId: group.communityId, message: args.message }
      );
    } catch (error) {
      console.warn(
        `[CommunicationBot] Failed to resolve placeholders for send-now:`,
        error
      );
    }

    // Send the bot message
    const result = await ctx.runAction(
      internal.functions.scheduledJobs.sendBotMessage,
      {
        groupId: args.groupId,
        message: resolvedMessage,
        targetChannelSlug: args.targetChannelSlug,
        botType: "communication",
      }
    );

    if (result.success) {
      return {
        success: true,
        channelId: result.channelId as string,
        messageId: result.messageId as string,
      };
    }
    return result;
  },
});

