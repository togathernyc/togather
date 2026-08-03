/**
 * Allocation + nightly reconcile jobs (ADR-032 §3, §6 — Phase 2 background
 * plumbing, built here ahead of Increase going live so the seam is ready).
 *
 * Two background jobs live here:
 *
 *   1. ALLOCATION — Stripe pays a community out in bulk (T+2) to its
 *      Increase receiving Account. `runAllocation` asks Stripe which charges
 *      composed that payout and at what NET (gross minus the processing fee
 *      Stripe already took, minus any refund of the same charge that settled
 *      in the same payout), `planAllocations` binds each of those charges'
 *      donations to the payout, and each bound donation's net is then moved
 *      from the receiving Account to its fund's own Account via Increase
 *      (every fund, general included), flipping `donations.allocationStatus`.
 *
 *      NET, not gross (ADR-032 Phase-2 requirement 6): a payout physically
 *      delivers the sum of its charges' NETS. Matching donations by their
 *      gross total — what the donor was charged, and what the ledger was
 *      credited — can never fit inside the payout that carries them, which
 *      previously stalled allocation permanently on the very common
 *      one-donation-per-payout case. Stripe's balance transactions for the
 *      payout also tell us exactly WHICH donations it contained, so
 *      membership is now read, not inferred from a running total.
 *
 *   2. NIGHTLY RECONCILE — per fund, compares our ledger's cached balance
 *      against the Increase Account balance (adjusted for donations still
 *      awaiting allocation) and alarms on drift. This is the invariant
 *      `checkInvariant` (lib/finance/ledger.ts) exists to check:
 *
 *        funds.balanceCents === Increase Account balance + pendingAllocationCents
 *
 * DESIGN DECISION — allocation posts no allocation CREDIT, only the fee
 * DEBIT: `recordDonationSucceeded` (functions/finance/giving.ts) already
 * credits the fund's ledger balance in full the moment the donation succeeds
 * — that credit represents money Togather has *attributed* to the fund, not
 * money physically sitting in the fund's Increase Account yet (it's still in
 * the Stripe→receiving-Account pipeline). Allocation is purely a BANK-side
 * move of already-attributed money from the receiving Account to the fund's
 * Account; crediting the ledger again would double-count the fund's balance.
 * So allocation (a) flips `donations.allocationStatus` to "allocated",
 * (b) writes a `financeAuditEvents` row ("donation.allocated") carrying the
 * Increase transfer id, and (c) posts ONE balance-affecting entry: a "fee"
 * debit for `gross - net`, the processing fee Stripe kept.
 *
 * That fee debit is what makes the ADR-032 invariant satisfiable at all. The
 * donation credit is gross; the bank will only ever hold net; without
 * realising the fee the ledger permanently overstates every fund by its
 * Stripe fees. It is posted when the transfer LANDS (not when the payout is
 * matched) on purpose — that timing is what turns a stalled allocation into
 * observable drift instead of a silently self-consistent lie:
 *
 *   in the pipeline, not paid out : ledger gross, bank 0,   pending gross → ok
 *   matched to a payout, transfer stalled
 *                                 : ledger gross, bank 0,   pending NET   → DRIFT = fee
 *   allocated                     : ledger net,   bank net, pending 0     → ok
 *
 * (`pendingAllocationCents` switches from gross to net the moment a donation
 * is bound to a payout — see `allocationAmountCents` — because from that
 * point on, net is all that will ever arrive. Every selection path values a
 * donation through that same helper, so what the planner asks Increase to
 * transfer and what the nightly reconcile calls "pending" can never be
 * different numbers.)
 *
 * REFUNDS AND DISPUTES — the fourth and fifth states, and the one place the
 * model is deliberately incomplete:
 *
 *   refunded before its payout   : ledger 0,   bank 0,   pending 0     → ok
 *   refunded in part, unpaid-out : ledger gross−refund, bank 0,
 *                                  pending gross−refund               → ok
 *   refunded in part after a payout bound it (but before the transfer):
 *                                  ledger gross−refund, bank 0,
 *                                  pending min(net, gross−refund)     → ok
 *   …and once that transfer lands : ledger gross−refund,
 *                                  bank min(net, gross−refund),
 *                                  pending 0                          → ok
 *   refunded after allocation    : ledger gross−fee−refund (+fee back
 *                                  once refunds exceed the net),
 *                                  bank NET, pending 0   → DRIFT = the money
 *                                  still sitting in the group's Account
 *
 * The first two close because `recordDonationRefund` (giving.ts) stamps
 * `donations.refundedCents` and flips a fully-refunded pending gift to the
 * terminal `"refunded"` status, so it leaves the pending sum at the same
 * moment its ledger credit is reversed — and because
 * `getPayoutComposition` nets refund rows against their charge, so a payout
 * carrying both delivers nothing for that PaymentIntent and nothing is
 * transferred.
 *
 * The third does NOT close, deliberately: Stripe takes the refund out of the
 * community's Stripe balance (reducing a LATER payout), while the money for
 * the original gift is already sitting in the group's own Increase Account.
 * Pulling it back is a bank-side clawback transfer that ADR-032 has not
 * designed yet, so the nightly reconcile alarms on exactly that amount until
 * it is handled manually. What we do guarantee is that the fund's balance
 * never renders NEGATIVE from a refund: once refunds exceed the net the fund
 * actually received, the realised `fee` debit is reversed with a compensating
 * credit rather than left as an overdraft (see `recordDonationRefund`).
 *
 * DISPUTES are the same shape and are known-drifting: `recordDonationDisputed`
 * is audit-only (no provisional debit, no `refundedCents`, no status change),
 * so a disputed gift's ledger credit stands until the nightly reconcile flags
 * it. The money path is safe ONLY when the chargeback settles in the same
 * payout as the charge: Stripe posts it as an `adjustment` balance
 * transaction, which `getPayoutComposition` nets against the charge just like
 * a refund, so nothing is transferred. Disputes typically arrive weeks after
 * the payout, by which point the gift is already allocated; and a dispute
 * filed before the payout but settling in a LATER one funds the gift in full,
 * because — unlike a refund — nothing about a dispute marks the donation.
 * Both cases surface as reconcile drift, not as a blocked transfer.
 *
 * Every provider call (lib/finance/increase.ts, lib/finance/stripeConnect.ts)
 * is a lazy `await import(...)` inside an action body — never a top-level
 * import — so the mutation-level unit tests never load them (see
 * __tests__/finance-giving.test.ts). __tests__/finance-allocation.test.ts
 * does exercise `runAllocation` end to end, with both providers mocked.
 */

