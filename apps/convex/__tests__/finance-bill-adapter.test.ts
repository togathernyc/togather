/**
 * BILL Spend & Expense adapter unit tests (ADR-033 Phase 2).
 *
 * Like finance-privacy-adapter.test.ts, `fetch` itself is the mock boundary
 * rather than the client module: the request BODY is the part a bank acts on,
 * so it is the part worth pinning, and mocking `lib/finance/bill` would let the
 * adapter and the client drift apart while every test stayed green.
 *
 * The mock is a tiny ROUTER (method + path prefix) rather than a response
 * queue, because a single `createCard` makes four calls in a fixed order and a
 * queue would make every test in this file a puzzle about call ordering rather
 * than an assertion about behaviour.
 *
 * Three things here are not "does the code run" tests and should not be
 * softened:
 * - the DOLLARS/CENTS boundary in both directions (BILL speaks dollars,
 *   Togather speaks cents, and `53.03 * 100` is not 5303 in IEEE754),
 * - the budget find-or-create including the documented RENAME HAZARD,
 * - the email->user resolution, whose no-match error is the sentence a finance
 *   admin has to act on.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-bill-adapter.test.ts
 */

import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import {
  BILL_CAPABILITIES,
  BILL_CLOSED_SUFFIX,
  billBudgetName,
  billStatusToCardState,
  createBillCardProvider,
  findOrCreateBudget,
  isDegradedBillLimitPeriod,
  normalizeBillTransaction,
  resolveBillUserByEmail,
  toBillCardLimit,
} from "../lib/finance/cardProviders/bill";
import {
  billClient,
  centsToDollars,
  dollarsToCents,
  exactUsdCents,
  type BillTransaction,
} from "../lib/finance/bill";

const API_TOKEN = "bill-test-api-token";
const BASE = "https://gateway.stage.bill.com/connect";

// ============================================================================
// fetch mock — a router, not a queue
// ============================================================================

