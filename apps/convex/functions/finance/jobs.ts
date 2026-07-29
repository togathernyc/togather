/**
 * Allocation + nightly reconcile jobs (ADR-032 §3, §6 — Phase 2 background
 * plumbing, built here ahead of Increase going live so the seam is ready).
 *
 * Two background jobs live here:
 *
 *   1. ALLOCATION — Stripe pays a community out in bulk (T+2) to its
 *      Increase receiving Account. `planAllocations` decides, per donation,
 *      whether this payout covers it (oldest pending donation first, whole
 *      donations only — never split across payouts); `runAllocation` then
 *      moves each covered donation's money from the receiving Account to
 *      its group's Account via Increase and flips `donations.allocationStatus`.
 *
 *   2. NIGHTLY RECONCILE — per fund, compares our ledger's cached balance
 *      against the Increase Account balance (adjusted for donations still
 *      awaiting allocation) and alarms on drift. This is the invariant
 *      `checkInvariant` (lib/finance/ledger.ts) exists to check:
 *
 *        funds.balanceCents === Increase Account balance + pendingAllocationCents
 *
 * DESIGN DECISION — allocation does NOT post a second ledger entry:
 * `recordDonationSucceeded` (functions/finance/giving.ts) already credits
 * the fund's ledger balance in full the moment the donation succeeds — that
 * credit represents money Togather has *attributed* to the fund, not money
 * physically sitting in the fund's Increase Account yet (it's still in the
 * Stripe→receiving-Account pipeline). Allocation is purely a BANK-side move
 * of already-attributed money from the receiving Account to the group's
 * Account; crediting the ledger again here would double-count the fund's
 * balance. Instead, allocation only (a) flips `donations.allocationStatus`
 * to "allocated" and (b) writes a `financeAuditEvents` row
 * ("donation.allocated") carrying the Increase transfer id — the control-
 * plane record of the bank-side move, not a second balance-affecting entry.
 * The nightly-reconcile invariant is exactly what accounts for the gap this
 * creates: `pendingAllocationCents` (donations not yet allocated) is added
 * to the bank balance before comparing against the ledger balance, so a
 * fund whose donations are still "in transit" through Stripe's payout cycle
 * doesn't look like a drift.
 *
 * The Increase client (lib/finance/increase.ts) is being built concurrently
 * by another agent. Every call into it is a lazy `await import(...)` inside
 * an action body — never a top-level import — so this file's unit tests
 * never load it (see __tests__/finance-giving.test.ts, which exercises
 * `planAllocations` / `recordAllocation` / `recordReconcileResult` directly
 * with synthetic inputs and never touches `runAllocation` /
 * `runNightlyReconcile`'s provider calls).
 */

