/**
 * BILL Spend & Expense, end to end (ADR-033 Phase 2).
 *
 * finance-bill-adapter.test.ts pins what we SAY to BILL. This file pins what
 * happens to a CHURCH: connecting their account, issuing a card into a budget
 * they've never heard of, and — the reason this file exists at all — the
 * FETCH-TO-VERIFY webhook.
 *
 * BILL publishes no webhook signature. None. So `/card-provider-webhook/bill`
 * is an endpoint any stranger can POST anything to, and the only thing standing
 * between that and a church's books is the rule that the payload ROUTES and the
 * API DECIDES. The test named "a payload that LIES about the amount…" is the
 * one that proves it, and if it is ever softened this integration is unsafe to
 * ship. Read it before changing the handler.
 *
 * The BILL HTTP client is mocked at the module boundary — the same seam
 * finance-byoc-cards.test.ts uses for Privacy — and the LAST describe block
 * runs a Privacy church and a BILL church through one poll fan-out to prove
 * they never share a client, a cursor, or a credential.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-byoc-bill.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import { decryptCredential } from "../lib/finance/credentialCrypto";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";
/** 32 bytes, base64 — a valid AES-256 key for the envelope crypto. */
process.env.CREDENTIALS_MASTER_KEY = btoa(
  String.fromCharCode(...new Uint8Array(32).fill(3)),
);
process.env.CONVEX_SITE_URL = "https://test-deployment.convex.site";

// Same hazard as finance-byoc-cards.test.ts: mutations schedule provisioning
// actions on a REAL setTimeout under convex-test. Frozen timers mean they only
// run when a test invokes them deliberately.
vi.useFakeTimers();

const API_TOKEN = "bill_live_token_do_not_log";
const PRIVACY_KEY = "privacy_live_key_do_not_log";
const WEBHOOK_PATH = "/card-provider-webhook/bill";
const CARD_UUID = "crd_bill_1";
const HOLDER_EMAIL = "pastor@byoc.church";

/** The transaction BILL will hand back when we re-fetch. THE source of truth. */
const CLEARED_TXN = {
  uuid: "txr_bill_1",
  cardUuid: CARD_UUID,
  amount: 42.0,
  merchantName: "OFFICE SUPPLY CO",
  rawMerchantName: "OFFICE SUPPLY CO #12",
  transactionType: "CLEAR",
  occurredTime: "2026-08-01T12:00:00.000+00:00",
  updatedTime: "2026-08-01T12:05:00.000+00:00",
  complete: true,
  currencyData: {
    exchangeRate: 1.0,
    exponent: 2,
    originalCurrencyAmount: "4200",
    originalCurrencyCode: "USD",
  },
};

/** Only the NETWORK functions are stubbed; the normalization stays real. */
const bill = vi.hoisted(() => ({
  getBillCurrentUser: vi.fn(async () => ({
    uuid: "usr_admin",
    email: "admin@byoc.church",
    companyName: "BYOC Church",
  })),
  listBillUsers: vi.fn(async () => ({
    results: [
      { uuid: "usr_admin", email: "admin@byoc.church" },
      { uuid: "usr_holder", email: "pastor@byoc.church" },
    ],
    nextPage: null,
  })),
  listBillBudgets: vi.fn(async () => ({ results: [], nextPage: null })),
  createBillBudget: vi.fn(async (_c: unknown, params: any) => ({
    uuid: "bgt_bill_1",
    name: params.name,
  })),
  createBillCard: vi.fn(async (_c: unknown, params: any) => ({
    uuid: CARD_UUID,
    name: params.name,
    status: "ACTIVATED",
    lastFour: "9999",
  })),
  updateBillCard: vi.fn(async (_c: unknown, uuid: string, params: any) => ({
    uuid,
    name: params.name ?? "card",
    status: "FROZEN",
  })),
  freezeBillCard: vi.fn(async (_c: unknown, uuid: string) => ({
    uuid,
    name: "card",
    status: "FROZEN",
  })),
  unfreezeBillCard: vi.fn(async (_c: unknown, uuid: string) => ({
    uuid,
    status: "ACTIVATED",
  })),
  listBillTransactions: vi.fn(async () => ({ results: [], nextPage: null })),
  getBillTransaction: vi.fn(async () => null as any),
  createBillWebhookSubscription: vi.fn(async () => ({ id: "sub_1" })),
}));

