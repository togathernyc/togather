/**
 * Universal kill-switch for group giving (ADR-032).
 *
 * The entire feature is gated behind ONE app-wide feature flag —
 * `group-giving` in the admin feature-flags system (flipped by Togather
 * superusers at /(user)/admin/features via functions/admin/featureFlags.ts).
 * Default OFF: no row in `featureFlags` means disabled.
 *
 * What the gate covers: every PUBLIC finance entry point — reads that
 * surface the feature (getGivingContext/getFundOverview return null, which
 * hides every UI surface) and every money-initiating or state-granting
 * mutation/action (throws).
 *
 * What it deliberately does NOT cover: webhooks, crons, and internal
 * mutations. Money already in flight (a donation settling, a refund, a
 * payout allocation, a reimbursement mid-ACH) MUST settle correctly even if
 * the flag is flipped off mid-stream — gating settlement would corrupt the
 * ledger, not protect anything. Turning the flag off stops NEW activity;
 * it never stops bookkeeping.
 */

export const GROUP_GIVING_FLAG_KEY = "group-giving";

interface DbCtx {
  db: {
    query: (table: "featureFlags") => any;
  };
}

export async function isGroupGivingEnabled(ctx: DbCtx): Promise<boolean> {
  const flag = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q: any) => q.eq("key", GROUP_GIVING_FLAG_KEY))
    .first();
  return flag?.enabled ?? false;
}

/** Throw-on-disabled variant for mutations/actions that initiate activity. */
export async function requireGroupGivingEnabled(ctx: DbCtx): Promise<void> {
  if (!(await isGroupGivingEnabled(ctx))) {
    throw new Error(
      "Group giving is not enabled on this platform yet (feature flag \"group-giving\")",
    );
  }
}
