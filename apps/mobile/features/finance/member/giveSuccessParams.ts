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

/**
 * Percent-encodes a fund/community name for the give-success query string.
 *
 * A deliberate mirror of `urlSafeName` in
 * apps/convex/functions/finance/giving.ts, which builds the same two params for
 * Stripe's `success_url`. Both ends need it because the native flow never sees
 * that URL — `GiveScreen` builds its own from the status query's raw names —
 * and `encodeURIComponent` throws `URIError` on an unpaired surrogate. Thrown
 * from inside the auto-advance effect, that would swallow the thank-you AFTER
 * the navigate-once guard has latched, so the donor gets nothing at all.
 *
 * `for...of` walks whole code points, so valid pairs survive and only true
 * orphans (including one the slice may have just created) are dropped.
 */
export function urlSafeName(value: string): string {
  let safe = "";
  for (const char of value.slice(0, 100)) {
    const code = char.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) continue;
    safe += char;
  }
  return encodeURIComponent(safe);
}

/** What the give-success screen renders, derived from the URL alone. */
export interface GiveSuccessDisplay {
  /**
   * Formatted total charged (e.g. "$50.00"), or `null` when the `amount` param
   * is missing/garbage — in which case the screen shows no amount at all.
   */
  amountLabel: string | null;
  /** e.g. "First Church Inc. says thank you", or the community-agnostic fallback. */
  thankYouLine: string;
  /**
   * e.g. "to Young Adults — Manhattan" — or "every month to …" for a monthly
   * gift, which is the one thing that number under it doesn't say on its own.
   * `null` when neither a fund nor `recurring` is set.
   */
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
  /** `"1"` for a monthly gift — set by `buildGiveReturnUrls` and by
   * `GiveScreen`'s own recurring watcher. Anything else reads as one-off. */
  recurring?: string | string[];
}): GiveSuccessDisplay {
  const amountRaw = firstParam(params.amount);
  const fund = firstParam(params.fund);
  const community = firstParam(params.community);
  const recurring = firstParam(params.recurring) === "1";

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
    //
    // A monthly gift gets its own thanks because the donor just committed to
    // something ongoing, and a thank-you identical to a one-off's leaves the
    // biggest thing they did unacknowledged.
    thankYouLine: recurring
      ? community
        ? `${community} says thank you for giving monthly`
        : "Thank you for giving monthly 🎉"
      : community
        ? `${community} says thank you`
        : "Thank you 🎉",
    // The amount above this line is one month's charge, not a total — without
    // "every month" the screen reads as a one-off for the same money.
    fundLine: recurring
      ? fund
        ? `every month to ${fund}`
        : "every month"
      : fund
        ? `to ${fund}`
        : null,
  };
}
