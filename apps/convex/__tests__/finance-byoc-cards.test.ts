/**
 * Bring-your-own-cards, end to end (ADR-033 Phase 1).
 *
 * finance-privacy-adapter.test.ts pins what we say to Privacy.com. This file
 * pins what happens to a CHURCH: connecting their account, issuing a card on a
 * fund that has no Increase Account at all, a swipe becoming an expense
 * exactly once however it reaches us, and disconnecting without stranding live
 * cards.
 *
 * The Privacy HTTP client is mocked at the module boundary (the same seam
 * finance-cards.test.ts uses for Increase) — but ONLY the four network
 * functions. `signPrivacyWebhook` / `verifyPrivacyWebhookSignature` /
 * `canonicalJsonStringify` stay real, because the webhook tests below are
 * worthless if the thing deciding whether a delivery is authentic is a stub.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-byoc-cards.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import { decryptCredential } from "../lib/finance/credentialCrypto";
import { signPrivacyWebhook } from "../lib/finance/privacy";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";
/** 32 zero bytes, base64 — a valid AES-256 key for the envelope crypto. */
process.env.CREDENTIALS_MASTER_KEY = btoa(
  String.fromCharCode(...new Uint8Array(32).fill(3)),
);

// Same hazard as finance-cards.test.ts: mutations schedule provisioning
// actions on a REAL setTimeout under convex-test. Frozen timers mean they only
// run when a test invokes them deliberately.
vi.useFakeTimers();

const API_KEY = "privacy_live_test_key_do_not_log";
const WEBHOOK_PATH = "/card-provider-webhook/privacy";

/** Only the NETWORK functions are stubbed; the signature code stays real. */
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
  privacy.listPrivacyFundingSources.mockResolvedValue([
    { token: "fund_src_1", nickname: "Operations Checking" },
  ]);
  privacy.listPrivacyTransactions.mockResolvedValue({
    data: [],
    page: 1,
    total_pages: 1,
  });
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
  /** roles === 4: implicit community finance access. */
  primaryAdminUserId: Id<"users">;
  /** A plain member — no finance standing anywhere. */
  memberUserId: Id<"users">;
  cardholderUserId: Id<"users">;
}

/**
 * A community on Privacy.com. Note what is ABSENT and deliberately so: the
 * fund has no `increaseAccountId`, and the community has no
 * `increaseEntityId`. That is the whole point of BYO — this church never went
 * through Increase, and every gate has to cope with that.
 */
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
      name: "BYOC Church",
      slug: `byoc-church-${suffix}`,
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
    const memberUserId = await mkUser("Member", 1);
    const cardholderUserId = await mkUser("Cardholder", 1);

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Youth Ministry",
      type: "group",
      status: "active",
      balanceCents: 0,
      // NO increaseAccountId — this church has no Increase relationship.
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: "acct_byoc",
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

    return {
      communityId,
      fundId,
      primaryAdminUserId,
      memberUserId,
      cardholderUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  return (await generateTokens(userId)).accessToken;
}

async function connect(
  t: ReturnType<typeof convexTest>,
  f: Fixture,
  apiKey = API_KEY,
) {
  return await t.action(
    api.functions.finance.cardProviderConnections.connectCardProvider,
    {
      token: await tokenFor(f.primaryAdminUserId),
      communityId: f.communityId,
      provider: "privacy",
      apiKey,
    },
  );
}

// ============================================================================
// connectCardProvider
// ============================================================================

