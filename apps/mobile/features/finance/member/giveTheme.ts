/**
 * The one non-neutral hue the member giving surfaces are allowed.
 *
 * Giving is money, not brand: the fund glyph tile and the success screen's
 * wash read as gold everywhere, independent of a community's `primaryColor`
 * (which the WA kit reserves for the "one accent thing per screen" rule).
 * Deliberately NOT sourced from `useCommunityTheme()` — the success screen
 * renders while auth is still restoring after the Stripe redirect and has no
 * community to read.
 */
export const GIVING_GOLD = "#B8860B";

/** Same gold at card-tint strength (glyph tiles, the success-screen wash). */
export const GIVING_GOLD_TINT = "rgba(184, 134, 11, 0.12)";

/** A hair stronger, for the success screen's radial-ish wash panel. */
export const GIVING_GOLD_WASH = "rgba(184, 134, 11, 0.16)";
