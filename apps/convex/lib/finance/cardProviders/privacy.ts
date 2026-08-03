/**
 * The Privacy.com card-provider adapter (ADR-033 Phase 1) — the first
 * BRING-YOUR-OWN issuer.
 *
 * Increase is Togather's vendor: one platform key, one platform relationship,
 * hard per-fund isolation because every fund owns an Account. Privacy.com is
 * the CHURCH's vendor: they hold the account, we drive it with a key they hand
 * us, and every card on that account spends the same pooled balance. Three
 * consequences run through this whole file and none of them is incidental:
 *
 * 1. **No hard fund isolation.** A Privacy card cannot be bound to a fund's
 *    money, because there is no per-fund money at Privacy. Fund attribution is
 *    bookkeeping WE do after the fact, so an over-spend against a fund's
 *    balance is a real possibility the app has to police — see
 *    `capabilities.hardFundIsolation`, and the settlement recorder's skipped
 *    account cross-check.
 * 2. **No weekly limits.** Privacy's `spend_limit_duration` is
 *    `TRANSACTION | MONTHLY | ANNUALLY | FOREVER`. A "week" limit is mapped
 *    DOWN to MONTHLY at the same number (see LIMIT_PERIOD_TO_PRIVACY_DURATION)
 *    and `capabilities.weeklyLimits` is false so the UI can say so out loud.
 * 3. **The credential is per community.** This module exports a FACTORY, not a
 *    singleton adapter — `createPrivacyCardProvider(apiKey)`. There is no
 *    ambient key to accidentally use for the wrong church.
 *
 * Every API fact below was confirmed against developers.privacy.com on
 * 2026-08-03. NOT verifiable without a live account, and therefore called out
 * where it is assumed rather than known:
 * - whether `UNLOCKED` card creation is enabled on a given account (the docs'
 *   guide page omits it from the type list that the API reference includes),
 * - whether `spend_limit: 0` with `FOREVER` really means "no limit",
 * - the ordering of `GET /transactions` results across pages.
 */

import {
  createPrivacyCard,
  listPrivacyFundingSources,
  listPrivacyTransactions,
  privacyClient,
  updatePrivacyCard,
  verifyPrivacyWebhookSignature,
  type PrivacyCard,
  type PrivacyCardState,
  type PrivacySpendLimitDuration,
  type PrivacyTransaction,
} from "../privacy";
import type { CardLimitPeriod } from "../cardPolicy";
import type {
  CardProviderAdapter,
  CardState,
  CardStateRequest,
  NormalizedLimit,
  ProviderCapabilities,
  ProviderCard,
  ProviderTxn,
  ProviderTxnPage,
} from "./types";

// ============================================================================
// Limits
// ============================================================================

/**
 * Togather period -> Privacy `spend_limit_duration`.
 *
 * NOTE: `week` is now REFUSED at the gate — `supportsWeeklyLimits` in
 * lib/finance/cardProviders/index.ts stops a weekly limit reaching a Privacy
 * card at all, because the UI renders "/ week" with a Monday reset and a
 * silently monthly cap makes that copy a lie the cardholder discovers by being
 * declined. This mapping stays as the floor beneath that gate: if a weekly
 * limit ever does arrive here, it must degrade in the STRICTER direction, not
 * be dropped.
 *
 * `week` IS THE LOSSY ONE. Privacy has no weekly window, so a "$100 per week"
 * card becomes "$100 per MONTH" — the same number, a longer window. That
 * direction is chosen deliberately: it can only ever be STRICTER than what the
 * finance admin asked for, never more permissive. The alternative (scaling the
 * number up to ~4.33x for a monthly window) would let a card spend a month's
 * worth in a single week, which is the failure we are least willing to ship.
 *
 * The cost is real and the user must be told: their card stops authorizing
 * after the first week's worth of spend. `capabilities.weeklyLimits: false` is
 * what the UI reads to disclose that (Phase 3), and it is why this map is not
 * a silent implementation detail.
 */
