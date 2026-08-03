/**
 * Group giving: provider webhook glue (ADR-032 §6).
 *
 * Two entry points the orchestrator wires into http.ts:
 *
 * - `handleIncreaseWebhookRequest` — a complete httpAction body for a new
 *   `POST /increase-webhook` route: verifies the signature, parses the
 *   event, and dispatches by category.
 * - `handlePrivacyWebhookRequest` — the same for
 *   `POST /card-provider-webhook/privacy` (ADR-033 Phase 1). Structurally
 *   different in one way that is worth knowing before reading it: Increase's
 *   webhook secret is a deployment env var, so it can verify before it knows
 *   anything else. Privacy signs with the COMMUNITY's API key, so that handler
 *   has to route the payload to a community first (read-only) and verify
 *   second.
 * - `handleBillWebhookRequest` — `POST /card-provider-webhook/bill` (ADR-033
 *   Phase 2), and a THIRD shape again: BILL publishes no webhook signature at
 *   all, so there is nothing to verify. That handler uses the payload only to
 *   route, then re-fetches the transaction from BILL with the community's own
 *   token and records what the API says. Read its header before touching it —
 *   "just book the payload" is exactly the change it exists to prevent.
 * - `handleFinanceStripeEvent` — called from the EXISTING `/stripe-webhook`
 *   route's switch (functions/ee/billing.ts's billing events already live
 *   there) for whatever billing's switch doesn't handle itself, i.e.
 *   `account.updated`, plus the four types that are AMBIGUOUS between SaaS
 *   billing and recurring giving (`checkout.session.completed`,
 *   `customer.subscription.updated`/`.deleted`, `invoice.payment_failed`),
 *   which http.ts routes here on `event.account` — see
 *   lib/finance/webhookRouting.ts.
 *
 * Replay safety: Increase (and Stripe) can redeliver the same event more
 * than once. We don't keep a table of handled event ids (schema.ts is out of
 * scope for this change, and it would need one) — instead every mutation
 * this file dispatches to is idempotent on the provider's CURRENT state, so
 * redelivering the same event just re-applies the same (already-applied)
 * state and is a no-op (see the "no status change -> no audit row" guards in
 * applyIncreaseEntityStatus below and applyStripeAccountStatus in
 * onboarding.ts).
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import { logFinanceAudit } from "../../lib/finance/audit";
// Increase's own window math, from the Increase adapter — this whole module
// IS the Increase webhook handler, so the Increase-specific import is
// honest here rather than a leak (ADR-033).
import { cardLimitWindowStart } from "../../lib/finance/cardProviders/increase";
import { normalizePrivacyTransaction } from "../../lib/finance/cardProviders/privacy";
import {
  getCardProviderByName,
  loadActiveProviderConnection,
} from "../../lib/finance/cardProviders";
import type { ProviderTxn } from "../../lib/finance/cardProviders";
import { PRIVACY_HMAC_HEADER, type PrivacyTransaction } from "../../lib/finance/privacy";
import type { BillWebhookNotification } from "../../lib/finance/bill";
import { postLedgerEntry } from "../../lib/finance/ledger";
import { now } from "../../lib/utils";
import {
  getEntity,
  getTransaction,
  getIncreaseWebhookSecret,
  verifyIncreaseWebhookSignature,
} from "../../lib/finance/increase";

// ============================================================================
// applyIncreaseEntityStatus — Increase entity.created/entity.updated -> the
// onboardingStatus machine's increase_blocked side state. The "verifying" /
// "live" forward transitions are owned by applyStripeAccountStatus
// (functions/finance/onboarding.ts), since going live requires Stripe's
// charges_enabled/payouts_enabled — this mutation only ever sets/clears the
// increase_blocked side state, and never regresses "live".
// ============================================================================

export const applyIncreaseEntityStatus = internalMutation({
  args: {
    entityId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("archived"),
      v.literal("disabled"),
    ),
  },
  handler: async (ctx, args) => {
    // No index on increaseEntityId exists on communityFinance (only
    // by_community) — schema.ts is out of scope for this change, so this is
    // a full-table filter. Fine at today's community count.
    const finance = await ctx.db
      .query("communityFinance")
      .filter((q) => q.eq(q.field("increaseEntityId"), args.entityId))
      .first();
    if (!finance) {
      console.error(
        `[finance] applyIncreaseEntityStatus: no communityFinance row for Increase entity ${args.entityId}`,
      );
      return;
    }

    // Monotonic: never regress "live" (mirrors applyStripeAccountStatus).
    if (finance.onboardingStatus === "live") {
      return;
    }

    let nextStatus = finance.onboardingStatus;
    if (args.status === "disabled" || args.status === "archived") {
      nextStatus = "increase_blocked";
    } else if (args.status === "active" && finance.onboardingStatus === "increase_blocked") {
      // Recovered — Increase re-enabled the entity. Fall back to
      // "verifying"; applyStripeAccountStatus will re-advance to "live" on
      // the next Stripe webhook if charges/payouts are also ready.
      nextStatus = "verifying";
    }

    if (nextStatus === finance.onboardingStatus) return; // no-op — no audit noise for a repeat/duplicate webhook

    await ctx.db.patch(finance._id, {
      onboardingStatus: nextStatus,
      updatedAt: now(),
    });
    await logFinanceAudit(ctx, {
      communityId: finance.communityId,
      action: "onboarding.status_changed",
      details: {
        from: finance.onboardingStatus,
        to: nextStatus,
        reason: `increase_entity_${args.status}`,
      },
    });
  },
});

// ============================================================================
// recordCardSettlement — turns a settled card transaction into a
// `card_charge` expense + ledger debit (functions/finance/cards.ts owns the
// card object itself; this is the settlement side). Idempotent on the
// PROVIDER's transaction id — a redelivered webhook, or the hourly poll
// re-reading its cursor boundary, must not create a second expense or post a
// second ledger debit.
//
// PROVIDER-NEUTRAL since ADR-033 Phase 1. It used to take `increaseCardId` /
// `increaseTransactionId` / `accountId`; it now takes a provider name plus
// that provider's ids, because Privacy.com settlements land here through the
// same door. Two things did NOT change and are load-bearing:
//
// - `expenses.increaseTransactionId` and `by_increaseTransactionId` keep their
//   names. The column IS the provider transaction id and always was; renaming
//   it is a schema migration on live data, which this change is not.
//   TODO: rename the column + index when a finance migration next runs.
// - The ledger idempotency key stays `card-settlement:{txnId}`. Changing it
//   would make every in-flight Increase settlement look new.
// ============================================================================

export const recordCardSettlement = internalMutation({
  args: {
    /** "increase" | "privacy" — decides which index finds the card. */
    provider: v.string(),
    providerCardId: v.string(),
    providerTxnId: v.string(),
    /**
     * The provider account the money moved in. Present only for providers with
     * `capabilities.hardFundIsolation` (Increase), where a fund owns its own
     * account and the cross-check below is meaningful.
     */
    accountRef: v.optional(v.string()),
    /** Absolute cents — callers strip the sign (a provider debit may be signed). */
    amountCents: v.number(),
    merchantDescription: v.string(),
    /**
     * When the charge happened at the PROVIDER, not when we heard about it.
     * Optional because the Increase path doesn't carry it yet; absent means
     * "use now()", which is what every caller did before ADR-033.
     */
    occurredAtMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Legacy cards carry only `increaseCardId`; ADR-033 cards carry the
    // provider pair too. Increase looks up by the legacy column so every card
    // in production today keeps resolving, BYO providers by the pair.
    //
    // Guarding on a non-empty id first is not defensive noise: both fields of
    // `by_provider_cardId` are optional, so every legacy card shares the same
    // missing value on that index and an empty lookup would return an
    // arbitrary stranger's card (schema.ts says so at the index).
    if (!args.providerCardId) {
      console.error(
        `[finance] recordCardSettlement: empty provider card id on transaction ${args.providerTxnId}`,
      );
      return;
    }
    const card =
      args.provider === "increase"
        ? await ctx.db
            .query("cards")
            .withIndex("by_increaseCardId", (q) =>
              q.eq("increaseCardId", args.providerCardId),
            )
            .first()
        : await ctx.db
            .query("cards")
            .withIndex("by_provider_cardId", (q) =>
              q
                .eq("provider", args.provider)
                .eq("providerCardId", args.providerCardId),
            )
            .first();
    if (!card) {
      // A settlement on a card this app didn't issue. At Increase that
      // shouldn't happen (cards.ts is the only issuer on the platform
      // account); at a BYO provider it is ROUTINE — the church has their own
      // cards on the same account and we get webhooks for all of them. Either
      // way: log, don't throw. Throwing would retry forever against a card
      // that is permanently not ours.
      console.log(
        `[finance] recordCardSettlement: no Togather card for ${args.provider} card ${args.providerCardId} (transaction ${args.providerTxnId}) — ignoring`,
      );
      return;
    }

    const fund = await ctx.db.get(card.fundId);
    if (!fund) {
      console.error(
        `[finance] recordCardSettlement: card ${card._id}'s fund ${card.fundId} not found`,
      );
      return;
    }

    // Defense-in-depth, mirroring the Stripe account cross-checks above: a
    // transaction's account must match the fund's OWN account before anything
    // is credited/debited — a mismatch (e.g. a stale/misrouted card record) is
    // rejected and audited, never silently trusted.
    //
    // SKIPPED when `accountRef` is absent, which is exactly the set of
    // providers with no `hardFundIsolation`: at Privacy.com every card draws
    // one pooled funding source, so there is no per-fund account to compare
    // against and the check would have nothing to say. That is not a gap we're
    // tolerating quietly — it IS the difference the capability flag names, and
    // it is why fund over-spend is an app-side concern on those providers.
    if (args.accountRef !== undefined && fund.increaseAccountId !== args.accountRef) {
      console.error(
        `[finance] recordCardSettlement: account mismatch on fund ${fund._id} — transaction account=${args.accountRef} expected=${fund.increaseAccountId ?? "none"}`,
      );
      await logFinanceAudit(ctx, {
        communityId: fund.communityId,
        fundId: fund._id,
        action: "webhook.rejected_account_mismatch",
        details: {
          eventAccount: args.accountRef,
          expectedAccount: fund.increaseAccountId ?? null,
          provider: args.provider,
          increaseTransactionId: args.providerTxnId,
        },
      });
      return;
    }

    const existingExpense = await ctx.db
      .query("expenses")
      .withIndex("by_increaseTransactionId", (q) =>
        q.eq("increaseTransactionId", args.providerTxnId),
      )
      .first();
    if (existingExpense) {
      return; // Already recorded — a redelivered webhook (or a re-polled cursor boundary) is a no-op.
    }

    const recordedAt = now();
    // A charge is filed under WHEN IT HAPPENED. The hourly poll is a backstop
    // for missed webhooks, so it routinely imports charges hours or days late;
    // stamping those with the import time would put them in the wrong month's
    // books and measure them against the wrong spend-limit window. `updatedAt`
    // stays the write time — that one really is about this row, not the money.
    const timestamp = args.occurredAtMs ?? recordedAt;
    const expenseId = await ctx.db.insert("expenses", {
      fundId: fund._id,
      submitterId: card.holderUserId,
      amountCents: args.amountCents,
      kind: "card_charge",
      description: args.merchantDescription,
      status: "pending",
      cardId: card._id,
      increaseTransactionId: args.providerTxnId,
      createdAt: timestamp,
      updatedAt: recordedAt,
    });

    await postLedgerEntry(ctx, {
      fundId: fund._id,
      direction: "debit",
      amountCents: args.amountCents,
      kind: "card_capture",
      idempotencyKey: `card-settlement:${args.providerTxnId}`,
      increaseObjectId: args.providerTxnId,
    });

    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: "expense.card_charge_recorded",
      details: {
        expenseId,
        cardId: card._id,
        amountCents: args.amountCents,
        provider: args.provider,
        increaseTransactionId: args.providerTxnId,
      },
    });

    // SCHEDULED, not called inline. A Convex mutation is one transaction, so
    // an inline drift check that threw — on a bug, or on the read limits its
    // window query could reach — would roll back the expense AND the ledger
    // debit above, and Increase would retry the webhook straight back into
    // the same failure. Scheduling is atomic with this transaction (it only
    // happens if the settlement commits) while running in its own, which is
    // the only arrangement where "the audit can never affect the money path"
    // is actually true rather than merely intended.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.finance.webhooks.auditOverLimitCardCharge,
      { cardId: card._id, expenseId, atMs: timestamp },
    );
  },
});

