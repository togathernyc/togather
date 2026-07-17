/**
 * Dev-Assistant access helpers — Togather's role system for the dev assistant.
 *
 * Extracted into a standalone module (from the old maintainers.ts) so both
 * `config.ts` (which wires these into the package's role-gate seams) and
 * `maintainers.ts` (which owns role grant/revoke) can import them WITHOUT a
 * circular dependency: maintainers.ts only imports `config.ts` for its
 * side effect, and `config.ts` must not import maintainers.ts back.
 *
 * Mirrors the `poster_admin` platform-role model (functions/posters.ts): the
 * role lives in `users.platformRoles`, staff/superusers bypass the check, and
 * only super admins can grant/revoke it.
 */

import type { Doc } from "../../_generated/dataModel";

export const DEV_MAINTAINER_ROLE = "dev_maintainer" as const;

/**
 * True if the user may summon the dev-assistant / use the contributor dashboard
 * — Togather superuser/staff (implicit) or a delegated dev maintainer.
 */
export function canUseDevAssistant(
  user: Doc<"users"> | null | undefined,
): boolean {
  if (!user) return false;
  if (user.isSuperuser === true || user.isStaff === true) return true;
  return user.platformRoles?.includes(DEV_MAINTAINER_ROLE) ?? false;
}

/** True if the user can manage (grant/revoke) the maintainer list, and run the
 *  privileged review-screen ops. Superuser/staff only. */
export function isDevAssistantSuperAdmin(
  user: Doc<"users"> | null | undefined,
): boolean {
  return user?.isSuperuser === true || user?.isStaff === true;
}
