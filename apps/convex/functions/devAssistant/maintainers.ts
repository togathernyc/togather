/**
 * Dev-Assistant Maintainers — superuser-managed delegate access.
 *
 * A "dev maintainer" is a user granted the `dev_maintainer` platform role so
 * they can summon the @Togather dev-assistant (mention it in a thread to turn a
 * discussion into a bug brief) WITHOUT being a Togather superuser/staff.
 *
 * Maintainers get the trigger capability ONLY — they cannot review, reject,
 * retry, or merge bugs (those stay superuser-only, see bugs.ts `requireSuperuser`).
 * That's the "can call the assistant, but without full super admin privileges"
 * split the feature asks for.
 *
 * This mirrors the `poster_admin` platform-role model in functions/posters.ts:
 * the role lives in `users.platformRoles`, isSuperuser/isStaff implicitly bypass
 * the role check, and only super admins can grant/revoke it (via the
 * `/(user)/admin/maintainers` screen).
 */

import { v, ConvexError } from "convex/values";
import { query, mutation, internalQuery } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { requireAuth, requireAuthUser } from "../../lib/auth";

export const DEV_MAINTAINER_ROLE = "dev_maintainer" as const;

// ============================================================================
// Auto-merge severity cap (ADR-029 Phase 3)
// ============================================================================

/**
 * Per-user cap on the contribution risk level that may auto-merge. Keyed off a
 * bug's originator: an item auto-merges only when its `riskLevel` is at or below
 * this cap. Managed on the maintainers screen.
 */
export const autoMergeSeverityValidator = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

export type AutoMergeSeverity = "none" | "low" | "medium" | "high";

/**
 * Ordinal rank for the severity gate. A contribution auto-merges only when its
 * riskLevel rank is <= the originator's cap rank. "none" (-1) sits below every
 * real risk level, so those contributions never auto-merge.
 */
export const AUTO_MERGE_SEVERITY_ORDER: Record<AutoMergeSeverity, number> = {
  none: -1,
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Default cap for a user without an explicit setting. "low" preserves the
 * original global policy (only low-risk contributions auto-merge); an operator
 * raises it per person on the maintainers screen.
 */
export const DEFAULT_AUTO_MERGE_MAX_SEVERITY: AutoMergeSeverity = "low";

// ============================================================================
// Access helpers
// ============================================================================

/**
 * True if the user may summon the dev-assistant — Togather superuser/staff
 * (implicit) or a delegated dev maintainer. This is the single source of truth
 * for the trigger gate; bugs.getUserAccess derives `isMaintainer` from the same
 * role constant.
 */
export function canUseDevAssistant(
  user: Doc<"users"> | null | undefined,
): boolean {
  if (!user) return false;
  if (user.isSuperuser === true || user.isStaff === true) return true;
  return user.platformRoles?.includes(DEV_MAINTAINER_ROLE) ?? false;
}

/** True if the user can manage (grant/revoke) the maintainer list. Superuser/staff only. */
export function isDevAssistantSuperAdmin(
  user: Doc<"users"> | null | undefined,
): boolean {
  return user?.isSuperuser === true || user?.isStaff === true;
}

async function requireSuperAdmin(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<Doc<"users">> {
  const user = await requireAuthUser(ctx, token);
  if (!isDevAssistantSuperAdmin(user)) {
    throw new ConvexError("Not authorized: superuser required");
  }
  return user;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Current user's dev-assistant permissions. Used by the client to decide
 * whether to render the maintainers admin screen and the management controls.
 */
export const myAccess = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const user = await ctx.db.get(userId);
    return {
      isMaintainer: user?.platformRoles?.includes(DEV_MAINTAINER_ROLE) ?? false,
      isSuperAdmin: isDevAssistantSuperAdmin(user),
      canUseAssistant: canUseDevAssistant(user),
    };
  },
});

