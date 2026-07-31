/**
 * Group giving ledger + fund-role permission tests (ADR-032 foundation layer).
 *
 * Covers lib/finance/ledger.ts (append-only posting, idempotency, paired
 * transfers, closed/frozen fund guards, the pure balance/invariant helpers)
 * and the fund-role helpers in lib/helpers.ts (requireFundRole /
 * requireFundRoleOrGroupLeader).
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-ledger.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  postLedgerEntry,
  postPairedTransfer,
  deriveBalance,
  checkInvariant,
} from "../lib/finance/ledger";
import {
  requireFundRole,
  requireFundRoleOrGroupLeader,
  hasFundRole,
} from "../lib/helpers";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Seeding
// ============================================================================

interface FinanceFixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  fundId: Id<"funds">; // active, group-scoped
  closedFundId: Id<"funds">;
  frozenFundId: Id<"funds">;
  generalFundId: Id<"funds">; // active, community-scoped (no groupId)
  adminUserId: Id<"users">; // community admin, no fund role
  leaderUserId: Id<"users">; // active group leader, no fund role
  memberUserId: Id<"users">; // plain member, no fund role
  cardholderUserId: Id<"users">; // fundRole: cardholder
  managerUserId: Id<"users">; // fundRole: manager
  financeAdminUserId: Id<"users">; // fundRole: finance_admin
  revokedUserId: Id<"users">; // fundRole: manager, revoked
}

async function seedFinanceFixture(
  t: ReturnType<typeof convexTest>,
): Promise<FinanceFixture> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Test Church",
      slug: "test-church",
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
        phone: `+1555000${Math.floor(Math.random() * 9000 + 1000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const adminUserId = await mkUser("Admin");
    const leaderUserId = await mkUser("Leader");
    const memberUserId = await mkUser("Member");
    const cardholderUserId = await mkUser("Cardholder");
    const managerUserId = await mkUser("Manager");
    const financeAdminUserId = await mkUser("FinanceAdmin");
    const revokedUserId = await mkUser("Revoked");

    await ctx.db.insert("userCommunities", {
      userId: adminUserId,
      communityId,
      roles: 3, // COMMUNITY_ROLES.ADMIN
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderUserId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
    for (const userId of [
      memberUserId,
      cardholderUserId,
      managerUserId,
      financeAdminUserId,
      revokedUserId,
    ]) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    }

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Young Adults Fund",
      type: "group",
      status: "active",
      balanceCents: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const closedFundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Closed Fund",
      type: "group",
      status: "closed",
      balanceCents: 500,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const frozenFundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Frozen Fund",
      type: "group",
      status: "frozen",
      balanceCents: 1000,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const generalFundId = await ctx.db.insert("funds", {
      communityId,
      name: "General Fund",
      type: "general",
      status: "active",
      balanceCents: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("fundRoles", {
      fundId,
      userId: cardholderUserId,
      role: "cardholder",
      grantedBy: adminUserId,
      grantedAt: timestamp,
    });
    await ctx.db.insert("fundRoles", {
      fundId,
      userId: managerUserId,
      role: "manager",
      grantedBy: adminUserId,
      grantedAt: timestamp,
    });
    await ctx.db.insert("fundRoles", {
      fundId,
      userId: financeAdminUserId,
      role: "finance_admin",
      grantedBy: adminUserId,
      grantedAt: timestamp,
    });
    await ctx.db.insert("fundRoles", {
      fundId,
      userId: revokedUserId,
      role: "manager",
      grantedBy: adminUserId,
      grantedAt: timestamp,
      revokedAt: timestamp,
    });

    return {
      communityId,
      groupId,
      fundId,
      closedFundId,
      frozenFundId,
      generalFundId,
      adminUserId,
      leaderUserId,
      memberUserId,
      cardholderUserId,
      managerUserId,
      financeAdminUserId,
      revokedUserId,
    };
  });
}

// ============================================================================
// postLedgerEntry
// ============================================================================

describe("postLedgerEntry", () => {
  test("posting a credit updates the fund's cached balance", async () => {
    const t = convexTest(schema, modules);
    const { fundId } = await seedFinanceFixture(t);

    await t.run((ctx: MutationCtx) =>
      postLedgerEntry(ctx, {
        fundId,
        direction: "credit",
        amountCents: 2500,
        kind: "donation",
        idempotencyKey: "pi_1",
      }),
    );

    const fund = await t.run(async (ctx) => ctx.db.get(fundId));
    expect(fund?.balanceCents).toBe(2500);
  });

  test("posting a debit decreases the fund's cached balance", async () => {
    const t = convexTest(schema, modules);
    const { fundId } = await seedFinanceFixture(t);

    await t.run((ctx: MutationCtx) =>
      postLedgerEntry(ctx, {
        fundId,
        direction: "credit",
        amountCents: 5000,
        kind: "donation",
        idempotencyKey: "pi_2",
      }),
    );
    await t.run((ctx: MutationCtx) =>
      postLedgerEntry(ctx, {
        fundId,
        direction: "debit",
        amountCents: 1200,
        kind: "card_capture",
        idempotencyKey: "txn_1",
      }),
    );

    const fund = await t.run(async (ctx) => ctx.db.get(fundId));
    expect(fund?.balanceCents).toBe(3800);
  });

  test("idempotency key dedupe: second post with the same key is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { fundId } = await seedFinanceFixture(t);

    const firstId = await t.run((ctx: MutationCtx) =>
      postLedgerEntry(ctx, {
        fundId,
        direction: "credit",
        amountCents: 1000,
        kind: "donation",
        idempotencyKey: "pi_dupe",
      }),
    );
    const secondId = await t.run((ctx: MutationCtx) =>
      postLedgerEntry(ctx, {
        fundId,
        direction: "credit",
        amountCents: 1000,
        kind: "donation",
        idempotencyKey: "pi_dupe",
      }),
    );

    expect(secondId).toBe(firstId);

    const fund = await t.run(async (ctx) => ctx.db.get(fundId));
    expect(fund?.balanceCents).toBe(1000); // not 2000 — the repeat never posted

    const entries = await t.run(async (ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(entries).toHaveLength(1);
  });

  test("throws when posting to a closed fund", async () => {
    const t = convexTest(schema, modules);
    const { closedFundId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx: MutationCtx) =>
        postLedgerEntry(ctx, {
          fundId: closedFundId,
          direction: "credit",
          amountCents: 100,
          kind: "donation",
          idempotencyKey: "pi_closed",
        }),
      ),
    ).rejects.toThrow(/closed/);
  });

  test("frozen fund allows a sweep but rejects a donation", async () => {
    const t = convexTest(schema, modules);
    const { frozenFundId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx: MutationCtx) =>
        postLedgerEntry(ctx, {
          fundId: frozenFundId,
          direction: "credit",
          amountCents: 100,
          kind: "donation",
          idempotencyKey: "pi_frozen",
        }),
      ),
    ).rejects.toThrow(/frozen/);

    const sweepId = await t.run((ctx: MutationCtx) =>
      postLedgerEntry(ctx, {
        fundId: frozenFundId,
        direction: "debit",
        amountCents: 100,
        kind: "sweep",
        idempotencyKey: "sweep_frozen",
      }),
    );
    expect(sweepId).toBeDefined();
  });
});

// ============================================================================
// postPairedTransfer
// ============================================================================

describe("postPairedTransfer", () => {
  test("writes both legs and moves both balances", async () => {
    const t = convexTest(schema, modules);
    const { fundId, generalFundId } = await seedFinanceFixture(t);

    // Fund the source first so the transfer has something to move.
    await t.run((ctx: MutationCtx) =>
      postLedgerEntry(ctx, {
        fundId,
        direction: "credit",
        amountCents: 3000,
        kind: "donation",
        idempotencyKey: "pi_seed",
      }),
    );

    const { debitId, creditId } = await t.run((ctx: MutationCtx) =>
      postPairedTransfer(ctx, {
        fromFundId: fundId,
        toFundId: generalFundId,
        amountCents: 1000,
        kind: "transfer",
        idempotencyKey: "xfer_1",
      }),
    );

    expect(debitId).not.toBe(creditId);

    const [fromFund, toFund] = await t.run(async (ctx) => [
      await ctx.db.get(fundId),
      await ctx.db.get(generalFundId),
    ]);
    expect(fromFund?.balanceCents).toBe(2000);
    expect(toFund?.balanceCents).toBe(1000);

    const debitEntry = await t.run(async (ctx) => ctx.db.get(debitId));
    const creditEntry = await t.run(async (ctx) => ctx.db.get(creditId));
    expect(debitEntry?.direction).toBe("debit");
    expect(debitEntry?.counterpartFundId).toBe(generalFundId);
    expect(creditEntry?.direction).toBe("credit");
    expect(creditEntry?.counterpartFundId).toBe(fundId);
  });
});

// ============================================================================
// Pure helpers
// ============================================================================

describe("deriveBalance", () => {
  test("sums credits minus debits", () => {
    expect(
      deriveBalance([
        { direction: "credit", amountCents: 1000 },
        { direction: "debit", amountCents: 300 },
        { direction: "credit", amountCents: 50 },
      ]),
    ).toBe(750);
  });

  test("empty entry list derives to zero", () => {
    expect(deriveBalance([])).toBe(0);
  });
});

describe("checkInvariant", () => {
  test("ok when ledger balance matches bank + pending allocations", () => {
    expect(checkInvariant(1000, 800, 200)).toEqual({ ok: true, driftCents: 0 });
  });

  test("reports positive drift when the ledger thinks there's more money", () => {
    expect(checkInvariant(1000, 800, 100)).toEqual({
      ok: false,
      driftCents: 100,
    });
  });

  test("reports negative drift when the bank has more than the ledger accounts for", () => {
    expect(checkInvariant(500, 800, 0)).toEqual({
      ok: false,
      driftCents: -300,
    });
  });
});

// ============================================================================
// requireFundRole / requireFundRoleOrGroupLeader
// ============================================================================

describe("requireFundRole", () => {
  test("plain member with no fund role is denied", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx) => requireFundRole(ctx, fundId, memberUserId, "cardholder")),
    ).rejects.toThrow();
  });

  test("cardholder is denied a manager-level action", async () => {
    const t = convexTest(schema, modules);
    const { fundId, cardholderUserId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx) => requireFundRole(ctx, fundId, cardholderUserId, "manager")),
    ).rejects.toThrow();
  });

  test("manager is allowed a manager-level action", async () => {
    const t = convexTest(schema, modules);
    const { fundId, managerUserId } = await seedFinanceFixture(t);

    // Both helpers report WHICH of ADR-032 §4's access paths let the caller
    // through — grantFundRole needs that to tell the leader carve-out apart
    // from a real grant (see the self-escalation guard in roles.ts).
    await expect(
      t.run((ctx) => requireFundRole(ctx, fundId, managerUserId, "manager")),
    ).resolves.toBe("fund_role");
  });

  test("finance_admin is allowed a finance_admin-level action", async () => {
    const t = convexTest(schema, modules);
    const { fundId, financeAdminUserId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx) =>
        requireFundRole(ctx, fundId, financeAdminUserId, "finance_admin"),
      ),
    ).resolves.toBe("fund_role");
  });

  test("community admin overrides even with no fund role at all", async () => {
    const t = convexTest(schema, modules);
    const { fundId, adminUserId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx) => requireFundRole(ctx, fundId, adminUserId, "finance_admin")),
    ).resolves.toBe("community_admin");
  });

  test("a revoked role is denied", async () => {
    const t = convexTest(schema, modules);
    const { fundId, revokedUserId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx) => requireFundRole(ctx, fundId, revokedUserId, "manager")),
    ).rejects.toThrow();
  });
});

describe("hasFundRole", () => {
  test("rejects a revoked grant regardless of rank", () => {
    expect(
      hasFundRole({ role: "finance_admin", revokedAt: Date.now() }, "cardholder"),
    ).toBe(false);
  });

  test("rejects null/undefined role docs", () => {
    expect(hasFundRole(null, "cardholder")).toBe(false);
    expect(hasFundRole(undefined, "cardholder")).toBe(false);
  });
});

describe("requireFundRoleOrGroupLeader", () => {
  test("an active group leader passes even with no fund role", async () => {
    const t = convexTest(schema, modules);
    const { fundId, leaderUserId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx) =>
        requireFundRoleOrGroupLeader(ctx, fundId, leaderUserId, "finance_admin"),
      ),
    ).resolves.toBe("group_leader");
  });

  test("a plain member without a fund role is still denied", async () => {
    const t = convexTest(schema, modules);
    const { fundId, memberUserId } = await seedFinanceFixture(t);

    await expect(
      t.run((ctx) =>
        requireFundRoleOrGroupLeader(ctx, fundId, memberUserId, "cardholder"),
      ),
    ).rejects.toThrow();
  });

  test("falls back to requireFundRole for a fund with no group (general fund)", async () => {
    const t = convexTest(schema, modules);
    const { generalFundId, leaderUserId, adminUserId } =
      await seedFinanceFixture(t);

    // The group leader has no special standing on the community's general
    // fund — it isn't their group's fund — so they're still denied.
    await expect(
      t.run((ctx) =>
        requireFundRoleOrGroupLeader(
          ctx,
          generalFundId,
          leaderUserId,
          "cardholder",
        ),
      ),
    ).rejects.toThrow();

    // A community admin still overrides via the requireFundRole fallback.
    await expect(
      t.run((ctx) =>
        requireFundRoleOrGroupLeader(
          ctx,
          generalFundId,
          adminUserId,
          "finance_admin",
        ),
      ),
    ).resolves.toBe("community_admin");
  });
});
