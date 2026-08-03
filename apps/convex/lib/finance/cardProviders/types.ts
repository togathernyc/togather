/**
 * The card-provider contract (ADR-033 §2) — pure types, no `ctx`, no I/O.
 *
 * Everything above `functions/finance/cards.ts`'s three internalActions is
 * already provider-neutral in shape: the queries, the mutations, the mobile
 * screens all talk about a card with a holder, a status, and a limit. This
 * file is the seam that makes that true in TYPE as well as in shape, so a
 * second issuer can be added without any of it moving.
 *
 * Two rules govern what belongs here:
 *
 * 1. **Capabilities are declared, not discovered.** A provider that can't do
 *    weekly limits says so in `ProviderCapabilities` and the caller adapts,
 *    rather than the caller catching an error at the bank boundary and
 *    guessing what it meant. Every flag below exists because two real issuers
 *    disagree about it.
 *
 * 2. **The normalized vocabulary is ours.** `CardState` and `NormalizedLimit`
 *    are Togather's words. An adapter translates in both directions and never
 *    leaks a provider's enum past this boundary — except through
 *    `providerStatus`, which is carried verbatim precisely so the one legacy
 *    consumer that still stores it (see ADR-033 "Status vocabulary") keeps
 *    working while the migration is pending.
 */

import type { CardLimitPeriod } from "../cardPolicy";

// ============================================================================
// Normalized vocabulary
// ============================================================================

/**
 * A card's lifecycle state, in Togather's words.
 *
 * - `pending` — our row exists, the provider hasn't confirmed a card yet.
 * - `active`  — live and authorizing.
 * - `paused`  — frozen; MAY be reversible, ask `capabilities.cardFreezeReversible`.
 * - `closed`  — dead. Terminal for every provider we support.
 * - `failed`  — the provider call errored; there is no card at the provider.
 */
export type CardState = "pending" | "active" | "paused" | "closed" | "failed";

/** The state transitions a caller may ASK for (you cannot request "pending" or "failed"). */
export type CardStateRequest = Extract<
  CardState,
  "active" | "paused" | "closed"
>;

/**
 * A spend limit, in Togather's vocabulary — the same `limitCents` +
 * `period` pair `cards.spendLimitCents` / `cards.limitPeriod` already store,
 * lifted into one object so an adapter takes it whole.
 *
 * Deliberately derived from `CardLimitPeriod` (lib/finance/cardPolicy.ts)
 * rather than re-declared: the period vocabulary has exactly one definition,
 * and `validateCardLimit` — which stays shared, because "a limit is whole
 * cents, positive, and not a slipped decimal" is a Togather rule, not an
 * issuer's — validates against that same type.
 *
 * `null` in the adapter methods means "no limit", which every provider must
 * be told EXPLICITLY (see Increase's `buildAuthorizationControls`): omitting
 * the field leaves whatever the card already had, which is a silent no-op on
 * the one path where silence is most expensive.
 */
export interface NormalizedLimit {
  limitCents: number;
  period: CardLimitPeriod;
}

// ============================================================================
// Capabilities
// ============================================================================

/**
 * What an issuer can actually do. Read this before promising a user anything;
 * every field is a place two real providers disagree.
 */
export interface ProviderCapabilities {
  /**
   * Does the provider enforce per-fund segregation at the BANK, so a card
   * physically cannot spend another fund's money?
   *
   * True for Increase (one Account per fund, the card is bound to it — the
   * ADR-032 invariant). False for issuers that put every card on one pooled
   * balance, where fund attribution is bookkeeping we do afterwards and an
   * over-spend is a real possibility we have to police ourselves.
   */
  hardFundIsolation: boolean;

  /** Does the provider support a per-WEEK spending limit natively? Some offer only monthly/per-transaction. */
  weeklyLimits: boolean;

  /**
   * Can a closed card be reopened? Terminal-close is the norm; a `false` here
   * is what makes `cancelCard` a genuinely irreversible act rather than a
   * strong freeze, and the UI copy has to match.
   */
  cardCloseReversible: boolean;

  /** Can a paused/frozen card be un-paused? Universally true today, declared because a "burner card" issuer would say no. */
  cardFreezeReversible: boolean;

  /**
   * Webhook coverage.
   * - `"all"`     — the provider pushes every event we need (settlements, status, declines).
   * - `"partial"` — some events push, the rest must be polled.
   * - `"none"`    — nothing pushes; everything is a poll.
   */
  webhooks: "all" | "partial" | "none";

  /**
   * How we learn about a DECLINED authorization.
   * - `"webhook"` — pushed to us.
   * - `"poll"`    — visible only on a later transaction/event pull.
   * - `"none"`    — the provider never tells us; declines are invisible.
   */
  declineFeed: "webhook" | "poll" | "none";

  /** Hard cap on new cards per calendar month, or `null` for no documented cap. */
  maxCardsPerMonth: number | null;

  /**
   * How the provider's balance is funded and repaid.
   * - `"n/a"`       — the card spends a real deposit balance we already hold (Increase).
   * - `"prefund"`   — we push money to the provider before it can be spent.
   * - `"statement"` — a charge card billed on a cycle; repayment is out-of-band.
   */
  repaymentVisibility: "n/a" | "prefund" | "statement";
}

// ============================================================================
// Provider-shaped results
// ============================================================================

