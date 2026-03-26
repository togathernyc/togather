/**
 * Stripe Billing Functions
 *
 * Backend functions for managing Stripe subscriptions during community onboarding.
 * Handles checkout session creation, webhook event processing, and billing portal access.
 *
 * Stripe is dynamically imported inside actions so the module only loads when needed.
 * Once STRIPE_SECRET_KEY and STRIPE_PRODUCT_ID env vars are set, these functions
 * are ready to use.
 *
 * Flow:
 * 1. Community proposal is accepted and setup is completed
 * 2. Frontend calls createCheckoutSession with the setupToken
 * 3. User completes Stripe Checkout
 * 4. Stripe webhook calls handleCheckoutCompleted (via HTTP action)
 * 5. Community is activated with billing fields set
 * 6. User can manage billing via createPortalSession
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth, requireAuthFromToken } from "../lib/auth";
import { requirePrimaryAdmin } from "../lib/permissions";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import { getNextFirstOfMonth } from "../lib/utils";

import type { Id } from "../_generated/dataModel";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create the Togather product in Stripe if STRIPE_PRODUCT_ID is not configured.
 * This is a convenience for initial setup — in production, set STRIPE_PRODUCT_ID.
 */
async function getOrCreateProductId(
  stripe: InstanceType<typeof import("stripe").default>
): Promise<string> {
  const envProductId = process.env.STRIPE_PRODUCT_ID;
  if (envProductId) {
    return envProductId;
  }

  const product = await stripe.products.create({
    name: "Togather Community Hosting",
  });
  return product.id;
}

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Look up a community proposal by its setupToken.
 * Used internally by createCheckoutSession to validate the onboarding flow.
 */
export const getProposalBySetupToken = internalQuery({
  args: { setupToken: v.string() },
  handler: async (ctx, args) => {
    const proposal = await ctx.db
      .query("communityProposals")
      .withIndex("by_setupToken", (q) => q.eq("setupToken", args.setupToken))
      .first();

    return proposal ?? null;
  },
});

/**
 * Get billing-related fields for a community.
 * Used internally by createPortalSession and other billing functions.
 */
export const getCommunityBilling = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const community = await ctx.db.get(args.communityId);
    if (!community) {
      return null;
    }

    return {
      _id: community._id,
      stripeCustomerId: community.stripeCustomerId,
      stripeSubscriptionId: community.stripeSubscriptionId,
      subscriptionStatus: community.subscriptionStatus,
      subscriptionPriceMonthly: community.subscriptionPriceMonthly,
      billingEmail: community.billingEmail,
    };
  },
});

/**
 * Verify that the user identified by a token is a PRIMARY_ADMIN of the given community.
 * Used internally by actions that need community-admin authorization.
 */
export const verifyBillingAccess = internalQuery({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requirePrimaryAdmin(ctx, args.communityId, userId);
    return { userId: userId as string };
  },
});

// ============================================================================
// Actions (external API calls to Stripe)
// ============================================================================

/**
 * Create a Stripe Checkout session for a community proposal.
 *
 * Called after the community setup wizard is completed. The setupToken
 * serves as authentication — only someone with the token (sent via email
 * to the proposal contact) can initiate billing.
 *
 * Prerequisites:
 * - Proposal must exist and be in "accepted" status
 * - Setup must be completed (setupCompletedAt is set)
 * - No existing Stripe subscription on the proposal
 *
 * @returns { url: string } - The Stripe Checkout URL to redirect the user to
 */
