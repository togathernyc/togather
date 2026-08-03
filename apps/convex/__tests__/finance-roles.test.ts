/**
 * Who assigns fund roles (ADR-032 §4, as amended by ADR-033 Phase 3).
 *
 * This file used to pin the GROUP-LEADER CARVE-OUT: `requireFundRoleOrGroupLeader`
 * let an active leader through a `finance_admin` gate on their own fund, and the
 * tests proved the bootstrap worked while the self-grant ladder (leader → grant
 * self finance_admin → issue self a card) stayed closed.
 *
 * The carve-out is gone. Blocking the SELF-grant only ever closed one rung: two
 * leaders of the same group could still grant each other, and at a
 * bring-your-own card provider the resulting card spends the church's pooled
 * account rather than a per-fund one — so a group could appoint its own spender
 * over money that isn't only theirs. Granting is a COMMUNITY act now, and these
 * tests pin the new line: everyone who could grant yesterday and can't today,
 * and the community finance admin who can, from outside the group.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-roles.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// createFundCard schedules provisionCard, which would reach Increase on a
// real timer. Freezing timers keeps it queued and unrun (same hazard, same
// remedy, as finance-onboarding.test.ts).
vi.useFakeTimers();

interface RolesFixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  fundId: Id<"funds">;
  /** Active group leader. No fund role — the carve-out is their only way in. */
  leaderUserId: Id<"users">;
  /** Active group leader who is ALSO a community admin. */
  adminLeaderUserId: Id<"users">;
  /** Plain active group member. */
  memberUserId: Id<"users">;
  /** Holds finance_admin on the fund via a real grant. No community standing. */
  financeAdminUserId: Id<"users">;
  /**
   * Community admin + an active `communityFinanceRoles` grant, and NOT a member
   * of the fund's group — the shape ADR-033 Phase 3 puts in charge of grants.
   */
  communityFinanceUserId: Id<"users">;
}

async function seedRolesFixture(
  t: ReturnType<typeof convexTest>,
): Promise<RolesFixture> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    const suffix = Math.floor(Math.random() * 1_000_000);

    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: timestamp,
    });

    const communityId = await ctx.db.insert("communities", {
      name: "Roles Church",
      slug: `roles-church-${suffix}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.insert("communityFinance", {
      communityId,
      legalName: "Roles Church Inc",
      ein: "12-3456789",
      address: {
        addressLine1: "1 Main St",
        city: "Austin",
        state: "TX",
        zipCode: "78701",
      },
      onboardingStatus: "live" as const,
      stripeConnectedAccountId: "acct_live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_receiving_live",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Young Adults",
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const mkUser = async (name: string) =>
      ctx.db.insert("users", {
        firstName: name,
        lastName: "User",
        phone: `+1555${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const leaderUserId = await mkUser("Leader");
    const adminLeaderUserId = await mkUser("AdminLeader");
    const memberUserId = await mkUser("Member");
    const financeAdminUserId = await mkUser("Treasurer");
    const communityFinanceUserId = await mkUser("CommunityFinance");

    for (const [userId, roles] of [
      [leaderUserId, 1],
      [adminLeaderUserId, 3], // COMMUNITY_ROLES.ADMIN
      [memberUserId, 1],
      [financeAdminUserId, 1],
      [communityFinanceUserId, 3], // COMMUNITY_ROLES.ADMIN
    ] as const) {
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    for (const [userId, role] of [
      [leaderUserId, "leader"],
      [adminLeaderUserId, "leader"],
      [memberUserId, "member"],
      [financeAdminUserId, "member"],
    ] as const) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role,
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    }

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Young Adults Fund",
      type: "group" as const,
      increaseAccountId: "account_group_live",
      status: "active" as const,
      balanceCents: 50_000,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("fundRoles", {
      fundId,
      userId: financeAdminUserId,
      role: "finance_admin" as const,
      grantedBy: adminLeaderUserId,
      grantedAt: timestamp,
    });

    // The grant that makes `communityFinanceUserId` a community finance admin.
    // `adminLeaderUserId` deliberately gets none: a plain community admin is
    // exactly who ADR-033 §5 took this power away from.
    await ctx.db.insert("communityFinanceRoles", {
      communityId,
      userId: communityFinanceUserId,
      role: "finance_admin" as const,
      grantedBy: adminLeaderUserId,
      grantedAt: timestamp,
    });

    return {
      communityId,
      groupId,
      fundId,
      leaderUserId,
      adminLeaderUserId,
      memberUserId,
      financeAdminUserId,
      communityFinanceUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

// ============================================================================
// Granting is a community act
// ============================================================================

describe("grantFundRole — community finance administers", () => {
  test("a community finance admin outside the group grants a fund role", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await t.mutation(api.functions.finance.roles.grantFundRole, {
      token: await tokenFor(s.communityFinanceUserId),
      fundId: s.fundId,
      userId: s.memberUserId,
      role: "finance_admin",
    });

    const roles = await t.run((ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", s.memberUserId).eq("fundId", s.fundId),
        )
        .collect(),
    );
    expect(roles).toHaveLength(1);
    expect(roles[0].role).toBe("finance_admin");
    expect(roles[0].grantedBy).toBe(s.communityFinanceUserId);
  });

  test("a group leader can no longer grant — and is told who can", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(s.leaderUserId),
        fundId: s.fundId,
        userId: s.memberUserId,
        role: "finance_admin",
      }),
    ).rejects.toThrow(/financial-controls access/i);

    const roles = await t.run((ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", s.memberUserId).eq("fundId", s.fundId),
        )
        .collect(),
    );
    expect(roles).toHaveLength(0);
  });

  test("the whole escalation chain is closed at its first rung", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);
    const token = await tokenFor(s.leaderUserId);

    // No self-grant...
    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token,
        fundId: s.fundId,
        userId: s.leaderUserId,
        role: "finance_admin",
      }),
    ).rejects.toThrow(/financial-controls access/i);

    // ...and no grant to a WILLING SECOND LEADER either, which is the rung the
    // old self-grant guard left open.
    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token,
        fundId: s.fundId,
        userId: s.adminLeaderUserId,
        role: "finance_admin",
      }),
    ).rejects.toThrow(/financial-controls access/i);

    // ...and the card at the end of the chain is refused on its own gate too.
    await expect(
      t.mutation(api.functions.finance.cards.createFundCard, {
        token,
        fundId: s.fundId,
        holderUserId: s.leaderUserId,
        name: "Leader Card",
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });

  test("a fund's own finance_admin can no longer grant", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(s.financeAdminUserId),
        fundId: s.fundId,
        userId: s.memberUserId,
        role: "cardholder",
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });

  test("a plain community admin with no financial-controls grant can no longer grant", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(s.adminLeaderUserId),
        fundId: s.fundId,
        userId: s.memberUserId,
        role: "cardholder",
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });

  test("a plain member is refused outright", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(s.memberUserId),
        fundId: s.fundId,
        userId: s.memberUserId,
        role: "cardholder",
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });

  test("the target must still be an active member of the fund's group", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    // `communityFinanceUserId` is not in the group — a grant to them would be
    // unactionable, and the community gate does not relax that.
    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(s.communityFinanceUserId),
        fundId: s.fundId,
        userId: s.communityFinanceUserId,
        role: "finance_admin",
      }),
    ).rejects.toThrow(/active member/i);
  });
});