interface RecordedCall {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

type Handler = (call: RecordedCall) => { status?: number; body?: unknown };

let calls: RecordedCall[] = [];
let routes: Array<{ method: string; path: string; handler: Handler }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  routes = [];
  process.env.BILL_API_BASE_URL = BASE;
  globalThis.fetch = vi.fn(async (url: any, init: any) => {
    const full = String(url);
    const path = full.slice(BASE.length).split("?")[0];
    const call: RecordedCall = {
      url: full,
      path,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    // MOST SPECIFIC route wins, then most recently registered — so
    // `/v3/spend/users/current` is not swallowed by `/v3/spend/users`, and a
    // test can still override a default a helper set up.
    const match = routes
      .map((route, index) => ({ route, index }))
      .filter(
        ({ route }) =>
          route.method === call.method && path.startsWith(route.path),
      )
      .sort(
        (a, b) =>
          b.route.path.length - a.route.path.length || b.index - a.index,
      )[0]?.route;
    if (!match) {
      return new Response(JSON.stringify({ error: `unrouted ${call.method} ${path}` }), {
        status: 500,
      });
    }
    const { status = 200, body = {} } = match.handler(call);
    return new Response(status === 204 ? "" : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.BILL_API_BASE_URL;
  vi.restoreAllMocks();
});

function route(method: string, path: string, handler: Handler) {
  routes.push({ method, path, handler });
}

/** Calls to a path, in order, for asserting what actually left the process. */
function callsTo(method: string, path: string) {
  return calls.filter((c) => c.method === method && c.path.startsWith(path));
}

/** The default happy-path account: one user, no budgets yet. */
function seedAccount(
  options: {
    users?: any[];
    budgets?: any[];
  } = {},
) {
  route("GET", "/v3/spend/users/current", () => ({
    body: { uuid: "usr_admin", email: "admin@church.org", companyName: "First Church" },
  }));
  route("GET", "/v3/spend/users", () => ({
    body: {
      results: options.users ?? [
        { uuid: "usr_admin", email: "admin@church.org" },
        { uuid: "usr_holder", email: "Pastor@Church.org" },
      ],
      nextPage: null,
    },
  }));
  route("GET", "/v3/spend/budgets", () => ({
    body: { results: options.budgets ?? [], nextPage: null },
  }));
  route("POST", "/v3/spend/budgets", (call) => ({
    body: { uuid: "bgt_new", name: call.body.name },
  }));
  route("POST", "/v3/spend/cards", (call) => ({
    body: {
      uuid: "crd_new",
      name: call.body.name,
      status: "ACTIVATED",
      lastFour: "4242",
      budgetUuid: call.body.budgetId,
      userUuid: call.body.userId,
    },
  }));
}

const adapter = () => createBillCardProvider(API_TOKEN);
const client = () => billClient(API_TOKEN);

const CREATE_INPUT = {
  fundAccountRef: "",
  fundName: "Youth Ministry",
  holderEmail: "pastor@church.org",
  description: "Youth Ministry — Supplies",
  idempotencyKey: "finance:card:abc",
  limit: { limitCents: 50_000, period: "month" as const },
};

// ============================================================================
// Capabilities
// ============================================================================

describe("capabilities", () => {
  test("declares what BILL genuinely can't do", () => {
    // Each is read by a caller to decide what to promise a church, so a silent
    // flip is a lie told to a user rather than a failing assertion.
    expect(BILL_CAPABILITIES.hardFundIsolation).toBe(false);
    expect(BILL_CAPABILITIES.weeklyLimits).toBe(false);
  });

  test("close is REVERSIBLE — the opposite of Privacy, and the UI copy depends on it", () => {
    // BILL has no close endpoint at all. "Closed" is freeze + rename, so
    // promising an irreversible destruction would be promising something the
    // adapter cannot perform.
    expect(BILL_CAPABILITIES.cardCloseReversible).toBe(true);
    expect(BILL_CAPABILITIES.cardFreezeReversible).toBe(true);
  });

  test("webhooks are partial and declines only arrive on the poll", () => {
    expect(BILL_CAPABILITIES.webhooks).toBe("partial");
    expect(BILL_CAPABILITIES.declineFeed).toBe("poll");
  });

  test("repayment is in-product — Togather can neither show nor reconcile it", () => {
    expect(BILL_CAPABILITIES.repaymentVisibility).toBe("in_product");
    expect(BILL_CAPABILITIES.maxCardsPerMonth).toBeNull();
  });
});

// ============================================================================
// Money
// ============================================================================

describe("dollars <-> cents", () => {
  test("$4.35 is 435 cents, not 434 — the reason this rounds", () => {
    // Not a hypothetical: 4.35 * 100 is 434.99999999999994 in IEEE754 and
    // 16.08 * 100 is 1607.9999999999998. A truncating conversion under-books a
    // cent on ordinary amounts, and nobody notices until a church reconciles a
    // statement by hand.
    expect(Math.trunc(4.35 * 100)).toBe(434);
    expect(dollarsToCents(4.35)).toBe(435);
    expect(dollarsToCents(16.08)).toBe(1608);
    expect(dollarsToCents(53.03)).toBe(5303);
    expect(dollarsToCents(-12.34)).toBe(-1234);
  });

  test("cents leave as two-decimal dollars", () => {
    expect(centsToDollars(50_000)).toBe(500);
    expect(centsToDollars(5303)).toBe(53.03);
  });

  test("the exact minor-unit string is preferred for USD at par", () => {
    expect(
      exactUsdCents({
        exchangeRate: 1.0,
        exponent: 2,
        originalCurrencyAmount: "5303",
        originalCurrencyCode: "USD",
      }),
    ).toBe(5303);
  });

  test("a FOREIGN charge's minor-unit string is refused", () => {
    // It is euros-worth of cents; the float `amount` is what the church was
    // actually billed, so using the string here would book the wrong money.
    expect(
      exactUsdCents({
        exchangeRate: 1.08,
        exponent: 2,
        originalCurrencyAmount: "5000",
        originalCurrencyCode: "EUR",
      }),
    ).toBeNull();
    expect(
      exactUsdCents({
        exchangeRate: 1.08,
        exponent: 2,
        originalCurrencyAmount: "5000",
        originalCurrencyCode: "USD",
      }),
    ).toBeNull();
    expect(exactUsdCents(undefined)).toBeNull();
  });
});

// ============================================================================
// Limits
// ============================================================================

describe("limit mapping", () => {
  test("a monthly limit is recurring, at the same number in dollars", () => {
    expect(toBillCardLimit({ limitCents: 50_000, period: "month" })).toEqual({
      limit: 500,
      shareBudgetFunds: false,
      recurring: true,
    });
  });

  test("week and charge degrade to a NON-recurring cap at the same number", () => {
    // Stricter than asked, never looser — the card stops after one window's
    // worth of spend rather than being handed four weeks of runway.
    expect(toBillCardLimit({ limitCents: 10_000, period: "week" })).toEqual({
      limit: 100,
      shareBudgetFunds: false,
      recurring: false,
    });
    expect(toBillCardLimit({ limitCents: 20_000, period: "charge" })).toEqual({
      limit: 200,
      shareBudgetFunds: false,
      recurring: false,
    });
    expect(isDegradedBillLimitPeriod("week")).toBe(true);
    expect(isDegradedBillLimitPeriod("charge")).toBe(true);
    expect(isDegradedBillLimitPeriod("month")).toBe(false);
  });

  test('"no limit" is stated explicitly as shareBudgetFunds, not by omission', () => {
    expect(toBillCardLimit(null)).toEqual({
      shareBudgetFunds: true,
      recurring: false,
    });
  });
});

// ============================================================================
// States
// ============================================================================

describe("status mapping", () => {
  test("BILL's words become ours", () => {
    expect(billStatusToCardState("ACTIVATED")).toBe("active");
    expect(billStatusToCardState("FROZEN")).toBe("paused");
    expect(billStatusToCardState("TERMINATED")).toBe("closed");
  });

  test("an UNKNOWN status is `failed`, never `active`", () => {
    // Guessing "active" is the dangerous direction — it would show a church a
    // live card we know nothing about.
    expect(billStatusToCardState("SOMETHING_NEW")).toBe("failed");
    expect(billStatusToCardState("")).toBe("failed");
  });
});

// ============================================================================
// Budget find-or-create — the mapping decision, and its hazard
// ============================================================================

describe("findOrCreateBudget", () => {
  const limit = { limitCents: 50_000, period: "month" as const };

  test("an existing budget with the exact name is REUSED, and nothing is created", () => {
    seedAccount({
      budgets: [
        { uuid: "bgt_other", name: "Building Fund · Togather" },
        { uuid: "bgt_youth", name: "Youth Ministry · Togather", limit: 1000 },
      ],
    });

    return findOrCreateBudget(client(), "Youth Ministry", limit).then((uuid) => {
      expect(uuid).toBe("bgt_youth");
      expect(callsTo("POST", "/v3/spend/budgets")).toHaveLength(0);
    });
  });

  test("matching is case- and whitespace-insensitive", async () => {
    // A church fixing the capitalization of a fund name must not silently get a
    // second budget for it.
    seedAccount({
      budgets: [{ uuid: "bgt_youth", name: "  youth ministry · Togather " }],
    });
    expect(await findOrCreateBudget(client(), "Youth Ministry", limit)).toBe(
      "bgt_youth",
    );
  });

  test("a RETIRED budget of the same name is skipped, not adopted", async () => {
    // Attaching a card to a dead container would fail later, further from the
    // cause. Creating a live one with the same name is the recoverable
    // direction.
    seedAccount({
      budgets: [
        { uuid: "bgt_dead", name: "Youth Ministry · Togather", retired: true },
      ],
    });
    expect(await findOrCreateBudget(client(), "Youth Ministry", limit)).toBe(
      "bgt_new",
    );
  });

  test("no budget means create one, owned by the connected admin, MONTHLY", async () => {
    seedAccount();
    expect(await findOrCreateBudget(client(), "Youth Ministry", limit)).toBe(
      "bgt_new",
    );

    const [created] = callsTo("POST", "/v3/spend/budgets");
    expect(created.body).toEqual({
      name: "Youth Ministry · Togather",
      owners: ["usr_admin"],
      // DOLLARS, seeded from the card being created — the only number we have.
      limit: 500,
      recurringLimit: 500,
      recurringInterval: "MONTHLY",
    });
  });

  test("THE RENAME HAZARD: a renamed budget silently splits history, loudly logged", async () => {
    // This is the documented cost of the no-schema mapping. A church that
    // renames "Youth Ministry · Togather" in BILL makes the lookup miss; we
    // create a second budget rather than fail. Nothing breaks and no money
    // moves wrongly — but that fund's history is now in two places, and this
    // log line is the ONLY signal support has.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    seedAccount({
      budgets: [{ uuid: "bgt_youth_old", name: "Youth Ministry (old) · Togather" }],
    });

    expect(await findOrCreateBudget(client(), "Youth Ministry", limit)).toBe(
      "bgt_new",
    );
    expect(callsTo("POST", "/v3/spend/budgets")).toHaveLength(1);
    expect(log.mock.calls.flat().join(" ")).toMatch(
      /created budget "Youth Ministry · Togather".*renamed/s,
    );
  });

  test("a budget too small for the new card WARNS but still issues", async () => {
    // The church owns that number in BILL. Failing here would block a
    // legitimate second card; the decline feed carries BILL's own reason if the
    // budget really is the binding constraint.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedAccount({
      budgets: [
        {
          uuid: "bgt_youth",
          name: "Youth Ministry · Togather",
          currentPeriod: { limit: 100 },
        },
      ],
    });

    expect(await findOrCreateBudget(client(), "Youth Ministry", limit)).toBe(
      "bgt_youth",
    );
    expect(warn.mock.calls.flat().join(" ")).toMatch(/allows \$100.*asks for \$500/);
  });