import { v } from "convex/values";
import type { Crons } from "convex/server";
import {
  internalMutation,
  internalAction,
  internalQuery,
  type ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { checkInvariant, postLedgerEntry } from "../../lib/finance/ledger";
import { logFinanceAudit } from "../../lib/finance/audit";
import {
  getCardProviderByName,
  loadActiveProviderConnection,
  resolveCardProviderName,
} from "../../lib/finance/cardProviders";
import { recordProviderTransaction } from "./webhooks";
import { now } from "../../lib/utils";

/**
 * GROSS: what the donor was charged and what the ledger was credited at
 * donation time. A donation never splits across payouts — this backstops
 * that read.
 */
function donationTotalCents(donation: Pick<Doc<"donations">, "amountCents" | "feeCoverCents">): number {
  return donation.amountCents + donation.feeCoverCents;
}

/**
 * What allocation will actually move for a donation, in integer cents.
 *
 * Once a donation is bound to a payout we know its NET — the only amount the
 * receiving Account ever got for it, and therefore the only amount that can
 * be transferred on. Before that, gross MINUS whatever has already been
 * refunded is the honest estimate: the fee hasn't been taken yet as far as
 * anything we can observe is concerned, but a refund has already reversed
 * its share of the ledger credit, so counting the full gross would drift by
 * exactly the refunded amount every night and never close. Both the
 * allocation plan and the nightly reconcile read the amount through here so
 * they can never disagree about what "pending" is worth.
 */
function allocationAmountCents(
  donation: Pick<
    Doc<"donations">,
    "amountCents" | "feeCoverCents" | "payoutNetCents" | "refundedCents"
  >,
): number {
  const unrefundedGross = Math.max(
    0,
    donationTotalCents(donation) - (donation.refundedCents ?? 0),
  );
  if (donation.payoutNetCents !== undefined) {
    // Normally the bound net is the smaller of the two and wins. The `min`
    // matters for a refund that lands AFTER the payout bound the donation:
    // `payoutNetCents` was fixed at bind time and can't know about it, while
    // the ledger has already taken the refund debit. Counting the stale net
    // would drift by the refunded amount every night and never close.
    return Math.min(donation.payoutNetCents, unrefundedGross);
  }
  return unrefundedGross;
}

/**
 * How long a donation stays claimed by the pass that selected it for a
 * transfer.
 *
 * The lease exists because the per-donation payout stamp is a *marker*, not a
 * reservation: two passes can legitimately select the same bound donation
 * (a redelivered `payout.paid`, or the hourly retry cron firing while a
 * `runAllocation` is mid-loop), and both would then issue the same
 * `alloc:{donationId}` Increase transfer *concurrently* — before either has
 * recorded anything, so `recordAllocation`'s already-allocated no-op cannot
 * help. Increase documents "at most one object per idempotency key" but says
 * nothing about two in-flight requests sharing one, and that is not a
 * property to rest a money guarantee on.
 *
 * Claiming happens inside the selection MUTATION (`planAllocations` /
 * `listResumableAllocations`), so acquiring the lease and returning the item
 * are one serializable transaction and Convex's OCC decides the winner.
 *
 * The TTL bounds a pass that dies mid-transfer without releasing: 15 minutes
 * comfortably exceeds an action's own lifetime, and the hourly retry cron
 * picks the item up on its next tick. Failures release the lease immediately
 * (`recordAllocationFailure`), so the normal partial-failure path never waits
 * for expiry.
 */
const ALLOCATION_LEASE_TTL_MS = 15 * 60 * 1000;

/** True while another pass still holds this donation's transfer claim. */
function allocationLeaseHeld(
  donation: Pick<Doc<"donations">, "allocationTransferStartedAt">,
  nowMs: number,
): boolean {
  const startedAt = donation.allocationTransferStartedAt;
  return startedAt !== undefined && nowMs - startedAt < ALLOCATION_LEASE_TTL_MS;
}

// ============================================================================
// planAllocations
// ============================================================================

export interface AllocationPlanItem {
  donationId: Id<"donations">;
  fundId: Id<"funds">;
  fundType: "group" | "general";
  /** NET cents — what the payout actually delivered for this donation. */
  amountCents: number;
}

export interface AllocationPlan {
  plan: AllocationPlanItem[];
  /**
   * Payout cents this pass did not match to a donation it could act on.
   * Expected to be ~0: a payout IS the sum of its rows' nets, so anything
   * here is either a charge we couldn't map to a donation, or a gift another
   * pass currently holds. `runAllocation` alarms when it gets large.
   */
  leftoverCents: number;
  /** True when this payout had already been planned (a redelivered webhook). */
  alreadyClaimed: boolean;
  /** Matched donations another in-flight pass currently holds the lease on. */
  leasedElsewhere: number;
  /**
   * Donations this payout ALREADY finished — bound to it and "allocated".
   * A redelivery of a healthy payout produces an empty plan, which is the
   * success condition and must not be mistaken for "matched nothing".
   */
  alreadyAllocated: number;
  /**
   * Donations the residual-budget check refused because funding them would
   * have overrun the payout. Each one is a gift left stranded to cover money
   * we could not account for, so the pass has to say so out loud rather than
   * letting `leftoverCents` come out at 0 and look healthy.
   */
  overrunSkipped: number;
}

/**
 * Binds a payout's donations to that payout and returns the ones still
 * needing a transfer. No money moves here.
 *
 * `charges` is the payout's composition straight from Stripe
 * (`getPayoutComposition` in lib/finance/stripeConnect.ts): one entry per
 * PaymentIntent the payout contained, valued at the NET cents it actually
 * contributed (its charge minus any refund of that same charge which settled
 * in the same payout). Membership is therefore read off Stripe,
 * not guessed from a running total, and a donation is matched by identity —
 * which is what makes this safe to re-run.
 *
 * REPLAY PROTECTION lives on the donation rows, not on the payout. A matched
 * donation is stamped `allocationPayoutId` + `payoutNetCents` in the same
 * transaction that selects it, and a donation already stamped for a
 * DIFFERENT payout is never re-selected. So a redelivered `payout.paid`
 * re-derives exactly the same donation set, minus the ones already flipped
 * to "allocated" — i.e. it resumes the unfinished tail and can never
 * double-transfer a finished item or reach forward into a later payout's
 * money (which is what the old payout-level `processedStripePayouts` gate
 * existed to prevent, at the cost of making partial failures unrecoverable).
 *
 * CONCURRENCY is separate from replay, and needs a LEASE rather than a
 * marker: this mutation stamps `allocationTransferStartedAt` on every item it
 * returns and skips any item another pass still holds, all inside the one
 * transaction, so two overlapping passes can never both be told to transfer
 * the same donation. See `ALLOCATION_LEASE_TTL_MS`.
 *
 * REFUNDED gifts never reach here: a fully refunded donation is
 * `allocationStatus: "refunded"` (giving.ts `recordDonationRefund`) and the
 * selection below only ever plans `"pending"` rows, while a refund that
 * settled inside this payout has already been netted out of `charges` by
 * `getPayoutComposition`. A PARTIALLY refunded gift stays pending and is
 * still fundable, but only for what is left of it — every selection path
 * values it through `allocationAmountCents`.
 *
 * `leftoverCents` is the payout minus every net this pass accounted for:
 * items it planned, plus items an earlier pass already allocated out of this
 * same payout. What remains is charges we couldn't map to an actionable
 * donation, plus anything held by another pass.
 */
export const planAllocations = internalMutation({
  args: {
    communityId: v.id("communities"),
    payoutCents: v.number(),
    stripePayoutId: v.string(),
    charges: v.array(
      v.object({
        paymentIntentId: v.string(),
        netCents: v.number(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<AllocationPlan> => {
    const existingClaim = await ctx.db
      .query("processedStripePayouts")
      .withIndex("by_payout", (q) => q.eq("stripePayoutId", args.stripePayoutId))
      .first();
    if (!existingClaim) {
      await ctx.db.insert("processedStripePayouts", {
        communityId: args.communityId,
        stripePayoutId: args.stripePayoutId,
        payoutCents: args.payoutCents,
        processedAt: now(),
      });
    }

    const netByPaymentIntent = new Map<string, number>();
    for (const charge of args.charges) {
      if (!Number.isInteger(charge.netCents) || charge.netCents <= 0) {
        console.error(
          `[finance] planAllocations: payout ${args.stripePayoutId} charge ${charge.paymentIntentId} has a non-positive/non-integer net (${charge.netCents}) — ignoring it`,
        );
        continue;
      }
      // One PaymentIntent producing two charges in one payout isn't a shape
      // Stripe produces for our flow, but summing is the only non-lossy
      // reading if it ever does.
      netByPaymentIntent.set(
        charge.paymentIntentId,
        (netByPaymentIntent.get(charge.paymentIntentId) ?? 0) + charge.netCents,
      );
    }

    const funds = await ctx.db
      .query("funds")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    // Every donation in the community, not just the pending ones: a donation
    // this payout has ALREADY allocated still accounts for its slice of the
    // payout, and a pass that ignored it would report the whole payout as
    // unmatched on every redelivery. (`.filter()` on a Convex query is a
    // post-read filter, so reading them all costs the same.)
    const candidates: Array<Doc<"donations"> & { fundType: "group" | "general" }> = [];
    for (const fund of funds) {
      const fundDonations = await ctx.db
        .query("donations")
        .withIndex("by_fund", (q) => q.eq("fundId", fund._id))
        .collect();
      for (const donation of fundDonations) {
        candidates.push({ ...donation, fundType: fund.type });
      }
    }
    // Deterministic order: oldest gift first, tie-broken by id so two runs
    // over the same data always plan the same sequence.
    candidates.sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));

    const nowMs = now();
    const plan: AllocationPlanItem[] = [];
    let usedCents = 0;
    let leasedElsewhere = 0;
    let alreadyAllocated = 0;
    let overrunSkipped = 0;
    for (const donation of candidates) {
      const boundHere = donation.allocationPayoutId === args.stripePayoutId;

      if (boundHere && donation.allocationStatus === "allocated") {
        // Finished on an earlier pass. Its net is spoken for, so count it
        // against the payout — otherwise a redelivered `payout.paid` (and
        // this branch also routes `payout.reconciliation_completed`, which
        // arrives after EVERY healthy payout) reports `leftoverCents` equal
        // to the entire payout and raises a false unmatched alarm.
        usedCents += donation.payoutNetCents ?? 0;
        alreadyAllocated += 1;
        continue;
      }
      if (donation.allocationStatus !== "pending") {
        continue; // "refunded" is terminal; "n/a" pre-dates Increase.
      }
      if (donation.allocationPayoutId && !boundHere) {
        continue; // Belongs to another payout's pass.
      }

      let netCents: number;
      if (boundHere) {
        // Resume: an earlier pass over this payout matched this donation but
        // its transfer never landed. Re-use the net already recorded rather
        // than re-deriving it, so the retry moves the identical amount —
        // capped, via `allocationAmountCents`, at what is left of the gift
        // after any refund that landed since the binding.
        netCents = allocationAmountCents(donation);
        if (netCents <= 0) {
          console.error(
            `[finance] planAllocations: donation ${donation._id} is bound to payout ${args.stripePayoutId} with no usable net — skipping`,
          );
          continue;
        }
      } else {
        const matched = netByPaymentIntent.get(donation.stripePaymentIntentId);
        if (matched === undefined) {
          continue; // Not one of this payout's charges — a later payout owns it.
        }
        // Cap Stripe's net at the unrefunded gross. A partial refund whose
        // own balance transaction settles in a DIFFERENT payout leaves this
        // payout carrying the charge at its full net, while the ledger has
        // already taken the refund debit — transferring the full net would
        // put money the donor got back into a group's spendable Account.
        // Same helper the nightly pending sum uses, so the planner and the
        // invariant can never disagree about what a gift is worth.
        netCents = allocationAmountCents({ ...donation, payoutNetCents: matched });
        if (netCents <= 0) {
          console.error(
            `[finance] planAllocations: donation ${donation._id} is in payout ${args.stripePayoutId} at net ${matched} but nothing is left of it after ${donation.refundedCents ?? 0} refunded — skipping`,
          );
          continue;
        }
        // Defensive only: the nets came out of this payout, so they sum to
        // it by construction. `continue` (never `break`) so one oversized
        // outlier can't wedge the queue behind it forever, which is exactly
        // how the old gross matcher stalled. Counted, though — skipping a
        // gift here is a gift stranded, and it must not look like a healthy
        // pass just because the arithmetic then comes out even.
        if (usedCents + netCents > args.payoutCents) {
          overrunSkipped += 1;
          console.error(
            `[finance] planAllocations: donation ${donation._id} (net ${netCents}) would overrun payout ${args.stripePayoutId} (${args.payoutCents}, ${usedCents} used) — skipping it, not the rest`,
          );
          continue;
        }
      }

      // Take the lease in the same transaction that hands the item out. A
      // concurrent pass either loses the OCC race and re-reads this stamp, or
      // wins and this pass re-reads theirs — either way exactly one of us
      // gets to move the money.
      if (allocationLeaseHeld(donation, nowMs)) {
        leasedElsewhere += 1;
        continue;
      }
      await ctx.db.patch(donation._id, {
        allocationPayoutId: args.stripePayoutId,
        payoutNetCents: netCents,
        allocationTransferStartedAt: nowMs,
      });

      plan.push({
        donationId: donation._id,
        fundId: donation.fundId,
        fundType: donation.fundType,
        amountCents: netCents,
      });
      usedCents += netCents;
    }

    return {
      plan,
      leftoverCents: args.payoutCents - usedCents,
      alreadyClaimed: existingClaim !== null,
      leasedElsewhere,
      alreadyAllocated,
      overrunSkipped,
    };
  },
});

// ============================================================================
// recordAllocation
// ============================================================================

/**
 * Flips a donation's `allocationStatus` to "allocated", posts the Stripe
 * processing fee as a "fee" debit, and audit-logs the Increase transfer id.
 * The fee debit is the ONLY balance-affecting entry allocation writes — see
 * the file-level "DESIGN DECISION" comment for why it exists and why it's
 * posted here (on the transfer landing) rather than at match time.
 *
 * Idempotent on both halves: a donation already marked "allocated" returns
 * immediately, and `postLedgerEntry` dedupes on `alloc-fee:{donationId}`
 * anyway. Safe if `runAllocation` retries after a partial failure.
 */
export const recordAllocation = internalMutation({
  args: {
    donationId: v.id("donations"),
    increaseTransferId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (!donation) {
      throw new Error(`recordAllocation: donation ${args.donationId} not found`);
    }
    if (donation.allocationStatus === "allocated") {
      return; // Already recorded — a retried transfer landed here twice.
    }

    const fund = await ctx.db.get(donation.fundId);
    if (!fund) {
      throw new Error(`recordAllocation: fund ${donation.fundId} not found`);
    }

    if (donation.allocationStatus === "refunded") {
      // The refund webhook landed while this transfer was in flight, so real
      // money moved into the group's Account for a gift the donor already got
      // back. "refunded" is terminal and stays — overwriting it with
      // "allocated" would hide the problem. The ledger is already correct
      // (credit + full refund debit, no fee), so the money now sitting in the
      // group Account shows up as reconcile drift, which is the signal an
      // operator needs to claw it back.
      console.error(
        `[finance] recordAllocation: donation ${args.donationId} was refunded while its allocation transfer was in flight — ${args.increaseTransferId ?? "no transfer id"} moved money for a returned gift`,
      );
      await ctx.db.patch(args.donationId, { allocationTransferStartedAt: undefined });
      await logFinanceAudit(ctx, {
        communityId: fund.communityId,
        fundId: fund._id,
        action: "allocation.refunded_in_flight",
        details: {
          donationId: args.donationId,
          increaseTransferId: args.increaseTransferId,
          stripePayoutId: donation.allocationPayoutId,
          amountCents: donation.payoutNetCents,
          refundedCents: donation.refundedCents,
        },
      });
      return;
    }

    await ctx.db.patch(args.donationId, {
      allocationStatus: "allocated",
      // Transfer resolved — drop the claim (schema: allocationTransferStartedAt).
      allocationTransferStartedAt: undefined,
    });

    const grossCents = donationTotalCents(donation);
    const refundedCents = donation.refundedCents ?? 0;
    const netCents = donation.payoutNetCents;
    // The fee is what Stripe kept out of the part of the gift the fund still
    // has. Subtracting refunds first matters when a partial refund settled in
    // the same payout: `payoutNetCents` is already net of it, so charging
    // `gross − net` would debit the refund a SECOND time on top of the
    // `refund` entry recordDonationRefund already posted.
    // Legacy rows (allocated before net matching shipped) carry no net, so
    // there's no fee to realise for them — leave the ledger alone rather
    // than inventing a number.
    const feeCents = netCents === undefined ? 0 : grossCents - refundedCents - netCents;
    if (feeCents < 0) {
      // The net exceeds what's left of the gift. Either Stripe returned a net
      // above gross (impossible) or a refund landed after this payout bound
      // the donation, so `payoutNetCents` is larger than the remainder. Both
      // mean we'd be CREDITING the fund for a number we don't understand;
      // refuse, and let the nightly reconcile surface the difference.
      console.error(
        `[finance] recordAllocation: donation ${args.donationId} has net ${netCents} above its unrefunded gross (${grossCents} gross − ${refundedCents} refunded) — not posting a fee entry`,
      );
    } else if (feeCents > 0) {
      await postLedgerEntry(ctx, {
        fundId: fund._id,
        direction: "debit",
        amountCents: feeCents,
        kind: "fee",
        idempotencyKey: `alloc-fee:${args.donationId}`,
        stripeObjectId: donation.allocationPayoutId,
        increaseObjectId: args.increaseTransferId,
      });
    }

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: "donation.allocated",
      details: {
        donationId: args.donationId,
        increaseTransferId: args.increaseTransferId,
        stripePayoutId: donation.allocationPayoutId,
        // The net that moved; gross/fee spelled out so the audit row alone
        // explains the balance change.
        amountCents: netCents ?? grossCents,
        grossCents,
        feeCents,
      },
    });
  },
});

/**
 * Records that one item of an allocation pass didn't complete, without
 * failing the pass, and RELEASES that item's transfer lease so the next pass
 * can pick it up immediately. The donation stays "pending" and keeps its
 * `allocationPayoutId`/`payoutNetCents` stamp — see `executeAllocationItems`.
 *
 * `stage` is the distinction that matters at 3am, and the two failures are
 * genuinely different events:
 *
 *  - `"transfer"` → the Increase call threw. No money moved. Retry freely.
 *  - `"record"`   → the transfer LANDED (its id is in `increaseTransferId`)
 *                   and the bookkeeping mutation threw — e.g. `postLedgerEntry`
 *                   rejecting a fund that has since been closed, or OCC
 *                   retries exhausting. Real money is now in the group's
 *                   Account with nothing in our ledger saying so. The retry
 *                   re-issues the same `alloc:{donationId}` key, which
 *                   Increase collapses into the same transfer, and then
 *                   re-attempts the recording. Auditing this as
 *                   `allocation.transfer_failed` (which it used to be) is a
 *                   lie that sends an operator looking for a transfer that
 *                   is sitting right there.
 */
export const recordAllocationFailure = internalMutation({
  args: {
    donationId: v.id("donations"),
    fundId: v.id("funds"),
    amountCents: v.number(),
    reason: v.string(),
    stage: v.union(v.literal("transfer"), v.literal("record")),
    /** Set only for stage "record" — the transfer that already went through. */
    increaseTransferId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const donation = await ctx.db.get(args.donationId);
    if (donation?.allocationTransferStartedAt !== undefined) {
      await ctx.db.patch(args.donationId, {
        allocationTransferStartedAt: undefined,
      });
    }

    const fund = await ctx.db.get(args.fundId);
    if (!fund) {
      console.error(
        `[finance] recordAllocationFailure: fund ${args.fundId} not found`,
      );
      return;
    }
    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: args.fundId,
      action:
        args.stage === "record"
          ? "allocation.record_failed"
          : "allocation.transfer_failed",
      details: {
        donationId: args.donationId,
        amountCents: args.amountCents,
        reason: args.reason,
        increaseTransferId: args.increaseTransferId,
      },
    });
  },
});

