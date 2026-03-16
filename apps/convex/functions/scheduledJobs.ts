/**
 * Scheduled Jobs
 *
 * Internal functions for scheduled tasks that run via crons or ctx.scheduler.
 * These replace Trigger.dev jobs.
 *
 * Job Types:
 * - Cron jobs: Run on a schedule (birthday bot, task reminder check)
 * - Scheduled jobs: Run at a specific time (meeting reminders, attendance confirmations)
 * - Event-triggered jobs: Run immediately when triggered (event updates, welcome bot)
 *
 * Architecture:
 * - internalQuery: Read data from DB (called by actions)
 * - internalMutation: Write to DB (mark sent, update state)
 * - internalAction: External API calls (Expo push, Resend email)
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { notifyBatch } from "../lib/notifications/send";
import { now, getMediaUrlWithTransform, ImagePresets } from "../lib/utils";
import {
  calculateCommunicationBotNextSchedule,
  isScheduleDueNow,
} from "../lib/scheduling";
import { DOMAIN_CONFIG } from "@togather/shared/config";

// ============================================================================
// CONFIGURATION
// ============================================================================

const APP_URL = process.env.APP_URL || DOMAIN_CONFIG.appUrl;
const BRAND_NAME = DOMAIN_CONFIG.brandName;
const DEFAULT_INITIALS_AVATAR_BG = "007AFF";

function getInitials(name: string | undefined | null): string {
  if (!name) return "G";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "G";
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getInitialsAvatarUrl(
  groupName: string | undefined,
  hexColor: string | undefined,
): string {
  const normalizedColor =
    hexColor && /^#?[0-9A-Fa-f]{6}$/.test(hexColor)
      ? hexColor.replace("#", "")
      : DEFAULT_INITIALS_AVATAR_BG;
  const initials = getInitials(groupName);
  return `https://ui-avatars.com/api/?background=${normalizedColor}&color=fff&name=${encodeURIComponent(initials)}&size=128&format=png`;
}

type BirthdayReminderLeader = {
  userId: Id<"users">;
  displayName: string;
};

function resolveBirthdayReminderLeader(params: {
  leaders: BirthdayReminderLeader[];
  assignmentMode?: string;
  specificLeaderId?: Id<"users">;
  lastLeaderIndex?: number;
}): BirthdayReminderLeader | null {
  const { leaders, assignmentMode, specificLeaderId, lastLeaderIndex } = params;
  if (leaders.length === 0) return null;

  if (assignmentMode === "specific_leader" && specificLeaderId) {
    const specificLeader = leaders.find(
      (leader) => leader.userId === specificLeaderId,
    );
    if (specificLeader) {
      return specificLeader;
    }
  }

  const nextIndex = ((lastLeaderIndex ?? -1) + 1) % leaders.length;
  return leaders[nextIndex];
}

// ============================================================================
// BIRTHDAY BOT
// ============================================================================

/**
 * Run birthday bot for all enabled groups.
 * Called daily at 9 AM UTC by cron.
 */
export const runBirthdayBot = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get all groups with birthday bot enabled
    const configs = await ctx.runQuery(
      internal.functions.scheduledJobs.getBirthdayBotConfigs,
    );

    const results: Array<{
      groupId: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const config of configs) {
      try {
        const leaders = await ctx.runQuery(
          internal.functions.scheduledJobs.getBirthdayBotLeaders,
          { groupId: config.groupId },
        );

        // Get members with birthdays today
        const birthdays = await ctx.runQuery(
          internal.functions.scheduledJobs.getMembersWithBirthdayToday,
          { groupId: config.groupId },
        );

        if (birthdays.length === 0) {
          results.push({ groupId: config.groupId, success: true });
          continue;
        }

        const birthdayNames = birthdays
          .map((m: { firstName?: string }) => m.firstName || "a member")
          .join(", ");

        const targetLeader =
          config.mode === "leader_reminder"
            ? resolveBirthdayReminderLeader({
                leaders,
                assignmentMode: config.assignmentMode,
                specificLeaderId: config.specificLeaderId,
                lastLeaderIndex: config.lastLeaderIndex,
              })
            : null;
        const leaderName = targetLeader?.displayName || "leader";

        // Build message with placeholder replacement
        const message = config.message
          .replace("[[birthday_names]]", birthdayNames)
          .replace("[[leader_name]]", leaderName)
          .replace("[[group_name]]", config.groupName)
          .replace("[[community_name]]", config.communityName);

        // Determine target channel with backwards compatibility
        // Priority: 1) configured targetChannelSlug, 2) mode-based default
        const defaultSlug =
          config.mode === "general_chat" ? "general" : "leaders";
        const targetChannelSlug = config.targetChannelSlug || defaultSlug;

        const finalMessage =
          config.mode === "leader_reminder"
            ? `**Birthday Reminder**\n\n${message}`
            : message;

        await ctx.runAction(internal.functions.scheduledJobs.sendBotMessage, {
          groupId: config.groupId,
          message: finalMessage,
          targetChannelSlug,
          botType: "birthday",
        });

        // Update state for round-robin
        if (
          config.mode === "leader_reminder" &&
          config.assignmentMode !== "specific_leader"
        ) {
          const leaderPoolSize = leaders.length || config.leaderCount || 1;
          await ctx.runMutation(
            internal.functions.scheduledJobs.updateBotState,
            {
              configId: config.configId,
              stateUpdates: {
                lastLeaderIndex:
                  ((config.lastLeaderIndex ?? -1) + 1) % leaderPoolSize,
              },
            },
          );
        }

        results.push({ groupId: config.groupId, success: true });
      } catch (error) {
        console.error(
          `[BirthdayBot] Error for group ${config.groupId}:`,
          error,
        );
        results.push({
          groupId: config.groupId,
          success: false,
          error: String(error),
        });
      }
    }

    return { processed: results.length, results };
  },
});

/**
 * Process birthday bot for all groups due in the current hour.
 * Called hourly by cron.
 */
export const processBirthdayBotBucket = internalAction({
  args: {},
  handler: async (ctx) => {
    const currentTime = now();
    const hourStart =
      Math.floor(currentTime / (60 * 60 * 1000)) * 60 * 60 * 1000;
    const hourEnd = hourStart + 60 * 60 * 1000;

    const configs = await ctx.runQuery(
      internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      { windowStart: hourStart, windowEnd: hourEnd },
    );

    const results: Array<{
      groupId: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const config of configs) {
      try {
        const leaders = await ctx.runQuery(
          internal.functions.scheduledJobs.getBirthdayBotLeaders,
          { groupId: config.groupId },
        );

        // Get members with birthdays today IN THE COMMUNITY'S TIMEZONE
        const birthdays = await ctx.runQuery(
          internal.functions.scheduledJobs.getMembersWithBirthdayToday,
          { groupId: config.groupId, timezone: config.timezone },
        );

        if (birthdays.length > 0) {
          const birthdayNames = birthdays
            .map((m: { firstName?: string }) => m.firstName || "a member")
            .join(", ");

          const targetLeader =
            config.mode === "leader_reminder"
              ? resolveBirthdayReminderLeader({
                  leaders,
                  assignmentMode: config.assignmentMode,
                  specificLeaderId: config.specificLeaderId,
                  lastLeaderIndex: config.lastLeaderIndex,
                })
              : null;
          const leaderName = targetLeader?.displayName || "leader";

          const message = config.message
            .replace("[[birthday_names]]", birthdayNames)
            .replace("[[leader_name]]", leaderName)
            .replace("[[group_name]]", config.groupName)
            .replace("[[community_name]]", config.communityName);

          // Determine target channel with backwards compatibility
          // Priority: 1) configured targetChannelSlug, 2) mode-based default
          const defaultSlug =
            config.mode === "general_chat" ? "general" : "leaders";
          const targetChannelSlug = config.targetChannelSlug || defaultSlug;

          const finalMessage =
            config.mode === "leader_reminder"
              ? `**Birthday Reminder**\n\n${message}`
              : message;

          await ctx.runAction(internal.functions.scheduledJobs.sendBotMessage, {
            groupId: config.groupId,
            message: finalMessage,
            targetChannelSlug,
            botType: "birthday",
          });

          if (
            config.mode === "leader_reminder" &&
            config.assignmentMode !== "specific_leader"
          ) {
            const leaderPoolSize = leaders.length || config.leaderCount || 1;
            await ctx.runMutation(
              internal.functions.scheduledJobs.updateBotState,
              {
                configId: config.configId,
                stateUpdates: {
                  lastLeaderIndex:
                    ((config.lastLeaderIndex ?? -1) + 1) % leaderPoolSize,
                },
              },
            );
          }
        }

        results.push({ groupId: config.groupId, success: true });
      } catch (error) {
        console.error(
          `[BirthdayBot] Error for group ${config.groupId}:`,
          error,
        );
        results.push({
          groupId: config.groupId,
          success: false,
          error: String(error),
        });
      }

      // Reschedule for next 9 AM in community timezone
      await ctx.runMutation(
        internal.functions.scheduledJobs.rescheduleBirthdayBot,
        { configId: config.configId },
      );
    }

    return { processed: results.length, results };
  },
});

