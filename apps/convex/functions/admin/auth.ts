/**
 * Admin authorization helpers and role constants
 *
 * Re-exports from centralized lib/permissions.ts for backwards compatibility.
 * New code should import directly from lib/permissions.ts.
 */

// Re-export all permission constants and helpers from the centralized lib
export {
  COMMUNITY_ROLES,
  COMMUNITY_ADMIN_THRESHOLD,
  PRIMARY_ADMIN_ROLE,
  ADMIN_ROLE_THRESHOLD,
  LEADER_ROLES,
  isCommunityAdmin,
  isPrimaryAdmin,
  requireCommunityAdmin,
  requirePrimaryAdmin,
  isLeaderRole,
} from "../../lib/permissions";

// Alias for backwards compatibility
export { isCommunityAdmin as checkCommunityAdmin } from "../../lib/permissions";
export { isPrimaryAdmin as checkPrimaryAdmin } from "../../lib/permissions";
