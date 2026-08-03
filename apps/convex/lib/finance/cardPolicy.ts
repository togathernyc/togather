/**
 * Virtual-card spend policy — PROVIDER-NEUTRAL, pure, no `ctx` (ADR-032 §3,
 * narrowed by ADR-033).
 *
 * Mirrors lib/finance/expensePolicy.ts: the rules that govern a card's spend
 * limit live in exactly one place so the mutation that accepts a limit, the
 * action that pushes it to the provider, and the settlement-side drift check
 * can't disagree about what a limit means.
 *
 * What's left here is what EVERY issuer inherits: the period vocabulary, and
 * the rule that a limit is whole positive cents and not a slipped decimal.
 * The Increase-specific pieces that used to live alongside it — the
 * period -> `spending_limits[].interval` map and the UTC window math that
 * follows from Increase's own reset rules — moved to
 * lib/finance/cardProviders/increase.ts when ADR-033 introduced the adapter
 * seam. A second issuer resets its windows differently, and a shared module
 * that silently encodes one bank's calendar is a bug waiting for the second
 * bank.
 *
 * A card's limit is REAL, not advisory: the provider enforces it at
 * authorization time (Increase via
 * `authorization_controls.usage.multi_use.spending_limits`), so our stored
 * copy is a mirror and the provider's copy is the control.
 */

/** The period a card's spend limit covers (mirrors `cards.limitPeriod`). */
export type CardLimitPeriod = "week" | "month" | "charge";

/**
 * A limit is integer cents, strictly positive, and capped well below any
 * plausible group-fund card. The cap is a typo guard, not a policy ceiling —
 * the fund's own Increase Account balance is the real limit, and a
 * six-figure per-week card limit on a small-group fund is a slipped decimal,
 * not an intention.
 */
export const MIN_CARD_LIMIT_CENTS = 1;
export const MAX_CARD_LIMIT_CENTS = 10_000_000; // $100,000

/**
 * Validate a spend-limit pair, throwing a user-safe message on anything the
 * bank would reject or a human would regret. Both fields absent means "no
 * limit" and is always valid; one without the other never is — a period with
 * no amount silently caps nothing, and an amount with no period has no
 * interval to send to Increase.
 */
export function validateCardLimit(
  spendLimitCents: number | undefined,
  limitPeriod: CardLimitPeriod | undefined,
): void {
  if (spendLimitCents === undefined && limitPeriod === undefined) {
    return;
  }
  if (spendLimitCents === undefined || limitPeriod === undefined) {
    throw new Error(
      "A spending limit needs both an amount and a period — pick both, or neither for no limit",
    );
  }
  if (!Number.isInteger(spendLimitCents)) {
    throw new Error("A spending limit must be a whole number of cents");
  }
  if (spendLimitCents < MIN_CARD_LIMIT_CENTS) {
    throw new Error("A spending limit must be more than $0");
  }
  if (spendLimitCents > MAX_CARD_LIMIT_CENTS) {
    throw new Error(
      `A spending limit can't be more than $${(MAX_CARD_LIMIT_CENTS / 100).toLocaleString("en-US")}`,
    );
  }
}