/**
 * Get all birthday bot configs.
 */
export const getBirthdayBotConfigs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const configs = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_botType_enabled", (q) =>
        q.eq("botType", "birthday").eq("enabled", true),
      )
      .take(100); // Safety limit

    // Batch fetch all groups upfront
    const groupIds = configs.map((c) => c.groupId);
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));

    // Build groupId -> group map for O(1) lookup
    const groupMap = new Map<string, (typeof groups)[0]>();
    groups.forEach((group, i) => {
      if (group) {
        groupMap.set(groupIds[i], group);
      }
    });

    // Collect unique community IDs from valid groups
    const communityIdSet = new Set<Id<"communities">>();
    for (const group of groups) {
      if (group) {
        communityIdSet.add(group.communityId);
      }
    }
    const communityIds = Array.from(communityIdSet);

    // Batch fetch all communities upfront
    const communities = await Promise.all(
      communityIds.map((id) => ctx.db.get(id)),
    );

    // Build communityId -> community map for O(1) lookup
    type CommunityDoc = NonNullable<(typeof communities)[0]>;
    const communityMap = new Map<string, CommunityDoc>();
    communities.forEach((community, i) => {
      if (community) {
        communityMap.set(communityIds[i], community);
      }
    });

    // Batch fetch leaders for all groups
    // Get all group members for the groups in one query per group (unavoidable due to index structure)
    // But we can parallelize the queries
    const leadersPerGroup = await Promise.all(
      groupIds.map(async (groupId) => {
        const leaders = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", groupId))
          .filter((q) =>
            q.and(
              q.eq(q.field("leftAt"), undefined),
              q.eq(q.field("role"), "leader"),
            ),
          )
          .take(100); // Safety limit per group
        return { groupId, count: leaders.length };
      }),
    );

    // Build groupId -> leader count map
    const leaderCountMap = new Map<string, number>();
    for (const { groupId, count } of leadersPerGroup) {
      leaderCountMap.set(groupId, count);
    }

    const results = [];

    for (const config of configs) {
      const group = groupMap.get(config.groupId);
      if (!group) continue;

      const community = communityMap.get(group.communityId);
      if (!community) continue;

      const configData = (config.config as Record<string, unknown>) || {};
      const stateData = (config.state as Record<string, unknown>) || {};

      results.push({
        configId: config._id,
        groupId: config.groupId,
        groupName: group.name,
        communityName: community.name || "Community",
        mode: (configData.mode as string) || "leader_reminder",
        assignmentMode: (configData.assignmentMode as string) || "round_robin",
        specificLeaderId: configData.specificLeaderId as
          | Id<"users">
          | undefined,
        message:
          (configData.message as string) ||
          "🎂 Hey [[leader_name]], it's your turn to wish [[birthday_names]] a happy birthday in General chat! 🎉",
        lastLeaderIndex: (stateData.lastLeaderIndex as number) ?? -1,
        leaderCount: leaderCountMap.get(config.groupId) || 1,
        targetChannelSlug:
          (configData.targetChannelSlug as string) || undefined,
      });
    }

    return results;
  },
});

/**
 * Get birthday bot configs that are due in the current hour window.
 * Used by the hourly bucket processor.
 */
export const getDueBirthdayBotConfigs = internalQuery({
  args: {
    windowStart: v.number(),
    windowEnd: v.number(),
  },
  handler: async (ctx, { windowStart, windowEnd }) => {
    const configs = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_botType_enabled_scheduled", (q) =>
        q.eq("botType", "birthday").eq("enabled", true),
      )
      .filter((q) =>
        q.and(
          q.gte(q.field("nextScheduledAt"), windowStart),
          q.lt(q.field("nextScheduledAt"), windowEnd),
        ),
      )
      .collect();

    // Enrich with group/community data (same pattern as getBirthdayBotConfigs)
    const results = [];
    for (const config of configs) {
      const group = await ctx.db.get(config.groupId);
      if (!group) continue;

      const community = await ctx.db.get(group.communityId);
      if (!community) continue;

      // Count leader memberships (same logic as getBirthdayBotConfigs)
      const leaderMemberships = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", config.groupId))
        .filter((q) =>
          q.and(
            q.eq(q.field("leftAt"), undefined),
            q.eq(q.field("role"), "leader"),
          ),
        )
        .take(100);
      const leaderCount = leaderMemberships.length || 1;

      const configData = (config.config as Record<string, unknown>) || {};
      const stateData = (config.state as Record<string, unknown>) || {};

      results.push({
        configId: config._id,
        groupId: config.groupId,
        groupName: group.name,
        communityName: community.name || "Community",
        timezone: community.timezone || "America/New_York",
        mode: (configData.mode as string) || "leader_reminder",
        assignmentMode: (configData.assignmentMode as string) || "round_robin",
        specificLeaderId: configData.specificLeaderId as
          | Id<"users">
          | undefined,
        message:
          (configData.message as string) ||
          "🎂 Hey [[leader_name]], it's your turn to wish [[birthday_names]] a happy birthday in General chat! 🎉",
        lastLeaderIndex: (stateData.lastLeaderIndex as number) ?? -1,
        leaderCount,
        targetChannelSlug:
          (configData.targetChannelSlug as string) || undefined,
      });
    }

    return results;
  },
});

export const getBirthdayBotLeaders = internalQuery({
  args: {
    groupId: v.id("groups"),
  },
  handler: async (ctx, { groupId }) => {
    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) =>
        q.and(
          q.eq(q.field("leftAt"), undefined),
          q.eq(q.field("role"), "leader"),
        ),
      )
      .take(100);

    const userIds = memberships.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map(
      users
        .filter((u): u is NonNullable<typeof u> => u !== null)
        .map((u) => [u._id, u]),
    );

    return memberships
      .map((membership) => {
        const user = userMap.get(membership.userId);
        if (!user) return null;

        const displayName =
          [user.firstName, user.lastName].filter(Boolean).join(" ") || "leader";

        return {
          userId: membership.userId,
          displayName,
        };
      })
      .filter((leader): leader is BirthdayReminderLeader => leader !== null);
  },
});

/**
 * Get members with birthdays today.
 */
