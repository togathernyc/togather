/**
 * Virtual-card spend policy (ADR-032 §3) — pure, no `ctx`.
 *
 * Mirrors lib/finance/expensePolicy.ts: the rules that govern a card's spend
 * limit live in exactly one place so the mutation that accepts a limit, the
 * action that pushes it to the bank, and the settlement-side drift check
 * can't disagree about what a limit means.
 *
 * A card's limit is REAL — Increase enforces it at authorization time via
 * `authorization_controls.usage.multi_use.spending_limits` (see
 * lib/finance/increase.ts's `createCard`). This module owns the translation
 * between Togather's period vocabulary ("week"/"month"/"charge") and
 * Increase's interval vocabulary, and the reset semantics that follow from
 * it — Increase's windows are UTC-anchored, not community-local, so the
 * window math here must stay UTC too or a drift check would disagree with
 * the bank about which charges fall inside a period.
 */

/** The period a card's spend limit covers (mirrors `cards.limitPeriod`). */
export type CardLimitPeriod = "week" | "month" | "charge";

/**
 * The subset of Increase's `spending_limits[].interval` enum we map onto.
 * Increase also offers `all_time` and `per_day`; neither has a Togather
 * period today, so they're deliberately absent rather than unreachable.
 */
export type IncreaseSpendingLimitInterval =
  | "per_transaction"
  | "per_week"
  | "per_month";

/**
 * Togather period -> Increase interval.
 *
 * Increase's documented reset semantics for these intervals (openapi.json,
 * `spending_limits[].interval`): `per_week` resets Mondays at midnight UTC,
 * `per_month` on the 1st at midnight UTC, `per_transaction` applies to each
 * individual authorization. The UI copy for each period must match these
 * exactly — that copy is a promise the bank keeps, not decoration.
 */
export const LIMIT_PERIOD_TO_INCREASE_INTERVAL: Record<
  CardLimitPeriod,
  IncreaseSpendingLimitInterval
> = {
  week: "per_week",
  month: "per_month",
  charge: "per_transaction",
};

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

/**
 * Start (inclusive, ms) of the limit window a charge at `atMs` falls into,
 * or `null` for "charge" — a per-transaction limit has no window, it applies
 * to the single amount.
 *
 * UTC-anchored to match Increase (see LIMIT_PERIOD_TO_INCREASE_INTERVAL).
 * Used only by the settlement-side drift check in webhooks.ts, which asks
 * "did the bank let through more than this card's limit?" — a question that
 * only has a meaningful answer if we slice time the same way the bank does.
 */
export function cardLimitWindowStart(
  limitPeriod: CardLimitPeriod,
  atMs: number,
): number | null {
  if (limitPeriod === "charge") return null;

  const at = new Date(atMs);
  if (limitPeriod === "month") {
    return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1);
  }
  // Week: back up to the most recent Monday. getUTCDay() is 0=Sunday, so
  // Sunday is 6 days into the week, not 0.
  const daysSinceMonday = (at.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(
    at.getUTCFullYear(),
    at.getUTCMonth(),
    at.getUTCDate(),
  );
  return midnight - daysSinceMonday * 24 * 60 * 60 * 1000;
}
