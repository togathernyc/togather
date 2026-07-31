/**
 * Payout allocation: NET matching, never-stall selection, per-item failure
 * recovery, and honest reconcile (ADR-032 §3 + Phase-2 requirement 6).
 *
 * Unlike the other finance suites, this one drives `runAllocation` — the
 * internalAction itself — end to end, because the bugs it covers live in the
 * action's control flow (what it claims before it transfers, what it does
 * when transfer N of M throws, what a redelivered webhook re-does). Both
 * providers the action lazy-imports are mocked at the module boundary:
 * `getPayoutComposition` (Stripe balance transactions) and
 * `createAccountTransfer` (Increase — including its idempotency-key
 * behaviour, so the "same key returns the same transfer" lock is genuinely
 * exercised rather than assumed).
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
  /** payoutId -> composition Stripe reports for it, or an error to throw. */
  payouts: new Map<
    string,
    | {
        charges: unknown[];
        reversedPaymentIntentIds?: string[];
        unattributedNetCents?: number;
      }
    | { error: string }
  >(),
  /** Increase idempotency keys that should fail this run. */
  failTransferKeys: new Set<string>(),
  /** Every createAccountTransfer call, in order. */
  transferCalls: [] as Array<{
    toAccountId: string;
    amountCents: number;
    idempotencyKey: string;
  }>,
  /**
   * Idempotency key -> the transfer Increase already minted for it. Modeling
   * this matters: `alloc:{donationId}` is one of the locks the exactly-once
   * claim rests on, and a mock that mints a fresh id every call can never
   * exercise it.
   */
  transfersByKey: new Map<string, { id: string; status: string }>(),
  /** Keys Increase collapsed into an existing transfer rather than creating one. */
  dedupedKeys: [] as string[],
}));

vi.mock("../lib/finance/stripeConnect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/finance/stripeConnect")>();
  return {
    ...actual,
    // The real one takes `payoutCents` too and refuses a composition whose
    // nets don't add up to it — that guard is exercised against raw Stripe
    // rows in finance-payout-nets.test.ts. Here the composition is the
    // fixture, so the third argument is irrelevant.
    getPayoutComposition: vi.fn(async (_accountId: string, payoutId: string) => {
      const stub = stubs.payouts.get(payoutId);
      if (!stub) {
        throw new Error(`test stub missing for payout ${payoutId}`);
      }
      if ("error" in stub) {
        throw new Error(stub.error);
      }
      return {
        charges: stub.charges as PayoutChargeNet[],
        reversedPaymentIntentIds: stub.reversedPaymentIntentIds ?? [],
        unattributedNetCents: stub.unattributedNetCents ?? 0,
      };
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
        // Increase's documented behaviour: at most one object per key. A
        // repeat returns the SAME transfer instead of moving money again.
        const existing = stubs.transfersByKey.get(input.idempotencyKey);
        if (existing) {
          stubs.dedupedKeys.push(input.idempotencyKey);
          return existing;
        }
        const transfer = { id: `at_${input.idempotencyKey}`, status: "pending" };
        stubs.transfersByKey.set(input.idempotencyKey, transfer);
        return transfer;
      },
    ),
  };
});