  test("the budget name is one definition, not an inline template", () => {
    expect(billBudgetName("Youth Ministry")).toBe("Youth Ministry · Togather");
    expect(billBudgetName("  Youth Ministry  ")).toBe("Youth Ministry · Togather");
  });
});

// ============================================================================
// Cardholder resolution
// ============================================================================

describe("resolveBillUserByEmail", () => {
  test("matches case-insensitively on email", async () => {
    seedAccount();
    expect(await resolveBillUserByEmail(client(), "PASTOR@church.org")).toBe(
      "usr_holder",
    );
  });

  test("walks pages", async () => {
    let page = 0;
    route("GET", "/v3/spend/users", () => {
      page++;
      return page === 1
        ? { body: { results: [{ uuid: "usr_a", email: "a@church.org" }], nextPage: "p2" } }
        : { body: { results: [{ uuid: "usr_b", email: "b@church.org" }], nextPage: null } };
    });
    expect(await resolveBillUserByEmail(client(), "b@church.org")).toBe("usr_b");
    expect(callsTo("GET", "/v3/spend/users")).toHaveLength(2);
  });

  test("a RETIRED BILL user is not a match", async () => {
    seedAccount({
      users: [{ uuid: "usr_gone", email: "pastor@church.org", retired: true }],
    });
    await expect(
      resolveBillUserByEmail(client(), "pastor@church.org"),
    ).rejects.toThrow(/invite them in BILL/i);
  });

  test("NO MATCH names the exact next action, and never creates a user", async () => {
    // Creating a person at a bank on their behalf takes personal details
    // Togather has no business collecting from a card-issuing flow.
    seedAccount({ users: [{ uuid: "usr_admin", email: "admin@church.org" }] });

    await expect(
      resolveBillUserByEmail(client(), "nobody@church.org"),
    ).rejects.toThrow(
      /No BILL user has the email nobody@church.org.*invite them in BILL Spend & Expense first/s,
    );
    expect(callsTo("POST", "/v3/spend/users")).toHaveLength(0);
  });

  test("a cardholder with no email fails on OUR side, naming our fix", async () => {
    seedAccount();
    await expect(resolveBillUserByEmail(client(), null)).rejects.toThrow(
      /no email address on their Togather profile/i,
    );
    // Not one wasted call at the vendor for a question we can answer ourselves.
    expect(calls).toHaveLength(0);
  });
});

