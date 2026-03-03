/**
 * FOUNT Service Planning Bot
 *
 * Automates weekly service planning in FOUNT's Slack #services channel.
 * Uses a stateless agent loop with OpenAI tool-use to respond to @mentions,
 * sync to Planning Center, and nag for missing items.
 *
 * Architecture: Slack is source of truth for conversations. PCO is source of truth
 * for plan state. Config lives in slackBotConfig DB table (admin-editable).
 *
 * @see /docs/architecture for more details
 */

export { createWeeklyThreads, processThreadReply, checkAndNag, triggerNag } from "./actions";
export {
  syncPreacherToPCO,
  syncMeetingLeaderToPCO,
  syncPreachNotesToPCO,
  syncSetlistToPCO,
  syncAnnouncementsToPCO,
  removeFromPcoPlan,
  fetchPcoContext,
} from "./pcoSync";
export {
  getConfig,
  getAllConfigs,
  getConfigByChannel,
  isMessageProcessed,
  markMessageProcessed,
  appendActivityLog,
  isNagSent,
  markNagSent,
  resetNagTracking,
} from "./configDb";
export { seedSlackBotConfig } from "./seedConfig";
export {
  getSlackBotConfig,
  getSlackBotStatus,
} from "./adminQueries";
export {
  toggleSlackBot,
  updateTeamMembers,
  updateThreadMentions,
  updateNagSchedule,
  updatePrompts,
  updatePcoConfig,
  toggleDevMode,
  verifyAdminAccess,
  listSlackMembers,
  updateServicePlanItems,
  fetchPcoTeamsAndItems,
  updateThreadCreation,
  updateSlackChannelId,
  listSlackChannels,
  sendNag,
} from "./adminMutations";