describe("connectCardProvider", () => {
  test("proves the key, encrypts it, and switches the community over", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const result = await connect(t, f);
    expect(result.accountLabel).toBe("Operations Checking");
    // Proved BEFORE storing — a saved-but-broken key fails later, in front of
    // someone trying to buy something.
    expect(privacy.listPrivacyFundingSources).toHaveBeenCalledTimes(1);

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("cardProviderConnections")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .first(),
    );
    expect(row!.status).toBe("active");
    expect(row!.accountLabel).toBe("Operations Checking");

    // The stored bytes are not the key, by eye or by search.
    expect(row!.credentialCiphertext).not.toContain(API_KEY);
    expect(row!.credentialCiphertext).not.toBe(API_KEY);
    expect(JSON.stringify(row)).not.toContain(API_KEY);

    // ...and they are genuinely the key, not merely different from it. The
    // decrypt must present the row's own (community, provider) identity —
    // that is the AAD binding, and it is itself part of what this asserts.
    await expect(
      decryptCredential(
        {
          ciphertext: row!.credentialCiphertext,
          iv: row!.credentialIv,
          keyVersion: row!.keyVersion,
        },
        { communityId: f.communityId, provider: "privacy", purpose: "apiKey" },
      ),
    ).resolves.toBe(API_KEY);

    const finance = await t.run(async (ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .first(),
    );
    expect(finance!.cardProvider).toBe("privacy");
  });

  test("writes an audit row that does not contain the key", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .collect(),
    );
    const connected = events.filter(
      (e) => e.action === "card_provider.connected",
    );
    expect(connected).toHaveLength(1);
    // An audit row is permanent. It must not become the place a credential
    // survives — not even a prefix.
    expect(connected[0].detailsJson ?? "").not.toContain(API_KEY);
    expect(connected[0].detailsJson).toContain("Operations Checking");
  });

  test("a plain member cannot connect a card issuer", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.action(
        api.functions.finance.cardProviderConnections.connectCardProvider,
        {
          token: await tokenFor(f.memberUserId),
          communityId: f.communityId,
          provider: "privacy",
          apiKey: API_KEY,
        },
      ),
    ).rejects.toThrow(/financial-controls access/i);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("a key the provider rejects is never stored", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    privacy.listPrivacyFundingSources.mockRejectedValueOnce(
      new Error("Privacy.com API GET /funding_sources failed (401): bad key"),
    );

    await expect(connect(t, f, "typo-key")).rejects.toThrow(/401/);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").collect(),
    );
    expect(rows).toHaveLength(0);
    const finance = await t.run(async (ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .first(),
    );
    expect(finance!.cardProvider).toBeUndefined();
  });

  test("reconnecting replaces the credential and clears the stale cursor", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("cardProviderConnections").first();
      await ctx.db.patch(row!._id, {
        syncCursor: "2026-01-01T00:00:00Z",
        status: "error",
        lastError: "old failure",
      });
    });

    await connect(t, f, "rotated-key");

    const rows = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").collect(),
    );
    // One row, not a race between two credentials.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
    expect(rows[0].lastError).toBeUndefined();
    // The new key may be a DIFFERENT Privacy account, whose history has
    // nothing to do with the position we were holding.
    expect(rows[0].syncCursor).toBeUndefined();
    await expect(
      decryptCredential(
        {
          ciphertext: rows[0].credentialCiphertext,
          iv: rows[0].credentialIv,
          keyVersion: rows[0].keyVersion,
        },
        {
          communityId: rows[0].communityId,
          provider: "privacy",
          purpose: "apiKey",
        },
      ),
    ).resolves.toBe("rotated-key");
  });
});

// ============================================================================
// getCardProviderStatus
// ============================================================================

describe("getCardProviderStatus", () => {
  test("returns the label and status, and nothing resembling a credential", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);

    const status = await t.query(
      api.functions.finance.cardProviderConnections.getCardProviderStatus,
      {
        token: await tokenFor(f.primaryAdminUserId),
        communityId: f.communityId,
      },
    );

    expect(status.cardProvider).toBe("privacy");
    expect(status.connection).toMatchObject({
      provider: "privacy",
      accountLabel: "Operations Checking",
      status: "active",
    });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(API_KEY);
    expect(serialized).not.toContain("credentialCiphertext");
    expect(serialized).not.toContain("credentialIv");
  });

  test("is finance-gated", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);

    await expect(
      t.query(
        api.functions.finance.cardProviderConnections.getCardProviderStatus,
        { token: await tokenFor(f.memberUserId), communityId: f.communityId },
      ),
    ).rejects.toThrow(/financial-controls access/i);
  });
});