export const getMembersWithBirthdayToday = internalQuery({
  args: {
    groupId: v.id("groups"),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, { groupId, timezone }) => {
    // Use timezone to determine "today" (default to UTC for backwards compat)
    const tz = timezone || "UTC";
    const today = new Date();

    let todayMonth: number;
    let todayDate: number;

    if (tz === "UTC") {
      todayMonth = today.getUTCMonth();
      todayDate = today.getUTCDate();
    } else {
      // Get current date in the community's timezone
      const dateFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        month: "numeric",
        day: "numeric",
      });
      const parts = dateFormatter.formatToParts(today);
      todayMonth =
        parseInt(parts.find((p) => p.type === "month")?.value || "1", 10) - 1;
      todayDate = parseInt(
        parts.find((p) => p.type === "day")?.value || "1",
        10,
      );
    }

    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .take(500); // Safety limit

    // Batch fetch all users upfront
    const userIds = members.map((m) => m.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    // Build userId -> user map for O(1) lookup
    const userMap = new Map<string, (typeof users)[0]>();
    users.forEach((user, i) => {
      if (user) {
        userMap.set(userIds[i], user);
      }
    });

    const birthdayMembers = [];

    for (const member of members) {
      const user = userMap.get(member.userId);
      if (!user?.dateOfBirth) continue;

      const birthday = new Date(user.dateOfBirth);
      if (
        birthday.getUTCMonth() === todayMonth &&
        birthday.getUTCDate() === todayDate
      ) {
        birthdayMembers.push({
          userId: member.userId,
          firstName: user.firstName,
        });
      }
    }

    return birthdayMembers;
  },
});

// ============================================================================
// MEETING REMINDERS
// ============================================================================

// Type for RSVP query result
interface RsvpRecord {
  _id: Id<"meetingRsvps">;
  meetingId: Id<"meetings">;
  userId: Id<"users">;
  rsvpOptionId: number;
}

/**
 * Send a meeting reminder notification.
 * Called by ctx.scheduler.runAt() when meeting is created, or by fallback cron.
 */
export const sendMeetingReminder = internalAction({
  args: { meetingId: v.id("meetings") },
  handler: async (
    ctx,
    { meetingId },
  ): Promise<{
    skipped?: boolean;
    reason?: string;
    sent?: number;
    totalRsvps?: number;
  }> => {
    const meeting = await ctx.runQuery(
      internal.functions.scheduledJobs.getMeetingForNotification,
      { meetingId },
    );

    if (!meeting) {
      return { skipped: true, reason: "meeting_not_found" };
    }

    if (meeting.reminderSent || meeting.status === "cancelled") {
      return { skipped: true, reason: "already_sent_or_cancelled" };
    }

    // Get users who RSVPed "Going"
    const goingRsvps: RsvpRecord[] = await ctx.runQuery(
      internal.functions.scheduledJobs.getRsvpsByOption,
      { meetingId, rsvpOptionId: 1 },
    );

    if (goingRsvps.length === 0) {
      // Mark as sent even if no RSVPs to avoid re-processing
      await ctx.runMutation(
        internal.functions.scheduledJobs.markMeetingReminderSent,
        { meetingId },
      );
      return { skipped: true, reason: "no_going_rsvps" };
    }

    // Get push tokens for all users
    const userIds: Id<"users">[] = goingRsvps.map((r) => r.userId);
    const pushTokens: string[] = await ctx.runQuery(
      internal.functions.scheduledJobs.getActivePushTokensForUsers,
      { userIds },
    );

    // Format meeting time in the community's timezone using native Intl API
    const meetingTime = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: meeting.timezone,
    }).format(new Date(meeting.scheduledAt));

    // Send push notifications
    let sentCount = 0;
    if (pushTokens.length > 0) {
      const result = await sendExpoPushNotifications(pushTokens, {
        title: "Meeting Reminder",
        body: `${meeting.title || "Meeting"} at ${meetingTime}`,
        data: {
          type: "meeting_reminder",
          meetingId,
          groupId: meeting.groupId,
          groupAvatarUrl: meeting.groupAvatarUrl,
          shortId: meeting.shortId,
          route: `/e/${meeting.shortId}`,
        },
        imageUrl: meeting.groupAvatarUrl,
      });
      sentCount = result.sent;
    }

    // Mark reminder as sent
    await ctx.runMutation(
      internal.functions.scheduledJobs.markMeetingReminderSent,
      { meetingId },
    );

    return { sent: sentCount, totalRsvps: goingRsvps.length };
  },
});

/**
 * Fallback cron to process any meeting reminders that weren't scheduled.
 * Runs every 15 minutes to catch migrated data or missed schedules.
 */
export const processMeetingReminderFallback = internalAction({
  args: {},
  handler: async (ctx) => {
    const currentTime = now();
    // Look for reminders due in the past 20 minutes (with buffer)
    const windowStart = currentTime - 20 * 60 * 1000;

    const meetings = await ctx.runQuery(
      internal.functions.scheduledJobs.getMeetingsWithDueReminders,
      { windowStart, windowEnd: currentTime },
    );

    let processed = 0;
    for (const meeting of meetings) {
      try {
        await ctx.runAction(
          internal.functions.scheduledJobs.sendMeetingReminder,
          { meetingId: meeting._id },
        );
        processed++;
      } catch (error) {
        console.error(
          `[MeetingReminderFallback] Error for meeting ${meeting._id}:`,
          error,
        );
      }
    }

    return { processed };
  },
});

export const getMeetingsWithDueReminders = internalQuery({
  args: { windowStart: v.number(), windowEnd: v.number() },
  handler: async (ctx, { windowStart, windowEnd }) => {
    // Get meetings with reminderAt in the window that haven't been sent
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_reminderAt_sent")
      .filter((q) =>
        q.and(
          q.gte(q.field("reminderAt"), windowStart),
          q.lte(q.field("reminderAt"), windowEnd),
          q.eq(q.field("reminderSent"), false),
          q.neq(q.field("status"), "cancelled"),
        ),
      )
      .collect();

    return meetings;
  },
});

// ============================================================================
// ATTENDANCE CONFIRMATIONS
// ============================================================================

/**
 * Send attendance confirmation requests.
 * Called by ctx.scheduler.runAt() when meeting ends, or by fallback cron.
 */
export const sendAttendanceConfirmation = internalAction({
  args: { meetingId: v.id("meetings") },
  handler: async (
    ctx,
    { meetingId },
  ): Promise<{
    skipped?: boolean;
    reason?: string;
    pushSent?: number;
    emailSent?: number;
    totalRsvps?: number;
  }> => {
    const meeting = await ctx.runQuery(
      internal.functions.scheduledJobs.getMeetingForNotification,
      { meetingId },
    );

    if (!meeting) {
      return { skipped: true, reason: "meeting_not_found" };
    }

    if (meeting.attendanceConfirmationSent || meeting.status === "cancelled") {
      return { skipped: true, reason: "already_sent_or_cancelled" };
    }

    // Get users who RSVPed "Going" or "Maybe" (option IDs 1 and 2)
    const rsvps: RsvpRecord[] = await ctx.runQuery(
      internal.functions.scheduledJobs.getRsvpsByOptions,
      { meetingId, rsvpOptionIds: [1, 2] },
    );

    if (rsvps.length === 0) {
      await ctx.runMutation(
        internal.functions.scheduledJobs.markAttendanceConfirmationSent,
        { meetingId },
      );
      return { skipped: true, reason: "no_rsvps" };
    }

    let pushSent = 0;
    let emailSent = 0;

    for (const rsvp of rsvps) {
      const user = await ctx.runQuery(
        internal.functions.scheduledJobs.getUserForNotification,
        { userId: rsvp.userId },
      );

      if (!user) continue;

      // Generate confirmation token
      const token: string = await ctx.runMutation(
        internal.functions.scheduledJobs.createAttendanceConfirmationToken,
        { userId: rsvp.userId, meetingId },
      );

      const confirmUrl = `${APP_URL}/e/${meeting.shortId}?token=${token}&confirmAttendance=true`;

      // Send push notification (use optional chaining for defensive safety)
      if (user?.pushNotificationsEnabled !== false) {
        const pushTokens: string[] = await ctx.runQuery(
          internal.functions.scheduledJobs.getActivePushTokensForUsers,
          { userIds: [rsvp.userId] },
        );

        if (pushTokens.length > 0) {
          const result = await sendExpoPushNotifications(pushTokens, {
            title: "Did you attend?",
            body: `Let us know if you made it to ${meeting.title || "the meeting"}`,
            data: {
              type: "attendance_confirmation",
              meetingId,
              groupId: meeting.groupId,
              groupAvatarUrl: meeting.groupAvatarUrl,
              shortId: meeting.shortId,
              route: `/e/${meeting.shortId}?confirmAttendance=true`,
            },
            imageUrl: meeting.groupAvatarUrl,
          });
          pushSent += result.sent;
        }
      }

      // Send email
      if (user.email && user.emailNotificationsEnabled !== false) {
        try {
          await sendAttendanceConfirmationEmail({
            to: user.email,
            firstName: user.firstName || "there",
            eventTitle: meeting.title || "Event",
            groupName: meeting.groupName,
            eventDate: formatEventDate(meeting.scheduledAt),
            confirmUrl,
          });
          emailSent++;
        } catch (error) {
          console.error(
            `[AttendanceConfirmation] Email error for user ${rsvp.userId}:`,
            error,
          );
        }
      }
    }

    // Mark as sent
    await ctx.runMutation(
      internal.functions.scheduledJobs.markAttendanceConfirmationSent,
      { meetingId },
    );

    return { pushSent, emailSent, totalRsvps: rsvps.length };
  },
});

