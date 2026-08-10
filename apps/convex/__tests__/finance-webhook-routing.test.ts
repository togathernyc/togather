/**
 * /stripe-webhook routing between SaaS billing and group giving.
 *
 * Four Stripe event types are ambiguous between the two systems, because a
 * recurring donation is a Stripe Subscription just like a community's
 * Togather subscription — set up through a Checkout Session and then living
 * the same lifecycle: `checkout.session.completed`,
 * `customer.subscription.updated`, `customer.subscription.deleted`,
 * `invoice.payment_failed`. A recurring donation lives on the community's
 * CONNECTED account, so its events arrive with `event.account` set — those
 * must NOT reach the billing handlers, which would otherwise match a donor's
 * subscription id against a community's own row.
 *
 * These tests drive the real HTTP route (signature and all) and assert the
 * only externally-observable thing billing does: patching
 * `communities.subscriptionStatus`. A Connect-flagged event must leave that
 * field untouched; a platform event must keep behaving exactly as before.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-webhook-routing.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, beforeAll, afterAll } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { isConnectEvent } from "../lib/finance/webhookRouting";

const WEBHOOK_SECRET = "whsec_test_routing_secret";

const priorWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterAll(() => {
  // Restore rather than leak — these tests share the process with every other
  // suite, and a stray STRIPE_WEBHOOK_SECRET changes how other webhook tests
  // verify signatures.
  if (priorWebhookSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = priorWebhookSecret;
  }
});

/**
 * Build the `stripe-signature` header the route verifies (HMAC-SHA256 over
 * `{timestamp}.{payload}`, same construction as verifyStripeSignature).
 *
 * `secret` and `timestamp` are overridable so the signature-enforcement tests
 * below can produce headers the route must REJECT.
 */
async function signedHeader(
  payload: string,
  {
    secret = WEBHOOK_SECRET,
    timestamp = Math.floor(Date.now() / 1000),
  }: { secret?: string; timestamp?: number } = {},
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
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

/**
 * Post with a caller-supplied `stripe-signature` (or none at all), for the
 * tests that assert the route REJECTS bad signatures.
 */
async function postRaw(
  t: ReturnType<typeof convexTest>,
  event: Record<string, unknown>,
  signature: string | null,
): Promise<Response> {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature !== null) headers["stripe-signature"] = signature;
  return await t.fetch("/stripe-webhook", { method: "POST", headers, body });
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

  test("checkout.session.completed WITH event.account never activates a community subscription", async () => {
    // This assertion is the FLIP that PR #736's version of this test told the
    // recurring-giving PR to make. Its reasoning was exactly right: a monthly
    // donation opens a subscription-mode Checkout Session on the CONNECTED
    // account, so this type became ambiguous the moment that action shipped.
    // Left unrouted, the completed session arrives with `event.account` set
    // and donor metadata, and billing's handleCheckoutCompleted requires
    // `communityId: v.string()` — it would either mark the wrong community
    // paid or throw, 500, and have Stripe retry forever.

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
          id: "cs_donor_monthly",
          mode: "subscription",
          customer: "cus_donor_123",
          subscription: "sub_donor_123",
          metadata: { communityId },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(await subscriptionStatusOf(t, communityId)).toBeNull();
  });

  test("checkout.session.completed WITHOUT event.account still activates the community subscription (unchanged)", async () => {
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

  test("invoice.paid falls through to the finance dispatcher and no-ops", async () => {
    // The PR claim being pinned: billing never owned invoice.paid, so it hits
    // the `default:` arm and reaches handleFinanceStripeEvent, which returns
    // silently for event types group giving doesn't own yet. 200, and billing
    // state untouched — with or without event.account.
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    for (const account of [undefined, "acct_connected_123"]) {
      const response = await postEvent(t, {
        type: "invoice.paid",
        ...(account ? { account } : {}),
        data: { object: { customer: "cus_platform_123", id: "in_123" } },
      });

      expect(response.status).toBe(200);
      expect(await subscriptionStatusOf(t, communityId)).toBe("active");
    }
  });
});

// ============================================================================
// Signature verification — the routing tests above are only meaningful if the
// route they drive actually rejects unsigned/forged bodies. Without these, a
// verifyStripeSignature weakened to always-true would leave every test above
// green while making `event.account` attacker-controlled.
// ============================================================================

describe("/stripe-webhook rejects anything it cannot verify", () => {
  const event = {
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_platform_123", status: "canceled" } },
  };

  test("400s when the stripe-signature header is missing", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    const response = await postRaw(t, event, null);

    expect(response.status).toBe(400);
    expect(await subscriptionStatusOf(t, communityId)).toBe("active");
  });

  test("400s when the signature was made with the wrong secret", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);
    const body = JSON.stringify(event);

    const response = await postRaw(
      t,
      event,
      await signedHeader(body, { secret: "whsec_not_the_real_secret" }),
    );

    expect(response.status).toBe(400);
    expect(await subscriptionStatusOf(t, communityId)).toBe("active");
  });

  test("400s on a validly-signed but stale payload (replay window)", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);
    const body = JSON.stringify(event);

    // Correct HMAC, timestamp 10 minutes old — outside the route's 300s
    // tolerance.
    const response = await postRaw(
      t,
      event,
      await signedHeader(body, {
        timestamp: Math.floor(Date.now() / 1000) - 600,
      }),
    );

    expect(response.status).toBe(400);
    expect(await subscriptionStatusOf(t, communityId)).toBe("active");
  });

  test("400s when the signed body is tampered with after signing", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedSubscribedCommunity(t);

    // Sign the honest body, then send one with `account` injected — the exact
    // forgery the routing predicate would be vulnerable to if the signature
    // covered anything less than the whole body.
    const signature = await signedHeader(JSON.stringify(event));
    const response = await postRaw(
      t,
      { ...event, account: "acct_attacker" },
      signature,
    );

    expect(response.status).toBe(400);
    expect(await subscriptionStatusOf(t, communityId)).toBe("active");
  });
});
