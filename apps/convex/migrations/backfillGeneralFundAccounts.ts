/**
 * Backfill: give every already-onboarded community's General Fund its own
 * Increase Account (ADR-032 §1).
 *
 * WHY: `recordProvisioned` created the "General Fund" row from day one but
 * never created the General *Account* to back it, so the fund carried no
 * `increaseAccountId`. Two things broke silently as a result — general-fund
 * donations were marked "allocated" with no transfer (their cash actually
 * sat in the receiving Account), and `getFundsWithIncreaseAccount` filtered
 * the fund out of the nightly reconcile entirely. New communities are fixed
 * at provisioning time; this closes the gap for the ones already live.
 *
 * THE HISTORY MATTERS MORE THAN THE ACCOUNT. Minting the Account is the easy
 * half; it is also the half that arms the nightly alarm. Those historically
 * "allocated"-with-no-transfer donations have ledger balance but zero bank
 * balance and zero pending, so the instant the fund enters reconcile scope it
 * reports `drift = its whole historical balance`, every night, forever.
 * `recordFundAccount` therefore reopens them to "pending" — what they
 * factually are — in the SAME transaction that binds the Account, so the fund
 * can never be in scope with un-settled history behind it. See the long
 * comment there.
 *
 * With `resumeAllocations` (default true) this then replays each of the
 * community's recorded Stripe payouts through the ordinary `runAllocation`
 * path, which reads the real per-charge NETs back off Stripe and moves the
 * cash receiving → General for real. That is the catch-up sweep: no bespoke
 * money-moving code, no invented amounts — the same audited, idempotency-keyed
 * transfers a live payout would have made.
 *
 * Safe to re-run: `provisionFundAccount` no-ops on a fund that already has an
 * account, its Increase call is idempotency-keyed on the fund id, and every
 * allocation transfer is keyed `alloc:{donationId}`.
 *
 * Run with (dry run first — reports what it WOULD do, writes nothing):
 *   npx convex run migrations/backfillGeneralFundAccounts:backfillGeneralFundAccounts '{"dryRun": true}'
 *   npx convex run migrations/backfillGeneralFundAccounts:backfillGeneralFundAccounts
 */

import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/** One general fund needing an Account, with the history behind it. */
export interface GeneralFundToBackfill {
  fundId: Id<"funds">;
  communityId: Id<"communities">;
  /** Donations marked "allocated" that can never have settled — see above. */
  settledWithoutTransferCount: number;
  settledWithoutTransferCents: number;
}

/**
 * Every general fund that still has no Increase Account, in a community
 * whose Entity exists (an Entity is the prerequisite for creating an Account
 * under it — communities that never finished onboarding are skipped and will
 * get their General Account from `provisionProviders` when they do).
 */
export const listGeneralFundsMissingAccount = internalQuery({
  args: {},
  handler: async (ctx): Promise<GeneralFundToBackfill[]> => {
    const financeRows = await ctx.db.query("communityFinance").collect();

    const funds: GeneralFundToBackfill[] = [];
    for (const finance of financeRows) {
      if (!finance.increaseEntityId) continue;

      const generalFund = await ctx.db
        .query("funds")
        .withIndex("by_community", (q) =>
          q.eq("communityId", finance.communityId),
        )
        .filter((q) => q.eq(q.field("type"), "general"))
        .first();
      if (!generalFund || generalFund.increaseAccountId) continue;
      if (generalFund.status === "closed") continue;

      const settled = await ctx.db
        .query("donations")
        .withIndex("by_fund", (q) => q.eq("fundId", generalFund._id))
        .filter((q) => q.eq(q.field("allocationStatus"), "allocated"))
        .collect();

      funds.push({
        fundId: generalFund._id,
        communityId: finance.communityId,
        settledWithoutTransferCount: settled.length,
        settledWithoutTransferCents: settled.reduce(
          (sum, d) =>
            sum + (d.payoutNetCents ?? d.amountCents + d.feeCoverCents),
          0,
        ),
      });
    }
    return funds;
  },
});