export const createCheckoutSession = action({
  args: { setupToken: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    // Look up the proposal by setup token
    const proposal = await ctx.runQuery(
      internal.functions.billing.getProposalBySetupToken,
      { setupToken: args.setupToken }
    );

    if (!proposal) {
      throw new Error("Invalid setup token — proposal not found");
    }

    if (proposal.status !== "accepted") {
      throw new Error(
        `Proposal is not accepted (current status: ${proposal.status})`
      );
    }

    if (!proposal.setupCompletedAt) {
      throw new Error(
        "Community setup has not been completed yet. Please finish setup first."
      );
    }

    if (proposal.stripeSubscriptionId) {
      throw new Error("A subscription already exists for this proposal");
    }

    if (!proposal.communityId) {
      throw new Error(
        "No community associated with this proposal. Setup may be incomplete."
      );
    }

    const communityId = proposal.communityId as string;
    const proposalId = proposal._id as string;

    // Dynamic import — Stripe is only loaded when this action runs
    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: "2026-02-25.clover",
      });

      // Reuse existing Stripe customer if checkout was previously started
      // (e.g., abandoned or expired session), otherwise create a new one.
      let customerId = proposal.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: proposal.communityName,
          metadata: {
            communityId,
            proposalId,
          },
        });
        customerId = customer.id;
      }

      // Create a recurring price for this community's subscription
      const productId = await getOrCreateProductId(stripe);
      const price = await stripe.prices.create({
        unit_amount: proposal.proposedMonthlyPrice * 100, // Convert dollars to cents
        currency: "usd",
        recurring: { interval: "month" },
        product: productId,
        metadata: {
          communityId,
        },
      });

      // Create the checkout session
      // Anchor billing to the 1st of next month — Stripe prorates the first partial period
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: price.id, quantity: 1 }],
        subscription_data: {
          billing_cycle_anchor: getNextFirstOfMonth(),
        },
        success_url:
          DOMAIN_CONFIG.landingUrl +
          "/onboarding/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url:
          DOMAIN_CONFIG.landingUrl +
          "/onboarding/setup?token=" +
          args.setupToken,
        metadata: {
          communityId,
          proposalId,
        },
      });

      // Save Stripe IDs on the proposal for tracking
      await ctx.runMutation(
        internal.functions.billing.saveStripeIds,
        {
          proposalId: proposal._id,
          stripeCustomerId: customerId,
          stripePriceId: price.id,
        }
      );

      if (!session.url) {
        throw new Error(
          "Stripe returned a checkout session without a URL. Please try again."
        );
      }

      return { url: session.url };
    } catch (error) {
      // Re-throw known billing errors; wrap unexpected ones
      if (error instanceof Error && error.message.includes("Proposal")) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("subscription")) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("setup")) {
        throw error;
      }
      throw new Error(
        `Failed to create checkout session: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  },
});

/**
 * Create a Stripe Billing Portal session for managing an existing subscription.
 *
 * Requires authentication. The authenticated user must have access to the community.
 * Returns a URL that redirects the user to Stripe's self-service billing portal
 * where they can update payment methods, view invoices, or cancel.
 *
 * @returns { url: string } - The Stripe Billing Portal URL
 */
export const createPortalSession = action({
  args: {
    token: v.string(),
    communityId: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    // Verify the user is a PRIMARY_ADMIN of this community
    await ctx.runQuery(internal.functions.billing.verifyBillingAccess, {
      token: args.token,
      communityId: args.communityId as Id<"communities">,
    });

    // Look up the community's Stripe customer ID
    const billing = await ctx.runQuery(
      internal.functions.billing.getCommunityBilling,
      { communityId: args.communityId as Id<"communities"> }
    );

    if (!billing) {
      throw new Error("Community not found");
    }

    if (!billing.stripeCustomerId) {
      throw new Error(
        "No billing account found for this community. Subscription may not be set up yet."
      );
    }

    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: "2026-02-25.clover",
      });

      const session = await stripe.billingPortal.sessions.create({
        customer: billing.stripeCustomerId,
        return_url:
          DOMAIN_CONFIG.landingUrl + "/billing/" + args.communityId,
      });

      return { url: session.url };
    } catch (error) {
      throw new Error(
        `Failed to create billing portal session: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  },
});

// ============================================================================
// Internal Mutations (called from webhook handlers)
// ============================================================================