/**
 * List of users currently holding the maintainer role. Superuser-only (drives
 * the "Current maintainers" list on the admin screen).
 */
export const listMaintainers = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.token);
    // No index on platformRoles array membership — a scan is acceptable given
    // this list is small and the page is operator-only (mirrors listPosterAdmins).
    const users = await ctx.db.query("users").collect();
    return users
      .filter(
        (u) =>
          // Explicit maintainers, plus staff/superusers who have implicit
          // access. Staff can originate dashboard items too, so the auto-merge
          // cap gate applies to them — surface them here so their cap is
          // manageable (they just can't be granted/revoked the role).
          u.platformRoles?.includes(DEV_MAINTAINER_ROLE) ||
          u.isSuperuser === true ||
          u.isStaff === true,
      )
      .map((u) => ({
        _id: u._id,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        email: u.email ?? null,
        phone: u.phone ?? null,
        profilePhoto: u.profilePhoto ?? null,
        isSuperuser: u.isSuperuser === true || u.isStaff === true,
        autoMergeMaxSeverity:
          u.autoMergeMaxSeverity ?? DEFAULT_AUTO_MERGE_MAX_SEVERITY,
      }));
  },
});

/**
 * Superuser-only user search for the "Add maintainer" picker. Matches against
 * the denormalized users.searchText index.
 */
export const searchUsersForGrant = query({
  args: { token: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx, args.token);
    const limit = Math.min(args.limit ?? 10, 50);
    const trimmed = args.query.trim();
    if (trimmed.length < 2) return [];
    const users = await ctx.db
      .query("users")
      .withSearchIndex("search_users", (q) => q.search("searchText", trimmed))
      .take(limit);
    return users.map((u) => ({
      _id: u._id,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      email: u.email ?? null,
      phone: u.phone ?? null,
      profilePhoto: u.profilePhoto ?? null,
      // Superusers/staff already have implicit access — surface that so the
      // picker can disable "Add" rather than grant a redundant role.
      alreadyMaintainer: canUseDevAssistant(u),
    }));
  },
});

// ============================================================================
// Mutations — role grants (superuser-only)
// ============================================================================

export const grantMaintainer = mutation({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    await requireSuperAdmin(ctx, args.token);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");
    const current = target.platformRoles ?? [];
    if (current.includes(DEV_MAINTAINER_ROLE)) return { ok: true };
    await ctx.db.patch(args.userId, {
      platformRoles: [...current, DEV_MAINTAINER_ROLE],
    });
    return { ok: true };
  },
});

export const revokeMaintainer = mutation({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    await requireSuperAdmin(ctx, args.token);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");
    const current = target.platformRoles ?? [];
    const next = current.filter((r) => r !== DEV_MAINTAINER_ROLE);
    await ctx.db.patch(args.userId, { platformRoles: next });
    return { ok: true };
  },
});

/**
 * Set a user's auto-merge severity cap (superuser-only). Governs the max
 * contribution risk level that may auto-merge for items this user originated —
 * "none" opts them out, "high" auto-merges everything up to high risk.
 */
export const setAutoMergeMaxSeverity = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    maxSeverity: autoMergeSeverityValidator,
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    await requireSuperAdmin(ctx, args.token);
    const target = await ctx.db.get(args.userId);
    if (!target) throw new ConvexError("User not found");
    await ctx.db.patch(args.userId, { autoMergeMaxSeverity: args.maxSeverity });
    return { ok: true };
  },
});

// ============================================================================
// Internal — auto-merge gate lookup
// ============================================================================

/**
 * The effective auto-merge severity cap for a user (default when unset). Called
 * by the auto-merge action, which runs outside a DB context.
 */
export const getAutoMergeCapForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<AutoMergeSeverity> => {
    const user = await ctx.db.get(args.userId);
    return (user?.autoMergeMaxSeverity ??
      DEFAULT_AUTO_MERGE_MAX_SEVERITY) as AutoMergeSeverity;
  },
});
