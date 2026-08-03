/**
 * The MANAGED card limit (ADR-033 Phase 3, lib/finance/managedCardLimit.ts).
 *
 * At Privacy every card draws the church's one pooled balance, so "this card
 * may spend the fund's balance" is a promise the bank does not keep. The
 * mechanism that keeps it instead: a LIFETIME cap at the provider, recomputed
 * from the fund's ledger as `credits − non-card debits`, so that what remains
 * at Privacy equals the fund's balance.
 *
 * The claim under test is the equality itself:
 *
 *     remainingAtProvider  ==  fundBalance
 *
 * Everything else here exists to keep that true under the things that happen to
 * a real fund — a second card, an admin who wants a tighter cap, a sync that
 * failed, money arriving and leaving.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-managed-card-limit.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import {
  effectiveManagedLimitCents,
  ledgerDerivedLimitCents,
} from "../lib/finance/managedCardLimit";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";
process.env.CREDENTIALS_MASTER_KEY = btoa(
  String.fromCharCode(...new Uint8Array(32).fill(5)),
);

// Mutations schedule provisioning/sync actions on a REAL setTimeout under
// convex-test. Frozen timers mean they only run when a test asks.
vi.useFakeTimers();

const API_KEY = "privacy_live_test_key_do_not_log";

const privacy = vi.hoisted(() => ({
  createPrivacyCard: vi.fn(async () => ({
    token: "card_privacy_1",
    state: "OPEN",
    last_four: "1111",
  })),
  updatePrivacyCard: vi.fn(async (_c: unknown, _t: string, params: any) => ({
    token: "card_privacy_1",
    state: params.state ?? "OPEN",
    last_four: "1111",
  })),
  listPrivacyFundingSources: vi.fn(async () => [
    { token: "fund_src_1", nickname: "Operations Checking" },
  ]),
  listPrivacyTransactions: vi.fn(async () => ({
    data: [],
    page: 1,
    total_pages: 1,
  })),
}));

vi.mock("../lib/finance/privacy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/finance/privacy")>()),
  ...privacy,
}));

beforeEach(() => {
  vi.clearAllMocks();
  privacy.createPrivacyCard.mockResolvedValue({
    token: "card_privacy_1",
    state: "OPEN",
    last_four: "1111",
  });
  privacy.updatePrivacyCard.mockImplementation(
    async (_c: unknown, _t: string, params: any) => ({
      token: "card_privacy_1",
      state: params.state ?? "OPEN",
      last_four: "1111",
    }),
  );
  privacy.listPrivacyFundingSources.mockResolvedValue([
    { token: "fund_src_1", nickname: "Operations Checking" },
  ]);
});

// ============================================================================
// The formula, in isolation
// ============================================================================

describe("the formula", () => {
  test("the worked example: credits 500, reimbursement 100, card spend 250", () => {
    // The provider limit is credits MINUS non-card debits. The $250 of card
    // spend is excluded because Privacy is already counting it against the
    // lifetime cap — subtracting it here too would charge every purchase twice.
    const limit = ledgerDerivedLimitCents({
      lifetimeCreditsCents: 50_000,
      nonCardDebitsCents: 10_000,
    });
    expect(limit).toBe(40_000);

    // What Privacy will still authorize, by its own arithmetic...
    const remainingAtProvider = limit - 25_000;
    // ...is exactly the fund's balance.
    const fundBalance = 50_000 - 10_000 - 25_000;
    expect(remainingAtProvider).toBe(fundBalance);
    expect(remainingAtProvider).toBe(15_000);
  });

  test("a fund whose refunds exceed its credits floors at zero, not negative", () => {
    expect(
      ledgerDerivedLimitCents({
        lifetimeCreditsCents: 10_000,
        nonCardDebitsCents: 25_000,
      }),
    ).toBe(0);
  });

  test("a manual cap can only tighten", () => {
    expect(effectiveManagedLimitCents(40_000, undefined)).toBe(40_000);
    expect(effectiveManagedLimitCents(40_000, 10_000)).toBe(10_000);
    // Above the derived cap it is clamped — `setCardLimit` refuses this
    // outright, and this is the second line of the same defence.
    expect(effectiveManagedLimitCents(40_000, 90_000)).toBe(40_000);
    expect(effectiveManagedLimitCents(40_000, -5)).toBe(0);
  });
});

// ============================================================================
// Fixture
// ============================================================================

const ADDRESS = {
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

interface Fixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  fundId: Id<"funds">;
  primaryAdminUserId: Id<"users">;
  cardholderUserId: Id<"users">;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  return await t.run(async (ctx) => {
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: Date.now(),
    });
    const timestamp = Date.now();
    const suffix = Math.floor(Math.random() * 1_000_000);

    const communityId = await ctx.db.insert("communities", {
      name: "Managed Church",
      slug: `managed-church-${suffix}`,
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
      name: "Youth",
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const mkUser = async (name: string, roles: number) => {
      const userId = await ctx.db.insert("users", {
        firstName: name,
        lastName: "User",
        phone: `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      return userId;
    };

    const primaryAdminUserId = await mkUser("Primary", 4);
    const cardholderUserId = await mkUser("Cardholder", 1);

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Youth Ministry",
      type: "group",
      status: "active",
      balanceCents: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: "acct_managed",
      onboardingStatus: "live",
      legalName: "Managed Church",
      ein: "12-3456789",
      address: ADDRESS,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    for (const [userId, role] of [
      [primaryAdminUserId, "finance_admin"],
      [cardholderUserId, "cardholder"],
    ] as const) {
      await ctx.db.insert("fundRoles", {
        fundId,
        userId,
        role,
        grantedBy: primaryAdminUserId,
        grantedAt: timestamp,
      });
    }

    return {
      communityId,
      groupId,
      fundId,
      primaryAdminUserId,
      cardholderUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  return (await generateTokens(userId)).accessToken;
}

async function connect(t: ReturnType<typeof convexTest>, f: Fixture) {
  await t.action(
    api.functions.finance.cardProviderConnections.connectCardProvider,
    {
      token: await tokenFor(f.primaryAdminUserId),
      communityId: f.communityId,
      provider: "privacy",
      apiKey: API_KEY,
    },
  );
}

/**
 * Ledger rows written directly, so a fixture never queues provider calls.
 *
 * A `card_capture` entry takes a `cardId`, because in production one never
 * exists without it: `recordCardSettlement` writes the debit and the
 * `card_charge` expense together, and the expense is how the managed-limit
 * formula tells THIS card's spend (which the provider already counted) from a
 * previous card's (which it did not). Seeding the debit alone would model a
 * charge belonging to no card at all.
 */
