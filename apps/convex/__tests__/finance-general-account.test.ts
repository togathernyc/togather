/**
 * The community General Account (ADR-032 §1).
 *
 * A community's Increase Entity holds a receiving Account (Stripe's payout
 * destination — transit for money still attributed to individual funds) AND a
 * General Account, which is the community-wide fund's own bank account. The
 * General Account was specified but never built: `recordProvisioned` created
 * the "General Fund" row with no `increaseAccountId`, so general-fund
 * donations were marked "allocated" with no transfer (their cash actually sat
 * in receiving) and the fund was filtered out of the nightly reconcile
 * entirely.
 *
 * Unlike the other finance suites, this one MOCKS lib/finance/increase +
 * lib/finance/stripeConnect and then genuinely RUNS the actions
 * (provisionProviders, provisionFundAccount, runAllocation,
 * runNightlyReconcile). Those suites freeze timers so scheduled actions never
 * fire, which is right for them but would silently skip exactly the code this
 * change lives in — so here the actions are invoked directly against fakes,
 * and the assertions are about what was asked of the bank.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-general-account.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Provider fakes
// ============================================================================

const createAccount = vi.fn(async (entityId: string, name: string) => ({
  id: `account_${name.toLowerCase().replace(/\W+/g, "_")}_${entityId}`,
  name,
  status: "open",
}));
const createEntity = vi.fn(async () => ({ id: "entity_fake", status: "active" }));
const createAccountNumber = vi.fn(async () => ({
  id: "account_number_fake",
  accountNumber: "987654321",
  routingNumber: "101010101",
}));
const createAccountTransfer = vi.fn(async () => ({
  id: `transfer_${createAccountTransfer.mock.calls.length}`,
  status: "complete",
}));
const getAccountBalance = vi.fn(async () => ({
  currentBalanceCents: 0,
  availableBalanceCents: 0,
}));

/**
 * Allocation matches a payout against the per-charge NETS Stripe reports for
 * it, so a `runAllocation` test has to say what Stripe would report. Hoisted
 * because `vi.mock` factories are hoisted above the module body.
 */
const payoutStubs = vi.hoisted(
  () => new Map<string, Array<{ paymentIntentId: string; netCents: number }>>(),
);

vi.mock("../lib/finance/increase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/finance/increase")>();
  return {
    ...actual,
    createEntity: (...args: unknown[]) => (createEntity as any)(...args),
    createAccount: (...args: unknown[]) => (createAccount as any)(...args),
    createAccountNumber: (...args: unknown[]) => (createAccountNumber as any)(...args),
    createAccountTransfer: (...args: unknown[]) => (createAccountTransfer as any)(...args),
    getAccountBalance: (...args: unknown[]) => (getAccountBalance as any)(...args),
  };
});