// ============================================================================
// runAllocation
// ============================================================================

export interface AllocationRunResult {
  allocated: number;
  failed: number;
}

/**
 * Moves one allocation plan's money, item by item, and reports how much of
 * it landed. Shared by the payout webhook (`runAllocation`) and the hourly
 * retry (`retryStaleAllocations`) so both recover identically.
 *
 * PER-ITEM ISOLATION is the whole point: each transfer is wrapped, so a
 * single transient Increase failure costs exactly that donation instead of
 * aborting the pass and stranding every item behind it. A failed item stays
 * "pending" with its payout stamp intact, which is precisely what makes it
 * re-selectable by the next pass.
 *
 * EXACTLY-ONCE across those retries comes from three independent locks:
 *  - the per-donation transfer LEASE (`allocationTransferStartedAt`, taken by
 *    the selection mutation) means two overlapping passes can never both be
 *    holding this item at the same time;
 *  - `recordAllocation` no-ops on an already-"allocated" donation, so a
 *    finished item is never re-planned or re-recorded; and
 *  - the Increase idempotency key `alloc:{donationId}` means that even the
 *    genuinely ambiguous case — the transfer succeeded but the recording
 *    didn't — replays into the SAME transfer at Increase rather than a
 *    second movement of money.
 *
 * The transfer and the recording are in SEPARATE try blocks on purpose. They
 * fail in ways that need different responses, and collapsing them made
 * "money moved but we never booked it" indistinguishable from "money never
 * moved" in the audit trail.
 *
 * EVERY fund transfers, the general fund included. This used to special-case
 * general-fund donations and record them "allocated" with no transfer at
 * all, on the premise that the General Account was already where unearmarked
 * money sat. It wasn't: Stripe pays out to the RECEIVING Account, which is
 * transit for money still attributed to individual funds. General-fund gifts
 * were therefore booked as settled while their cash sat in receiving —
 * neither pending nor reconciled, so the nightly invariant could never see
 * them. The community's General Account is a destination like any other
 * (ADR-032 §1), and it is now actually provisioned, so the general fund is
 * just an ordinary fund on this path.
 *
 * A fund with NO Increase Account fails its item rather than skipping it:
 * the donation stays "pending" — its cash really is still in the receiving
 * Account — the failure is audited, and the retry cron finishes it once
 * migrations/backfillGeneralFundAccounts.ts (or the next enableGroupGiving)
 * mints the missing Account. Marking it allocated would strand money that
 * never moved.
 */
