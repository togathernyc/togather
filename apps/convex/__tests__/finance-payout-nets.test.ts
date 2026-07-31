/**
 * `listPayoutChargeNets` (lib/finance/stripeConnect.ts) — the Stripe
 * balance-transaction lookup that ADR-032 Phase-2 requirement 6 makes
 * allocation depend on.
 *
 * Lives in its own file because it mocks the `stripe` SDK itself, which the
 * rest of the finance suites deliberately never load. Everything asserted
 * here is about turning a payout's balance transactions into the per-charge
 * NET amounts allocation can actually fund: paging, non-charge rows, and the
 * PaymentIntent mapping that connects a balance transaction to a `donations`
 * row.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-payout-nets.test.ts
 */

import { expect, test, describe, vi, beforeEach } from "vitest";

const stubs = vi.hoisted(() => ({
  /** Pages returned in order by balanceTransactions.list. */
  pages: [] as Array<{ data: unknown[]; has_more: boolean }>,
  /** Every list() call's params, for asserting paging + connected account. */
  calls: [] as Array<{ params: Record<string, unknown>; options: unknown }>,
}));

vi.mock("stripe", () => {
  class FakeStripe {
    balanceTransactions = {
      list: async (params: Record<string, unknown>, options: unknown) => {
        stubs.calls.push({ params, options });
        return (
          stubs.pages[stubs.calls.length - 1] ?? { data: [], has_more: false }
        );
      },
    };
  }
  return { default: FakeStripe };
});

process.env.STRIPE_SECRET_KEY = "sk_test_payout_nets";

beforeEach(() => {
  stubs.pages.length = 0;
  stubs.calls.length = 0;
});

/** A charge-type balance transaction with `source` expanded, as Stripe
 * returns it when `expand: ["data.source"]` is sent. */
function chargeTxn(id: string, paymentIntentId: string, net: number) {
  return {
    id,
    type: "charge",
    net,
    source: { id: `ch_${id}`, payment_intent: paymentIntentId },
  };
}

async function listNets(payoutId = "po_1") {
  const { listPayoutChargeNets } = await import("../lib/finance/stripeConnect");
  return await listPayoutChargeNets("acct_connected", payoutId);
}

describe("listPayoutChargeNets", () => {
  test("returns the NET per charge, keyed by PaymentIntent, scoped to the connected account", async () => {
    stubs.pages.push({
      data: [chargeTxn("txn_1", "pi_1", 9_680), chargeTxn("txn_2", "pi_2", 4_825)],
      has_more: false,
    });

    expect(await listNets("po_abc")).toEqual([
      { paymentIntentId: "pi_1", netCents: 9_680 },
      { paymentIntentId: "pi_2", netCents: 4_825 },
    ]);

    expect(stubs.calls).toHaveLength(1);
    expect(stubs.calls[0].params).toMatchObject({
      payout: "po_abc",
      expand: ["data.source"],
    });
    // Payouts and their charges live on the CONNECTED account, not the
    // platform account.
    expect(stubs.calls[0].options).toEqual({ stripeAccount: "acct_connected" });
  });

  test("skips fee/payout/refund rows — they are the payout's leftover, not donor money", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_1", 9_680),
        { id: "txn_fee", type: "stripe_fee", net: -50, source: null },
        { id: "txn_payout", type: "payout", net: -9_630, source: "po_abc" },
        { id: "txn_refund", type: "refund", net: -1_000, source: { id: "re_1" } },
      ],
      has_more: false,
    });

    expect(await listNets()).toEqual([{ paymentIntentId: "pi_1", netCents: 9_680 }]);
  });

  test("includes ACH-debit charges, which Stripe types as 'payment'", async () => {
    stubs.pages.push({
      data: [
        {
          id: "txn_ach",
          type: "payment",
          net: 49_600,
          source: { id: "py_1", payment_intent: "pi_ach" },
        },
      ],
      has_more: false,
    });

    expect(await listNets()).toEqual([
      { paymentIntentId: "pi_ach", netCents: 49_600 },
    ]);
  });

  test("pages until has_more is false, carrying starting_after", async () => {
    stubs.pages.push(
      { data: [chargeTxn("txn_1", "pi_1", 100)], has_more: true },
      { data: [chargeTxn("txn_2", "pi_2", 200)], has_more: false },
    );

    expect(await listNets()).toEqual([
      { paymentIntentId: "pi_1", netCents: 100 },
      { paymentIntentId: "pi_2", netCents: 200 },
    ]);
    expect(stubs.calls).toHaveLength(2);
    expect(stubs.calls[0].params.starting_after).toBeUndefined();
    expect(stubs.calls[1].params.starting_after).toBe("txn_1");
  });

  test("drops a charge with no resolvable payment_intent rather than guessing", async () => {
    stubs.pages.push({
      data: [
        // Unexpanded source: just the charge id, no way back to a donation.
        { id: "txn_1", type: "charge", net: 500, source: "ch_unexpanded" },
        { id: "txn_2", type: "charge", net: 600, source: { id: "ch_2" } },
        chargeTxn("txn_3", "pi_ok", 700),
      ],
      has_more: false,
    });

    expect(await listNets()).toEqual([{ paymentIntentId: "pi_ok", netCents: 700 }]);
  });

  test("accepts an expanded payment_intent object, not just an id", async () => {
    stubs.pages.push({
      data: [
        {
          id: "txn_1",
          type: "charge",
          net: 800,
          source: { id: "ch_1", payment_intent: { id: "pi_expanded" } },
        },
      ],
      has_more: false,
    });

    expect(await listNets()).toEqual([
      { paymentIntentId: "pi_expanded", netCents: 800 },
    ]);
  });

  test("drops non-integer or non-positive nets — never allocates a fractional cent", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_float", 100.5),
        chargeTxn("txn_2", "pi_zero", 0),
        chargeTxn("txn_3", "pi_negative", -400),
        chargeTxn("txn_4", "pi_good", 400),
      ],
      has_more: false,
    });

    expect(await listNets()).toEqual([{ paymentIntentId: "pi_good", netCents: 400 }]);
  });
});