/** Donations on one fund still awaiting a transfer — the honest "did the sweep finish" read. */
export const countFundPendingDonations = internalQuery({
  args: { fundId: v.id("funds") },
  handler: async (ctx, args): Promise<number> => {
    const pending = await ctx.db
      .query("donations")
      .withIndex("by_fund", (q) => q.eq("fundId", args.fundId))
      .filter((q) => q.eq(q.field("allocationStatus"), "pending"))
      .collect();
    return pending.length;
  },
});

/** The payouts a community has already had an allocation pass run against. */
export const listRecordedPayouts = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ stripePayoutId: string; payoutCents: number }>> => {
    const rows = await ctx.db
      .query("processedStripePayouts")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
    return rows
      .map((row) => ({
        stripePayoutId: row.stripePayoutId,
        payoutCents: row.payoutCents,
      }))
      .sort((a, b) => a.stripePayoutId.localeCompare(b.stripePayoutId));
  },
});

export interface BackfillResult {
  /** General Accounts actually created AND recorded on the fund. */
  provisioned: number;
  /** Funds that needed no work by the time we got to them (concurrent run, re-run). */
  skipped: number;
  /** Funds whose provisioning threw — the run continued past them. */
  failed: number;
  /** Donations reopened from a never-transferred "allocated" (see module docs). */
  reopened: number;
  reopenedCents: number;
  /**
   * Donations the payout replay transferred. Counted across the whole
   * community, so it can exceed `reopened`: replaying a payout legitimately
   * finishes any other item of that payout still sitting pending.
   */
  resumed: number;
  /** Donations still awaiting a transfer on the backfilled general funds. */
  stillPending: number;
  /** Per-fund detail, so a failed run says exactly where it stopped short. */
  funds: Array<{
    fundId: Id<"funds">;
    communityId: Id<"communities">;
    status: "provisioned" | "skipped" | "failed";
    reopened: number;
    error?: string;
  }>;
}

/**
 * A payout replay reads Stripe once per payout. Communities with more history
 * than this get their Accounts and their reopened donations either way — the
 * hourly `retryStaleAllocations` and a manual `runAllocation` finish the rest
 * — but one migration invocation should not run unbounded provider calls.
 */
const MAX_PAYOUTS_REPLAYED_PER_COMMUNITY = 200;

