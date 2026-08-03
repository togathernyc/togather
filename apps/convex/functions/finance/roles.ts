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
import { canManageCommunityFinance } from "../../lib/finance/communityFinanceAccess";
import { requireGroupGivingEnabled } from "../../lib/finance/flag";
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
    await requireGroupGivingEnabled(ctx);
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
 * active leader of the fund's group and/or hold community-wide financial
 * controls — the three ways elevated fund access is granted. Powers UI gating
 * for the mobile roles/approvals screens without a second round-trip.
 *
 * ADR-033 CHANGED THE THIRD ONE. This used to report `isCommunityAdmin`, and
 * mobile used it to unlock the community-wide finance surfaces (GivingHub's
 * admin state, the fund-roles management screen, the fund screen's manage
 * controls). It now reports `canManageCommunityFinance` — primary admin, or
 * an explicit `communityFinanceRoles` grant — so a plain community admin with
 * no grant no longer gets those surfaces implicitly. Deliberate and approved:
 * see lib/finance/communityFinanceAccess.ts for why "can run the community"
 * and "can run the community's money" are different questions.
 *
 * The FUND-level override is untouched: `requireFundRole` (lib/helpers.ts)
 * still lets any community admin through a fund gate, so nothing an admin
 * could do on a specific fund stopped working — only the community-wide
 * surfaces moved.
 *
 * Which is why `hasCommunityAdminFundOverride` is reported SEPARATELY rather
 * than folded into the field above. The two signals answer different
 * questions and a plain community admin gets different answers to them, so
 * one field cannot carry both: substituting the community-wide signal for the
 * fund-level one would make mobile hide fund settings, role management, and
 * expense approval from a user the server still authorizes — a UI stricter
 * than its backend, which reads as a bug from both ends.
 *
 * Mobile must pick per surface: `canManageCommunityFinance` for anything
 * community-wide (onboarding, enabling giving), `hasCommunityAdminFundOverride`
 * for anything a fund gate protects. Neither is a substitute for the other,
 * and neither should be approximated client-side from `user.is_admin` — that
 * flag is scoped to the viewer's ACTIVE community, not the fund's.
 */
export const getMyFundRole = query({
  args: { token: v.string(), fundId: v.id("funds") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireGroupGivingEnabled(ctx);

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

    return {
      role: roleRow?.role ?? null,
      isGroupLeader: leader,
      /** Community-WIDE finance surfaces. Primary admin or an explicit grant. */
      canManageCommunityFinance: await canManageCommunityFinance(
        ctx,
        userId,
        fund.communityId,
      ),
      /**
       * FUND-level only: mirrors the community-admin override still baked into
       * `resolveFundAccess` (lib/helpers.ts). Never gate a community-wide
       * surface on this.
       */
      hasCommunityAdminFundOverride: await isCommunityAdmin(
        ctx,
        fund.communityId,
        userId,
      ),
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
 *
 * NO SELF-ESCALATION VIA THE LEADER CARVE-OUT. ADR-032 §4 lets group leaders
 * grant finance roles on their own group's fund ("Granted by group leaders
 * and finance admins") — that bootstrap path is intentional and stays. What
 * it must never become is a one-tap privilege ladder: a leader with no fund
 * role could otherwise grant THEMSELVES finance_admin and, from there, issue
 * themselves a card (`createFundCard` gates on finance_admin) and spend the
 * fund alone. So a caller who is only through the gate because they lead the
 * group cannot name themselves as the target. Granting to someone else still
 * works — the ADR's bootstrap — and it costs a second, willing human, which
 * is the point.
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
    const via = await requireFundRoleOrGroupLeader(
      ctx,
      args.fundId,
      callerId,
      "finance_admin",
    );
    await requireGroupGivingEnabled(ctx);

    if (via === "group_leader" && args.userId === callerId) {
      throw new Error(
        "You can't give yourself a finance role on your group's fund — a finance admin or community admin has to grant it to you",
      );
    }

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
 *
 * DELIBERATELY NOT behind `requireGroupGivingEnabled`, unlike `grantFundRole`.
 * Revoking is de-escalation: it only ever takes power away. Flipping the
 * group-giving kill switch off is most likely during an incident, which is
 * precisely when someone needs to strip a compromised finance_admin — gating
 * this would lock the incident response out along with the feature. Same
 * reasoning as `setCardFrozen` / `cancelCard` in cards.ts and `denyExpense`
 * in expenses.ts. The flag still blocks every path that ADDS power or moves
 * money, so a revoke with the flag off can't be a step toward anything.
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