async function seedLedger(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
  entries: Array<{
    direction: "credit" | "debit";
    kind: "donation" | "reimbursement" | "card_capture" | "fee";
    amountCents: number;
    cardId?: Id<"cards">;
  }>,
) {
  await t.run(async (ctx) => {
    const fund = (await ctx.db.get(f.fundId))!;
    let balance = fund.balanceCents;
    for (const [i, entry] of entries.entries()) {
      await ctx.db.insert("ledgerEntries", {
        fundId: f.fundId,
        communityId: f.communityId,
        direction: entry.direction,
        amountCents: entry.amountCents,
        kind: entry.kind,
        idempotencyKey: `seed:${f.fundId}:${i}:${Math.random()}`,
        createdAt: Date.now(),
      });
      if (entry.kind === "card_capture" && entry.cardId) {
        const timestamp = Date.now();
        await ctx.db.insert("expenses", {
          fundId: f.fundId,
          submitterId: f.cardholderUserId,
          amountCents: entry.amountCents,
          kind: "card_charge",
          status: "pending",
          cardId: entry.cardId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      balance +=
        entry.direction === "credit" ? entry.amountCents : -entry.amountCents;
    }
    await ctx.db.patch(f.fundId, { balanceCents: balance });
  });
}

async function issueCard(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
  manualCapCents?: number,
): Promise<Id<"cards">> {
  const cardId: Id<"cards"> = await t.mutation(
    api.functions.finance.cards.createFundCard,
    {
      token: await tokenFor(f.primaryAdminUserId),
      fundId: f.fundId,
      holderUserId: f.cardholderUserId,
      name: "Supplies",
      ...(manualCapCents !== undefined
        ? { spendLimitCents: manualCapCents }
        : {}),
    },
  );
  await t.action(internal.functions.finance.cards.provisionCard, { cardId });
  return cardId;
}

/** Every `syncManagedCardLimit` run currently queued on the scheduler. */
async function queuedSyncs(t: ReturnType<typeof convexTest>): Promise<number> {
  return await t.run(async (ctx) => {
    const scheduled = await ctx.db.system
      .query("_scheduled_functions")
      .collect();
    return scheduled.filter(
      (row) =>
        row.name.includes("syncManagedCardLimit") &&
        row.state.kind === "pending",
    ).length;
  });
}

/** The `spend_limit` of the last PATCH we sent Privacy, or null if none. */
function lastPatchedLimit(): number | null {
  const calls = privacy.updatePrivacyCard.mock.calls as any[][];
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const params = calls[i][2];
    if (params?.spend_limit !== undefined) return params.spend_limit;
  }
  return null;
}

// ============================================================================
// Creation
// ============================================================================

describe("creating a managed card", () => {
  test("the card is created at the fund's headroom, on a FOREVER window", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
      { direction: "debit", kind: "reimbursement", amountCents: 10_000 },
    ]);

    const cardId = await issueCard(t, f);

    const [, params] = privacy.createPrivacyCard.mock.calls[0] as any[];
    expect(params.spend_limit).toBe(40_000);
    expect(params.spend_limit_duration).toBe("FOREVER");

    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card!.spendLimitCents).toBe(40_000);
    // No period is stored: the window is lifetime, which `cards.limitPeriod`
    // cannot express, and writing "month" would be a lie the UI would render.
    expect(card!.limitPeriod).toBeUndefined();
    expect(card!.controls).toEqual({ managedLimit: true });

    // The equality the whole mechanism exists for. The card spends 25,000,
    // which Privacy counts against the 40,000 lifetime cap itself — so what
    // remains there is the fund's balance, to the cent.
    await seedLedger(t, f, [
      { direction: "debit", kind: "card_capture", amountCents: 25_000, cardId },
    ]);
    const fund = await t.run(async (ctx) => ctx.db.get(f.fundId));
    expect(card!.spendLimitCents! - 25_000).toBe(fund!.balanceCents);
    expect(fund!.balanceCents).toBe(15_000);
  });

  test("a REPLACEMENT card is capped at the fund's balance, not the closed card's headroom", async () => {
    // The provider's lifetime counter belongs to a card id and dies with the
    // card. A fund-wide `credits − nonCardDebits` would hand the replacement
    // every cent the closed card already spent, a second time.
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const firstCardId = await issueCard(t, f);
    await seedLedger(t, f, [
      {
        direction: "debit",
        kind: "card_capture",
        amountCents: 25_000,
        cardId: firstCardId,
      },
    ]);

    await t.mutation(api.functions.finance.cards.cancelCard, {
      token: await tokenFor(f.primaryAdminUserId),
      cardId: firstCardId,
    });
    await t.action(internal.functions.finance.cards.applyCardStatus, {
      cardId: firstCardId,
      state: "closed",
    });

    privacy.createPrivacyCard.mockClear();
    const replacementId = await issueCard(t, f);

    const [, params] = privacy.createPrivacyCard.mock.calls[0] as any[];
    expect(params.spend_limit).toBe(25_000);

    const [replacement, fund] = await t.run(async (ctx) => [
      await ctx.db.get(replacementId),
      await ctx.db.get(f.fundId),
    ]);
    expect(replacement!.spendLimitCents).toBe(25_000);
    // A card that has spent nothing yet may spend exactly the fund's balance.
    expect(fund!.balanceCents).toBe(25_000);
  });

  test("a manual cap on a replacement is measured against the fund, not the old card", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const firstCardId = await issueCard(t, f);
    await seedLedger(t, f, [
      {
        direction: "debit",
        kind: "card_capture",
        amountCents: 40_000,
        cardId: firstCardId,
      },
    ]);
    await t.mutation(api.functions.finance.cards.cancelCard, {
      token: await tokenFor(f.primaryAdminUserId),
      cardId: firstCardId,
    });
    await t.action(internal.functions.finance.cards.applyCardStatus, {
      cardId: firstCardId,
      state: "closed",
    });

    // The fund holds 10,000. A 30,000 cap was reachable under the old
    // fund-wide formula and is refused now.
    await expect(
      t.mutation(api.functions.finance.cards.createFundCard, {
        token: await tokenFor(f.primaryAdminUserId),
        fundId: f.fundId,
        holderUserId: f.cardholderUserId,
        name: "Replacement",
        spendLimitCents: 30_000,
      }),
    ).rejects.toThrow(/\$100\.00 left to spend/);
  });

  test("a second card on the same fund is refused, with the reason", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    await issueCard(t, f);

    await expect(
      t.mutation(api.functions.finance.cards.createFundCard, {
        token: await tokenFor(f.primaryAdminUserId),
        fundId: f.fundId,
        holderUserId: f.cardholderUserId,
        name: "Second card",
      }),
      // Two cards would each carry the fund's whole lifetime allowance, and
      // the pair could spend it twice.
    ).rejects.toThrow(/already has a card/i);
  });

  test("closing the card frees the fund's slot", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f);

    await t.mutation(api.functions.finance.cards.cancelCard, {
      token: await tokenFor(f.primaryAdminUserId),
      cardId,
    });
    await t.action(internal.functions.finance.cards.applyCardStatus, {
      cardId,
      state: "closed",
    });

    const second = await t.mutation(
      api.functions.finance.cards.createFundCard,
      {
        token: await tokenFor(f.primaryAdminUserId),
        fundId: f.fundId,
        holderUserId: f.cardholderUserId,
        name: "Replacement",
      },
    );
    expect(second).toBeDefined();
  });

  test("a PENDING card still occupies the slot", async () => {
    // The window between the row's insert and `provisionCard` returning is
    // exactly where a double-issue would slip through.
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    await t.mutation(api.functions.finance.cards.createFundCard, {
      token: await tokenFor(f.primaryAdminUserId),
      fundId: f.fundId,
      holderUserId: f.cardholderUserId,
      name: "Supplies",
    });

    await expect(
      t.mutation(api.functions.finance.cards.createFundCard, {
        token: await tokenFor(f.primaryAdminUserId),
        fundId: f.fundId,
        holderUserId: f.cardholderUserId,
        name: "Second",
      }),
    ).rejects.toThrow(/already has a card/i);
  });
});