/** A card as the provider just reported it, already normalized. */
export interface ProviderCard {
  /** The provider's own id for this card — what we store in `cards.providerCardId`. */
  providerCardId: string;
  /** Last 4 of the PAN, for display. Absent if the provider doesn't return it at creation. */
  last4?: string;
  /** The state in Togather's vocabulary. */
  state: CardState;
  /**
   * The provider's OWN status string, verbatim. Carried (rather than dropped
   * once `state` is derived) only because `cards.status` still stores the
   * legacy Increase strings — see ADR-033 "Status vocabulary". New code
   * should read `state`.
   */
  providerStatus: string;
}

/**
 * One transaction as the provider reports it, normalized. Reserved for the
 * pull-based sync that Phase 1 adds for providers whose `webhooks` is not
 * `"all"`; the Increase adapter has no need for it (its settlements arrive
 * through the existing `transaction.created` webhook) and does not implement
 * `listTransactions`.
 */
export interface ProviderTxn {
  /** The provider's own transaction id — the dedupe key for a repeated pull. */
  providerTxnId: string;
  /** The provider card this transaction belongs to. */
  providerCardId: string;
  /** Positive integer cents SPENT. A refund/credit is negative. */
  amountCents: number;
  /** Merchant name as the provider reports it — untrusted display text. */
  merchantName: string | null;
  /** Free-text description, when the provider gives one distinct from the merchant. */
  description: string | null;
  /** When the transaction occurred, Unix ms. */
  occurredAtMs: number;
  /** `"settled"` is money actually moved; `"pending"`/`"declined"` are not. */
  state: "pending" | "settled" | "declined";
}

/** A page of transactions plus the cursor to resume from. */
export interface ProviderTxnPage {
  transactions: ProviderTxn[];
  /** Opaque, stored on `cardProviderConnections.syncCursor`. `null` means "caught up". */
  nextCursor: string | null;
}

// ============================================================================
// The adapter
// ============================================================================

/**
 * Everything `functions/finance/cards.ts` needs from an issuer.
 *
 * Deliberately SMALL. Anything the card module doesn't do today (issuing
 * physical cards, merchant-category controls, real-time authorization
 * decisioning) is absent rather than optional-and-unimplemented — an
 * interface that promises what no adapter delivers is worse than one that
 * has to grow.
 *
 * Every method may throw; a throw means "the provider did not do it", which
 * is the distinction `applyCardLimit`'s two-phase failure model is built on.
 */
export interface CardProviderAdapter {
  /** Which provider this is — matches `communityFinance.cardProvider` and `cards.provider`. */
  readonly name: "increase" | "privacy" | "bill";

  /** What this provider can do. Read it before offering a control. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Create a card.
   *
   * `fundAccountRef` is the provider handle for the fund's money — an
   * Increase Account id today. Providers without `hardFundIsolation` ignore
   * it, which is exactly why the capability flag exists.
   *
   * `idempotencyKey` is caller-supplied and stable per card (`finance:card:{cardId}`),
   * so a retried provisioning run resolves to the same card instead of
   * issuing a second one.
   *
   * `limit` is applied AT CREATION so there is never a window where the card
   * is live and uncapped.
   */
  createCard(input: {
    fundAccountRef: string;
    description: string;
    idempotencyKey: string;
    limit: NormalizedLimit | null;
  }): Promise<ProviderCard>;

  /** Move a card to `state`. Throws if the provider refuses (e.g. reopening a closed card). */
  setCardState(
    providerCardId: string,
    state: CardStateRequest,
  ): Promise<ProviderCard>;

  /** Replace the card's spend limit. `null` REMOVES the limit and must be sent explicitly. */
  setSpendLimit(
    providerCardId: string,
    limit: NormalizedLimit | null,
  ): Promise<ProviderCard>;

  /**
   * Pull transactions since `cursor`.
   *
   * Present on any provider whose settlement feed has to be reconciled — for
   * a `webhooks: "all"` provider that still means SOMETHING, since a webhook
   * endpoint that was down for an hour loses those deliveries forever unless a
   * poll backstops them (`finance-card-txn-poll`, functions/finance/jobs.ts).
   * Callers must check for the method before calling it.
   *
   * `cursor` is opaque to the caller and provider-defined: an ISO high-water
   * mark for Privacy, potentially a page token elsewhere. Whatever comes back
   * as `nextCursor` is what gets stored and handed back next time.
   */
  listTransactions?(cursor: string | null): Promise<ProviderTxnPage>;

  /**
   * Prove the stored credential still works, and say whose account it is.
   *
   * Present only on BRING-YOUR-OWN providers, where the credential belongs to
   * the community and can be revoked, rotated, or pasted wrong by a human. A
   * platform-key provider (Increase) has nothing to check that isn't already a
   * deployment misconfiguration, so it doesn't implement this.
   *
   * MUST be read-only at the provider — this runs on a key someone just typed
   * into a form, and validating a credential must never be able to move money.
   *
   * Throws when the credential is bad; the thrown message is shown to a
   * finance admin. `accountLabel` is display text from the provider — treat it
   * as untrusted.
   */
  checkConnection?(): Promise<{ accountLabel: string | null }>;

  /**
   * Verify a webhook delivery's signature.
   *
   * On the adapter rather than in the HTTP route because for a BYO provider
   * the signing key is the COMMUNITY's credential, which only the
   * credential-bound adapter holds. Providers whose webhook secret is a
   * deployment env var (Increase) verify in their own module instead.
   *
   * `payload` is the PARSED body, not the raw bytes: providers that sign a
   * canonical re-rendering (Privacy sorts keys and strips whitespace) cannot
   * be verified from the wire bytes at all. An adapter that needs the raw
   * bytes must take them another way.
   *
   * Returns a boolean and never throws — a malformed signature is "not from
   * them", not a server error.
   */
  verifyWebhook?(payload: unknown, signature: string | null): Promise<boolean>;
}