/**
 * Fallback cron to process any attendance confirmations that weren't scheduled.
 */
export const processAttendanceConfirmationFallback = internalAction({
  args: {},
  handler: async (ctx) => {
    const currentTime = now();
    const windowStart = currentTime - 20 * 60 * 1000;

    const meetings = await ctx.runQuery(
      internal.functions.scheduledJobs.getMeetingsWithDueAttendanceConfirmation,
      { windowStart, windowEnd: currentTime },
    );

    let processed = 0;
    for (const meeting of meetings) {
      try {
        await ctx.runAction(
          internal.functions.scheduledJobs.sendAttendanceConfirmation,
          { meetingId: meeting._id },
        );
        processed++;
      } catch (error) {
        console.error(
          `[AttendanceConfirmationFallback] Error for meeting ${meeting._id}:`,
          error,
        );
      }
    }

    return { processed };
  },
});

export const getMeetingsWithDueAttendanceConfirmation = internalQuery({
  args: { windowStart: v.number(), windowEnd: v.number() },
  handler: async (ctx, { windowStart, windowEnd }) => {
    const meetings = await ctx.db
      .query("meetings")
      .withIndex("by_attendanceConfirmation")
      .filter((q) =>
        q.and(
          q.gte(q.field("attendanceConfirmationAt"), windowStart),
          q.lte(q.field("attendanceConfirmationAt"), windowEnd),
          q.eq(q.field("attendanceConfirmationSent"), false),
          q.neq(q.field("status"), "cancelled"),
        ),
      )
      .collect();

    return meetings;
  },
});

// ============================================================================
// EVENT UPDATE NOTIFICATIONS
// ============================================================================

/**
 * Send notifications when an event is updated.
 * Called immediately via ctx.scheduler.runAfter(0, ...) from meeting update mutation.
 */
export const sendEventUpdateNotification = internalAction({
  args: {
    meetingId: v.id("meetings"),
    changes: v.array(v.string()),
    newTime: v.optional(v.string()),
    newLocation: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { meetingId, changes, newTime, newLocation },
  ): Promise<{
    error?: string;
    skipped?: boolean;
    reason?: string;
    sent?: number;
    totalRsvps?: number;
  }> => {
    const meeting = await ctx.runQuery(
      internal.functions.scheduledJobs.getMeetingForNotification,
      { meetingId },
    );

    if (!meeting) {
      return { error: "meeting_not_found" };
    }

    // Get users who RSVPed "Going"
    const goingRsvps: RsvpRecord[] = await ctx.runQuery(
      internal.functions.scheduledJobs.getRsvpsByOption,
      { meetingId, rsvpOptionId: 1 },
    );

    if (goingRsvps.length === 0) {
      return { skipped: true, reason: "no_going_rsvps" };
    }

    const userIds: Id<"users">[] = goingRsvps.map((r) => r.userId);
    const pushTokens: string[] = await ctx.runQuery(
      internal.functions.scheduledJobs.getActivePushTokensForUsers,
      { userIds },
    );

    const changeText = changes.join(", ");

    let sentCount = 0;
    if (pushTokens.length > 0) {
      const result = await sendExpoPushNotifications(pushTokens, {
        title: `${meeting.title || "Event"} Updated`,
        body: `Changes: ${changeText}`,
        data: {
          type: "event_updated",
          meetingId,
          groupId: meeting.groupId,
          groupAvatarUrl: meeting.groupAvatarUrl,
          shortId: meeting.shortId,
          changes,
          newTime,
          newLocation,
          route: `/e/${meeting.shortId}`,
        },
        imageUrl: meeting.groupAvatarUrl,
      });
      sentCount = result.sent;
    }

    return { sent: sentCount, totalRsvps: goingRsvps.length };
  },
});

// ============================================================================
// TASK REMINDER
// ============================================================================

/**
 * Process task reminder bucket for groups with due reminders.
 * Called hourly by cron to check for groups with nextScheduledAt in the current hour.
 */
export const processTaskReminderBucket = internalAction({
  args: {},
  handler: async (ctx) => {
    const currentTime = now();
    // Round to start of current hour
    const hourStart =
      Math.floor(currentTime / (60 * 60 * 1000)) * 60 * 60 * 1000;
    const hourEnd = hourStart + 60 * 60 * 1000;

    const configs = await ctx.runQuery(
      internal.functions.scheduledJobs.getDueTaskReminderConfigs,
      { windowStart: hourStart, windowEnd: hourEnd },
    );

    let processed = 0;

    for (const config of configs) {
      try {
        // Run the task reminder bot logic
        await ctx.runAction(
          internal.functions.scheduledJobs.runTaskReminderBot,
          {
            configId: config._id,
            groupId: config.groupId,
          },
        );
        processed++;
      } catch (error) {
        console.error(`[TaskReminder] Error for config ${config._id}:`, error);
      }

      // Always reschedule for next 9 AM in group's timezone
      try {
        await ctx.runMutation(
          internal.functions.scheduledJobs.rescheduleTaskReminder,
          { configId: config._id },
        );
      } catch (error) {
        console.error(
          `[TaskReminder] Error rescheduling config ${config._id}:`,
          error,
        );
      }
    }

    return { processed };
  },
});

export const getDueTaskReminderConfigs = internalQuery({
  args: { windowStart: v.number(), windowEnd: v.number() },
  handler: async (ctx, { windowStart, windowEnd }) => {
    const configs = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_botType_enabled_scheduled", (q) =>
        q.eq("botType", "task-reminder").eq("enabled", true),
      )
      .filter((q) =>
        q.and(
          q.gte(q.field("nextScheduledAt"), windowStart),
          q.lt(q.field("nextScheduledAt"), windowEnd),
        ),
      )
      .collect();

    return configs;
  },
});

// Types for task reminder config (matches frontend structure)
type TaskReminderRole = {
  id: string;
  name: string;
  assignedMemberId: string | null; // Convex user ID
};

type TaskReminderTask = {
  id: string;
  message: string;
  roleIds: string[];
};

type TaskReminderSchedule = Record<string, TaskReminderTask[]>;

type TaskReminderDeliveryMode = "task_only" | "task_and_channel_post";

type TaskReminderConfigData = {
  roles: TaskReminderRole[];
  schedule: TaskReminderSchedule;
  deliveryMode?: TaskReminderDeliveryMode;
  targetChannelSlugs?: string[];
  // Legacy fields kept for backwards compatibility with existing configs.
  delivery?: "chat" | "notification" | "both";
  targetChannelSlug?: string;
};

/**
 * Helper query to get group by ID.
 */
export const getGroupById = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    return await ctx.db.get(groupId);
  },
});

/**
 * Helper query to get community by ID.
 */
export const getCommunityById = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    return await ctx.db.get(communityId);
  },
});

