/**
 * Recurring (monthly) giving — ADR-032 §3 "standing gifts".
 *
 * Covers functions/finance/giving.ts's recurring surface (create, the donor
 * management actions, the webhook-facing mutations) and the recurring cases
 * in functions/finance/webhooks.ts.
 *
 * TWO deliberate departures from finance-giving.test.ts's conventions, both
 * because the thing under test here IS the Stripe-shaped plumbing:
 *
 *  1. The `stripe` SDK is mocked (as finance-payout-nets.test.ts does, and
 *     for the same reason) — a subscription-mode Checkout Session, an inline
 *     recurring price, and a subscription-item update are exactly the details
 *     that break, so they're asserted on rather than skipped.
 *  2. `handleFinanceStripeEvent` is driven DIRECTLY through a small ActionCtx
 *     shim. finance-giving.test.ts drives its constituent pieces instead,
 *     noting convex-test doesn't synthesize an ActionCtx for a plain exported
 *     function — but the shim below is a faithful one (the dispatcher only
 *     ever uses runQuery/runMutation/runAction, which `t` provides with the
 *     same signatures), and for recurring giving the dispatcher's own routing
 *     and cross-API-version field reading are half of what can go wrong.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-recurring-giving.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import { buildGiveReturnUrls } from "../functions/finance/giving";
import { computeCoverFeesCents } from "../lib/finance/fees";
import {
  handleFinanceStripeEvent,
  mapStripeSubscriptionStatus,
  resolveInvoicePaymentIntentId,
  resolveInvoicePeriodEndMs,
  resolveInvoiceRecurringDonationId,
  resolveInvoiceSubscriptionId,
  resolveSubscriptionAmounts,
  resolveSubscriptionPeriodEndMs,
} from "../functions/finance/webhooks";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";
process.env.STRIPE_SECRET_KEY = "sk_test_recurring_giving";

const CONNECTED_ACCOUNT = "acct_test123";

/**
 * The gift these tests give, and the fee the SERVER would quote for it
 * (lib/finance/fees.ts). Derived rather than hardcoded: `validateDonationAmount`
 * ceilings a submitted fee at this number, so a fixture that drifted from it
 * would start failing for a reason with nothing to do with recurring giving.
 */
const GIFT_CENTS = 2500;
const FEE_CENTS = computeCoverFeesCents(GIFT_CENTS);
const TOTAL_CENTS = GIFT_CENTS + FEE_CENTS;

// ============================================================================
// Stripe SDK fake
// ============================================================================

const stripeStub = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; params: unknown; options: unknown }>,
  sessionIds: [] as string[],
  customerIds: [] as string[],
  portalConfigs: [] as Array<{ id: string }>,
  sessionCreateError: null as Error | null,
  subscriptionCancelError: null as Error | null,
  subscriptionRetrieveError: null as (Error & { code?: string }) | null,
  // What `checkout.sessions.retrieve` reports for a stale session. The create
  // path only supersedes a row once Stripe CONFIRMS the session can never
  // complete, so this drives every abandoned-Checkout branch.
  sessionStatus: "expired" as string,
  sessionRetrieveError: null as Error | null,
  sessionExpireError: null as Error | null,
  // Returned by subscriptions.retrieve — one item, whose price carries the
  // product id updateRecurringAmount must reuse.
  subscription: {
    id: "sub_test_1",
    items: {
      data: [{ id: "si_test_1", price: { id: "price_1", product: "prod_1" } }],
    },
  } as Record<string, unknown>,
}));

vi.mock("stripe", () => {
  const record = (method: string, params: unknown, options: unknown) => {
    stripeStub.calls.push({ method, params, options });
  };
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: unknown, options: unknown) => {
          record("checkout.sessions.create", params, options);
          if (stripeStub.sessionCreateError) throw stripeStub.sessionCreateError;
          const id = stripeStub.sessionIds.shift() ?? "cs_test_default";
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        expire: async (id: string, options: unknown) => {
          record("checkout.sessions.expire", id, options);
          if (stripeStub.sessionExpireError) throw stripeStub.sessionExpireError;
          return { id };
        },
        retrieve: async (id: string, options: unknown) => {
          record("checkout.sessions.retrieve", id, options);
          if (stripeStub.sessionRetrieveError) {
            throw stripeStub.sessionRetrieveError;
          }
          return { id, status: stripeStub.sessionStatus };
        },
      },
    };
    customers = {
      create: async (params: unknown, options: unknown) => {
        record("customers.create", params, options);
        return { id: stripeStub.customerIds.shift() ?? "cus_test_default" };
      },
    };
    subscriptions = {
      retrieve: async (id: string, params: unknown, options: unknown) => {
        record("subscriptions.retrieve", { id, params }, options);
        if (stripeStub.subscriptionRetrieveError) {
          throw stripeStub.subscriptionRetrieveError;
        }
        return stripeStub.subscription;
      },
      update: async (id: string, params: unknown, options: unknown) => {
        record("subscriptions.update", { id, params }, options);
        return stripeStub.subscription;
      },
      cancel: async (id: string, params: unknown, options: unknown) => {
        record("subscriptions.cancel", { id, params }, options);
        if (stripeStub.subscriptionCancelError) {
          throw stripeStub.subscriptionCancelError;
        }
        return { id, status: "canceled" };
      },
    };
    billingPortal = {
      configurations: {
        list: async (params: unknown, options: unknown) => {
          record("billingPortal.configurations.list", params, options);
          return { data: stripeStub.portalConfigs };
        },
        create: async (params: unknown, options: unknown) => {
          record("billingPortal.configurations.create", params, options);
          return { id: "bpc_created" };
        },
      },
      sessions: {
        create: async (params: unknown, options: unknown) => {
          record("billingPortal.sessions.create", params, options);
          return { url: "https://billing.stripe.test/session" };
        },
      },
    };
  }
  return { default: FakeStripe };
});

function callsTo(method: string) {
  return stripeStub.calls.filter((c) => c.method === method);
}

