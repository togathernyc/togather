/**
 * Stripe Billing Functions (ELv2-licensed)
 *
 * Copyright (c) Togather, Inc. - All Rights Reserved
 * Licensed under the Elastic License 2.0 (ELv2)
 * See /ee/LICENSE for the full license text
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
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireAuth, requireAuthFromTokenAction } from "../../lib/auth";
import { requireCommunityAdmin, PRIMARY_ADMIN_ROLE } from "../../lib/permissions";
import { DOMAIN_CONFIG } from "@togather/shared/config";
import { getNextFirstOfMonth } from "../../lib/utils";
import { addUserToAnnouncementGroup } from "../communities";

import type { Id } from "../../_generated/dataModel";

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
 * Verify that the user identified by a token is a community admin of the given community.
 * Used internally by actions that need community-admin authorization.
 */
export const verifyBillingAccess = internalQuery({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    return { userId: userId as string };
  },
});

/**
 * Get community name for Stripe customer metadata.
 * Used internally by createSubscriptionForCommunity.
 */
export const getCommunityForSubscription = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const community = await ctx.db.get(args.communityId);
    if (!community) {
      return null;
    }
    return {
      _id: community._id,
      name: community.name,
      stripeCustomerId: community.stripeCustomerId,
      stripeSubscriptionId: community.stripeSubscriptionId,
    };
  },
});

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Check whether a community proposal has been fully activated (webhook completed).
 * Used by SuccessScreen to confirm the Stripe webhook has fired and the community
 * is ready. Only exposes a boolean — no sensitive data.
 */
