/**
 * Processor-fee math for donations (ADR-032 §3, the give sheet's "cover the
 * fees" toggle).
 *
 * NOTE: deliberately duplicated from `apps/mobile/features/finance/member/
 * amount.ts` — the mobile app and Convex share no finance module (there is no
 * finance surface in `packages/shared` today, and one wasn't worth inventing
 * for two constants). The client estimate is a *display* number; this copy is
 * the authority: `validateDonationAmount` re-derives the fee here and rejects a
 * client-supplied `coverFeesCents` that exceeds it, which is what keeps the
 * donation cap from being bypassable through the fee field.
 */

/** Stripe's typical US card rate, charged on the amount that hits the card. */
const STRIPE_FEE_RATE = 0.029;
const STRIPE_FEE_FIXED_CENTS = 30;

/** What Stripe takes off a charge of `totalCents`. */
function stripeFeeCents(totalCents: number): number {
  return Math.round(totalCents * STRIPE_FEE_RATE + STRIPE_FEE_FIXED_CENTS);
}

/**
 * The cents to ADD to a gift of `amountCents` so the fund still nets the full
 * amount after Stripe's cut.
 *
 * Stripe's percentage applies to the whole charge, fee included, so charging
 * `amount + fee(amount)` still leaves the fund short by the percentage of the
 * fee. Solving `total - (total * rate + fixed) = amount` gives the closed form
 * `total = (amount + fixed) / (1 - rate)`; the add-on is `total - amount`,
 * rounded to the nearest cent and nudged up a cent whenever rounding down would
 * leave the fund short.
 */
export function computeCoverFeesCents(amountCents: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  const grossedUpTotal = (amountCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_RATE);
  const fee = Math.round(grossedUpTotal - amountCents);
  const netToFund = amountCents + fee - stripeFeeCents(amountCents + fee);
  return netToFund < amountCents ? fee + 1 : fee;
}

/**
 * How far ABOVE the server's own number a client's fee may sit before we refuse
 * it: two cents, covering rounding drift between the two implementations (and
 * a future tweak to one of them) without leaving room to smuggle real money
 * past the donation cap.
 *
 * There is no matching floor — see `validateDonationAmount`. A fee under the
 * quote cannot bypass the cap, and rejecting one would lock out every donor
 * still running a pre-gross-up client.
 */
export const COVER_FEE_TOLERANCE_CENTS = 2;
