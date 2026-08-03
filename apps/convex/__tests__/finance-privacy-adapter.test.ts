/**
 * Privacy.com adapter unit tests (ADR-033 Phase 1).
 *
 * These assert what actually leaves the process and what we make of what comes
 * back, so `fetch` itself is the mock boundary rather than the client module.
 * Mocking `lib/finance/privacy` would let the adapter and the client drift
 * apart while every test stayed green — and the request body is the part a
 * bank acts on, so it is the part worth pinning.
 *
 * The signature vectors are the other half. Privacy does not sign the bytes it
 * sent; it signs a canonical re-rendering (keys sorted, no whitespace). That
 * makes verification a re-implementation of someone else's serializer, which
 * is exactly the kind of code that passes its own round-trip test and still
 * rejects every real delivery. So the vector below was computed with Node's
 * `crypto` against a hand-written canonical string, INDEPENDENTLY of the
 * implementation under test — a bug in our serializer cannot also move the
 * expected answer.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-privacy-adapter.test.ts
 */

import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import {
  createPrivacyCardProvider,
  isDegradedLimitPeriod,
  LIMIT_PERIOD_TO_PRIVACY_DURATION,
  normalizePrivacyTransaction,
  privacyStateToCardState,
  PRIVACY_CAPABILITIES,
  toPrivacyLimit,
} from "../lib/finance/cardProviders/privacy";
import {
  canonicalJsonStringify,
  signPrivacyWebhook,
  verifyPrivacyWebhookSignature,
  type PrivacyTransaction,
} from "../lib/finance/privacy";

const API_KEY = "privacy-test-api-key";

// ============================================================================
// fetch mock
// ============================================================================

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

let calls: RecordedCall[] = [];
let responses: Array<{ status: number; body: unknown }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  responses = [];
  process.env.PRIVACY_API_BASE_URL = "https://sandbox.privacy.com/v1";
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PRIVACY_API_BASE_URL;
});

/** Queue the next fetch response. */
function reply(body: unknown, status = 200) {
  responses.push({ status, body });
}

const adapter = () => createPrivacyCardProvider(API_KEY);

const OPEN_CARD = {
  token: "card_abc123",
  state: "OPEN",
  last_four: "4242",
  memo: "Youth Ministry · Togather",
};

// ============================================================================
// Capabilities
// ============================================================================

describe("capabilities", () => {
  test("declares the three things Privacy genuinely can't do", () => {
    // Each of these is read by a caller to decide what to promise a user, so a
    // silent flip is a lie told to a church rather than a failing assertion.
    expect(PRIVACY_CAPABILITIES.hardFundIsolation).toBe(false);
    expect(PRIVACY_CAPABILITIES.weeklyLimits).toBe(false);
    expect(PRIVACY_CAPABILITIES.cardCloseReversible).toBe(false);
  });

  test("freeze is reversible, close is not — the pair the UI copy hangs on", () => {
    expect(PRIVACY_CAPABILITIES.cardFreezeReversible).toBe(true);
    expect(PRIVACY_CAPABILITIES.cardCloseReversible).toBe(false);
  });

  test("no card-per-month cap is claimed, because the tier isn't readable", () => {
    expect(PRIVACY_CAPABILITIES.maxCardsPerMonth).toBeNull();
  });
});

// ============================================================================
// Limits
// ============================================================================

describe("limit mapping", () => {
  test("charge -> TRANSACTION, month -> MONTHLY", () => {
    expect(LIMIT_PERIOD_TO_PRIVACY_DURATION.charge).toBe("TRANSACTION");
    expect(LIMIT_PERIOD_TO_PRIVACY_DURATION.month).toBe("MONTHLY");
  });

  test("week -> MONTHLY at the SAME number, never scaled up", () => {
    // The whole point. Scaling $100/week to ~$433/month would let a card spend
    // a month's budget in one week — strictly more permissive than what the
    // finance admin asked for, which is the direction we refuse to fail in.
    expect(toPrivacyLimit({ limitCents: 10_000, period: "week" })).toEqual({
      spend_limit: 10_000,
      spend_limit_duration: "MONTHLY",
    });
    expect(isDegradedLimitPeriod("week")).toBe(true);
    expect(isDegradedLimitPeriod("month")).toBe(false);
    expect(isDegradedLimitPeriod("charge")).toBe(false);
  });

  test("no limit is stated EXPLICITLY, not omitted", () => {
    // Omitting the fields on a PATCH leaves whatever the card already had —
    // a silent no-op on the one path where silence is most expensive.
    const result = toPrivacyLimit(null);
    expect(result).toEqual({ spend_limit: 0, spend_limit_duration: "FOREVER" });
    expect(Object.keys(result).sort()).toEqual([
      "spend_limit",
      "spend_limit_duration",
    ]);
  });
});