// ============================================================================
// Syncing
// ============================================================================

describe("syncing the managed limit", () => {
  test("a donation raises the cap; a reimbursement lowers it; a card charge does neither", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f);

    // MONOTONIC RAISE on new money.
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 20_000 },
    ]);
    await t.action(internal.functions.finance.cards.syncManagedCardLimit, {
      cardId,
    });
    expect(lastPatchedLimit()).toBe(70_000);

    // LOWER on a non-card debit.
    await seedLedger(t, f, [
      { direction: "debit", kind: "reimbursement", amountCents: 15_000 },
    ]);
    await t.action(internal.functions.finance.cards.syncManagedCardLimit, {
      cardId,
    });
    expect(lastPatchedLimit()).toBe(55_000);

    // A CARD charge moves nothing: Privacy already counted it.
    privacy.updatePrivacyCard.mockClear();
    await seedLedger(t, f, [
      { direction: "debit", kind: "card_capture", amountCents: 30_000, cardId },
    ]);
    await t.action(internal.functions.finance.cards.syncManagedCardLimit, {
      cardId,
    });
    expect(privacy.updatePrivacyCard).not.toHaveBeenCalled();

    // ...and the equality still holds: 55,000 cap − 30,000 spent == balance.
    const fund = await t.run(async (ctx) => ctx.db.get(f.fundId));
    expect(55_000 - 30_000).toBe(fund!.balanceCents);
  });

  test("a repeated sync is a no-op — the number is recomputed, never accumulated", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f);

    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 10_000 },
    ]);
    const first = await t.action(
      internal.functions.finance.cards.syncManagedCardLimit,
      { cardId },
    );
    expect(first).toEqual({ applied: true });
    expect(lastPatchedLimit()).toBe(60_000);

    privacy.updatePrivacyCard.mockClear();
    for (let i = 0; i < 3; i += 1) {
      const again = await t.action(
        internal.functions.finance.cards.syncManagedCardLimit,
        { cardId },
      );
      expect(again).toEqual({ applied: false });
    }
    expect(privacy.updatePrivacyCard).not.toHaveBeenCalled();
  });

  test("a provider refusal leaves the mirror alone rather than lying", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f);

    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 10_000 },
    ]);
    privacy.updatePrivacyCard.mockRejectedValueOnce(new Error("Privacy 503"));

    const result = await t.action(
      internal.functions.finance.cards.syncManagedCardLimit,
      { cardId },
    );
    expect(result).toEqual({ applied: false });

    // The row still shows the cap Privacy is actually enforcing. A roster
    // claiming a limit the provider never took is the one state nobody can
    // detect from the app.
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card!.spendLimitCents).toBe(50_000);
  });

  test("an unprovisioned card is skipped, not errored", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId: Id<"cards"> = await t.mutation(
      api.functions.finance.cards.createFundCard,
      {
        token: await tokenFor(f.primaryAdminUserId),
        fundId: f.fundId,
        holderUserId: f.cardholderUserId,
        name: "Supplies",
      },
    );

    const result = await t.action(
      internal.functions.finance.cards.syncManagedCardLimit,
      { cardId },
    );
    expect(result).toEqual({ applied: false });
    expect(privacy.updatePrivacyCard).not.toHaveBeenCalled();
  });
});