// ============================================================================
// Card creation on a fund with no Increase Account
// ============================================================================

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

describe("issuing a card on a BYO provider", () => {
  test("a fund with no Increase Account can still get a card", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);

    const cardId = await issueCard(t, f);

    expect(privacy.createPrivacyCard).toHaveBeenCalledTimes(1);
    const [, params] = privacy.createPrivacyCard.mock.calls[0] as any[];
    expect(params).toMatchObject({
      type: "UNLOCKED",
      spend_limit: 50_000,
      spend_limit_duration: "MONTHLY",
    });
    expect(params.memo).toContain("Youth Ministry");

    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card!.provider).toBe("privacy");
    expect(card!.providerCardId).toBe("card_privacy_1");
    // The legacy Increase column stays EMPTY — writing a Privacy token into it
    // would put a foreign card on the Increase webhook's lookup index.
    expect(card!.increaseCardId).toBeUndefined();
    expect(card!.status).toBe("OPEN");
    expect(card!.last4).toBe("1111");
  });

  test("without a connection, creation is refused with a route forward", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await t.run(async (ctx) => {
      const finance = await ctx.db.query("communityFinance").first();
      await ctx.db.patch(finance!._id, { cardProvider: "privacy" });
    });

    await expect(
      t.mutation(api.functions.finance.cards.createFundCard, {
        token: await tokenFor(f.primaryAdminUserId),
        fundId: f.fundId,
        holderUserId: f.cardholderUserId,
        name: "Supplies",
      }),
      // Not "your bank account isn't ready" — that would send them to wait for
      // something that is never coming.
    ).rejects.toThrow(/isn't connected/i);
  });

  test("a connection revoked between request and provisioning refuses the card", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);

    const cardId: Id<"cards"> = await t.mutation(
      api.functions.finance.cards.createFundCard,
      {
        token: await tokenFor(f.primaryAdminUserId),
        fundId: f.fundId,
        holderUserId: f.cardholderUserId,
        name: "Supplies",
      },
    );
    await t.run(async (ctx) => {
      const row = await ctx.db.query("cardProviderConnections").first();
      await ctx.db.patch(row!._id, { status: "revoked" });
    });

    await t.action(internal.functions.finance.cards.provisionCard, { cardId });

    // No card at the provider, and the row says why.
    expect(privacy.createPrivacyCard).not.toHaveBeenCalled();
    const card = await t.run(async (ctx) => ctx.db.get(cardId));
    expect(card!.status).toBe("failed");
  });

  test("a fund on Increase still requires its own account", async () => {
    // The other half of the provider-aware gate: making BYO work must not
    // loosen the check that keeps an Increase card bound to its fund.
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await t.run(async (ctx) => {
      const finance = await ctx.db.query("communityFinance").first();
      await ctx.db.patch(finance!._id, {
        cardProvider: "increase",
        increaseEntityId: "entity_x",
      });
    });

    await expect(
      t.mutation(api.functions.finance.cards.createFundCard, {
        token: await tokenFor(f.primaryAdminUserId),
        fundId: f.fundId,
        holderUserId: f.cardholderUserId,
        name: "Supplies",
      }),
    ).rejects.toThrow(/bank account isn't ready/i);
  });
});

// ============================================================================
// The webhook
// ============================================================================

const SETTLED_TXN = {
  token: "txn_privacy_1",
  card_token: "card_privacy_1",
  amount: 4200,
  settled_amount: 4200,
  status: "SETTLED",
  result: "APPROVED",
  created: "2026-08-01T12:00:00Z",
  merchant: { descriptor: "OFFICE SUPPLY CO", mcc: "5943", city: "Austin" },
};

