/**
 * Allocation + nightly reconcile jobs (ADR-032 §3, §6 — Phase 2 background
 * plumbing, built here ahead of Increase going live so the seam is ready).
 *
 * Two background jobs live here:
 *
 *   1. ALLOCATION — Stripe pays a community out in bulk (T+2) to its
 *      Increase receiving Account. `runAllocation` asks Stripe which charges
 *      composed that payout and at what NET (gross minus the processing fee
 *      Stripe already took), `planAllocations` binds each of those charges'
 *      donations to the payout, and each bound donation's net is then moved
 *      from the receiving Account to its group's Account via Increase,
 *      flipping `donations.allocationStatus`.
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
 * move of already-attributed money from the receiving Account to the group's
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
 * point on, net is all that will ever arrive.)
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
 * be transferred on. Before that, gross is the honest estimate: the fee
 * hasn't been taken yet as far as anything we can observe is concerned, and
 * gross is what the ledger credited. Both the allocation plan and the
 * nightly reconcile read the amount through here so they can never disagree
 * about what "pending" is worth.
 */
function allocationAmountCents(
  donation: Pick<Doc<"donations">, "amountCents" | "feeCoverCents" | "payoutNetCents">,
): number {
  return donation.payoutNetCents ?? donationTotalCents(donation);
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
  /** Payout cents not matched to any donation — the Stripe processing fees. */
  leftoverCents: number;
  /** True when this payout had already been planned (a redelivered webhook). */
  alreadyClaimed: boolean;
}

/**
 * Binds a payout's donations to that payout and returns the ones still
 * needing a transfer. No money moves here.
 *
 * `charges` is the payout's composition straight from Stripe
 * (`listPayoutChargeNets` in lib/finance/stripeConnect.ts): one entry per
 * charge the payout contained, keyed by PaymentIntent id, valued at the NET
 * cents that charge contributed. Membership is therefore read off Stripe,
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
 * `leftoverCents` is the payout minus every matched net: the Stripe
 * processing fees, plus anything in the payout we couldn't map to a donation.
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

    const pending: Array<Doc<"donations"> & { fundType: "group" | "general" }> = [];
    for (const fund of funds) {
      const fundDonations = await ctx.db
        .query("donations")
        .withIndex("by_fund", (q) => q.eq("fundId", fund._id))
        .filter((q) => q.eq(q.field("allocationStatus"), "pending"))
        .collect();
      for (const donation of fundDonations) {
        pending.push({ ...donation, fundType: fund.type });
      }
    }
    // Deterministic order: oldest gift first, tie-broken by id so two runs
    // over the same data always plan the same sequence.
    pending.sort((a, b) => a.createdAt - b.createdAt || a._id.localeCompare(b._id));

    const plan: AllocationPlanItem[] = [];
    let usedCents = 0;
    for (const donation of pending) {
      if (
        donation.allocationPayoutId &&
        donation.allocationPayoutId !== args.stripePayoutId
      ) {
        continue; // Belongs to another payout's pass.
      }

      let netCents: number;
      if (donation.allocationPayoutId === args.stripePayoutId) {
        // Resume: an earlier pass over this payout matched this donation but
        // its transfer never landed. Re-use the net already recorded rather
        // than re-deriving it, so the retry moves the identical amount.
        netCents = donation.payoutNetCents ?? 0;
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
        // Defensive only: the nets came out of this payout, so they sum to
        // it by construction. `continue` (never `break`) so one oversized
        // outlier can't wedge the queue behind it forever, which is exactly
        // how the old gross matcher stalled.
        if (usedCents + matched > args.payoutCents) {
          console.error(
            `[finance] planAllocations: donation ${donation._id} (net ${matched}) would overrun payout ${args.stripePayoutId} (${args.payoutCents}, ${usedCents} used) — skipping it, not the rest`,
          );
          continue;
        }
        netCents = matched;
        await ctx.db.patch(donation._id, {
          allocationPayoutId: args.stripePayoutId,
          payoutNetCents: netCents,
        });
      }

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

    await ctx.db.patch(args.donationId, { allocationStatus: "allocated" });

    const grossCents = donationTotalCents(donation);
    const netCents = donation.payoutNetCents;
    // Legacy rows (allocated before net matching shipped) carry no net, so
    // there's no fee to realise for them — leave the ledger alone rather
    // than inventing a number.
    const feeCents = netCents === undefined ? 0 : grossCents - netCents;
    if (feeCents < 0) {
      // Net above gross is impossible from Stripe; refusing to post rather
      // than crediting a fund for a number we don't understand.
      console.error(
        `[finance] recordAllocation: donation ${args.donationId} has net ${netCents} above gross ${grossCents} — not posting a fee entry`,
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
 * Records that one item of an allocation pass failed to transfer, without
 * failing the pass. The donation stays "pending" but keeps its
 * `allocationPayoutId`/`payoutNetCents` stamp, so a redelivered webhook or
 * the hourly retry cron picks up exactly this item again — see
 * `executeAllocationItems`.
 */