beforeEach(() => {
  stripeStub.calls.length = 0;
  stripeStub.sessionIds.length = 0;
  stripeStub.customerIds.length = 0;
  stripeStub.portalConfigs.length = 0;
  stripeStub.sessionCreateError = null;
  stripeStub.subscriptionCancelError = null;
  stripeStub.subscriptionRetrieveError = null;
  stripeStub.sessionRetrieveError = null;
  stripeStub.sessionExpireError = null;
  stripeStub.sessionStatus = "expired";
  stripeStub.subscription = {
    id: "sub_test_1",
    items: {
      data: [{ id: "si_test_1", price: { id: "price_1", product: "prod_1" } }],
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Fixture
// ============================================================================

interface RecurringFixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  fundId: Id<"funds">;
  /** A SECOND fund in the same community — the Customer-reuse case. */
  otherGroupId: Id<"groups">;
  otherFundId: Id<"funds">;
  donorUserId: Id<"users">;
  otherDonorUserId: Id<"users">;
}

async function seedRecurringFixture(
  t: ReturnType<typeof convexTest>,
): Promise<RecurringFixture> {
  return await t.run(async (ctx) => {
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: Date.now(),
    });
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

    const mkGroup = async (name: string) =>
      ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    const groupId = await mkGroup("Young Adults");
    const otherGroupId = await mkGroup("Youth");

    const mkUser = async (firstName: string) =>
      ctx.db.insert("users", {
        firstName,
        lastName: "Giver",
        email: `${firstName.toLowerCase()}@example.com`,
        phone: `+1555000${Math.floor(Math.random() * 9000 + 1000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    const donorUserId = await mkUser("Donor");
    const otherDonorUserId = await mkUser("Other");

    for (const userId of [donorUserId, otherDonorUserId]) {
      for (const g of [groupId, otherGroupId]) {
        await ctx.db.insert("groupMembers", {
          groupId: g,
          userId,
          role: "member",
          joinedAt: timestamp,
          notificationsEnabled: true,
        });
      }
    }

    const mkFund = async (gid: Id<"groups">, name: string) =>
      ctx.db.insert("funds", {
        communityId,
        groupId: gid,
        name,
        type: "group",
        status: "active",
        balanceCents: 10_000,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    const fundId = await mkFund(groupId, "Young Adults Fund");
    const otherFundId = await mkFund(otherGroupId, "Youth Fund");

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: CONNECTED_ACCOUNT,
      onboardingStatus: "live",
      legalName: "Test Church Inc.",
      ein: "12-3456789",
      address: {
        addressLine1: "123 Main St",
        city: "Anytown",
        state: "CA",
        zipCode: "90210",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      communityId,
      groupId,
      fundId,
      otherGroupId,
      otherFundId,
      donorUserId,
      otherDonorUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

/**
 * A faithful ActionCtx for `handleFinanceStripeEvent`: it only ever calls
 * runQuery/runMutation/runAction, and convex-test's `t` implements all three
 * with the same signatures against the same in-memory database.
 */
function webhookCtx(t: ReturnType<typeof convexTest>): ActionCtx {
  return {
    runQuery: (ref: never, args: never) => t.query(ref, args),
    runMutation: (ref: never, args: never) => t.mutation(ref, args),
    runAction: (ref: never, args: never) => t.action(ref, args),
  } as unknown as ActionCtx;
}

/** Creates a monthly gift end-to-end through the real action. */
async function createRecurring(
  t: ReturnType<typeof convexTest>,
  s: RecurringFixture,
  overrides: {
    fundId?: Id<"funds">;
    donorUserId?: Id<"users">;
    amountCents?: number;
    coverFeesCents?: number;
    sessionId?: string;
    customerId?: string;
  } = {},
) {
  stripeStub.sessionIds.push(overrides.sessionId ?? "cs_recurring_1");
  stripeStub.customerIds.push(overrides.customerId ?? "cus_donor_1");
  return await t.action(
    api.functions.finance.giving.createRecurringDonationCheckoutSession,
    {
      token: await tokenFor(overrides.donorUserId ?? s.donorUserId),
      fundId: overrides.fundId ?? s.fundId,
      amountCents: overrides.amountCents ?? GIFT_CENTS,
      coverFeesCents: overrides.coverFeesCents ?? FEE_CENTS,
    },
  );
}

/** Binds a subscription to the row the way checkout.session.completed does. */
async function completeCheckout(
  t: ReturnType<typeof convexTest>,
  sessionId: string,
  subscriptionId: string,
  customerId = "cus_donor_1",
) {
  await handleFinanceStripeEvent(webhookCtx(t), {
    type: "checkout.session.completed",
    account: CONNECTED_ACCOUNT,
    data: {
      object: {
        id: sessionId,
        mode: "subscription",
        subscription: subscriptionId,
        customer: customerId,
      },
    },
  });
}

/** An `invoice.paid` payload in the CURRENT (2025-03-31+) API shape. */
function paidInvoice(params: {
  invoiceId: string;
  subscriptionId: string;
  paymentIntentId: string;
  amountPaid: number;
  periodEndSeconds?: number;
}) {
  return {
    id: params.invoiceId,
    amount_paid: params.amountPaid,
    parent: { subscription_details: { subscription: params.subscriptionId } },
    payments: {
      data: [{ payment: { payment_intent: params.paymentIntentId } }],
    },
    lines: {
      data: [{ period: { end: params.periodEndSeconds ?? 1_800_000_000 } }],
    },
  };
}

async function rowsFor(
  t: ReturnType<typeof convexTest>,
  donorUserId: Id<"users">,
) {
  return await t.run((ctx) =>
    ctx.db
      .query("recurringDonations")
      .withIndex("by_donor", (q) => q.eq("donorUserId", donorUserId))
      .collect(),
  );
}

async function donationsFor(
  t: ReturnType<typeof convexTest>,
  fundId: Id<"funds">,
) {
  return await t.run((ctx) =>
    ctx.db
      .query("donations")
      .withIndex("by_fund", (q) => q.eq("fundId", fundId))
      .collect(),
  );
}

// ============================================================================
// Pure webhook-payload readers
// ============================================================================

describe("Stripe payload readers (cross-API-version)", () => {
  test("resolves an invoice's subscription from both the legacy and current shapes", () => {
    expect(resolveInvoiceSubscriptionId({ subscription: "sub_legacy" })).toBe(
      "sub_legacy",
    );
    expect(
      resolveInvoiceSubscriptionId({
        parent: { subscription_details: { subscription: "sub_new" } },
      }),
    ).toBe("sub_new");
    // Expanded object form, and the "this invoice has no subscription" case.
    expect(
      resolveInvoiceSubscriptionId({ subscription: { id: "sub_expanded" } }),
    ).toBe("sub_expanded");
    expect(resolveInvoiceSubscriptionId({})).toBeNull();
  });

  test("resolves an invoice's PaymentIntent from both shapes — the idempotency key for a recurring gift", () => {
    expect(resolveInvoicePaymentIntentId({ payment_intent: "pi_legacy" })).toBe(
      "pi_legacy",
    );
    expect(
      resolveInvoicePaymentIntentId({
        payments: { data: [{ payment: { payment_intent: "pi_new" } }] },
      }),
    ).toBe("pi_new");
    expect(resolveInvoicePaymentIntentId({ payments: { data: [] } })).toBeNull();
  });

  test("converts period ends from Stripe seconds to our milliseconds", () => {
    expect(
      resolveInvoicePeriodEndMs({ lines: { data: [{ period: { end: 1700 } }] } }),
    ).toBe(1_700_000);
    expect(resolveInvoicePeriodEndMs({})).toBeUndefined();
    expect(resolveSubscriptionPeriodEndMs({ id: "s", current_period_end: 1700 })).toBe(
      1_700_000,
    );
    expect(
      resolveSubscriptionPeriodEndMs({
        id: "s",
        items: { data: [{ current_period_end: 1800 }] },
      }),
    ).toBe(1_800_000);
  });

  test("maps Stripe's subscription statuses onto the four states the row models", () => {
    expect(mapStripeSubscriptionStatus("active")).toBe("active");
    expect(mapStripeSubscriptionStatus("trialing")).toBe("active");
    expect(mapStripeSubscriptionStatus("past_due")).toBe("past_due");
    expect(mapStripeSubscriptionStatus("unpaid")).toBe("past_due");
    expect(mapStripeSubscriptionStatus("canceled")).toBe("canceled");
    expect(mapStripeSubscriptionStatus("incomplete_expired")).toBe("canceled");
    // "incomplete" IS our "pending" — no transition to make.
    expect(mapStripeSubscriptionStatus("incomplete")).toBeNull();
    expect(mapStripeSubscriptionStatus(undefined)).toBeNull();
  });

  test("only trusts a metadata amount split that adds up to the price actually billed", () => {
    const withPrice = (unitAmount: number, metadata: Record<string, string>) => ({
      id: "sub_1",
      metadata,
      items: { data: [{ price: { unit_amount: unitAmount } }] },
    });

    expect(
      resolveSubscriptionAmounts(
        withPrice(2603, { amountCents: "2500", feeCoverCents: "103" }),
      ),
    ).toEqual({ amountCents: 2500, feeCoverCents: 103 });

    // Stale metadata (says $25 + $1.03 while Stripe bills $50) is ignored —
    // better to leave the row alone than record a split the donor isn't billed.
    expect(
      resolveSubscriptionAmounts(
        withPrice(5000, { amountCents: "2500", feeCoverCents: "103" }),
      ),
    ).toBeNull();
    expect(resolveSubscriptionAmounts(withPrice(2500, {}))).toBeNull();
    expect(
      resolveSubscriptionAmounts({ id: "sub_1", metadata: {}, items: { data: [] } }),
    ).toBeNull();
  });

  test("buildGiveReturnUrls flags a monthly gift so the success screen can say so", () => {
    const oneOff = buildGiveReturnUrls({
      groupId: "g1",
      totalCents: 2603,
      fundName: "F",
      communityName: "C",
    });
    expect(oneOff.successUrl).not.toContain("recurring=1");

    const monthly = buildGiveReturnUrls({
      groupId: "g1",
      totalCents: 2603,
      fundName: "F",
      communityName: "C",
      recurring: true,
    });
    expect(monthly.successUrl.endsWith("&recurring=1")).toBe(true);
    expect(monthly.successUrl).toContain("&amount=2603");
  });
});

// ============================================================================
// createRecurringDonationCheckoutSession
// ============================================================================

describe("createRecurringDonationCheckoutSession", () => {
  test("creates a monthly Checkout Session and a pending row bound to it", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    const result = await createRecurring(t, s, { sessionId: "cs_abc" });
    expect(result.url).toBe("https://checkout.stripe.test/cs_abc");
    expect(result.sessionId).toBe("cs_abc");

    const rows = await rowsFor(t, s.donorUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fundId: s.fundId,
      communityId: s.communityId,
      donorUserId: s.donorUserId,
      amountCents: GIFT_CENTS,
      feeCoverCents: FEE_CENTS,
      stripeCustomerId: "cus_donor_1",
      stripeConnectedAccountId: CONNECTED_ACCOUNT,
      checkoutSessionId: "cs_abc",
      status: "pending",
    });
    expect(rows[0].stripeSubscriptionId).toBeUndefined();

    const [session] = callsTo("checkout.sessions.create");
    const params = session.params as any;
    expect(params.mode).toBe("subscription");
    expect(params.customer).toBe("cus_donor_1");
    expect(params.line_items[0].quantity).toBe(1);
    expect(params.line_items[0].price_data).toMatchObject({
      currency: "usd",
      unit_amount: TOTAL_CENTS, // gift + fee cover
      recurring: { interval: "month" },
    });
    // payment_intent_data is illegal in subscription mode — the metadata that
    // attributes a charge has to live on the subscription instead.
    expect(params.payment_intent_data).toBeUndefined();
    expect(params.subscription_data.metadata).toMatchObject({
      recurringDonationId: rows[0]._id,
      fundId: s.fundId,
      donorUserId: s.donorUserId,
      communityId: s.communityId,
      amountCents: String(GIFT_CENTS),
      feeCoverCents: String(FEE_CENTS),
    });
    expect(params.success_url).toContain("recurring=1");
    // Direct charge on the community's own connected account.
    expect((session.options as any).stripeAccount).toBe(CONNECTED_ACCOUNT);
  });

  test("the idempotency key includes the amount, so a changed amount is not collapsed into the first session", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    stripeStub.sessionIds.push("cs_nonce");
    stripeStub.customerIds.push("cus_donor_1");
    await t.action(
      api.functions.finance.giving.createRecurringDonationCheckoutSession,
      {
        token: await tokenFor(s.donorUserId),
        fundId: s.fundId,
        amountCents: GIFT_CENTS,
        coverFeesCents: FEE_CENTS,
        idempotencyNonce: "nonce-1",
      },
    );

    const key = (callsTo("checkout.sessions.create")[0].options as any)
      .idempotencyKey as string;
    expect(key).toContain("nonce-1");
    expect(key).toContain(`:${GIFT_CENTS}:${FEE_CENTS}`);
  });

  test("refuses a second monthly gift to the same fund while one is live", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    await createRecurring(t, s, { sessionId: "cs_1" });
    await completeCheckout(t, "cs_1", "sub_1");
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "sub_1", status: "active" } },
    });

    await expect(
      createRecurring(t, s, { sessionId: "cs_2", customerId: "cus_x" }),
    ).rejects.toThrow(/already have a monthly gift/i);

    expect(await rowsFor(t, s.donorUserId)).toHaveLength(1);
  });

  test("refuses a second attempt while the first Checkout is still in its grace window", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    await createRecurring(t, s, { sessionId: "cs_1" });
    await expect(
      createRecurring(t, s, { sessionId: "cs_2" }),
    ).rejects.toThrow(/just started setting up/i);
  });

  test("supersedes an abandoned Checkout — expires it at Stripe rather than locking the donor out", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    await createRecurring(t, s, { sessionId: "cs_stale" });
    const [stale] = await rowsFor(t, s.donorUserId);
    // Age it past PENDING_CHECKOUT_GRACE_MS (30 minutes).
    await t.run((ctx) =>
      ctx.db.patch(stale._id, { createdAt: Date.now() - 60 * 60 * 1000 }),
    );

    // Still OPEN at Stripe — the tab is sitting there. This is the branch that
    // has to expire it before superseding, or it could still complete later.
    stripeStub.sessionStatus = "open";
    await createRecurring(t, s, { sessionId: "cs_fresh" });

    expect(callsTo("checkout.sessions.expire").map((c) => c.params)).toEqual([
      "cs_stale",
    ]);
    const rows = await rowsFor(t, s.donorUserId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.checkoutSessionId === "cs_stale")?.status).toBe(
      "canceled",
    );
    expect(rows.find((r) => r.checkoutSessionId === "cs_fresh")?.status).toBe(
      "pending",
    );
  });

  test("reuses one Stripe Customer per donor per connected account across funds", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    await createRecurring(t, s, { sessionId: "cs_1", customerId: "cus_donor_1" });
    // A DIFFERENT fund in the same community — same person, same card on file.
    await createRecurring(t, s, {
      fundId: s.otherFundId,
      sessionId: "cs_2",
      customerId: "cus_should_not_be_used",
    });

    expect(callsTo("customers.create")).toHaveLength(1);
    const rows = await rowsFor(t, s.donorUserId);
    expect(rows.map((r) => r.stripeCustomerId)).toEqual([
      "cus_donor_1",
      "cus_donor_1",
    ]);

    // The second create never consumed a Customer id — that IS the reuse.
    expect(stripeStub.customerIds).toEqual(["cus_should_not_be_used"]);
    stripeStub.customerIds.length = 0;

    // A different donor gets their own Customer.
    await createRecurring(t, s, {
      donorUserId: s.otherDonorUserId,
      sessionId: "cs_3",
      customerId: "cus_donor_2",
    });
    expect(callsTo("customers.create")).toHaveLength(2);
    expect((await rowsFor(t, s.otherDonorUserId))[0].stripeCustomerId).toBe(
      "cus_donor_2",
    );
  });

  test("a failed Stripe call leaves no phantom row blocking the retry", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    stripeStub.sessionCreateError = new Error("Stripe is down");
    await expect(createRecurring(t, s)).rejects.toThrow("Stripe is down");

    const rows = await rowsFor(t, s.donorUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("canceled");

    // ...and the donor can immediately try again.
    stripeStub.sessionCreateError = null;
    await createRecurring(t, s, { sessionId: "cs_retry" });
    expect(
      (await rowsFor(t, s.donorUserId)).filter((r) => r.status === "pending"),
    ).toHaveLength(1);
  });

  test("still enforces the shared donation validation seam (amount bounds, fund live)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    await expect(
      createRecurring(t, s, { amountCents: 50 }),
    ).rejects.toThrow(/Donation amount must be between/);
    await expect(
      createRecurring(t, s, { coverFeesCents: -1 }),
    ).rejects.toThrow(/Invalid fee-cover amount/);

    await t.run((ctx) => ctx.db.patch(s.fundId, { status: "frozen" as const }));
    await expect(createRecurring(t, s)).rejects.toThrow(
      /isn't currently accepting gifts/,
    );
  });

  test("inherits the ONE-SIDED fee bound: an over-quote fee is refused, an under-quote one is charged as sent", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    // Above the server's own gross-up (plus tolerance) — refused, because on a
    // MONTHLY gift an inflated fee field would slip past MAX_DONATION_CENTS
    // every month, not once.
    await expect(
      createRecurring(t, s, { coverFeesCents: FEE_CENTS + 50 }),
    ).rejects.toThrow(/couldn't confirm the processing fee/);
    expect(await rowsFor(t, s.donorUserId)).toHaveLength(0);
    expect(callsTo("checkout.sessions.create")).toHaveLength(0);

    // Below it — allowed (a donor on a pre-gross-up client under-covers with
    // their own money), and the subscription is priced at what they sent.
    await createRecurring(t, s, { coverFeesCents: 1, sessionId: "cs_under" });
    const [row] = await rowsFor(t, s.donorUserId);
    expect(row.feeCoverCents).toBe(1);
    expect(
      (callsTo("checkout.sessions.create")[0].params as any).line_items[0]
        .price_data.unit_amount,
    ).toBe(GIFT_CENTS + 1);
  });
});

// ============================================================================
// checkout.session.completed
// ============================================================================

describe("checkout.session.completed (Connect, subscription mode)", () => {
  test("binds the subscription and customer onto the pending row, leaving it pending", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_bind" });

    await completeCheckout(t, "cs_bind", "sub_bound", "cus_bound");

    const [row] = await rowsFor(t, s.donorUserId);
    expect(row.stripeSubscriptionId).toBe("sub_bound");
    expect(row.stripeCustomerId).toBe("cus_bound");
    // Money hasn't moved yet — invoice.paid is what activates it.
    expect(row.status).toBe("pending");
  });

  test("ignores a payment-mode session (the one-off gift path owns those)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_oneoff" });

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "checkout.session.completed",
      account: CONNECTED_ACCOUNT,
      data: {
        object: { id: "cs_oneoff", mode: "payment", payment_intent: "pi_1" },
      },
    });

    expect((await rowsFor(t, s.donorUserId))[0].stripeSubscriptionId).toBeUndefined();
  });

  test("rejects an event from a different connected account and audits it", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_spoof" });

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "checkout.session.completed",
      account: "acct_attacker",
      data: {
        object: { id: "cs_spoof", mode: "subscription", subscription: "sub_x" },
      },
    });

    expect((await rowsFor(t, s.donorUserId))[0].stripeSubscriptionId).toBeUndefined();
    const audits = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", s.fundId))
        .collect(),
    );
    expect(
      audits.filter((e) => e.action === "webhook.rejected_account_mismatch"),
    ).toHaveLength(1);
  });
});

// ============================================================================
// invoice.paid — the money event
// ============================================================================

describe("invoice.paid", () => {
  test("records the donation + ledger credit exactly once, and activates the row", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_pay" });
    await completeCheckout(t, "cs_pay", "sub_pay");

    const invoice = paidInvoice({
      invoiceId: "in_1",
      subscriptionId: "sub_pay",
      paymentIntentId: "pi_recurring_1",
      amountPaid: TOTAL_CENTS,
      periodEndSeconds: 1_800_000,
    });
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: { object: invoice },
    });

    const donations = await donationsFor(t, s.fundId);
    expect(donations).toHaveLength(1);
    expect(donations[0]).toMatchObject({
      amountCents: GIFT_CENTS,
      feeCoverCents: FEE_CENTS,
      stripePaymentIntentId: "pi_recurring_1",
      allocationStatus: "pending",
    });
    // Stamped with the recurring row it was billed under.
    const [row] = await rowsFor(t, s.donorUserId);
    expect(donations[0].recurringId).toBe(row._id);

    const ledger = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", s.fundId))
        .collect(),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amountCents).toBe(TOTAL_CENTS);
    expect(ledger[0].kind).toBe("donation");
    expect((await t.run((ctx) => ctx.db.get(s.fundId)))?.balanceCents).toBe(
      10_000 + TOTAL_CENTS,
    );

    expect(row.status).toBe("active");
    expect(row.currentPeriodEnd).toBe(1_800_000_000);

    // A redelivered invoice must not credit a second time.
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: { object: invoice },
    });
    expect(await donationsFor(t, s.fundId)).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(s.fundId)))?.balanceCents).toBe(
      10_000 + TOTAL_CENTS,
    );

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("reads the LEGACY invoice shape too (subscription + payment_intent at the top level)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_legacy" });
    await completeCheckout(t, "cs_legacy", "sub_legacy");

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: {
        object: {
          id: "in_legacy",
          amount_paid: TOTAL_CENTS,
          subscription: "sub_legacy",
          payment_intent: "pi_legacy",
        },
      },
    });

    expect(await donationsFor(t, s.fundId)).toHaveLength(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("credits what Stripe actually collected when it disagrees with the row", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_drift" });
    await completeCheckout(t, "cs_drift", "sub_drift");

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: {
        object: paidInvoice({
          invoiceId: "in_drift",
          subscriptionId: "sub_drift",
          paymentIntentId: "pi_drift",
          amountPaid: 5103, // donor is actually billed more than the row says
        }),
      },
    });

    const [donation] = await donationsFor(t, s.fundId);
    expect(donation.amountCents + donation.feeCoverCents).toBe(5103);
    expect(donation.feeCoverCents).toBe(FEE_CENTS);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("ignores an invoice with no subscription, and an unknown subscription", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "in_x", amount_paid: 500 } },
    });
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: {
        object: paidInvoice({
          invoiceId: "in_y",
          subscriptionId: "sub_unknown",
          paymentIntentId: "pi_y",
          amountPaid: 500,
        }),
      },
    });

    expect(await donationsFor(t, s.fundId)).toHaveLength(0);
  });

  test("rejects an invoice delivered for a different connected account", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_mm" });
    await completeCheckout(t, "cs_mm", "sub_mm");

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: "acct_attacker",
      data: {
        object: paidInvoice({
          invoiceId: "in_mm",
          subscriptionId: "sub_mm",
          paymentIntentId: "pi_mm",
          amountPaid: TOTAL_CENTS,
        }),
      },
    });

    expect(await donationsFor(t, s.fundId)).toHaveLength(0);
  });
});

// ============================================================================
// Non-interference with the one-off path
// ============================================================================

describe("payment_intent.succeeded non-interference", () => {
  test("a subscription's PaymentIntent (no fundId metadata) records nothing", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_ni" });
    await completeCheckout(t, "cs_ni", "sub_ni");

    // This is exactly what Stripe sends for a subscription invoice's payment:
    // subscription mode forbids `payment_intent_data`, so there is no metadata
    // of ours on the intent at all. The one-off handler must ignore it —
    // `invoice.paid` is the only thing that may record a monthly gift.
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "payment_intent.succeeded",
      account: CONNECTED_ACCOUNT,
      data: {
        object: {
          id: "pi_recurring_no_metadata",
          amount: TOTAL_CENTS,
          invoice: "in_ni",
          metadata: {},
        },
      },
    });

    expect(await donationsFor(t, s.fundId)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(s.fundId)))?.balanceCents).toBe(10_000);
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("pending");
  });
});

// ============================================================================
// Subscription lifecycle
// ============================================================================

describe("subscription lifecycle", () => {
  test("updated syncs status, period end, and an amount change from subscription metadata", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_life" });
    await completeCheckout(t, "cs_life", "sub_life");

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: CONNECTED_ACCOUNT,
      data: {
        object: {
          id: "sub_life",
          status: "active",
          metadata: { amountCents: "5000", feeCoverCents: "175" },
          items: {
            data: [
              { current_period_end: 1_900_000, price: { unit_amount: 5175 } },
            ],
          },
        },
      },
    });

    let [row] = await rowsFor(t, s.donorUserId);
    expect(row).toMatchObject({
      status: "active",
      amountCents: 5000,
      feeCoverCents: 175,
      currentPeriodEnd: 1_900_000_000,
    });

    // A failed payment moves it to past_due...
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "sub_life", status: "past_due" } },
    });
    [row] = await rowsFor(t, s.donorUserId);
    expect(row.status).toBe("past_due");

    // ...and recovery brings it back.
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "sub_life", status: "active" } },
    });
    [row] = await rowsFor(t, s.donorUserId);
    expect(row.status).toBe("active");
    // The amount survived a status-only event.
    expect(row.amountCents).toBe(5000);
  });

  test("invoice.payment_failed marks the gift past_due", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_fail" });
    await completeCheckout(t, "cs_fail", "sub_fail");

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.payment_failed",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "in_fail", subscription: "sub_fail" } },
    });

    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("past_due");
  });

  test("deleted is terminal — a late 'active' update cannot resurrect it", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_del" });
    await completeCheckout(t, "cs_del", "sub_del");

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.deleted",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "sub_del", status: "canceled" } },
    });

    let [row] = await rowsFor(t, s.donorUserId);
    expect(row.status).toBe("canceled");
    expect(row.canceledAt).toEqual(expect.any(Number));

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "sub_del", status: "active" } },
    });
    [row] = await rowsFor(t, s.donorUserId);
    expect(row.status).toBe("canceled");
  });
});

// ============================================================================
// Donor management
// ============================================================================

describe("updateRecurringAmount", () => {
  test("updates the Stripe item with a new inline price and no proration, then the row", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_upd" });
    await completeCheckout(t, "cs_upd", "sub_upd");
    stripeStub.subscription = {
      id: "sub_upd",
      items: {
        data: [{ id: "si_upd", price: { id: "price_1", product: "prod_upd" } }],
      },
    };

    const [before] = await rowsFor(t, s.donorUserId);
    const result = await t.action(
      api.functions.finance.giving.updateRecurringAmount,
      {
        token: await tokenFor(s.donorUserId),
        recurringDonationId: before._id,
        amountCents: 5000,
        coverFeesCents: computeCoverFeesCents(5000),
      },
    );
    expect(result).toEqual({
      amountCents: 5000,
      feeCoverCents: computeCoverFeesCents(5000),
    });

    const [update] = callsTo("subscriptions.update");
    const params = (update.params as any).params;
    expect(params.proration_behavior).toBe("none");
    expect(params.items[0]).toMatchObject({
      id: "si_upd",
      price_data: {
        currency: "usd",
        product: "prod_upd", // reuses the product Checkout created
        unit_amount: 5000 + computeCoverFeesCents(5000),
        recurring: { interval: "month" },
      },
    });
    expect(params.metadata).toMatchObject({
      amountCents: "5000",
      feeCoverCents: String(computeCoverFeesCents(5000)),
    });
    expect((update.options as any).stripeAccount).toBe(CONNECTED_ACCOUNT);

    const [after] = await rowsFor(t, s.donorUserId);
    expect(after).toMatchObject({
      amountCents: 5000,
      feeCoverCents: computeCoverFeesCents(5000),
    });

    const audits = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", s.fundId))
        .collect(),
    );
    expect(
      audits.filter((e) => e.action === "recurring.amount_updated"),
    ).toHaveLength(1);
  });

  test("applies the same amount/fee validation as creating a gift, and never calls Stripe on a bad one", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_val" });
    await completeCheckout(t, "cs_val", "sub_val");
    const [row] = await rowsFor(t, s.donorUserId);
    const token = await tokenFor(s.donorUserId);

    await expect(
      t.action(api.functions.finance.giving.updateRecurringAmount, {
        token,
        recurringDonationId: row._id,
        amountCents: 50,
      }),
    ).rejects.toThrow(/Donation amount must be between/);
    await expect(
      t.action(api.functions.finance.giving.updateRecurringAmount, {
        token,
        recurringDonationId: row._id,
        amountCents: GIFT_CENTS,
        coverFeesCents: -1,
      }),
    ).rejects.toThrow(/Invalid fee-cover amount/);
    // The one-sided ceiling applies to a CHANGE too — otherwise the create
    // path's cap could be walked past afterwards, one edit at a time.
    await expect(
      t.action(api.functions.finance.giving.updateRecurringAmount, {
        token,
        recurringDonationId: row._id,
        amountCents: GIFT_CENTS,
        coverFeesCents: FEE_CENTS + 50,
      }),
    ).rejects.toThrow(/couldn't confirm the processing fee/);

    expect(callsTo("subscriptions.update")).toHaveLength(0);
    expect((await rowsFor(t, s.donorUserId))[0].amountCents).toBe(GIFT_CENTS);
  });

  test("refuses another donor's monthly gift", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_other" });
    const [row] = await rowsFor(t, s.donorUserId);

    await expect(
      t.action(api.functions.finance.giving.updateRecurringAmount, {
        token: await tokenFor(s.otherDonorUserId),
        recurringDonationId: row._id,
        amountCents: 100,
      }),
    ).rejects.toThrow(/Monthly gift not found/);
  });
});

describe("cancelRecurringDonation", () => {
  test("cancels at Stripe immediately and marks the row canceled", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_cancel" });
    await completeCheckout(t, "cs_cancel", "sub_cancel");
    const [row] = await rowsFor(t, s.donorUserId);

    expect(
      await t.action(api.functions.finance.giving.cancelRecurringDonation, {
        token: await tokenFor(s.donorUserId),
        recurringDonationId: row._id,
      }),
    ).toEqual({ canceled: true });

    const [cancelCall] = callsTo("subscriptions.cancel");
    expect((cancelCall.params as any).id).toBe("sub_cancel");
    // Plain cancel — NOT cancel_at_period_end. The donor already paid for
    // this period at its start, so there is nothing to run out.
    expect((cancelCall.params as any).params).toBeUndefined();

    const [after] = await rowsFor(t, s.donorUserId);
    expect(after.status).toBe("canceled");
    expect(after.canceledAt).toEqual(expect.any(Number));
  });

  test("is idempotent, and still marks the row when Stripe says it is already gone", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_c2" });
    await completeCheckout(t, "cs_c2", "sub_c2");
    const [row] = await rowsFor(t, s.donorUserId);
    stripeStub.subscriptionCancelError = new Error("No such subscription");
    // …and Stripe CONFIRMS it's gone when we go back to check. That
    // confirmation is what makes swallowing the error safe.
    stripeStub.subscriptionRetrieveError = Object.assign(
      new Error("No such subscription"),
      { code: "resource_missing" },
    );

    await t.action(api.functions.finance.giving.cancelRecurringDonation, {
      token: await tokenFor(s.donorUserId),
      recurringDonationId: row._id,
    });
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("canceled");

    // Second call short-circuits without touching Stripe again.
    await t.action(api.functions.finance.giving.cancelRecurringDonation, {
      token: await tokenFor(s.donorUserId),
      recurringDonationId: row._id,
    });
    expect(callsTo("subscriptions.cancel")).toHaveLength(1);
  });

  test("expires the Checkout Session when the donor backs out before a subscription exists", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_pending_cancel" });
    const [row] = await rowsFor(t, s.donorUserId);

    await t.action(api.functions.finance.giving.cancelRecurringDonation, {
      token: await tokenFor(s.donorUserId),
      recurringDonationId: row._id,
    });

    expect(callsTo("checkout.sessions.expire").map((c) => c.params)).toEqual([
      "cs_pending_cancel",
    ]);
    expect(callsTo("subscriptions.cancel")).toHaveLength(0);
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("canceled");
  });
});

describe("createCardUpdateSession", () => {
  test("creates a portal configuration on first use and returns a portal session for this donor's Customer", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_card" });
    await completeCheckout(t, "cs_card", "sub_card");
    const [row] = await rowsFor(t, s.donorUserId);

    const result = await t.action(
      api.functions.finance.giving.createCardUpdateSession,
      { token: await tokenFor(s.donorUserId), recurringDonationId: row._id },
    );
    expect(result.url).toBe("https://billing.stripe.test/session");

    const [created] = callsTo("billingPortal.configurations.create");
    const features = (created.params as any).features;
    expect(features.payment_method_update.enabled).toBe(true);
    // Cancels/amount changes go through OUR actions so the row stays truth.
    expect(features.subscription_cancel).toBeUndefined();
    expect(features.subscription_update).toBeUndefined();

    const [portal] = callsTo("billingPortal.sessions.create");
    expect(portal.params).toMatchObject({
      customer: "cus_donor_1",
      configuration: "bpc_created",
    });
    expect((portal.options as any).stripeAccount).toBe(CONNECTED_ACCOUNT);
    // The group id is percent-encoded into the path, as it is for the
    // Checkout return URLs — a Convex id contains a ";".
    expect((portal.params as any).return_url).toContain(
      `/groups/${encodeURIComponent(s.groupId)}/monthly-giving`,
    );
  });

  test("reuses an existing portal configuration", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_card2" });
    const [row] = await rowsFor(t, s.donorUserId);
    stripeStub.portalConfigs.push({ id: "bpc_existing" });

    await t.action(api.functions.finance.giving.createCardUpdateSession, {
      token: await tokenFor(s.donorUserId),
      recurringDonationId: row._id,
    });

    expect(callsTo("billingPortal.configurations.create")).toHaveLength(0);
    expect(
      (callsTo("billingPortal.sessions.create")[0].params as any).configuration,
    ).toBe("bpc_existing");
  });
});

// ============================================================================
// Donor-facing reads
// ============================================================================

describe("listMyRecurringDonations / getRecurringForFund", () => {
  test("returns only the caller's own gifts, with fund names, excluding canceled ones", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_l1" });
    await createRecurring(t, s, { fundId: s.otherFundId, sessionId: "cs_l2" });
    await createRecurring(t, s, {
      donorUserId: s.otherDonorUserId,
      sessionId: "cs_l3",
      customerId: "cus_other",
    });

    const mine = await t.query(
      api.functions.finance.giving.listMyRecurringDonations,
      { token: await tokenFor(s.donorUserId) },
    );
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => r.fundName).sort()).toEqual([
      "Young Adults Fund",
      "Youth Fund",
    ]);
    expect(mine.every((r) => r.fundId !== undefined)).toBe(true);

    const theirs = await t.query(
      api.functions.finance.giving.listMyRecurringDonations,
      { token: await tokenFor(s.otherDonorUserId) },
    );
    expect(theirs).toHaveLength(1);

    // Cancel one — it drops out of the manage list.
    await t.action(api.functions.finance.giving.cancelRecurringDonation, {
      token: await tokenFor(s.donorUserId),
      recurringDonationId: mine[0].id,
    });
    expect(
      await t.query(api.functions.finance.giving.listMyRecurringDonations, {
        token: await tokenFor(s.donorUserId),
      }),
    ).toHaveLength(1);
  });

  test("getRecurringForFund returns only a LIVE gift, and only the caller's", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_g1" });

    const token = await tokenFor(s.donorUserId);
    // Still pending (donor in Checkout) — not a monthly gift yet.
    expect(
      await t.query(api.functions.finance.giving.getRecurringForFund, {
        token,
        fundId: s.fundId,
      }),
    ).toBeNull();

    await completeCheckout(t, "cs_g1", "sub_g1");
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "sub_g1", status: "active" } },
    });

    expect(
      await t.query(api.functions.finance.giving.getRecurringForFund, {
        token,
        fundId: s.fundId,
      }),
    ).toMatchObject({
      fundId: s.fundId,
      fundName: "Young Adults Fund",
      amountCents: GIFT_CENTS,
      feeCoverCents: FEE_CENTS,
      status: "active",
    });

    // Another donor sees nothing of theirs on the same fund.
    expect(
      await t.query(api.functions.finance.giving.getRecurringForFund, {
        token: await tokenFor(s.otherDonorUserId),
        fundId: s.fundId,
      }),
    ).toBeNull();
  });

  test("both reads go dark when the group-giving flag is off", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_flag" });
    await completeCheckout(t, "cs_flag", "sub_flag");
    await t.run(async (ctx) => {
      const flag = await ctx.db
        .query("featureFlags")
        .withIndex("by_key", (q) => q.eq("key", "group-giving"))
        .first();
      await ctx.db.patch(flag!._id, { enabled: false });
    });

    const token = await tokenFor(s.donorUserId);
    expect(
      await t.query(api.functions.finance.giving.listMyRecurringDonations, {
        token,
      }),
    ).toEqual([]);
    expect(
      await t.query(api.functions.finance.giving.getRecurringForFund, {
        token,
        fundId: s.fundId,
      }),
    ).toBeNull();
  });
});

// ============================================================================
// getGivingContext
// ============================================================================

describe("getGivingContext.existingRecurring", () => {
  test("is null until a monthly gift is actually collecting, then reports its amounts", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    const token = await tokenFor(s.donorUserId);

    expect(
      (
        await t.query(api.functions.finance.giving.getGivingContext, {
          token,
          groupId: s.groupId,
        })
      )?.existingRecurring,
    ).toBeNull();

    await createRecurring(t, s, { sessionId: "cs_ctx" });
    await completeCheckout(t, "cs_ctx", "sub_ctx");
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: CONNECTED_ACCOUNT,
      data: { object: { id: "sub_ctx", status: "active" } },
    });

    expect(
      (
        await t.query(api.functions.finance.giving.getGivingContext, {
          token,
          groupId: s.groupId,
        })
      )?.existingRecurring,
    ).toEqual({ amountCents: GIFT_CENTS, feeCoverCents: FEE_CENTS });
  });
});

// ============================================================================
// Adversarial money-flow invariants.
//
// Everything below is a way real money goes wrong that a happy-path test can't
// see: Stripe delivering events out of order, two tabs racing, a cancel that
// didn't take, an event from the wrong connected account. Each one is here
// because it charges a real card if it regresses.
// ============================================================================

/** `invoice.paid` carrying the subscription-metadata snapshot Stripe puts on
 * every invoice — the locator that survives out-of-order delivery. */
function paidInvoiceWithMetadata(params: {
  invoiceId: string;
  subscriptionId: string;
  paymentIntentId: string;
  amountPaid: number;
  recurringDonationId: string;
}) {
  return {
    id: params.invoiceId,
    amount_paid: params.amountPaid,
    parent: {
      subscription_details: {
        subscription: params.subscriptionId,
        metadata: { recurringDonationId: params.recurringDonationId },
      },
    },
    payments: {
      data: [{ payment: { payment_intent: params.paymentIntentId } }],
    },
    lines: { data: [{ period: { end: 1_800_000 } }] },
  };
}

describe("invoice.paid is not allowed to depend on webhook ORDER", () => {
  test("reads the recurring row id out of the invoice's subscription metadata", () => {
    expect(
      resolveInvoiceRecurringDonationId({
        subscription_details: { metadata: { recurringDonationId: "rec_legacy" } },
      }),
    ).toBe("rec_legacy");
    expect(
      resolveInvoiceRecurringDonationId({
        parent: {
          subscription_details: { metadata: { recurringDonationId: "rec_new" } },
        },
      }),
    ).toBe("rec_new");
    expect(resolveInvoiceRecurringDonationId({ parent: null })).toBeNull();
    expect(
      resolveInvoiceRecurringDonationId({
        parent: { subscription_details: { metadata: {} } },
      }),
    ).toBeNull();
  });

  test("credits the first month even when invoice.paid beats checkout.session.completed", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_race" });
    const [pending] = await rowsFor(t, s.donorUserId);
    // The row exists but nothing has bound a subscription to it yet — exactly
    // the window Stripe's unordered delivery can land invoice.paid in.
    expect(pending.stripeSubscriptionId).toBeUndefined();

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: {
        object: paidInvoiceWithMetadata({
          invoiceId: "in_race",
          subscriptionId: "sub_race",
          paymentIntentId: "pi_race",
          amountPaid: TOTAL_CENTS,
          recurringDonationId: pending._id,
        }),
      },
    });

    const donations = await donationsFor(t, s.fundId);
    expect(donations).toHaveLength(1);
    expect(donations[0].stripePaymentIntentId).toBe("pi_race");
    // The subscription is stamped on now, so every later event resolves the
    // ordinary way.
    const [bound] = await rowsFor(t, s.donorUserId);
    expect(bound.stripeSubscriptionId).toBe("sub_race");
    expect(bound.status).toBe("active");

    // The late checkout.session.completed must not credit anything a second
    // time, and must not knock the row back to pending.
    await completeCheckout(t, "cs_race", "sub_race");
    expect(await donationsFor(t, s.fundId)).toHaveLength(1);
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("active");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("never re-points a row that already belongs to a different subscription", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_bound" });
    await completeCheckout(t, "cs_bound", "sub_real");
    const [row] = await rowsFor(t, s.donorUserId);

    // A metadata hint pointing at an already-bound row: honouring it would let
    // one subscription's invoices credit against another's gift.
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: {
        object: paidInvoiceWithMetadata({
          invoiceId: "in_other",
          subscriptionId: "sub_impostor",
          paymentIntentId: "pi_impostor",
          amountPaid: TOTAL_CENTS,
          recurringDonationId: row._id,
        }),
      },
    });

    expect(await donationsFor(t, s.fundId)).toHaveLength(0);
    expect((await rowsFor(t, s.donorUserId))[0].stripeSubscriptionId).toBe(
      "sub_real",
    );
  });

  test("a $0 invoice credits nothing instead of failing the webhook forever", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_zero" });
    await completeCheckout(t, "cs_zero", "sub_zero");

    // Must not throw: a throw here 500s the webhook and Stripe redelivers the
    // same $0 invoice forever.
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: {
        object: paidInvoice({
          invoiceId: "in_zero",
          subscriptionId: "sub_zero",
          paymentIntentId: "pi_zero",
          amountPaid: 0,
        }),
      },
    });

    expect(await donationsFor(t, s.fundId)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(s.fundId)))?.balanceCents).toBe(
      10_000,
    );
  });

  test("settles a final invoice on a canceled row without reviving the gift", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_final" });
    await completeCheckout(t, "cs_final", "sub_final");
    await t.action(api.functions.finance.giving.cancelRecurringDonation, {
      token: await tokenFor(s.donorUserId),
      recurringDonationId: (await rowsFor(t, s.donorUserId))[0]._id,
    });

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: {
        object: paidInvoice({
          invoiceId: "in_final",
          subscriptionId: "sub_final",
          paymentIntentId: "pi_final",
          amountPaid: TOTAL_CENTS,
        }),
      },
    });

    // The money was really collected, so it is really credited…
    expect(await donationsFor(t, s.fundId)).toHaveLength(1);
    // …but "canceled" is terminal.
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("canceled");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

describe("one monthly gift per donor per fund, under a race", () => {
  test("the INSERT itself refuses a second pending row, not just the read-only check", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_first" });

    // Two tabs both clear `prepareRecurringDonation` and reach the mutation.
    // The mutation is the only thing that can serialize them, so it — not the
    // query — has to be what says no.
    await expect(
      t.mutation(internal.functions.finance.giving.beginRecurringDonation, {
        token: await tokenFor(s.donorUserId),
        fundId: s.fundId,
        amountCents: GIFT_CENTS,
        feeCoverCents: FEE_CENTS,
        stripeConnectedAccountId: CONNECTED_ACCOUNT,
        stripeCustomerId: "cus_donor_1",
      }),
    ).rejects.toThrow(/just started setting up/i);

    expect(await rowsFor(t, s.donorUserId)).toHaveLength(1);
  });

  test("a pending row that already has a subscription blocks a second gift forever, not for 30 minutes", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_slow" });
    await completeCheckout(t, "cs_slow", "sub_slow");
    const [row] = await rowsFor(t, s.donorUserId);
    // Bound but still `pending` — invoice.paid hasn't landed. Age it well past
    // the grace window: the donor IS being billed, so the window is irrelevant.
    expect(row.status).toBe("pending");
    await t.run((ctx) =>
      ctx.db.patch(row._id, { createdAt: Date.now() - 60 * 60 * 1000 }),
    );

    await expect(createRecurring(t, s, { sessionId: "cs_second" })).rejects.toThrow(
      /already have a monthly gift|just started setting up/i,
    );
    expect(await rowsFor(t, s.donorUserId)).toHaveLength(1);
    expect(callsTo("checkout.sessions.expire")).toHaveLength(0);
  });
});

describe("superseding a stale Checkout never orphans a live subscription", () => {
  async function agedStaleGift() {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_aged" });
    const [stale] = await rowsFor(t, s.donorUserId);
    await t.run((ctx) =>
      ctx.db.patch(stale._id, { createdAt: Date.now() - 60 * 60 * 1000 }),
    );
    return { t, s };
  }

  test("refuses the new attempt when the stale session actually COMPLETED", async () => {
    const { t, s } = await agedStaleGift();
    // The donor finished that Checkout; a subscription exists at Stripe and
    // checkout.session.completed simply hasn't arrived. Superseding here would
    // cancel the row and leave that subscription billing forever with nothing
    // in the app able to stop it.
    stripeStub.sessionStatus = "complete";

    await expect(createRecurring(t, s, { sessionId: "cs_new" })).rejects.toThrow(
      /already have a monthly gift/i,
    );
    expect(callsTo("checkout.sessions.expire")).toHaveLength(0);
    const rows = await rowsFor(t, s.donorUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending"); // still bindable
  });

  test("refuses the new attempt when Stripe cannot tell us the session's state", async () => {
    const { t, s } = await agedStaleGift();
    stripeStub.sessionRetrieveError = new Error("connection reset");

    await expect(createRecurring(t, s, { sessionId: "cs_new" })).rejects.toThrow(
      /just started setting up/i,
    );
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("pending");
  });

  test("refuses the new attempt when the still-open session could not be expired", async () => {
    const { t, s } = await agedStaleGift();
    stripeStub.sessionStatus = "open";
    stripeStub.sessionExpireError = new Error("rate limited");

    await expect(createRecurring(t, s, { sessionId: "cs_new" })).rejects.toThrow(
      /just started setting up/i,
    );
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("pending");
  });
});

describe("cancel only reports success when the card really stops being charged", () => {
  test("a transient Stripe failure surfaces instead of falsely marking the gift stopped", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_flaky" });
    await completeCheckout(t, "cs_flaky", "sub_flaky");
    const [row] = await rowsFor(t, s.donorUserId);

    stripeStub.subscriptionCancelError = new Error("Stripe is down");
    // …and the follow-up read shows the subscription very much alive.
    stripeStub.subscription = { id: "sub_flaky", status: "active", items: { data: [] } };

    await expect(
      t.action(api.functions.finance.giving.cancelRecurringDonation, {
        token: await tokenFor(s.donorUserId),
        recurringDonationId: row._id,
      }),
    ).rejects.toThrow(/Stripe is down/);

    // The row must NOT be canceled: it is terminal, so a false cancel would
    // also stop any later Stripe event from ever putting it back.
    const [after] = await rowsFor(t, s.donorUserId);
    expect(after.status).not.toBe("canceled");
    expect(after.canceledAt).toBeUndefined();
  });
});

describe("an event from the wrong connected account never mutates a row", () => {
  async function liveGift() {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_acct" });
    await completeCheckout(t, "cs_acct", "sub_acct");
    return { t, s };
  }

  async function mismatchAudits(
    t: ReturnType<typeof convexTest>,
    fundId: Id<"funds">,
  ) {
    const audits = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    return audits.filter((e) => e.action === "webhook.rejected_account_mismatch");
  }

  test("customer.subscription.updated from another account changes nothing", async () => {
    const { t, s } = await liveGift();
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: "acct_attacker",
      data: { object: { id: "sub_acct", status: "canceled" } },
    });
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("pending");
    expect(await mismatchAudits(t, s.fundId)).toHaveLength(1);
  });

  test("customer.subscription.deleted from another account cannot cancel the gift", async () => {
    const { t, s } = await liveGift();
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.deleted",
      account: "acct_attacker",
      data: { object: { id: "sub_acct" } },
    });
    const [row] = await rowsFor(t, s.donorUserId);
    expect(row.status).not.toBe("canceled");
    expect(await mismatchAudits(t, s.fundId)).toHaveLength(1);
  });

  test("invoice.payment_failed from another account cannot mark the gift past due", async () => {
    const { t, s } = await liveGift();
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.payment_failed",
      account: "acct_attacker",
      data: {
        object: {
          id: "in_spoof",
          parent: { subscription_details: { subscription: "sub_acct" } },
        },
      },
    });
    expect((await rowsFor(t, s.donorUserId))[0].status).toBe("pending");
    expect(await mismatchAudits(t, s.fundId)).toHaveLength(1);
  });

  test("an event with NO account at all is rejected too", async () => {
    const { t, s } = await liveGift();
    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.deleted",
      account: undefined,
      data: { object: { id: "sub_acct" } },
    });
    expect((await rowsFor(t, s.donorUserId))[0].status).not.toBe("canceled");
    expect(await mismatchAudits(t, s.fundId)).toHaveLength(1);
  });
});

describe("subscription metadata is never the authority on money", () => {
  test("an amount split that disagrees with the billed price leaves the row alone", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_meta" });
    await completeCheckout(t, "cs_meta", "sub_meta");

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "customer.subscription.updated",
      account: CONNECTED_ACCOUNT,
      data: {
        object: {
          id: "sub_meta",
          status: "active",
          // Metadata claims $99 + $3 while the price actually bills $50.
          metadata: { amountCents: "9900", feeCoverCents: "300" },
          items: { data: [{ price: { unit_amount: 5000 } }] },
        },
      },
    });

    const [row] = await rowsFor(t, s.donorUserId);
    expect(row.amountCents).toBe(GIFT_CENTS);
    expect(row.feeCoverCents).toBe(FEE_CENTS);
  });

  test("credits what Stripe collected, not what the metadata claims", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const s = await seedRecurringFixture(t);
    await createRecurring(t, s, { sessionId: "cs_auth" });
    await completeCheckout(t, "cs_auth", "sub_auth");

    await handleFinanceStripeEvent(webhookCtx(t), {
      type: "invoice.paid",
      account: CONNECTED_ACCOUNT,
      data: {
        object: {
          ...paidInvoiceWithMetadata({
            invoiceId: "in_auth",
            subscriptionId: "sub_auth",
            paymentIntentId: "pi_auth",
            amountPaid: 100, // Stripe collected $1…
            recurringDonationId: (await rowsFor(t, s.donorUserId))[0]._id,
          }),
          // …while the snapshot metadata brags about $999.
          parent: {
            subscription_details: {
              subscription: "sub_auth",
              metadata: { amountCents: "99900", feeCoverCents: "0" },
            },
          },
        },
      },
    });

    const donations = await donationsFor(t, s.fundId);
    expect(donations).toHaveLength(1);
    expect(donations[0].amountCents + donations[0].feeCoverCents).toBe(100);
    expect((await t.run((ctx) => ctx.db.get(s.fundId)))?.balanceCents).toBe(
      10_000 + 100,
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});