export const LIMIT_PERIOD_TO_PRIVACY_DURATION: Record<
  CardLimitPeriod,
  PrivacySpendLimitDuration
> = {
  week: "MONTHLY",
  month: "MONTHLY",
  charge: "TRANSACTION",
};

/** True when the requested period cannot be expressed natively — the caller may want to disclose it. */
export function isDegradedLimitPeriod(period: CardLimitPeriod): boolean {
  return period === "week";
}

/**
 * Our normalized limit -> Privacy's two fields.
 *
 * `null` (no limit) becomes `spend_limit: 0` + `FOREVER` rather than an
 * omission: `NormalizedLimit`'s contract is that "no limit" must be stated
 * EXPLICITLY, because omitting the fields on a PATCH leaves whatever the card
 * already had — a silent no-op on the one path where silence is most
 * expensive.
 *
 * UNREACHABLE from the app since `requiresSpendLimit` — an uncapped card at a
 * provider with no hard fund isolation can spend the church's entire pooled
 * account, so `createFundCard`/`setCardLimit` refuse to make one. This branch
 * is the adapter honouring its own contract, not a path anything takes.
 *
 * ASSUMPTION FLAGGED: that `spend_limit: 0` means "unlimited" rather than
 * "decline everything" is the documented reading, but it is the one behaviour
 * here that a live sandbox key would settle in thirty seconds and nothing else
 * can. Until then, note that the app's own paths never reach it — every card
 * Togather creates carries a limit (`validateCardLimit` runs before the row
 * exists), so this branch is only for an explicit "remove the limit".
 */
export function toPrivacyLimit(limit: NormalizedLimit | null): {
  spend_limit: number;
  spend_limit_duration: PrivacySpendLimitDuration;
} {
  if (!limit) {
    return { spend_limit: 0, spend_limit_duration: "FOREVER" };
  }
  return {
    spend_limit: limit.limitCents,
    spend_limit_duration: LIMIT_PERIOD_TO_PRIVACY_DURATION[limit.period],
  };
}

// ============================================================================
// States
// ============================================================================

/** Our requested state -> Privacy's `state` on PATCH /cards/{card_token}. */
const STATE_TO_PRIVACY_STATE: Record<CardStateRequest, PrivacyCardState> = {
  active: "OPEN",
  paused: "PAUSED",
  closed: "CLOSED",
};

/**
 * Privacy's card `state` -> our vocabulary.
 *
 * `PENDING_ACTIVATION` / `PENDING_FULFILLMENT` are physical-card states we
 * never request but can receive; they map to `pending` because that is exactly
 * what they are — a card row that exists with no live card behind it yet.
 *
 * An UNRECOGNIZED state maps to `failed`, matching the Increase adapter and
 * for the same reason: an unknown state is not one we can reason about, and
 * guessing "active" is the dangerous direction.
 */
export function privacyStateToCardState(state: string): CardState {
  switch (state) {
    case "OPEN":
      return "active";
    case "PAUSED":
      return "paused";
    case "CLOSED":
      return "closed";
    case "PENDING_ACTIVATION":
    case "PENDING_FULFILLMENT":
      return "pending";
    default:
      return "failed";
  }
}

function toProviderCard(card: PrivacyCard): ProviderCard {
  return {
    // Privacy's card id field is `token`. `card_token` is only its name as a
    // PATH parameter and as a field on a transaction — reading `card_token`
    // off a card response gets you `undefined`, which is why this is spelled
    // out rather than left to look obvious.
    providerCardId: card.token,
    last4: card.last_four,
    state: privacyStateToCardState(card.state),
    providerStatus: card.state,
  };
}

// ============================================================================
// Transactions
// ============================================================================

/**
 * Event types that mean money came BACK — a merchant refund, or Privacy
 * correcting a transaction in the cardholder's favour.
 */
