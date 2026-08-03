/**
 * The Increase card-provider adapter (ADR-033) — the reference implementation
 * of `CardProviderAdapter`, and the one every community uses today.
 *
 * It is a thin translation layer over lib/finance/increase.ts, which stays
 * the only place that speaks HTTP to Increase. Nothing here makes a network
 * call directly; that separation is what lets finance-cards.test.ts keep
 * mocking `lib/finance/increase` and still assert the exact payload the bank
 * receives through the adapter.
 *
 * This file also owns the two pieces of `cardPolicy` that were never policy
 * at all but Increase SEMANTICS: the period -> interval map, and the window
 * math that follows from Increase's reset rules. They moved here because a
 * second issuer resets its windows differently, and a shared module that
 * silently encodes one bank's calendar is a bug waiting for the second bank.
 * `validateCardLimit` stayed in cardPolicy.ts — "a limit is whole positive
 * cents and not a slipped decimal" is a Togather rule that every provider
 * inherits.
 */

import {
  createCard as increaseCreateCard,
  updateCardStatus as increaseUpdateCardStatus,
  updateCardSpendingLimit as increaseUpdateCardSpendingLimit,
  type IncreaseCardSpendingLimit,
  type IncreaseSpendingLimitInterval,
} from "../increase";
import type { CardLimitPeriod } from "../cardPolicy";
import type {
  CardProviderAdapter,
  CardState,
  CardStateRequest,
  NormalizedLimit,
  ProviderCapabilities,
  ProviderCard,
} from "./types";

// ============================================================================
// Increase's spend-limit semantics (moved here from lib/finance/cardPolicy.ts)
// ============================================================================

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
 * Start (inclusive, ms) of the limit window a charge at `atMs` falls into,
 * or `null` for "charge" — a per-transaction limit has no window, it applies
 * to the single amount.
 *
 * UTC-anchored to match Increase (see LIMIT_PERIOD_TO_INCREASE_INTERVAL).
 * Used only by the settlement-side drift check in webhooks.ts, which asks
 * "did the bank let through more than this card's limit?" — a question that
 * only has a meaningful answer if we slice time the same way the bank does.
 * Increase-specific by construction, which is why it lives in the Increase
 * adapter rather than in the shared policy module.
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

// ============================================================================
// Translation
// ============================================================================

/** Our normalized limit -> the shape lib/finance/increase.ts sends. `null` stays `null`: Increase must be told "no limit" explicitly. */
function toIncreaseLimit(
  limit: NormalizedLimit | null,
): IncreaseCardSpendingLimit | null {
  if (!limit) return null;
  if (limit.period === "lifetime") {
    // Increase's `spending_limits[].interval` has no lifetime window, and
    // degrading one to `per_year` would silently reset a cap that is supposed
    // never to. Unreachable in practice — a lifetime limit only comes from the
    // managed-limit path, and `INCREASE_CAPABILITIES.managedFundLimit` is false
    // — so this is the adapter refusing to guess rather than a live branch.
    throw new Error(
      "Increase has no lifetime spending limit — a managed fund limit cannot be applied to an Increase card",
    );
  }
  return {
    interval: LIMIT_PERIOD_TO_INCREASE_INTERVAL[limit.period],
    settlementAmountCents: limit.limitCents,
  };
}

/** Our requested state -> Increase's `status` enum on PATCH /cards/{id}. */
const STATE_TO_INCREASE_STATUS: Record<
  CardStateRequest,
  "active" | "disabled" | "canceled"
> = {
  active: "active",
  paused: "disabled",
  closed: "canceled",
};

/**
 * Increase's card status -> our vocabulary.
 *
 * Increase's `card.status` enum is `active` | `disabled` | `canceled`. An
 * unrecognized value maps to `"failed"` rather than being passed through: an
 * unknown state is not a state we can reason about, and pretending it is
 * active would be the dangerous direction to guess in.
 */
export function increaseStatusToCardState(status: string): CardState {
  switch (status) {
    case "active":
      return "active";
    case "disabled":
      return "paused";
    case "canceled":
      return "closed";
    default:
      return "failed";
  }
}

function toProviderCard(
  card: { id: string; status: string; last4?: string },
): ProviderCard {
  return {
    providerCardId: card.id,
    last4: card.last4,
    state: increaseStatusToCardState(card.status),
    providerStatus: card.status,
  };
}

// ============================================================================
// Capabilities
// ============================================================================

/**
 * Increase's capability profile. Every value is a claim about the bank,
 * verified against https://increase.com/openapi.json and
 * https://increase.com/documentation/launch-a-card-program, not assumed.
 */
export const INCREASE_CAPABILITIES: ProviderCapabilities = {
  // One Increase Account per fund, and a card is bound to its Account — the
  // ADR-032 invariant. A card physically cannot overdraw its fund or reach
  // another fund's balance.
  hardFundIsolation: true,
  // `spending_limits[].interval` includes `per_week`.
  weeklyLimits: true,
  // PATCH /cards/{id} accepts `status: "canceled"`, and Increase documents no
  // transition back out of it — a canceled card is dead, which is exactly what
  // `cancelCard`'s "irreversible" copy promises.
  cardCloseReversible: false,
  // "disabled" <-> "active" is a plain PATCH in both directions; that
  // round trip is what `setCardFrozen` relies on.
  cardFreezeReversible: true,
  // Increase pushes every event this module needs — card status changes and
  // `transaction.created` settlements both arrive on the webhook endpoint
  // functions/finance/webhooks.ts already verifies and handles.
  webhooks: "all",
  // Declines arrive as `card_decline` events on the same webhook feed.
  declineFeed: "webhook",
  // No documented per-month card cap.
  maxCardsPerMonth: null,
  // No reason to cap: the fund owns its Account, so a second card is a second
  // instrument on the SAME bank-enforced boundary rather than a second copy of
  // it. Two cards on an Increase fund can still only ever spend that fund.
  maxCardsPerFund: null,
  // Nothing to manage. `hardFundIsolation` already makes "up to the fund's
  // balance" literally true at the bank, so a Togather-computed cap would add
  // a second, weaker copy of a guarantee that already holds.
  managedFundLimit: false,
  // No receipt API. Increase's card transactions carry no document upload.
  receiptForwarding: false,
  // The card spends the fund's real Increase Account balance — money we
  // already hold. There is nothing to prefund and no statement to repay.
  repaymentVisibility: "n/a",
};

// ============================================================================
// The adapter
// ============================================================================

export const increaseCardProvider: CardProviderAdapter = {
  name: "increase",
  capabilities: INCREASE_CAPABILITIES,

  async createCard(input) {
    const card = await increaseCreateCard(
      input.fundAccountRef,
      input.description,
      input.idempotencyKey,
      toIncreaseLimit(input.limit),
    );
    return toProviderCard(card);
  },

  async setCardState(providerCardId, state) {
    const result = await increaseUpdateCardStatus(
      providerCardId,
      STATE_TO_INCREASE_STATUS[state],
    );
    return toProviderCard(result);
  },

  async setSpendLimit(providerCardId, limit) {
    const result = await increaseUpdateCardSpendingLimit(
      providerCardId,
      toIncreaseLimit(limit),
    );
    return toProviderCard(result);
  },

  // No `listTransactions`: `capabilities.webhooks` is "all", so there is
  // nothing to poll for. An adapter that implemented it would be dead code
  // pretending to be a fallback.
};
