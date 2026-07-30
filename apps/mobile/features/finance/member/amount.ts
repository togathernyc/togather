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

/** Stripe's typical US card rate: 2.9% + 30 cents, rounded to the nearest cent. */
export function estimateCoverFeesCents(amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  return Math.round(amountCents * 0.029 + 30);
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