async function executeAllocationItems(
  ctx: ActionCtx,
  args: {
    receivingAccountId: string;
    items: AllocationPlanItem[];
    /** Job name for log lines, e.g. "runAllocation". */
    context: string;
  },
): Promise<AllocationRunResult> {
  let allocated = 0;
  let failed = 0;

  /** Audit + release the lease; never let this abort the remaining items. */
  const noteFailure = async (
    item: AllocationPlanItem,
    stage: "transfer" | "record",
    reason: string,
    increaseTransferId?: string,
  ) => {
    try {
      await ctx.runMutation(
        internal.functions.finance.jobs.recordAllocationFailure,
        {
          donationId: item.donationId,
          fundId: item.fundId,
          amountCents: item.amountCents,
          reason,
          stage,
          increaseTransferId,
        },
      );
    } catch (auditError) {
      console.error(
        `[finance] ${args.context}: could not audit the allocation ${stage} failure for donation ${item.donationId}`,
        auditError,
      );
    }
  };

  for (const item of args.items) {
    // --- 1. Move the money. No fund type is exempt: the payout landed in the
    // RECEIVING Account, so a general-fund gift is as much in transit as a
    // group's. ---
    let increaseTransferId: string;
    try {
      const fund: Doc<"funds"> | null = await ctx.runQuery(
        internal.functions.finance.jobs.getFundForAllocation,
        { fundId: item.fundId },
      );
      if (!fund?.increaseAccountId) {
        // Thrown, not skipped: this is the transfer stage, so the item is
        // audited as `allocation.transfer_failed` and left pending with its
        // payout stamp — exactly the state the retry cron re-selects once the
        // Account is minted. Recording it instead would book money that is
        // still sitting in receiving as settled.
        throw new Error(
          `${item.fundType} fund ${item.fundId} has no Increase Account to transfer into`,
        );
      }

      const { createAccountTransfer } = await import("../../lib/finance/increase");
      const transfer = await createAccountTransfer({
        fromAccountId: args.receivingAccountId,
        toAccountId: fund.increaseAccountId,
        amountCents: item.amountCents,
        description: `Allocation: donation ${item.donationId}`,
        idempotencyKey: `alloc:${item.donationId}`,
      });
      increaseTransferId = transfer.id;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[finance] ${args.context}: TRANSFER failed for donation ${item.donationId} (${item.amountCents} cents) — no money moved; it stays pending and will be retried`,
        error,
      );
      await noteFailure(item, "transfer", reason);
      continue;
    }

    // --- 2. Book it. Money has already moved by this point. ---
    try {
      await ctx.runMutation(internal.functions.finance.jobs.recordAllocation, {
        donationId: item.donationId,
        increaseTransferId,
      });
      allocated += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[finance] ${args.context}: RECORD failed for donation ${item.donationId} (${item.amountCents} cents) after transfer ${increaseTransferId} already landed — the money HAS moved and is not yet in the ledger`,
        error,
      );
      await noteFailure(item, "record", reason, increaseTransferId);
    }
  }

  return { allocated, failed };
}

/**
 * How far a payout's unmatched remainder can stray before it is treated as a
 * problem rather than rounding. A payout IS the sum of its balance
 * transactions' nets, so a fully-matched pass leaves 0 — anything material
 * means the payout carried money we could not attribute to a donation (or a
 * refund we could not attribute to a charge, which shows up as a NEGATIVE
 * remainder). $1, or 1% of the payout for large ones, is generous headroom
 * for a single odd row while still catching a systematically broken match.
 */
const UNMATCHED_PAYOUT_FLOOR_CENTS = 100;
const UNMATCHED_PAYOUT_FRACTION = 0.01;

function unmatchedPayoutIsAlarming(leftoverCents: number, payoutCents: number): boolean {
  const tolerance = Math.max(
    UNMATCHED_PAYOUT_FLOOR_CENTS,
    Math.round(Math.abs(payoutCents) * UNMATCHED_PAYOUT_FRACTION),
  );
  return Math.abs(leftoverCents) > tolerance;
}

/**
 * `payout.paid` entry point: allocate one Stripe payout into fund Accounts.
 *
 * Order matters. Stripe is asked for the payout's composition BEFORE
 * anything is written, so an unreachable Stripe leaves the payout completely
 * untouched and the webhook redelivery (or the hourly retry) simply tries
 * again — rather than claiming a payout we then can't match, which is how
 * money used to get stranded. The action deliberately does not throw on a
 * failed item: it reports counts, audits each failure, and leaves the item
 * pending for the next pass.
 *
 * OBSERVABILITY is load-bearing here, not decoration. Once this returns, the
 * `processedStripePayouts` row is written and the webhook 200s, so Stripe
 * never redelivers — and `retryStaleAllocations` only resumes donations a
 * pass already BOUND. A payout that matched nothing therefore has no
 * automatic recovery at all, which is the same silent-stall failure class
 * this whole job was rewritten to eliminate. So an empty plan and a material
 * unmatched remainder both audit and `console.error`, rather than returning
 * zero quietly.
 */
