/**
 * Group giving: provider webhook glue (ADR-032 §6).
 *
 * Two entry points the orchestrator wires into http.ts:
 *
 * - `handleIncreaseWebhookRequest` — a complete httpAction body for a new
 *   `POST /increase-webhook` route: verifies the signature, parses the
 *   event, and dispatches by category.
 * - `handleFinanceStripeEvent` — called from the EXISTING `/stripe-webhook`
 *   route's switch (functions/ee/billing.ts's billing events already live
 *   there) for whatever billing's switch doesn't handle itself, i.e.
 *   `account.updated`.
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
import { now } from "../../lib/utils";
import {
  getEntity,
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
      // Every other category (account.*, account_transfer.*, ach_transfer.*,
      // card.*, transaction.created, ...) belongs to later ADR-032 phases
      // (allocation job, cards, reimbursements) — explicitly ignored, not
      // silently dropped, until those phases wire their own dispatch here.
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

      await ctx.runMutation(
        internal.functions.finance.giving.recordDonationSucceeded,
        {
          paymentIntentId: intent.id,
          fundId: metadata.fundId,
          donorUserId: metadata.donorUserId || undefined,
          amountCents: intent.amount,
          feeCoverCents: Number(metadata.feeCoverCents ?? 0),
          communityId: metadata.communityId,
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

    case "payout.paid": {
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
