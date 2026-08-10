/**
 * Dollar-input parsing + fee-cover estimation for the give / reimbursement
 * sheets (ADR-032). Pure functions — no Convex, no React.
 */

/**
 * Parses a user-typed dollar string into integer cents, or `null` if the
 * string isn't a valid positive amount.
 *
 * @param text - raw input, e.g. "25", "25.5", "$25.00"
 * @param allowCents - when `false` (the give sheet's custom-amount field,
 *   per ADR-032's "integer dollars -> cents"), a decimal point is rejected.
 *   Reimbursement amounts allow cents.
 */
export function parseDollarsToCents(
  text: string,
  { allowCents = true }: { allowCents?: boolean } = {},
): number | null {
  const trimmed = text.trim().replace(/^\$/, "");
  if (!trimmed) return null;

  const pattern = allowCents ? /^\d+(\.\d{1,2})?$/ : /^\d+$/;
  if (!pattern.test(trimmed)) return null;

  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;

  return Math.round(dollars * 100);
}

/**
 * Stripe's typical US card rate, charged on the amount that actually hits the
 * card — 2.9% + 30 cents.
 *
 * NOTE: deliberately duplicated in `apps/convex/lib/finance/fees.ts`. There is
 * no shared finance module in `packages/shared` to hold them, and inventing one
 * for two constants isn't worth a new cross-app import path. The server
 * re-derives the fee from its own copy and refuses a client number more than
 * 2c ABOVE it, so this copy drifting upward fails loudly at the
 * donation-creation seam instead of overcharging a card. Drifting downward is
 * allowed on purpose — that's what lets an old client keep giving through a
 * rollout — and is caught by the shared tests below, not at runtime.
 */
const STRIPE_FEE_RATE = 0.029;
const STRIPE_FEE_FIXED_CENTS = 30;

/** What Stripe takes off a charge of `totalCents`. */
function stripeFeeCents(totalCents: number): number {
  return Math.round(totalCents * STRIPE_FEE_RATE + STRIPE_FEE_FIXED_CENTS);
}

/**
 * The cents to ADD to a gift so the fund still nets `amountCents` after
 * Stripe's cut — the number behind the give sheet's "+$X so the fund gets the
 * full $Y" toggle.
 *
 * Stripe's percentage applies to the whole charge, fee included, so charging
 * `amount + fee(amount)` still leaves the fund short by the percentage of the
 * fee. Solving `total - (total * rate + fixed) = amount` gives the closed form
 * `total = (amount + fixed) / (1 - rate)`; the add-on is `total - amount`.
 * Rounded to the nearest cent, then nudged up a cent in the rare case that
 * rounding down would leave the fund a cent short — the toggle's promise is a
 * floor, not an approximation.
 */
export function estimateCoverFeesCents(amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  const grossedUpTotal = (amountCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_RATE);
  const fee = Math.round(grossedUpTotal - amountCents);
  const netToFund = amountCents + fee - stripeFeeCents(amountCents + fee);
  return netToFund < amountCents ? fee + 1 : fee;
}

/**
 * The give sheet's effective donation amount: a tapped preset chip wins over
 * the custom-amount field (mirrors the field being cleared/disabled on
 * preset selection in `GiveScreenView`).
 */
export function resolveGiveAmountCents(
  selectedPresetCents: number | null,
  customAmountText: string,
): number | null {
  if (selectedPresetCents !== null) return selectedPresetCents;
  return parseDollarsToCents(customAmountText, { allowCents: false });
}
