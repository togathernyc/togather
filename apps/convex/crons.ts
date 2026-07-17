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
import { registerDevAssistantCrons } from "@supa-media/dev-assistant";
import "./functions/devAssistant/config"; // side-effect: sets config first

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
// TEAM CHANNEL AUTO-SYNC
// =============================================================================
// Runs daily at 5:10 UTC (just after PCO rotation) to reconcile every serving-
// team channel's membership against its event-plan role assignments. Adds
// volunteers ~5 days before their event and removes them ~1 day after — the
// rotation window advances even when no assignment mutation fires.

crons.daily(
  "team-channel-auto-sync",
  { hourUTC: 5, minuteUTC: 10 },
  internal.functions.scheduling.teamChannelSync.reconcileAllTeamChannels,
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

// =============================================================================
// CHAT REQUEST EXPIRY
// =============================================================================
// Runs daily at 8:00 UTC to expire pending DM/group_dm chat requests older than
// 30 days. Marks them declined silently (the inviter is not notified).

crons.daily(
  "chat-request-expiry",
  { hourUTC: 8, minuteUTC: 0 },
  internal.functions.messaging.directMessages.expireOldChatRequests
);

// =============================================================================
// DM RATE-LIMIT CLEANUP
// =============================================================================
// Runs hourly to delete `directMessageRateLimits` rows older than 24h. Old rows
// have no further effect on the 1-msg-per-pending-pair-per-24h rule but would
// otherwise accumulate forever.

crons.hourly(
  "dm-rate-limit-cleanup",
  { minuteUTC: 40 },
  internal.functions.messaging.directMessages.cleanupOldDmRateLimits
);

// =============================================================================
// DAILY NOTIFICATION-ENABLED SNAPSHOT + COUNTER SELF-HEAL
// =============================================================================
// Runs daily at 23:55 UTC — late in the UTC day so the snapshot captures
// "end of today" under today's date label (avoids the off-by-one delta
// distortion the earlier 00:05-of-next-day schedule had). Backfill re-seeds
// `notificationEnabledCounter` from pushTokens (idempotent, paginated — no
// transaction limits) for self-healing; if backfill fails the snapshot
// still runs.

crons.daily(
  "daily-notification-enabled-snapshot",
  { hourUTC: 23, minuteUTC: 55 },
  internal.functions.notifications.dailyEnabledSnapshot.runDaily
);

// =============================================================================
// PRAYER ARCHIVAL
// =============================================================================
// Runs daily at 6:00 UTC to archive active prayers older than 30 days.
// Authors can still see archived prayers under My Prayers.

crons.daily(
  "prayer-archive-stale",
  { hourUTC: 6, minuteUTC: 0 },
  internal.functions.prayers.archiveStalePrayers,
  {}
);

// =============================================================================
// PRAYER DAILY DIGEST
// =============================================================================
// Runs daily at 14:00 UTC (9am ET / 6am PT). For each prayer-enabled
// community, sends one push to eligible members summarizing how many new
// approved prayers landed in the last 24 hours.

crons.daily(
  "prayer-daily-digest",
  { hourUTC: 14, minuteUTC: 0 },
  internal.functions.prayers.notifications.cronDailyDigest,
  {}
);

// =============================================================================
// PRAYER MONDAY NUDGE
// =============================================================================
// Runs daily at 14:15 UTC; the handler bails when the UTC weekday isn't
// Monday. Sent to community members who don't currently have an active
// prayer, nudging them to share a request to start the week.

crons.daily(
  "prayer-monday-nudge",
  { hourUTC: 14, minuteUTC: 15 },
  internal.functions.prayers.notifications.cronMondayNudge,
  {}
);

// =============================================================================
// PRAYER UPDATE NUDGE
// =============================================================================
// Runs daily at 14:30 UTC. Sends a single push to authors of prayers that
// are still `status: "active"` ~14 days after creation, asking for an
// update or praise report. One-shot per prayer.

crons.daily(
  "prayer-update-nudge",
  { hourUTC: 14, minuteUTC: 30 },
  internal.functions.prayers.notifications.cronUpdateNudge,
  {}
);

// =============================================================================
// PER-ACTIVE-USER BILLING SYNC
// =============================================================================
// Runs monthly, ahead of the billing anchor (subscriptions bill on the 1st),
// and updates each per-active-user community's Stripe subscription quantity
// to its current billable member count: real accounts who opened the app in
// that community within the past month ($1/month each). See
// functions/memberActivity.ts for the definition.

crons.monthly(
  "per-user-billing-sync",
  { day: 28, hourUTC: 6, minuteUTC: 0 },
  internal.functions.ee.billing.syncPerUserSubscriptionQuantities,
  {}
);

// =============================================================================
// DEV-ASSISTANT PR MERGE RECONCILE
// =============================================================================
// Backstop for the /github/webhook: polls open dev-dashboard PRs and flips a
// bug to MERGED when its PR has merged on GitHub, so manual merges reflect on
// the Contribute dashboard even when the webhook isn't delivering. Idempotent;
// no-ops when the GitHub integration is unconfigured. See ADR-029 Phase 3.
//
// Registered by @supa-media/dev-assistant — same cron name
// ("dev-assistant-pr-merge-reconcile"), same */15 cadence, same target action
// (functions/devAssistant/actions:reconcileMergedPrs) as the previous
// hand-written registration.
registerDevAssistantCrons(crons); // reads functionsPath from the config holder

export default crons;
