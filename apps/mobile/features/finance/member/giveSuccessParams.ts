/**
 * URL-param parsing for the give-success screen
 * (`app/groups/[group_id]/give-success.tsx`).
 *
 * Extracted as a pure function because the screen itself is a route component
 * that renders BEFORE auth has restored (it is reached by a plain browser
 * redirect from Stripe), so there is nothing to assert about it in jest beyond
 * this parsing — and everything worth asserting lives here.
 *
 * The params come off `success_url`, built by `buildGiveReturnUrls` in
 * apps/convex/functions/finance/giving.ts:
 *
 *   /groups/<id>/give-success?session_id=cs_...&amount=<cents>&fund=<enc>&community=<enc>
 *
 * They are attacker-adjacent in exactly one sense: anyone can type this URL
 * with any values. Nothing here is trusted for authorization — the screen only
 * ever thanks someone — so the whole contract is "never crash, never lie":
 * an unparseable amount hides the amount line rather than rendering "$NaN".
 */

/** What the give-success screen renders, derived from the URL alone. */
export interface GiveSuccessDisplay {
  /**
   * Formatted total charged (e.g. "$50.00"), or `null` when the `amount` param
   * is missing/garbage — in which case the screen shows no amount at all.
   */
  amountLabel: string | null;
  /** e.g. "First Church Inc. says thank you", or the community-agnostic fallback. */
  thankYouLine: string;
  /** e.g. "to Young Adults — Manhattan", or `null` when `fund` is missing. */
  fundLine: string | null;
}

/**
 * expo-router hands each param back as `string | string[] | undefined`
 * (repeated query keys become an array). Take the first value and nothing else.
 */
function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Formats integer cents as US dollars. Local rather than reusing
 * `../format`'s `formatCents` because this one has to reject non-integers and
 * negatives outright (a hand-typed `?amount=-1` must hide the line, not print
 * "-$0.01"), where `formatCents` faithfully renders whatever it is given.
 */
function formatAmountCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `$${dollars.toLocaleString("en-US")}.${remainder.toString().padStart(2, "0")}`;
}

export function parseGiveSuccessParams(params: {
  amount?: string | string[];
  fund?: string | string[];
  community?: string | string[];
}): GiveSuccessDisplay {
  const amountRaw = firstParam(params.amount);
  const fund = firstParam(params.fund);
  const community = firstParam(params.community);

  // `Number("")` is 0 and `Number(" 12 ")` is 12, so the string is validated by
  // shape first — only digits — rather than by whatever Number() tolerates.
  const amountCents =
    amountRaw && /^\d+$/.test(amountRaw) ? Number(amountRaw) : NaN;
  const amountLabel =
    Number.isSafeInteger(amountCents) && amountCents > 0
      ? formatAmountCents(amountCents)
      : null;

  return {
    amountLabel,
    // "Thank you 🎉" is the community-agnostic fallback: with no community
    // name there is no one to speak for, so the screen thanks in its own voice.
    thankYouLine: community ? `${community} says thank you` : "Thank you 🎉",
    fundLine: fund ? `to ${fund}` : null,
  };
}