async function postWebhook(
  t: ReturnType<typeof convexTest>,
  payload: unknown,
  signature: string | null,
): Promise<Response> {
  return await t.fetch(WEBHOOK_PATH, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: signature ? { "X-Privacy-HMAC": signature } : {},
  });
}

async function countWrites(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ({
    expenses: (await ctx.db.query("expenses").collect()).length,
    ledger: (await ctx.db.query("ledgerEntries").collect()).length,
  }));
}

describe("POST /card-provider-webhook/privacy", () => {
  async function connectedWithCard(t: ReturnType<typeof convexTest>) {
    const f = await seed(t);
    await connect(t, f);
    await issueCard(t, f);
    return f;
  }

  test("a signed clearing becomes exactly one expense and one ledger debit", async () => {
    const t = convexTest(schema, modules);
    const f = await connectedWithCard(t);

    const res = await postWebhook(
      t,
      SETTLED_TXN,
      await signPrivacyWebhook(SETTLED_TXN, API_KEY),
    );
    expect(res.status).toBe(200);

    const expenses = await t.run(async (ctx) =>
      ctx.db.query("expenses").collect(),
    );
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      fundId: f.fundId,
      amountCents: 4200,
      kind: "card_charge",
      description: "OFFICE SUPPLY CO",
      increaseTransactionId: "txn_privacy_1",
    });

    const ledger = await t.run(async (ctx) =>
      ctx.db.query("ledgerEntries").collect(),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      direction: "debit",
      amountCents: 4200,
      kind: "card_capture",
    });
  });

  test("a redelivery writes nothing further", async () => {
    // Privacy retries with exponential backoff for a day and its signature
    // carries no timestamp, so there is no replay WINDOW protecting us —
    // idempotency on the transaction token is the entire defence.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const sig = await signPrivacyWebhook(SETTLED_TXN, API_KEY);

    await postWebhook(t, SETTLED_TXN, sig);
    await postWebhook(t, SETTLED_TXN, sig);
    await postWebhook(t, SETTLED_TXN, sig);

    expect(await countWrites(t)).toEqual({ expenses: 1, ledger: 1 });
  });

  test("a bad signature is 401 and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);

    const res = await postWebhook(
      t,
      SETTLED_TXN,
      await signPrivacyWebhook(SETTLED_TXN, "some-attackers-key"),
    );
    expect(res.status).toBe(401);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("a TAMPERED amount is 401 — the signature covers the body", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const sig = await signPrivacyWebhook(SETTLED_TXN, API_KEY);

    const res = await postWebhook(
      t,
      { ...SETTLED_TXN, settled_amount: 4_200_000 },
      sig,
    );
    expect(res.status).toBe(401);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("a missing signature is 401", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const res = await postWebhook(t, SETTLED_TXN, null);
    expect(res.status).toBe(401);
  });

  test("re-ordered keys on the wire still verify", async () => {
    // Privacy signs a canonical re-rendering, not the bytes it sent. If we
    // ever HMAC'd the raw body instead, this is the test that would catch it —
    // and in production it would reject every real delivery.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const sig = await signPrivacyWebhook(SETTLED_TXN, API_KEY);

    const reordered = {
      merchant: { city: "Austin", mcc: "5943", descriptor: "OFFICE SUPPLY CO" },
      created: SETTLED_TXN.created,
      result: SETTLED_TXN.result,
      status: SETTLED_TXN.status,
      settled_amount: SETTLED_TXN.settled_amount,
      amount: SETTLED_TXN.amount,
      card_token: SETTLED_TXN.card_token,
      token: SETTLED_TXN.token,
    };
    const res = await postWebhook(t, reordered, sig);
    expect(res.status).toBe(200);
    expect(await countWrites(t)).toEqual({ expenses: 1, ledger: 1 });
  });

  test("a card we don't know is 200 with no writes", async () => {
    // Routine, not exceptional: the church has their own cards on this Privacy
    // account and we receive the whole account's feed.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const foreign = { ...SETTLED_TXN, card_token: "card_the_church_owns" };

    const res = await postWebhook(
      t,
      foreign,
      await signPrivacyWebhook(foreign, API_KEY),
    );
    expect(res.status).toBe(200);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("an authorization (PENDING) records nothing", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const pending = { ...SETTLED_TXN, status: "PENDING", settled_amount: 0 };

    const res = await postWebhook(
      t,
      pending,
      await signPrivacyWebhook(pending, API_KEY),
    );
    expect(res.status).toBe(200);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("a RETURN records nothing yet, rather than debiting the fund again", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const refund = {
      ...SETTLED_TXN,
      token: "txn_refund_1",
      events: [{ type: "RETURN" }],
    };

    const res = await postWebhook(
      t,
      refund,
      await signPrivacyWebhook(refund, API_KEY),
    );
    expect(res.status).toBe(200);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("malformed JSON is 400", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    const res = await t.fetch(WEBHOOK_PATH, {
      method: "POST",
      body: "{not json",
      headers: { "X-Privacy-HMAC": "whatever" },
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// The hourly poll
// ============================================================================

describe("finance-card-txn-poll", () => {
  async function connectedWithCard(t: ReturnType<typeof convexTest>) {
    const f = await seed(t);
    await connect(t, f);
    await issueCard(t, f);
    return f;
  }

  test("records settled charges and advances the cursor", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    privacy.listPrivacyTransactions.mockResolvedValue({
      data: [
        SETTLED_TXN,
        {
          ...SETTLED_TXN,
          token: "txn_privacy_2",
          created: "2026-08-02T09:00:00Z",
          settled_amount: 900,
        },
      ],
      page: 1,
      total_pages: 1,
    } as any);

    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result).toEqual({ polled: 1, recorded: 2 });

    const row = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").first(),
    );
    expect(row!.syncCursor).toBe("2026-08-02T09:00:00.000Z");
    expect(row!.lastSyncAt).toBeDefined();
    expect(row!.status).toBe("active");
    expect(await countWrites(t)).toEqual({ expenses: 2, ledger: 2 });
  });

  test("the poll and the webhook cannot double-book the same charge", async () => {
    // This is what makes the poll a real backstop rather than a second,
    // subtly different importer.
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    await postWebhook(
      t,
      SETTLED_TXN,
      await signPrivacyWebhook(SETTLED_TXN, API_KEY),
    );
    privacy.listPrivacyTransactions.mockResolvedValue({
      data: [SETTLED_TXN],
      page: 1,
      total_pages: 1,
    } as any);

    await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(await countWrites(t)).toEqual({ expenses: 1, ledger: 1 });
  });

  test("declines are read but not recorded (Phase 3 notifies)", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    privacy.listPrivacyTransactions.mockResolvedValue({
      data: [
        {
          ...SETTLED_TXN,
          token: "txn_declined",
          status: "DECLINED",
          result: "INSUFFICIENT_FUNDS",
        },
      ],
      page: 1,
      total_pages: 1,
    } as any);

    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result.recorded).toBe(0);
    expect(await countWrites(t)).toEqual({ expenses: 0, ledger: 0 });
  });

  test("a resumed poll passes the stored cursor back to the provider", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("cardProviderConnections").first();
      await ctx.db.patch(row!._id, { syncCursor: "2026-07-30T00:00:00Z" });
    });

    await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    const [, params] = privacy.listPrivacyTransactions.mock.calls[0] as any[];
    expect(params.begin).toBe("2026-07-30T00:00:00Z");
  });

  test("a failing key flips that connection to error and keeps its cursor", async () => {
    const t = convexTest(schema, modules);
    await connectedWithCard(t);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("cardProviderConnections").first();
      await ctx.db.patch(row!._id, { syncCursor: "2026-07-30T00:00:00Z" });
    });
    privacy.listPrivacyTransactions.mockRejectedValue(
      new Error("Privacy.com API GET /transactions failed (401): revoked"),
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
    // Never rewound: the next successful poll must re-read from where we
    // stopped, not from the beginning.
    expect(row!.syncCursor).toBe("2026-07-30T00:00:00Z");
  });

  test("one church's broken key does not stop another church's import", async () => {
    const t = convexTest(schema, modules);
    const a = await connectedWithCard(t);
    const b = await connectedWithCard(t);
    expect(a.communityId).not.toBe(b.communityId);

    let call = 0;
    privacy.listPrivacyTransactions.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("failed (401): revoked");
      return { data: [SETTLED_TXN], page: 1, total_pages: 1 } as any;
    });

    const result = await t.action(
      internal.functions.finance.jobs.pollCardProviderTransactions,
      {},
    );
    expect(result.polled).toBe(2);
    expect(result.recorded).toBe(1);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").collect(),
    );
    expect(rows.map((r) => r.status).sort()).toEqual(["active", "error"]);
  });
});