// ============================================================================
// The ledger-post hook
// ============================================================================

describe("postLedgerEntry schedules the sync", () => {
  test("a donation credit queues a resync", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f);
    await t.run(async (ctx) => {
      // Drain the provisioning catch-up so the count below is about the
      // donation and nothing else.
      for (const row of await ctx.db.system
        .query("_scheduled_functions")
        .collect()) {
        if (row.state.kind === "pending") await ctx.scheduler.cancel(row._id);
      }
    });
    expect(await queuedSyncs(t)).toBe(0);

    await t.mutation(
      internal.functions.finance.giving.recordDonationSucceeded,
      {
        paymentIntentId: `pi_${Math.random()}`,
        fundId: f.fundId,
        amountCents: 20_000,
        feeCoverCents: 0,
        communityId: f.communityId,
      },
    );

    expect(await queuedSyncs(t)).toBe(1);
    expect(cardId).toBeDefined();
  });

  test("a reimbursement payout queues a resync", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    await issueCard(t, f);
    const expenseId = await t.run(async (ctx) => {
      const timestamp = Date.now();
      return await ctx.db.insert("expenses", {
        fundId: f.fundId,
        submitterId: f.cardholderUserId,
        amountCents: 10_000,
        kind: "reimbursement",
        description: "Snacks",
        receiptKey: "r2:receipt",
        status: "approved",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
    await t.run(async (ctx) => {
      for (const row of await ctx.db.system
        .query("_scheduled_functions")
        .collect()) {
        if (row.state.kind === "pending") await ctx.scheduler.cancel(row._id);
      }
    });

    await t.mutation(
      internal.functions.finance.expenses.recordReimbursementPaid,
      { expenseId, increaseTransferId: "transfer_1" },
    );

    expect(await queuedSyncs(t)).toBe(1);
  });

  test("a card settlement does NOT queue one — the provider already counted it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    await issueCard(t, f);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.system
        .query("_scheduled_functions")
        .collect()) {
        if (row.state.kind === "pending") await ctx.scheduler.cancel(row._id);
      }
    });

    await t.mutation(internal.functions.finance.webhooks.recordCardSettlement, {
      provider: "privacy",
      providerCardId: "card_privacy_1",
      providerTxnId: "txn_1",
      amountCents: 4_200,
      merchantDescription: "OFFICE SUPPLY CO",
    });

    expect(await queuedSyncs(t)).toBe(0);
  });
});

