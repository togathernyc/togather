/**
 * `getPayoutComposition` (lib/finance/stripeConnect.ts) — the Stripe
 * balance-transaction lookup that ADR-032 Phase-2 requirement 6 makes
 * allocation depend on.
 *
 * Lives in its own file because it mocks the `stripe` SDK itself, which the
 * rest of the finance suites deliberately never load. Everything asserted
 * here is about turning a payout's balance transactions into the per-charge
 * NET amounts allocation can actually fund: paging, netting reversals against
 * their charge, and the PaymentIntent mapping that connects a balance
 * transaction to a `donations` row.
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

/** A refund-type balance transaction. Its expanded `source` is a Refund,
 * which carries `payment_intent` just like a Charge does — and its `net` is
 * already negative. */
function refundTxn(id: string, paymentIntentId: string, net: number) {
  return {
    id,
    type: "refund",
    net,
    source: { id: `re_${id}`, payment_intent: paymentIntentId },
  };
}

async function composition(payoutId = "po_1") {
  const { getPayoutComposition } = await import("../lib/finance/stripeConnect");
  return await getPayoutComposition("acct_connected", payoutId);
}

/** The charges half, which is what allocation actually plans against. */
async function listNets(payoutId = "po_1") {
  return (await composition(payoutId)).charges;
}

describe("getPayoutComposition", () => {
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

  test("skips pure bookkeeping rows — Stripe's own fee and the payout leg are not donor money", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_1", 9_680),
        { id: "txn_fee", type: "stripe_fee", net: -50, source: null },
        { id: "txn_payout", type: "payout", net: -9_630, source: "po_abc" },
      ],
      has_more: false,
    });

    expect(await listNets()).toEqual([{ paymentIntentId: "pi_1", netCents: 9_680 }]);
  });

  test("THE P0: a refund is netted against its charge, never discarded — a fully refunded gift yields NO fundable charge", async () => {
    // $100 gift, refunded in full before the payout settled. Stripe pays out
    // the charge's net (9680) and takes the refund (10000) out of the same
    // payout. Dropping the refund row (as this used to) left 9680 looking
    // like a fundable gift, and the donation is still `pending` because
    // nothing about a refund used to touch allocationStatus — so real money
    // the donor already got back was transferred into a group's spendable
    // Increase Account.
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_refunded", 9_680),
        refundTxn("txn_2", "pi_refunded", -10_000),
        chargeTxn("txn_3", "pi_healthy", 4_825),
      ],
      has_more: false,
    });

    const result = await composition("po_refund");
    expect(result.charges).toEqual([
      { paymentIntentId: "pi_healthy", netCents: 4_825 },
    ]);
    expect(result.reversedPaymentIntentIds).toEqual(["pi_refunded"]);
    expect(result.unattributedReversalCents).toBe(0);
  });

  test("a PARTIAL refund reduces its charge's net rather than removing it", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_partial", 9_680),
        refundTxn("txn_2", "pi_partial", -3_000),
      ],
      has_more: false,
    });

    const result = await composition("po_partial_refund");
    expect(result.charges).toEqual([
      { paymentIntentId: "pi_partial", netCents: 6_680 },
    ]);
    expect(result.reversedPaymentIntentIds).toEqual([]);
  });

  test("a chargeback posts as an `adjustment` and nets out the same way", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_disputed", 9_680),
        {
          id: "txn_dispute",
          type: "adjustment",
          net: -11_500, // gift back plus Stripe's dispute fee
          source: { id: "dp_1", payment_intent: "pi_disputed" },
        },
      ],
      has_more: false,
    });

    const result = await composition("po_disputed");
    expect(result.charges).toEqual([]);
    expect(result.reversedPaymentIntentIds).toEqual(["pi_disputed"]);
  });

  test("a refund whose PaymentIntent can't be resolved is reported, not silently swallowed", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_1", 9_680),
        // Unexpanded source: we cannot tell which charge this reversed, so
        // the payout is short by 1000 cents we can't subtract from anything.
        { id: "txn_orphan", type: "refund", net: -1_000, source: "re_unexpanded" },
      ],
      has_more: false,
    });

    const result = await composition("po_orphan_refund");
    expect(result.charges).toEqual([{ paymentIntentId: "pi_1", netCents: 9_680 }]);
    expect(result.unattributedReversalCents).toBe(-1_000);
  });

  test("a failed refund puts the money back, so it nets positively", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_1", 9_680),
        refundTxn("txn_2", "pi_1", -9_680),
        {
          id: "txn_refund_failed",
          type: "refund_failure",
          net: 9_680,
          source: { id: "re_1", payment_intent: "pi_1" },
        },
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

  test("nets a charge and its refund across DIFFERENT pages", async () => {
    stubs.pages.push(
      { data: [chargeTxn("txn_1", "pi_split", 9_680)], has_more: true },
      { data: [refundTxn("txn_2", "pi_split", -10_000)], has_more: false },
    );

    const result = await composition("po_split_pages");
    expect(result.charges).toEqual([]);
    expect(result.reversedPaymentIntentIds).toEqual(["pi_split"]);
  });

  test("REFUSES to allocate on a truncated view rather than returning the prefix", async () => {
    // 100 pages that all still say has_more: the cap is hit while Stripe
    // insists there is more. Returning the prefix would look like a complete
    // payout, and every retry would read the same first 100 pages.
    for (let i = 0; i < 120; i++) {
      stubs.pages.push({
        data: [chargeTxn(`txn_${i}`, `pi_${i}`, 100)],
        has_more: true,
      });
    }

    await expect(composition("po_huge")).rejects.toThrow(
      /refusing to allocate on a truncated view/,
    );
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

  test("drops non-integer or non-positive charge nets — never allocates a fractional cent", async () => {
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
