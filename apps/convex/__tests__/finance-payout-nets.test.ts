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

/**
 * `payoutCents` is not decoration: a payout IS the sum of the nets Stripe
 * attributed to it (excluding the payout's own leg), and `getPayoutComposition`
 * refuses a composition that doesn't add up to it. Every case below therefore
 * states the arithmetic total of the rows it feeds in.
 */
async function composition(payoutId: string, payoutCents: number) {
  const { getPayoutComposition } = await import("../lib/finance/stripeConnect");
  return await getPayoutComposition("acct_connected", payoutId, payoutCents);
}

/** The charges half, which is what allocation actually plans against. */
async function listNets(payoutId: string, payoutCents: number) {
  return (await composition(payoutId, payoutCents)).charges;
}

describe("getPayoutComposition", () => {
  test("returns the NET per charge, keyed by PaymentIntent, scoped to the connected account", async () => {
    stubs.pages.push({
      data: [chargeTxn("txn_1", "pi_1", 9_680), chargeTxn("txn_2", "pi_2", 4_825)],
      has_more: false,
    });

    expect(await listNets("po_abc", 14_505)).toEqual([
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

    expect(await listNets("po_bookkeeping", 9_630)).toEqual([
      { paymentIntentId: "pi_1", netCents: 9_680 },
    ]);
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

    const result = await composition("po_refund", 4_505);
    expect(result.charges).toEqual([
      { paymentIntentId: "pi_healthy", netCents: 4_825 },
    ]);
    expect(result.reversedPaymentIntentIds).toEqual(["pi_refunded"]);
    expect(result.unattributedNetCents).toBe(0);
  });

  test("a PARTIAL refund reduces its charge's net rather than removing it", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_partial", 9_680),
        refundTxn("txn_2", "pi_partial", -3_000),
      ],
      has_more: false,
    });

    const result = await composition("po_partial_refund", 6_680);
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
        chargeTxn("txn_other", "pi_other", 20_000),
      ],
      has_more: false,
    });

    // 9680 - 11500 + 20000 = 18180.
    const result = await composition("po_disputed", 18_180);
    expect(result.charges).toEqual([{ paymentIntentId: "pi_other", netCents: 20_000 }]);
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

    const result = await composition("po_orphan_refund", 8_680);
    expect(result.charges).toEqual([{ paymentIntentId: "pi_1", netCents: 9_680 }]);
    expect(result.unattributedNetCents).toBe(-1_000);
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

    expect(await listNets("po_refund_failed", 9_680)).toEqual([
      { paymentIntentId: "pi_1", netCents: 9_680 },
    ]);
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

    expect(await listNets("po_ach", 49_600)).toEqual([
      { paymentIntentId: "pi_ach", netCents: 49_600 },
    ]);
  });

  test("pages until has_more is false, carrying starting_after", async () => {
    stubs.pages.push(
      { data: [chargeTxn("txn_1", "pi_1", 100)], has_more: true },
      { data: [chargeTxn("txn_2", "pi_2", 200)], has_more: false },
    );

    expect(await listNets("po_paged", 300)).toEqual([
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
      {
        data: [
          refundTxn("txn_2", "pi_split", -10_000),
          chargeTxn("txn_3", "pi_healthy", 10_000),
        ],
        has_more: false,
      },
    );

    // 9680 - 10000 + 10000 = 9680.
    const result = await composition("po_split_pages", 9_680);
    expect(result.charges).toEqual([
      { paymentIntentId: "pi_healthy", netCents: 10_000 },
    ]);
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

    await expect(composition("po_huge", 12_000)).rejects.toThrow(
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

    expect(await listNets("po_unmappable", 1_800)).toEqual([
      { paymentIntentId: "pi_ok", netCents: 700 },
    ]);
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

    expect(await listNets("po_expanded", 800)).toEqual([
      { paymentIntentId: "pi_expanded", netCents: 800 },
    ]);
  });

  test("drops zero and non-positive charge nets — only a gift that delivered something is fundable", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_2", "pi_zero", 0),
        // Nonsense from Stripe. Netted signed rather than dropped (dropping
        // it would put the payout total out of balance), which can only push
        // this PaymentIntent below zero and OUT of the fundable set.
        chargeTxn("txn_3", "pi_negative", -400),
        chargeTxn("txn_4", "pi_good", 400),
      ],
      has_more: false,
    });

    const result = await composition("po_nonsense", 0);
    expect(result.charges).toEqual([{ paymentIntentId: "pi_good", netCents: 400 }]);
    expect(result.reversedPaymentIntentIds).toEqual(["pi_negative"]);
  });

  test("REFUSES a fractional net rather than dropping the row and allocating the rest", async () => {
    stubs.pages.push({
      data: [chargeTxn("txn_1", "pi_float", 100.5), chargeTxn("txn_2", "pi_ok", 400)],
      has_more: false,
    });

    await expect(composition("po_float", 500)).rejects.toThrow(
      /non-integer net/,
    );
  });

  // ==========================================================================
  // P1-6: membership is decided by `payment_intent`, not by `type`
  // ==========================================================================

  test("THE MISS: `payment_reversal` — a real type the old allowlist omitted — nets against its payment", async () => {
    // Two $500 ACH gifts; the bank reverses one after Stripe had already
    // credited it. `payment_reversal` was not in the reversal allowlist (which
    // instead listed `payment_refund_failure`, a type Stripe does not emit),
    // so the reversed gift kept its full net and got FUNDED, while the
    // residual-budget check absorbed the shortfall by stranding the healthy
    // one — with leftoverCents at 0, so nothing alarmed.
    stubs.pages.push({
      data: [
        { id: "txn_a", type: "payment", net: 49_600, source: { id: "py_a", payment_intent: "pi_healthy" } },
        { id: "txn_b", type: "payment", net: 49_600, source: { id: "py_b", payment_intent: "pi_reversed" } },
        {
          id: "txn_rev",
          type: "payment_reversal",
          net: -49_600,
          source: { id: "pyr_b", payment_intent: "pi_reversed" },
        },
        { id: "txn_payout", type: "payout", net: -49_600, source: "po_rev" },
      ],
      has_more: false,
    });

    const result = await composition("po_rev", 49_600);
    expect(result.charges).toEqual([
      { paymentIntentId: "pi_healthy", netCents: 49_600 },
    ]);
    expect(result.reversedPaymentIntentIds).toEqual(["pi_reversed"]);
    expect(result.unattributedNetCents).toBe(0);
  });

  test("a type invented after this code was written still nets, because only `payment_intent` decides", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_1", 9_680),
        {
          id: "txn_future",
          type: "some_future_reversal_type_stripe_adds_in_2027",
          net: -9_680,
          source: { id: "xx_1", payment_intent: "pi_1" },
        },
        chargeTxn("txn_2", "pi_2", 4_825),
      ],
      has_more: false,
    });

    const result = await composition("po_future", 4_825);
    expect(result.charges).toEqual([{ paymentIntentId: "pi_2", netCents: 4_825 }]);
    expect(result.reversedPaymentIntentIds).toEqual(["pi_1"]);
  });

  test("REFUSES a composition whose nets don't add up to the payout — a partial read is not a payout", async () => {
    // Stripe attributes balance transactions asynchronously, so a query at
    // `payout.paid` can come back with only some of them. Allocating against
    // that view allocates against money that may not be there.
    stubs.pages.push({
      data: [chargeTxn("txn_1", "pi_1", 9_680)],
      has_more: false,
    });

    await expect(composition("po_partial_read", 19_360)).rejects.toThrow(
      /balance transactions net to 9680 cents but the payout is 19360/,
    );
  });

  test("the payout's own leg is excluded from the total rather than double-counted", async () => {
    stubs.pages.push({
      data: [
        chargeTxn("txn_1", "pi_1", 9_680),
        { id: "txn_payout", type: "payout", net: -9_680, source: "po_leg" },
      ],
      has_more: false,
    });

    expect(await listNets("po_leg", 9_680)).toEqual([
      { paymentIntentId: "pi_1", netCents: 9_680 },
    ]);
  });
});