// ============================================================================
// The admin's manual cap
// ============================================================================

describe("the manual cap", () => {
  test("setCardLimit pins a LOWER ceiling and pushes it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f);

    await t.mutation(api.functions.finance.cards.setCardLimit, {
      token: await tokenFor(f.primaryAdminUserId),
      cardId,
      spendLimitCents: 20_000,
    });
    await t.action(internal.functions.finance.cards.syncManagedCardLimit, {
      cardId,
    });

    expect(lastPatchedLimit()).toBe(20_000);
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card!.controls).toEqual({
      managedLimit: true,
      manualCapCents: 20_000,
    });
    expect(card!.spendLimitCents).toBe(20_000);
  });

  test("a cap ABOVE the fund's headroom is refused, and says both numbers", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f);

    await expect(
      t.mutation(api.functions.finance.cards.setCardLimit, {
        token: await tokenFor(f.primaryAdminUserId),
        cardId,
        spendLimitCents: 90_000,
      }),
    ).rejects.toThrow(/\$500\.00 left to spend/);
  });

  test("a manual cap keeps holding while the fund grows past it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f, 20_000);
    expect(
      (privacy.createPrivacyCard.mock.calls[0] as any[])[1].spend_limit,
    ).toBe(20_000);

    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 100_000 },
    ]);
    const result = await t.action(
      internal.functions.finance.cards.syncManagedCardLimit,
      { cardId },
    );
    // Nothing to push: the cap is the binding constraint, not the fund.
    expect(result).toEqual({ applied: false });
  });

  test("a manual cap is TIGHTENED further when the fund shrinks below it", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f, 40_000);

    await seedLedger(t, f, [
      { direction: "debit", kind: "reimbursement", amountCents: 45_000 },
    ]);
    await t.action(internal.functions.finance.cards.syncManagedCardLimit, {
      cardId,
    });

    // min(ledger 5,000, cap 40,000). The cap can only ever tighten, so the
    // fund wins when it is the smaller of the two.
    expect(lastPatchedLimit()).toBe(5_000);
  });

  test("clearing the cap returns the card to following the fund", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f, 20_000);

    await t.mutation(api.functions.finance.cards.setCardLimit, {
      token: await tokenFor(f.primaryAdminUserId),
      cardId,
    });
    await t.action(internal.functions.finance.cards.syncManagedCardLimit, {
      cardId,
    });

    expect(lastPatchedLimit()).toBe(50_000);
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card!.controls).toEqual({ managedLimit: true });
  });
});

