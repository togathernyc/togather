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
import {
  requiresSpendLimit,
  supportsWeeklyLimits,
} from "../lib/finance/cardProviders";

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
    // A 204 must be constructed with a NULL body — `new Response("", {status:
    // 204})` throws in undici, which would make an empty-response test fail for
    // a reason that has nothing to do with the adapter. `body: null` on any
    // status is the other way to say "empty", which is what the client's
    // `if (!text) return null` branch actually keys on.
    const empty = status === 204 || body === null;
    return new Response(empty ? null : JSON.stringify(body), { status });
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

  test("the NAME-keyed gates cannot drift from the capabilities", () => {
    // `supportsWeeklyLimits` / `requiresSpendLimit` are keyed on the provider
    // NAME because the mutations that gate a limit have no credential to build
    // an adapter from. That duplication is the risk these two lines exist to
    // catch: a capability flipped here without the gate following it is a
    // promise the app then makes and the bank then breaks.
    expect(supportsWeeklyLimits("bill")).toBe(BILL_CAPABILITIES.weeklyLimits);
    expect(requiresSpendLimit("bill")).toBe(!BILL_CAPABILITIES.hardFundIsolation);
  });

  test("an UNCAPPED BILL card is refused, for the same reason as Privacy", () => {
    // BILL cards are a charge card against the org's shared credit line —
    // there is no per-fund pot at the bank, so an uncapped card draws the whole
    // budget and the card limit is the only boundary Togather controls.
    expect(requiresSpendLimit("bill")).toBe(true);
    // Increase is the contrast: a fund owns its Account, so the bank enforces
    // the boundary and "no limit" honestly means "up to this fund's balance".
    expect(requiresSpendLimit("increase")).toBe(false);
  });

  test("a WEEKLY BILL limit is refused rather than silently flattened", () => {
    // toBillCardLimit would map it to a non-recurring cap at the same number —
    // safe for the money, but the card screen still says "/ week" and the
    // cardholder learns the truth by being declined for three weeks.
    expect(supportsWeeklyLimits("bill")).toBe(false);
    expect(supportsWeeklyLimits("increase")).toBe(true);
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

  test("A LOOKUP THAT GAVE UP MID-LIST REFUSES rather than splitting history", async () => {
    // The pagination twin of the rename hazard, and the one case where creating
    // is NOT the recoverable direction: the fund's budget may be on page 11, and
    // a duplicate budget cannot be merged in BILL. So the walk that never
    // reached the end must not be allowed to conclude "no budget exists" — and
    // the loud "someone renamed it" log would misattribute the cause anyway.
    seedAccount();
    route("GET", "/v3/spend/budgets", () => ({
      body: {
        results: [{ uuid: "bgt_unrelated", name: "Some Other Fund · Togather" }],
        nextPage: "there-is-always-more",
      },
    }));

    await expect(
      findOrCreateBudget(client(), "Youth Ministry", limit),
    ).rejects.toThrow(/could not read all of your BILL budgets/i);
    expect(callsTo("POST", "/v3/spend/budgets")).toHaveLength(0);
  });

  test("a COMPLETE walk that finds nothing still creates — this is not a regression on the normal path", async () => {
    // The guard above must key on "did we reach the end", not on "were there
    // several pages". A church with two pages of budgets and no Togather one
    // still gets a budget created.
    seedAccount();
    let page = 0;
    route("GET", "/v3/spend/budgets", () => {
      page++;
      return page === 1
        ? { body: { results: [{ uuid: "bgt_a", name: "A · Togather" }], nextPage: "p2" } }
        : { body: { results: [{ uuid: "bgt_b", name: "B · Togather" }], nextPage: null } };
    });

    expect(await findOrCreateBudget(client(), "Youth Ministry", limit)).toBe(
      "bgt_new",
    );
    expect(callsTo("POST", "/v3/spend/budgets")).toHaveLength(1);
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

  test("a RETIRED BILL user is not a match, and says REACTIVATE not invite", async () => {
    // The distinction is the whole point. "Invite them in BILL" sent to an admin
    // whose cardholder is merely deactivated gets a SECOND BILL user created for
    // the same human — a duplicate identity at a bank, and a card issued against
    // the wrong one of them.
    seedAccount({
      users: [{ uuid: "usr_gone", email: "pastor@church.org", retired: true }],
    });
    const attempt = resolveBillUserByEmail(client(), "pastor@church.org");
    await expect(attempt).rejects.toThrow(/DEACTIVATED.*Reactivate them in BILL/s);
    await expect(attempt).rejects.toThrow(/don't invite them again/i);
    expect(callsTo("POST", "/v3/spend/users")).toHaveLength(0);
  });

  test("A DIRECTORY DEEPER THAN THE PAGE CAP is not reported as `no such user`", async () => {
    // We stopped looking; that is not the same fact as "they aren't there", and
    // conflating them tells the admin to invite someone who already exists.
    route("GET", "/v3/spend/users", () => ({
      body: {
        results: [{ uuid: "usr_x", email: "someone@else.org" }],
        nextPage: "there-is-always-more",
      },
    }));

    const attempt = resolveBillUserByEmail(client(), "pastor@church.org");
    await expect(attempt).rejects.toThrow(/could not read all of your BILL users/i);
    // Explicitly NOT the "they don't exist, go invite them" answer.
    await expect(attempt).rejects.not.toThrow(/No BILL user has the email/);
    expect(callsTo("POST", "/v3/spend/users")).toHaveLength(0);
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

  test("A MONTHLY CARD IS PATCHED TO RENEW — the create body has no recurrence", async () => {
    // `POST /v3/spend/cards` takes `limit` and `shareBudgetFunds` and nothing
    // about periods; only PATCH has `recurring`/`recurringLimit`. Without this
    // follow-up a "$500 a month" card spends $500 once and then stops forever —
    // and a dead card just looks like a decline, so nobody reports it as a bug.
    seedAccount();
    route("PATCH", "/v3/spend/cards/crd_new", () => ({
      body: { uuid: "crd_new", status: "ACTIVATED", lastFour: "4242" },
    }));

    await adapter().createCard(CREATE_INPUT);

    const [patched] = callsTo("PATCH", "/v3/spend/cards/crd_new");
    expect(patched.body).toEqual({
      recurring: true,
      // BOTH: this period's allowance and every future one, exactly as
      // setSpendLimit sends them.
      availableFunds: 500,
      recurringLimit: 500,
    });
  });

  test("a WEEK/CHARGE card is NOT made recurring — the flat cap is deliberate", async () => {
    // toBillCardLimit degrades these to a non-resetting cap on purpose
    // (stricter than asked, never looser). Making them recurring would hand the
    // cardholder four weeks of runway under a "/ week" label.
    seedAccount();
    await adapter().createCard({
      ...CREATE_INPUT,
      limit: { limitCents: 20_000, period: "charge" as const },
    });
    expect(callsTo("PATCH", "/v3/spend/cards/crd_new")).toHaveLength(0);
  });

  test("a FAILED recurrence PATCH warns but still returns the live card", async () => {
    // The card exists and is spendable this period. Throwing here would record
    // "failed" over a live card and orphan it at the bank — strictly worse than
    // a card that needs its limit re-saved.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedAccount();
    route("PATCH", "/v3/spend/cards/crd_new", () => ({
      status: 500,
      body: { message: "nope" },
    }));

    const card = await adapter().createCard(CREATE_INPUT);
    expect(card.providerCardId).toBe("crd_new");
    expect(warn.mock.calls.flat().join(" ")).toMatch(/spend \$500 once and then stop/);
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

  test("A NUMERIC-ISH `id` IS NOT ACCEPTED AS A UUID", async () => {
    // Every BILL write takes the prefixed uuid. A card recorded under the
    // numeric `id` would never match the `cardUuid` on a webhook, so its
    // settlements would route to nothing forever — with no error anywhere.
    // Refusing is loud; the fallback was silent.
    seedAccount();
    route("POST", "/v3/spend/cards", () => ({
      body: { id: "884422", status: "ACTIVATED", lastFour: "4242" },
    }));

    await expect(adapter().createCard(CREATE_INPUT)).rejects.toThrow(
      /returned no uuid/i,
    );
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

  test("a vendor error that ECHOES THE TOKEN is redacted before it is thrown", async () => {
    // That message ends up on a finance admin's screen via
    // recordCardProvisionFailed. A provider echoing the credential it just
    // rejected would put a live spending token somewhere we deliberately never
    // write one.
    seedAccount();
    route("POST", "/v3/spend/cards", () => ({
      status: 401,
      body: { message: `Token ${API_TOKEN} is not authorized` },
    }));

    await expect(adapter().createCard(CREATE_INPUT)).rejects.toThrow(
      /\[redacted\] is not authorized/,
    );
    await expect(adapter().createCard(CREATE_INPUT)).rejects.not.toThrow(
      new RegExp(API_TOKEN),
    );
  });

  test("the thrown error carries the STATUS the poll branches on", async () => {
    // 401/403 deactivates a connection; everything else retries next hour.
    // A bare Error here would silently stop revoked tokens from deactivating.
    route("GET", "/v3/spend/users/current", () => ({ status: 401, body: {} }));
    await expect(adapter().checkConnection!()).rejects.toMatchObject({
      status: 401,
    });

    routes = [];
    route("GET", "/v3/spend/users/current", () => ({ status: 429, body: {} }));
    await expect(adapter().checkConnection!()).rejects.toMatchObject({
      status: 429,
    });
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

  test("AN EMPTY 204 SUCCESS IS THE REQUESTED STATE, not `failed`", async () => {
    // The client treats an empty successful body as the success it is. An empty
    // card has no status, and an unknown status is `failed` — so without this,
    // a pause BILL really applied persists as a broken-looking card in Togather
    // while working perfectly at the bank.
    routes = [];
    route("POST", "/v3/spend/cards/crd_1/freeze", () => ({ status: 204, body: null }));
    route("POST", "/v3/spend/cards/crd_1/unfreeze", () => ({ status: 204, body: null }));

    const paused = await adapter().setCardState("crd_1", "paused");
    expect(paused).toEqual({
      providerCardId: "crd_1",
      state: "paused",
      // BILL said no word, so we invent none for the field whose whole contract
      // is to carry the vendor's word unedited.
      providerStatus: "",
    });

    const active = await adapter().setCardState("crd_1", "active");
    expect(active.state).toBe("active");
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

  test("closed is freeze + rename, and reports state `closed` over BILL's FROZEN", async () => {
    const card = await adapter().setCardState("crd_1", "closed");

    expect(callsTo("POST", "/v3/spend/cards/crd_1/freeze")).toHaveLength(1);
    const [renamed] = callsTo("PATCH", "/v3/spend/cards/crd_1");
    expect(renamed.body.name).toBe(`Youth Ministry — Supplies${BILL_CLOSED_SUFFIX}`);

    // Load-bearing: `state` is what cardStateToStoredStatus turns into
    // `cards.status`, and countLiveProviderCards decides "still spending?"
    // from that. `paused` here would store "disabled" — a live card — and a
    // church that closed every card could never disconnect BILL without --force.
    expect(card.state).toBe("closed");
    // But BILL's own word is carried through UNEDITED, because that is
    // literally what the card is at the bank and providerStatus's whole
    // contract is to be the vendor's string.
    expect(card.providerStatus).toBe("FROZEN");
  });

  test("a close whose RENAME fails still reports closed — the card is stopped", async () => {
    // Failing the whole close over cosmetics would leave a card that the bank
    // has stopped looking merely paused to us.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    route("PATCH", "/v3/spend/cards/crd_1", () => ({ status: 500, body: { message: "nope" } }));

    const card = await adapter().setCardState("crd_1", "closed");
    expect(card.state).toBe("closed");
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

  test("A BACKLOG PAST THE PAGE CAP STALLS the cursor and says so", async () => {
    // A stall is something an operator notices — `truncated` is what
    // pollOneConnection turns into a visible error. A silent skip is a hole in
    // a church's books that nobody notices for weeks. Everything fetched is
    // still returned and recorded.
    route("GET", "/v3/spend/transactions", () => ({
      body: { results: [CLEARED], nextPage: "always-more" },
    }));

    const page = await adapter().listTransactions!("2026-07-01T00:00:00.000Z");
    expect(page.nextCursor).toBe("2026-07-01T00:00:00.000Z");
    expect(page.truncated).toBe(true);
    expect(callsTo("GET", "/v3/spend/transactions")).toHaveLength(20);
  });

  test("a complete read is not truncated", async () => {
    route("GET", "/v3/spend/transactions", () => ({
      body: { results: [CLEARED], nextPage: null },
    }));
    const page = await adapter().listTransactions!("2026-08-01T00:00:00.000Z");
    expect(page.truncated).toBe(false);
  });

  test("THE CURSOR STOPS BELOW AN UNSETTLED AUTHORIZATION", async () => {
    // The invariant Privacy's adapter holds, for the same reason. An
    // AUTHORIZATION is one we deliberately did NOT record, and BILL turns it
    // into a CLEAR by updating the same uuid. Advancing past it relies on BILL
    // always bumping `updatedTime` on settlement — an unverified vendor claim,
    // and if it is ever false the settled charge is imported by nothing.
    route("GET", "/v3/spend/transactions", () => ({
      body: {
        results: [
          { ...CLEARED, uuid: "txr_old", updatedTime: "2026-08-01T09:00:00.000+00:00" },
          {
            ...CLEARED,
            uuid: "txr_pending",
            transactionType: "AUTHORIZATION",
            updatedTime: "2026-08-01T10:00:00.000+00:00",
          },
          { ...CLEARED, uuid: "txr_new", updatedTime: "2026-08-01T11:00:00.000+00:00" },
        ],
        nextPage: null,
      },
    }));

    const page = await adapter().listTransactions!("2026-08-01T00:00:00.000Z");
    // Everything read is still returned — the hold-back is about the CURSOR,
    // not about dropping work.
    expect(page.transactions).toHaveLength(3);
    // Stops below the pending row, not at the newest settled one.
    expect(page.nextCursor).toBe("2026-08-01T09:00:00.000Z");
  });

  test("a DECLINE is terminal and does not hold the cursor back", async () => {
    // Nothing further will happen to it, so passing it strands nothing.
    route("GET", "/v3/spend/transactions", () => ({
      body: {
        results: [
          {
            ...CLEARED,
            uuid: "txr_declined",
            transactionType: "DECLINE",
            updatedTime: "2026-08-01T09:00:00.000+00:00",
          },
          { ...CLEARED, uuid: "txr_new", updatedTime: "2026-08-01T11:00:00.000+00:00" },
        ],
        nextPage: null,
      },
    }));

    const page = await adapter().listTransactions!("2026-08-01T00:00:00.000Z");
    expect(page.nextCursor).toBe("2026-08-01T11:00:00.000Z");
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
