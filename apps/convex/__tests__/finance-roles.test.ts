/**
 * Fund role grants and the group-leader carve-out (ADR-032 §4).
 *
 * `requireFundRoleOrGroupLeader` lets an active group leader through a
 * `finance_admin` gate on their own group's fund with no fund role of their
 * own. That carve-out is deliberate — the ADR says finance roles are "granted
 * by group leaders and finance admins", and it's how a fund gets its first
 * treasurer. What it must never be is a self-service privilege ladder:
 * leader → grant self finance_admin → issue self a card → spend the fund
 * alone. These tests pin both halves: the bootstrap still works, the ladder
 * doesn't.
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
  /** Holds finance_admin on the fund via a real grant. */
  financeAdminUserId: Id<"users">;
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

    for (const [userId, roles] of [
      [leaderUserId, 1],
      [adminLeaderUserId, 3], // COMMUNITY_ROLES.ADMIN
      [memberUserId, 1],
      [financeAdminUserId, 1],
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

    return {
      communityId,
      groupId,
      fundId,
      leaderUserId,
      adminLeaderUserId,
      memberUserId,
      financeAdminUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

// ============================================================================
// The self-escalation hole
// ============================================================================

describe("grantFundRole — group-leader carve-out", () => {
  test("a group leader cannot grant themselves finance_admin", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(s.leaderUserId),
        fundId: s.fundId,
        userId: s.leaderUserId,
        role: "finance_admin",
      }),
    ).rejects.toThrow(/can't give yourself a finance role/i);

    const roles = await t.run((ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", s.leaderUserId).eq("fundId", s.fundId),
        )
        .collect(),
    );
    expect(roles).toHaveLength(0);
  });

  test("the carve-out grants nothing to self at any rank", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);
    const token = await tokenFor(s.leaderUserId);

    for (const role of ["manager", "cardholder"] as const) {
      await expect(
        t.mutation(api.functions.finance.roles.grantFundRole, {
          token,
          fundId: s.fundId,
          userId: s.leaderUserId,
          role,
        }),
      ).rejects.toThrow(/can't give yourself a finance role/i);
    }
  });

  test("the full escalation chain is closed: no self-grant, so no self-issued card", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);
    const token = await tokenFor(s.leaderUserId);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token,
        fundId: s.fundId,
        userId: s.leaderUserId,
        role: "finance_admin",
      }),
    ).rejects.toThrow();

    // createFundCard gates on a real finance_admin (no leader carve-out), so
    // with the self-grant blocked the leader still can't put the fund on a
    // card in their own pocket.
    await expect(
      t.mutation(api.functions.finance.cards.createFundCard, {
        token,
        fundId: s.fundId,
        holderUserId: s.leaderUserId,
        name: "Leader Card",
      }),
    ).rejects.toThrow(/finance_admin/i);
  });

  test("the ADR's bootstrap still works: a leader grants finance_admin to someone else", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await t.mutation(api.functions.finance.roles.grantFundRole, {
      token: await tokenFor(s.leaderUserId),
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
    expect(roles[0].grantedBy).toBe(s.leaderUserId);
  });

  test("a community admin who also leads the group may still grant to themselves", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    // They pass the gate as a community admin, not via the carve-out — an
    // admin can already do anything on any fund, so blocking them would be
    // theatre. The access-path check has to resolve admin FIRST for this.
    await t.mutation(api.functions.finance.roles.grantFundRole, {
      token: await tokenFor(s.adminLeaderUserId),
      fundId: s.fundId,
      userId: s.adminLeaderUserId,
      role: "finance_admin",
    });

    const roles = await t.run((ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", s.adminLeaderUserId).eq("fundId", s.fundId),
        )
        .collect(),
    );
    expect(roles.filter((r) => r.revokedAt === undefined)).toHaveLength(1);
  });

  test("an existing finance_admin may change their own role", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    // Through the gate on their own grant, not the carve-out — de-escalating
    // yourself (or re-granting) is not the hole being closed.
    await t.mutation(api.functions.finance.roles.grantFundRole, {
      token: await tokenFor(s.financeAdminUserId),
      fundId: s.fundId,
      userId: s.financeAdminUserId,
      role: "manager",
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
    expect(active).toHaveLength(1);
    expect(active[0].role).toBe("manager");
  });

  test("a plain member is still refused outright", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRolesFixture(t);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token: await tokenFor(s.memberUserId),
        fundId: s.fundId,
        userId: s.memberUserId,
        role: "cardholder",
      }),
    ).rejects.toThrow(/finance_admin/i);
  });
});