export const runAllocation = internalAction({
  args: {
    communityId: v.id("communities"),
    stripePayoutId: v.string(),
    payoutCents: v.number(),
  },
  handler: async (ctx, args): Promise<AllocationRunResult> => {
    const communityFinance = await ctx.runQuery(
      internal.functions.finance.jobs.getCommunityFinanceForAllocation,
      { communityId: args.communityId },
    );
    if (!communityFinance?.stripeConnectedAccountId) {
      console.error(
        `[finance] runAllocation: community ${args.communityId} has no Stripe connected account — cannot resolve payout ${args.stripePayoutId}`,
      );
      return { allocated: 0, failed: 0 };
    }

    const { getPayoutComposition } = await import("../../lib/finance/stripeConnect");
    const composition = await getPayoutComposition(
      communityFinance.stripeConnectedAccountId,
      args.stripePayoutId,
      args.payoutCents,
    );

    if (composition.reversedPaymentIntentIds.length > 0) {
      // Not an error: the netting did its job and kept refunded money out of
      // a group's Account. Logged because it explains a short payout.
      console.log(
        `[finance] runAllocation: payout ${args.stripePayoutId} carried ${composition.reversedPaymentIntentIds.length} fully reversed charge(s) — nothing will be allocated for them`,
      );
    }
    if (composition.unattributedNetCents < 0) {
      // REFUSE. The payout is short by money we cannot subtract from any
      // gift, so the charge rows sum to more than actually arrived. Allocate
      // anyway and the residual-budget check absorbs the shortfall by
      // skipping whichever gift happens to sort last — a healthy donor's
      // money stranded, silently, to cover a reversal we couldn't attribute.
      // Nothing is written here, so a redelivery (or a manual re-run once
      // someone has read the Stripe rows) can still allocate it properly.
      //
      // The trade-off is deliberate: this also refuses a payout carrying a
      // small unattributable Stripe platform fee, which would otherwise have
      // funded everyone but one. Blocking a payout is recoverable by hand;
      // stranding a gift silently is not noticed at all.
      console.error(
        `[finance] runAllocation: payout ${args.stripePayoutId} carries ${composition.unattributedNetCents} cents we cannot attribute to any PaymentIntent — the payout is short by money that cannot be netted against a donation, so NOTHING will be allocated`,
      );
      await ctx.runMutation(
        internal.functions.finance.jobs.recordUnmatchedPayout,
        {
          communityId: args.communityId,
          stripePayoutId: args.stripePayoutId,
          payoutCents: args.payoutCents,
          leftoverCents: args.payoutCents,
          matchedCount: 0,
          chargeCount: composition.charges.length,
          reversedCount: composition.reversedPaymentIntentIds.length,
          unattributedNetCents: composition.unattributedNetCents,
          refused: true,
        },
      );
      return { allocated: 0, failed: 0 };
    }
    if (composition.unattributedNetCents > 0) {
      // Harmless direction: money arrived that we can't credit to a donor. It
      // stays in the receiving Account and shows up as `leftoverCents`.
      console.log(
        `[finance] runAllocation: payout ${args.stripePayoutId} carries ${composition.unattributedNetCents} cents with no resolvable PaymentIntent — nothing will be allocated for it`,
      );
    }

    const {
      plan,
      alreadyClaimed,
      leftoverCents,
      leasedElsewhere,
      alreadyAllocated,
      overrunSkipped,
    } = await ctx.runMutation(internal.functions.finance.jobs.planAllocations, {
      communityId: args.communityId,
      payoutCents: args.payoutCents,
      stripePayoutId: args.stripePayoutId,
      charges: composition.charges,
    });

    if (alreadyClaimed) {
      console.log(
        `[finance] runAllocation: payout ${args.stripePayoutId} was already planned — resuming ${plan.length} unfinished item(s)`,
      );
    }
    if (leasedElsewhere > 0) {
      console.log(
        `[finance] runAllocation: payout ${args.stripePayoutId} skipped ${leasedElsewhere} item(s) another in-flight pass is holding`,
      );
    }

    const unmatchedIsAlarming =
      // An item another pass holds is accounted for, just not by us.
      leasedElsewhere === 0 &&
      unmatchedPayoutIsAlarming(leftoverCents, args.payoutCents);

    // An empty plan is only a problem when the payout got nothing DONE — not
    // when there is nothing left to do. A redelivered `payout.paid`, and the
    // `payout.reconciliation_completed` that follows every healthy payout,
    // both land here with `plan.length === 0` and every gift already
    // allocated. Alarming on those made the alarm fire on every payout,
    // forever, which is worse than not having one.
    const matchedNothing = plan.length === 0 && alreadyAllocated === 0;

    if (matchedNothing || unmatchedIsAlarming || overrunSkipped > 0) {
      console.error(
        `[finance] runAllocation: payout ${args.stripePayoutId} (${args.payoutCents} cents) matched ${plan.length} donation(s) from ${composition.charges.length} charge(s) (${alreadyAllocated} already allocated, ${overrunSkipped} skipped as overrunning), leaving ${leftoverCents} cents unattributed`,
      );
      await ctx.runMutation(
        internal.functions.finance.jobs.recordUnmatchedPayout,
        {
          communityId: args.communityId,
          stripePayoutId: args.stripePayoutId,
          payoutCents: args.payoutCents,
          leftoverCents,
          matchedCount: plan.length,
          chargeCount: composition.charges.length,
          reversedCount: composition.reversedPaymentIntentIds.length,
          unattributedNetCents: composition.unattributedNetCents,
          alreadyAllocatedCount: alreadyAllocated,
          overrunSkippedCount: overrunSkipped,
        },
      );
    }

    if (plan.length === 0) {
      return { allocated: 0, failed: 0 };
    }

    if (!communityFinance.increaseReceivingAccountId) {
      console.error(
        `[finance] runAllocation: community ${args.communityId} has no receiving Account — ${plan.length} matched item(s) stay pending`,
      );
      // Audit each item (which also releases its lease) rather than leaving
      // them claimed for the lease TTL over a condition no retry can fix.
      for (const item of plan) {
        await ctx.runMutation(
          internal.functions.finance.jobs.recordAllocationFailure,
          {
            donationId: item.donationId,
            fundId: item.fundId,
            amountCents: item.amountCents,
            reason: "community has no Increase receiving Account",
            stage: "transfer" as const,
          },
        );
      }
      return { allocated: 0, failed: plan.length };
    }

    return await executeAllocationItems(ctx, {
      receivingAccountId: communityFinance.increaseReceivingAccountId,
      items: plan,
      context: "runAllocation",
    });
  },
});

/**
 * Audits a payout whose allocation pass couldn't account for it: it matched
 * no donation at all, a material slice of it went unattributed, a gift was
 * skipped for overrunning the payout, or the pass refused it outright.
 *
 * This is the alarm for the one failure mode that has no automatic recovery
 * (see `runAllocation`'s "OBSERVABILITY" note). Reachable in practice:
 * `?payout=` only ever lists AUTOMATIC payouts, so a community that switched
 * to manual payouts in the Express dashboard gets an empty composition
 * forever; and a reversal with no resolvable PaymentIntent leaves the payout
 * short by money nothing can be netted against.
 *
 * It deliberately does NOT fire for a payout that simply has nothing left to
 * do. Stripe attributes balance transactions asynchronously, so webhooks.ts
 * routes `payout.reconciliation_completed` here after every healthy
 * `payout.paid` — an empty plan on that second pass is success, not silence.
 */
export const recordUnmatchedPayout = internalMutation({
  args: {
    communityId: v.id("communities"),
    stripePayoutId: v.string(),
    payoutCents: v.number(),
    leftoverCents: v.number(),
    matchedCount: v.number(),
    chargeCount: v.number(),
    reversedCount: v.number(),
    unattributedNetCents: v.number(),
    /** Set when the pass declined to allocate anything at all. */
    refused: v.optional(v.boolean()),
    alreadyAllocatedCount: v.optional(v.number()),
    overrunSkippedCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      action: "allocation.payout_unmatched",
      details: {
        stripePayoutId: args.stripePayoutId,
        payoutCents: args.payoutCents,
        leftoverCents: args.leftoverCents,
        matchedCount: args.matchedCount,
        chargeCount: args.chargeCount,
        reversedCount: args.reversedCount,
        unattributedNetCents: args.unattributedNetCents,
        refused: args.refused ?? false,
        alreadyAllocatedCount: args.alreadyAllocatedCount,
        overrunSkippedCount: args.overrunSkippedCount,
      },
    });
  },
});

/**
 * `payout.failed` entry point: undo the bindings a `payout.paid` for the same
 * payout already made.
 *
 * Stripe can follow `payout.paid` with `payout.failed` (the bank rejected
 * it). The money never reached the receiving Account, so every donation this
 * payout bound must be unbound — otherwise the hourly retry cron, which now
 * genuinely resumes bound items, would keep trying to move money out of an
 * Account that never received it. Unbinding puts them back where they were:
 * `pending` and unbound, waiting for whichever payout does land.
 *
 * Donations already flipped to "allocated" are left alone — their transfer
 * really did happen, and reversing a completed bank movement is a clawback,
 * not a rollback. They surface as reconcile drift instead.
 *
 * So are donations whose transfer LEASE is still live. `payout.failed` can
 * arrive while a `runAllocation` pass is mid-flight, and clearing
 * `payoutNetCents` out from under it means the `recordAllocation` that
 * follows flips the gift to "allocated" with no net and therefore posts no
 * `fee` entry — drift of exactly the fee, on a gift whose money we just said
 * never arrived. Leaving the lease alone lets that pass finish or fail on its
 * own terms; the next hourly tick unbinds it once the lease expires.
 */
