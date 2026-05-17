/**
 * Scheduling Module — native event scheduling & rostering
 *
 * Togather's PCO-independent volunteer-rostering engine. A serving team is a
 * chat channel with roles; events declare needed roles; volunteers are
 * assigned and accept/decline.
 *
 * @see /docs/architecture/ADR-023-native-event-scheduling.md
 * @see /docs/architecture/event-scheduling-phase-1-plan.md
 */

// ============================================================================
// Teams
// ============================================================================
export { markChannelAsTeam, listTeamChannels } from "./teams";

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
// Assignments & lifecycle
// ============================================================================
export {
  assignRole,
  unassign,
  respondToAssignment,
  previousFillers,
  publishEvent,
} from "./assignments";

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