/**
 * Drift check: did a settled charge push this card past the limit the bank
 * is supposed to be enforcing?
 *
 * Increase enforces `spendLimitCents`/`limitPeriod` at authorization time
 * (cards.ts, lib/finance/increase.ts), so in the normal case this never
 * fires. It fires when our stored limit and the bank's disagree — a card
 * issued before limits were wired through, a `setCardLimit` whose provider
 * call failed after the audit row landed, or a settlement that exceeds its
 * own authorization (forced posts, tip adjustments). Those are exactly the
 * cases where a fund's finance admins need a record, and the only way to
 * catch them is to compare after the money has moved.
 *
 * Audit-only by design: the charge already settled, so there is nothing to
 * block — this makes the stored limit a real monitoring control rather than
 * a number nobody ever reads back.
 *
 * Runs as its OWN transaction, scheduled by `recordCardSettlement` — see the
 * comment at that call site for why it must never share the settlement's.
 */
export const auditOverLimitCardCharge = internalMutation({
  args: {
    cardId: v.id("cards"),
    expenseId: v.id("expenses"),
    /** Settlement time, so the window matches the one the settlement fell in. */
    atMs: v.number(),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId);
    if (!card) return;
    const fund = await ctx.db.get(card.fundId);
    if (!fund) return;

    const limitCents = card.spendLimitCents;
    const limitPeriod = card.limitPeriod;
    if (limitCents === undefined || limitPeriod === undefined) return;

    // The card's CURRENT limit is only evidence about a charge if it was the
    // limit in force WHEN that charge settled. Since the hourly poll can
    // backfill a charge from before a `setCardLimit`, that is no longer a safe
    // assumption: a lowered limit would manufacture a breach that never
    // happened, and a raised one would hide a real one. `cards.updatedAt` is
    // the only marker available for "this row has changed since" without a
    // limit history to reconstruct from, so a card touched after the charge
    // gets no assertion at all.
    //
    // Conservative in the direction that costs least: this is an audit, not a
    // control — the money has already moved either way — so a skipped check
    // loses a monitoring signal, while a wrong one puts a false
    // `card.limit_exceeded` in a church's permanent record.
    // TODO: reconstruct the limit effective at `atMs` from the
    // `card.limit_updated` audit trail, and drop this skip.
    if (card.updatedAt > args.atMs) {
      console.log(
        `[finance] auditOverLimitCardCharge: card ${card._id} changed after this charge settled — skipping the drift check rather than judging it against a limit that may not have applied`,
      );
      return;
    }

    const windowStart = cardLimitWindowStart(limitPeriod, args.atMs);
    let windowTotalCents: number;
    if (windowStart === null) {
      // "charge" — a per-transaction cap, so the window is this charge alone.
      windowTotalCents = (await ctx.db.get(args.expenseId))?.amountCents ?? 0;
    } else {
      // Bounded by the index range, not filtered in JS: a card in weekly use
      // for years must not make this read grow without limit. The expense for
      // this charge is already inserted, so it's counted here rather than
      // added on top.
      const charges = await ctx.db
        .query("expenses")
        .withIndex("by_card_created", (q) =>
          q
            .eq("cardId", args.cardId)
            .gte("createdAt", windowStart)
            // UPPER bound, and it is `atMs` rather than the window's end: the
            // question is "had this card spent past its limit AT THE MOMENT
            // this charge settled?", so charges that had not happened yet are
            // not evidence. It also stops a backfilled July charge — which the
            // poll can import in August — from summing August's spending into
            // July's window and raising a limit_exceeded that never happened.
            .lte("createdAt", args.atMs),
        )
        .collect();
      windowTotalCents = charges
        .filter((e) => e.kind === "card_charge")
        .reduce((sum, e) => sum + e.amountCents, 0);
    }

    if (windowTotalCents <= limitCents) return;

    console.error(
      `[finance] card ${card._id} settled past its ${limitPeriod} limit: ${windowTotalCents} > ${limitCents} cents`,
    );
    await logFinanceAudit(ctx, {
      communityId: fund.communityId,
      fundId: fund._id,
      action: "card.limit_exceeded",
      details: {
        cardId: card._id,
        expenseId: args.expenseId,
        spendLimitCents: limitCents,
        limitPeriod,
        windowTotalCents,
        windowStart,
      },
    });
  },
});