vi.mock("../lib/finance/bill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/finance/bill")>()),
  ...bill,
}));

/** Privacy's network seam, for the cross-provider fan-out test only. */
const privacy = vi.hoisted(() => ({
  createPrivacyCard: vi.fn(async () => ({
    token: "card_privacy_1",
    state: "OPEN",
    last_four: "1111",
  })),
  updatePrivacyCard: vi.fn(async () => ({ token: "card_privacy_1", state: "OPEN" })),
  listPrivacyFundingSources: vi.fn(async () => [
    { token: "fund_src_1", nickname: "Operations Checking" },
  ]),
  listPrivacyTransactions: vi.fn(async () => ({ data: [], page: 1, total_pages: 1 })),
}));

vi.mock("../lib/finance/privacy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/finance/privacy")>()),
  ...privacy,
}));

beforeEach(() => {
  vi.clearAllMocks();
  bill.getBillCurrentUser.mockResolvedValue({
    uuid: "usr_admin",
    email: "admin@byoc.church",
    companyName: "BYOC Church",
  });
  bill.listBillUsers.mockResolvedValue({
    results: [
      { uuid: "usr_admin", email: "admin@byoc.church" },
      { uuid: "usr_holder", email: "pastor@byoc.church" },
    ],
    nextPage: null,
  });
  bill.listBillBudgets.mockResolvedValue({ results: [], nextPage: null });
  bill.listBillTransactions.mockResolvedValue({ results: [], nextPage: null });
  bill.getBillTransaction.mockResolvedValue(null);
  bill.createBillWebhookSubscription.mockResolvedValue({ id: "sub_1" });
  privacy.listPrivacyTransactions.mockResolvedValue({
    data: [],
    page: 1,
    total_pages: 1,
  });
  privacy.listPrivacyFundingSources.mockResolvedValue([
    { token: "fund_src_1", nickname: "Operations Checking" },
  ]);
});