export const getCheckoutStatus = query({
  args: { setupToken: v.string() },
  handler: async (ctx, args) => {
    const proposal = await ctx.db
      .query("communityProposals")
      .withIndex("by_setupToken", (q) => q.eq("setupToken", args.setupToken))
      .first();

    if (!proposal) {
      return { activated: false };
    }

    return {
      activated: !!proposal.stripeSubscriptionId,
    };
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
      internal.functions.ee.billing.getProposalBySetupToken,
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
          "/onboarding/success?token=" +
          args.setupToken,
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
        internal.functions.ee.billing.saveStripeIds,
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
 * Requires authentication. The authenticated user must be a community admin.
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
    // Verify the user is a community admin
    await ctx.runQuery(internal.functions.ee.billing.verifyBillingAccess, {
      token: args.token,
      communityId: args.communityId as Id<"communities">,
    });

    // Look up the community's Stripe customer ID
    const billing = await ctx.runQuery(
      internal.functions.ee.billing.getCommunityBilling,
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

/**
 * Create a Stripe Checkout session for an existing community that doesn't
 * have a subscription yet (e.g., created before the billing system).
 *
 * Requires authentication. The authenticated user must be a community admin.
 *
 * @returns { url: string } - The Stripe Checkout URL to redirect the user to
 */
export const createSubscriptionForCommunity = action({
  args: {
    token: v.string(),
    communityId: v.string(),
    monthlyPrice: v.number(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const communityId = args.communityId as Id<"communities">;

    // Verify the user is a community admin
    await ctx.runQuery(internal.functions.ee.billing.verifyBillingAccess, {
      token: args.token,
      communityId,
    });

    // Get community details
    const community = await ctx.runQuery(
      internal.functions.ee.billing.getCommunityForSubscription,
      { communityId }
    );

    if (!community) {
      throw new Error("Community not found");
    }

    if (community.stripeSubscriptionId) {
      throw new Error("This community already has an active subscription");
    }

    if (args.monthlyPrice <= 0) {
      throw new Error("Monthly price must be greater than zero");
    }

    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: "2026-02-25.clover",
      });

      // Reuse existing Stripe customer or create a new one
      let customerId = community.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: community.name,
          metadata: {
            communityId: args.communityId,
          },
        });
        customerId = customer.id;

        // Save the Stripe customer ID on the community
        await ctx.runMutation(
          internal.functions.ee.billing.saveStripeCustomerOnCommunity,
          {
            communityId,
            stripeCustomerId: customerId,
          }
        );
      }

      // Create a recurring price for this community's subscription
      const productId = await getOrCreateProductId(stripe);
      const price = await stripe.prices.create({
        unit_amount: args.monthlyPrice * 100, // Convert dollars to cents
        currency: "usd",
        recurring: { interval: "month" },
        product: productId,
        metadata: {
          communityId: args.communityId,
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
          "/billing/" +
          args.communityId +
          "?checkout=success",
        cancel_url:
          DOMAIN_CONFIG.landingUrl +
          "/billing/" +
          args.communityId +
          "?checkout=canceled",
        metadata: {
          communityId: args.communityId,
          monthlyPrice: String(args.monthlyPrice),
        },
      });

      if (!session.url) {
        throw new Error(
          "Stripe returned a checkout session without a URL. Please try again."
        );
      }

      return { url: session.url };
    } catch (error) {
      if (error instanceof Error && error.message.includes("subscription")) {
        throw error;
      }
      throw new Error(
        `Failed to create checkout session: ${error instanceof Error ? error.message : "Unknown error"}`
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
 * Save Stripe customer ID on a community (for existing community subscription flow).
 */
export const saveStripeCustomerOnCommunity = internalMutation({
  args: {
    communityId: v.id("communities"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.communityId, {
      stripeCustomerId: args.stripeCustomerId,
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
 *
 * Supports two flows:
 * - Proposal flow (proposalId present): creates userCommunities, announcement group
 * - Existing community flow (no proposalId): just activates billing fields
 */
export const handleCheckoutCompleted = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    communityId: v.string(),
    proposalId: v.optional(v.string()),
    monthlyPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const communityId = args.communityId as Id<"communities">;
    const now = Date.now();

    if (args.proposalId) {
      // Proposal flow — read price from proposal, create membership + announcement group
      const proposalId = args.proposalId as Id<"communityProposals">;
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
        updatedAt: now,
      });

      // Make proposer PRIMARY_ADMIN now that payment is confirmed
      // Guard against duplicate membership on webhook retry (Stripe uses at-least-once delivery)
      const existingMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", proposal.proposerId).eq("communityId", communityId)
        )
        .first();

      if (!existingMembership) {
        await ctx.db.insert("userCommunities", {
          userId: proposal.proposerId,
          communityId,
          roles: PRIMARY_ADMIN_ROLE,
          status: 1,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Create announcement group and add proposer as leader
      await addUserToAnnouncementGroup(
        ctx,
        communityId,
        proposal.proposerId,
        PRIMARY_ADMIN_ROLE,
      );

      // Create a default landing page so /c/[slug] works immediately
      const existingLandingPage = await ctx.db
        .query("communityLandingPages")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first();

      if (!existingLandingPage) {
        await ctx.db.insert("communityLandingPages", {
          communityId,
          isEnabled: true,
          title: `Welcome to ${proposal.communityName}`,
          description: "We'd love to get to know you! Fill out the form below to connect with our community.",
          submitButtonText: "Join",
          successMessage: `Welcome to ${proposal.communityName}!`,
          formFields: [],
          automationRules: [],
          createdAt: now,
          updatedAt: now,
        });
      }

      // Record the subscription ID on the proposal
      await ctx.db.patch(proposalId, {
        stripeSubscriptionId: args.stripeSubscriptionId,
        updatedAt: now,
      });
    } else {
      // Existing community flow — just activate billing fields
      const monthlyPrice = args.monthlyPrice ?? 0;

      await ctx.db.patch(communityId, {
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        subscriptionStatus: "active",
        subscriptionPriceMonthly: monthlyPrice,
        updatedAt: now,
      });
    }
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

    // Any community admin can view billing details
    await requireCommunityAdmin(ctx, args.communityId, userId);

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