beforeEach(() => {
  stubs.payouts.clear();
  stubs.failTransferKeys.clear();
  stubs.transferCalls.length = 0;
  stubs.transfersByKey.clear();
  stubs.dedupedKeys.length = 0;
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

  test("THE RACE: a second pass over the same payout cannot also take an item the first is still holding", async () => {
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
    // Second pass while the first is still mid-transfer (a redelivered
    // payout.paid, or the :45 retry cron). Before the lease, BOTH would have
    // been handed this donation and both would have issued
    // `alloc:{donationId}` concurrently.
    const second = await t.mutation(internal.functions.finance.jobs.planAllocations, args);

    expect(first.alreadyClaimed).toBe(false);
    expect(first.plan.map((p) => p.donationId)).toEqual([donationId]);

    expect(second.alreadyClaimed).toBe(true);
    expect(second.plan).toHaveLength(0);
    expect(second.leasedElsewhere).toBe(1);

    const payoutRows = await t.run((ctx) =>
      ctx.db.query("processedStripePayouts").collect(),
    );
    expect(payoutRows).toHaveLength(1);
  });

  test("an expired lease is reclaimable — a pass that died mid-transfer can't strand an item forever", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_expired_lease",
      amountCents: 5_000,
      createdAt: 1_000,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(donationId, {
        allocationPayoutId: "po_expired",
        payoutNetCents: 4_825,
        // Claimed by a pass that never came back. TTL is 15 minutes.
        allocationTransferStartedAt: Date.now() - 60 * 60 * 1000,
      });
    });

    const result = await t.mutation(internal.functions.finance.jobs.planAllocations, {
      communityId,
      payoutCents: 4_825,
      stripePayoutId: "po_expired",
      charges: [{ paymentIntentId: "pi_expired_lease", netCents: 4_825 }],
    });

    expect(result.plan.map((p) => p.donationId)).toEqual([donationId]);
    expect(result.leasedElsewhere).toBe(0);
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

// ============================================================================
// Refunds — the P0. A gift the donor already got back must never reach a
// group's spendable Increase Account.
// ============================================================================

/** Drive the real webhook mutation, not a hand-patched row: the refund's
 * effect on allocation is the thing under test. */
async function refundDonation(
  t: ReturnType<typeof convexTest>,
  args: { paymentIntentId: string; chargeId: string; amountRefundedCents: number },
) {
  await t.mutation(internal.functions.finance.giving.recordDonationRefund, args);
}

describe("refunds and allocation", () => {
  test("THE P0: a donation refunded BEFORE its payout transfers nothing and leaves no negative balance", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    // $100 gift. Ledger +10000.
    const refundedId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_refunded",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    // A healthy gift in the same payout, to prove the refund doesn't take
    // the rest of the batch down with it.
    const healthyId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_healthy",
      amountCents: 5_000,
      createdAt: 2_000,
      creditLedger: true,
    });

    // Donor is refunded in full the next day, before the T+2 payout.
    await refundDonation(t, {
      paymentIntentId: "pi_refunded",
      chargeId: "ch_refunded",
      amountRefundedCents: 10_000,
    });
    expect((await getDonation(t, refundedId))?.allocationStatus).toBe("refunded");
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(5_000);

    // The payout carries the charge (+9680) AND the refund (−10000). Netted,
    // that PaymentIntent contributed nothing, so Stripe reports it as
    // reversed and it is not a fundable charge.
    stubs.payouts.set("po_with_refund", {
      charges: [{ paymentIntentId: "pi_healthy", netCents: 4_825 }],
      reversedPaymentIntentIds: ["pi_refunded"],
    });

    const result = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_with_refund",
      payoutCents: 4_825,
    });

    expect(result).toEqual({ allocated: 1, failed: 0 });
    // The ONLY transfer is the healthy gift. Not one cent of the refunded
    // gift reached the group's Account.
    expect(stubs.transferCalls).toEqual([
      {
        toAccountId: "account_fund_a",
        amountCents: 4_825,
        idempotencyKey: `alloc:${healthyId}`,
      },
    ]);

    const refunded = await getDonation(t, refundedId);
    expect(refunded?.allocationStatus).toBe("refunded");
    expect(refunded?.allocationPayoutId).toBeUndefined();
    expect((await getDonation(t, healthyId))?.allocationStatus).toBe("allocated");

    // Ledger: +10000 −10000 (refund) +5000 −175 (fee on the healthy gift).
    // Never negative, and exactly what the bank now holds.
    const fund = await t.run((ctx) => ctx.db.get(fundAId));
    expect(fund?.balanceCents).toBe(4_825);
    expect(fund!.balanceCents).toBeGreaterThanOrEqual(0);

    // And the invariant closes: bank 4825, nothing pending.
    const pending = await t.mutation(
      internal.functions.finance.jobs.computePendingAllocationCents,
      { communityId },
    );
    expect(pending.find((p) => p.fundId === fundAId)?.pendingCents).toBe(0);
    expect(
      await t.mutation(internal.functions.finance.jobs.recordReconcileResult, {
        fundId: fundAId,
        communityId,
        ledgerBalanceCents: fund!.balanceCents,
        bankBalanceCents: 4_825,
        pendingAllocationCents: 0,
      }),
    ).toEqual({ ok: true, driftCents: 0 });

    // No fee was ever charged for the refunded gift.
    const entries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    expect(entries.filter((e) => e.kind === "fee")).toHaveLength(1);
  });

  test("a PARTIAL refund before the payout allocates only the remainder, and the refund isn't double-debited", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_partial",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });

    await refundDonation(t, {
      paymentIntentId: "pi_partial",
      chargeId: "ch_partial",
      amountRefundedCents: 3_000,
    });

    // Still allocatable — the donor kept $70 of the gift with the group.
    const afterRefund = await getDonation(t, donationId);
    expect(afterRefund?.allocationStatus).toBe("pending");
    expect(afterRefund?.refundedCents).toBe(3_000);
    // Pending is the remainder, not the gross — otherwise the nightly
    // invariant drifts by the refunded amount forever.
    expect(
      (
        await t.mutation(
          internal.functions.finance.jobs.computePendingAllocationCents,
          { communityId },
        )
      ).find((p) => p.fundId === fundAId)?.pendingCents,
    ).toBe(7_000);

    // The payout delivers 10000 − 320 fee − 3000 refund = 6680 for this PI.
    stubs.payouts.set("po_partial_refund", {
      charges: [{ paymentIntentId: "pi_partial", netCents: 6_680 }],
    });

    const result = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_partial_refund",
      payoutCents: 6_680,
    });
    expect(result).toEqual({ allocated: 1, failed: 0 });
    expect(stubs.transferCalls[0].amountCents).toBe(6_680);

    // The fee debit is 320 — Stripe's actual fee — NOT 3320. Charging
    // `gross − net` here would debit the 3000 refund a second time on top of
    // the refund entry that already exists.
    const entries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    const fee = entries.find((e) => e.kind === "fee");
    expect(fee).toMatchObject({ direction: "debit", amountCents: 320 });

    // 10000 − 3000 − 320 = 6680, exactly what the group Account holds.
    const fund = await t.run((ctx) => ctx.db.get(fundAId));
    expect(fund?.balanceCents).toBe(6_680);
    expect(
      await t.mutation(internal.functions.finance.jobs.recordReconcileResult, {
        fundId: fundAId,
        communityId,
        ledgerBalanceCents: fund!.balanceCents,
        bankBalanceCents: 6_680,
        pendingAllocationCents: 0,
      }),
    ).toEqual({ ok: true, driftCents: 0 });
  });

  test("a full refund AFTER allocation reverses the fee instead of leaving the fund negative", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_late_refund",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_late", {
      charges: [{ paymentIntentId: "pi_late_refund", netCents: 9_680 }],
    });
    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_late",
      payoutCents: 9_680,
    });
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(9_680);

    // Donor refunded a week later. Without the fee reversal this lands at
    // −320 (10000 credit − 320 fee − 10000 refund) and renders to members.
    await refundDonation(t, {
      paymentIntentId: "pi_late_refund",
      chargeId: "ch_late",
      amountRefundedCents: 10_000,
    });

    const fund = await t.run((ctx) => ctx.db.get(fundAId));
    expect(fund?.balanceCents).toBe(0);
    expect(fund!.balanceCents).toBeGreaterThanOrEqual(0);

    // Append-only: the fee debit is still there, cancelled by a credit.
    const entries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    const feeEntries = entries.filter((e) => e.kind === "fee");
    expect(feeEntries).toHaveLength(2);
    expect(feeEntries.map((e) => e.direction).sort()).toEqual(["credit", "debit"]);

    // Replaying the same cumulative refund reverses nothing twice.
    await refundDonation(t, {
      paymentIntentId: "pi_late_refund",
      chargeId: "ch_late",
      amountRefundedCents: 10_000,
    });
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(0);
  });

  test("a partial refund that stays under the net does NOT reverse the fee", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_small_late_refund",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_small_late", {
      charges: [{ paymentIntentId: "pi_small_late_refund", netCents: 9_680 }],
    });
    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_small_late",
      payoutCents: 9_680,
    });

    await refundDonation(t, {
      paymentIntentId: "pi_small_late_refund",
      chargeId: "ch_small_late",
      amountRefundedCents: 1_000,
    });

    // 10000 − 320 − 1000 = 8680: non-negative on its own, so the fee stands.
    // Stripe really did keep it on the $90 the fund retained.
    const fund = await t.run((ctx) => ctx.db.get(fundAId));
    expect(fund?.balanceCents).toBe(8_680);
    const entries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    expect(entries.filter((e) => e.kind === "fee")).toHaveLength(1);
  });

  test("a partial refund landing after a payout bound the gift keeps the pending sum honest", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_bound_partial",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    // Bound at the full net — the payout couldn't have known about a refund
    // that hadn't happened yet.
    await t.run(async (ctx) => {
      await ctx.db.patch(donationId, {
        allocationPayoutId: "po_bound_partial",
        payoutNetCents: 9_680,
      });
    });

    await refundDonation(t, {
      paymentIntentId: "pi_bound_partial",
      chargeId: "ch_bound_partial",
      amountRefundedCents: 3_000,
    });

    // Ledger is 7000. Counting the stale 9680 net as pending would drift by
    // the refunded 3000 every night and never close.
    const fund = await t.run((ctx) => ctx.db.get(fundAId));
    expect(fund?.balanceCents).toBe(7_000);
    const pending = await t.mutation(
      internal.functions.finance.jobs.computePendingAllocationCents,
      { communityId },
    );
    expect(pending.find((p) => p.fundId === fundAId)?.pendingCents).toBe(7_000);
    expect(
      await t.mutation(internal.functions.finance.jobs.recordReconcileResult, {
        fundId: fundAId,
        communityId,
        ledgerBalanceCents: fund!.balanceCents,
        bankBalanceCents: 0,
        pendingAllocationCents: 7_000,
      }),
    ).toEqual({ ok: true, driftCents: 0 });
  });

  test("P1-7: a partial refund settling in a LATER payout transfers only what's left of the gift", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    // $100 gift, $30 refunded before the payout settles. Stripe does NOT
    // guarantee the refund's balance transaction shares the charge's payout,
    // so this payout still carries the charge at its FULL net (9680) — the
    // netting in `getPayoutComposition` cannot help here, and the gift stays
    // legitimately "pending" so the full-refund belt-and-braces doesn't reach
    // it either. Taking Stripe's net verbatim moved 9680 while the ledger
    // said 7000, leaving 2680 of returned donor money spendable on the
    // group's card.
    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_late_refund",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    await refundDonation(t, {
      paymentIntentId: "pi_late_refund",
      chargeId: "ch_late_refund",
      amountRefundedCents: 3_000,
    });

    stubs.payouts.set("po_late_refund", {
      charges: [{ paymentIntentId: "pi_late_refund", netCents: 9_680 }],
    });

    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_late_refund",
      payoutCents: 9_680,
    });

    // What the bank was actually ASKED to move is the assertion that matters.
    expect(stubs.transferCalls).toEqual([
      {
        toAccountId: "account_fund_a",
        amountCents: 7_000, // 10000 gross − 3000 refunded, NOT Stripe's 9680
        idempotencyKey: `alloc:${donationId}`,
      },
    ]);

    const donation = await getDonation(t, donationId);
    expect(donation?.allocationStatus).toBe("allocated");
    expect(donation?.payoutNetCents).toBe(7_000);

    // Ledger and bank agree exactly: credit 10000, refund 3000, no fee left
    // to realise on the part the fund kept.
    const entries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    expect(entries.map((e) => `${e.kind}:${e.direction}:${e.amountCents}`)).toEqual([
      "donation:credit:10000",
      "refund:debit:3000",
    ]);
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(7_000);
  });

  test("P1-7: the retry cron resumes a bound gift at the refunded-down amount, not its stale stamped net", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_bound_then_partial",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    // Bound at the full net by a pass whose transfer never landed — it
    // couldn't have known about a refund that hadn't happened yet.
    await t.run(async (ctx) => {
      await ctx.db.patch(donationId, {
        allocationPayoutId: "po_bound_partial_retry",
        payoutNetCents: 9_680,
      });
    });
    await refundDonation(t, {
      paymentIntentId: "pi_bound_then_partial",
      chargeId: "ch_bound_partial_retry",
      amountRefundedCents: 3_000,
    });

    await t.action(internal.functions.finance.jobs.retryStaleAllocations, {});

    expect(stubs.transferCalls).toEqual([
      {
        toAccountId: "account_fund_a",
        amountCents: 7_000,
        idempotencyKey: `alloc:${donationId}`,
      },
    ]);
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(7_000);
  });

  test("a gift refunded while bound to a payout is dropped by the retry cron, not transferred", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_bound_then_refunded",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    // A pass bound it to a payout but its transfer never landed.
    await t.run(async (ctx) => {
      await ctx.db.patch(donationId, {
        allocationPayoutId: "po_bound",
        payoutNetCents: 9_680,
      });
    });

    await refundDonation(t, {
      paymentIntentId: "pi_bound_then_refunded",
      chargeId: "ch_bound",
      amountRefundedCents: 10_000,
    });

    await t.action(internal.functions.finance.jobs.retryStaleAllocations, {});

    expect(stubs.transferCalls).toHaveLength(0);
    expect((await getDonation(t, donationId))?.allocationStatus).toBe("refunded");
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(0);
  });
});

