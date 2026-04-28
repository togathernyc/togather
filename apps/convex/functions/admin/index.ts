/**
 * Admin functions barrel export
 *
 * Re-exports all admin functions from their respective modules.
 * Import from this file to access any admin function.
 */

// Auth - Role constants and authorization helpers
export {
  COMMUNITY_ROLES,
  ADMIN_ROLE_THRESHOLD,
  LEADER_ROLES,
  requireCommunityAdmin,
  requirePrimaryAdmin,
  checkCommunityAdmin,
  checkPrimaryAdmin,
} from "./auth";

// Requests - Pending requests and group creation requests
export {
  listPendingRequests,
  reviewPendingRequest,
  listGroupCreationRequests,
  getGroupCreationRequestById,
  reviewGroupCreationRequest,
} from "./requests";

// Members - Community member management
export {
  listCommunityMembers,
  searchCommunityMembers,
  getCommunityMemberById,
  updateMemberRole,
  transferPrimaryAdmin,
  getUserGroupHistory,
} from "./members";

// Stats - Statistics and analytics
export {
  getInternalDashboard,
  getTotalAttendance,
  getNewSignups,
  getActiveMembers,
  getNewMembersThisMonth,
  getAttendanceByGroupType,
  getActiveMembersList,
  getNewMembersList,
  getGroupAttendanceDetails,
  exportAttendanceByGroupType,
  getGroupAttendanceForExport,
  getExportSetupData,
} from "./stats";

// Settings - Community settings and group types
export {
  getCommunitySettings,
  updateCommunitySettings,
  listGroupTypes,
  createGroupType,
  updateGroupType,
  listAllGroups,
} from "./settings";

// Duplicates - Duplicate account management
export {
  listDuplicateAccounts,
  mergeDuplicateAccounts,
  listMergedAccounts,
} from "./duplicates";

// Cleanup - Internal queries and data cleanup
export {
  findCommunitiesInternal,
  getCommunityMembershipCountInternal,
  getMembershipBatchInternal,
  buildLegacyIdMappingInternal,
  getRecentMeetingIdsInternal,
  checkUserAttendanceActivityInternal,
  checkUserActivityBatchInternal,
  dryRunActiveUsersAction,
  dryRunActiveUsersInternal,
  dryRunActiveUsers,
  previewInactiveUserDeletion,
  deleteInactiveUserData,
  exportCommunityAttendanceCSV,
  getCommunityAttendanceForExport,
  getCommunityGroupsInternal,
  getGroupAttendanceRecordsInternal,
  getGroupMeetingsInternal,
  getMeetingAttendanceInternal,
} from "./cleanup";

// Migrations - Data migration functions
export {
  upsertGroupTypeFromLegacy,
} from "./migrations";

// Feature Flags - DB-backed global on/off switches for staged rollouts
export {
  getFeatureFlag,
  listFeatureFlags,
  setFeatureFlag,
} from "./featureFlags";