// Return type for runTaskReminderBot
type TaskReminderResult =
  | { skipped: true; reason: string; day?: string }
  | {
      success: true;
      day: string;
      tasksProcessed: number;
      messagesSent: number;
    };

export const runTaskReminderBot = internalAction({
  args: {
    configId: v.id("groupBotConfigs"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, { configId, groupId }): Promise<TaskReminderResult> => {
    // Get the config
    const config = await ctx.runQuery(
      internal.functions.scheduledJobs.getBotConfigById,
      { configId },
    );

    if (!config || !config.enabled) {
      return { skipped: true, reason: "config_not_found_or_disabled" };
    }

    const configData = (config.config as TaskReminderConfigData) || {};
    const schedule: TaskReminderSchedule | undefined = configData.schedule;
    const roles: TaskReminderRole[] = configData.roles || [];
    const deliveryMode: TaskReminderDeliveryMode =
      configData.deliveryMode ??
      (configData.delivery === "notification"
        ? "task_only"
        : "task_and_channel_post");
    const targetChannelSlugs: string[] = [
      ...(configData.targetChannelSlugs ?? []),
      ...(configData.targetChannelSlug ? [configData.targetChannelSlug] : []),
    ].filter(Boolean);
    const resolvedTargetChannelSlugs =
      targetChannelSlugs.length > 0
        ? [...new Set(targetChannelSlugs)]
        : ["leaders"];

    if (!schedule || roles.length === 0) {
      console.log(
        `[TaskReminder] No schedule or roles configured for group ${groupId}`,
      );
      return { skipped: true, reason: "no_schedule_or_roles" };
    }

    // Get community timezone
    const group = await ctx.runQuery(
      internal.functions.scheduledJobs.getGroupById,
      { groupId },
    );
    const community = group?.communityId
      ? await ctx.runQuery(internal.functions.scheduledJobs.getCommunityById, {
          communityId: group.communityId,
        })
      : null;
    const timezone: string = community?.timezone || "America/New_York";

    // Get the current day name in the community timezone
    const nowDate: Date = new Date();
    const dayFormatter: Intl.DateTimeFormat = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: timezone,
    });
    const dateFormatter: Intl.DateTimeFormat = new Intl.DateTimeFormat(
      "en-CA",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: timezone,
      },
    );
    const todayName: string = dayFormatter.format(nowDate).toLowerCase();
    const todayDateKey: string = dateFormatter.format(nowDate);

    const todayTasks: TaskReminderTask[] = schedule[todayName] || [];

    if (todayTasks.length === 0) {
      console.log(
        `[TaskReminder] No tasks scheduled for ${todayName} in group ${groupId}`,
      );
      return { skipped: true, reason: "no_tasks_for_today", day: todayName };
    }

    console.log(
      `[TaskReminder] Processing ${todayTasks.length} tasks for ${todayName} in group ${groupId}`,
    );

    // Build a map of role ID to role for quick lookup
    const roleMap = new Map<string, TaskReminderRole>();
    for (const role of roles) {
      roleMap.set(role.id, role);
    }

    // Process each task
    let messagesSent = 0;
    for (const task of todayTasks) {
      // Get all assigned members for this task's roles
      const assignmentsByUserId = new Map<
        string,
        {
          userId: Id<"users">;
          memberName: string;
          sourceKey: string;
          taskId: Id<"tasks">;
        }
      >();

      for (const roleId of task.roleIds) {
        const role = roleMap.get(roleId);
        if (!role || !role.assignedMemberId) {
          console.log(
            `[TaskReminder] Role ${roleId} not found or no member assigned`,
          );
          continue;
        }

        // Get the user's name for the mention
        const user = await ctx.runQuery(
          internal.functions.scheduledJobs.getUserById,
          { userId: role.assignedMemberId as Id<"users"> },
        );

        if (user) {
          const displayName = [user.firstName, user.lastName]
            .filter(Boolean)
            .join(" ");
          const memberName = displayName || "Member";

          const sourceKey = `bot_task_reminder:${configId}:${todayDateKey}:${task.id}:${user._id}`;
          const taskId = await ctx.runMutation(
            internal.functions.tasks.index.createFromBotReminder,
            {
              groupId,
              assignedToId: user._id,
              title: task.message,
              description: `Task reminder generated for ${todayName}`,
              sourceKey,
            },
          );
          assignmentsByUserId.set(user._id.toString(), {
            userId: user._id,
            memberName,
            sourceKey,
            taskId,
          });
        }
      }

      const assignments = [...assignmentsByUserId.values()];
      if (assignments.length === 0) {
        console.log(
          `[TaskReminder] No assigned members found for task "${task.message}"`,
        );
        continue;
      }

      if (deliveryMode === "task_only") {
        console.log(
          `[TaskReminder] Created ${assignments.length} task(s) without channel post for "${task.message}"`,
        );
        continue;
      }

      for (const assignment of assignments) {
        for (const targetChannelSlug of resolvedTargetChannelSlugs) {
          const postSourceKey = `${assignment.sourceKey}:channel:${targetChannelSlug}`;
          const result = await ctx.runAction(
            internal.functions.scheduledJobs.sendBotMessage,
            {
              groupId,
              message: `Task reminder: ${task.message}`,
              targetChannelSlug,
              botType: "task_reminder",
              mentionedUserIds: [assignment.userId],
              contentType: "task_card",
              taskId: assignment.taskId,
              sourceKey: postSourceKey,
            },
          );

          if (result.success) {
            messagesSent++;
          } else {
            console.error(
              `[TaskReminder] Failed task-card post for task ${assignment.taskId} to ${targetChannelSlug}: ${result.error}`,
            );
          }
        }
      }
    }

    return {
      success: true,
      day: todayName,
      tasksProcessed: todayTasks.length,
      messagesSent,
    };
  },
});

export const rescheduleTaskReminder = internalMutation({
  args: { configId: v.id("groupBotConfigs") },
  handler: async (ctx, { configId }) => {
    const config = await ctx.db.get(configId);
    if (!config) return;

    const group = await ctx.db.get(config.groupId);
    if (!group) return;

    const community = await ctx.db.get(group.communityId);
    const timezone = community?.timezone || "America/New_York";

    const next9AM = calculateNext9AMInTimezone(timezone);

    await ctx.db.patch(configId, {
      nextScheduledAt: next9AM,
      updatedAt: now(),
    });
  },
});

/**
 * Reschedule birthday bot to next 9 AM in the community's timezone.
 */
export const rescheduleBirthdayBot = internalMutation({
  args: { configId: v.id("groupBotConfigs") },
  handler: async (ctx, { configId }) => {
    const config = await ctx.db.get(configId);
    if (!config) return;

    const group = await ctx.db.get(config.groupId);
    if (!group) return;

    const community = await ctx.db.get(group.communityId);
    const timezone = community?.timezone || "America/New_York";

    const next9AM = calculateNext9AMInTimezone(timezone);

    await ctx.db.patch(configId, {
      nextScheduledAt: next9AM,
      updatedAt: now(),
    });
  },
});

export const getBotConfigById = internalQuery({
  args: { configId: v.id("groupBotConfigs") },
  handler: async (ctx, { configId }) => {
    return await ctx.db.get(configId);
  },
});

// ============================================================================
// HELPER QUERIES
// ============================================================================

export const getMeetingForNotification = internalQuery({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    const meeting = await ctx.db.get(meetingId);
    if (!meeting) return null;

    const group = await ctx.db.get(meeting.groupId);
    let community:
      | {
          timezone?: string;
          primaryColor?: string;
        }
      | null = null;

    // Get community timezone for proper time formatting in notifications
    let timezone = "America/New_York"; // Default fallback
    if (group?.communityId) {
      community = await ctx.db.get(group.communityId);
      if (community?.timezone) {
        timezone = community.timezone;
      }
    }

    const groupAvatarUrl =
      getMediaUrlWithTransform(group?.preview, ImagePresets.avatarSmall) ||
      getInitialsAvatarUrl(group?.name, community?.primaryColor);

    return {
      ...meeting,
      groupName: group?.name || "Group",
      groupAvatarUrl,
      timezone,
    };
  },
});