// ============================================================================
// createCard
// ============================================================================

describe("createCard", () => {
  test("sends the card into the fund's budget with its OWN limit", async () => {
    seedAccount();
    const card = await adapter().createCard(CREATE_INPUT);

    const [created] = callsTo("POST", "/v3/spend/cards");
    expect(created.body).toEqual({
      name: "Youth Ministry — Supplies",
      userId: "usr_holder",
      budgetId: "bgt_new",
      // DOLLARS, and the card's own cap — Togather's enforcement lever.
      limit: 500,
      // Never true: sharing budget funds would let one card spend the whole
      // fund, which is exactly the control the finance admin thought they set.
      shareBudgetFunds: false,
    });
    expect(card).toEqual({
      providerCardId: "crd_new",
      last4: "4242",
      state: "active",
      providerStatus: "ACTIVATED",
    });
  });

  test("the token rides in an `apiToken` header, not Authorization", async () => {
    seedAccount();
    await adapter().createCard(CREATE_INPUT);
    expect(calls[0].headers.apiToken).toBe(API_TOKEN);
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  test("the HOLDER is resolved before any budget is created", async () => {
    // A missing BILL user is the one failure a finance admin can act on;
    // finding it first means a failed attempt leaves no orphan budget behind.
    seedAccount({ users: [{ uuid: "usr_admin", email: "admin@church.org" }] });

    await expect(adapter().createCard(CREATE_INPUT)).rejects.toThrow(
      /No BILL user has the email/,
    );
    expect(callsTo("POST", "/v3/spend/budgets")).toHaveLength(0);
    expect(callsTo("POST", "/v3/spend/cards")).toHaveLength(0);
  });

  test("a card with no uuid is refused rather than recorded", async () => {
    // A card row pointing at nothing could never be frozen, re-limited, or
    // reconciled — worse than a clean failure.
    seedAccount();
    route("POST", "/v3/spend/cards", () => ({ body: { status: "ACTIVATED" } }));

    await expect(adapter().createCard(CREATE_INPUT)).rejects.toThrow(
      /returned no uuid/i,
    );
  });

  test("BILL's error text reaches the finance admin verbatim", async () => {
    seedAccount();
    route("POST", "/v3/spend/cards", () => ({
      status: 400,
      body: { message: "Budget has insufficient funds" },
    }));

    await expect(adapter().createCard(CREATE_INPUT)).rejects.toThrow(
      /Budget has insufficient funds/,
    );
  });
});

// ============================================================================
// setCardState — freeze, unfreeze, and the pseudo-close
// ============================================================================

describe("setCardState", () => {
  beforeEach(() => {
    route("POST", "/v3/spend/cards/crd_1/freeze", () => ({
      body: { uuid: "crd_1", name: "Youth Ministry — Supplies", status: "FROZEN", lastFour: "4242" },
    }));
    route("POST", "/v3/spend/cards/crd_1/unfreeze", () => ({
      body: { uuid: "crd_1", name: "Youth Ministry — Supplies", status: "ACTIVATED", lastFour: "4242" },
    }));
    route("PATCH", "/v3/spend/cards/crd_1", (call) => ({
      body: { uuid: "crd_1", name: call.body.name, status: "FROZEN", lastFour: "4242" },
    }));
  });

  test("paused is a plain freeze", async () => {
    const card = await adapter().setCardState("crd_1", "paused");
    expect(callsTo("POST", "/v3/spend/cards/crd_1/freeze")).toHaveLength(1);
    expect(callsTo("PATCH", "/v3/spend/cards/crd_1")).toHaveLength(0);
    expect(card.state).toBe("paused");
    expect(card.providerStatus).toBe("FROZEN");
  });

  test("active is an unfreeze — reversible, unlike Privacy's close", async () => {
    const card = await adapter().setCardState("crd_1", "active");
    expect(callsTo("POST", "/v3/spend/cards/crd_1/unfreeze")).toHaveLength(1);
    expect(card.state).toBe("active");
  });

  test("closed is freeze + rename, and reports CLOSED rather than FROZEN", async () => {
    const card = await adapter().setCardState("crd_1", "closed");

    expect(callsTo("POST", "/v3/spend/cards/crd_1/freeze")).toHaveLength(1);
    const [renamed] = callsTo("PATCH", "/v3/spend/cards/crd_1");
    expect(renamed.body.name).toBe(`Youth Ministry — Supplies${BILL_CLOSED_SUFFIX}`);

    // Load-bearing: `cards.status` stores this string and
    // countLiveProviderCards decides "still spending?" from it. FROZEN here
    // would mean a church that closed every card could never disconnect BILL
    // without --force.
    expect(card.providerStatus).toBe("CLOSED");
    expect(card.state).toBe("closed");
  });

  test("a close whose RENAME fails still reports closed — the card is stopped", async () => {
    // Failing the whole close over cosmetics would leave a card that the bank
    // has stopped looking merely paused to us.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    route("PATCH", "/v3/spend/cards/crd_1", () => ({ status: 500, body: { message: "nope" } }));

    const card = await adapter().setCardState("crd_1", "closed");
    expect(card.providerStatus).toBe("CLOSED");
    expect(warn).toHaveBeenCalled();
  });

  test("closing an already-closed card does not stack suffixes", async () => {
    route("POST", "/v3/spend/cards/crd_1/freeze", () => ({
      body: { uuid: "crd_1", name: `Supplies${BILL_CLOSED_SUFFIX}`, status: "FROZEN" },
    }));
    await adapter().setCardState("crd_1", "closed");
    expect(callsTo("PATCH", "/v3/spend/cards/crd_1")).toHaveLength(0);
  });
});

// ============================================================================
// setSpendLimit
// ============================================================================

describe("setSpendLimit", () => {
  beforeEach(() => {
    route("PATCH", "/v3/spend/cards/crd_1", (call) => ({
      body: { uuid: "crd_1", status: "ACTIVATED", currentPeriod: { limit: call.body.availableFunds } },
    }));
  });

  test("sets BOTH the current period and every future one", async () => {
    // Sending only availableFunds would make a limit change silently a
    // one-period change.
    await adapter().setSpendLimit("crd_1", { limitCents: 25_000, period: "month" });
    expect(callsTo("PATCH", "/v3/spend/cards/crd_1")[0].body).toEqual({
      availableFunds: 250,
      recurringLimit: 250,
      shareBudgetFunds: false,
      recurring: true,
    });
  });

  test("removing a limit is stated explicitly, not by omitting fields", async () => {
    // Omission on a PATCH means "leave it alone" — the one path where silence
    // is most expensive.
    await adapter().setSpendLimit("crd_1", null);
    expect(callsTo("PATCH", "/v3/spend/cards/crd_1")[0].body).toEqual({
      shareBudgetFunds: true,
      recurring: false,
    });
  });
});

// ============================================================================
// Transactions
// ============================================================================

const CLEARED: BillTransaction = {
  uuid: "txr_1",
  cardUuid: "crd_1",
  amount: 53.03,
  merchantName: "Amazon",
  rawMerchantName: "AMZN Mktp US",
  transactionType: "CLEAR",
  occurredTime: "2026-08-01T12:00:00.000+00:00",
  updatedTime: "2026-08-01T12:05:00.000+00:00",
  complete: true,
  currencyData: {
    exchangeRate: 1.0,
    exponent: 2,
    originalCurrencyAmount: "5303",
    originalCurrencyCode: "USD",
  },
};

describe("normalizeBillTransaction", () => {
  test("a CLEAR is settled, at the EXACT cent", () => {
    expect(normalizeBillTransaction(CLEARED)).toEqual({
      providerTxnId: "txr_1",
      providerCardId: "crd_1",
      amountCents: 5303,
      merchantName: "Amazon",
      description: null,
      occurredAtMs: Date.parse("2026-08-01T12:00:00.000+00:00"),
      state: "settled",
    });
  });

  test("an AUTHORIZATION is pending — the SAME uuid clears later", () => {
    // Recording it would double-book the moment it clears, since BILL updates
    // the same object rather than sending a second one.
    const auth = { ...CLEARED, transactionType: "AUTHORIZATION", complete: false };
    expect(normalizeBillTransaction(auth).state).toBe("pending");
  });

  test("a DECLINE carries BILL's reason as the description", () => {
    const declined = {
      ...CLEARED,
      transactionType: "DECLINE",
      declineReason: "CVV is invalid.",
    };
    const txn = normalizeBillTransaction(declined);
    expect(txn.state).toBe("declined");
    expect(txn.description).toBe("CVV is invalid.");
  });

  test("a refund keeps its NEGATIVE sign rather than being abs()'d", () => {
    // ProviderTxn's convention, and what lets the recorder skip refunds loudly
    // instead of debiting the fund a second time for money coming back.
    const refund = {
      ...CLEARED,
      uuid: "txr_refund",
      amount: -53.03,
      currencyData: { ...CLEARED.currencyData!, originalCurrencyAmount: "-5303" },
    };
    expect(normalizeBillTransaction(refund).amountCents).toBe(-5303);
  });

  test("a FOREIGN charge falls back to the settled dollar amount", () => {
    const foreign = {
      ...CLEARED,
      amount: 54.11,
      currencyData: {
        exchangeRate: 1.08,
        exponent: 2,
        originalCurrencyAmount: "5010",
        originalCurrencyCode: "EUR",
      },
    };
    expect(normalizeBillTransaction(foreign).amountCents).toBe(5411);
  });

  test("an unknown transactionType is pending, never settled", () => {
    expect(normalizeBillTransaction({ ...CLEARED, transactionType: "OTHER" }).state).toBe(
      "pending",
    );
  });

  test("the merchant falls back to the raw descriptor before going null", () => {
    const raw = { ...CLEARED, merchantName: undefined };
    expect(normalizeBillTransaction(raw).merchantName).toBe("AMZN Mktp US");
  });
});

describe("listTransactions", () => {
  test("filters on updatedTime, sorts ascending, and advances the cursor", async () => {
    route("GET", "/v3/spend/transactions", () => ({
      body: {
        results: [
          CLEARED,
          { ...CLEARED, uuid: "txr_2", updatedTime: "2026-08-02T09:00:00.000+00:00" },
        ],
        nextPage: null,
      },
    }));

    const page = await adapter().listTransactions!("2026-08-01T00:00:00.000Z");

    const [call] = callsTo("GET", "/v3/spend/transactions");
    expect(call.url).toContain(
      `filters=${encodeURIComponent("updatedTime:gte:2026-08-01T00:00:00.000Z")}`,
    );
    expect(call.url).toContain(`sort=${encodeURIComponent("updatedTime:asc")}`);
    expect(page.transactions).toHaveLength(2);
    // updatedTime, not occurredTime: a purchase that authorized last week and
    // CLEARS today is updated today, and an occurredTime cursor would walk past it.
    expect(page.nextCursor).toBe("2026-08-02T09:00:00.000Z");
  });

  test("a first poll looks back 7 days rather than importing years of history", async () => {
    route("GET", "/v3/spend/transactions", () => ({ body: { results: [], nextPage: null } }));
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));

    await adapter().listTransactions!(null);
    expect(callsTo("GET", "/v3/spend/transactions")[0].url).toContain(
      encodeURIComponent("updatedTime:gte:2026-08-03T00:00:00.000Z"),
    );
    vi.useRealTimers();
  });

  test("A BACKLOG PAST THE PAGE CAP STALLS the cursor rather than skipping ahead", async () => {
    // A stall is something an operator notices. A skip is a hole in a church's
    // books that nobody notices for weeks. Everything fetched is still returned.
    route("GET", "/v3/spend/transactions", () => ({
      body: { results: [CLEARED], nextPage: "always-more" },
    }));

    const page = await adapter().listTransactions!("2026-07-01T00:00:00.000Z");
    expect(page.nextCursor).toBe("2026-07-01T00:00:00.000Z");
    expect(callsTo("GET", "/v3/spend/transactions")).toHaveLength(20);
  });

  test("rows with no uuid or no card are dropped, not half-recorded", async () => {
    route("GET", "/v3/spend/transactions", () => ({
      body: {
        results: [CLEARED, { ...CLEARED, uuid: undefined }, { ...CLEARED, cardUuid: undefined }],
        nextPage: null,
      },
    }));
    const page = await adapter().listTransactions!("2026-08-01T00:00:00.000Z");
    expect(page.transactions.map((t) => t.providerTxnId)).toEqual(["txr_1"]);
  });
});

