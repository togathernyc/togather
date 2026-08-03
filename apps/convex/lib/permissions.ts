/**
 * Permission constants and helpers for role-based access control
 *
 * Centralizes permission-related logic that was duplicated across multiple files:
 * - admin/auth.ts
 * - communities.ts
 * - groupMembers.ts
 * - groups/queries.ts
 * - groups/mutations.ts
 * - groups/members.ts
 * - meetings/communityEvents.ts
 * - communityWideEvents.ts
 */

import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";

// ============================================================================
// Community Role Constants
// ============================================================================

/**
 * Community role levels (stored in userCommunities.roles as number)
 */
export const COMMUNITY_ROLES = {
  MEMBER: 1,
  MODERATOR: 2, // Reserved, not currently used
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

/**
 * Minimum role level required for community admin privileges.
 * Admin (3) and Primary Admin (4) both qualify as community admins.
 */
export const COMMUNITY_ADMIN_THRESHOLD = COMMUNITY_ROLES.ADMIN;

/**
 * Primary Admin role level - highest privilege level.
 *
 * PRIMARY ADMIN IS A SET, NOT A SINGLETON.
 *
 * A community has **one or more** members with `userCommunities.roles === 4`.
 * At least one is expected; there is no upper bound and no uniqueness
 * constraint in the schema, so code must never assume "the" primary admin.
 *
 * How a community ends up with more than one:
 * - Every creation flow (`proposals.acceptProposal`, `ee/proposals`,
 *   `ee/billing` checkout, `migrations`, seeding) inserts exactly ONE row at
 *   role 4 — the founder.
 * - `admin/members.transferPrimaryAdmin` MOVES the role (demotes the caller,
 *   promotes the target) rather than adding one, so it leaves the set size
 *   unchanged — unless the target already held role 4, in which case the set
 *   shrinks by the caller.
 * - Both `updateMemberRole` mutations (`functions/communities.ts` and
 *   `functions/admin/members.ts`) take an unbounded `v.number()` role and
 *   will happily write role 4 onto a second member. Both gate that on the
 *   CALLER already being a primary admin (`communities.ts` security check 3;
 *   `admin/members.ts` via `requirePrimaryAdmin` on admin-level changes), so
 *   it is not an escalation — but it does mean an existing primary admin can
 *   mint another one in-app today, without any dashboard access.
 * - Operators also add them by editing `userCommunities.roles` directly in the
 *   Convex dashboard. Either way it is a deliberate, supported state —
 *   several communities run this way, which is why every read has to
 *   tolerate it.
 *
 * Consequences for callers:
 * - PER-USER checks (`isPrimaryAdmin`, `requirePrimaryAdmin`, the finance
 *   gate in lib/finance/communityFinanceAccess.ts) are inherently multi-safe:
 *   they ask "is THIS user a primary admin", and every primary admin answers
 *   yes independently. Prefer these.
 * - Anything that needs to *find* a primary admin must either operate on the
 *   whole set (e.g. notify all of them) or pick DETERMINISTICALLY. The
 *   repo-wide convention for "pick one" is the row with the earliest
 *   `createdAt` — see `pickInheritingPrimaryAdmin` below.
 */
export const PRIMARY_ADMIN_ROLE = COMMUNITY_ROLES.PRIMARY_ADMIN;

/**
 * Alias for COMMUNITY_ADMIN_THRESHOLD for backwards compatibility.
 * @deprecated Use COMMUNITY_ADMIN_THRESHOLD instead
 */
export const ADMIN_ROLE_THRESHOLD = COMMUNITY_ADMIN_THRESHOLD;

// ============================================================================
// Group Role Constants
// ============================================================================

/**
 * Roles that have leadership privileges in a group.
 * Used for permission checks in group-level operations.
 */
export const LEADER_ROLES = ["leader"] as const;

// ============================================================================
// Permission Check Helpers
// ============================================================================

/**
 * Throw if the target community has been archived (closed).
 *
 * The universal `requireAuth` gate (lib/auth.ts) already rejects any request
 * whose JWT is *scoped* to an archived community, which covers all normal
 * sessions. This helper closes the complementary by-id vector: a caller holding
 * a community-less or other-community token that passes an archived community's
 * id as an argument. It's wired into the shared authorization helpers below
 * (admin/member checks) so those paths reject archived communities regardless
 * of token scope. Throws the same `COMMUNITY_ARCHIVED` error the client uses to
 * route users back to community selection.
 */
export async function assertCommunityNotArchived(
  ctx: { db: any },
  communityId: Id<"communities">
): Promise<void> {
  const community = await ctx.db.get(communityId);
  if (community?.isArchived) {
    throw new ConvexError("COMMUNITY_ARCHIVED");
  }
}

/**
 * Check if user is a community admin (Admin or Primary Admin).
 * Returns boolean, doesn't throw.
 *
 * @param ctx - Convex query/mutation context with db access
 * @param communityId - The community to check admin status for
 * @param userId - The user to check
 * @returns true if user is an active admin (roles >= 3)
 */
export async function isCommunityAdmin(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<boolean> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .first();

  return !!(
    membership &&
    (membership.roles ?? 0) >= COMMUNITY_ADMIN_THRESHOLD &&
    membership.status === 1
  );
}

/**
 * Check if user is a Primary Admin of a community.
 * Returns boolean, doesn't throw.
 *
 * Per-user, so it is multi-safe by construction: a community may have several
 * primary admins (see PRIMARY_ADMIN_ROLE) and each of them independently
 * answers true here.
 *
 * @param ctx - Convex query/mutation context with db access
 * @param communityId - The community to check
 * @param userId - The user to check
 * @returns true if user is a Primary Admin (roles === 4)
 */
export async function isPrimaryAdmin(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<boolean> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .first();

  return !!(membership && membership.roles === PRIMARY_ADMIN_ROLE && membership.status === 1);
}

/**
 * Require community admin role. Throws if user is not an admin.
 *
 * @param ctx - Convex query/mutation context with db access
 * @param communityId - The community to check admin status for
 * @param userId - The user to check
 * @throws Error if user is not a community admin
 */
export async function requireCommunityAdmin(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<void> {
  const isAdmin = await isCommunityAdmin(ctx, communityId, userId);
  if (!isAdmin) {
    throw new Error("Community admin role required");
  }
  // Even an admin cannot act on an archived (closed) community.
  await assertCommunityNotArchived(ctx, communityId);
}

/**
 * Require Primary Admin role. Throws if user is not a primary admin.
 *
 * Per-user like `isPrimaryAdmin` — every member of the primary-admin set
 * passes this gate, which is what makes multiple primary admins work without
 * any per-call-site change.
 *
 * @param ctx - Convex query/mutation context with db access
 * @param communityId - The community to check
 * @param userId - The user to check
 * @throws Error if user is not a Primary Admin
 */
export async function requirePrimaryAdmin(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<void> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q: any) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .first();

  if (!membership || membership.roles !== PRIMARY_ADMIN_ROLE || membership.status !== 1) {
    throw new Error("Primary Admin role required");
  }
}

/**
 * Every ACTIVE primary admin of a community, as `userCommunities` rows.
 *
 * Use this whenever a code path wants to reach "the primary admin" — there may
 * be several (see PRIMARY_ADMIN_ROLE). Paths that fan out (notifications,
 * digests, escalations) should act on the whole array rather than one row.
 *
 * @returns rows sorted oldest-first by `createdAt`, so `[0]` is the
 * longest-standing primary admin and the ordering is stable across runs.
 */
export async function getPrimaryAdmins(
  ctx: { db: any },
  communityId: Id<"communities">
): Promise<any[]> {
  const rows = await ctx.db
    .query("userCommunities")
    .withIndex("by_community", (q: any) => q.eq("communityId", communityId))
    .filter((q: any) =>
      q.and(
        q.eq(q.field("roles"), PRIMARY_ADMIN_ROLE),
        q.eq(q.field("status"), 1)
      )
    )
    .collect();

  return rows.sort(comparePrimaryAdminSeniority);
}

/**
 * Deterministic ordering for the primary-admin set: oldest membership first.
 *
 * `createdAt` is the primary key because it is the field the product means by
 * "longest-standing admin" and it survives data migrations that rewrite
 * `_creationTime`. `_creationTime` then `_id` break ties so the order is a
 * total one — two rows written in the same transaction share a `createdAt`,
 * and an unstable comparator there would make the "pick one" paths
 * arbitrary again.
 */
function comparePrimaryAdminSeniority(a: any, b: any): number {
  const byCreatedAt = (a.createdAt ?? 0) - (b.createdAt ?? 0);
  if (byCreatedAt !== 0) return byCreatedAt;
  const byCreationTime = (a._creationTime ?? 0) - (b._creationTime ?? 0);
  if (byCreationTime !== 0) return byCreationTime;
  // Plain codepoint comparison, NOT localeCompare: locale collation can rank
  // the same two ids differently depending on the runtime's default locale,
  // and can even report equality for distinct strings. `_id` is unique, so
  // this makes the comparator a genuinely total, locale-independent order.
  const aId = String(a._id);
  const bId = String(b._id);
  if (aId === bId) return 0;
  return aId < bId ? -1 : 1;
}

/**
 * The single primary admin that inherits something ownerless — a departing
 * member's future meetings, for instance.
 *
 * Some things genuinely can only have one owner, so when the set has more than
 * one member we must choose. We choose the EARLIEST `createdAt`:
 *
 * - Stable. The same community produces the same answer on every run, so a
 *   retry, a replay, or a second removal doesn't scatter ownership across
 *   different admins. `.first()` on the index used to decide this, which is
 *   insertion-order luck rather than a rule.
 * - Defensible. Oldest membership is the founder / longest-standing admin —
 *   the person most likely to recognise an inherited event, and the one who
 *   was there before whoever was added last week.
 *
 * @returns null if the community has no active primary admin at all (possible
 * for archived or half-migrated communities); callers must handle that.
 */
export async function pickInheritingPrimaryAdmin(
  ctx: { db: any },
  communityId: Id<"communities">
): Promise<any | null> {
  const admins = await getPrimaryAdmins(ctx, communityId);
  return admins[0] ?? null;
}

/**
 * Check if a group membership has a leader role.
 *
 * @param role - The role string from groupMembers record
 * @returns true if role is "leader"
 */
export function isLeaderRole(role: string | undefined): boolean {
  if (!role) return false;
  return LEADER_ROLES.includes(role as typeof LEADER_ROLES[number]);
}
