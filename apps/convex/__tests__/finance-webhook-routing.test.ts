/**
 * /stripe-webhook routing between SaaS billing and group giving.
 *
 * Three Stripe event types are ambiguous between the two systems, because a
 * recurring donation is a Stripe Subscription just like a community's
 * Togather subscription: `customer.subscription.updated`,
 * `customer.subscription.deleted`, `invoice.payment_failed`. A recurring
 * donation lives on the community's CONNECTED account, so its events arrive
 * with `event.account` set — those must NOT reach the billing handlers,
 * which would otherwise match a donor's subscription id against a
 * community's own row.
 *
 * These tests drive the real HTTP route (signature and all) and assert the
 * only externally-observable thing billing does: patching
 * `communities.subscriptionStatus`. A Connect-flagged event must leave that
 * field untouched; a platform event must keep behaving exactly as before.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-webhook-routing.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeAll } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { isConnectEvent } from "../lib/finance/webhookRouting";

const WEBHOOK_SECRET = "whsec_test_routing_secret";

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

/**
 * Build the `stripe-signature` header the route verifies (HMAC-SHA256 over
 * `{timestamp}.{payload}`, same construction as verifyStripeSignature).
 */
async function signedHeader(payload: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${payload}`),
  );
  const sig = Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${sig}`;
}

async function postEvent(
  t: ReturnType<typeof convexTest>,
  event: Record<string, unknown>,
): Promise<Response> {
  const body = JSON.stringify(event);
  return await t.fetch("/stripe-webhook", {
    method: "POST",
    headers: {
      "stripe-signature": await signedHeader(body),
      "Content-Type": "application/json",
    },
    body,
  });
}

async function seedSubscribedCommunity(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Routing Test Community",
      slug: "ROUTE001",
      stripeCustomerId: "cus_platform_123",
      stripeSubscriptionId: "sub_platform_123",
      subscriptionStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function subscriptionStatusOf(
  t: ReturnType<typeof convexTest>,
  communityId: Awaited<ReturnType<typeof seedSubscribedCommunity>>,
) {
  return await t.run(async (ctx) => {
    const community = await ctx.db.get(communityId);
    return community?.subscriptionStatus;
  });
}

// ============================================================================
// The routing predicate itself
// ============================================================================

describe("isConnectEvent (lib/finance/webhookRouting.ts)", () => {
  test("true only when the event carries a connected-account id", () => {
    expect(isConnectEvent({ account: "acct_connected_123" })).toBe(true);
    expect(isConnectEvent({})).toBe(false);
    expect(isConnectEvent({ account: undefined })).toBe(false);
    expect(isConnectEvent({ account: null })).toBe(false);
    // An empty string is not an account id — treat it as a platform event
    // rather than routing a billing event into the finance handler.
    expect(isConnectEvent({ account: "" })).toBe(false);
  });
});

// ============================================================================
// The route
// ============================================================================

describe("/stripe-webhook routes shared event types by event.account", () => {
  test("customer.subscription.deleted WITH event.account does not touch billing", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    const response = await postEvent(t, {
      type: "customer.subscription.deleted",
      account: "acct_connected_123",
      // Deliberately the community's OWN subscription id: if routing were
      // wrong, billing would cancel a paying community because a donor
      // canceled a monthly gift.
      data: { object: { id: "sub_platform_123", status: "canceled" } },
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(t, communityId)).toBe("active");
  });

  test("customer.subscription.deleted WITHOUT event.account still cancels (unchanged)", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    const response = await postEvent(t, {
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_platform_123", status: "canceled" } },
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(t, communityId)).toBe("canceled");
  });

  test("customer.subscription.updated WITH event.account does not touch billing", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    const response = await postEvent(t, {
      type: "customer.subscription.updated",
      account: "acct_connected_123",
      data: { object: { id: "sub_platform_123", status: "past_due" } },
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(t, communityId)).toBe("active");
  });

  test("customer.subscription.updated WITHOUT event.account still syncs status (unchanged)", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    const response = await postEvent(t, {
      type: "customer.subscription.updated",
      data: { object: { id: "sub_platform_123", status: "past_due" } },
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(t, communityId)).toBe("past_due");
  });

  test("invoice.payment_failed WITH event.account does not touch billing", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    const response = await postEvent(t, {
      type: "invoice.payment_failed",
      account: "acct_connected_123",
      data: { object: { customer: "cus_platform_123" } },
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(t, communityId)).toBe("active");
  });

  test("invoice.payment_failed WITHOUT event.account still marks past_due (unchanged)", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    const response = await postEvent(t, {
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_platform_123" } },
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(t, communityId)).toBe("past_due");
  });

  test("checkout.session.completed is untouched by the routing change", async () => {
    // Guard against over-broad routing: only the three ambiguous cases check
    // event.account. A Connect-flagged checkout.session.completed must still
    // reach billing exactly as before.
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(communityId, {
        subscriptionStatus: undefined,
        stripeSubscriptionId: undefined,
      });
    });

    const response = await postEvent(t, {
      type: "checkout.session.completed",
      account: "acct_connected_123",
      data: {
        object: {
          customer: "cus_platform_123",
          subscription: "sub_new_123",
          metadata: { communityId },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(t, communityId)).toBe("active");
  });
});