// ============================================================================
// handleIncreaseWebhookRequest — POST /increase-webhook (orchestrator wires
// this path in http.ts).
// ============================================================================

/** The Increase Event object shape we read — https://increase.com/documentation/webhooks. */
interface IncreaseEventPayload {
  id: string;
  category: string;
  associated_object_id: string;
  associated_object_type: string;
}

export async function handleIncreaseWebhookRequest(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  const rawBody = await request.text();

  // Increase's three signature headers (https://increase.com/documentation/webhooks) —
  // see lib/finance/increase.ts's verifyIncreaseWebhookSignature for the scheme.
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return new Response("Missing webhook signature headers", { status: 401 });
  }

  let secret: string;
  try {
    secret = getIncreaseWebhookSecret();
  } catch (error) {
    console.error(
      "[IncreaseWebhook] INCREASE_WEBHOOK_SECRET not configured",
      error,
    );
    return new Response("Webhook not configured", { status: 500 });
  }

  const isValid = await verifyIncreaseWebhookSignature(
    rawBody,
    { webhookId, webhookTimestamp, webhookSignature },
    secret,
  );
  if (!isValid) {
    console.error("[IncreaseWebhook] Invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: IncreaseEventPayload;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    switch (event.category) {
      // Individual Events carry only an id reference, not the full resource
      // (https://increase.com/documentation/webhooks: "make a GET request to
      // the API for that information") — fetch the entity's current status
      // before dispatching.
      case "entity.created":
      case "entity.updated": {
        const entity = await getEntity(event.associated_object_id);
        await ctx.runMutation(
          internal.functions.finance.webhooks.applyIncreaseEntityStatus,
          { entityId: entity.id, status: entity.status },
        );
        break;
      }
      // Card-settlement transaction sync (ADR-032 §3 Phase 3, cards.ts):
      // turns a card swipe into a `card_charge` expense + ledger debit. Same
      // "individual Event carries only an id" shape as entity.*, above.
      case "transaction.created": {
        const transaction = await getTransaction(event.associated_object_id);
        if (transaction.source.category !== "card_settlement") {
          // Not a card charge (e.g. an ACH/AccountTransfer settling) —
          // nothing for cards.ts to do; log-and-ignore rather than error,
          // since transaction.created fires for every transaction kind.
          console.log(
            `[IncreaseWebhook] Ignoring transaction.created (category=${transaction.source.category})`,
          );
          break;
        }
        const cardSettlement = transaction.source.card_settlement;
        if (!cardSettlement) {
          console.error(
            `[IncreaseWebhook] transaction.created: category=card_settlement but no card_settlement details on transaction ${transaction.id}`,
          );
          break;
        }
        await ctx.runMutation(
          internal.functions.finance.webhooks.recordCardSettlement,
          {
            provider: "increase",
            providerCardId: cardSettlement.card_id,
            providerTxnId: transaction.id,
            accountRef: transaction.account_id,
            // transaction.amount is signed cents (negative = debit); a card
            // settlement is always a debit, so store the absolute value —
            // ledgerEntries/expenses encode direction via `kind`/`direction`,
            // never via a negative amountCents (postLedgerEntry enforces
            // amountCents > 0).
            amountCents: Math.abs(transaction.amount),
            merchantDescription:
              cardSettlement.merchant_name ?? transaction.description,
          },
        );
        break;
      }
      // Every other category (account.*, account_transfer.*, ach_transfer.*,
      // card.*, ...) belongs to later ADR-032 phases — explicitly ignored,
      // not silently dropped, until those phases wire their own dispatch here.
      default:
        console.log(
          `[IncreaseWebhook] Ignoring event category: ${event.category}`,
        );
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[IncreaseWebhook] Error processing event:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}

// ============================================================================
// handlePrivacyWebhookRequest — POST /card-provider-webhook/privacy
// (http.ts mounts the path; all of the thinking is here).
// ============================================================================

/**
 * Find the Togather card a BYO webhook is about, and the connection whose key
 * signs it.
 *
 * The lookup order is forced by Privacy's design: the signing key IS the
 * community's API key, so we cannot verify a delivery until we know which
 * community it belongs to, and the only routing information in the payload is
 * the card token. Hence: card -> fund -> community -> connection -> key ->
 * verify. Everything before the verification is READ-ONLY, which is the
 * property that matters — an unsigned request can make us look something up,
 * and can change nothing.
 */
export const resolveCardForProviderWebhook = internalQuery({
  args: { provider: v.string(), providerCardId: v.string() },
  handler: async (ctx, args) => {
    if (!args.providerCardId) return null; // see the index caution in schema.ts
    const card = await ctx.db
      .query("cards")
      .withIndex("by_provider_cardId", (q) =>
        q
          .eq("provider", args.provider)
          .eq("providerCardId", args.providerCardId),
      )
      .first();
    if (!card) return null;
    const fund = await ctx.db.get(card.fundId);
    if (!fund) return null;
    const connection = await loadActiveProviderConnection(
      ctx,
      fund.communityId,
    );
    if (!connection) return null;
    return { communityId: fund.communityId, connection };
  },
});

/** The Privacy.com Transaction fields the route reads before handing off to the adapter. */
interface PrivacyWebhookPayload {
  token?: string;
  card_token?: string;
}

/**
 * Make an UNVERIFIED payload field safe to put in a log line.
 *
 * Everything the Privacy route logs before the HMAC check is attacker-supplied
 * — the endpoint is unauthenticated by construction (the signing key can only
 * be found via the payload's own card token). Quoting through `JSON.stringify`
 * escapes newlines and control characters, so a token cannot forge a second
 * log entry, and the length bound stops one request from flooding the log.
 */
function forLog(value: string): string {
  return JSON.stringify(value.length > 64 ? `${value.slice(0, 64)}…` : value);
}

/**
 * Privacy.com transaction webhook.
 *
 * Privacy posts the FULL Transaction object (no event envelope) for five
 * events: Authorization, Auth Advice, Void, Clearing, Return. We do not
 * dispatch on which event fired — the transaction's own `status` says what
 * state it is in now, and using it means the webhook path and the hourly poll
 * path normalize through exactly the same function. One notion of "settled",
 * not two that can drift.
 *
 * Phase 1 records CLEARINGS and nothing else. An authorization is money that
 * has not moved; recording it as an expense would double-count it the moment
 * it clears, and Privacy sends no "authorization expired" event to clean up
 * with. Declines are logged here and become notifications in Phase 3.
 *
 * A card we don't know is a 200, not a 404: the church has their own cards on
 * this Privacy account and we are signed up for the whole account's feed.
 * Retrying those deliveries for a day (Privacy's backoff) would be noise about
 * a situation that is completely normal.
 */
export async function handlePrivacyWebhookRequest(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  const rawBody = await request.text();

  let payload: PrivacyWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const cardToken = payload.card_token;
  if (!cardToken) {
    console.log(
      "[PrivacyWebhook] Payload has no card_token — nothing to route on, ignoring",
    );
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const resolved = await ctx.runQuery(
    internal.functions.finance.webhooks.resolveCardForProviderWebhook,
    { provider: "privacy", providerCardId: cardToken },
  );
  if (!resolved) {
    console.log(
      `[PrivacyWebhook] No Togather card (or no active connection) for card ${forLog(cardToken)} — ignoring`,
    );
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Decrypts the community's key into the adapter. Any failure here is a
  // deployment problem (missing master key, incomplete rotation), not a bad
  // request — 500 so Privacy retries once it's fixed.
  let provider;
  try {
    provider = await getCardProviderByName("privacy", resolved.connection);
  } catch (error) {
    console.error(
      "[PrivacyWebhook] Could not build the provider adapter (credential undecryptable?)",
      error,
    );
    return new Response("Webhook not configured", { status: 500 });
  }

  if (!provider.verifyWebhook) {
    console.error("[PrivacyWebhook] Adapter cannot verify signatures");
    return new Response("Webhook not configured", { status: 500 });
  }

  // NOTHING has been written at this point, and nothing will be until this
  // returns true. Note the PARSED payload is verified, not `rawBody`: Privacy
  // signs a canonical re-rendering (sorted keys, no whitespace), so the wire
  // bytes are not the signed message — see lib/finance/privacy.ts.
  const signature = request.headers.get(PRIVACY_HMAC_HEADER);
  if (!(await provider.verifyWebhook(payload, signature))) {
    console.error(`[PrivacyWebhook] Invalid signature for card ${forLog(cardToken)}`);
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const txn = normalizePrivacyTransaction(
      payload as unknown as PrivacyTransaction,
    );
    await recordProviderTransaction(ctx, "privacy", txn, "PrivacyWebhook");
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[PrivacyWebhook] Error processing transaction:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}

// ============================================================================
// handleBillWebhookRequest — POST /card-provider-webhook/bill
// (http.ts mounts the path; all of the thinking is here).
// ============================================================================

/**
 * BILL Spend & Expense transaction notification — the FETCH-TO-VERIFY handler.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE. Privacy's handler verifies an HMAC
 * and then books the payload. BILL's cannot: their Spend & Expense notification
 * documentation describes the payload in full and says nothing about a
 * signature, header, or shared secret. There is no scheme to implement, so
 * there is nothing to verify — which means an unauthenticated stranger can POST
 * this endpoint any JSON they like.
 *
 * So the payload is treated as a HINT and never as evidence:
 *
 *   payload -> transaction uuid + card uuid   (routing ONLY)
 *     -> our card -> fund -> community -> connection -> decrypted token
 *       -> GET /v3/spend/transactions/{uuid} with THAT token
 *         -> record whatever the API said
 *
 * A forged POST claiming a $9,000 clearing on someone's card therefore results
 * in one of two things: BILL 404s (we write nothing) or BILL returns the real
 * transaction (we write the REAL amount). The attacker controls which
 * transaction we look at — all of which are transactions on this community's own
 * cards, which we were going to import on the next poll anyway — and controls
 * nothing about what we book. The worst they can do is make a settlement land
 * an hour early.
 *
 * That is the whole security argument, and it is why "just trust the payload
 * because it's over TLS" is not an acceptable simplification here.
 *
 * `spend.transaction.updated` fires at AUTHORIZATION and AGAIN at CLEAR, so
 * most deliveries are the same uuid in an earlier state; `recordProviderTransaction`
 * records only clearings and the settlement recorder is idempotent on the uuid,
 * so the repeat costs one read and writes nothing.
 *
 * A card we don't know is a 200, not a 404: the church has their own cards in
 * this BILL account and the subscription covers the whole company's feed.
 */
export async function handleBillWebhookRequest(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  const ok = (extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ received: true, ...extra }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  let payload: BillWebhookNotification;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // The ONLY two fields read from an unauthenticated body, and both are used
  // to LOOK THINGS UP rather than to decide anything.
  const transactionUuid = payload.transaction?.uuid;
  const cardUuid = payload.transaction?.cardUuid;
  if (!transactionUuid || !cardUuid) {
    console.log(
      "[BillWebhook] Payload has no transaction uuid / cardUuid — nothing to route on, ignoring",
    );
    return ok({ ignored: true });
  }

  const resolved = await ctx.runQuery(
    internal.functions.finance.webhooks.resolveCardForProviderWebhook,
    { provider: "bill", providerCardId: cardUuid },
  );
  if (!resolved) {
    console.log(
      `[BillWebhook] No Togather card (or no active connection) for card ${cardUuid} — ignoring`,
    );
    return ok({ ignored: true });
  }

  // Decrypts the community's token into the adapter. Any failure here is a
  // deployment problem (missing master key, incomplete rotation), not a bad
  // request — 500 so BILL retries once it's fixed.
  let provider;
  try {
    provider = await getCardProviderByName("bill", resolved.connection);
  } catch (error) {
    console.error(
      "[BillWebhook] Could not build the provider adapter (credential undecryptable?)",
      error,
    );
    return new Response("Webhook not configured", { status: 500 });
  }

  if (!provider.fetchTransaction) {
    // Structurally impossible while the BILL adapter is the only thing mounted
    // here, and a hard failure rather than a fallback ON PURPOSE: the fallback
    // would be "book the unauthenticated payload", which is the one behaviour
    // this entire handler exists to prevent.
    console.error(
      "[BillWebhook] Adapter cannot re-fetch transactions — refusing to record an unverified payload",
    );
    return new Response("Webhook not configured", { status: 500 });
  }

  let txn: ProviderTxn | null;
  try {
    txn = await provider.fetchTransaction(transactionUuid);
  } catch (error) {
    // The fetch itself failed (rate limit, revoked token, BILL down). 500 so
    // BILL redelivers; the hourly poll covers it either way.
    console.error(
      `[BillWebhook] Could not re-fetch transaction ${transactionUuid}:`,
      error,
    );
    return new Response("Webhook processing failed", { status: 500 });
  }

  if (!txn) {
    // BILL has no such transaction. Either a forged/garbage delivery or one
    // for an object that no longer exists — both are "write nothing", and
    // neither is worth a retry.
    console.log(
      `[BillWebhook] BILL has no transaction ${transactionUuid} — ignoring (payloads are hints, not evidence)`,
    );
    return ok({ ignored: true });
  }

  try {
    await recordProviderTransaction(ctx, "bill", txn, "BillWebhook");
    return ok();
  } catch (error) {
    console.error("[BillWebhook] Error processing transaction:", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}

/**
 * Book one normalized provider transaction, or explain why we didn't.
 *
 * Shared by the webhook and the hourly poll so a charge is treated identically
 * however it reaches us — which is what makes the poll a genuine backstop for
 * missed deliveries rather than a second, subtly different importer.
 *
 * Returns whether it recorded, so the poller can count.
 *
 * THREE THINGS ARE DELIBERATELY NOT RECORDED YET:
 * - `pending` — an authorization is not money moved (see above).
 * - `declined` — logged; Phase 3 turns these into a notification for the
 *   cardholder, which is the only form in which a decline is useful.
 * - NEGATIVE amounts (a refund/return) — reversing a `card_charge` expense and
 *   posting the matching ledger credit is real work that belongs with the
 *   expense module. Recording the credit as if it were a charge would debit
 *   the fund twice for a refund, so until that lands, skipping loudly is the
 *   correct behaviour, not a shortcut.
 */
export async function recordProviderTransaction(
  ctx: ActionCtx,
  provider: string,
  txn: ProviderTxn,
  logTag: string,
): Promise<boolean> {
  if (txn.state !== "settled") {
    console.log(
      `[${logTag}] ${txn.state} transaction ${txn.providerTxnId} on card ${txn.providerCardId} — not recorded (Phase 1 records clearings only)`,
    );
    return false;
  }
  if (txn.amountCents <= 0) {
    // NOTE: a Privacy Transaction accumulates its events, so a charge that
    // CLEARED and was later partly returned normalizes negative too (net
    // amount, RETURN present). In the normal case that is conservative — the
    // clearing was already booked at gross, so we over-state spend rather
    // than hide it. The one lossy case is a charge whose clearing webhook was
    // missed AND whose return landed inside the same poll window: the net
    // spend is then never booked at all. It is loud here rather than silent
    // because that is all this Phase can honestly do; booking the net as a
    // fresh charge would double-debit every ordinary refund.
    // TODO: fold this into the expense module's refund reversal (ADR-033
    // Phase 2), which is the layer that can tell the two cases apart.
    console.log(
      `[${logTag}] credit/zero transaction ${txn.providerTxnId} (${txn.amountCents} cents) — refund reversal is not implemented yet, skipping`,
    );
    return false;
  }

  await ctx.runMutation(internal.functions.finance.webhooks.recordCardSettlement, {
    provider,
    providerCardId: txn.providerCardId,
    providerTxnId: txn.providerTxnId,
    // WHEN it happened, not when we heard about it. The hourly backstop exists
    // precisely to import charges hours after the fact, and stamping those
    // with `now()` files them in the wrong month and evaluates them against
    // the wrong spend-limit window.
    occurredAtMs: Number.isFinite(txn.occurredAtMs)
      ? txn.occurredAtMs
      : undefined,
    // No `accountRef`: this provider has no per-fund account to cross-check
    // against. See recordCardSettlement's comment on hardFundIsolation.
    amountCents: txn.amountCents,
    merchantDescription: txn.merchantName ?? txn.description ?? "Card charge",
  });
  return true;
}

// ============================================================================
// handleFinanceStripeEvent — called from the existing /stripe-webhook route
// (functions/ee/billing.ts's events already live there) for events billing's
// own switch doesn't own.
// ============================================================================

/** The subset of a Stripe `account.updated` event's `data.object` we read. */
interface StripeAccountUpdatedObject {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[];
  };
}

/** The subset of a Stripe `charge.refunded` event's `data.object` we read. */
interface StripeChargeObject {
  id: string;
  /** Expandable — a bare id string unless the webhook was configured to expand it. */
  payment_intent?: string | { id: string } | null;
  amount_refunded?: number;
}

/** The subset of a Stripe `charge.dispute.created` event's `data.object` we read. */
interface StripeDisputeObject {
  id: string;
  payment_intent?: string | { id: string } | null;
  amount?: number;
}

interface StripeFinanceEvent {
  type: string;
  /** Connected-account id, present on Connect-delivered events (payouts). */
  account?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stripe
  // event payloads are shape-checked per event type below.
  data: { object: any };
}

/**
 * Resolve which community a Connect event belongs to. No index on
 * stripeConnectedAccountId (by_community only) — full-table filter is fine
 * at today's community count; add an index if this ever shows in profiles.
 */
export const getCommunityFinanceByStripeAccount = internalQuery({
  args: { stripeConnectedAccountId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("communityFinance")
      .filter((q) =>
        q.eq(q.field("stripeConnectedAccountId"), args.stripeConnectedAccountId),
      )
      .first();
  },
});

// ============================================================================
// Defense-in-depth: verify a donation-crediting Stripe event actually fired
// on the community's OWN connected account before crediting anything.
// `metadata.fundId` on a Connect event is otherwise trusted at face value —
// it's data WE set when creating the PaymentIntent, but nothing stops a
// malformed/adversarial event claiming a fundId that belongs to a different
// community than the one the event's `account` field says it came from.
// Cross-checking event.account against the fund's OWN
// communityFinance.stripeConnectedAccountId closes that gap server-side.
// ============================================================================

/**
 * `fundId` arrives as a plain string (Stripe metadata, or a Charge's
 * `payment_intent` reference) — never a validated `v.id("funds")` — so it
 * may be garbage or reference a fund that doesn't exist. `normalizeId`
 * (mirrors the pattern in functions/prayers/reactions.ts) returns null
 * instead of throwing for a malformed/foreign-table id, which is what lets
 * this stay a query rather than needing a try/catch around `ctx.db.get`.
 */
export const getFundFinanceForWebhook = internalQuery({
  args: { fundId: v.string() },
  handler: async (ctx, args) => {
    const fundId = ctx.db.normalizeId("funds", args.fundId);
    if (!fundId) return null;
    const fund = await ctx.db.get(fundId);
    if (!fund) return null;
    const communityFinance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    return { fund, communityFinance };
  },
});

/**
 * Same shape of lookup as `getFundFinanceForWebhook`, but keyed off a
 * PaymentIntent id instead of a fundId — `charge.refunded` doesn't carry a
 * trustworthy fundId of its own (see the file-level comment on
 * `handleFinanceStripeEvent`'s "charge.refunded" case for why), so the
 * account check for a refund resolves the fund via the donation it refunds.
 */
export const getDonationFundForWebhook = internalQuery({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, args) => {
    const donation = await ctx.db
      .query("donations")
      .withIndex("by_stripePaymentIntentId", (q) =>
        q.eq("stripePaymentIntentId", args.paymentIntentId),
      )
      .first();
    if (!donation) return null;
    const fund = await ctx.db.get(donation.fundId);
    if (!fund) return null;
    const communityFinance = await ctx.db
      .query("communityFinance")
      .withIndex("by_community", (q) => q.eq("communityId", fund.communityId))
      .first();
    return { fund, communityFinance };
  },
});

/** Audit-only: writes "webhook.rejected_account_mismatch" for a rejected event. */
export const logAccountMismatch = internalMutation({
  args: {
    communityId: v.id("communities"),
    fundId: v.optional(v.id("funds")),
    eventAccount: v.optional(v.string()),
    expectedAccount: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await logFinanceAudit(ctx, {
      communityId: args.communityId,
      fundId: args.fundId,
      action: "webhook.rejected_account_mismatch",
      details: {
        eventAccount: args.eventAccount ?? null,
        expectedAccount: args.expectedAccount ?? null,
      },
    });
  },
});

/**
 * The base gift is what the donor chose to give; the PaymentIntent's amount
 * is base + voluntary fee cover (createDonationIntent charges the sum).
 * Splits the charged total back into the two parts recordDonationSucceeded
 * expects. Malformed metadata (non-integer, negative, or cover >= total)
 * normalizes to "no cover" so the ledger records exactly what Stripe
 * charged, never more.
 */
export function splitDonationAmounts(
  intentAmountCents: number,
  rawFeeCoverCents: number,
): { baseCents: number; feeCoverCents: number } {
  if (
    !Number.isInteger(rawFeeCoverCents) ||
    rawFeeCoverCents < 0 ||
    rawFeeCoverCents >= intentAmountCents
  ) {
    return { baseCents: intentAmountCents, feeCoverCents: 0 };
  }
  return {
    baseCents: intentAmountCents - rawFeeCoverCents,
    feeCoverCents: rawFeeCoverCents,
  };
}

// ============================================================================
// Recurring-giving event shapes.
//
// Stripe moved several fields between API versions and the connected account
// decides which version its events are serialized with, so each of these is
// read from BOTH the pre-2025-03-31 location and the current one. Getting
// this wrong doesn't fail loudly — it silently drops a donor's monthly gift —
// so the readers are tolerant by design and each returns null rather than
// guessing.
// ============================================================================

/** `data.object` of a `checkout.session.completed` we might own. */
interface StripeCheckoutSessionObject {
  id: string;
  mode?: string;
  subscription?: string | { id: string } | null;
  customer?: string | { id: string } | null;
}

/** `data.object` of an `invoice.*` event. */
interface StripeInvoiceObject {
  id?: string;
  amount_paid?: number;
  /** Pre-2025-03-31 API versions put the subscription here. */
  subscription?: string | { id: string } | null;
  /**
   * Pre-2025-03-31 sibling of `subscription`, carrying an immutable snapshot
   * of the subscription's metadata taken when the invoice was finalized.
   */
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  /** 2025-03-31+ moved both under `parent.subscription_details`. */
  parent?: {
    subscription_details?: {
      subscription?: string | { id: string } | null;
      metadata?: Record<string, string> | null;
    } | null;
  } | null;
  /** Pre-2025-03-31 API versions put the PaymentIntent here. */
  payment_intent?: string | { id: string } | null;
  /** 2025-03-31+ moved it into the `payments` sub-list. */
  payments?: {
    data?: Array<{
      payment?: { payment_intent?: string | { id: string } | null } | null;
    }>;
  } | null;
  lines?: { data?: Array<{ period?: { end?: number } | null }> } | null;
}

/** `data.object` of a `customer.subscription.*` event. */
interface StripeSubscriptionObject {
  id: string;
  status?: string;
  /** Pre-2025-03-31; newer versions put it on each item instead. */
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string> | null;
  items?: {
    data?: Array<{
      current_period_end?: number;
      price?: { unit_amount?: number | null } | null;
    }>;
  } | null;
}

/** Unwraps Stripe's "id string OR expanded object" union. */
function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string") return value || null;
  return value?.id ?? null;
}

/** The subscription an invoice belongs to, across API versions. */
export function resolveInvoiceSubscriptionId(
  invoice: StripeInvoiceObject,
): string | null {
  return (
    stripeId(invoice.subscription) ??
    stripeId(invoice.parent?.subscription_details?.subscription)
  );
}

/**
 * The `recurringDonations` row id we stamped on the subscription, as echoed
 * back on the invoice, across API versions.
 *
 * A LOCATOR ONLY — never an amount, a fund, or a donor. Stripe does not
 * guarantee webhook ORDER, so `invoice.paid` for the very first month can
 * arrive before `checkout.session.completed` has bound the subscription id to
 * the row, and a subscription-id lookup would then find nothing and silently
 * drop a real payment. This is the second way to find the same row; what that
 * row SAYS is still the only thing trusted about the gift, and the caller
 * re-checks `event.account` against it exactly as it does on the normal path.
 */
export function resolveInvoiceRecurringDonationId(
  invoice: StripeInvoiceObject,
): string | null {
  const id =
    invoice.subscription_details?.metadata?.recurringDonationId ??
    invoice.parent?.subscription_details?.metadata?.recurringDonationId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The PaymentIntent that paid an invoice, across API versions. This is the
 * idempotency key a recurring donation is recorded under — the same key a
 * one-off gift uses — so a redelivered `invoice.paid` can't double-credit.
 */
export function resolveInvoicePaymentIntentId(
  invoice: StripeInvoiceObject,
): string | null {
  const legacy = stripeId(invoice.payment_intent);
  if (legacy) return legacy;
  for (const entry of invoice.payments?.data ?? []) {
    const id = stripeId(entry.payment?.payment_intent);
    if (id) return id;
  }
  return null;
}

/**
 * Last resort for an invoice's PaymentIntent: ask Stripe for the invoice
 * again, with `payments` expanded.
 *
 * `Invoice.payments` is typed OPTIONAL by the SDK — unlike `lines`,
 * `amount_paid` and `parent`, which are not — the convention for a field that
 * may only arrive when expanded, and webhook payloads are never expanded. When
 * the delivered payload does carry it, `resolveInvoicePaymentIntentId` already
 * answered and this never runs. When it doesn't, the alternative is dropping a
 * monthly gift Stripe really did collect, which is far worse than one extra
 * API call on a path that fires once a month per donor.
 *
 * Returns null on any failure — the caller then logs loudly and declines to
 * record, rather than inventing an idempotency key.
 */
async function fetchInvoicePaymentIntentId(
  invoiceId: string | undefined,
  eventAccount: string | undefined,
): Promise<string | null> {
  if (!invoiceId || !eventAccount) return null;
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });
    const fresh = (await stripe.invoices.retrieve(
      invoiceId,
      { expand: ["payments"] },
      { stripeAccount: eventAccount },
    )) as StripeInvoiceObject;
    return resolveInvoicePaymentIntentId(fresh);
  } catch (error) {
    console.error(
      `[finance] invoice.paid: could not re-read invoice ${invoiceId} for its PaymentIntent`,
      error,
    );
    return null;
  }
}

/** When the paid-for period ends, in ms — the donor-facing "next bill" date. */
export function resolveInvoicePeriodEndMs(
  invoice: StripeInvoiceObject,
): number | undefined {
  const end = invoice.lines?.data?.[0]?.period?.end;
  return typeof end === "number" ? end * 1000 : undefined;
}

/**
 * Stripe's subscription status vocabulary mapped onto the four states
 * `recurringDonations.status` models.
 *
 * `incomplete` means the very first payment hasn't succeeded yet, which is
 * exactly what our "pending" already means — returning null leaves the row
 * where it is rather than inventing a transition. Everything that means "we
 * are not collecting from this card right now" collapses to `past_due`,
 * because that is the only state the donor-facing copy distinguishes.
 */
export function mapStripeSubscriptionStatus(
  status: string | undefined,
): "active" | "past_due" | "canceled" | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null; // "incomplete" and anything Stripe adds later.
  }
}

