/**
 * PCO Services Module
 *
 * Functions for integrating with Planning Center Services API.
 * Used for Auto Channels feature to sync channel membership based on service schedules.
 *
 * @see /docs/architecture/PCO-auto-channels-design.md
 */

// ============================================================================
// Public Actions
// ============================================================================
export {
  getServiceTypes,
  getTeamsForServiceType,
  getUpcomingPlans,
  getPlanTeamMembers,
  triggerChannelSync,
  triggerGroupSync,
  getAvailablePositions,
  previewFilterResults,
} from "./actions";

// ============================================================================
// Run Sheet
// ============================================================================
export type { RunSheet, RunSheetItem } from "./runSheet";

// ============================================================================
// Queries (Public and Internal)
// ============================================================================
export { getIntegration, getAutoChannelConfigByChannel } from "./queries";

// ============================================================================
// Member Matching
// ============================================================================
export {
  linkUserToPcoPerson,
  matchAndLinkPcoPerson,
  getLinkedPcoUsers,
} from "./matching";

// ============================================================================
// Serving History (for Follow-up Scoring)
// ============================================================================
export { getServingCounts, saveServingCounts, getGroupMemberPcoLinks } from "./servingHistory";

// ============================================================================
// Rotation Engine
// ============================================================================
export {
  getActiveAutoChannelConfigs,
  getAutoChannelConfig,
  getAutoChannelConfigById,
  addChannelMember,
  removeExpiredMembers,
  updateSyncStatus,
  syncAutoChannel,
  processAllAutoChannels,
} from "./rotation";

