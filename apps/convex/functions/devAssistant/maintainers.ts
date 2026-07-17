/**
 * Dev-Assistant Maintainers — superuser-managed delegate access (Togather role
 * system). This is the app-owned half of the seam: `@supa-media/dev-assistant`
 * has no concept of Togather's `dev_maintainer` platform role — it only reads
 * `users.autoMergeMaxSeverity` (via the re-exported `getAutoMergeCapForUser`
 * below, which its auto-merge action calls). Everything else here — granting/
 * revoking the role, the maintainers list, the auto-merge-cap setter — stays
 * local because it's Togather's role/permission model.
 *
 * A "dev maintainer" is a user granted the `dev_maintainer` platform role so
 * they can summon the @Togather dev-assistant and use the contributor dashboard
 * WITHOUT being a Togather superuser/staff. Reviewing/merging stays superuser-
 * only. Mirrors the `poster_admin` model in functions/posters.ts.
 */

import { v, ConvexError } from "convex/values";
import { query, mutation } from "../../_generated/server";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { requireAuth, requireAuthUser } from "../../lib/auth";
import {
  DEV_MAINTAINER_ROLE,
  canUseDevAssistant,
  isDevAssistantSuperAdmin,
} from "./access";
import { devAssistant } from "./_instance";
import type { InternalQuery } from "./_reexportTypes";

// Re-export the role helpers (kept here for back-compat with the previous
// public surface of this module) and the role constant.
export { DEV_MAINTAINER_ROLE, canUseDevAssistant, isDevAssistantSuperAdmin };

// The one package function the maintainers surface exposes: the auto-merge
// action reads a user's cap through `${functionsPath}/maintainers:
// getAutoMergeCapForUser` (reads `users.autoMergeMaxSeverity`, default "low").
// Direct-const re-export with an explicit registered-function type (a
// destructured re-export is dropped from the generated internal api — see
// _reexportTypes.ts).
export const getAutoMergeCapForUser: InternalQuery =
  devAssistant.maintainers.getAutoMergeCapForUser as any;

// ============================================================================
// Auto-merge severity cap (ADR-029 Phase 3)
// ============================================================================

/**
 * Per-user cap on the contribution risk level that may auto-merge. Managed on
 * the maintainers screen; the package's auto-merge gate reads it via
 * getAutoMergeCapForUser.
 */
export const autoMergeSeverityValidator = v.union(
  v.literal("none"),
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
);

export type AutoMergeSeverity = "none" | "low" | "medium" | "high";

/**
 * Default cap for a user without an explicit setting. "low" preserves the
 * original global policy (only low-risk contributions auto-merge); an operator
 * raises it per person on the maintainers screen. Matches the package default.
 */
export const DEFAULT_AUTO_MERGE_MAX_SEVERITY: AutoMergeSeverity = "low";

// ============================================================================
// Access helpers (superuser gate)
// ============================================================================

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