/** The period end a subscription object reports, in ms, across API versions. */
export function resolveSubscriptionPeriodEndMs(
  subscription: StripeSubscriptionObject,
): number | undefined {
  const end =
    subscription.current_period_end ??
    subscription.items?.data?.[0]?.current_period_end;
  return typeof end === "number" ? end * 1000 : undefined;
}

/**
 * The gift/fee-cover split a subscription now charges, or null.
 *
 * Only trusted when the metadata WE set adds up to the price the subscription
 * actually bills. A donor changing their amount updates both in one Stripe
 * call (`updateRecurringAmount`), so a disagreement means the metadata is
 * stale or was written by something else — in which case leaving the row
 * alone beats recording a split the donor isn't being billed.
 */
export function resolveSubscriptionAmounts(
  subscription: StripeSubscriptionObject,
): { amountCents: number; feeCoverCents: number } | null {
  const unitAmount = subscription.items?.data?.[0]?.price?.unit_amount;
  if (typeof unitAmount !== "number") return null;
  const amountCents = Number(subscription.metadata?.amountCents);
  const feeCoverCents = Number(subscription.metadata?.feeCoverCents);
  if (
    !Number.isInteger(amountCents) ||
    !Number.isInteger(feeCoverCents) ||
    amountCents <= 0 ||
    feeCoverCents < 0 ||
    amountCents + feeCoverCents !== unitAmount
  ) {
    return null;
  }
  return { amountCents, feeCoverCents };
}