export const unbindFailedPayout = internalMutation({
  args: {
    communityId: v.id("communities"),
    stripePayoutId: v.string(),
  },
  handler: async (ctx, args): Promise<{ unbound: number }> => {
    const pending = await ctx.db
      .query("donations")
      .withIndex("by_allocationStatus", (q) => q.eq("allocationStatus", "pending"))
      .collect();

    const nowMs = now();
    let unbound = 0;
    let leaseHeld = 0;
    for (const donation of pending) {
      if (donation.allocationPayoutId !== args.stripePayoutId) continue;
      const fund = await ctx.db.get(donation.fundId);
      if (fund?.communityId !== args.communityId) continue;
      if (allocationLeaseHeld(donation, nowMs)) {
        leaseHeld += 1;
        console.error(
          `[finance] unbindFailedPayout: donation ${donation._id} is bound to failed payout ${args.stripePayoutId} but a transfer pass still holds its lease — leaving it bound`,
        );
        continue;
      }
      await ctx.db.patch(donation._id, {
        allocationPayoutId: undefined,
        payoutNetCents: undefined,
        allocationTransferStartedAt: undefined,
      });
      unbound += 1;
    }

    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      action: "allocation.payout_failed",
      details: {
        stripePayoutId: args.stripePayoutId,
        unboundCount: unbound,
        leaseHeldCount: leaseHeld,
      },
    });
    return { unbound };
  },
});

export const getCommunityFinanceForAllocation = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();
  },
});

export const getFundForAllocation = internalQuery({
  args: { fundId: v.id("funds") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fundId);
  },
});

// ============================================================================
// computePendingAllocationCents
// ============================================================================

export interface PendingAllocation {
  fundId: Id<"funds">;
  pendingCents: number;
}

/**
 * Sums pending (not-yet-allocated) donations per fund for a community — the
 * `pendingAllocationCents` term in the ADR-032 invariant.
 *
 * Summed through `allocationAmountCents`, i.e. on exactly the basis the
 * allocation job will transfer: NET once a donation is bound to a payout,
 * gross while it's still in the Stripe pipeline. Summing gross throughout
 * (as this used to) made the invariant self-consistent no matter what — a
 * donation whose transfer never happened still "accounted" for its full
 * gross, so a stalled allocation looked perfectly healthy. On the net basis
 * a stall leaves the realised-but-unposted fee behind as drift, and the
 * nightly alarm sees it.
 *
 * Modeled as an internal mutation (rather than a query) so the nightly
 * reconcile action can call it with the same `ctx.runMutation` plumbing it
 * uses for `recordReconcileResult`, and so it's directly unit-testable the
 * same way as the rest of this file's mutations; it performs no writes.
 */
export const computePendingAllocationCents = internalMutation({
  args: {
    communityId: v.id("communities"),
    /**
     * Only count donations created before this timestamp. Omitted by the
     * nightly reconcile (which wants the whole pending term of the
     * invariant); passed by the staleness alert, whose audit row is labelled
     * "pending for > 3 days" and must therefore not report a community's
     * entire pending sum including gifts that arrived this morning.
     */
    createdBeforeMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PendingAllocation[]> => {
    const funds = await ctx.db
      .query("funds")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const results: PendingAllocation[] = [];
    for (const fund of funds) {
      const pendingDonations = await ctx.db
        .query("donations")
        .withIndex("by_fund", (q) => q.eq("fundId", fund._id))
        .filter((q) => q.eq(q.field("allocationStatus"), "pending"))
        .collect();
      const pendingCents = pendingDonations.reduce(
        (sum, donation) =>
          args.createdBeforeMs !== undefined && donation.createdAt >= args.createdBeforeMs
            ? sum
            : sum + allocationAmountCents(donation),
        0,
      );
      results.push({ fundId: fund._id, pendingCents });
    }
    return results;
  },
});

// ============================================================================
// Nightly reconcile
// ============================================================================

export const getFundsWithIncreaseAccount = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const funds = await ctx.db
      .query("funds")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    return funds.filter((f) => f.increaseAccountId && f.status !== "closed");
  },
});

/**
 * The pure comparison step of nightly reconcile, split out into its own
 * internal mutation so it's directly testable with a synthetic bank balance
 * — no need to actually reach Increase to exercise the drift path (per the
 * task's testing note). Writes a "reconcile.drift" audit event on drift.
 *
 * Alerting: this codebase has no generic ops-alerting bus for background
 * jobs today (the Slack service bot in functions/slackServiceBot/ is a
 * community-facing AI assistant, not an ops-alert sink, so routing through
 * it would be scope creep). Following the closest existing precedent
 * (crons.ts jobs that fail loudly via `console.error` and rely on Convex's
 * own function-failure surfacing), drift is: audited (queryable,
 * permanent) + `console.error`'d (shows up in `pnpm convex:logs` /
 * dashboard alerting). Revisit if/when this repo grows a real ops-alert
 * integration.
 */
export const recordReconcileResult = internalMutation({
  args: {
    fundId: v.id("funds"),
    communityId: v.id("communities"),
    ledgerBalanceCents: v.number(),
    bankBalanceCents: v.number(),
    pendingAllocationCents: v.number(),
  },
  handler: async (ctx, args) => {
    const result = checkInvariant(
      args.ledgerBalanceCents,
      args.bankBalanceCents,
      args.pendingAllocationCents,
    );

    if (!result.ok) {
      console.error(
        `[finance] reconcile drift on fund ${args.fundId}: driftCents=${result.driftCents} ` +
          `(ledger=${args.ledgerBalanceCents}, bank=${args.bankBalanceCents}, pending=${args.pendingAllocationCents})`,
      );
      await logFinanceAudit(ctx, {
        communityId: args.communityId,
        fundId: args.fundId,
        action: "reconcile.drift",
        details: {
          driftCents: result.driftCents,
          ledgerBalanceCents: args.ledgerBalanceCents,
          bankBalanceCents: args.bankBalanceCents,
          pendingAllocationCents: args.pendingAllocationCents,
          checkedAt: now(),
        },
      });
    }

    return result;
  },
});

/**
 * Reconciles every Increase-connected fund in one community: for each,
 * fetches the live Increase Account balance and runs it through
 * `recordReconcileResult` against our ledger's cached balance (adjusted for
 * donations still awaiting allocation).
 */
export const runNightlyReconcile = internalAction({
  args: { communityId: v.id("communities") },
  // Explicit return annotation breaks the self-referential type cycle that
  // otherwise poisons ApiFromModules inference repo-wide (this action calls
  // its own module via `internal.functions.finance.jobs.*`).
  handler: async (
    ctx,
    args,
  ): Promise<{ checked: number; drifted: number }> => {
    const funds: Array<Doc<"funds">> = await ctx.runQuery(
      internal.functions.finance.jobs.getFundsWithIncreaseAccount,
      { communityId: args.communityId },
    );
    if (funds.length === 0) {
      return { checked: 0, drifted: 0 };
    }

    const pending = await ctx.runMutation(
      internal.functions.finance.jobs.computePendingAllocationCents,
      { communityId: args.communityId },
    );
    const pendingByFund = new Map(
      pending.map((p: PendingAllocation): [Id<"funds">, number] => [p.fundId, p.pendingCents]),
    );

    let drifted = 0;
    for (const fund of funds) {
      let bankBalanceCents: number;
      try {
        const { getAccountBalance } = await import("../../lib/finance/increase");
        // currentBalanceCents is the posted/settled balance — the ledger's
        // cached balance is likewise a running total of posted entries, so
        // this is the correct comparison point (availableBalanceCents nets
        // out holds, which isn't what our ledger models).
        const balance = await getAccountBalance(fund.increaseAccountId as string);
        bankBalanceCents = balance.currentBalanceCents;
      } catch (error) {
        console.error(
          `[finance] runNightlyReconcile: failed to fetch Increase balance for fund ${fund._id}`,
          error,
        );
        continue;
      }

      const result = await ctx.runMutation(
        internal.functions.finance.jobs.recordReconcileResult,
        {
          fundId: fund._id,
          communityId: args.communityId,
          ledgerBalanceCents: fund.balanceCents,
          bankBalanceCents,
          pendingAllocationCents: pendingByFund.get(fund._id) ?? 0,
        },
      );
      if (!result.ok) {
        drifted += 1;
      }
    }

    return { checked: funds.length, drifted };
  },
});

/** Every community with finance onboarded — the fan-out root for the nightly cron. */
export const listCommunitiesWithFinance = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("communityFinance").collect();
    return rows.map((row) => row.communityId);
  },
});

/**
 * Cron entry point (no args, matches the fan-out convention used elsewhere
 * in crons.ts, e.g. `processAllAutoChannels`/`reconcileAllTeamChannels`):
 * reconciles every community that has completed finance onboarding.
 */
export const runNightlyReconcileAllCommunities = internalAction({
  args: {},
  handler: async (ctx) => {
    const communityIds = await ctx.runQuery(
      internal.functions.finance.jobs.listCommunitiesWithFinance,
      {},
    );
    for (const communityId of communityIds) {
      await ctx.runAction(internal.functions.finance.jobs.runNightlyReconcile, {
        communityId,
      });
    }
  },
});