// ============================================================================
// Failure-mode separation and observability
// ============================================================================

describe("transfer vs. record failure", () => {
  test("transfer LANDS but recording throws: audited as record_failed, and the retry re-uses the same transfer", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_record_fail",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_record_fail", {
      charges: [{ paymentIntentId: "pi_record_fail", netCents: 9_680 }],
    });

    // `postLedgerEntry` throws on a closed fund — a real way for the
    // recording half to fail after the money has already moved.
    await t.run(async (ctx) => {
      await ctx.db.patch(fundAId, { status: "closed" });
    });

    const first = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_record_fail",
      payoutCents: 9_680,
    });
    expect(first).toEqual({ allocated: 0, failed: 1 });

    // The money DID move.
    expect(stubs.transferCalls).toEqual([
      {
        toAccountId: "account_fund_a",
        amountCents: 9_680,
        idempotencyKey: `alloc:${donationId}`,
      },
    ]);
    // And the audit says so, instead of claiming the transfer failed.
    const actions = await auditActions(t, communityId);
    expect(actions).toContain("allocation.record_failed");
    expect(actions).not.toContain("allocation.transfer_failed");

    const failureRow = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    const recordFailed = failureRow.find((r) => r.action === "allocation.record_failed");
    expect(JSON.parse(recordFailed!.detailsJson!)).toMatchObject({
      donationId,
      increaseTransferId: `at_alloc:${donationId}`,
    });

    // The item is released, not left leased.
    expect(
      (await getDonation(t, donationId))?.allocationTransferStartedAt,
    ).toBeUndefined();

    // --- The retry, once the fund is usable again. ---
    await t.run(async (ctx) => {
      await ctx.db.patch(fundAId, { status: "active" });
    });
    stubs.transferCalls.length = 0;

    const second = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_record_fail",
      payoutCents: 9_680,
    });
    expect(second).toEqual({ allocated: 1, failed: 0 });

    // Increase collapsed the replay into the SAME transfer — money moved once.
    expect(stubs.dedupedKeys).toEqual([`alloc:${donationId}`]);
    expect(stubs.transfersByKey.size).toBe(1);

    // One fee entry, one donation.allocated audit row.
    const entries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    expect(entries.filter((e) => e.kind === "fee")).toHaveLength(1);
    expect(
      (await auditActions(t, communityId)).filter((a) => a === "donation.allocated"),
    ).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(fundAId)))?.balanceCents).toBe(9_680);
  });

  test("a transfer that never happens is still audited as transfer_failed, with no transfer id", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_transfer_fail",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_transfer_fail", {
      charges: [{ paymentIntentId: "pi_transfer_fail", netCents: 9_680 }],
    });
    stubs.failTransferKeys.add(`alloc:${donationId}`);

    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_transfer_fail",
      payoutCents: 9_680,
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    const failed = rows.find((r) => r.action === "allocation.transfer_failed");
    expect(failed).toBeDefined();
    expect(JSON.parse(failed!.detailsJson!).increaseTransferId).toBeUndefined();
    // Released so the next pass can pick it up without waiting out the TTL.
    expect(
      (await getDonation(t, donationId))?.allocationTransferStartedAt,
    ).toBeUndefined();
  });
});