vi.mock("../lib/finance/stripeConnect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/finance/stripeConnect")>();
  return {
    ...actual,
    createConnectedAccount: vi.fn(async () => "acct_fake"),
    attachIncreasePayoutAccount: vi.fn(async () => undefined),
    createAccountOnboardingLink: vi.fn(async () => "https://connect.stripe.test/x"),
    getPayoutComposition: vi.fn(async (_accountId: string, payoutId: string) => {
      const charges = payoutStubs.get(payoutId);
      if (!charges) {
        throw new Error(`test stub missing for payout ${payoutId}`);
      }
      // Nothing here exercises reversals — finance-payout-nets.test.ts owns
      // the netting — so every stubbed charge is a clean positive net.
      return {
        charges,
        reversedPaymentIntentIds: [],
        unattributedReversalCents: 0,
      };
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  payoutStubs.clear();
});

// ============================================================================
// Seeding
// ============================================================================

const ADDRESS = {
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

/** Bare community + the "group-giving" flag on. No finance row yet. */
async function seedCommunity(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: timestamp,
    });
    const communityId = await ctx.db.insert("communities", {
      name: "General Account Church",
      slug: `gac-${Math.floor(Math.random() * 1_000_000)}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { communityId, timestamp };
  });
}

async function insertFinance(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  overrides: Record<string, unknown> = {},
) {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    return await ctx.db.insert("communityFinance", {
      communityId,
      legalName: "General Account Church Inc",
      ein: "12-3456789",
      address: ADDRESS,
      onboardingStatus: "collecting" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    });
  });
}

async function insertFund(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  fields: {
    type: "general" | "group";
    name: string;
    increaseAccountId?: string;
    balanceCents?: number;
  },
): Promise<Id<"funds">> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    return await ctx.db.insert("funds", {
      communityId,
      name: fields.name,
      type: fields.type,
      increaseAccountId: fields.increaseAccountId,
      status: "active" as const,
      balanceCents: fields.balanceCents ?? 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
}

async function insertDonation(
  t: ReturnType<typeof convexTest>,
  fundId: Id<"funds">,
  amountCents: number,
  /** Allocation matches on this, so a payout stub has to name it. */
  paymentIntentId = `pi_${Math.random().toString(36).slice(2)}`,
): Promise<Id<"donations">> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    return await ctx.db.insert("donations", {
      fundId,
      amountCents,
      feeCoverCents: 0,
      stripePaymentIntentId: paymentIntentId,
      allocationStatus: "pending" as const,
      receiptEmailStatus: "pending" as const,
      createdAt: timestamp,
    });
  });
}

// ============================================================================
// Provisioning
// ============================================================================

describe("provisionProviders creates the General Account", () => {
  test("mints a General Account alongside the receiving Account and binds it to the General fund", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    await insertFinance(t, communityId);

    await t.action(internal.functions.finance.onboarding.provisionProviders, {
      communityId,
    });

    // Two accounts under the Entity: receiving + General (ADR-032 §1).
    const accountNames = createAccount.mock.calls.map((c) => c[1]);
    expect(accountNames).toEqual(["Receiving Account", "General Account"]);

    const generalFund = await t.run((ctx) =>
      ctx.db
        .query("funds")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .filter((q) => q.eq(q.field("type"), "general"))
        .first(),
    );
    expect(generalFund).not.toBeNull();
    expect(generalFund?.increaseAccountId).toBeTruthy();

    // …and it is NOT the receiving Account — the two must stay distinct, or
    // "allocating" to the General fund would be a transfer to itself.
    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(generalFund?.increaseAccountId).not.toBe(
      finance?.increaseReceivingAccountId,
    );
  });

  test("re-running provisioning reuses the existing General Account", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    await insertFinance(t, communityId);

    await t.action(internal.functions.finance.onboarding.provisionProviders, {
      communityId,
    });
    const firstAccountId = (
      await t.run((ctx) =>
        ctx.db
          .query("funds")
          .withIndex("by_community", (q) => q.eq("communityId", communityId))
          .filter((q) => q.eq(q.field("type"), "general"))
          .first(),
      )
    )?.increaseAccountId;

    createAccount.mockClear();
    await t.action(internal.functions.finance.onboarding.provisionProviders, {
      communityId,
    });

    // Nothing new asked of Increase, and the fund still points at the same
    // account — a second General Account would silently split the balance.
    expect(createAccount).not.toHaveBeenCalled();
    const generalFund = await t.run((ctx) =>
      ctx.db
        .query("funds")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .filter((q) => q.eq(q.field("type"), "general"))
        .first(),
    );
    expect(generalFund?.increaseAccountId).toBe(firstAccountId);
  });
});

// ============================================================================
// Backfill for communities provisioned before the General Account existed
// ============================================================================

describe("backfillGeneralFundAccounts", () => {
  test("gives an already-provisioned community's General fund an Account", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    await insertFinance(t, communityId, {
      onboardingStatus: "live",
      stripeConnectedAccountId: "acct_live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_receiving_live",
    });
    // The broken shape this migration exists for: a General fund with no bank
    // account behind it.
    const generalFundId = await insertFund(t, communityId, {
      type: "general",
      name: "General Fund",
    });

    const result = await t.action(
      internal.migrations.backfillGeneralFundAccounts
        .backfillGeneralFundAccounts,
      {},
    );
    expect(result.provisioned).toBe(1);

    const fund = await t.run((ctx) => ctx.db.get(generalFundId));
    expect(fund?.increaseAccountId).toBeTruthy();

    const audits = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", generalFundId))
        .collect(),
    );
    expect(
      audits.some((a) => a.action === "fund.account_provisioned"),
    ).toBe(true);
  });

  test("re-running is a no-op — never a second Account", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    await insertFinance(t, communityId, {
      onboardingStatus: "live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_receiving_live",
    });
    await insertFund(t, communityId, { type: "general", name: "General Fund" });

    await t.action(
      internal.migrations.backfillGeneralFundAccounts
        .backfillGeneralFundAccounts,
      {},
    );
    createAccount.mockClear();
    const second = await t.action(
      internal.migrations.backfillGeneralFundAccounts
        .backfillGeneralFundAccounts,
      {},
    );

    expect(second.provisioned).toBe(0);
    expect(createAccount).not.toHaveBeenCalled();
  });

  test("skips a community whose own onboarding never produced an Entity", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    await insertFinance(t, communityId, { onboardingStatus: "collecting" });
    const generalFundId = await insertFund(t, communityId, {
      type: "general",
      name: "General Fund",
    });

    const result = await t.action(
      internal.migrations.backfillGeneralFundAccounts
        .backfillGeneralFundAccounts,
      {},
    );

    // Nothing to hang an Account off yet; provisionProviders will create it
    // when the community finishes onboarding.
    expect(result.provisioned).toBe(0);
    const fund = await t.run((ctx) => ctx.db.get(generalFundId));
    expect(fund?.increaseAccountId).toBeUndefined();
  });
});

// ============================================================================
// Allocation
// ============================================================================

describe("allocation of general-fund donations", () => {
  test("moves the money receiving -> General with a real transfer", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    await insertFinance(t, communityId, {
      onboardingStatus: "live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_receiving_live",
      stripeConnectedAccountId: "acct_general",
    });
    const generalFundId = await insertFund(t, communityId, {
      type: "general",
      name: "General Fund",
      increaseAccountId: "account_general_live",
    });
    const donationId = await insertDonation(t, generalFundId, 7500, "pi_general_1");
    // 7,500 gross arrives as 7,283 net; the transfer moves the net, because
    // the net is all the receiving Account ever got for this gift.
    payoutStubs.set("po_general_1", [
      { paymentIntentId: "pi_general_1", netCents: 7283 },
    ]);

    const result = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_general_1",
      payoutCents: 7283,
    });

    expect(result.allocated).toBe(1);
    expect(createAccountTransfer).toHaveBeenCalledTimes(1);
    expect(createAccountTransfer.mock.calls[0][0]).toMatchObject({
      fromAccountId: "account_receiving_live",
      toAccountId: "account_general_live",
      amountCents: 7283,
      idempotencyKey: `alloc:${donationId}`,
    });

    const donation = await t.run((ctx) => ctx.db.get(donationId));
    expect(donation?.allocationStatus).toBe("allocated");

    // The audit row carries the transfer id — the control-plane proof the
    // bank-side move happened, which the old no-transfer path never had.
    const audits = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", generalFundId))
        .collect(),
    );
    const allocated = audits.find((a) => a.action === "donation.allocated");
    expect(allocated).toBeDefined();
    expect(JSON.parse(allocated!.detailsJson!).increaseTransferId).toBeTruthy();
  });

  test("a General fund with no Account leaves its donation pending, not falsely allocated", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    await insertFinance(t, communityId, {
      onboardingStatus: "live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_receiving_live",
      stripeConnectedAccountId: "acct_general",
    });
    const generalFundId = await insertFund(t, communityId, {
      type: "general",
      name: "General Fund",
    });
    const donationId = await insertDonation(t, generalFundId, 4200, "pi_general_2");
    payoutStubs.set("po_general_2", [
      { paymentIntentId: "pi_general_2", netCents: 4078 },
    ]);

    const result = await t.action(internal.functions.finance.jobs.runAllocation, {
      communityId,
      stripePayoutId: "po_general_2",
      payoutCents: 4078,
    });

    // The cash really is still in the receiving Account. Marking it allocated
    // (what the old code did) made it neither pending nor reconciled.
    expect(result).toEqual({ allocated: 0, failed: 1 });
    expect(createAccountTransfer).not.toHaveBeenCalled();
    const donation = await t.run((ctx) => ctx.db.get(donationId));
    expect(donation?.allocationStatus).toBe("pending");
    // Counted as a failed item, not silently skipped: it keeps its payout
    // stamp, so the retry cron finishes it the moment the backfill mints the
    // General Account, and the failure is on the audit trail meanwhile.
    expect(donation?.allocationPayoutId).toBe("po_general_2");
    expect(donation?.payoutNetCents).toBe(4078);
    const audits = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", generalFundId))
        .collect(),
    );
    expect(audits.some((a) => a.action === "allocation.transfer_failed")).toBe(true);
  });
});

// ============================================================================
// Nightly reconcile
// ============================================================================

describe("nightly reconcile covers the General fund", () => {
  test("an Account-bound General fund is checked like any group fund", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    await insertFinance(t, communityId, {
      onboardingStatus: "live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_receiving_live",
    });
    const generalFundId = await insertFund(t, communityId, {
      type: "general",
      name: "General Fund",
      increaseAccountId: "account_general_live",
      balanceCents: 10_000,
    });

    const fundsInScope = await t.query(
      internal.functions.finance.jobs.getFundsWithIncreaseAccount,
      { communityId },
    );
    expect(fundsInScope.map((f) => f._id)).toContain(generalFundId);

    // Bank says 9,000 but our ledger says 10,000 with nothing pending — that
    // is real drift, and the General fund must be able to report it.
    getAccountBalance.mockResolvedValueOnce({
      currentBalanceCents: 9_000,
      availableBalanceCents: 9_000,
    });
    const result = await t.action(
      internal.functions.finance.jobs.runNightlyReconcile,
      { communityId },
    );

    expect(result.checked).toBe(1);
    expect(result.drifted).toBe(1);

    const audits = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", generalFundId))
        .collect(),
    );
    expect(audits.some((a) => a.action === "reconcile.drift")).toBe(true);
  });
});