import { v } from "convex/values";
import type { Crons } from "convex/server";
import {
  internalMutation,
  internalAction,
  internalQuery,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { checkInvariant } from "../../lib/finance/ledger";
import { logFinanceAudit } from "../../lib/finance/audit";
import { now } from "../../lib/utils";

/** A donation never splits across payouts — this backstops that read. */
function donationTotalCents(donation: Pick<Doc<"donations">, "amountCents" | "feeCoverCents">): number {
  return donation.amountCents + donation.feeCoverCents;
}

// ============================================================================
// planAllocations
// ============================================================================

export interface AllocationPlanItem {
  donationId: Id<"donations">;
  fundId: Id<"funds">;
  fundType: "group" | "general";
  amountCents: number;
}

/**
 * Decides which pending donations a payout of `payoutCents` covers, without
 * moving any money. Oldest-first, whole donations only: walks the
 * community's pending donations in `createdAt` order and keeps adding while
 * the running total still fits under `payoutCents`; stops at the first
 * donation that would push it over (rather than skipping ahead to a
 * smaller later one) — a real Stripe payout is the sum of a contiguous
 * block of the oldest charges collected since the last payout, so this
 * mirrors how the money actually arrived. `leftoverCents` is almost always
 * the Stripe processing fees taken out of the payout — money that will
 * never match a whole donation and is expected to sit as leftover.
 */
export const planAllocations = internalMutation({
  args: {
    communityId: v.id("communities"),
    payoutCents: v.number(),
    stripePayoutId: v.string(),
  },
  handler: async (ctx, args) => {
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
    pending.sort((a, b) => a.createdAt - b.createdAt);

    const plan: AllocationPlanItem[] = [];
    let usedCents = 0;
    for (const donation of pending) {
      const total = donationTotalCents(donation);
      if (usedCents + total > args.payoutCents) {
        break;
      }
      plan.push({
        donationId: donation._id,
        fundId: donation.fundId,
        fundType: donation.fundType,
        amountCents: total,
      });
      usedCents += total;
    }

    return { plan, leftoverCents: args.payoutCents - usedCents };
  },
});

// ============================================================================
// recordAllocation
// ============================================================================

/**
 * Flips a donation's `allocationStatus` to "allocated" and audit-logs the
 * Increase transfer id. Deliberately does NOT post a ledger entry — see the
 * file-level "DESIGN DECISION" comment above. Idempotent: a donation
 * already marked "allocated" is a no-op (safe if `runAllocation` retries
 * after a partial failure).
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

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: "donation.allocated",
      details: {
        donationId: args.donationId,
        increaseTransferId: args.increaseTransferId,
        amountCents: donationTotalCents(donation),
      },
    });
  },
});

// ============================================================================
// runAllocation
// ============================================================================

/**
 * Executes an allocation plan: for each planned donation on a GROUP fund,
 * transfers the money from the community's receiving Account to the
 * fund's Increase Account, then records it. General-fund donations don't
 * need a transfer — the community's General Account is Increase's landing
 * spot for money that isn't earmarked to a specific group in the first
 * place — so those are recorded directly with no `increaseTransferId`.
 *
 * The Increase transfer's idempotency key (`alloc:${donationId}`) means a
 * re-run after a partial failure (e.g. the transfer succeeded but this
 * action crashed before calling `recordAllocation`) is safe: the next
 * `planAllocations` call re-selects the still-"pending" donation, and
 * Increase returns the same transfer for the same idempotency key instead
 * of moving the money twice.
 */
export const runAllocation = internalAction({
  args: {
    communityId: v.id("communities"),
    stripePayoutId: v.string(),
    payoutCents: v.number(),
  },
  handler: async (ctx, args) => {
    const { plan } = await ctx.runMutation(
      internal.functions.finance.jobs.planAllocations,
      {
        communityId: args.communityId,
        payoutCents: args.payoutCents,
        stripePayoutId: args.stripePayoutId,
      },
    );

    if (plan.length === 0) {
      return { allocated: 0 };
    }

    const communityFinance = await ctx.runQuery(
      internal.functions.finance.jobs.getCommunityFinanceForAllocation,
      { communityId: args.communityId },
    );
    if (!communityFinance?.increaseReceivingAccountId) {
      console.error(
        `[finance] runAllocation: community ${args.communityId} has no receiving Account — skipping ${plan.length} planned item(s)`,
      );
      return { allocated: 0 };
    }

    let allocated = 0;
    for (const item of plan) {
      if (item.fundType === "group") {
        const fund = await ctx.runQuery(
          internal.functions.finance.jobs.getFundForAllocation,
          { fundId: item.fundId },
        );
        if (!fund?.increaseAccountId) {
          console.error(
            `[finance] runAllocation: fund ${item.fundId} has no Increase Account — skipping donation ${item.donationId}`,
          );
          continue;
        }

        const { createAccountTransfer } = await import("../../lib/finance/increase");
        const transfer = await createAccountTransfer({
          fromAccountId: communityFinance.increaseReceivingAccountId,
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
    }

    return { allocated };
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
 * Sums pending (not-yet-allocated) donation totals per fund for a
 * community — the `pendingAllocationCents` term in the ADR-032 invariant.
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
        (sum, donation) => sum + donationTotalCents(donation),
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
 * Cron entry point: for every community with pending donations older than
 * three days, runs an allocation pass covering all of them. `stripePayoutId`
 * is synthetic (`retry:...`) since this isn't triggered by a real Stripe
 * payout — it exists purely for the audit trail.
 */
export const retryStaleAllocations = internalAction({
  args: {},
  handler: async (ctx) => {
    const communityIds = await ctx.runQuery(
      internal.functions.finance.jobs.getCommunitiesWithStalePendingDonations,
      { olderThanMs: THREE_DAYS_MS },
    );

    for (const communityId of communityIds) {
      const pending = await ctx.runMutation(
        internal.functions.finance.jobs.computePendingAllocationCents,
        { communityId },
      );
      const payoutCents = pending.reduce(
        (sum: number, p: PendingAllocation) => sum + p.pendingCents,
        0,
      );
      if (payoutCents <= 0) continue;

      await ctx.runAction(internal.functions.finance.jobs.runAllocation, {
        communityId,
        payoutCents,
        stripePayoutId: `retry:${communityId}:${now()}`,
      });
    }
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