describe("unmatched payouts are observable", () => {
  test("a payout that matches NOTHING alarms instead of returning zero quietly", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_unrelated",
      amountCents: 4_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    // Stripe reports nothing for the payout — reconciliation lag, a manual
    // payout, or a broken account. There is no automatic recovery from here,
    // so it MUST be loud.
    stubs.payouts.set("po_empty", { charges: [] });

    const result = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_empty",
      payoutCents: 9_680,
    });

    expect(result).toEqual({ allocated: 0, failed: 0 });
    expect(stubs.transferCalls).toHaveLength(0);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    const unmatched = rows.find((r) => r.action === "allocation.payout_unmatched");
    expect(unmatched).toBeDefined();
    expect(JSON.parse(unmatched!.detailsJson!)).toMatchObject({
      stripePayoutId: "po_empty",
      payoutCents: 9_680,
      leftoverCents: 9_680,
      matchedCount: 0,
      chargeCount: 0,
    });
  });

  test("a material unmatched remainder alarms even when some donations did allocate", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_known",
      amountCents: 1_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    // The payout is 50000 but only 941 of it maps to a donation we know —
    // the rest is money we cannot attribute to anyone.
    stubs.payouts.set("po_mostly_unmatched", {
      charges: [{ paymentIntentId: "pi_known", netCents: 941 }],
    });

    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_mostly_unmatched",
      payoutCents: 50_000,
    });

    expect(await auditActions(t, communityId)).toContain("allocation.payout_unmatched");
  });

  test("P1-8: replaying a HEALTHY payout raises no unmatched alarm — that's the success condition", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_healthy",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_healthy", {
      charges: [{ paymentIntentId: "pi_healthy", netCents: 9_680 }],
    });

    const first = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_healthy",
      payoutCents: 9_680,
    });
    expect(first).toEqual({ allocated: 1, failed: 0 });

    // webhooks.ts routes `payout.reconciliation_completed` to this same
    // handler, and Stripe emits it after EVERY payout — so this second pass
    // is the normal course of business, not an edge case. The gift is
    // already allocated, so the plan is empty; treating an empty plan as
    // "matched nothing" wrote a full-payout `payout_unmatched` row (with
    // leftoverCents equal to the entire payout) on every healthy payout,
    // forever, drowning the one signal that has no automatic recovery.
    const second = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_healthy",
      payoutCents: 9_680,
    });
    expect(second).toEqual({ allocated: 0, failed: 0 });

    expect(await auditActions(t, communityId)).toEqual(["donation.allocated"]);
  });

  test("P1-8: a payout that finished some items but genuinely lost the rest still alarms", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_known",
      amountCents: 1_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    // 941 of a 50000 payout maps to a gift we know. The alarm must survive
    // the P1-8 guard: "something was already allocated" is not a licence to
    // stop looking at the 49059 we cannot account for.
    stubs.payouts.set("po_partial_known", {
      charges: [{ paymentIntentId: "pi_known", netCents: 941 }],
    });

    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_partial_known",
      payoutCents: 50_000,
    });
    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_partial_known",
      payoutCents: 50_000,
    });

    const unmatched = (await auditActions(t, communityId)).filter(
      (a) => a === "allocation.payout_unmatched",
    );
    expect(unmatched).toHaveLength(2);
  });

  test("P1-6: a payout short by money we can't attribute is REFUSED, not allocated around", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_healthy",
      amountCents: 50_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    // A reversal Stripe attributed to this payout that we could not tie to
    // any PaymentIntent. The charge rows now sum to MORE than the payout
    // delivered, so funding them all would move money that never arrived —
    // and the residual-budget check would quietly strand whichever gift
    // sorted last instead, with leftoverCents at 0.
    stubs.payouts.set("po_short", {
      charges: [{ paymentIntentId: "pi_healthy", netCents: 48_500 }],
      unattributedNetCents: -48_500,
    });

    const result = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_short",
      payoutCents: 0,
    });

    expect(result).toEqual({ allocated: 0, failed: 0 });
    expect(stubs.transferCalls).toEqual([]);
    const donation = await getDonation(t, donationId);
    expect(donation?.allocationStatus).toBe("pending");
    expect(donation?.allocationPayoutId).toBeUndefined();

    const rows = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    const unmatched = rows.find((r) => r.action === "allocation.payout_unmatched");
    expect(JSON.parse(unmatched!.detailsJson!)).toMatchObject({
      stripePayoutId: "po_short",
      refused: true,
      unattributedNetCents: -48_500,
    });
  });

  test("P1-6: a gift skipped for overrunning the payout alarms instead of vanishing", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_a",
      amountCents: 50_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_b",
      amountCents: 50_000,
      createdAt: 2_000,
      creditLedger: true,
    });
    // Both gifts are in the payout at 49600, but the payout only carried one
    // of them. The second is skipped — correctly, it can't be funded — and
    // leftoverCents then comes out at 0, which used to look perfectly
    // healthy. A stranded gift is not a healthy pass.
    stubs.payouts.set("po_overrun", {
      charges: [
        { paymentIntentId: "pi_a", netCents: 49_600 },
        { paymentIntentId: "pi_b", netCents: 49_600 },
      ],
    });

    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_overrun",
      payoutCents: 49_600,
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    const unmatched = rows.find((r) => r.action === "allocation.payout_unmatched");
    expect(unmatched).toBeDefined();
    expect(JSON.parse(unmatched!.detailsJson!)).toMatchObject({
      leftoverCents: 0, // the number that made this invisible
      overrunSkippedCount: 1,
    });
  });

  test("a fully matched payout does not alarm", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_exact",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_exact", {
      charges: [{ paymentIntentId: "pi_exact", netCents: 9_680 }],
    });

    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_exact",
      payoutCents: 9_680,
    });

    expect(await auditActions(t, communityId)).not.toContain(
      "allocation.payout_unmatched",
    );
  });
});