describe("fetchTransaction — the fetch half of fetch-to-verify", () => {
  test("returns what the API says", async () => {
    route("GET", "/v3/spend/transactions/txr_1", () => ({ body: CLEARED }));
    const txn = await adapter().fetchTransaction!("txr_1");
    expect(txn).toMatchObject({ providerTxnId: "txr_1", amountCents: 5303 });
  });

  test("a 404 is an ANSWER (null), not a failure", async () => {
    // This is what a forged or stale notification looks like, and the route
    // writes nothing on it.
    route("GET", "/v3/spend/transactions/txr_fake", () => ({ status: 404, body: {} }));
    expect(await adapter().fetchTransaction!("txr_fake")).toBeNull();
  });

  test("a transaction with no uuid is refused — an empty idempotency key duplicates charges", async () => {
    route("GET", "/v3/spend/transactions/txr_1", () => ({
      body: { ...CLEARED, uuid: undefined },
    }));
    expect(await adapter().fetchTransaction!("txr_1")).toBeNull();
  });

  test("an auth failure THROWS rather than looking like `no such transaction`", async () => {
    route("GET", "/v3/spend/transactions/txr_1", () => ({ status: 401, body: {} }));
    await expect(adapter().fetchTransaction!("txr_1")).rejects.toThrow(/401/);
  });
});