// ============================================================================
// Hourly allocation retry (defensive backstop)
// ============================================================================

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Donations stuck "pending" longer than this are almost certainly not
 * waiting on a normal Stripe payout cycle (T+2) anymore — something in the
 * primary allocation trigger (the payout webhook, routed by the webhook
 * agent) didn't fire or failed. This is the backstop, not the primary path.
 *
 * Scans every pending donation across every community, hourly. That is the
 * `by_allocationStatus` index rather than the whole table, and pending is a
 * *transient* state (a healthy donation leaves it within T+2), so the working
 * set stays small. If a community ever accumulates a large stuck backlog this
 * becomes the wrong shape and wants a (allocationStatus, createdAt) index.
 */
export const getCommunitiesWithStalePendingDonations = internalQuery({
  args: { olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const cutoff = now() - args.olderThanMs;
    const pending = await ctx.db
      .query("donations")
      .withIndex("by_allocationStatus", (q) => q.eq("allocationStatus", "pending"))
      .collect();

    const communityIds = new Set<Id<"communities">>();
    for (const donation of pending) {
      if (donation.createdAt >= cutoff) continue;
      const fund = await ctx.db.get(donation.fundId);
      if (fund) {
        communityIds.add(fund.communityId);
      }
    }
    return Array.from(communityIds);
  },
});

/**
 * Communities holding a donation that a payout pass matched but never
 * transferred — with NO staleness window, unlike the alert path above.
 *
 * A bound donation isn't waiting on anything external: the payout has
 * already landed in the receiving Account and the row records exactly how
 * much of it belongs to this gift. Making it wait three days to be retried
 * would leave real money sitting in the wrong Account for no reason (and
 * Stripe stops redelivering `payout.paid` inside that window anyway).
 */
export const getCommunitiesWithStrandedAllocations = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"communities">[]> => {
    const pending = await ctx.db
      .query("donations")
      .withIndex("by_allocationStatus", (q) => q.eq("allocationStatus", "pending"))
      .collect();

    const communityIds = new Set<Id<"communities">>();
    for (const donation of pending) {
      if (!donation.allocationPayoutId) continue;
      const fund = await ctx.db.get(donation.fundId);
      if (fund) {
        communityIds.add(fund.communityId);
      }
    }
    return Array.from(communityIds);
  },
});

/**
 * Donations that a payout pass already matched (they carry
 * `allocationPayoutId` + `payoutNetCents`) but never transferred — the
 * residue of a partial failure. Everything needed to finish them is already
 * on the row: the exact payout they belong to and the exact NET Stripe
 * delivered for them. Nothing is inferred, so replaying them is safe.
 *
 * CLAIMS each item it returns, exactly like `planAllocations` does, and skips
 * anything another pass is still holding. This is the racy one: the cron
 * fires on a wall clock, so it will eventually land in the middle of a
 * `runAllocation` triggered by a payout webhook. Without the lease both would
 * issue the same `alloc:{donationId}` transfer concurrently.
 *
 * Modeled as an internal mutation, like `computePendingAllocationCents`
 * above, so the retry action can call it with the same plumbing.
 */
export const listResumableAllocations = internalMutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args): Promise<AllocationPlanItem[]> => {
    const funds = await ctx.db
      .query("funds")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const nowMs = now();
    const rows: Array<{ item: AllocationPlanItem; createdAt: number }> = [];
    for (const fund of funds) {
      const pendingDonations = await ctx.db
        .query("donations")
        .withIndex("by_fund", (q) => q.eq("fundId", fund._id))
        .filter((q) => q.eq(q.field("allocationStatus"), "pending"))
        .collect();
      for (const donation of pendingDonations) {
        if (!donation.allocationPayoutId) continue;
        if (donation.payoutNetCents === undefined) continue;
        // Same cap the planner applies: a refund that landed after the
        // binding has already reduced the ledger, so the stamped net can be
        // more than the gift is now worth.
        const netCents = allocationAmountCents(donation);
        if (!Number.isInteger(netCents) || netCents <= 0) {
          continue;
        }
        if (allocationLeaseHeld(donation, nowMs)) continue;
        await ctx.db.patch(donation._id, {
          allocationTransferStartedAt: nowMs,
          // Re-stamp: the cap can only have come DOWN since the binding (a
          // refund landed), and `recordAllocation` derives the `fee` entry
          // from this field. Leaving the stale net there would have it
          // computing a fee against money we no longer transferred.
          payoutNetCents: netCents,
        });
        rows.push({
          createdAt: donation.createdAt,
          item: {
            donationId: donation._id,
            fundId: fund._id,
            fundType: fund.type,
            amountCents: netCents,
          },
        });
      }
    }
    rows.sort(
      (a, b) =>
        a.createdAt - b.createdAt ||
        a.item.donationId.localeCompare(b.item.donationId),
    );
    return rows.map((row) => row.item);
  },
});

/**
 * Cron entry point: recover what can be recovered, alert on the rest.
 *
 * A donation stuck "pending" is one of two very different things.
 *
 * (a) BOUND to a payout, transfer never landed. Recoverable immediately —
 * no staleness window — because nothing has to be guessed: the row records
 * which payout it belongs to and the exact NET that payout delivered for it,
 * so the retry moves a known amount out of money known to have arrived, and
 * the `alloc:{donationId}` idempotency key collapses a retry of a transfer
 * that actually did land. Waiting three days here would leave real money in
 * the wrong Account for no reason (and Stripe stops redelivering
 * `payout.paid` inside that window anyway). Before net matching there was no
 * such record, which is why this job could only ever alert.
 *
 * (b) NOT bound to any payout: delayed, held, or a missed webhook. Stays
 * ALERT-ONLY past the three-day window, deliberately. Fabricating a
 * synthetic payout amount and moving money against the receiving Account
 * would be wrong — the funds may simply not be there, or belong to a
 * different payout (Codex review, PR #653). Recovery there is the real
 * payout webhook arriving, or a manual `runAllocation` with the actual
 * Stripe payout id and amount.
 */
export const retryStaleAllocations = internalAction({
  args: {},
  handler: async (ctx) => {
    // --- (a) Recover: finish the transfers a previous pass couldn't. ---
    const resumedByCommunity = new Map<Id<"communities">, AllocationRunResult>();
    const strandedCommunityIds: Id<"communities">[] = await ctx.runQuery(
      internal.functions.finance.jobs.getCommunitiesWithStrandedAllocations,
      {},
    );

    for (const communityId of strandedCommunityIds) {
      const resumable: AllocationPlanItem[] = await ctx.runMutation(
        internal.functions.finance.jobs.listResumableAllocations,
        { communityId },
      );
      if (resumable.length === 0) continue;

      const communityFinance = await ctx.runQuery(
        internal.functions.finance.jobs.getCommunityFinanceForAllocation,
        { communityId },
      );
      if (!communityFinance?.increaseReceivingAccountId) {
        console.error(
          `[finance] retryStaleAllocations: community ${communityId} has ${resumable.length} stranded allocation(s) but no receiving Account`,
        );
        continue;
      }

      const resumed = await executeAllocationItems(ctx, {
        receivingAccountId: communityFinance.increaseReceivingAccountId,
        items: resumable,
        context: "retryStaleAllocations",
      });
      resumedByCommunity.set(communityId, resumed);
      console.log(
        `[finance] retryStaleAllocations: community ${communityId} resumed ${resumed.allocated}/${resumable.length} stranded allocation(s), ${resumed.failed} still failing`,
      );
    }

    // --- (b) Alert: surface whatever is still pending past the window. ---
    const staleCommunityIds = await ctx.runQuery(
      internal.functions.finance.jobs.getCommunitiesWithStalePendingDonations,
      { olderThanMs: THREE_DAYS_MS },
    );

    const staleCutoffMs = now() - THREE_DAYS_MS;
    for (const communityId of staleCommunityIds) {
      // Scoped to the >3-day slice: the audit row this feeds is labelled
      // "pending for > 3 days", and summing the community's ENTIRE pending
      // balance into it (as this used to) reports this morning's gifts as
      // stalled money.
      const pending = await ctx.runMutation(
        internal.functions.finance.jobs.computePendingAllocationCents,
        { communityId, createdBeforeMs: staleCutoffMs },
      );
      const stalePendingCents = pending.reduce(
        (sum: number, p: PendingAllocation) => sum + p.pendingCents,
        0,
      );
      if (stalePendingCents <= 0) continue; // Step (a) cleared it.

      const resumed = resumedByCommunity.get(communityId);
      console.error(
        `[finance] allocation stale: community ${communityId} has ${stalePendingCents} cents of donations pending allocation for >3 days`,
      );
      await ctx.runMutation(
        internal.functions.finance.jobs.recordStaleAllocationAlert,
        {
          communityId,
          stalePendingCents,
          resumedCount: resumed?.allocated ?? 0,
          failedCount: resumed?.failed ?? 0,
        },
      );
    }
  },
});