describe("payout.failed", () => {
  test("unbinds the donations a paid-then-failed payout claimed, so the retry cron stops chasing them", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_failed_payout",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_will_fail", {
      charges: [{ paymentIntentId: "pi_failed_payout", netCents: 9_680 }],
    });
    stubs.failTransferKeys.add(`alloc:${donationId}`);
    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_will_fail",
      payoutCents: 9_680,
    });
    expect((await getDonation(t, donationId))?.allocationPayoutId).toBe("po_will_fail");

    // The bank rejects the payout. The money never reached the receiving
    // Account, so nothing may be transferred out of it.
    const { unbound } = await t.mutation(
      internal.functions.finance.jobs.unbindFailedPayout,
      { communityId, stripePayoutId: "po_will_fail" },
    );
    expect(unbound).toBe(1);

    const donation = await getDonation(t, donationId);
    expect(donation?.allocationPayoutId).toBeUndefined();
    expect(donation?.payoutNetCents).toBeUndefined();
    expect(donation?.allocationStatus).toBe("pending");

    // The hourly retry now finds nothing resumable — no transfer against an
    // Account that never received the money.
    stubs.failTransferKeys.clear();
    stubs.transferCalls.length = 0;
    await t.action(internal.functions.finance.jobs.retryStaleAllocations, {});
    expect(stubs.transferCalls).toHaveLength(0);
    expect(await auditActions(t, communityId)).toContain("allocation.payout_failed");
  });

  test("leaves an already-allocated donation alone — a completed transfer is a clawback, not a rollback", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedAllocFixture(t);

    const donationId = await seedDonation(t, {
      fundId: fundAId,
      paymentIntentId: "pi_already_done",
      amountCents: 10_000,
      createdAt: 1_000,
      creditLedger: true,
    });
    stubs.payouts.set("po_paid_then_failed", {
      charges: [{ paymentIntentId: "pi_already_done", netCents: 9_680 }],
    });
    await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_paid_then_failed",
      payoutCents: 9_680,
    });

    const { unbound } = await t.mutation(
      internal.functions.finance.jobs.unbindFailedPayout,
      { communityId, stripePayoutId: "po_paid_then_failed" },
    );
    expect(unbound).toBe(0);
    const donation = await getDonation(t, donationId);
    expect(donation?.allocationStatus).toBe("allocated");
    expect(donation?.allocationPayoutId).toBe("po_paid_then_failed");
  });
});
