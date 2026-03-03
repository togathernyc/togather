/**
 * Group functions
 *
 * Functions for managing groups and group memberships.
 *
 * This module is organized into:
 * - queries.ts: Read operations (list, get, search)
 * - mutations.ts: Write operations (create, update, join, leave)
 * - members.ts: Member-related queries (getLeaders, getMembership, isLeader, etc.)
 * - internal.ts: Internal queries (for actions to call)
 */

// Queries - read operations
export {
  getById,
  getByShortId,
  byIds,
  listByCommunity,
  listForUser,
  search,
  listArchivedByCommunity,
  getByIdWithRole,
  getByLegacyIdPublic,
  listAllForSync,
} from "./queries";

// Mutations - write operations
export {
  create,
  update,
  join,
  leave,
  updateMemberRole,
  backfillShortIds,
  updateLeaderToolbarTools,
  updateToolbarVisibility,
} from "./mutations";

// Member queries
export {
  getLeaders,
  getMembership,
  isLeader,
  myLeaderGroups,
} from "./members";

// Internal queries (for actions)
export {
  getByIdInternal,
  getMembershipInternal,
  getByLegacyId,
} from "./internal";