export const recordStaleAllocationAlert = internalMutation({
  args: {
    communityId: v.id("communities"),
    stalePendingCents: v.number(),
    /** Stranded allocations this run managed to finish / still couldn't. */
    resumedCount: v.optional(v.number()),
    failedCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      action: "allocation.stale_pending",
      details: {
        stalePendingCents: args.stalePendingCents,
        thresholdDays: 3,
        resumedCount: args.resumedCount,
        failedCount: args.failedCount,
      },
    });
  },
});

// ============================================================================
// Hourly stuck-reimbursement retry (defensive backstop — expenses.ts §payReimbursement)
// ============================================================================

const STUCK_REIMBURSEMENT_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Approved reimbursements that never got an `increaseTransferId` after this
 * long almost certainly mean the `payReimbursement` scheduler run that
 * `approveExpense` fires never completed (a mid-flight crash, a transient
 * Increase outage, etc.) — this is the backstop, not the primary path.
 *
 * Modeled as an internal mutation (rather than a query), even though it
 * performs no writes, so `retryStuckReimbursements` can call it with the
 * same `ctx.runMutation` plumbing the rest of this file's jobs use — mirrors
 * `computePendingAllocationCents` above.
 *
 * No index on (kind, status, increaseTransferId) exists on `expenses` (only
 * `by_fund_status`, `by_submitter`, `by_increaseTransferId`) — this is a
 * full-table scan. Fine at today's expense volume; add a targeted index if
 * this ever shows up in profiles.
 */
export const listStuckReimbursements = internalMutation({
  args: {},
  handler: async (ctx): Promise<Doc<"expenses">[]> => {
    const cutoff = now() - STUCK_REIMBURSEMENT_THRESHOLD_MS;
    const rows = await ctx.db.query("expenses").collect();
    return rows.filter(
      (expense) =>
        expense.kind === "reimbursement" &&
        expense.status === "approved" &&
        !expense.increaseTransferId &&
        expense.updatedAt < cutoff,
    );
  },
});

/**
 * Cron entry point: re-schedules `payReimbursement` for every reimbursement
 * stuck "approved" with no transfer for more than
 * `STUCK_REIMBURSEMENT_THRESHOLD_MS`.
 *
 * Safe to retry unconditionally: `payReimbursement`'s `createAchTransfer`
 * call carries the idempotency key `reimb:{expenseId}` (see expenses.ts).
 * If the earlier run actually initiated the transfer at Increase before
 * crashing (e.g. before `recordReimbursementPaid` could record it), Increase
 * returns the SAME transfer for the same idempotency key instead of moving
 * money a second time — so a retry either completes a transfer that never
 * happened, or collapses into a no-op replay of one that did. Either way,
 * this can never double-pay a reimbursement.
 */
export const retryStuckReimbursements = internalAction({
  args: {},
  handler: async (ctx): Promise<{ retried: number }> => {
    const stuck = await ctx.runMutation(
      internal.functions.finance.jobs.listStuckReimbursements,
      {},
    );
    for (const expense of stuck) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.finance.expenses.payReimbursement,
        { expenseId: expense._id },
      );
    }
    return { retried: stuck.length };
  },
});

// ============================================================================
// Hourly card-transaction poll (bring-your-own providers, ADR-033 Phase 1)
// ============================================================================

/**
 * Pull settled card transactions for every community on a BYO card issuer.
 *
 * WHY THIS EXISTS ALONGSIDE A WEBHOOK. Privacy.com's capability profile says
 * `webhooks: "all"`, and it means it — every transaction event is pushed. But
 * a webhook endpoint that was down, mis-deployed, or slow for an hour loses
 * those deliveries permanently once the provider's retries expire, and unlike
 * Increase we have no `GET /events` feed to replay. So the poll is the
 * backstop that makes a missed delivery a delay instead of a hole in a
 * church's books. It is also, today, the only way a DECLINE reaches us at all
 * (`declineFeed: "poll"`).
 *
 * Both paths book a charge through the same `recordProviderTransaction`, and
 * the settlement recorder is idempotent on the provider transaction id, so
 * "the webhook already handled this" costs one read and writes nothing.
 *
 * PER-COMMUNITY try/catch, deliberately: one church's revoked API key must not
 * stop every other church's charges from importing. A failure flips that one
 * connection to "error" with the vendor's message, and the fan-out continues.
 */
export const pollCardProviderTransactions = internalAction({
  args: {},
  handler: async (ctx): Promise<{ polled: number; recorded: number }> => {
    const connections = await ctx.runQuery(
      internal.functions.finance.cardProviderConnections.listActiveConnections,
      {},
    );

    let recorded = 0;
    for (const connection of connections) {
      try {
        recorded += await pollOneConnection(ctx, connection);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[finance] card txn poll failed for community ${connection.communityId}: ${message}`,
        );
        await ctx.runMutation(
          internal.functions.finance.cardProviderConnections
            .recordConnectionSync,
          { connectionId: connection.connectionId, error: message },
        );
      }
    }

    return { polled: connections.length, recorded };
  },
});

/**
 * One connection's pull. Split out so the fan-out above stays a loop with a
 * try/catch and nothing else.
 *
 * The cursor is only written back on SUCCESS, and only through
 * `recordConnectionSync`, which never clears it — a poll that throws halfway
 * leaves the connection pointing at the last window it fully read, so the next
 * run re-reads rather than skips. Re-reading costs an idempotent no-op per
 * transaction; skipping costs a charge nobody ever sees.
 */
async function pollOneConnection(
  ctx: ActionCtx,
  connection: {
    connectionId: Id<"cardProviderConnections">;
    communityId: Id<"communities">;
    provider: string;
    syncCursor: string | null;
  },
): Promise<number> {
  const loaded = await ctx.runQuery(
    internal.functions.finance.jobs.getConnectionForPoll,
    { connectionId: connection.connectionId },
  );
  if (!loaded) return 0;

  const provider = await getCardProviderByName(
    loaded.providerName,
    loaded.connection,
  );
  if (!provider.listTransactions) {
    // A BYO provider with no pull feed can't be backstopped. Not an error —
    // just nothing to do — but worth saying out loud, because it means this
    // community's settlements depend entirely on webhooks arriving.
    console.log(
      `[finance] ${connection.provider} has no transaction feed to poll (community ${connection.communityId})`,
    );
    return 0;
  }

  const page = await provider.listTransactions(connection.syncCursor);

  let recorded = 0;
  for (const txn of page.transactions) {
    if (await recordProviderTransaction(ctx, connection.provider, txn, "CardTxnPoll")) {
      recorded++;
    }
  }

  await ctx.runMutation(
    internal.functions.finance.cardProviderConnections.recordConnectionSync,
    {
      connectionId: connection.connectionId,
      // `?? undefined` keeps the stored cursor when an adapter reports "caught
      // up" as null. The adapter is also written not to do that — see its
      // listTransactions — because losing this one number silently re-imports
      // or silently skips, and both are bad in ways nobody notices for weeks.
      syncCursor: page.nextCursor ?? undefined,
    },
  );

  return recorded;
}

/**
 * The connection row (credential still encrypted) plus the community's
 * resolved provider name, in one read — the action has no `ctx.db`.
 */
export const getConnectionForPoll = internalQuery({
  args: { connectionId: v.id("cardProviderConnections") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row || row.status !== "active") return null;
    const connection = await loadActiveProviderConnection(ctx, row.communityId);
    if (!connection) return null;
    return {
      providerName: await resolveCardProviderName(ctx, row.communityId),
      connection,
    };
  },
});

// ============================================================================
// Cron registration
// ============================================================================

/**
 * Registers this file's crons. Called from crons.ts (owned by the
 * orchestrator, not this task) as `registerFinanceCrons(crons)`, mirroring
 * `registerDevAssistantCrons(crons)`.
 */
export function registerFinanceCrons(crons: Crons): void {
  crons.daily(
    "finance-nightly-reconcile",
    { hourUTC: 7, minuteUTC: 0 },
    internal.functions.finance.jobs.runNightlyReconcileAllCommunities,
  );

  crons.hourly(
    "finance-allocation-retry",
    { minuteUTC: 45 },
    internal.functions.finance.jobs.retryStaleAllocations,
  );

  crons.hourly(
    "finance-stuck-reimbursement-retry",
    { minuteUTC: 20 },
    internal.functions.finance.jobs.retryStuckReimbursements,
  );

  // Minute 10: off the hour, and not sharing a minute with the two retries
  // above — three fan-outs starting together would compete for the same
  // action budget for no reason.
  crons.hourly(
    "finance-card-txn-poll",
    { minuteUTC: 10 },
    internal.functions.finance.jobs.pollCardProviderTransactions,
  );
}