export async function handleFinanceStripeEvent(
  ctx: ActionCtx,
  event: StripeFinanceEvent,
): Promise<void> {
  switch (event.type) {
    case "account.updated": {
      const account = event.data.object as StripeAccountUpdatedObject;
      const requirements = account.requirements ?? {};
      await ctx.runMutation(
        internal.functions.finance.onboarding.applyStripeAccountStatus,
        {
          accountId: account.id,
          chargesEnabled: !!account.charges_enabled,
          payoutsEnabled: !!account.payouts_enabled,
          disabledReason: requirements.disabled_reason ?? undefined,
          requirementsSummary: requirements.currently_due,
        },
      );
      return;
    }

    case "payment_intent.succeeded": {
      const intent = event.data.object;
      const metadata = intent.metadata ?? {};
      // Only donation intents carry fundId metadata (set by
      // createDonationIntent). Billing's own payment intents don't, and are
      // ignored here.
      if (!metadata.fundId || !metadata.communityId) {
        return;
      }

      // Defense-in-depth (ADR-032 §6): metadata.fundId is data WE set, but
      // nothing about the webhook itself proves this event actually came
      // from THIS fund's community's own connected account — resolve the
      // fund's communityFinance server-side and require the event's
      // Connect account to match before crediting anything.
      const financeForFund = await ctx.runQuery(
        internal.functions.finance.webhooks.getFundFinanceForWebhook,
        { fundId: metadata.fundId },
      );
      if (!financeForFund?.fund) {
        console.error(
          `[finance] payment_intent.succeeded: fundId ${metadata.fundId} does not resolve to a real fund — ignoring`,
        );
        return;
      }
      const expectedAccount = financeForFund.communityFinance?.stripeConnectedAccountId;
      if (!event.account || event.account !== expectedAccount) {
        console.error(
          `[finance] payment_intent.succeeded: account mismatch on fund ${financeForFund.fund._id} — event.account=${event.account ?? "missing"} expected=${expectedAccount ?? "none"}`,
        );
        await ctx.runMutation(
          internal.functions.finance.webhooks.logAccountMismatch,
          {
            communityId: financeForFund.fund.communityId,
            fundId: financeForFund.fund._id,
            eventAccount: event.account,
            expectedAccount,
          },
        );
        return;
      }

      // intent.amount is the TOTAL Stripe charged (base gift + fee cover,
      // set by createDonationIntent). recordDonationSucceeded's contract
      // takes the BASE gift and adds feeCoverCents itself when crediting
      // the ledger — passing the total would double-count the fee cover
      // (Codex review, PR #653).
      const { baseCents, feeCoverCents } = splitDonationAmounts(
        intent.amount,
        Number(metadata.feeCoverCents ?? 0),
      );
      await ctx.runMutation(
        internal.functions.finance.giving.recordDonationSucceeded,
        {
          paymentIntentId: intent.id,
          fundId: metadata.fundId,
          donorUserId: metadata.donorUserId || undefined,
          amountCents: baseCents,
          feeCoverCents,
          communityId: metadata.communityId,
        },
      );
      return;
    }

    // ------------------------------------------------------------------
    // Recurring giving. http.ts routes these here only when
    // `isConnectEvent(event)` — the platform-account versions belong to SaaS
    // billing (see lib/finance/webhookRouting.ts).
    // ------------------------------------------------------------------

    case "checkout.session.completed": {
      const session = event.data.object as StripeCheckoutSessionObject;
      // A one-off donation Checkout needs nothing here: its money is
      // recorded from `payment_intent.succeeded`, and it has no row to bind.
      if (session.mode !== "subscription") {
        return;
      }
      const subscriptionId = stripeId(session.subscription);
      if (!subscriptionId) {
        console.error(
          `[finance] checkout.session.completed: subscription-mode session ${session.id} has no subscription`,
        );
        return;
      }
      await ctx.runMutation(
        internal.functions.finance.giving.bindRecurringSubscription,
        {
          checkoutSessionId: session.id,
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: stripeId(session.customer) ?? undefined,
          eventAccount: event.account,
        },
      );
      return;
    }

    case "invoice.paid": {
      // THE money event for monthly giving. A subscription's PaymentIntent
      // carries no metadata of ours (subscription mode forbids
      // `payment_intent_data`), so `payment_intent.succeeded` ignores it and
      // this is where a recurring charge becomes a `donations` row.
      const invoice = event.data.object as StripeInvoiceObject;
      const subscriptionId = resolveInvoiceSubscriptionId(invoice);
      if (!subscriptionId) {
        return; // A one-off invoice — not a monthly gift.
      }
      const paymentIntentId =
        resolveInvoicePaymentIntentId(invoice) ??
        (await fetchInvoicePaymentIntentId(invoice.id, event.account));
      if (!paymentIntentId) {
        // Without it there is no idempotency key, and recording anyway would
        // risk double-crediting on redelivery. Loud, because a real monthly
        // gift landing here means money collected but not credited.
        console.error(
          `[finance] invoice.paid: invoice ${invoice.id ?? "?"} for subscription ${subscriptionId} has no payment_intent — not recording`,
        );
        return;
      }
      await ctx.runMutation(
        internal.functions.finance.giving.recordRecurringDonationPaid,
        {
          stripeSubscriptionId: subscriptionId,
          paymentIntentId,
          amountPaidCents: invoice.amount_paid,
          currentPeriodEnd: resolveInvoicePeriodEndMs(invoice),
          eventAccount: event.account,
          // Only used if the subscription id hasn't been bound to a row yet —
          // see resolveInvoiceRecurringDonationId.
          recurringDonationIdHint:
            resolveInvoiceRecurringDonationId(invoice) ?? undefined,
        },
      );
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as StripeInvoiceObject;
      const subscriptionId = resolveInvoiceSubscriptionId(invoice);
      if (!subscriptionId) {
        return;
      }
      // No dunning email in this pass — the row going `past_due` is what the
      // donor-facing management screen renders from.
      await ctx.runMutation(
        internal.functions.finance.giving.applyRecurringSubscriptionState,
        {
          stripeSubscriptionId: subscriptionId,
          status: "past_due",
          eventAccount: event.account,
          reason: "invoice.payment_failed",
        },
      );
      return;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as StripeSubscriptionObject;
      const amounts = resolveSubscriptionAmounts(subscription);
      await ctx.runMutation(
        internal.functions.finance.giving.applyRecurringSubscriptionState,
        {
          stripeSubscriptionId: subscription.id,
          status: mapStripeSubscriptionStatus(subscription.status) ?? undefined,
          currentPeriodEnd: resolveSubscriptionPeriodEndMs(subscription),
          amountCents: amounts?.amountCents,
          feeCoverCents: amounts?.feeCoverCents,
          eventAccount: event.account,
          reason: "customer.subscription.updated",
        },
      );
      return;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as StripeSubscriptionObject;
      await ctx.runMutation(
        internal.functions.finance.giving.applyRecurringSubscriptionState,
        {
          stripeSubscriptionId: subscription.id,
          status: "canceled",
          eventAccount: event.account,
          reason: "customer.subscription.deleted",
        },
      );
      return;
    }

    case "charge.refunded": {
      const charge = event.data.object as StripeChargeObject;
      // Donation charges are always created FROM a donation PaymentIntent,
      // so `payment_intent` is how we trace a refund back to its donation —
      // we deliberately do NOT gate on `charge.metadata?.fundId` the way
      // payment_intent.succeeded gates on PaymentIntent metadata: nothing in
      // this codebase sets metadata directly on the Charge object (only on
      // the PaymentIntent, in createDonationIntent), and relying on Stripe
      // implicitly copying PaymentIntent metadata onto the Charge is an
      // assumption this repo doesn't assert anywhere — silently dropping a
      // real refund because that assumption turned out wrong would be
      // exactly the bug this fix exists to close. recordDonationRefund (via
      // getDonationFundForWebhook here, and its own lookup) already resolves
      // the donation authoritatively by `payment_intent`, so a non-donation
      // (e.g. billing) charge refund just misses both lookups and no-ops.
      if (!charge.payment_intent) {
        return;
      }
      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent.id;

      const donationFinance = await ctx.runQuery(
        internal.functions.finance.webhooks.getDonationFundForWebhook,
        { paymentIntentId },
      );
      if (!donationFinance?.fund) {
        return; // Not a donation charge — nothing for finance to do.
      }
      const expectedAccount = donationFinance.communityFinance?.stripeConnectedAccountId;
      if (!event.account || event.account !== expectedAccount) {
        console.error(
          `[finance] charge.refunded: account mismatch on fund ${donationFinance.fund._id} — event.account=${event.account ?? "missing"} expected=${expectedAccount ?? "none"}`,
        );
        await ctx.runMutation(
          internal.functions.finance.webhooks.logAccountMismatch,
          {
            communityId: donationFinance.fund.communityId,
            fundId: donationFinance.fund._id,
            eventAccount: event.account,
            expectedAccount,
          },
        );
        return;
      }

      await ctx.runMutation(
        internal.functions.finance.giving.recordDonationRefund,
        {
          paymentIntentId,
          chargeId: charge.id,
          amountRefundedCents: charge.amount_refunded ?? 0,
        },
      );
      return;
    }

    case "charge.dispute.created": {
      // Audit-only for now — no ledger entry, no fund-status gate. ADR-032
      // doesn't yet define a dispute-lifecycle state machine (provisional
      // debit, win/loss reversal); any actual bank-side withdrawal Stripe
      // performs will surface as ledger/bank drift and get caught by the
      // existing nightly reconcile job until that lands (see giving.ts's
      // recordDonationDisputed for the full rationale).
      const dispute = event.data.object as StripeDisputeObject;
      const paymentIntentId =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
      await ctx.runMutation(
        internal.functions.finance.giving.recordDonationDisputed,
        {
          paymentIntentId,
          disputeId: dispute.id,
          amountCents: dispute.amount ?? 0,
        },
      );
      return;
    }

    // Both events mean "this payout's composition is readable now". Stripe
    // attributes balance transactions to a payout ASYNCHRONOUSLY, which is
    // exactly what `payout.reconciliation_completed` announces — a query at
    // `payout.paid` alone can come back partial or empty, and an empty plan
    // has no automatic recovery (see jobs.ts `runAllocation`). Running both
    // is safe: allocation is idempotent per (payout, donation), so the second
    // pass either finds nothing left to do or finishes the tail the first
    // one couldn't see yet.
    case "payout.paid":
    case "payout.reconciliation_completed": {
      // Payouts fire on the CONNECTED account, so the payload has no
      // metadata of ours — resolve the community from event.account.
      if (!event.account) {
        return;
      }
      const finance = await ctx.runQuery(
        internal.functions.finance.webhooks.getCommunityFinanceByStripeAccount,
        { stripeConnectedAccountId: event.account },
      );
      if (!finance) {
        return; // Not a giving-enabled community's account.
      }
      const payout = event.data.object;
      await ctx.runAction(internal.functions.finance.jobs.runAllocation, {
        communityId: finance.communityId,
        stripePayoutId: payout.id,
        payoutCents: payout.amount,
      });
      return;
    }

    case "payout.failed": {
      // Stripe can follow `payout.paid` with `payout.failed` when the bank
      // rejects it. Anything the paid event bound to this payout has to be
      // unbound, or the hourly retry cron — which resumes bound items
      // unconditionally now — spends forever trying to move money out of a
      // receiving Account that never received it.
      if (!event.account) {
        return;
      }
      const finance = await ctx.runQuery(
        internal.functions.finance.webhooks.getCommunityFinanceByStripeAccount,
        { stripeConnectedAccountId: event.account },
      );
      if (!finance) {
        return;
      }
      const payout = event.data.object;
      const { unbound } = await ctx.runMutation(
        internal.functions.finance.jobs.unbindFailedPayout,
        { communityId: finance.communityId, stripePayoutId: payout.id },
      );
      console.error(
        `[finance] payout.failed: ${payout.id} for community ${finance.communityId} — unbound ${unbound} donation(s)`,
      );
      return;
    }

    default:
      // Not a group-giving event — billing's switch owns everything else.
      // Within group-giving's own Stripe surface, still deliberately
      // unhandled (not silently dropped, just not yet needed): other
      // charge/dispute lifecycle events (charge.dispute.updated/.closed,
      // charge.dispute.funds_withdrawn/.funds_reinstated), account.updated's
      // sibling capability events, and anything else Connect can deliver
      // that this fund/ledger model has no reaction to yet.
      return;
  }
}