/**
 * Save Stripe customer and price IDs on a proposal after checkout session creation.
 * Called internally by createCheckoutSession.
 */
export const saveStripeIds = internalMutation({
  args: {
    proposalId: v.id("communityProposals"),
    stripeCustomerId: v.string(),
    stripePriceId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.proposalId, {
      stripeCustomerId: args.stripeCustomerId,
      stripePriceId: args.stripePriceId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Handle a successful Stripe Checkout completion.
 *
 * Called from the Stripe webhook handler (HTTP action) after the
 * checkout.session.completed event fires. Activates the community
 * and records the subscription on both the community and proposal.
 */
export const handleCheckoutCompleted = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    communityId: v.string(),
    proposalId: v.string(),
  },
  handler: async (ctx, args) => {
    const communityId = args.communityId as Id<"communities">;
    const proposalId = args.proposalId as Id<"communityProposals">;

    // Get the proposal to read the proposed monthly price
    const proposal = await ctx.db.get(proposalId);
    if (!proposal) {
      throw new Error(
        `Proposal not found: ${args.proposalId}. Cannot complete checkout.`
      );
    }

    // Activate the community with billing fields
    await ctx.db.patch(communityId, {
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      subscriptionStatus: "active",
      subscriptionPriceMonthly: proposal.proposedMonthlyPrice,
      isPublic: true,
      updatedAt: Date.now(),
    });

    // Record the subscription ID on the proposal
    await ctx.db.patch(proposalId, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Handle a Stripe subscription status update.
 *
 * Called from the Stripe webhook handler when customer.subscription.updated fires.
 * Updates the community's subscriptionStatus to reflect the current Stripe state
 * (e.g., "active", "past_due", "canceled", "unpaid").
 */
export const handleSubscriptionUpdated = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the community with this subscription ID
    // No dedicated index exists, so we look up via the stripeCustomerId index
    // or scan communities. Since subscriptions are rare, a filtered query is acceptable.
    const communities = await ctx.db.query("communities").collect();
    const community = communities.find(
      (c) => c.stripeSubscriptionId === args.stripeSubscriptionId
    );

    if (!community) {
      // Log but don't throw — the webhook may fire for subscriptions we don't track
      console.warn(
        `[billing] No community found for subscription: ${args.stripeSubscriptionId}`
      );
      return;
    }

    await ctx.db.patch(community._id, {
      subscriptionStatus: args.status,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Handle a failed Stripe payment.
 *
 * Called from the Stripe webhook handler when invoice.payment_failed fires.
 * Marks the community's subscription as "past_due" so the app can show
 * a billing warning to community admins.
 */
export const handlePaymentFailed = internalMutation({
  args: {
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    // Use the by_stripeCustomerId index for efficient lookup
    const community = await ctx.db
      .query("communities")
      .withIndex("by_stripeCustomerId", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId)
      )
      .first();

    if (!community) {
      console.warn(
        `[billing] No community found for Stripe customer: ${args.stripeCustomerId}`
      );
      return;
    }

    await ctx.db.patch(community._id, {
      subscriptionStatus: "past_due",
      updatedAt: Date.now(),
    });
  },
});

// ============================================================================
// Queries
// ============================================================================

/**
 * Get the subscription status and billing info for a community.
 *
 * Used by the frontend to display billing status, subscription price,
 * and determine whether to show billing warnings (e.g., past_due).
 */
export const getSubscriptionStatus = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Only community PRIMARY_ADMINs can view billing details
    await requirePrimaryAdmin(ctx, args.communityId, userId);

    const community = await ctx.db.get(args.communityId);
    if (!community) {
      throw new Error("Community not found");
    }

    return {
      subscriptionStatus: community.subscriptionStatus ?? null,
      subscriptionPriceMonthly: community.subscriptionPriceMonthly ?? null,
      stripeCustomerId: community.stripeCustomerId ?? null,
      billingEmail: community.billingEmail ?? null,
    };
  },
});