const ADDRESS = {
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

interface Fixture {
  communityId: Id<"communities">;
  fundId: Id<"funds">;
  primaryAdminUserId: Id<"users">;
  cardholderUserId: Id<"users">;
}

/**
 * A community that has never touched Increase. Note what is ABSENT: no
 * `increaseAccountId` on the fund, no `increaseEntityId` on the community.
 * The cardholder DOES have an email, because BILL identifies cardholders by
 * one and a fixture without it would hide the failure mode rather than test it.
 */
async function seed(
  t: ReturnType<typeof convexTest>,
  options: { fundName?: string; holderEmail?: string | null } = {},
): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const existingFlag = await ctx.db.query("featureFlags").first();
    if (!existingFlag) {
      await ctx.db.insert("featureFlags", {
        key: "group-giving",
        enabled: true,
        updatedAt: Date.now(),
      });
    }
    const timestamp = Date.now();
    const suffix = Math.floor(Math.random() * 1_000_000);

    const communityId = await ctx.db.insert("communities", {
      name: "BYOC Church",
      slug: `byoc-bill-${suffix}`,
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

    const mkUser = async (name: string, roles: number, email?: string | null) => {
      const userId = await ctx.db.insert("users", {
        firstName: name,
        lastName: "User",
        phone: `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
        ...(email ? { email } : {}),
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

    const primaryAdminUserId = await mkUser("Primary", 4, "admin@byoc.church");
    const cardholderUserId = await mkUser(
      "Cardholder",
      1,
      options.holderEmail === undefined ? HOLDER_EMAIL : options.holderEmail,
    );

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: options.fundName ?? "Youth Ministry",
      type: "group",
      status: "active",
      balanceCents: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: `acct_byoc_${suffix}`,
      onboardingStatus: "live",
      legalName: "BYOC Church",
      ein: "12-3456789",
      address: ADDRESS,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("fundRoles", {
      fundId,
      userId: primaryAdminUserId,
      role: "finance_admin",
      grantedBy: primaryAdminUserId,
      grantedAt: timestamp,
    });
    await ctx.db.insert("fundRoles", {
      fundId,
      userId: cardholderUserId,
      role: "cardholder",
      grantedBy: primaryAdminUserId,
      grantedAt: timestamp,
    });

    return { communityId, fundId, primaryAdminUserId, cardholderUserId };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  return (await generateTokens(userId)).accessToken;
}

async function connect(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
  provider: "bill" | "privacy" = "bill",
  apiKey = provider === "bill" ? API_TOKEN : PRIVACY_KEY,
) {
  return await t.action(
    api.functions.finance.cardProviderConnections.connectCardProvider,
    {
      token: await tokenFor(f.primaryAdminUserId),
      communityId: f.communityId,
      provider,
      apiKey,
    },
  );
}

/** Create + provision a card, the way createFundCard's scheduled action would. */
async function issueCard(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
): Promise<Id<"cards">> {
  const cardId: Id<"cards"> = await t.mutation(
    api.functions.finance.cards.createFundCard,
    {
      token: await tokenFor(f.primaryAdminUserId),
      fundId: f.fundId,
      holderUserId: f.cardholderUserId,
      name: "Supplies",
      spendLimitCents: 50_000,
      limitPeriod: "month",
    },
  );
  await t.action(internal.functions.finance.cards.provisionCard, { cardId });
  return cardId;
}

async function countWrites(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    expenses: (await ctx.db.query("expenses").collect()).length,
    ledger: (await ctx.db.query("ledgerEntries").collect()).length,
  }));
}

// ============================================================================
// connectCardProvider
// ============================================================================

describe("connecting BILL", () => {
  test("proves the token, encrypts it, and switches the community over", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const result = await connect(t, f);
    expect(result.accountLabel).toBe("BYOC Church");

    const row = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").first(),
    );
    expect(row!.provider).toBe("bill");
    expect(row!.status).toBe("active");
    // The token round-trips through envelope encryption, and the CIPHERTEXT is
    // what is stored — a grep of the row must never find the token.
    expect(JSON.stringify(row)).not.toContain(API_TOKEN);
    expect(
      await decryptCredential(
        {
          ciphertext: row!.credentialCiphertext,
          iv: row!.credentialIv,
          keyVersion: row!.keyVersion,
        },
        { communityId: f.communityId, provider: "bill", purpose: "apiKey" },
      ),
    ).toBe(API_TOKEN);

    const finance = await t.run(async (ctx) =>
      ctx.db.query("communityFinance").first(),
    );
    expect(finance!.cardProvider).toBe("bill");
  });

  test("registers THIS deployment's webhook URL, derived not configured", async () => {
    // A hand-typed URL is how a staging connection ends up registering a
    // production callback.
    const t = convexTest(schema, modules);
    await connect(t, await seed(t));

    expect(bill.createBillWebhookSubscription).toHaveBeenCalledTimes(1);
    const [, params] = bill.createBillWebhookSubscription.mock.calls[0] as any[];
    expect(params.notificationUrl).toBe(
      "https://test-deployment.convex.site/card-provider-webhook/bill",
    );
  });

  test("A FAILED SUBSCRIPTION STILL CONNECTS — the poll covers it", async () => {
    // BILL's subscriptions are production-only and may want a different
    // credential entirely. Making registration fatal would make connecting a
    // sandbox account impossible for a church whose cards work perfectly.
    const t = convexTest(schema, modules);
    bill.createBillWebhookSubscription.mockRejectedValue(
      new Error("BILL API POST /v3/subscriptions failed (403): devKey required"),
    );

    const result = await connect(t, await seed(t));
    expect(result.accountLabel).toBe("BYOC Church");
    const row = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").first(),
    );
    expect(row!.status).toBe("active");
  });

  test("a bad token is rejected BEFORE anything is stored", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    bill.getBillCurrentUser.mockRejectedValue(
      new Error("BILL API GET /v3/spend/users/current failed (401): Invalid API token"),
    );

    await expect(connect(t, f)).rejects.toThrow(/Invalid API token/);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("the prompt names BILL's own word for the credential", async () => {
    // "Enter your Privacy.com API key" shown to a church connecting BILL is how
    // someone pastes the wrong secret.
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await expect(connect(t, f, "bill", "   ")).rejects.toThrow(
      /BILL Spend & Expense API token/,
    );
  });
});

// ============================================================================
// Issuing a card
// ============================================================================

describe("issuing a BILL card", () => {
  test("creates the fund's budget, resolves the holder, and caps the card", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);

    const cardId = await issueCard(t, f);

    // ONE BUDGET PER FUND, named after the fund — the mapping decision.
    const [, budget] = bill.createBillBudget.mock.calls[0] as any[];
    expect(budget.name).toBe("Youth Ministry · Togather");

    const [, card] = bill.createBillCard.mock.calls[0] as any[];
    expect(card).toEqual({
      name: "Youth Ministry — Supplies",
      // Matched from the cardholder's Togather email, never created.
      userId: "usr_holder",
      budgetId: "bgt_bill_1",
      limit: 500,
      shareBudgetFunds: false,
    });

    const row = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(row!.provider).toBe("bill");
    expect(row!.providerCardId).toBe(CARD_UUID);
    // The legacy Increase column stays EMPTY — writing a BILL uuid into it
    // would put a foreign card on the Increase webhook's lookup index.
    expect(row!.increaseCardId).toBeUndefined();
    expect(row!.status).toBe("ACTIVATED");
    expect(row!.last4).toBe("9999");
  });

  test("an EXISTING budget for the fund is reused rather than duplicated", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    bill.listBillBudgets.mockResolvedValue({
      results: [{ uuid: "bgt_existing", name: "Youth Ministry · Togather" }],
      nextPage: null,
    });

    await issueCard(t, f);
    expect(bill.createBillBudget).not.toHaveBeenCalled();
    const [, card] = bill.createBillCard.mock.calls[0] as any[];
    expect(card.budgetId).toBe("bgt_existing");
  });

  test("a cardholder BILL has never heard of fails with the admin's next action", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    bill.listBillUsers.mockResolvedValue({
      results: [{ uuid: "usr_admin", email: "admin@byoc.church" }],
      nextPage: null,
    });

    const cardId = await issueCard(t, f);

    expect(bill.createBillCard).not.toHaveBeenCalled();
    const row = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(row!.status).toBe("failed");

    const audit = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .filter((q) => q.eq(q.field("action"), "card.provision_failed"))
        .first(),
    );
    expect(JSON.parse(audit!.detailsJson!).message).toMatch(
      /invite them in BILL Spend & Expense first/,
    );
  });

  test("a cardholder with no Togather email fails on OUR side, before BILL", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t, { holderEmail: null });
    await connect(t, f);

    const cardId = await issueCard(t, f);

    expect(bill.listBillUsers).not.toHaveBeenCalled();
    const row = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(row!.status).toBe("failed");
  });
});

// ============================================================================
// The webhook — FETCH TO VERIFY
// ============================================================================

async function postWebhook(
  t: ReturnType<typeof convexTest>,
  payload: unknown,
): Promise<Response> {
  return await t.fetch(WEBHOOK_PATH, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
}

/** A notification as BILL sends it. Nothing in here is trusted but the two ids. */
function notification(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      eventId: "evt_1",
      eventType: "spend.transaction.updated",
      spendCompanyUuid: "cmp_1",
      version: "1",
    },
    transaction: { ...CLEARED_TXN, ...overrides },
  };
}

describe("POST /card-provider-webhook/bill", () => {
  async function connectedWithCard(t: ReturnType<typeof convexTest>) {
    const f = await seed(t);
    await connect(t, f);
    await issueCard(t, f);
    return f;
  }

  test("a clearing becomes exactly one expense and one ledger debit", async () => {
    const t = convexTest(schema, modules);
    const f = await connectedWithCard(t);
    bill.getBillTransaction.mockResolvedValue(CLEARED_TXN);

    const res = await postWebhook(t, notification());
    expect(res.status).toBe(200);

    // The route re-read the transaction rather than believing the body.
    expect(bill.getBillTransaction).toHaveBeenCalledWith(
      expect.anything(),
      "txr_bill_1",
    );

    const expenses = await t.run(async (ctx) => ctx.db.query("expenses").collect());
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      fundId: f.fundId,
      amountCents: 4200,
      kind: "card_charge",
      description: "OFFICE SUPPLY CO",
      increaseTransactionId: "txr_bill_1",
    });
    const ledger = await t.run(async (ctx) =>
      ctx.db.query("ledgerEntries").collect(),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ direction: "debit", amountCents: 4200 });
  });

  test("A PAYLOAD THAT LIES ABOUT THE AMOUNT BOOKS THE API'S NUMBER", async () => {
    // THE test for this integration. BILL publishes no webhook signature, so
    // this endpoint accepts anything a stranger sends. The defence is that the
    // body only ROUTES: whatever it claims, what gets booked is what BILL's
    // API returns for that uuid, fetched with the church's own token.
    //
    // If this ever fails, the handler has started trusting the payload and a
    // stranger can write arbitrary expenses into a church's ledger.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    bill.getBillTransaction.mockResolvedValue(CLEARED_TXN); // truth: $42.00

    const res = await postWebhook(
      t,
      notification({
        amount: 900_000,
        merchantName: "ATTACKER LLC",
        currencyData: {
          exchangeRate: 1.0,
          exponent: 2,
          originalCurrencyAmount: "90000000",
          originalCurrencyCode: "USD",
        },
      }),
    );
    expect(res.status).toBe(200);

    const expenses = await t.run(async (ctx) => ctx.db.query("expenses").collect());
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountCents).toBe(4200);
    expect(expenses[0].description).toBe("OFFICE SUPPLY CO");
  });

  test("a transaction BILL doesn't have writes NOTHING", async () => {
    // What a wholly forged delivery looks like: a 404 on the re-fetch.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    bill.getBillTransaction.mockResolvedValue(null);

    const res = await postWebhook(t, notification({ uuid: "txr_invented" }));
    expect(res.status).toBe(200);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("a redelivery writes nothing further", async () => {
    // `spend.transaction.updated` fires at AUTHORIZATION and AGAIN at CLEAR,
    // and BILL retries on failure — idempotency on the transaction uuid is the
    // entire defence, since there is no signature and therefore no replay
    // window either.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    bill.getBillTransaction.mockResolvedValue(CLEARED_TXN);

    await postWebhook(t, notification());
    await postWebhook(t, notification());
    await postWebhook(t, notification());

    expect(await countWrites(t)).toEqual({ expenses: 1, ledger: 1 });
  });

  test("the AUTHORIZATION delivery records nothing; its CLEAR does", async () => {
    // BILL updates the SAME uuid rather than sending a second transaction, so
    // recording the authorization would double-book it on settlement.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);

    bill.getBillTransaction.mockResolvedValue({
      ...CLEARED_TXN,
      transactionType: "AUTHORIZATION",
      complete: false,
    });
    await postWebhook(t, notification());
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });

    bill.getBillTransaction.mockResolvedValue(CLEARED_TXN);
    await postWebhook(t, notification());
    expect(await countWrites(t)).toEqual({ expenses: 1, ledger: 1 });
  });

  test("a card we don't know is 200 with no writes, and no API call", async () => {
    // Routine: the church has their own cards in this BILL account and the
    // subscription covers the whole company's feed. Not fetching is also what
    // keeps a stranger from using this endpoint to burn the church's rate limit.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);

    const res = await postWebhook(
      t,
      notification({ cardUuid: "crd_the_church_owns" }),
    );
    expect(res.status).toBe(200);
    expect(bill.getBillTransaction).not.toHaveBeenCalled();
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("a payload with no ids is ignored without touching the database", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const res = await postWebhook(t, { metadata: { eventType: "spend.transaction.updated" } });
    expect(res.status).toBe(200);
    expect(bill.getBillTransaction).not.toHaveBeenCalled();
  });

  test("a failed re-fetch is 500 so BILL redelivers", async () => {
    // Distinct from a 404: the transaction may well be real and we simply
    // couldn't read it. The poll would catch it anyway, but a retry is cheaper.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    bill.getBillTransaction.mockRejectedValue(new Error("failed (429): slow down"));

    const res = await postWebhook(t, notification());
    expect(res.status).toBe(500);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("malformed JSON is 400", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const res = await t.fetch(WEBHOOK_PATH, { method: "POST", body: "{not json" });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// The hourly poll
// ============================================================================

describe("finance-card-txn-poll on BILL", () => {
  async function connectedWithCard(t: ReturnType<typeof convexTest>) {
    const f = await seed(t);
    await connect(t, f);
    await issueCard(t, f);
    return f;
  }

  test("records clearings and advances the updatedTime cursor", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    bill.listBillTransactions.mockResolvedValue({
      results: [
        CLEARED_TXN,
        {
          ...CLEARED_TXN,
          uuid: "txr_bill_2",
          amount: 9.0,
          updatedTime: "2026-08-02T09:00:00.000+00:00",
          currencyData: {
            exchangeRate: 1.0,
            exponent: 2,
            originalCurrencyAmount: "900",
            originalCurrencyCode: "USD",
          },
        },
      ],
      nextPage: null,
    });

    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result).toEqual({ polled: 1, recorded: 2 });

    const row = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").first(),
    );
    expect(row!.syncCursor).toBe("2026-08-02T09:00:00.000Z");
    expect(row!.status).toBe("active");
    expect(await countWrites(t)).toEqual({ expenses: 2, ledger: 2 });
  });

  test("DECLINES are read but not recorded (Phase 3 notifies)", async () => {
    // `declineFeed: "poll"` made literal — this is the only place a BILL
    // decline reaches Togather at all.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    bill.listBillTransactions.mockResolvedValue({
      results: [
        {
          ...CLEARED_TXN,
          uuid: "txr_declined",
          transactionType: "DECLINE",
          declineReason: "Budget limit exceeded",
        },
      ],
      nextPage: null,
    });

    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result.recorded).toBe(0);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("a resumed poll filters from the stored cursor", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("cardProviderConnections").first();
      await ctx.db.patch(row!._id, { syncCursor: "2026-07-30T00:00:00.000Z" });
    });

    await t.action(internal.functions.finance.jobs.pollCardProviderTransactions, {});
    const [, params] = bill.listBillTransactions.mock.calls[0] as any[];
    expect(params.filters).toBe("updatedTime:gte:2026-07-30T00:00:00.000Z");
    expect(params.sort).toBe("updatedTime:asc");
  });

  test("the poll and the webhook cannot double-book the same charge", async () => {
    // What makes the poll a real backstop rather than a second, subtly
    // different importer.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    bill.getBillTransaction.mockResolvedValue(CLEARED_TXN);
    await postWebhook(t, notification());

    bill.listBillTransactions.mockResolvedValue({
      results: [CLEARED_TXN],
      nextPage: null,
    });
    await t.action(internal.functions.finance.jobs.pollCardProviderTransactions, {});

    expect(await countWrites(t)).toEqual({ expenses: 1, ledger: 1 });
  });

  test("a revoked token flips the connection to error and keeps its cursor", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("cardProviderConnections").first();
      await ctx.db.patch(row!._id, { syncCursor: "2026-07-30T00:00:00.000Z" });
    });
    bill.listBillTransactions.mockRejectedValue(
      new Error("BILL API GET /v3/spend/transactions failed (401): revoked"),
    );

    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result).toEqual({ polled: 1, recorded: 0 });

    const row = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").first(),
    );
    expect(row!.status).toBe("error");
    expect(row!.lastError).toContain("401");
    // Never rewound: the next successful poll re-reads from where we stopped.
    expect(row!.syncCursor).toBe("2026-07-30T00:00:00.000Z");
  });
});

// ============================================================================
// Provider dispatch — the two churches must not cross wires
// ============================================================================

describe("a Privacy church and a BILL church in one fan-out", () => {
  test("each is polled through its OWN adapter, with its own cursor", async () => {
    // The fan-out has no provider switch of its own: each connection resolves
    // to its community's adapter with its community's decrypted credential.
    // This is the test that would fail if someone ever "simplified" that into a
    // single client — and the failure mode it prevents is one church's charges
    // landing in another church's fund.
    const t = convexTest(schema, modules);

    const billChurch = await seed(t, { fundName: "Youth Ministry" });
    await connect(t, billChurch, "bill");
    await issueCard(t, billChurch);

    const privacyChurch = await seed(t, { fundName: "Building Fund" });
    await connect(t, privacyChurch, "privacy");
    const privacyCardId = await issueCard(t, privacyChurch);
    expect(billChurch.communityId).not.toBe(privacyChurch.communityId);

    bill.listBillTransactions.mockResolvedValue({
      results: [CLEARED_TXN],
      nextPage: null,
    });
    privacy.listPrivacyTransactions.mockResolvedValue({
      data: [
        {
          token: "txn_privacy_1",
          card_token: "card_privacy_1",
          amount: 1500,
          settled_amount: 1500,
          status: "SETTLED",
          result: "APPROVED",
          created: "2026-08-03T10:00:00Z",
          merchant: { descriptor: "HARDWARE STORE" },
        },
      ],
      page: 1,
      total_pages: 1,
    } as any);

    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result).toEqual({ polled: 2, recorded: 2 });

    // Each provider client saw exactly its own church's poll — no double
    // dispatch, and no adapter used for a community it doesn't belong to.
    expect(bill.listBillTransactions).toHaveBeenCalledTimes(1);
    expect(privacy.listPrivacyTransactions).toHaveBeenCalledTimes(1);

    // And the money landed in the right fund on both sides.
    const expenses = await t.run(async (ctx) =>
      ctx.db.query("expenses").collect(),
    );
    const byFund = new Map(expenses.map((e) => [e.fundId, e]));
    expect(byFund.get(billChurch.fundId)).toMatchObject({
      amountCents: 4200,
      description: "OFFICE SUPPLY CO",
    });
    expect(byFund.get(privacyChurch.fundId)).toMatchObject({
      amountCents: 1500,
      description: "HARDWARE STORE",
    });

    // Cursors are per connection and in each provider's own vocabulary.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").collect(),
    );
    const cursors = new Map(rows.map((r) => [r.provider, r.syncCursor]));
    expect(cursors.get("bill")).toBe("2026-08-01T12:05:00.000Z");
    expect(cursors.get("privacy")).toBe("2026-08-03T10:00:00.000Z");

    // Sanity: the Privacy card really was created at Privacy, not at BILL.
    const privacyCard = await t.run(async (ctx) => ctx.db.get(privacyCardId));
    expect(privacyCard!.provider).toBe("privacy");
  });

  test("a BILL webhook cannot book against a Privacy church's card", async () => {
    // The route looks up `(provider: "bill", providerCardId)`, so a payload
    // naming another provider's card token resolves to nothing.
    const t = convexTest(schema, modules);
    const privacyChurch = await seed(t);
    await connect(t, privacyChurch, "privacy");
    await issueCard(t, privacyChurch);

    const res = await postWebhook(t, notification({ cardUuid: "card_privacy_1" }));
    expect(res.status).toBe(200);
    expect(bill.getBillTransaction).not.toHaveBeenCalled();
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });
});
