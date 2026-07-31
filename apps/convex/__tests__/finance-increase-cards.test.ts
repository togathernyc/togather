/**
 * The card request bodies Togather actually puts on the wire to Increase.
 *
 * Why this file exists separately from finance-cards.test.ts: that suite
 * mocks the whole `lib/finance/increase` module, so its limit assertions only
 * ever check the WRAPPER's arguments (`{ interval, settlementAmountCents }`)
 * and `buildAuthorizationControls` — the function that decides what the bank
 * is actually told — never runs. A typo in it (`spendingLimits` for
 * `spending_limits`, a missing `usage.category`, one level of nesting wrong)
 * would leave CI green, ship a card the bank caps at nothing, and leave the
 * app telling a treasurer "the bank declines anything over this limit."
 *
 * So these tests stub the TRANSPORT (`fetch`) and let the real builder run,
 * asserting the literal JSON body. The shape is checked against Increase's
 * published OpenAPI document (https://increase.com/openapi.json,
 * `create_a_card_parameters` / `update_a_card_parameters`):
 * `authorization_controls.usage.category` is required and enum
 * `single_use | multi_use`; `usage.multi_use` is required iff the category is
 * `multi_use`; each `spending_limits[]` entry requires exactly `interval` and
 * `settlement_amount`; `settlement_amount` is `integer, minimum: 0` in the
 * currency's MINOR unit (cents for USD).
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-increase-cards.test.ts
 */

import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { createCard, updateCardSpendingLimit } from "../lib/finance/increase";

process.env.INCREASE_API_KEY = "test-increase-key";
process.env.INCREASE_API_BASE_URL = "https://sandbox.increase.com";

/** Captured `fetch` calls, so a test can read the exact URL/method/body sent. */
interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

let requests: CapturedRequest[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({
        url,
        method: init.method as string,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return new Response(
        JSON.stringify({ id: "card_abc123", status: "active", last4: "4242" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /cards — authorization_controls on the wire", () => {
  test("a weekly limit is sent as multi_use spending_limits in integer cents", async () => {
    await createCard("account_123", "Fund — Groceries", "finance:card:abc", {
      interval: "per_week",
      settlementAmountCents: 25_000,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://sandbox.increase.com/cards");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers["Idempotency-Key"]).toBe("finance:card:abc");

    // The exact body. Written out in full rather than matched field-by-field
    // so a renamed or re-nested key fails here instead of at the bank.
    expect(requests[0].body).toEqual({
      account_id: "account_123",
      description: "Fund — Groceries",
      authorization_controls: {
        usage: {
          category: "multi_use",
          multi_use: {
            spending_limits: [{ interval: "per_week", settlement_amount: 25_000 }],
          },
        },
      },
    });

    // And the serialized form, byte for byte — key order included, since the
    // literal string is what a reviewer can diff against Increase's spec.
    expect(JSON.stringify(requests[0].body.authorization_controls)).toBe(
      '{"usage":{"category":"multi_use","multi_use":{"spending_limits":[{"interval":"per_week","settlement_amount":25000}]}}}',
    );
  });

  test("a card with no limit still sends multi_use with an EMPTY spending_limits array", async () => {
    await createCard("account_123", "Fund — Uncapped", "finance:card:def", null);

    expect(requests[0].body.authorization_controls).toEqual({
      usage: { category: "multi_use", multi_use: { spending_limits: [] } },
    });
  });

  test.each([
    ["per_month", 500_00],
    ["per_transaction", 40_00],
  ] as const)("%s limits map straight through", async (interval, cents) => {
    await createCard("account_123", "Fund — Card", "finance:card:ghi", {
      interval,
      settlementAmountCents: cents,
    });

    expect(
      requests[0].body.authorization_controls.usage.multi_use.spending_limits,
    ).toEqual([{ interval, settlement_amount: cents }]);
  });
});

describe("PATCH /cards/{id} — changing and clearing a limit", () => {
  test("a limit change PATCHes the same authorization_controls shape", async () => {
    await updateCardSpendingLimit("card_abc123", {
      interval: "per_month",
      settlementAmountCents: 50_000,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://sandbox.increase.com/cards/card_abc123");
    expect(requests[0].method).toBe("PATCH");
    expect(requests[0].body).toEqual({
      authorization_controls: {
        usage: {
          category: "multi_use",
          multi_use: {
            spending_limits: [{ interval: "per_month", settlement_amount: 50_000 }],
          },
        },
      },
    });
  });

  test("clearing sends the empty array, never an omitted field", async () => {
    await updateCardSpendingLimit("card_abc123", null);

    expect(JSON.stringify(requests[0].body)).toBe(
      '{"authorization_controls":{"usage":{"category":"multi_use","multi_use":{"spending_limits":[]}}}}',
    );
    // The failure this guards: omitting `authorization_controls` (or its
    // spending_limits) would leave the card's OLD cap in place at the bank
    // while the app cleared its mirror — a silent no-op on the one path where
    // silence is most expensive.
    expect(requests[0].body.authorization_controls).toBeDefined();
  });

  test("a non-2xx from Increase throws rather than being mistaken for success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad interval", { status: 400 })),
    );

    await expect(
      updateCardSpendingLimit("card_abc123", {
        interval: "per_week",
        settlementAmountCents: 1,
      }),
    ).rejects.toThrow(/failed \(400\)/);
  });
});
