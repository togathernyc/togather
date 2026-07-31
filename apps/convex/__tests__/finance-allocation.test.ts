/**
 * Payout allocation: NET matching, never-stall selection, per-item failure
 * recovery, and honest reconcile (ADR-032 §3 + Phase-2 requirement 6).
 *
 * Unlike the other finance suites, this one drives `runAllocation` — the
 * internalAction itself — end to end, because the bugs it covers live in the
 * action's control flow (what it claims before it transfers, what it does
 * when transfer N of M throws, what a redelivered webhook re-does). Both
 * providers the action lazy-imports are mocked at the module boundary:
 * `listPayoutChargeNets` (Stripe balance transactions) and
 * `createAccountTransfer` (Increase).
 *
 * Deliberately NO suite-wide `vi.useFakeTimers()` (see finance-cards.test.ts
 * for why the other suites need it): nothing here goes through
 * `ctx.scheduler`, so freezing timers would only risk making an awaited
 * action look like it ran when it didn't.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-allocation.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import type { PayoutChargeNet } from "../lib/finance/stripeConnect";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Provider mocks
//
// `vi.hoisted` because `vi.mock` factories are hoisted above the module body —
// the shared state they close over has to be hoisted with them.
// ============================================================================

const stubs = vi.hoisted(() => ({
  /** payoutId -> charges Stripe reports for it, or an error to throw. */
  payouts: new Map<string, { charges: unknown[] } | { error: string }>(),
  /** Increase idempotency keys that should fail this run. */
  failTransferKeys: new Set<string>(),
  /** Every createAccountTransfer call, in order. */
  transferCalls: [] as Array<{
    toAccountId: string;
    amountCents: number;
    idempotencyKey: string;
  }>,
}));

vi.mock("../lib/finance/stripeConnect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/finance/stripeConnect")>();
  return {
    ...actual,
    listPayoutChargeNets: vi.fn(async (_accountId: string, payoutId: string) => {
      const stub = stubs.payouts.get(payoutId);
      if (!stub) {
        throw new Error(`test stub missing for payout ${payoutId}`);
      }
      if ("error" in stub) {
        throw new Error(stub.error);
      }
      return stub.charges as PayoutChargeNet[];
    }),
  };
});

vi.mock("../lib/finance/increase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/finance/increase")>();
  return {
    ...actual,
    createAccountTransfer: vi.fn(
      async (input: {
        toAccountId: string;
        amountCents: number;
        idempotencyKey: string;
      }) => {
        stubs.transferCalls.push({
          toAccountId: input.toAccountId,
          amountCents: input.amountCents,
          idempotencyKey: input.idempotencyKey,
        });
        if (stubs.failTransferKeys.has(input.idempotencyKey)) {
          throw new Error(
            "Increase API POST /account_transfers failed (503): service unavailable",
          );
        }
        return { id: `at_${input.idempotencyKey}`, status: "pending" };
      },
    ),
  };
});

beforeEach(() => {
  stubs.payouts.clear();
  stubs.failTransferKeys.clear();
  stubs.transferCalls.length = 0;
});

// ============================================================================
// Fixture
// ============================================================================

interface AllocFixture {
  communityId: Id<"communities">;
  fundAId: Id<"funds">;
  fundBId: Id<"funds">;
  generalFundId: Id<"funds">;
}

const RECEIVING_ACCOUNT = "account_receiving";