// ============================================================================
// checkConnection
// ============================================================================

describe("checkConnection", () => {
  test("names the company so an admin knows WHICH BILL account they connected", async () => {
    seedAccount();
    expect(await adapter().checkConnection!()).toEqual({
      accountLabel: "First Church",
    });
    // Read-only: validating a token must never be able to move money.
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  test("falls back to the authenticated user's email", async () => {
    route("GET", "/v3/spend/users/current", () => ({
      body: { uuid: "usr_admin", email: "admin@church.org" },
    }));
    expect(await adapter().checkConnection!()).toEqual({
      accountLabel: "admin@church.org",
    });
  });

  test("a bad token surfaces BILL's own words", async () => {
    route("GET", "/v3/spend/users/current", () => ({
      status: 401,
      body: { message: "Invalid API token" },
    }));
    await expect(adapter().checkConnection!()).rejects.toThrow(/Invalid API token/);
  });
});

// ============================================================================
// registerWebhook
// ============================================================================

describe("registerWebhook", () => {
  test("subscribes the URL to spend.transaction.updated", async () => {
    route("POST", "/v3/subscriptions", () => ({ body: { id: "sub_1" } }));
    await adapter().registerWebhook!("https://example.convex.site/card-provider-webhook/bill");

    expect(callsTo("POST", "/v3/subscriptions")[0].body).toEqual({
      name: "Togather card transactions",
      status: { enabled: true },
      events: [{ type: "spend.transaction.updated", version: "1" }],
      notificationUrl: "https://example.convex.site/card-provider-webhook/bill",
    });
  });

  test("THROWS on failure — the caller decides that a failure is only a log", async () => {
    route("POST", "/v3/subscriptions", () => ({ status: 403, body: { message: "devKey required" } }));
    await expect(
      adapter().registerWebhook!("https://example.convex.site/card-provider-webhook/bill"),
    ).rejects.toThrow(/devKey required/);
  });
});
