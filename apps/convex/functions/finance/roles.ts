/**
 * Fund role management (ADR-032 §4) — who can hold a card, approve/deny
 * expenses, or assign further roles on a fund. Separate from group roles: a
 * trusted treasurer doesn't need to be a group leader, and a leader can't
 * move money without a fund role of their own (except for granting/revoking
 * roles, which the ADR carves out for active leaders — see
 * `requireFundRoleOrGroupLeader` in lib/helpers.ts).
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { now, getDisplayName, getMediaUrl } from "../../lib/utils";
import { isCommunityAdmin } from "../../lib/permissions";
import { logFinanceAudit } from "../../lib/finance/audit";
import {
  requireFundRoleOrGroupLeader,
  isActiveMember,
  isGroupLeader,
} from "../../lib/helpers";

const fundRoleValidator = v.union(
  v.literal("finance_admin"),
  v.literal("manager"),
  v.literal("cardholder"),
);

/** Shape returned for every role row's associated user, mirroring groupMembers.list. */
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

/** Find this user's currently-active (non-revoked) fundRoles row, if any. */
async function getActiveRoleRow(
  ctx: { db: any },
  fundId: Id<"funds">,
  userId: Id<"users">,
): Promise<Doc<"fundRoles"> | null> {
  const rows = await ctx.db
    .query("fundRoles")
    .withIndex("by_user_fund", (q: any) =>
      q.eq("userId", userId).eq("fundId", fundId),
    )
    .collect();
  return rows.find((r: Doc<"fundRoles">) => r.revokedAt === undefined) ?? null;
}

// ============================================================================
// listFundRoles
// ============================================================================

/**
 * Every role grant on a fund — active and revoked — with user display info,
 * for the fund's roles-management screen. Manager+ or an active group leader
 * only; a fund's role roster is not general membership information.
 */
export const listFundRoles = query({
  args: { token: v.string(), fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireFundRoleOrGroupLeader(ctx, args.fundId, userId, "manager");

    const rows = await ctx.db
      .query("fundRoles")
      .withIndex("by_fund", (q) => q.eq("fundId", args.fundId))
      .collect();

    const roleRank: Record<string, number> = {
      finance_admin: 0,
      manager: 1,
      cardholder: 2,
    };
    rows.sort((a, b) => {
      // Active roles first, ranked finance_admin > manager > cardholder;
      // revoked roles last, most recently revoked first.
      const aActive = a.revokedAt === undefined;
      const bActive = b.revokedAt === undefined;
      if (aActive !== bActive) return aActive ? -1 : 1;
      if (aActive) return roleRank[a.role] - roleRank[b.role];
      return (b.revokedAt ?? 0) - (a.revokedAt ?? 0);
    });

    const users = await Promise.all(rows.map((r) => ctx.db.get(r.userId)));

    return rows.map((row, i) => ({
      id: row._id,
      userId: row.userId,
      role: row.role,
      grantedBy: row.grantedBy,
      grantedAt: row.grantedAt,
      revokedAt: row.revokedAt,
      isActive: row.revokedAt === undefined,
      user: toUserSummary(users[i]),
    }));
  },
});

// ============================================================================
// getMyFundRole
// ============================================================================

/**
 * The viewer's own active role on a fund (or null), plus whether they're an
 * active leader of the fund's group and/or a community admin — the three
 * ways ADR-032 §4 grants elevated fund access. Powers UI gating for the
 * mobile roles/approvals screens without a second round-trip.
 */
export const getMyFundRole = query({
  args: { token: v.string(), fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    const roleRow = await getActiveRoleRow(ctx, args.fundId, userId);

    let leader = false;
    if (fund.groupId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", fund.groupId!).eq("userId", userId),
        )
        .first();
      leader = isGroupLeader(membership);
    }

    const admin = await isCommunityAdmin(ctx, fund.communityId, userId);

    return {
      role: roleRow?.role ?? null,
      isGroupLeader: leader,
      isCommunityAdmin: admin,
    };
  },
});

// ============================================================================
// grantFundRole
// ============================================================================

/**
 * Grant (or re-grant) a fund role to a user. Upsert semantics: a user can
 * only ever have one ACTIVE role per fund, so an existing active grant is
 * revoked in the same call before the new one is inserted — never two active
 * rows for the same (user, fund).
 */
export const grantFundRole = mutation({
  args: {
    token: v.string(),
    fundId: v.id("funds"),
    userId: v.id("users"),
    role: fundRoleValidator,
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    await requireFundRoleOrGroupLeader(ctx, args.fundId, callerId, "finance_admin");

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    // Fund roles are only meaningful for members of the fund's group — a
    // grant to someone who isn't (or is no longer) in the group would be
    // unactionable. The community's "general" fund has no group, so that
    // check doesn't apply there (any community member can be trusted with
    // it, same as the community-admin override already can).
    if (fund.groupId) {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", fund.groupId!).eq("userId", args.userId),
        )
        .first();
      if (!isActiveMember(membership)) {
        throw new Error(
          "Target user must be an active member of this fund's group",
        );
      }
    }

    const existing = await getActiveRoleRow(ctx, args.fundId, args.userId);
    const previousRole = existing?.role;
    if (existing) {
      await ctx.db.patch(existing._id, { revokedAt: now() });
    }

    const timestamp = now();
    const roleId = await ctx.db.insert("fundRoles", {
      fundId: args.fundId,
      userId: args.userId,
      role: args.role,
      grantedBy: callerId,
      grantedAt: timestamp,
    });

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: callerId,
      action: "role.granted",
      details: { targetUserId: args.userId, role: args.role, previousRole },
    });

    return roleId;
  },
});

// ============================================================================
// revokeFundRole
// ============================================================================

/**
 * Revoke a user's active role on a fund. Guarded so an active fund can never
 * be left with zero finance_admins by a non-admin caller — someone must hold
 * the keys. A community admin (who can already do anything on the fund) may
 * still revoke the last one, e.g. to hand the fund off during an offboard.
 */
export const revokeFundRole = mutation({
  args: { token: v.string(), fundId: v.id("funds"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    await requireFundRoleOrGroupLeader(ctx, args.fundId, callerId, "finance_admin");

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }

    const existing = await getActiveRoleRow(ctx, args.fundId, args.userId);
    if (!existing) {
      throw new Error("This user does not have an active role on this fund");
    }

    if (existing.role === "finance_admin" && fund.status === "active") {
      const callerIsCommunityAdmin = await isCommunityAdmin(
        ctx,
        fund.communityId,
        callerId,
      );
      if (!callerIsCommunityAdmin) {
        const activeAdmins = await ctx.db
          .query("fundRoles")
          .withIndex("by_fund", (q) => q.eq("fundId", args.fundId))
          .collect();
        const otherActiveAdmins = activeAdmins.filter(
          (r) =>
            r.role === "finance_admin" &&
            r.revokedAt === undefined &&
            r._id !== existing._id,
        );
        if (otherActiveAdmins.length === 0) {
          throw new Error(
            "Cannot revoke the last finance_admin on an active fund — grant another finance_admin first",
          );
        }
      }
    }

    await ctx.db.patch(existing._id, { revokedAt: now() });

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      actorUserId: callerId,
      action: "role.revoked",
      details: { targetUserId: args.userId, role: existing.role },
    });
  },
});