export const getRsvpsByOption = internalQuery({
  args: { meetingId: v.id("meetings"), rsvpOptionId: v.number() },
  handler: async (ctx, { meetingId, rsvpOptionId }) => {
    return await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .filter((q) => q.eq(q.field("rsvpOptionId"), rsvpOptionId))
      .collect();
  },
});

export const getRsvpsByOptions = internalQuery({
  args: { meetingId: v.id("meetings"), rsvpOptionIds: v.array(v.number()) },
  handler: async (ctx, { meetingId, rsvpOptionIds }) => {
    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect();

    return rsvps.filter((r) => rsvpOptionIds.includes(r.rsvpOptionId));
  },
});

export const getActivePushTokensForUsers = internalQuery({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, { userIds }) => {
    // Create a Set for O(1) lookup of target userIds
    const userIdSet = new Set(userIds.map((id) => id.toString()));

    // Query all active push tokens once, then filter in memory
    // This is more efficient than N queries when we have many users
    const allActiveTokens = await ctx.db
      .query("pushTokens")
      .filter((q) => q.eq(q.field("isActive"), true))
      .take(2000); // Safety limit

    const tokens: string[] = [];

    for (const t of allActiveTokens) {
      if (
        userIdSet.has(t.userId.toString()) &&
        t.token.startsWith("ExponentPushToken")
      ) {
        tokens.push(t.token);
      }
    }

    return tokens;
  },
});

export const getUserForNotification = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

// ============================================================================
// HELPER MUTATIONS
// ============================================================================

export const markMeetingReminderSent = internalMutation({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    await ctx.db.patch(meetingId, { reminderSent: true });
  },
});

export const markAttendanceConfirmationSent = internalMutation({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, { meetingId }) => {
    await ctx.db.patch(meetingId, { attendanceConfirmationSent: true });
  },
});

export const createAttendanceConfirmationToken = internalMutation({
  args: { userId: v.id("users"), meetingId: v.id("meetings") },
  handler: async (ctx, { userId, meetingId }) => {
    // Generate a random token
    const token =
      Math.random().toString(36).substring(2) +
      Math.random().toString(36).substring(2) +
      Math.random().toString(36).substring(2) +
      Math.random().toString(36).substring(2);

    const expiresAt = now() + 24 * 60 * 60 * 1000; // 24 hours

    await ctx.db.insert("attendanceConfirmationTokens", {
      token,
      userId,
      meetingId,
      expiresAt,
      createdAt: now(),
    });

    return token;
  },
});

export const updateBotState = internalMutation({
  args: {
    configId: v.id("groupBotConfigs"),
    stateUpdates: v.any(),
  },
  handler: async (ctx, { configId, stateUpdates }) => {
    const config = await ctx.db.get(configId);
    if (!config) return;

    const currentState = (config.state as Record<string, unknown>) || {};
    const newState = { ...currentState, ...stateUpdates };

    await ctx.db.patch(configId, {
      state: newState,
      updatedAt: now(),
    });
  },
});

// ============================================================================
// BOT MESSAGING (CONVEX-NATIVE)
// ============================================================================

/**
 * Send a bot message to a Convex chat channel.
 * Migrated from Stream Chat to Convex-native messaging.
 * Supports mentionedUserIds to trigger notifications/emails for mentioned users.
 *
 * Channel targeting (with backwards compatibility):
 * 1. If targetChannelSlug is set → use it (new style)
 * 2. Else if chatType is set → map to slug (backwards compat: main→general, leaders→leaders)
 * 3. Else → default to "general"
 */
export const sendBotMessage = internalAction({
  args: {
    groupId: v.id("groups"),
    message: v.string(),
    // Keep for backwards compatibility
    chatType: v.optional(v.union(v.literal("main"), v.literal("leaders"))),
    // New: slug-based targeting for custom channels
    targetChannelSlug: v.optional(v.string()),
    botType: v.optional(v.string()), // "birthday", "welcome", "task_reminder"
    mentionedUserIds: v.optional(v.array(v.id("users"))),
    contentType: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    sourceKey: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      groupId,
      message,
      chatType,
      targetChannelSlug,
      botType,
      mentionedUserIds,
      contentType,
      taskId,
      sourceKey,
    },
  ): Promise<
    | {
        success: true;
        channelId: Id<"chatChannels">;
        messageId: Id<"chatMessages">;
      }
    | { success: false; error: string }
  > => {
    // Determine target slug with backwards compatibility
    let targetSlug: string;

    if (targetChannelSlug) {
      // New style: direct slug
      targetSlug = targetChannelSlug;
    } else if (chatType) {
      // Old style: map chatType to slug
      // "main" -> "general", "leaders" stays as "leaders"
      targetSlug = chatType === "main" ? "general" : chatType;
    } else {
      // Default
      targetSlug = "general";
    }

    // Look up the channel by slug
    let channel = await ctx.runQuery(
      internal.functions.scheduledJobs.getChannelBySlug,
      { groupId, slug: targetSlug },
    );

    // If channel not found, log warning and fallback to general
    if (!channel) {
      console.warn(
        `[sendBotMessage] Channel with slug "${targetSlug}" not found for group ${groupId}, falling back to general`,
      );
      channel = await ctx.runQuery(
        internal.functions.scheduledJobs.getChannelBySlug,
        { groupId, slug: "general" },
      );
    }

    if (!channel) {
      console.error(`[sendBotMessage] No channel found for group ${groupId}`);
      return { success: false, error: "Channel not found" };
    }

    // Check if channel is archived
    if (channel.isArchived) {
      const errorMsg = `Bot cannot post to archived channel "${channel.name}". Please update bot settings to target an active channel.`;
      console.error(`[sendBotMessage] ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    // Insert the bot message
    const messageId = await ctx.runMutation(
      internal.functions.scheduledJobs.insertBotMessage,
      {
        channelId: channel._id,
        content: message,
        botType: botType || "system",
        mentionedUserIds: mentionedUserIds || undefined,
        contentType,
        taskId,
        sourceKey,
      },
    );

    return { success: true, channelId: channel._id, messageId };
  },
});

/**
 * Get Convex channel for a group by chatType.
 * @deprecated Use getChannelBySlug for new code
 */
export const getConvexChannelForGroup = internalQuery({
  args: {
    groupId: v.id("groups"),
    chatType: v.union(v.literal("main"), v.literal("leaders")),
  },
  handler: async (ctx, { groupId, chatType }) => {
    // Use the by_group_type index for efficient lookup
    return await ctx.db
      .query("chatChannels")
      .withIndex("by_group_type", (q) =>
        q.eq("groupId", groupId).eq("channelType", chatType),
      )
      .first();
  },
});

/**
 * Get channel by group and slug.
 * Supports both new slug-based lookup and fallback to channelType for backwards compat.
 *
 * Slug mapping for legacy channels:
 * - "general" -> channelType "main"
 * - "leaders" -> channelType "leaders"
 * - Custom slugs -> looked up by slug directly
 */
export const getChannelBySlug = internalQuery({
  args: {
    groupId: v.id("groups"),
    slug: v.string(),
  },
  handler: async (ctx, { groupId, slug }) => {
    // Try by slug first (for custom channels and migrated channels)
    // Exclude archived channels — archiving frees up slugs for reuse,
    // so multiple channels can share the same slug if earlier ones are archived.
    let channel = await ctx.db
      .query("chatChannels")
      .withIndex("by_group_slug", (q) =>
        q.eq("groupId", groupId).eq("slug", slug),
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .first();

    if (channel) {
      return channel;
    }

    // Fallback: map slug to channelType for backwards compat with channels
    // that don't have slugs yet (e.g., channels created before slug migration)
    const slugToType: Record<string, string> = {
      general: "main",
      leaders: "leaders",
    };
    const channelType = slugToType[slug];

    if (channelType) {
      channel = await ctx.db
        .query("chatChannels")
        .withIndex("by_group_type", (q) =>
          q.eq("groupId", groupId).eq("channelType", channelType),
        )
        .filter((q) => q.eq(q.field("isArchived"), false))
        .first();
    }

    return channel;
  },
});
/**
 * Insert a bot message into the chat.
 * Supports mentionedUserIds to trigger notifications/emails for mentioned users.
 */
export const insertBotMessage = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
    content: v.string(),
    botType: v.string(),
    mentionedUserIds: v.optional(v.array(v.id("users"))),
    contentType: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    sourceKey: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      channelId,
      content,
      botType,
      mentionedUserIds,
      contentType,
      taskId,
      sourceKey,
    },
  ) => {
    const now_ = now();

    if (sourceKey) {
      const existing = await ctx.db
        .query("chatMessages")
        .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
        .first();
      if (existing) {
        return existing._id;
      }
    }

    // Determine bot display name
    const botNames: Record<string, string> = {
      birthday: "Birthday Bot 🎂",
      welcome: "Welcome Bot 👋",
      task_reminder: "Task Reminder 📋",
      communication: "Communication Bot 💬",
      system: "Togather Bot",
    };
    const senderName = botNames[botType] || "Togather Bot";

    // Insert bot message (no senderId - it's a system/bot message)
    const messageId = await ctx.db.insert("chatMessages", {
      channelId,
      // senderId is undefined for bot messages
      content,
      contentType: contentType || "bot",
      createdAt: now_,
      isDeleted: false,
      senderName,
      mentionedUserIds: mentionedUserIds || undefined,
      taskId,
      sourceKey,
    });

    // Update channel with last message info
    const preview = content.slice(0, 100);
    await ctx.db.patch(channelId, {
      lastMessageAt: now_,
      lastMessagePreview: preview,
      lastMessageSenderName: senderName,
      updatedAt: now_,
    });

    // Trigger onMessageSent to handle notifications and unread counts
    await ctx.scheduler.runAfter(
      0,
      internal.functions.messaging.events.onMessageSent,
      {
        messageId,
        channelId,
        // No senderId for bot messages
        senderNameOverride: senderName,
      },
    );

    return messageId;
  },
});

// ============================================================================
// EXTERNAL API HELPERS
// ============================================================================

interface PushNotificationPayload {
  title: string;
  body: string;
  data: Record<string, unknown>;
  imageUrl?: string;
}

/**
 * Send push notifications via Expo Push API.
 */
async function sendExpoPushNotifications(
  tokens: string[],
  notification: PushNotificationPayload,
): Promise<{ sent: number; failed: number }> {
  if (tokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const messages = tokens.map((token) => {
    const message: {
      to: string;
      sound: "default";
      title: string;
      body: string;
      data: Record<string, unknown>;
      priority: "high";
      richContent?: { image: string };
      mutableContent?: boolean;
    } = {
      to: token,
      sound: "default" as const,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      priority: "high" as const,
    };

    if (notification.imageUrl) {
      message.richContent = { image: notification.imageUrl };
      message.mutableContent = true;
    }

    return message;
  });

  let sent = 0;
  let failed = 0;

  // Send in batches of 100
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);

    try {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN && {
            Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}`,
          }),
        },
        body: JSON.stringify(chunk),
      });

      if (response.ok) {
        const result = (await response.json()) as {
          data?: Array<{ status: string }>;
        };
        for (const ticket of result.data || []) {
          if (ticket.status === "ok") {
            sent++;
          } else {
            failed++;
          }
        }
      } else {
        failed += chunk.length;
        console.error(
          `[ExpoPush] Failed batch: ${response.status} ${response.statusText}`,
        );
      }
    } catch (error) {
      failed += chunk.length;
      console.error("[ExpoPush] Error sending batch:", error);
    }
  }

  return { sent, failed };
}

