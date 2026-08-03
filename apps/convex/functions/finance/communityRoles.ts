/**
 * Community-wide financial-controls role (ADR-033 §5).
 *
 * The community-level counterpart to functions/finance/roles.ts, which scopes
 * finance power to ONE fund. This role covers the surfaces that have no fund:
 * finance onboarding (the church's legal identity, the EIN, the Stripe
 * redirect), the card-provider connection, and the community-wide "can manage
 * cards" answer.
 *
 * ONLY THE PRIMARY ADMIN GRANTS OR REVOKES IT. Not a plain community admin,
 * and not a holder of the role itself — otherwise the first grantee could
 * mint peers, and the role would decay back into "community admin" with extra
 * steps, which is exactly what ADR-033 §5 separates it from.
 *
 * The primary admin's OWN access is implicit (see
 * lib/finance/communityFinanceAccess.ts): there is no row for them, nothing
 * to seed on migration, and no sequence of revokes that locks a community out
 * of its own money.
 *
 * A grantee must already be a community admin. The role is an extra key on
 * top of admin, not a way to hand finance powers to a member who has no
 * standing in the community at all.
 */

import { ConvexError, v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { now, getDisplayName, getMediaUrl } from "../../lib/utils";
import {
  ADMIN_ROLE_THRESHOLD,
  PRIMARY_ADMIN_ROLE,
  isCommunityAdmin,
  isPrimaryAdmin,
  assertCommunityNotArchived,
} from "../../lib/permissions";
import { logFinanceAudit } from "../../lib/finance/audit";
import {
  canManageCommunityFinance,
  getActiveCommunityFinanceRole,
} from "../../lib/finance/communityFinanceAccess";

/** Shape returned for each row's user, mirroring finance/roles.ts's toUserSummary. */
function toUserSummary(user: Doc<"users"> | null) {
  if (!user) return null;
  return {
    id: user._id,
    firstName: user.firstName || "",
    lastName: user.lastName || "",
    displayName: getDisplayName(user.firstName, user.lastName),
    profileImage: getMediaUrl(user.profilePhoto),
  };
}

/**
 * The primary-admin gate every mutation here shares.
 *
 * `ConvexError`, not a plain `Error` — these are public mutations and a plain
 * Error dead-ends the caller in the mobile root ErrorBoundary. The message
 * says who CAN do it, since the person hitting this is usually an admin who
 * reasonably assumed they could.
 */
async function requirePrimaryAdminForFinance(
  ctx: { db: any },
  communityId: Id<"communities">,
  userId: Id<"users">,
): Promise<void> {
  if (!(await isPrimaryAdmin(ctx, communityId, userId))) {
    throw new ConvexError(
      "Only the community's primary admin can change who has financial-controls access",
    );
  }
  await assertCommunityNotArchived(ctx, communityId);
}

// ============================================================================
// listCommunityFinanceRoles
// ============================================================================

/**
 * Every financial-controls grant on a community — active and revoked — with
 * user display info, for the settings screen. Visible to anyone who already
 * has community finance access (primary admin or a current holder): the
 * roster of who can touch the money is itself finance information, but
 * hiding it from the people it governs would make the grant unauditable by
 * the very people accountable for it.
 *
 * `viewerIsPrimaryAdmin` is returned so the UI can gate the grant/revoke
 * controls on the SAME check the mutations enforce, rather than showing a
 * holder buttons that can only error.
 */
export const listCommunityFinanceRoles = query({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    if (!(await canManageCommunityFinance(ctx, userId, args.communityId))) {
      throw new ConvexError(
        "You need financial-controls access for this community to see who holds it",
      );
    }
    // Same by-id close-out `requireCommunityFinanceAccess` does for the
    // mutations. Spelled out rather than delegated because the message above
    // is tailored to reading the roster; losing this would leave the one
    // finance surface where an archived community is still readable by id.
    await assertCommunityNotArchived(ctx, args.communityId);

    const rows = await ctx.db
      .query("communityFinanceRoles")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    // Active first; within each half, most recent first — the same ordering
    // finance/roles.ts's listFundRoles uses.
    rows.sort((a, b) => {
      const aActive = a.revokedAt === undefined;
      const bActive = b.revokedAt === undefined;
      if (aActive !== bActive) return aActive ? -1 : 1;
      if (aActive) return b.grantedAt - a.grantedAt;
      return (b.revokedAt ?? 0) - (a.revokedAt ?? 0);
    });

    const users = await Promise.all(rows.map((r) => ctx.db.get(r.userId)));

    return {
      roles: rows.map((row, i) => ({
        id: row._id,
        userId: row.userId,
        role: row.role,
        grantedBy: row.grantedBy,
        grantedAt: row.grantedAt,
        revokedAt: row.revokedAt,
        isActive: row.revokedAt === undefined,
        user: toUserSummary(users[i]),
      })),
      viewerIsPrimaryAdmin: await isPrimaryAdmin(ctx, args.communityId, userId),
    };
  },
});

