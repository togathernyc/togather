/**
 * Fund role management (ADR-032 §4) — who can hold a card, approve/deny
 * expenses, or act on a fund. Separate from group roles: a trusted treasurer
 * doesn't need to be a group leader, and a leader can't move money without a
 * fund role of their own.
 *
 * WHO ASSIGNS THEM CHANGED IN ADR-033 PHASE 3. ADR-032 §4 let group leaders
 * grant finance roles on their own group's fund, guarded only against naming
 * THEMSELVES. That guard bought less than it looked like: two leaders of the
 * same group could grant each other, and a fund finance_admin could then issue
 * themselves a card — which at a bring-your-own provider spends the CHURCH's
 * pooled account, not a per-fund one the bank keeps separate. The whole ladder
 * ran inside one group with nobody outside it in the loop.
 *
 * So the founder-approved rule is now: GROUPS OPERATE, COMMUNITY FINANCE
 * ADMINISTERS. Granting and revoking a fund role is a community act
 * (`requireCommunityFinanceAccess` — the primary admin or an explicit
 * `communityFinanceRoles` grant), and it can be performed from outside the
 * group. What the group keeps is everything OPERATIONAL, unchanged: a
 * cardholder uses their card, a manager approves and denies reimbursements,
 * a leader still sees the fund's roster, transactions and balance, and
 * freeze/cancel remain reachable by the fund's own finance_admin.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { now, getDisplayName, getMediaUrl } from "../../lib/utils";
import { isCommunityAdmin } from "../../lib/permissions";
import { logFinanceAudit } from "../../lib/finance/audit";
import {
  canManageCommunityFinance,
  requireCommunityFinanceAccess,
} from "../../lib/finance/communityFinanceAccess";
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
 * COMMUNITY FINANCE ONLY (ADR-033 Phase 3) — see this module's header. Group
 * leaders and fund finance_admins no longer grant, which removes the ladder
 * that let a group appoint its own spender. The caller may be entirely outside
 * the fund's group; that is the point, and it is why the mutation gates on the
 * COMMUNITY rather than on the fund.
 *
 * The old `via === "group_leader"` self-grant guard is gone with the carve-out
 * it guarded — but the property it protected still holds, more simply: a
 * community finance admin granting themselves a fund role escalates nothing,
 * because `requireFundRole`'s community-admin override already lets them act on
 * every fund in the community. There is no ladder left to climb.
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

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }
    await requireCommunityFinanceAccess(ctx, callerId, fund.communityId);
    await requireGroupGivingEnabled(ctx);

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
 * Revoke a user's active role on a fund.
 *
 * COMMUNITY FINANCE ONLY, same as `grantFundRole` — the two have to move
 * together. Leaving revoke with the fund gate while grant moved to the
 * community would let a fund's own finance_admin revoke the person the
 * community just appointed, which is the same ladder from the other end.
 *
 * DELIBERATELY NOT behind `requireGroupGivingEnabled`, unlike `grantFundRole`.
 * Revoking is de-escalation: it only ever takes power away. Flipping the
 * group-giving kill switch off is most likely during an incident, which is
 * precisely when someone needs to strip a compromised finance_admin — gating
 * this would lock the incident response out along with the feature. Same
 * reasoning as `setCardFrozen` / `cancelCard` in cards.ts and `denyExpense`
 * in expenses.ts. The flag still blocks every path that ADDS power or moves
 * money, so a revoke with the flag off can't be a step toward anything.
 *
 * THE "LAST finance_admin" GUARD IS GONE, and it is a deletion rather than an
 * oversight. It existed to stop a non-community-admin caller — a group leader,
 * or a fund finance_admin — from stranding an active fund with nobody holding
 * the keys, and it explicitly exempted community admins, who could already do
 * anything on the fund. ADR-033 Phase 3 makes EVERY caller here a community
 * finance holder, i.e. exactly the class the old guard exempted, so the branch
 * could only ever have evaluated to "allowed". A guard that cannot fire is
 * worse than none: it reads as protection that isn't there.
 */
export const revokeFundRole = mutation({
  args: { token: v.string(), fundId: v.id("funds"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      throw new Error("Fund not found");
    }
    await requireCommunityFinanceAccess(ctx, callerId, fund.communityId);

    const existing = await getActiveRoleRow(ctx, args.fundId, args.userId);
    if (!existing) {
      throw new Error("This user does not have an active role on this fund");
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