const CREDIT_EVENT_TYPES = new Set([
  "RETURN",
  "TRANSACTION_CORRECTION_CREDIT",
]);

/**
 * Privacy transaction -> our `ProviderTxn`.
 *
 * THE TWO JUDGEMENT CALLS, both documented here because neither is derivable
 * from the type alone:
 *
 * **VOIDED becomes `declined`.** A void is an authorization released before it
 * ever cleared: no money moved and none ever will. `ProviderTxn.state` has
 * three values and its own doc says "`settled` is money actually moved;
 * `pending`/`declined` are not", so a void belongs on the not-moved side.
 * `declined` over `pending` because pending means "still might" — leaving a
 * voided hold as pending forever would be a phantom charge in every balance
 * projection built on this feed.
 *
 * **RETURN becomes a SETTLED transaction with a NEGATIVE amount.** That is
 * `ProviderTxn`'s stated convention ("Positive integer cents SPENT. A
 * refund/credit is negative"), so a refund is money that really moved, just the
 * other way. Phase 1's recorder deliberately SKIPS negative amounts (see
 * `recordCardSettlement`): reversing a `card_charge` expense and posting the
 * matching ledger credit is real work that belongs with the expense module,
 * not smuggled into the settlement path. Normalizing it correctly NOW means
 * the day that lands, this function doesn't move.
 *
 * `BOUNCED` (Privacy's ACH pull from the church's bank failed after the fact)
 * stays `settled` and positive: the merchant was paid, the charge is real, and
 * the funding problem is between the church and Privacy — not a fact about
 * this expense.
 *
 * Amount: `settled_amount` once cleared (it is what actually moved — tips and
 * partial captures make it differ from the authorization), `amount` before
 * then.
 */
export function normalizePrivacyTransaction(
  txn: PrivacyTransaction,
): ProviderTxn {
  const isCredit = (txn.events ?? []).some(
    (event) => event.type !== undefined && CREDIT_EVENT_TYPES.has(event.type),
  );

  const rawAmount =
    txn.status === "SETTLED" && typeof txn.settled_amount === "number"
      ? txn.settled_amount
      : txn.amount;
  const magnitude = Math.abs(rawAmount ?? 0);

  return {
    providerTxnId: txn.token,
    providerCardId: txn.card_token,
    amountCents: isCredit ? -magnitude : magnitude,
    merchantName: txn.merchant?.descriptor ?? null,
    // Privacy has no free-text description distinct from the merchant
    // descriptor, so this is null rather than a duplicate of merchantName.
    description: null,
    occurredAtMs: Date.parse(txn.created),
    state: privacyTxnState(txn.status),
  };
}

function privacyTxnState(status: string): ProviderTxn["state"] {
  switch (status) {
    case "SETTLED":
    case "BOUNCED":
      return "settled";
    case "PENDING":
    case "SETTLING":
      return "pending";
    case "DECLINED":
    case "VOIDED":
      return "declined";
    default:
      // An unknown status is not "settled" — never book money on a status we
      // don't understand. `pending` is the state that costs nothing if wrong.
      return "pending";
  }
}

/**
 * How far back a FIRST poll looks when the connection has no cursor yet.
 *
 * Seven days, not "everything": a freshly connected account may have years of
 * the church's own pre-Togather history, none of which corresponds to a card
 * this app issued, and importing it would be a long walk to zero effect. Cards
 * created after connecting are covered from their first swipe.
 */
export const PRIVACY_INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Privacy's documented max. */
const PRIVACY_PAGE_SIZE = 100;

/**
 * Pages walked per poll. 20 x 100 = 2,000 transactions an hour, which no
 * single church's card program approaches. See `listTransactions` for what
 * happens if one ever does.
 */
const PRIVACY_MAX_PAGES = 20;

// ============================================================================
// Capabilities
// ============================================================================