export const backfillGeneralFundAccounts = internalAction({
  args: {
    /** Report what would happen; write nothing, call no provider. */
    dryRun: v.optional(v.boolean()),
    /**
     * Replay the community's recorded Stripe payouts afterwards so the
     * reopened donations actually move receiving → General. Default true —
     * turning it off leaves a correct, zero-drift ledger with the cash still
     * in the receiving Account, which `retryStaleAllocations` will alert on
     * (truthfully) after three days.
     */
    resumeAllocations: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BackfillResult> => {
    const resumeAllocations = args.resumeAllocations ?? true;
    const targets: GeneralFundToBackfill[] = await ctx.runQuery(
      internal.migrations.backfillGeneralFundAccounts
        .listGeneralFundsMissingAccount,
      {},
    );

    const result: BackfillResult = {
      provisioned: 0,
      skipped: 0,
      failed: 0,
      reopened: 0,
      reopenedCents: 0,
      resumed: 0,
      stillPending: 0,
      funds: [],
    };

    if (args.dryRun) {
      for (const target of targets) {
        result.funds.push({
          fundId: target.fundId,
          communityId: target.communityId,
          status: "provisioned",
          reopened: target.settledWithoutTransferCount,
        });
        result.provisioned += 1;
        result.reopened += target.settledWithoutTransferCount;
        result.reopenedCents += target.settledWithoutTransferCents;
      }
      result.stillPending = result.reopened;
      console.log(
        `[migration] backfillGeneralFundAccounts (DRY RUN): would provision ${result.provisioned} General Account(s) and reopen ${result.reopened} donation(s) worth ${result.reopenedCents} cents`,
      );
      return result;
    }

    for (const target of targets) {
      // PER-FUND ISOLATION: one community with a rejected Increase Entity
      // must not abort the run and leave ops guessing how far it got. Each
      // fund's outcome is recorded, and the loop continues.
      try {
        const outcome = await ctx.runAction(
          internal.functions.finance.onboarding.provisionFundAccount,
          { fundId: target.fundId },
        );

        // `provisioned` counts what `recordFundAccount` actually wrote, not
        // what we intended: provisionFundAccount fails soft (returns without
        // provisioning) on a community with no Increase Entity, so counting
        // intent could report a dozen provisioned having provisioned none.
        if (!outcome.provisioned) {
          result.skipped += 1;
          result.funds.push({
            fundId: target.fundId,
            communityId: target.communityId,
            status: "skipped",
            reopened: 0,
          });
          continue;
        }

        result.provisioned += 1;
        result.reopened += outcome.reopenedCount;
        result.reopenedCents += outcome.reopenedCents;
        result.funds.push({
          fundId: target.fundId,
          communityId: target.communityId,
          status: "provisioned",
          reopened: outcome.reopenedCount,
        });

        if (!resumeAllocations || outcome.reopenedCount === 0) {
          result.stillPending += outcome.reopenedCount;
          continue;
        }

        // Catch-up sweep. Nothing bespoke: replaying a recorded payout runs
        // the ordinary allocation pass, which re-reads that payout's real
        // per-charge NETs from Stripe, stamps them on the reopened donations, and
        // makes the receiving → General AccountTransfer the original pass
        // never made. Already-allocated donations are skipped by
        // planAllocations, and `alloc:{donationId}` collapses any transfer
        // that somehow did happen.
        const payouts: Array<{ stripePayoutId: string; payoutCents: number }> =
          await ctx.runQuery(
            internal.migrations.backfillGeneralFundAccounts
              .listRecordedPayouts,
            { communityId: target.communityId },
          );
        if (payouts.length > MAX_PAYOUTS_REPLAYED_PER_COMMUNITY) {
          console.error(
            `[migration] backfillGeneralFundAccounts: community ${target.communityId} has ${payouts.length} recorded payouts — replaying only the first ${MAX_PAYOUTS_REPLAYED_PER_COMMUNITY}; re-run or drive runAllocation by hand for the rest`,
          );
        }

        let resumedHere = 0;
        for (const payout of payouts.slice(
          0,
          MAX_PAYOUTS_REPLAYED_PER_COMMUNITY,
        )) {
          const run = await ctx.runAction(
            internal.functions.finance.jobs.runAllocation,
            {
              communityId: target.communityId,
              stripePayoutId: payout.stripePayoutId,
              payoutCents: payout.payoutCents,
            },
          );
          resumedHere += run.allocated;
        }
        result.resumed += resumedHere;
        // Read the leftover rather than subtracting: the replay also finishes
        // unrelated pending items of the same payouts, so arithmetic on
        // `reopenedCount` would understate what is genuinely still stuck.
        result.stillPending += await ctx.runQuery(
          internal.migrations.backfillGeneralFundAccounts
            .countFundPendingDonations,
          { fundId: target.fundId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed += 1;
        result.funds.push({
          fundId: target.fundId,
          communityId: target.communityId,
          status: "failed",
          reopened: 0,
          error: message.slice(0, 300),
        });
        console.error(
          `[migration] backfillGeneralFundAccounts: fund ${target.fundId} (community ${target.communityId}) failed — continuing`,
          error,
        );
      }
    }

    console.log(
      `[migration] backfillGeneralFundAccounts: provisioned ${result.provisioned}, skipped ${result.skipped}, failed ${result.failed}; reopened ${result.reopened} donation(s) worth ${result.reopenedCents} cents, of which ${result.resumed} transferred and ${result.stillPending} remain pending`,
    );
    return result;
  },
});