// ============================================================================
// disconnectCardProvider
// ============================================================================

describe("disconnectCardProvider", () => {
  test("refuses while a card is still open, and names the count", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await issueCard(t, f);

    await expect(
      t.mutation(
        api.functions.finance.cardProviderConnections.disconnectCardProvider,
        {
          token: await tokenFor(f.primaryAdminUserId),
          communityId: f.communityId,
        },
      ),
      // Revoking the key doesn't stop the card — it stops US.
    ).rejects.toThrow(/1 card is still open/i);

    const row = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").first(),
    );
    expect(row!.status).toBe("active");
  });

  test("succeeds once the card is closed", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    const cardId = await issueCard(t, f);
    await t.run(async (ctx) => ctx.db.patch(cardId, { status: "CLOSED" }));

    const result = await t.mutation(
      api.functions.finance.cardProviderConnections.disconnectCardProvider,
      {
        token: await tokenFor(f.primaryAdminUserId),
        communityId: f.communityId,
      },
    );
    expect(result.liveCardsAtDisconnect).toBe(0);

    const row = await t.run(async (ctx) =>
      ctx.db.query("cardProviderConnections").first(),
    );
    expect(row!.status).toBe("revoked");

    const finance = await t.run(async (ctx) =>
      ctx.db.query("communityFinance").first(),
    );
    // "none", not absent: absent would let the resolver fall back to Increase.
    expect(finance!.cardProvider).toBe("none");
  });

  test("force disconnects anyway, and says so in the audit trail", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);
    await issueCard(t, f);

    const result = await t.mutation(
      api.functions.finance.cardProviderConnections.disconnectCardProvider,
      {
        token: await tokenFor(f.primaryAdminUserId),
        communityId: f.communityId,
        force: true,
      },
    );
    expect(result.liveCardsAtDisconnect).toBe(1);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", f.communityId))
        .collect(),
    );
    const row = events.find((e) => e.action === "card_provider.disconnected");
    expect(row!.detailsJson).toContain('"forced":true');
    expect(row!.detailsJson).toContain('"liveCardsAtDisconnect":1');
  });

  test("a plain member cannot disconnect", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await connect(t, f);

    await expect(
      t.mutation(
        api.functions.finance.cardProviderConnections.disconnectCardProvider,
        { token: await tokenFor(f.memberUserId), communityId: f.communityId },
      ),
    ).rejects.toThrow(/financial-controls access/i);
  });

  test("disconnecting when nothing is connected says so", async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expect(
      t.mutation(
        api.functions.finance.cardProviderConnections.disconnectCardProvider,
        {
          token: await tokenFor(f.primaryAdminUserId),
          communityId: f.communityId,
        },
      ),
    ).rejects.toThrow(/no connected card provider/i);
  });
});