// ============================================================================
// listGrantableFinanceAdmins
// ============================================================================

/**
 * The community admins a grant could actually be made to.
 *
 * The grant screen needs a PICKER, and a general member search would be the
 * wrong one: `grantCommunityFinanceRole` refuses anyone who is not already a
 * community admin, so offering the whole membership means most taps end in an
 * error the person cannot act on ("make them an admin first" — in a different
 * screen, for a different reason than they came here for).
 *
 * Excluded from the list, both for the same reason — the mutation would refuse
 * them:
 *  - the PRIMARY admin, whose access is implicit and deliberately not a row;
 *  - anyone who already holds an active grant, who is on the roster above.
 *
 * Read by the same people who can read the roster (`canManageCommunityFinance`),
 * not restricted to the primary admin: a holder looking at the screen should
 * see why the grant buttons they cannot press are pointed at these names.
 */
export const listGrantableFinanceAdmins = query({
  args: { token: v.string(), communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    if (!(await canManageCommunityFinance(ctx, userId, args.communityId))) {
      throw new ConvexError(
        "You need financial-controls access for this community to see who it can be given to",
      );
    }
    await assertCommunityNotArchived(ctx, args.communityId);

    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const candidates = memberships.filter(
      (m) =>
        m.status === 1 &&
        (m.roles ?? 0) >= ADMIN_ROLE_THRESHOLD &&
        (m.roles ?? 0) !== PRIMARY_ADMIN_ROLE,
    );

    const rows = await Promise.all(
      candidates.map(async (membership) => {
        const existing = await getActiveCommunityFinanceRole(
          ctx,
          membership.userId,
          args.communityId,
        );
        if (existing) return null;
        return toUserSummary(await ctx.db.get(membership.userId));
      }),
    );

    return rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  },
});

// ============================================================================
// grantCommunityFinanceRole
// ============================================================================

/**
 * Grant financial-controls access to a community admin.
 *
 * Idempotent by construction: an existing ACTIVE grant returns that row
 * rather than inserting a second one. Unlike `grantFundRole` there is no
 * upsert-with-revoke, because there is only one role to hold — a re-grant
 * would revoke and re-insert an identical row, producing audit noise that
 * says nothing changed.
 *
 * The primary admin is rejected as a TARGET: their access is implicit and a
 * row for them would be the one thing that could later be revoked, creating
 * exactly the lockout this design avoids.
 */
export const grantCommunityFinanceRole = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    await requirePrimaryAdminForFinance(ctx, args.communityId, callerId);

    if (await isPrimaryAdmin(ctx, args.communityId, args.userId)) {
      throw new ConvexError(
        "The primary admin already has financial-controls access — it doesn't need granting",
      );
    }

    // Finance access sits ON TOP of community admin, never instead of it.
    // Granting it to a plain member would give someone with no standing in
    // the community the power to connect a card issuer.
    if (!(await isCommunityAdmin(ctx, args.communityId, args.userId))) {
      throw new ConvexError(
        "Financial-controls access can only be given to a community admin — make them an admin first",
      );
    }

    const existing = await getActiveCommunityFinanceRole(
      ctx,
      args.userId,
      args.communityId,
    );
    if (existing) return existing._id;

    const roleId = await ctx.db.insert("communityFinanceRoles", {
      communityId: args.communityId,
      userId: args.userId,
      role: "finance_admin",
      grantedBy: callerId,
      grantedAt: now(),
    });

    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      actorUserId: callerId,
      action: "community_role.granted",
      details: { targetUserId: args.userId, role: "finance_admin" },
    });

    return roleId;
  },
});

// ============================================================================
// revokeCommunityFinanceRole
// ============================================================================

/**
 * Revoke a community's financial-controls grant.
 *
 * DELIBERATELY NOT behind `requireGroupGivingEnabled`, matching
 * `revokeFundRole` and the card de-escalation mutations: revoking only ever
 * takes power away, and the moment you most need to strip a compromised
 * finance admin is an incident — which is exactly when someone has flipped
 * the kill switch off (lib/finance/flag.ts's carve-out).
 *
 * There is no "last admin" guard, unlike `revokeFundRole`. There cannot be a
 * lockout to guard against: the primary admin's access is implicit and
 * survives every revoke. Revoking your own last row is therefore allowed —
 * and the primary admin, whose power is not a row at all, cannot revoke it
 * from themselves even by trying.
 */
export const revokeCommunityFinanceRole = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    await requirePrimaryAdminForFinance(ctx, args.communityId, callerId);

    const existing = await getActiveCommunityFinanceRole(
      ctx,
      args.userId,
      args.communityId,
    );
    if (!existing) {
      throw new ConvexError(
        "This user doesn't have financial-controls access on this community",
      );
    }

    await ctx.db.patch(existing._id, { revokedAt: now() });

    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      actorUserId: callerId,
      action: "community_role.revoked",
      details: { targetUserId: args.userId, role: "finance_admin" },
    });
  },
});
