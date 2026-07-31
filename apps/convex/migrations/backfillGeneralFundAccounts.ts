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
 * Safe to re-run: `provisionFundAccount` no-ops on a fund that already has an
 * account, and its Increase call is idempotency-keyed on the fund id, so a
 * second run can never mint a second Account.
 *
 * Run with:
 *   npx convex run migrations/backfillGeneralFundAccounts:backfillGeneralFundAccounts
 */

import { internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

/**
 * Every general fund that still has no Increase Account, in a community
 * whose Entity exists (an Entity is the prerequisite for creating an Account
 * under it — communities that never finished onboarding are skipped and will
 * get their General Account from `provisionProviders` when they do).
 */
export const listGeneralFundsMissingAccount = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Id<"funds">>> => {
    const financeRows = await ctx.db.query("communityFinance").collect();

    const fundIds: Array<Id<"funds">> = [];
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

      fundIds.push(generalFund._id);
    }
    return fundIds;
  },
});

export const backfillGeneralFundAccounts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ provisioned: number }> => {
    const fundIds: Array<Id<"funds">> = await ctx.runQuery(
      internal.migrations.backfillGeneralFundAccounts
        .listGeneralFundsMissingAccount,
      {},
    );

    for (const fundId of fundIds) {
      // Run inline rather than scheduling: a migration should report what it
      // actually did, and provisionFundAccount records the account itself.
      await ctx.runAction(
        internal.functions.finance.onboarding.provisionFundAccount,
        { fundId },
      );
    }

    console.log(
      `[migration] backfillGeneralFundAccounts: provisioned ${fundIds.length} General Account(s)`,
    );
    return { provisioned: fundIds.length };
  },
});
