/**
 * `giving.getCommunityFinanceOverview` — the community Finance home's one
 * round trip (ADR-032/033).
 *
 * The screen is a list of rows whose SUBTITLES are these numbers, so what
 * matters here is the arithmetic and the window: a donation from last month
 * must not appear in "this month", a card that was canceled must not be
 * counted as a card the fund has, and fees/refunds must not be read as spend
 * (they aren't spend, and `getFundOverview` already says so per-fund — the two
 * screens have to agree).
 *
 * Plus the gate: ADR-033 moved community-level finance off "plain community
 * admin", so a plain admin must be REFUSED here and a granted one must pass.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-community-overview.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const ADDRESS = {
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

interface Fixture {
  communityId: Id<"communities">;
  primaryAdminUserId: Id<"users">; // roles === 4 — implicit finance access
  plainAdminUserId: Id<"users">; // roles === 3, no grant — must be denied
  grantedAdminUserId: Id<"users">; // roles === 3 + a communityFinanceRoles row
  fundedGroupId: Id<"groups">;
  unfundedGroupId: Id<"groups">;
  archivedGroupId: Id<"groups">;
  fundId: Id<"funds">;
  generalFundId: Id<"funds">;
}

function startOfMonthUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

async function seed(
  t: ReturnType<typeof convexTest>,
  opts: { onboardingStatus?: string; groupGiving?: boolean } = {},
): Promise<Fixture> {
  return await t.run(async (ctx) => {
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: opts.groupGiving ?? true,
      updatedAt: Date.now(),
    });
    const timestamp = Date.now();
    const suffix = Math.floor(Math.random() * 1_000_000);

    const communityId = await ctx.db.insert("communities", {
      name: "Test Church",
      slug: `test-church-${suffix}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const mkUser = async (name: string) =>
      ctx.db.insert("users", {
        firstName: name,
        lastName: "User",
        phone: `+1555000${Math.floor(Math.random() * 9000 + 1000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const primaryAdminUserId = await mkUser("Primary");
    const plainAdminUserId = await mkUser("PlainAdmin");
    const grantedAdminUserId = await mkUser("GrantedAdmin");

    const membership = async (userId: Id<"users">, roles: number) =>
      ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    await membership(primaryAdminUserId, 4);
    await membership(plainAdminUserId, 3);
    await membership(grantedAdminUserId, 3);

    await ctx.db.insert("communityFinanceRoles", {
      communityId,
      userId: grantedAdminUserId,
      role: "finance_admin",
      grantedBy: primaryAdminUserId,
      grantedAt: timestamp,
    });

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: "acct_test",
      increaseEntityId: "entity_test",
      increaseReceivingAccountId: "increase_account_receiving_test",
      cardProvider: "privacy",
      onboardingStatus: (opts.onboardingStatus ?? "live") as any,
      legalName: "Test Church",
      ein: "12-3456789",
      address: ADDRESS,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: `small-group-${suffix}`,
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });
    const mkGroup = async (name: string, isArchived = false) =>
      ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name,
        isArchived,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    // Deliberately inserted out of alphabetical order — the query sorts.
    const unfundedGroupId = await mkGroup("Youth");
    const fundedGroupId = await mkGroup("Worship Team");
    const archivedGroupId = await mkGroup("Alumni", true);

    const generalFundId = await ctx.db.insert("funds", {
      communityId,
      name: "General Fund",
      type: "general",
      status: "active",
      balanceCents: 100_00,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId: fundedGroupId,
      name: "Worship Team Fund",
      type: "group",
      status: "active",
      balanceCents: 250_00,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      communityId,
      primaryAdminUserId,
      plainAdminUserId,
      grantedAdminUserId,
      fundedGroupId,
      unfundedGroupId,
      archivedGroupId,
      fundId,
      generalFundId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

function overview(t: ReturnType<typeof convexTest>, f: Fixture, userId: Id<"users">) {
  return tokenFor(userId).then((token) =>
    t.query(api.functions.finance.giving.getCommunityFinanceOverview, {
      token,
      communityId: f.communityId,
    }),
  );
}

// ============================================================================
// The gate
// ============================================================================

describe("getCommunityFinanceOverview — access", () => {
  test("the primary admin sees it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const result = await overview(t, f, f.primaryAdminUserId);
    expect(result.funds).toHaveLength(2);
  });

  test("a community admin WITH a financial-controls grant sees it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const result = await overview(t, f, f.grantedAdminUserId);
    expect(result.funds).toHaveLength(2);
  });

  test("a plain community admin is refused (ADR-033 §5)", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await expect(overview(t, f, f.plainAdminUserId)).rejects.toThrow(
      /financial-controls access/i,
    );
  });

  test("the whole surface is behind the group-giving flag", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, { groupGiving: false });
    await expect(overview(t, f, f.primaryAdminUserId)).rejects.toThrow();
  });
});

// ============================================================================
// getMyCommunityFinanceAccess — the non-throwing "may I offer this?" answer
// ============================================================================

describe("getMyCommunityFinanceAccess", () => {
  const ask = (
    t: ReturnType<typeof convexTest>,
    f: Fixture,
    userId: Id<"users">,
  ) =>
    tokenFor(userId).then((token) =>
      t.query(api.functions.finance.communityRoles.getMyCommunityFinanceAccess, {
        token,
        communityId: f.communityId,
      }),
    );

  test("says yes to the primary admin, with the precondition they need", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    expect(await ask(t, f, f.primaryAdminUserId)).toEqual({
      canManage: true,
      onboardingStatus: "live",
      canEnableGiving: true,
    });
  });

  test("says yes to a granted admin", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    expect((await ask(t, f, f.grantedAdminUserId)).canManage).toBe(true);
  });

  // The whole point: it ANSWERS for a non-holder instead of throwing, so the
  // group Giving hub can pick an empty state rather than crash into a boundary.
  test("says no to a plain admin without throwing", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    expect(await ask(t, f, f.plainAdminUserId)).toEqual({
      canManage: false,
      onboardingStatus: null,
      canEnableGiving: false,
    });
  });

  test("a holder learns giving isn't live yet, so the row can say why", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, { onboardingStatus: "verifying" });
    const result = await ask(t, f, f.primaryAdminUserId);
    expect(result.canManage).toBe(true);
    expect(result.canEnableGiving).toBe(false);
    expect(result.onboardingStatus).toBe("verifying");
  });
});

// ============================================================================
// The month window and the arithmetic
// ============================================================================

describe("getCommunityFinanceOverview — aggregation", () => {
  test("counts this month's donations and spend, and no earlier ones", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const nowMs = Date.now();
    const thisMonth = nowMs - 1_000;
    const lastMonth = startOfMonthUTC(nowMs) - 24 * 60 * 60 * 1000;

    await t.run(async (ctx) => {
      const entry = (
        direction: "credit" | "debit",
        amountCents: number,
        kind: string,
        createdAt: number,
        key: string,
      ) =>
        ctx.db.insert("ledgerEntries", {
          fundId: f.fundId,
          communityId: f.communityId,
          direction,
          amountCents,
          kind: kind as any,
          idempotencyKey: key,
          createdAt,
        });

      await entry("credit", 5_000, "donation", thisMonth, "d1");
      await entry("credit", 2_500, "donation", thisMonth, "d2");
      await entry("debit", 1_200, "card_capture", thisMonth, "s1");
      await entry("debit", 800, "reimbursement", thisMonth, "s2");
      // Fees and refunds are NOT spend — same rule as getFundOverview.
      await entry("debit", 150, "fee", thisMonth, "f1");
      await entry("debit", 900, "refund", thisMonth, "r1");
      // Last month — must be outside the window entirely.
      await entry("credit", 90_000, "donation", lastMonth, "d-old");
      await entry("debit", 40_000, "card_capture", lastMonth, "s-old");
    });

    const result = await overview(t, f, f.primaryAdminUserId);
    const worship = result.funds.find((row) => row.fundId === f.fundId)!;

    expect(worship.monthDonatedCents).toBe(7_500);
    expect(worship.monthSpentCents).toBe(2_000);
    expect(worship.balanceCents).toBe(250_00);
    expect(worship.groupName).toBe("Worship Team");
    expect(worship.groupId).toBe(f.fundedGroupId);
  });

  test("community totals sum every fund, general included", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const thisMonth = Date.now() - 1_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("ledgerEntries", {
        fundId: f.fundId,
        communityId: f.communityId,
        direction: "credit",
        amountCents: 4_000,
        kind: "donation",
        idempotencyKey: "t-d1",
        createdAt: thisMonth,
      });
      await ctx.db.insert("ledgerEntries", {
        fundId: f.generalFundId,
        communityId: f.communityId,
        direction: "credit",
        amountCents: 1_000,
        kind: "donation",
        idempotencyKey: "t-d2",
        createdAt: thisMonth,
      });
      await ctx.db.insert("ledgerEntries", {
        fundId: f.generalFundId,
        communityId: f.communityId,
        direction: "debit",
        amountCents: 600,
        kind: "card_capture",
        idempotencyKey: "t-s1",
        createdAt: thisMonth,
      });
    });

    const result = await overview(t, f, f.primaryAdminUserId);

    expect(result.totals.balanceCents).toBe(350_00);
    expect(result.totals.monthDonatedCents).toBe(5_000);
    expect(result.totals.monthSpentCents).toBe(600);
    expect(result.totals.fundCount).toBe(2);
  });

  test("counts live cards only — a canceled card isn't a card the fund has", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      const timestamp = Date.now();
      const holderUserId = f.primaryAdminUserId;
      const mkCard = (status: string, key: string) =>
        ctx.db.insert("cards", {
          fundId: f.fundId,
          holderUserId,
          provider: "privacy",
          providerCardId: key,
          status,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      await mkCard("active", "c1");
      await mkCard("pending", "c2"); // about to exist — alive
      await mkCard("canceled", "c3");
      await mkCard("failed", "c4");
    });

    const result = await overview(t, f, f.primaryAdminUserId);
    const worship = result.funds.find((row) => row.fundId === f.fundId)!;

    expect(worship.cardCount).toBe(2);
    expect(result.totals.cardCount).toBe(2);
  });

  test("the general fund sorts first and carries no group", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const result = await overview(t, f, f.primaryAdminUserId);

    expect(result.funds[0].type).toBe("general");
    expect(result.funds[0].groupId).toBeNull();
    expect(result.funds[0].groupName).toBeNull();
  });
});

// ============================================================================
// Groups that have no fund yet — the "Enable giving" rows
// ============================================================================

describe("getCommunityFinanceOverview — groups without funds", () => {
  test("lists un-funded groups and excludes funded and archived ones", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const result = await overview(t, f, f.primaryAdminUserId);

    expect(result.groupsWithoutFunds).toEqual([
      { groupId: f.unfundedGroupId, groupName: "Youth" },
    ]);
  });

  test("canEnableGiving is true only once the community's giving is live", async () => {
    const t = convexTest(schema, modules);
    const live = await seed(t);
    expect((await overview(t, live, live.primaryAdminUserId)).canEnableGiving).toBe(
      true,
    );

    const t2 = convexTest(schema, modules);
    const pending = await seed(t2, { onboardingStatus: "verifying" });
    const result = await overview(t2, pending, pending.primaryAdminUserId);
    expect(result.canEnableGiving).toBe(false);
    expect(result.onboardingStatus).toBe("verifying");
  });
});

// ============================================================================
// The plumbing rows
// ============================================================================

describe("getCommunityFinanceOverview — plumbing rows", () => {
  test("reports the provider and whether it is connected", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const disconnected = await overview(t, f, f.primaryAdminUserId);
    expect(disconnected.provider.name).toBe("privacy");
    expect(disconnected.provider.connected).toBe(false);
    expect(disconnected.provider.accountLabel).toBeNull();

    await t.run(async (ctx) => {
      const timestamp = Date.now();
      await ctx.db.insert("cardProviderConnections", {
        communityId: f.communityId,
        provider: "privacy",
        credentialCiphertext: "x",
        credentialIv: "y",
        keyVersion: 1,
        accountLabel: "Grace Church Ops",
        status: "active",
        connectedById: f.primaryAdminUserId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const connected = await overview(t, f, f.primaryAdminUserId);
    expect(connected.provider.connected).toBe(true);
    expect(connected.provider.accountLabel).toBe("Grace Church Ops");
    expect(connected.provider.status).toBe("active");
  });

  test("counts active financial-controls grants, not revoked ones", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    expect((await overview(t, f, f.primaryAdminUserId)).financeGrantCount).toBe(1);

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("communityFinanceRoles")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .first();
      await ctx.db.patch(row!._id, { revokedAt: Date.now() });
    });

    expect((await overview(t, f, f.primaryAdminUserId)).financeGrantCount).toBe(0);
  });
});

// ============================================================================
// Empty states
// ============================================================================

describe("getCommunityFinanceOverview — empty states", () => {
  test("a community with no funds returns zeroed totals, not nulls", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(f.fundId);
      await ctx.db.delete(f.generalFundId);
    });

    const result = await overview(t, f, f.primaryAdminUserId);

    expect(result.funds).toEqual([]);
    expect(result.totals).toEqual({
      balanceCents: 0,
      monthDonatedCents: 0,
      monthSpentCents: 0,
      cardCount: 0,
      fundCount: 0,
    });
    // Both live groups are now enable-able.
    expect(result.groupsWithoutFunds.map((g) => g.groupName)).toEqual([
      "Worship Team",
      "Youth",
    ]);
  });

  test("a community that never started onboarding still answers", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .first();
      await ctx.db.delete(row!._id);
    });

    const result = await overview(t, f, f.primaryAdminUserId);
    expect(result.onboardingStatus).toBeNull();
    expect(result.canEnableGiving).toBe(false);
    expect(result.provider.name).toBe("none");
  });
});