// ============================================================================
// The hourly backstop
// ============================================================================

describe("the poll backstop", () => {
  test("re-applies a cap whose live sync failed", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    const cardId = await issueCard(t, f);

    // Money arrives, and the live sync fails at the provider.
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 25_000 },
    ]);
    privacy.updatePrivacyCard.mockRejectedValueOnce(new Error("Privacy 503"));
    await t.action(internal.functions.finance.cards.syncManagedCardLimit, {
      cardId,
    });
    expect(
      (await t.run(async (ctx) => ctx.db.get(cardId)))!.spendLimitCents,
    ).toBe(50_000);

    // The hour ticks over. The poll's fan-out picks the card back up.
    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result.limitsResynced).toBe(1);
    expect(lastPatchedLimit()).toBe(75_000);
    expect(
      (await t.run(async (ctx) => ctx.db.get(cardId)))!.spendLimitCents,
    ).toBe(75_000);
  });

  test("a healthy fleet costs the poll no provider calls", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await seedLedger(t, f, [
      { direction: "credit", kind: "donation", amountCents: 50_000 },
    ]);
    await issueCard(t, f);

    privacy.updatePrivacyCard.mockClear();
    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result.limitsResynced).toBe(0);
    expect(privacy.updatePrivacyCard).not.toHaveBeenCalled();
  });
});