/**
 * Privacy.com's capability profile. Every value is a claim about the vendor,
 * checked against their docs (2026-08-03), not assumed.
 */
export const PRIVACY_CAPABILITIES: ProviderCapabilities = {
  // Every card on the account draws the same pooled funding source. There is
  // no per-fund account to bind a card to, so fund attribution is ours to
  // enforce in the ledger — and an over-spend against a fund's balance is a
  // real possibility here in a way it is not at Increase.
  hardFundIsolation: false,
  // `spend_limit_duration` is TRANSACTION | MONTHLY | ANNUALLY | FOREVER.
  // No week. See LIMIT_PERIOD_TO_PRIVACY_DURATION for what we do about it.
  weeklyLimits: false,
  // "Setting a card to a CLOSED state is a final action that cannot be
  // undone" — Privacy's own words. `cancelCard`'s irreversible copy is
  // literally true here.
  cardCloseReversible: false,
  // OPEN <-> PAUSED is a plain PATCH in both directions.
  cardFreezeReversible: true,
  // Privacy pushes ALL FIVE transaction events (Authorization, Auth Advice,
  // Void, Clearing, Return). It pushes nothing about CARD state changes, but
  // those only ever change because we changed them, so the transaction feed is
  // the complete set of events we don't already know.
  webhooks: "all",
  // A decline is a transaction with `result != APPROVED`. It arrives on the
  // authorization webhook too, but Phase 1 only READS declines from the poll
  // (Phase 3 turns them into notifications), so the honest answer today is
  // "poll" — the capability describes what we do with the feed, and claiming
  // "webhook" would promise a push notification nothing sends.
  declineFeed: "poll",
  // Privacy caps new cards per month by ACCOUNT TIER (and the tier is not
  // readable from the API). Adapter-level null is the truthful answer: we do
  // not know this account's cap, so we must not pretend to enforce one.
  // A rejected creation surfaces Privacy's own message instead.
  maxCardsPerMonth: null,
  // ONE live card per fund (ADR-033 Phase 3). Privacy would issue as many as
  // the church's tier allows; this is Togather's cap, and it exists because
  // `managedFundLimit` below is only true while it holds. The managed cap is a
  // per-card LIFETIME limit sized to the fund's balance, so a second card on
  // the same fund would carry a second copy of that allowance and the pair
  // could spend the fund twice. One card is what makes the number honest.
  maxCardsPerFund: 1,
  // Privacy's `FOREVER` duration is the one control that can stand in for the
  // fund isolation this provider lacks: a lifetime cap, recomputed from the
  // fund's ledger, so that what is LEFT at Privacy equals the fund's balance.
  // See lib/finance/managedCardLimit.ts.
  managedFundLimit: true,
  // No receipt/document API on transactions.
  receiptForwarding: false,
  // Cards draw a funding source the church already owns; Togather neither
  // prefunds nor settles a statement. Same answer as Increase, different
  // reason — there is simply no money of ours in the loop.
  repaymentVisibility: "n/a",
};

// ============================================================================
// The adapter
// ============================================================================

/**
 * Build an adapter bound to ONE community's Privacy.com key.
 *
 * A factory, not a singleton: the credential is the church's, decrypted per
 * call by the resolver (lib/finance/cardProviders/index.ts) and held only for
 * the life of this object. Nothing here writes it anywhere, and nothing here
 * puts it in an error message.
 */