// ============================================================================
// createCard
// ============================================================================

describe("createCard", () => {
  test("posts an UNLOCKED, OPEN card with the limit applied at creation", async () => {
    reply(OPEN_CARD);
    const card = await adapter().createCard({
      fundAccountRef: "ignored_by_privacy",
      description: "Youth Ministry · Togather",
      idempotencyKey: "finance:card:abc",
      limit: { limitCents: 25_000, period: "month" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sandbox.privacy.com/v1/cards");
    expect(calls[0].method).toBe("POST");
    // `api-key <key>`, NOT `Bearer` — Privacy's own scheme. Getting this wrong
    // produces a 401 that reads like a bad key.
    expect(calls[0].headers.Authorization).toBe(`api-key ${API_KEY}`);
    expect(calls[0].body).toEqual({
      type: "UNLOCKED",
      memo: "Youth Ministry · Togather",
      state: "OPEN",
      spend_limit: 25_000,
      spend_limit_duration: "MONTHLY",
    });

    // The card id is `token`. Reading `card_token` off a card response — the
    // name used everywhere ELSE in their API — gets you undefined.
    expect(card.providerCardId).toBe("card_abc123");
    expect(card.last4).toBe("4242");
    expect(card.state).toBe("active");
    expect(card.providerStatus).toBe("OPEN");
  });

  test("the fund account ref is ignored — there is no per-fund money at Privacy", async () => {
    reply(OPEN_CARD);
    await adapter().createCard({
      fundAccountRef: "increase_account_should_not_leak",
      description: "General · Togather",
      idempotencyKey: "k",
      limit: null,
    });
    expect(JSON.stringify(calls[0].body)).not.toContain("increase_account");
  });

  test("a refusal is re-framed so a finance admin knows where to look", async () => {
    // Privacy's own error says nothing about account tiers, and UNLOCKED
    // availability is account-dependent. A bare "400 Bad Request" in front of
    // a church admin sends them nowhere.
    reply({ message: "invalid card type" }, 400);
    await expect(
      adapter().createCard({
        fundAccountRef: "",
        description: "d",
        idempotencyKey: "k",
        limit: null,
      }),
    ).rejects.toThrow(/UNLOCKED/);
  });

  test("an error never carries the API key", async () => {
    reply({ message: "nope" }, 401);
    await expect(
      adapter().createCard({
        fundAccountRef: "",
        description: "d",
        idempotencyKey: "k",
        limit: null,
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(API_KEY),
      }),
    );
  });
});

// ============================================================================
// setCardState / setSpendLimit
// ============================================================================

describe("setCardState", () => {
  test.each([
    ["active", "OPEN"],
    ["paused", "PAUSED"],
    ["closed", "CLOSED"],
  ] as const)("%s -> %s", async (state, expected) => {
    reply({ ...OPEN_CARD, state: expected });
    const card = await adapter().setCardState("card_abc123", state);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toBe(
      "https://sandbox.privacy.com/v1/cards/card_abc123",
    );
    expect(calls[0].body).toEqual({ state: expected });
    expect(card.providerStatus).toBe(expected);
  });

  test("closing is terminal: reopening a CLOSED card surfaces the refusal", async () => {
    reply({ ...OPEN_CARD, state: "CLOSED" });
    await adapter().setCardState("card_abc123", "closed");

    // Privacy: "setting a card to a CLOSED state is a final action that cannot
    // be undone." The adapter doesn't pretend otherwise — it sends the request
    // and lets the refusal through, so nothing downstream can believe a closed
    // card came back.
    reply({ message: "card is closed" }, 400);
    await expect(
      adapter().setCardState("card_abc123", "active"),
    ).rejects.toThrow(/failed \(400\)/);
  });
});

describe("setSpendLimit", () => {
  test("sends both limit fields, and only those", async () => {
    reply(OPEN_CARD);
    await adapter().setSpendLimit("card_abc123", {
      limitCents: 5_000,
      period: "week",
    });
    expect(calls[0].body).toEqual({
      spend_limit: 5_000,
      spend_limit_duration: "MONTHLY",
    });
  });

  test("clearing a limit sends 0/FOREVER rather than nothing", async () => {
    reply(OPEN_CARD);
    await adapter().setSpendLimit("card_abc123", null);
    expect(calls[0].body).toEqual({
      spend_limit: 0,
      spend_limit_duration: "FOREVER",
    });
  });
});

describe("privacyStateToCardState", () => {
  test.each([
    ["OPEN", "active"],
    ["PAUSED", "paused"],
    ["CLOSED", "closed"],
    ["PENDING_ACTIVATION", "pending"],
    ["PENDING_FULFILLMENT", "pending"],
  ] as const)("%s -> %s", (input, expected) => {
    expect(privacyStateToCardState(input)).toBe(expected);
  });

  test("an unknown state is `failed`, never optimistically `active`", () => {
    expect(privacyStateToCardState("SOMETHING_NEW")).toBe("failed");
  });
});

// ============================================================================
// Transaction normalization
// ============================================================================

function txn(overrides: Partial<PrivacyTransaction>): PrivacyTransaction {
  return {
    token: "txn_1",
    card_token: "card_abc123",
    amount: 1200,
    status: "SETTLED",
    settled_amount: 1200,
    created: "2026-08-01T12:00:00Z",
    merchant: { descriptor: "COFFEE CO" },
    ...overrides,
  } as PrivacyTransaction;
}

describe("normalizePrivacyTransaction", () => {
  test("a settled charge uses settled_amount, not the authorization", () => {
    // They differ on tips and partial captures, and settled_amount is what
    // actually moved.
    const result = normalizePrivacyTransaction(
      txn({ amount: 1200, settled_amount: 1440 }),
    );
    expect(result.amountCents).toBe(1440);
    expect(result.state).toBe("settled");
    expect(result.merchantName).toBe("COFFEE CO");
    expect(result.occurredAtMs).toBe(Date.parse("2026-08-01T12:00:00Z"));
  });

  test.each([
    ["PENDING", "pending"],
    ["SETTLING", "pending"],
    ["DECLINED", "declined"],
  ] as const)("%s -> %s", (status, expected) => {
    expect(normalizePrivacyTransaction(txn({ status })).state).toBe(expected);
  });

  test("VOIDED is `declined` — money never moved and never will", () => {
    // Not `pending`: pending means "still might". A voided hold left pending
    // is a phantom charge in every balance projection built on this feed.
    expect(normalizePrivacyTransaction(txn({ status: "VOIDED" })).state).toBe(
      "declined",
    );
  });

  test("BOUNCED stays a settled positive charge", () => {
    // The merchant was paid; the funding pull failing afterwards is between
    // the church and Privacy, not a fact about this expense.
    const result = normalizePrivacyTransaction(txn({ status: "BOUNCED" }));
    expect(result.state).toBe("settled");
    expect(result.amountCents).toBeGreaterThan(0);
  });

  test("a RETURN is settled with a NEGATIVE amount", () => {
    // ProviderTxn's stated convention: positive cents SPENT, a refund/credit
    // is negative. The recorder skips negatives for now (reversal isn't
    // built), but normalizing it correctly here means that lands without
    // touching this function.
    const result = normalizePrivacyTransaction(
      txn({
        status: "SETTLED",
        settled_amount: 1200,
        events: [{ type: "AUTHORIZATION" }, { type: "RETURN" }],
      }),
    );
    expect(result.amountCents).toBe(-1200);
    expect(result.state).toBe("settled");
  });

  test("a correction credit is negative too", () => {
    const result = normalizePrivacyTransaction(
      txn({ events: [{ type: "TRANSACTION_CORRECTION_CREDIT" }] }),
    );
    expect(result.amountCents).toBe(-1200);
  });

  test("an unknown status is `pending` — never book money on a status we don't understand", () => {
    expect(normalizePrivacyTransaction(txn({ status: "WAT" })).state).toBe(
      "pending",
    );
  });
});

// ============================================================================
// Canonical JSON + HMAC
// ============================================================================

describe("canonicalJsonStringify", () => {
  test("sorts object keys at EVERY level and emits no whitespace", () => {
    expect(
      canonicalJsonStringify({ b: 1, a: { z: 2, y: { q: 3, p: 4 } } }),
    ).toBe('{"a":{"y":{"p":4,"q":3},"z":2},"b":1}');
  });

  test("preserves ARRAY order — only object keys are sorted", () => {
    expect(canonicalJsonStringify({ e: [3, 1, 2] })).toBe('{"e":[3,1,2]}');
  });

  test("sorts objects nested inside arrays", () => {
    // The trap that makes `JSON.stringify(v, Object.keys(v).sort())` wrong:
    // the replacer-array form applies one key list to every nested object.
    expect(canonicalJsonStringify({ events: [{ b: 1, a: 2 }] })).toBe(
      '{"events":[{"a":2,"b":1}]}',
    );
  });

  test("key order in the INPUT cannot change the output", () => {
    const a = { token: "t", amount: 1, merchant: { mcc: "5812", city: "TX" } };
    const b = { merchant: { city: "TX", mcc: "5812" }, amount: 1, token: "t" };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });

  test("handles null and nested nulls without emitting `undefined`", () => {
    expect(canonicalJsonStringify({ a: null })).toBe('{"a":null}');
    expect(canonicalJsonStringify(null)).toBe("null");
  });
});

describe("X-Privacy-HMAC verification", () => {
  /**
   * Computed with Node's `crypto` over a hand-written canonical string, NOT
   * with the code under test:
   *
   *   crypto.createHmac("sha256", "privacy-test-api-key")
   *     .update('{"amount":1234,"card_token":"card_abc",...}')
   *     .digest("base64")
   *
   * If our serializer drifts by so much as a space, this fails.
   */
  const FIXTURE_PAYLOAD = {
    token: "txn_abc",
    card_token: "card_abc",
    amount: 1234,
    settled_amount: 1234,
    status: "SETTLED",
    result: "APPROVED",
    created: "2026-08-01T12:00:00Z",
    merchant: { descriptor: "COFFEE CO", mcc: "5812", city: "Austin" },
  };
  const FIXTURE_SIGNATURE = "3A7AUVhEbWxq7BUEhHyjdaNDxtrutttpwpr3NIE4ABY=";

  test("our signer reproduces the independently-computed vector", async () => {
    expect(await signPrivacyWebhook(FIXTURE_PAYLOAD, API_KEY)).toBe(
      FIXTURE_SIGNATURE,
    );
  });

  test("the correct signature verifies", async () => {
    expect(
      await verifyPrivacyWebhookSignature(
        FIXTURE_PAYLOAD,
        FIXTURE_SIGNATURE,
        API_KEY,
      ),
    ).toBe(true);
  });

  test("REORDERED keys still verify — the canonicalization is the point", async () => {
    const reordered = {
      merchant: { city: "Austin", mcc: "5812", descriptor: "COFFEE CO" },
      created: "2026-08-01T12:00:00Z",
      result: "APPROVED",
      status: "SETTLED",
      settled_amount: 1234,
      amount: 1234,
      card_token: "card_abc",
      token: "txn_abc",
    };
    expect(
      await verifyPrivacyWebhookSignature(
        reordered,
        FIXTURE_SIGNATURE,
        API_KEY,
      ),
    ).toBe(true);
  });

  test("a different key fails", async () => {
    expect(
      await verifyPrivacyWebhookSignature(
        FIXTURE_PAYLOAD,
        FIXTURE_SIGNATURE,
        "some-other-communitys-key",
      ),
    ).toBe(false);
  });

  test("a tampered AMOUNT fails", async () => {
    expect(
      await verifyPrivacyWebhookSignature(
        { ...FIXTURE_PAYLOAD, amount: 999_999 },
        FIXTURE_SIGNATURE,
        API_KEY,
      ),
    ).toBe(false);
  });

  test("a tampered nested field fails", async () => {
    expect(
      await verifyPrivacyWebhookSignature(
        {
          ...FIXTURE_PAYLOAD,
          merchant: { ...FIXTURE_PAYLOAD.merchant, descriptor: "EVIL CO" },
        },
        FIXTURE_SIGNATURE,
        API_KEY,
      ),
    ).toBe(false);
  });

  test("a missing or garbage signature header fails without throwing", async () => {
    expect(
      await verifyPrivacyWebhookSignature(FIXTURE_PAYLOAD, null, API_KEY),
    ).toBe(false);
    expect(
      await verifyPrivacyWebhookSignature(FIXTURE_PAYLOAD, "!!!", API_KEY),
    ).toBe(false);
  });

  test("the adapter verifies with ITS OWN community's key", async () => {
    expect(
      await adapter().verifyWebhook!(FIXTURE_PAYLOAD, FIXTURE_SIGNATURE),
    ).toBe(true);
    expect(
      await createPrivacyCardProvider("another-church-key").verifyWebhook!(
        FIXTURE_PAYLOAD,
        FIXTURE_SIGNATURE,
      ),
    ).toBe(false);
  });
});

// ============================================================================
// listTransactions — the cursor
// ============================================================================

function txnPage(
  rows: Array<{ token: string; created: string }>,
  totalPages: number,
) {
  return {
    data: rows.map((r) => ({
      token: r.token,
      card_token: "card_abc123",
      amount: 100,
      settled_amount: 100,
      status: "SETTLED",
      created: r.created,
      merchant: { descriptor: "SHOP" },
    })),
    page: 1,
    total_pages: totalPages,
  };
}

describe("listTransactions", () => {
  test("a first poll looks back a bounded window, not to the beginning of time", async () => {
    reply(txnPage([], 1));
    await adapter().listTransactions!(null);

    const begin = new URL(calls[0].url).searchParams.get("begin")!;
    const ageDays = (Date.now() - Date.parse(begin)) / 86_400_000;
    // A freshly connected account can hold years of the church's own
    // pre-Togather history, none of it ours to import.
    expect(ageDays).toBeGreaterThan(6.9);
    expect(ageDays).toBeLessThan(7.1);
  });

  test("resumes from the stored cursor and advances to the newest `created`", async () => {
    reply(
      txnPage(
        [
          { token: "t1", created: "2026-08-01T10:00:00Z" },
          { token: "t2", created: "2026-08-01T11:30:00Z" },
        ],
        1,
      ),
    );
    const page = await adapter().listTransactions!("2026-08-01T09:00:00Z");

    expect(new URL(calls[0].url).searchParams.get("begin")).toBe(
      "2026-08-01T09:00:00Z",
    );
    expect(page.transactions.map((t) => t.providerTxnId)).toEqual(["t1", "t2"]);
    expect(page.nextCursor).toBe("2026-08-01T11:30:00.000Z");
  });

  test("an empty pull leaves the cursor exactly where it was", async () => {
    // Never null: for a high-water-mark cursor, "caught up" and "forget where
    // you were" would be the same value, and losing this number silently
    // re-imports or silently skips.
    reply(txnPage([], 1));
    const page = await adapter().listTransactions!("2026-08-01T09:00:00Z");
    expect(page.nextCursor).toBe("2026-08-01T09:00:00Z");
  });

  test("walks every page and takes the newest across all of them", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      token: `p1_${i}`,
      created: "2026-08-01T10:00:00Z",
    }));
    reply(txnPage(full, 2));
    reply(txnPage([{ token: "p2_0", created: "2026-08-02T08:00:00Z" }], 2));

    const page = await adapter().listTransactions!("2026-08-01T00:00:00Z");
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).searchParams.get("page")).toBe("2");
    expect(page.transactions).toHaveLength(101);
    expect(page.nextCursor).toBe("2026-08-02T08:00:00.000Z");
  });

  test("a backlog past the page cap STALLS the cursor instead of skipping ahead", async () => {
    // The failure direction that matters: re-reading a window costs an
    // idempotent no-op per transaction and is visible to an operator; skipping
    // ahead loses a charge from a church's books and nobody notices for weeks.
    for (let i = 0; i < 25; i++) {
      reply(
        txnPage(
          Array.from({ length: 100 }, (_, j) => ({
            token: `p${i}_${j}`,
            created: "2026-08-02T08:00:00Z",
          })),
          99,
        ),
      );
    }
    const page = await adapter().listTransactions!("2026-08-01T00:00:00Z");
    expect(calls).toHaveLength(20); // PRIVACY_MAX_PAGES
    expect(page.transactions).toHaveLength(2000);
    expect(page.nextCursor).toBe("2026-08-01T00:00:00Z");
  });
});

// ============================================================================
// checkConnection
// ============================================================================

describe("checkConnection", () => {
  test("probes funding_sources — a read-only call that cannot move money", async () => {
    reply({ data: [{ token: "f1", nickname: "Operations Checking" }] });
    const result = await adapter().checkConnection!();
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(
      "https://sandbox.privacy.com/v1/funding_sources",
    );
    expect(result.accountLabel).toBe("Operations Checking");
  });

  test("falls back through account_name, then last four", async () => {
    reply({ data: [{ token: "f1", account_name: "FIRST BANK ••1234" }] });
    expect((await adapter().checkConnection!()).accountLabel).toBe(
      "FIRST BANK ••1234",
    );

    reply({ data: [{ token: "f1", last_four: "9876" }] });
    expect((await adapter().checkConnection!()).accountLabel).toBe(
      "Account ••9876",
    );
  });

  test("a valid key with no funding sources still connects, unlabelled", async () => {
    reply({ data: [] });
    expect((await adapter().checkConnection!()).accountLabel).toBeNull();
  });

  test("a bad key throws, so nothing gets stored", async () => {
    reply({ message: "Unauthorized" }, 401);
    await expect(adapter().checkConnection!()).rejects.toThrow(/401/);
  });
});