export const recordAllocationFailure = internalMutation({
  args: {
    donationId: v.id("donations"),
    fundId: v.id("funds"),
    amountCents: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
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
      action: "allocation.transfer_failed",
      details: {
        donationId: args.donationId,
        amountCents: args.amountCents,
        reason: args.reason,
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
 * EXACTLY-ONCE across those retries comes from two independent locks:
 *  - `recordAllocation` no-ops on an already-"allocated" donation, so a
 *    finished item is never re-planned or re-recorded; and
 *  - the Increase idempotency key `alloc:{donationId}` means that even the
 *    genuinely ambiguous case — the transfer succeeded but this action died
 *    before recording it — replays into the SAME transfer at Increase
 *    rather than a second movement of money.
 *
 * General-fund donations need no transfer: the community's General Account
 * is where money that isn't earmarked to a group belongs in the first place,
 * so those are recorded directly with no `increaseTransferId`.
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

  for (const item of args.items) {
    try {
      if (item.fundType === "group") {
        const fund: Doc<"funds"> | null = await ctx.runQuery(
          internal.functions.finance.jobs.getFundForAllocation,
          { fundId: item.fundId },
        );
        if (!fund?.increaseAccountId) {
          throw new Error(
            `fund ${item.fundId} has no Increase Account to transfer into`,
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

        await ctx.runMutation(internal.functions.finance.jobs.recordAllocation, {
          donationId: item.donationId,
          increaseTransferId: transfer.id,
        });
      } else {
        await ctx.runMutation(internal.functions.finance.jobs.recordAllocation, {
          donationId: item.donationId,
        });
      }
      allocated += 1;
    } catch (error) {
      failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[finance] ${args.context}: allocation failed for donation ${item.donationId} (${item.amountCents} cents) — it stays pending and will be retried`,
        error,
      );
      try {
        await ctx.runMutation(
          internal.functions.finance.jobs.recordAllocationFailure,
          {
            donationId: item.donationId,
            fundId: item.fundId,
            amountCents: item.amountCents,
            reason,
          },
        );
      } catch (auditError) {
        // Never let the bookkeeping of a failure become the thing that
        // aborts the remaining transfers.
        console.error(
          `[finance] ${args.context}: could not audit the allocation failure for donation ${item.donationId}`,
          auditError,
        );
      }
    }
  }

  return { allocated, failed };
}

/**
 * `payout.paid` entry point: allocate one Stripe payout into group Accounts.
 *
 * Order matters. Stripe is asked for the payout's composition BEFORE
 * anything is written, so an unreachable Stripe leaves the payout completely
 * untouched and the webhook redelivery (or the hourly retry) simply tries
 * again — rather than claiming a payout we then can't match, which is how
 * money used to get stranded. The action deliberately does not throw on a
 * failed item: it reports counts, audits each failure, and leaves the item
 * pending for the next pass.
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

    const { listPayoutChargeNets } = await import("../../lib/finance/stripeConnect");
    const charges = await listPayoutChargeNets(
      communityFinance.stripeConnectedAccountId,
      args.stripePayoutId,
    );

    const { plan, alreadyClaimed } = await ctx.runMutation(
      internal.functions.finance.jobs.planAllocations,
      {
        communityId: args.communityId,
        payoutCents: args.payoutCents,
        stripePayoutId: args.stripePayoutId,
        charges,
      },
    );

    if (alreadyClaimed) {
      console.log(
        `[finance] runAllocation: payout ${args.stripePayoutId} was already planned — resuming ${plan.length} unfinished item(s)`,
      );
    }
    if (plan.length === 0) {
      return { allocated: 0, failed: 0 };
    }

    if (!communityFinance.increaseReceivingAccountId) {
      console.error(
        `[finance] runAllocation: community ${args.communityId} has no receiving Account — ${plan.length} matched item(s) stay pending`,
      );
      return { allocated: 0, failed: plan.length };
    }

    return await executeAllocationItems(ctx, {
      receivingAccountId: communityFinance.increaseReceivingAccountId,
      items: plan,
      context: "runAllocation",
    });
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
  args: { communityId: v.id("communities") },
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
        (sum, donation) => sum + allocationAmountCents(donation),
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
 * Modeled as an internal mutation, like `computePendingAllocationCents`
 * above, so the retry action can call it with the same plumbing; it performs
 * no writes.
 */
export const listResumableAllocations = internalMutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args): Promise<AllocationPlanItem[]> => {
    const funds = await ctx.db
      .query("funds")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    const rows: Array<{ item: AllocationPlanItem; createdAt: number }> = [];
    for (const fund of funds) {
      const pendingDonations = await ctx.db
        .query("donations")
        .withIndex("by_fund", (q) => q.eq("fundId", fund._id))
        .filter((q) => q.eq(q.field("allocationStatus"), "pending"))
        .collect();
      for (const donation of pendingDonations) {
        if (!donation.allocationPayoutId) continue;
        const netCents = donation.payoutNetCents;
        if (netCents === undefined || !Number.isInteger(netCents) || netCents <= 0) {
          continue;
        }
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

    for (const communityId of staleCommunityIds) {
      const pending = await ctx.runMutation(
        internal.functions.finance.jobs.computePendingAllocationCents,
        { communityId },
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
}