async function seedAllocFixture(
  t: ReturnType<typeof convexTest>,
  options: { receivingAccount?: string | null } = {},
): Promise<AllocFixture> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    const communityId = await ctx.db.insert("communities", {
      name: "Allocation Church",
      slug: `allocation-church-${Math.floor(Math.random() * 1_000_000)}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const mkFund = async (
      name: string,
      type: "group" | "general",
      increaseAccountId: string,
    ) =>
      ctx.db.insert("funds", {
        communityId,
        name,
        type,
        increaseAccountId,
        status: "active",
        balanceCents: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const fundAId = await mkFund("Fund A", "group", "account_fund_a");
    const fundBId = await mkFund("Fund B", "group", "account_fund_b");
    const generalFundId = await mkFund("General", "general", "account_general");

    const receiving =
      options.receivingAccount === undefined
        ? RECEIVING_ACCOUNT
        : options.receivingAccount;

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: "acct_alloc",
      increaseEntityId: "entity_alloc",
      ...(receiving ? { increaseReceivingAccountId: receiving } : {}),
      onboardingStatus: "live",
      legalName: "Allocation Church Inc.",
      ein: "12-3456789",
      address: {
        addressLine1: "1 Main St",
        city: "Austin",
        state: "TX",
        zipCode: "78701",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return { communityId, fundAId, fundBId, generalFundId };
  });
}

/** Insert a pending donation directly — `recordDonationSucceeded` would also
 * schedule a receipt email, which this suite has no interest in. Returns the
 * donation id; the ledger credit is simulated by bumping the fund cache. */
async function seedDonation(
  t: ReturnType<typeof convexTest>,
  args: {
    fundId: Id<"funds">;
    paymentIntentId: string;
    amountCents: number;
    feeCoverCents?: number;
    createdAt: number;
    creditLedger?: boolean;
  },
): Promise<Id<"donations">> {
  return await t.run(async (ctx) => {
    const grossCents = args.amountCents + (args.feeCoverCents ?? 0);
    const donationId = await ctx.db.insert("donations", {
      fundId: args.fundId,
      amountCents: args.amountCents,
      feeCoverCents: args.feeCoverCents ?? 0,
      stripePaymentIntentId: args.paymentIntentId,
      allocationStatus: "pending",
      receiptEmailStatus: "sent",
      createdAt: args.createdAt,
    });
    if (args.creditLedger) {
      const fund = (await ctx.db.get(args.fundId))!;
      await ctx.db.insert("ledgerEntries", {
        fundId: args.fundId,
        communityId: fund.communityId,
        direction: "credit",
        amountCents: grossCents,
        kind: "donation",
        idempotencyKey: `donation:${args.paymentIntentId}`,
        createdAt: args.createdAt,
      });
      await ctx.db.patch(args.fundId, {
        balanceCents: fund.balanceCents + grossCents,
      });
    }
    return donationId;
  });
}

async function getDonation(t: ReturnType<typeof convexTest>, id: Id<"donations">) {
  return await t.run((ctx) => ctx.db.get(id));
}

async function auditActions(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
): Promise<string[]> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("financeAuditEvents")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect(),
  );
  return rows.map((r) => r.action);
}

// ============================================================================
// planAllocations — NET matching
// ============================================================================

describe("planAllocations (net matching)", () => {
  test("THE STALL: a lone donation whose GROSS exceeds the payout's NET still allocates", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    // $100 gift; Stripe keeps 2.9% + 30c = 320c, so the payout is 9680.
    // The old gross matcher compared 10000 against 9680, never fit it, and
    // `break`ed — the queue never advanced again.
    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_stall",
      amountCents: 10_000,
      createdAt: 1_000,
    });

    const result = await t.mutation(internal.functions.finance.jobs.planAllocations, {
      communityId,
      payoutCents: 9_680,
      stripePayoutId: "po_stall",
      charges: [{ paymentIntentId: "pi_stall", netCents: 9_680 }],
    });

    expect(result.plan).toHaveLength(1);
    expect(result.plan[0]).toMatchObject({
      donationId,
      fundId: fundAId,
      amountCents: 9_680, // net, not the 10000 gross
    });
    expect(result.leftoverCents).toBe(0);
    expect(result.alreadyClaimed).toBe(false);

    const donation = await getDonation(t, donationId);
    expect(donation?.allocationPayoutId).toBe("po_stall");
    expect(donation?.payoutNetCents).toBe(9_680);
  });

  test("a donation the payout doesn't contain is skipped; the ones it does contain still allocate", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId, fundBId } = await seedAllocFixture(t);

    // Oldest donation settled too late for this payout — Stripe reports no
    // balance transaction for it. It must not block the two that did settle.
    const laterId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_not_in_payout",
      amountCents: 50_000,
      createdAt: 1_000,
    });
    const firstId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_a",
      amountCents: 2_000,
      createdAt: 2_000,
    });
    const secondId = await seedDonation(t, {
      fundId: fundBId,
      paymentIntentId: "pi_b",
      amountCents: 3_000,
      feeCoverCents: 100,
      createdAt: 3_000,
    });

    const result = await t.mutation(internal.functions.finance.jobs.planAllocations, {
      communityId,
      // A real payout equals the sum of its charges' nets, plus (here) 118c
      // of charges we can't map to a donation — the expected leftover.
      payoutCents: 4_950,
      stripePayoutId: "po_partial_cycle",
      charges: [
        { paymentIntentId: "pi_a", netCents: 1_912 },
        { paymentIntentId: "pi_b", netCents: 2_920 },
      ],
    });

    expect(result.plan.map((p) => p.donationId)).toEqual([firstId, secondId]);
    expect(result.plan.map((p) => p.amountCents)).toEqual([1_912, 2_920]);
    expect(result.leftoverCents).toBe(118);

    expect((await getDonation(t, laterId))?.allocationPayoutId).toBeUndefined();
  });

  test("an item that would overrun the payout is SKIPPED, not terminal — later items still plan", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    // Deliberately inconsistent stub (nets summing above the payout) to force
    // the defensive budget branch. The old code `break`ed here; the queue
    // behind an oversized item never drained.
    const bigId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_big",
      amountCents: 300,
      createdAt: 1_000,
    });
    const smallId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_small",
      amountCents: 120,
      createdAt: 2_000,
    });

    const result = await t.mutation(internal.functions.finance.jobs.planAllocations, {
      communityId,
      payoutCents: 150,
      stripePayoutId: "po_overrun",
      charges: [
        { paymentIntentId: "pi_big", netCents: 200 },
        { paymentIntentId: "pi_small", netCents: 100 },
      ],
    });

    expect(result.plan).toHaveLength(1);
    expect(result.plan[0].donationId).toBe(smallId);
    expect((await getDonation(t, bigId))?.allocationPayoutId).toBeUndefined();
    expect((await getDonation(t, smallId))?.payoutNetCents).toBe(100);
  });

  test("a donation already bound to another payout is never re-selected", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_bound",
      amountCents: 1_000,
      createdAt: 1_000,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(donationId, {
        allocationPayoutId: "po_earlier",
        payoutNetCents: 950,
      });
    });

    const result = await t.mutation(internal.functions.finance.jobs.planAllocations, {
      communityId,
      payoutCents: 950,
      stripePayoutId: "po_later",
      charges: [{ paymentIntentId: "pi_bound", netCents: 950 }],
    });

    expect(result.plan).toHaveLength(0);
    expect((await getDonation(t, donationId))?.allocationPayoutId).toBe("po_earlier");
  });

  test("re-planning the same payout returns the same still-pending items and re-stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_replan",
      amountCents: 5_000,
      createdAt: 1_000,
    });

    const args = {
      communityId,
      payoutCents: 4_825,
      stripePayoutId: "po_replan",
      charges: [{ paymentIntentId: "pi_replan", netCents: 4_825 }],
    };
    const first = await t.mutation(internal.functions.finance.jobs.planAllocations, args);
    const second = await t.mutation(internal.functions.finance.jobs.planAllocations, args);

    expect(first.alreadyClaimed).toBe(false);
    expect(second.alreadyClaimed).toBe(true);
    expect(second.plan.map((p) => p.donationId)).toEqual([donationId]);
    expect(second.plan[0].amountCents).toBe(4_825);

    const payoutRows = await t.run((ctx) =>
      ctx.db.query("processedStripePayouts").collect(),
    );
    expect(payoutRows).toHaveLength(1);
  });

  test("a nonsense net from Stripe is ignored rather than allocated", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_bad_net",
      amountCents: 1_000,
      createdAt: 1_000,
    });

    for (const netCents of [0, -100, 12.5]) {
      const result = await t.mutation(
        internal.functions.finance.jobs.planAllocations,
        {
          communityId,
          payoutCents: 1_000,
          stripePayoutId: `po_bad_${netCents}`,
          charges: [{ paymentIntentId: "pi_bad_net", netCents }],
        },
      );
      expect(result.plan).toHaveLength(0);
    }
  });
});

// ============================================================================
// runAllocation — the action, with both providers mocked
// ============================================================================

describe("runAllocation", () => {
  test("transfers each matched donation's NET and records it", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId, fundBId, generalFundId } = await seedAllocFixture(t);

    const aId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_1",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    const bId = await seedDonation(t, {
      fundId: fundBId,
      paymentIntentId: "pi_2",
      amountCents: 5_000,
      createdAt: 2_000,
      creditLedger: true,
    });
    const gId = await seedDonation(t, {
      fundId: generalFundId,
      paymentIntentId: "pi_3",
      amountCents: 2_000,
      createdAt: 3_000,
      creditLedger: true,
    });

    stubs.payouts.set("po_happy", {
      charges: [
        { paymentIntentId: "pi_1", netCents: 9_680 },
        { paymentIntentId: "pi_2", netCents: 4_825 },
        { paymentIntentId: "pi_3", netCents: 1_912 },
      ],
    });

    const result = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_happy",
      payoutCents: 16_417,
    });

    expect(result).toEqual({ allocated: 3, failed: 0 });

    // Group funds get a transfer each; the general fund does not (its Account
    // is where unearmarked money already belongs).
    expect(stubs.transferCalls).toEqual([
      { toAccountId: "account_fund_a", amountCents: 9_680, idempotencyKey: `alloc:${aId}` },
      { toAccountId: "account_fund_b", amountCents: 4_825, idempotencyKey: `alloc:${bId}` },
    ]);

    for (const id of [aId, bId, gId]) {
      expect((await getDonation(t, id))?.allocationStatus).toBe("allocated");
    }

    // The fee Stripe kept is realised as a "fee" debit, so each fund's ledger
    // now reflects what the bank will actually hold.
    const fundA = await t.run((ctx) => ctx.db.get(fundAId));
    expect(fundA?.balanceCents).toBe(9_680);
    const feeEntries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    const fee = feeEntries.find((e) => e.kind === "fee");
    expect(fee).toMatchObject({ direction: "debit", amountCents: 320 });
    expect(fee?.stripeObjectId).toBe("po_happy");
  });

  test("PARTIAL FAILURE: item 2 of 3 fails, 1 and 3 still land, and a redelivery finishes 2 without re-transferring 1", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId, fundBId } = await seedAllocFixture(t);

    const oneId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_1",
      amountCents: 1_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    const twoId = await seedDonation(t, {
      fundId: fundBId,
      paymentIntentId: "pi_2",
      amountCents: 2_000,
      createdAt: 2_000,
      creditLedger: true,
    });
    const threeId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_3",
      amountCents: 3_000,
      createdAt: 3_000,
      creditLedger: true,
    });

    stubs.payouts.set("po_partial", {
      charges: [
        { paymentIntentId: "pi_1", netCents: 941 },
        { paymentIntentId: "pi_2", netCents: 1_912 },
        { paymentIntentId: "pi_3", netCents: 2_883 },
      ],
    });
    stubs.failTransferKeys.add(`alloc:${twoId}`);

    const first = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_partial",
      payoutCents: 5_736,
    });

    expect(first).toEqual({ allocated: 2, failed: 1 });
    expect((await getDonation(t, oneId))?.allocationStatus).toBe("allocated");
    expect((await getDonation(t, threeId))?.allocationStatus).toBe("allocated");

    // The failed item keeps its payout binding — that's what makes it
    // re-selectable by exactly this payout and nothing else.
    const two = await getDonation(t, twoId);
    expect(two?.allocationStatus).toBe("pending");
    expect(two?.allocationPayoutId).toBe("po_partial");
    expect(two?.payoutNetCents).toBe(1_912);

    expect(await auditActions(t, communityId)).toContain("allocation.transfer_failed");

    // --- Stripe redelivers payout.paid; Increase is healthy again. ---
    stubs.failTransferKeys.clear();
    stubs.transferCalls.length = 0;

    const second = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_partial",
      payoutCents: 5_736,
    });

    expect(second).toEqual({ allocated: 1, failed: 0 });
    // ONLY the unfinished item moved. Items 1 and 3 were not re-transferred.
    expect(stubs.transferCalls).toEqual([
      {
        toAccountId: "account_fund_b",
        amountCents: 1_912,
        idempotencyKey: `alloc:${twoId}`,
      },
    ]);
    expect((await getDonation(t, twoId))?.allocationStatus).toBe("allocated");

    // Every fund now nets out to what the bank holds — one fee debit per
    // donation, never two.
    const fundA = await t.run((ctx) => ctx.db.get(fundAId));
    expect(fundA?.balanceCents).toBe(941 + 2_883);
    const fundB = await t.run((ctx) => ctx.db.get(fundBId));
    expect(fundB?.balanceCents).toBe(1_912);

    const allFeeEntries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    expect(allFeeEntries.filter((e) => e.kind === "fee")).toHaveLength(3);
  });

  test("replaying a fully successful payout is a no-op — no second transfer, no second fee entry", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_1",
      amountCents: 4_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_replay", {
      charges: [{ paymentIntentId: "pi_1", netCents: 3_854 }],
    });

    const first = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_replay",
      payoutCents: 3_854,
    });
    expect(first).toEqual({ allocated: 1, failed: 0 });

    stubs.transferCalls.length = 0;
    const second = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_replay",
      payoutCents: 3_854,
    });

    expect(second).toEqual({ allocated: 0, failed: 0 });
    expect(stubs.transferCalls).toHaveLength(0);

    const entries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    expect(entries.filter((e) => e.kind === "fee")).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(3_854);

    const allocatedAudits = (await auditActions(t, communityId)).filter(
      (a) => a === "donation.allocated",
    );
    expect(allocatedAudits).toHaveLength(1);
    expect((await getDonation(t, donationId))?.allocationStatus).toBe("allocated");
  });

  test("an unreachable Stripe leaves the payout entirely untouched, so a retry can still run it", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_1",
      amountCents: 4_000,
      createdAt: 1_000,
    });
    stubs.payouts.set("po_stripe_down", { error: "Stripe API unreachable" });

    await expect(
      t.action(internal.functions.finance.jobs.runAllocation, {
        communityId,
        stripePayoutId: "po_stripe_down",
        payoutCents: 3_854,
      }),
    ).rejects.toThrow("Stripe API unreachable");

    expect(await t.run((ctx) => ctx.db.query("processedStripePayouts").collect())).toHaveLength(0);
    const donation = await getDonation(t, donationId);
    expect(donation?.allocationStatus).toBe("pending");
    expect(donation?.allocationPayoutId).toBeUndefined();
    expect(stubs.transferCalls).toHaveLength(0);
  });

  test("a matched payout with no receiving Account leaves every item pending and reports them failed", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t, {
      receivingAccount: null,
    });

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_1",
      amountCents: 4_000,
      createdAt: 1_000,
    });
    stubs.payouts.set("po_no_receiving", {
      charges: [{ paymentIntentId: "pi_1", netCents: 3_854 }],
    });

    const result = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_no_receiving",
      payoutCents: 3_854,
    });

    expect(result).toEqual({ allocated: 0, failed: 1 });
    expect((await getDonation(t, donationId))?.allocationStatus).toBe("pending");
    expect(stubs.transferCalls).toHaveLength(0);
  });
});

// ============================================================================
// retryStaleAllocations — recovery for items stranded by a partial failure
// ============================================================================

describe("retryStaleAllocations", () => {
  test("resumes a payout-bound donation whose transfer never landed, without a payout webhook", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const staleCreatedAt = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_stranded",
      amountCents: 4_000,
      createdAt: staleCreatedAt,
      creditLedger: true,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(donationId, {
        allocationPayoutId: "po_gone",
        payoutNetCents: 3_854,
      });
    });

    await t.action(internal.functions.finance.jobs.retryStaleAllocations, {});

    expect(stubs.transferCalls).toEqual([
      {
        toAccountId: "account_fund_a",
        amountCents: 3_854,
        idempotencyKey: `alloc:${donationId}`,
      },
    ]);
    expect((await getDonation(t, donationId))?.allocationStatus).toBe("allocated");
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(3_854);
  });

  test("resumes a FRESH stranded item too — a partial failure isn't made to wait out the 3-day window", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_fresh_stranded",
      amountCents: 4_000,
      createdAt: Date.now(), // minutes old, nowhere near stale
      creditLedger: true,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(donationId, {
        allocationPayoutId: "po_fresh",
        payoutNetCents: 3_854,
      });
    });

    await t.action(internal.functions.finance.jobs.retryStaleAllocations, {});

    expect((await getDonation(t, donationId))?.allocationStatus).toBe("allocated");
    // Not stale, so no alert — just a quiet recovery.
    expect(await auditActions(t, communityId)).not.toContain("allocation.stale_pending");
  });

  test("a stale donation with no payout binding is alerted on, never transferred against a guessed amount", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_unbound",
      amountCents: 4_000,
      createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
      creditLedger: true,
    });

    await t.action(internal.functions.finance.jobs.retryStaleAllocations, {});

    expect(stubs.transferCalls).toHaveLength(0);
    expect(await auditActions(t, communityId)).toContain("allocation.stale_pending");
  });
});

// ============================================================================
// Reconcile honesty — a stranded allocation must show up as drift
// ============================================================================

describe("reconcile on the net basis", () => {
  test("a stranded allocation drifts by the realised fee instead of being masked", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId, fundBId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_1",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_recon", {
      charges: [{ paymentIntentId: "pi_1", netCents: 9_680 }],
    });
    stubs.failTransferKeys.add(`alloc:${donationId}`);

    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_recon",
      payoutCents: 9_680,
    });

    // Pending is now NET (9680), not the 10000 gross that used to make the
    // invariant balance against a ledger that had never been debited.
    const pending = await t.mutation(
      internal.functions.finance.jobs.computePendingAllocationCents,
      { communityId },
    );
    expect(pending.find((p) => p.fundId === fundAId)?.pendingCents).toBe(9_680);

    const fund = await t.run((ctx) => ctx.db.get(fundAId));
    const stranded = await t.mutation(
      internal.functions.finance.jobs.recordReconcileResult,
      {
        fundId: fundAId,
        communityId,
        ledgerBalanceCents: fund!.balanceCents, // 10000, no fee debit yet
        bankBalanceCents: 0, // the transfer never landed
        pendingAllocationCents: 9_680,
      },
    );
    expect(stranded).toEqual({ ok: false, driftCents: 320 });
    expect(await auditActions(t, communityId)).toContain("reconcile.drift");

    // --- And once the retry lands it, the invariant closes exactly. ---
    stubs.failTransferKeys.clear();
    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_recon",
      payoutCents: 9_680,
    });

    const settledFund = await t.run((ctx) => ctx.db.get(fundAId));
    expect(settledFund?.balanceCents).toBe(9_680);
    const settledPending = await t.mutation(
      internal.functions.finance.jobs.computePendingAllocationCents,
      { communityId },
    );
    expect(settledPending.find((p) => p.fundId === fundAId)?.pendingCents).toBe(0);
    expect(
      await t.mutation(internal.functions.finance.jobs.recordReconcileResult, {
        fundId: fundAId,
        communityId,
        ledgerBalanceCents: settledFund!.balanceCents,
        bankBalanceCents: 9_680,
        pendingAllocationCents: 0,
      }),
    ).toEqual({ ok: true, driftCents: 0 });

    // Untouched fund, untouched invariant.
    expect(
      (await t.run((ctx) => ctx.db.get(fundBId)))?.balanceCents,
    ).toBe(0);
  });

  test("a donation still in the Stripe pipeline is pending at GROSS, so the invariant holds pre-payout", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_inflight",
      amountCents: 2_500,
      feeCoverCents: 150,
      createdAt: 1_000,
      creditLedger: true,
    });

    const pending = await t.mutation(
      internal.functions.finance.jobs.computePendingAllocationCents,
      { communityId },
    );
    expect(pending.find((p) => p.fundId === fundAId)?.pendingCents).toBe(2_650);

    const fund = await t.run((ctx) => ctx.db.get(fundAId));
    expect(
      await t.mutation(internal.functions.finance.jobs.recordReconcileResult, {
        fundId: fundAId,
        communityId,
        ledgerBalanceCents: fund!.balanceCents,
        bankBalanceCents: 0,
        pendingAllocationCents: 2_650,
      }),
    ).toEqual({ ok: true, driftCents: 0 });
  });
});