// ============================================================================
// Revoking moves with granting
// ============================================================================

describe("revokeFundRole — community finance administers", () => {
  test("a community finance admin revokes the fund's last finance_admin", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await t.mutation(api.functions.finance.roles.revokeFundRole, {
      token: await tokenFor(s.communityFinanceUserId),
      fundId: s.fundId,
      userId: s.financeAdminUserId,
    });

    const active = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", s.financeAdminUserId).eq("fundId", s.fundId),
        )
        .collect();
      return rows.filter((r) => r.revokedAt === undefined);
    });
    expect(active).toHaveLength(0);
  });

  test("a group leader can no longer revoke", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.revokeFundRole, {
        token: await tokenFor(s.leaderUserId),
        fundId: s.fundId,
        userId: s.financeAdminUserId,
      }),
    ).rejects.toThrow(/financial-controls access/i);
  });

  test("revoking stays reachable with the group-giving kill switch OFF", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);
    await t.run(async (ctx) => {
      const flag = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "group-giving"))
        .first();
      await ctx.db.patch(flag!._id, { enabled: false });
    });

    await t.mutation(api.functions.finance.roles.revokeFundRole, {
      token: await tokenFor(s.communityFinanceUserId),
      fundId: s.fundId,
      userId: s.financeAdminUserId,
    });

    // ...while GRANTING, which adds power, is still blocked by the flag.
    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(s.communityFinanceUserId),
        fundId: s.fundId,
        userId: s.memberUserId,
        role: "cardholder",
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Operational surfaces are untouched
// ============================================================================

describe("fund roles keep their operational reach", () => {
  test("a group leader still sees the fund's role roster", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    const rows = await t.query(api.functions.finance.roles.listFundRoles, {
      token: await tokenFor(s.leaderUserId),
      fundId: s.fundId,
    });
    expect(
      rows.some((r: { userId: string }) => r.userId === s.financeAdminUserId),
    ).toBe(true);
  });

  test("getMyFundRole reports the community signal separately from the fund one", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    const leader = await t.query(api.functions.finance.roles.getMyFundRole, {
      token: await tokenFor(s.leaderUserId),
      fundId: s.fundId,
    });
    expect(leader.isGroupLeader).toBe(true);
    expect(leader.canManageCommunityFinance).toBe(false);

    const finance = await t.query(api.functions.finance.roles.getMyFundRole, {
      token: await tokenFor(s.communityFinanceUserId),
      fundId: s.fundId,
    });
    expect(finance.canManageCommunityFinance).toBe(true);
    expect(finance.hasCommunityAdminFundOverride).toBe(true);
  });
});

