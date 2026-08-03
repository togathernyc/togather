/**
 * Community-level financial-controls access (ADR-033 §5).
 *
 * Two different questions have been answered by the same check until now:
 *
 *   "Can this person run the community?"        -> isCommunityAdmin
 *   "Can this person run the community's MONEY?" -> also isCommunityAdmin
 *
 * ADR-033 separates them. A church may have several community admins — a
 * volunteer who manages groups, a comms lead who edits branding — and none of
 * that implies authority to connect a card issuer, submit the church's EIN,
 * or turn giving on for a group. Being able to add a channel should not carry
 * the ability to hand a vendor a spending credential.
 *
 * The new rule for COMMUNITY-level finance surfaces:
 *
 *   primary admin (implicit, always)  OR  an active `communityFinanceRoles` row
 *
 * The primary admin's power is IMPLICIT — deliberately not a seeded row.
 * There is nothing to migrate when this ships, and no revoke can ever lock a
 * community out of its own finances (the failure mode a seeded row would
 * eventually produce).
 *
 * FUND-level access is unchanged and lives in lib/helpers.ts
 * (`requireFundRole` / `requireFundRoleOrGroupLeader`, community-admin
 * override intact). This module is only about the community-wide surfaces
 * that have no fund to hang off.
 */

import { ConvexError } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  assertCommunityNotArchived,
  isCommunityAdmin,
  isPrimaryAdmin,
} from "../permissions";

interface DbCtx {
  db: {
    query: (table: "communityFinanceRoles") => any;
    get: (id: any) => Promise<any>;
  };
}

/**
 * The user's active (non-revoked) `communityFinanceRoles` row, if any.
 *
 * Collect-then-filter rather than `.first()`, matching
 * `getActiveFundRoleRow` in lib/helpers.ts and for the same reason: a
 * re-grant leaves the revoked row in place and inserts a new active one, so
 * `.first()` could return the revoked grant and wrongly deny a re-granted
 * user.
 */
export async function getActiveCommunityFinanceRole(
  ctx: DbCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
): Promise<{ _id: Id<"communityFinanceRoles">; role: "finance_admin" } | null> {
  const rows = await ctx.db
    .query("communityFinanceRoles")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .collect();
  return rows.find((r: { revokedAt?: number }) => r.revokedAt === undefined) ?? null;
}

/**
 * Can this user act on the community's financial controls? Returns a boolean;
 * doesn't throw. Mirrors `isCommunityAdmin`'s shape so call sites swap one
 * for the other without restructuring.
 *
 * A GRANT IS NOT ENOUGH ON ITS OWN — the holder must still be a community
 * admin. `grantCommunityFinanceRole` enforces that at grant time, but nothing
 * revokes the finance row when someone is later demoted to member: the
 * role-management mutations only patch `userCommunities.roles`, so a
 * demoted-but-never-revoked user would otherwise keep submitting the church's
 * EIN. Re-checking here rather than trying to make demotion transactional
 * across two features means the standing is evaluated where it is USED, and
 * no future demotion path can forget to call us.
 */
export async function canManageCommunityFinance(
  ctx: DbCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
): Promise<boolean> {
  if (await isPrimaryAdmin(ctx as any, communityId, userId)) return true;
  if ((await getActiveCommunityFinanceRole(ctx, userId, communityId)) === null) {
    return false;
  }
  return await isCommunityAdmin(ctx as any, communityId, userId);
}

/**
 * Throwing variant for mutations/queries behind a community finance gate.
 *
 * `ConvexError`, not a plain `Error`: this rejects real people mid-task on a
 * public surface, and a plain Error dead-ends them in the mobile root
 * ErrorBoundary with no message (see functions/finance/roles.ts's
 * requireAuth precedent). The message names the one person who can fix it,
 * because "you don't have permission" with no route forward is where a
 * church admin gets stuck.
 *
 * Also carries over `requireCommunityAdmin`'s archived-community check —
 * every call site this replaces had it, and losing it would let a
 * community-less token reach an archived community's finance surfaces by id.
 */
export async function requireCommunityFinanceAccess(
  ctx: DbCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
): Promise<void> {
  if (!(await canManageCommunityFinance(ctx, userId, communityId))) {
    throw new ConvexError(
      "You need financial-controls access for this community — ask the primary admin to grant it in Community Settings → Finance",
    );
  }
  await assertCommunityNotArchived(ctx as any, communityId);
}