export function createPrivacyCardProvider(
  apiKey: string,
): CardProviderAdapter {
  const client = privacyClient(apiKey);

  return {
    name: "privacy",
    capabilities: PRIVACY_CAPABILITIES,

    async createCard(input) {
      // UNLOCKED, not MERCHANT_LOCKED: a Togather fund card is general
      // purpose — the church buys from whoever, and the fund is the control,
      // not the merchant. MERCHANT_LOCKED would bind the card to whatever it
      // happened to be swiped at first, which for a "Youth Ministry" card is
      // a coffee shop by accident.
      //
      // `fundAccountRef` is IGNORED, and that is the capability flag made
      // literal: there is no per-fund money at Privacy to point a card at.
      //
      // The memo is what a church admin sees in THEIR Privacy dashboard, so
      // it names the fund and marks the card as ours — they have their own
      // cards on this account and must be able to tell them apart at a glance.
      //
      // `input.idempotencyKey` IS DROPPED, because Privacy has no header to
      // put it in (see lib/finance/privacy.ts's createPrivacyCard). The residual
      // risk is bounded but real: if the POST succeeds and the response is lost,
      // Privacy holds a live card that Togather records as failed — an orphan on
      // the church's account, visible in their dashboard by its memo. It cannot
      // become a DOUBLE issue today, because nothing retries this call: a
      // failure is recorded (recordCardProvisionFailed) and stays recorded.
      // TODO: before any retry is added here, reconcile first — list the
      // account's cards and match on memo — or a lost response becomes two
      // spending instruments instead of one orphan.
      try {
        const card = await createPrivacyCard(client, {
          type: "UNLOCKED",
          memo: input.description,
          state: "OPEN",
          ...toPrivacyLimit(input.limit),
        });
        return toProviderCard(card);
      } catch (error) {
        // UNLOCKED availability is account-dependent (their guide page lists
        // only SINGLE_USE / MERCHANT_LOCKED / DIGITAL_WALLET; the API
        // reference adds UNLOCKED). A church on a tier without it gets a
        // Privacy error that says nothing about tiers, so the failure is
        // re-framed HERE, where the reason is known — this message ends up in
        // front of a finance admin via recordCardProvisionFailed, and "400
        // Bad Request" would send them nowhere.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Privacy.com refused to create the card: ${message}. If this mentions the card type, this Privacy account may not have general-purpose (UNLOCKED) cards enabled — check the plan with Privacy.com support.`,
        );
      }
    },

    async setCardState(providerCardId, state) {
      // No guard against `closed` HERE on purpose. The irreversibility is
      // declared in `capabilities.cardCloseReversible: false` and enforced by
      // the one path allowed to request it (`cancelCard`'s confirmation), so
      // an adapter-level refusal would be a second, divergent copy of a rule
      // that has an owner. What this adapter must not do is make closing look
      // reversible — and it doesn't, because Privacy won't reopen it.
      const card = await updatePrivacyCard(client, providerCardId, {
        state: STATE_TO_PRIVACY_STATE[state],
      });
      return toProviderCard(card);
    },

    async setSpendLimit(providerCardId, limit) {
      const card = await updatePrivacyCard(
        client,
        providerCardId,
        toPrivacyLimit(limit),
      );
      return toProviderCard(card);
    },

    /**
     * Pull transactions since `cursor`.
     *
     * THE CURSOR IS AN ISO TIMESTAMP, not a page token — Privacy paginates by
     * page NUMBER, and page numbers are meaningless between polls. So each run
     * walks pages from a `begin` time and returns the newest `created` it saw
     * as the next cursor.
     *
     * `begin` is inclusive, so the boundary transaction is re-fetched every
     * run. That is intended: `recordCardSettlement` is idempotent on the
     * transaction token, and one duplicate read is a much better trade than a
     * one-second gap that silently drops a charge.
     *
     * IF THE BACKLOG EXCEEDS `PRIVACY_MAX_PAGES`, the cursor does NOT advance
     * and `truncated` comes back true. The next poll re-reads the same window
     * rather than skipping ahead: advancing would assume a page ordering
     * Privacy has not confirmed (see this file's header), and guessing wrong
     * there drops transactions permanently. But a non-advancing cursor is a
     * poll that repeats the same 2,000 rows every hour and never reaches page
     * 21, so `truncated` is what makes the stall VISIBLE — the poller records
     * it as an error on the connection. Without that flag it would look
     * identical to a healthy poll forever. Everything fetched is still
     * returned and recorded.
     *
     * Returns the unchanged cursor rather than `null` when there is nothing
     * new. The interface documents `null` as "caught up", but for a
     * high-water-mark cursor "caught up" and "forget where you were" are the
     * same value, and the poller must never lose its position — so this
     * adapter never returns null, and the poller also treats null as "keep the
     * old cursor". Belt and braces, on the one number that can't be recovered.
     */
    async listTransactions(cursor: string | null): Promise<ProviderTxnPage> {
      const begin =
        cursor ?? new Date(Date.now() - PRIVACY_INITIAL_LOOKBACK_MS).toISOString();

      const collected: PrivacyTransaction[] = [];
      let exhausted = false;

      for (let page = 1; page <= PRIVACY_MAX_PAGES; page++) {
        const result = await listPrivacyTransactions(client, {
          begin,
          page,
          page_size: PRIVACY_PAGE_SIZE,
        });
        const rows = result.data ?? [];
        collected.push(...rows);

        const totalPages = result.total_pages;
        if (
          rows.length < PRIVACY_PAGE_SIZE ||
          (typeof totalPages === "number" && page >= totalPages)
        ) {
          exhausted = true;
          break;
        }
      }

      const transactions = collected.map(normalizePrivacyTransaction);

      // A PENDING transaction is one we deliberately did not record, and
      // Privacy accumulates its clearing onto the SAME transaction without
      // changing `created`. So a high-water mark taken over everything would
      // step past an authorization that has not cleared yet, and if its
      // clearing webhook is then missed, the settled charge is never imported
      // by anything — the exact hole this backstop exists to prevent.
      //
      // The cursor therefore stops BELOW the oldest transaction that can still
      // change state. Terminal ones (settled, declined/voided) are safe to
      // pass: settled is already recorded, and a later RETURN on it is refund
      // work the recorder skips either way.
      let holdBackFrom: number | null = null;
      for (const txn of transactions) {
        if (txn.state !== "pending") continue;
        if (Number.isNaN(txn.occurredAtMs)) continue;
        if (holdBackFrom === null || txn.occurredAtMs < holdBackFrom) {
          holdBackFrom = txn.occurredAtMs;
        }
      }

      // Only advance past what we know we've seen ALL of.
      let nextCursor = cursor;
      if (exhausted) {
        for (const txn of collected) {
          const parsed = Date.parse(txn.created);
          if (Number.isNaN(parsed)) continue;
          if (holdBackFrom !== null && parsed >= holdBackFrom) continue;
          if (nextCursor === null || parsed > Date.parse(nextCursor)) {
            nextCursor = new Date(parsed).toISOString();
          }
        }
      }

      return { transactions, nextCursor, truncated: !exhausted };
    },

    /**
     * Validate the credential and name the account.
     *
     * `GET /funding_sources` is the probe: authenticated, read-only, and
     * cheap, so checking a key can never move money. The label is the first
     * source's nickname — what the church calls the bank account these cards
     * spend from, which is the most useful thing to show back on the
     * connection screen ("Connected · Operations Checking ••1234").
     */
    async checkConnection() {
      const sources = await listPrivacyFundingSources(client);
      const first = sources[0];
      const label =
        first?.nickname?.trim() ||
        first?.account_name?.trim() ||
        (first?.last_four ? `Account ••${first.last_four}` : null);
      return { accountLabel: label ?? null };
    },

    /**
     * Verify an `X-Privacy-HMAC` delivery against this community's key.
     *
     * The signing key IS the API key — Privacy issues no separate webhook
     * secret — which is why this is a method on the credential-bound adapter
     * rather than a free function the webhook route could call on its own.
     */
    async verifyWebhook(payload: unknown, signature: string | null) {
      return await verifyPrivacyWebhookSignature(payload, signature, apiKey);
    },
  };
}
