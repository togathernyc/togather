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
      return; // Not a group-giving event — billing's switch owns everything else.
  }
}
