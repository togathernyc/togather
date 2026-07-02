/**
 * Scheduling Module — native event scheduling & rostering
 *
 * Togather's PCO-independent volunteer-rostering engine. A serving team is a
 * first-class `teams` row that owns roles (ADR-025); events declare needed
 * roles; volunteers are assigned and accept/decline.
 *
 * @see /docs/architecture/ADR-023-native-event-scheduling.md
 * @see /docs/architecture/ADR-025-teams-first-class-entity.md
 * @see /docs/architecture/event-scheduling-phase-1-plan.md
 */

// ============================================================================
// Teams
// ============================================================================
export {
  createServingTeam,
  listTeams,
  getTeam,
  updateTeam,
  archiveTeam,
  listCommunityTeams,
  addPermanentMember,
  removePermanentMember,
  listPermanentMembers,
} from "./teams";

// ============================================================================
// Roles
// ============================================================================
export {
  createRole,
  updateRole,
  archiveRole,
  reorderRoles,
  listRoles,
  suggestStarterRoles,
} from "./roles";

// ============================================================================
// Events & needed roles
// ============================================================================
export {
  createEvent,
  updateEvent,
  deleteEvent,
  setNeededRoles,
  seedNeededRolesFromDefaults,
  listEvents,
  getEvent,
} from "./events";

// ============================================================================
// Run sheet items (ADR-026)
// ============================================================================
export {
  listItems,
  createItem,
  updateItem,
  deleteItem,
  duplicateItem,
  reorderItems,
} from "./eventItems";

// ============================================================================
// Event templates — reusable per-group task + run-sheet templates (Phase 1)
// ============================================================================
export {
  createTaskTemplate,
  renameTaskTemplate,
  deleteTaskTemplate,
  listTaskTemplates,
  listTaskTemplateItems,
  addTaskTemplateItem,
  updateTaskTemplateItem,
  deleteTaskTemplateItem,
  reorderTaskTemplateItems,
} from "./taskTemplates";
export {
  createRunSheetTemplate,
  renameRunSheetTemplate,
  deleteRunSheetTemplate,
  listRunSheetTemplates,
  listRunSheetTemplateItems,
  addRunSheetTemplateItem,
  updateRunSheetTemplateItem,
  deleteRunSheetTemplateItem,
  duplicateRunSheetTemplateItem,
  reorderRunSheetTemplateItems,
} from "./runSheetTemplates";

// ============================================================================
// Assignments & lifecycle
// ============================================================================
export {
  assignRole,
  assignFromCommunity,
  inviteAndAssign,
  unassign,
  respondToAssignment,
  previousFillers,
  publishEvent,
} from "./assignments";

// ============================================================================
// Community-people search (assign-from-community flow)
// ============================================================================
export { searchCommunityPeople } from "./people";

// ============================================================================
// Live presence — "who's viewing/editing this roster" (#477).
// Frontend resolves these as `api.functions.scheduling.presence.*`.
// ============================================================================
export { heartbeat, listViewers, leave } from "./presence";

// ============================================================================
// My Schedule (volunteer view)
// ============================================================================
export { myAssignments } from "./mySchedule";

// ============================================================================
// Shared helpers (re-exported for tests / sibling modules)
// ============================================================================
export {
  suggestStarterRolesForName,
  DEFAULT_STARTER_ROLES,
} from "./starterRoles";
export type { StarterRole } from "./starterRoles";