interface AttendanceEmailParams {
  to: string;
  firstName: string;
  eventTitle: string;
  groupName: string;
  eventDate: string;
  confirmUrl: string;
}

/**
 * Send attendance confirmation email via Resend.
 */
async function sendAttendanceConfirmationEmail(
  params: AttendanceEmailParams,
): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.warn("[Email] RESEND_API_KEY not configured, skipping email");
    return;
  }

  const { to, firstName, eventTitle, groupName, eventDate, confirmUrl } =
    params;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
      <div style="background-color: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <h2 style="color: #1a1a1a; margin-top: 0; margin-bottom: 8px;">Did you attend?</h2>
        <p style="color: #666; margin-top: 0; margin-bottom: 24px;">Let us know if you made it to the event.</p>

        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <p style="margin: 0 0 4px; font-weight: 600; color: #1a1a1a;">${eventTitle}</p>
          <p style="margin: 0 0 4px; color: #666; font-size: 14px;">${groupName}</p>
          <p style="margin: 0; color: #666; font-size: 14px;">${eventDate}</p>
        </div>

        <p style="color: #1a1a1a; margin-bottom: 24px;">Hi ${firstName}, please confirm your attendance:</p>

        <div style="text-align: center; margin-bottom: 24px;">
          <a href="${confirmUrl}"
             style="display: inline-block; background-color: #1E8449; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
            Confirm Attendance
          </a>
        </div>

        <p style="color: #999; font-size: 13px; text-align: center; margin-bottom: 0;">
          This link expires in 24 hours.
        </p>
      </div>

      <p style="color: #8898aa; font-size: 12px; text-align: center; margin-top: 24px;">
        Sent by ${BRAND_NAME}
      </p>
    </body>
    </html>
  `;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from: `${BRAND_NAME} <noreply@${DOMAIN_CONFIG.baseDomain}>`,
      to,
      subject: `Did you attend ${eventTitle}?`,
      html,
    }),
  });
}

// ============================================================================
// TIMEZONE HELPERS
// ============================================================================

/**
 * Calculate the next 9 AM in a given timezone.
 * Returns Unix timestamp in milliseconds.
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
  const month = parseInt(parts.find((p) => p.type === "month")?.value || "1");
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

  // Calculate offset directly
  // Create a date at midnight UTC and check the hour in the target timezone
  const testDate = new Date(
    `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}T00:00:00Z`,
  );
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
  const result = new Date(Date.UTC(year, month - 1, day, utcHour, 0, 0, 0));

  return result.getTime();
}

/**
 * Format event date for display.
 */
function formatEventDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ============================================================================
// WELCOME BOT
// ============================================================================

/**
 * Get welcome bot config for a group.
 * Returns null if bot is not configured or disabled.
 */
export const getWelcomeBotConfig = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    const config = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_group_botType", (q) =>
        q.eq("groupId", groupId).eq("botType", "welcome"),
      )
      .first();

    if (!config || !config.enabled) {
      return null;
    }

    const group = await ctx.db.get(groupId);
    if (!group) return null;

    const community = await ctx.db.get(group.communityId);

    const configData = (config.config as Record<string, unknown>) || {};

    return {
      configId: config._id,
      groupId,
      enabled: config.enabled,
      groupName: group.name,
      communityName: community?.name || "Community",
      message:
        (configData.message as string) ||
        "Welcome to [[group_name]], [[first_name]]! 👋",
      targetChannelSlug: (configData.targetChannelSlug as string) || undefined,
    };
  },
});

/**
 * Send welcome message to a new member.
 * Called by scheduler when a new member joins a group.
 */
export const sendWelcomeMessage = internalAction({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (
    ctx,
    { groupId, userId },
  ): Promise<
    | { skipped: true; reason: string }
    | { success: true; message: string }
    | { success: false; error: string }
  > => {
    // Get welcome bot config
    const config = await ctx.runQuery(
      internal.functions.scheduledJobs.getWelcomeBotConfig,
      { groupId },
    );

    if (!config) {
      return { skipped: true, reason: "bot_not_enabled" };
    }

    // Get user info for placeholder replacement
    const user = await ctx.runQuery(
      internal.functions.scheduledJobs.getUserById,
      { userId },
    );

    if (!user) {
      return { skipped: true, reason: "user_not_found" };
    }

    // Replace placeholders
    const message = config.message
      .replace(/\[\[first_name\]\]/g, user.firstName || "there")
      .replace(/\[\[group_name\]\]/g, config.groupName)
      .replace(/\[\[community_name\]\]/g, config.communityName);

    // Send to configured channel, or default to general
    try {
      await ctx.runAction(internal.functions.scheduledJobs.sendBotMessage, {
        groupId,
        message,
        targetChannelSlug: config.targetChannelSlug || "general",
        botType: "welcome",
      });

      return { success: true, message };
    } catch (error) {
      console.error(`[WelcomeBot] Error sending message:`, error);
      return { success: false, error: String(error) };
    }
  },
});

/**
 * Get user by ID (helper for welcome bot).
 */
export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db.get(userId);
  },
});

// ============================================================================
// COMMUNICATION BOT
// ============================================================================

/**
 * Process communication bot messages scheduled for the current hour.
 * Called hourly by cron to check for groups with communication bot due.
 * Supports both legacy single-message format and new multi-message format.
 */
export const processCommunicationBotBucket = internalAction({
  args: {},
  handler: async (ctx) => {
    const currentTime = now();
    const hourStart =
      Math.floor(currentTime / (60 * 60 * 1000)) * 60 * 60 * 1000;
    const hourEnd = hourStart + 60 * 60 * 1000;

    const configs = await ctx.runQuery(
      internal.functions.scheduledJobs.getDueCommunicationBotConfigs,
      { windowStart: hourStart, windowEnd: hourEnd },
    );

    const results: Array<{
      groupId: string;
      messageId?: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const config of configs) {
      try {
        const configData = (config.config as Record<string, unknown>) || {};

        // Check for new multi-message format
        const messages = configData.messages as
          | Array<{
              id: string;
              message: string;
              schedule: { dayOfWeek: number; hour: number; minute: number };
              targetChannelSlug: string;
              enabled: boolean;
            }>
          | undefined;

        if (messages && messages.length > 0) {
          // New format: process each enabled message that matches the current time
          for (const msg of messages) {
            if (!msg.enabled || !msg.message.trim()) continue;

            // Check if this specific message is due now using the schedule matcher
            const isDue = isScheduleDueNow(msg.schedule, config.timezone);

            // If this message is due in the current hour, send it
            if (isDue) {
              try {
                // Resolve PCO placeholders
                let resolvedMessage = msg.message;
                try {
                  resolvedMessage = await ctx.runAction(
                    internal.functions.pcoServices.actions
                      .resolvePositionPlaceholdersInternal,
                    { communityId: config.communityId, message: msg.message },
                  );
                } catch (error) {
                  console.warn(
                    `[CommunicationBot] Failed to resolve placeholders for message ${msg.id}:`,
                    error,
                  );
                }

                // Send the message
                const sendResult = await ctx.runAction(
                  internal.functions.scheduledJobs.sendBotMessage,
                  {
                    groupId: config.groupId,
                    message: resolvedMessage,
                    targetChannelSlug: msg.targetChannelSlug,
                    botType: "communication",
                  },
                );

                if (sendResult.success) {
                  results.push({
                    groupId: config.groupId,
                    messageId: msg.id,
                    success: true,
                  });
                } else {
                  console.error(
                    `[CommunicationBot] Failed to send message ${msg.id}:`,
                    sendResult.error,
                  );
                  results.push({
                    groupId: config.groupId,
                    messageId: msg.id,
                    success: false,
                    error: sendResult.error,
                  });
                }
              } catch (error) {
                console.error(
                  `[CommunicationBot] Error sending message ${msg.id}:`,
                  error,
                );
                results.push({
                  groupId: config.groupId,
                  messageId: msg.id,
                  success: false,
                  error: String(error),
                });
              }
            }
          }
        } else {
          // Legacy single-message format for backward compatibility
          const message = (configData.message as string) || "";
          const targetChannelSlug =
            (configData.targetChannelSlug as string) || "leaders";

          if (!message.trim()) {
            console.log(
              `[CommunicationBot] No message configured for group ${config.groupId}`,
            );
            results.push({ groupId: config.groupId, success: true });
          } else {
            // Resolve PCO placeholders
            let resolvedMessage = message;
            try {
              resolvedMessage = await ctx.runAction(
                internal.functions.pcoServices.actions
                  .resolvePositionPlaceholdersInternal,
                { communityId: config.communityId, message },
              );
            } catch (error) {
              console.warn(
                `[CommunicationBot] Failed to resolve placeholders for group ${config.groupId}:`,
                error,
              );
            }

            // Send the message
            await ctx.runAction(
              internal.functions.scheduledJobs.sendBotMessage,
              {
                groupId: config.groupId,
                message: resolvedMessage,
                targetChannelSlug,
                botType: "communication",
              },
            );

            results.push({ groupId: config.groupId, success: true });
          }
        }
      } catch (error) {
        console.error(
          `[CommunicationBot] Error for group ${config.groupId}:`,
          error,
        );
        results.push({
          groupId: config.groupId,
          success: false,
          error: String(error),
        });
      }

      // Reschedule for next occurrence (inside its own try-catch to prevent
      // blocking remaining configs if reschedule fails)
      try {
        await ctx.runMutation(
          internal.functions.scheduledJobs.rescheduleCommunicationBot,
          { configId: config.configId },
        );
      } catch (rescheduleError) {
        console.error(
          `[CommunicationBot] Failed to reschedule config ${config.configId}:`,
          rescheduleError,
        );
        // Continue processing other configs even if rescheduling fails
      }
    }

    return { processed: results.length, results };
  },
});

/**
 * Get communication bot configs that are due in the current hour window.
 * Used by the hourly bucket processor.
 */
export const getDueCommunicationBotConfigs = internalQuery({
  args: {
    windowStart: v.number(),
    windowEnd: v.number(),
  },
  handler: async (ctx, { windowStart, windowEnd }) => {
    const configs = await ctx.db
      .query("groupBotConfigs")
      .withIndex("by_botType_enabled_scheduled", (q) =>
        q.eq("botType", "communication").eq("enabled", true),
      )
      .filter((q) =>
        q.and(
          q.gte(q.field("nextScheduledAt"), windowStart),
          q.lt(q.field("nextScheduledAt"), windowEnd),
        ),
      )
      .collect();

    // Enrich with group/community data
    const results = [];
    for (const config of configs) {
      const group = await ctx.db.get(config.groupId);
      if (!group) continue;

      const community = await ctx.db.get(group.communityId);
      if (!community) continue;

      results.push({
        configId: config._id,
        groupId: config.groupId,
        communityId: group.communityId,
        groupName: group.name,
        communityName: community.name || "Community",
        timezone: community.timezone || "America/New_York",
        config: config.config,
      });
    }

    return results;
  },
});

/**
 * Reschedule communication bot to the next scheduled time.
 * Supports both legacy single-message format and new multi-message format.
 * For multi-message format, finds the earliest next scheduled time across all enabled messages.
 */
export const rescheduleCommunicationBot = internalMutation({
  args: { configId: v.id("groupBotConfigs") },
  handler: async (ctx, { configId }) => {
    const config = await ctx.db.get(configId);
    if (!config) return;

    const group = await ctx.db.get(config.groupId);
    if (!group) return;

    const community = await ctx.db.get(group.communityId);
    const timezone = community?.timezone || "America/New_York";

    const configData = (config.config as Record<string, unknown>) || {};

    const nextScheduled = calculateCommunicationBotNextSchedule(
      configData,
      timezone,
    );

    if (nextScheduled) {
      await ctx.db.patch(configId, {
        nextScheduledAt: nextScheduled,
        updatedAt: now(),
      });
    }
  },
});

// Scheduling utilities are imported from ../lib/scheduling
