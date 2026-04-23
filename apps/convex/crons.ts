/**
 * Convex Cron Jobs
 *
 * Scheduled tasks that run automatically at specified intervals.
 * These replace Trigger.dev scheduled jobs.
 *
 * Available cron patterns:
 * - crons.daily(name, { hourUTC, minuteUTC }, handler)
 * - crons.hourly(name, { minuteUTC }, handler)
 * - crons.cron(name, "* * * * *", handler) - standard cron syntax
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// =============================================================================
// BIRTHDAY BOT
// =============================================================================
// Runs hourly to check for groups with birthday bot due (timezone-aware).
// Groups have different timezones, so we check hourly and filter by nextScheduledAt.
// Replaces: Trigger.dev birthday-bot task (cron: "0 9 * * *")

crons.hourly(
  "birthday-bot-bucket",
  { minuteUTC: 0 },
  internal.functions.scheduledJobs.processBirthdayBotBucket
);

// =============================================================================
// TASK REMINDER CHECK
// =============================================================================
// Runs every hour to check for groups with due task reminders.
// Groups have different timezones, so we check hourly and filter by nextScheduledAt.
// Replaces: Trigger.dev task-reminder-bucket task

crons.hourly(
  "task-reminder-check",
  { minuteUTC: 0 },
  internal.functions.scheduledJobs.processTaskReminderBucket
);

// =============================================================================
// EMAIL VERIFICATION CODE CLEANUP
// =============================================================================
// Runs hourly to clean up expired email verification codes.
// Codes expire after 10 minutes, but we clean them up hourly to avoid
// database bloat while not being too aggressive on cleanup frequency.

crons.hourly(
  "email-verification-code-cleanup",
  { minuteUTC: 30 },
  internal.functions.authInternal.cleanupExpiredEmailCodes
);

// =============================================================================
// PHONE VERIFICATION TOKEN CLEANUP
// =============================================================================
// Runs hourly to clean up expired phone verification tokens.
// Tokens expire after 10 minutes, but we clean them up hourly.

crons.hourly(
  "phone-verification-token-cleanup",
  { minuteUTC: 35 },
  internal.functions.authInternal.cleanupExpiredPhoneTokens
);

// =============================================================================
// PCO AUTO CHANNEL ROTATION
// =============================================================================
// Runs daily at 5:00 UTC (midnight EST) to process all active auto channels.
// Removes expired members and adds new members based on Planning Center Services schedules.

crons.daily(
  "pco-auto-channel-rotation",
  { hourUTC: 5, minuteUTC: 0 },
  internal.functions.pcoServices.rotation.processAllAutoChannels
);

// =============================================================================
// COMMUNICATION BOT
// =============================================================================
// Runs hourly to check for groups with communication bot due (timezone-aware).
// Groups have different timezones, so we check hourly and filter by nextScheduledAt.
// Sends scheduled messages with PCO role mentions resolved.

crons.hourly(
  "communication-bot-bucket",
  { minuteUTC: 0 },
  internal.functions.scheduledJobs.processCommunicationBotBucket
);

// =============================================================================
// SLACK SERVICE BOT - Thread Creation
// =============================================================================
// Runs hourly on the hour; internally checks if it's the configured day/hour ET.
// Creates Manhattan and Brooklyn service planning threads in #services.

crons.hourly(
  "slack-service-bot-create-threads",
  { minuteUTC: 0 },
  internal.functions.slackServiceBot.actions.createWeeklyThreads,
  {}
);

// =============================================================================
// SLACK SERVICE BOT - Nag Check
// =============================================================================
// Runs hourly on the hour; internally checks if a nag is due (configured schedule ET).
// Reads thread state via Slack API, nags for missing items with escalating urgency.

crons.hourly(
  "slack-service-bot-nag-check",
  { minuteUTC: 0 },
  internal.functions.slackServiceBot.actions.checkAndNag
);

// =============================================================================
// TOKEN REVOCATION CLEANUP
// =============================================================================
// Runs daily to delete token revocation records past refresh-token max lifetime (+ buffer).
// Refresh flows validate revocations, so records must outlive the longest refresh JWT.

crons.daily(
  "token-revocation-cleanup",
  { hourUTC: 4, minuteUTC: 0 },
  internal.functions.authInternal.cleanupStaleTokenRevocations
);

// =============================================================================
// FOLLOWUP SCORE REFRESH
// =============================================================================
// Runs daily at 7:00 UTC (2:00 AM EST) to refresh time-decay scores.
// Follow-up recency scores decay daily, so we recompute all groups once per day.

crons.daily(
  "followup-score-refresh",
  { hourUTC: 7, minuteUTC: 0 },
  internal.functions.followupScoreComputation.dailyRefreshAllScores
);

// =============================================================================
// NOTIFICATION HOURLY ROLLUP
// =============================================================================
// Runs hourly at :05 past to count the previous hour's notifications
// (sent/impressed/clicked) by type and populate notificationHourlyStats.
// Replaces per-notification inline counter writes, which caused OCC conflicts
// when fan-outs hit the same counter row simultaneously.

crons.hourly(
  "notification-hourly-rollup",
  { minuteUTC: 5 },
  internal.functions.notifications.rollup.runHourlyRollup,
  {}
);

// =============================================================================
// COMMUNITY SCORE REFRESH
// =============================================================================
// Runs daily at 7:30 UTC (2:30 AM EST) to refresh community-level scores
// (Service, Attendance, Togather) for all communityPeople rows.

crons.daily(
  "daily community scores refresh",
  { hourUTC: 7, minuteUTC: 30 },
  internal.functions.communityScoreComputation.dailyRefreshAllCommunityScores
);

export default crons;
