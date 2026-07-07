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
  internalAction,
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
import { countBillableActiveUsers } from "../memberActivity";
import { notifyCommunityAdmins } from "../../lib/notifications/send";

/** Per-active-user pricing: $1/month per billable active member. */
const PER_ACTIVE_USER_CENTS = 100;

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

/**
 * State needed to start a demo-conversion checkout: verifies the caller is a
 * community admin, that the community is still a demo, and computes the
 * per-active-user quantity.
 */
export const getDemoConversionInfo = internalQuery({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const community = await ctx.db.get(args.communityId);
    if (!community) throw new Error("Community not found");
    if (!community.isDemo) {
      throw new Error("This community is already live");
    }
    if (community.stripeSubscriptionId) {
      throw new Error("This community already has an active subscription");
    }

    return {
      name: community.name ?? "Togather Community",
      stripeCustomerId: community.stripeCustomerId,
      // Bill for the real staff already in the demo; never less than 1 seat.
      billableActiveUsers: Math.max(
        1,
        await countBillableActiveUsers(ctx, args.communityId),
      ),
    };
  },
});

/**
 * Start the "go live" checkout for a demo community.
 *
 * Pricing is $1/month per billable active member (see
 * functions/memberActivity.ts). The checkout starts with the current count as
 * the subscription quantity; the monthly sync cron keeps it in step with real
 * activity afterwards. When the webhook confirms payment, the community
 * leaves demo mode and its seeded placeholder members are purged.
 */
export const convertDemoToLive = action({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const info = await ctx.runQuery(
      internal.functions.ee.billing.getDemoConversionInfo,
      { token: args.token, communityId: args.communityId },
    );

    try {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: "2026-02-25.clover",
      });

      let customerId = info.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: info.name,
          metadata: { communityId: args.communityId },
        });
        customerId = customer.id;
        await ctx.runMutation(
          internal.functions.ee.billing.saveStripeCustomerOnCommunity,
          { communityId: args.communityId, stripeCustomerId: customerId },
        );
      }

      const productId = await getOrCreateProductId(stripe);
      const price = await stripe.prices.create({
        unit_amount: PER_ACTIVE_USER_CENTS,
        currency: "usd",
        recurring: { interval: "month" },
        product: productId,
        metadata: { communityId: args.communityId, billingModel: "per_active_user" },
      });

      // Anchor billing to the 1st of next month — Stripe prorates the first partial period
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: price.id, quantity: info.billableActiveUsers }],
        subscription_data: {
          billing_cycle_anchor: getNextFirstOfMonth(),
        },
        success_url:
          DOMAIN_CONFIG.landingUrl + "/onboarding/go-live?checkout=success",
        cancel_url:
          DOMAIN_CONFIG.landingUrl + "/onboarding/go-live?checkout=canceled",
        metadata: {
          communityId: args.communityId,
          demoConversion: "true",
        },
      });

      if (!session.url) {
        throw new Error(
          "Stripe returned a checkout session without a URL. Please try again.",
        );
      }
      return { url: session.url };
    } catch (error) {
      if (error instanceof Error && error.message.includes("subscription")) {
        throw error;
      }
      throw new Error(
        `Failed to create checkout session: ${error instanceof Error ? error.message : "Unknown error"}`,
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
    demoConversion: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const communityId = args.communityId as Id<"communities">;
    const now = Date.now();

    if (args.demoConversion) {
      // Demo-conversion flow — the community and its admins already exist;
      // leave demo mode, switch to per-active-user billing, and purge the
      // seeded placeholder members (scheduled so a large purge can't fail the
      // webhook transaction).
      const billableActiveUsers = Math.max(
        1,
        await countBillableActiveUsers(ctx, communityId),
      );

      await ctx.db.patch(communityId, {
        isDemo: false,
        demoCreatedById: undefined,
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        subscriptionStatus: "active",
        billingModel: "per_active_user",
        subscriptionPriceMonthly: billableActiveUsers, // $1 × active members
        isPublic: true,
        updatedAt: now,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.functions.demo.purgeDemoSeedUsers,
        { communityId },
      );
      return;
    }

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
    const community = await ctx.db
      .query("communities")
      .withIndex("by_stripeSubscriptionId", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .first();

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
// Per-active-user quantity sync (monthly cron)
// ============================================================================

/**
 * Guard against a billing count that moved implausibly month-over-month —
 * the signature of a broken activity pipeline (e.g. recordActivity regression)
 * rather than real congregation change. Small baselines are exempt: tiny
 * communities legitimately double or halve.
 */
export function isAnomalousCountChange(
  previousCount: number,
  nextCount: number,
): boolean {
  if (previousCount < 10) return false;
  return Math.abs(nextCount - previousCount) / previousCount > 0.3;
}

/**
 * List per-active-user communities with their current billable counts.
 * Used by the monthly sync cron.
 */
export const listPerUserBillingCommunities = internalQuery({
  args: {},
  handler: async (ctx) => {
    const communities = await ctx.db.query("communities").collect();
    const results: Array<{
      communityId: Id<"communities">;
      name: string;
      stripeSubscriptionId: string;
      billableActiveUsers: number;
      // Last synced count (we store it as the monthly price, $1 per member).
      previousBillableUsers: number | null;
    }> = [];

    for (const community of communities) {
      if (community.billingModel !== "per_active_user") continue;
      if (!community.stripeSubscriptionId) continue;
      if (community.subscriptionStatus === "canceled") continue;

      results.push({
        communityId: community._id,
        name: community.name ?? "Unnamed community",
        stripeSubscriptionId: community.stripeSubscriptionId,
        billableActiveUsers: Math.max(
          1,
          await countBillableActiveUsers(ctx, community._id),
        ),
        previousBillableUsers: community.subscriptionPriceMonthly ?? null,
      });
    }
    return results;
  },
});

/** Record the synced monthly price on the community (for admin display). */
export const savePerUserBillingCount = internalMutation({
  args: {
    communityId: v.id("communities"),
    billableActiveUsers: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.communityId, {
      subscriptionPriceMonthly: args.billableActiveUsers, // $1 × active members
      updatedAt: Date.now(),
    });
  },
});

/**
 * Monthly cron (see crons.ts): re-count each per-active-user community's
 * billable members — opened the app in that community within the past month,
 * not manually marked inactive, real accounts only — and update the Stripe
 * subscription quantity so the next invoice bills $1 per active member.
 */
export const syncPerUserSubscriptionQuantities = internalAction({
  args: {},
  handler: async (ctx) => {
    const communities = await ctx.runQuery(
      internal.functions.ee.billing.listPerUserBillingCommunities,
      {},
    );
    if (communities.length === 0) return { synced: 0 };

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
    });

    let synced = 0;
    const failures: string[] = [];
    const anomalies: string[] = [];

    for (const community of communities) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          community.stripeSubscriptionId,
        );
        const item = subscription.items.data[0];
        if (!item) {
          failures.push(
            `${community.name} (${community.communityId}): subscription ${community.stripeSubscriptionId} has no items`,
          );
          continue;
        }

        if (item.quantity !== community.billableActiveUsers) {
          await stripe.subscriptionItems.update(item.id, {
            quantity: community.billableActiveUsers,
            // Quantity reflects the coming month's roster; don't back-bill
            // the current period.
            proration_behavior: "none",
          });
        }

        await ctx.runMutation(
          internal.functions.ee.billing.savePerUserBillingCount,
          {
            communityId: community.communityId,
            billableActiveUsers: community.billableActiveUsers,
          },
        );
        synced++;

        // Flag implausible month-over-month swings for a human to eyeball —
        // the count still syncs (real seasonal swings are legitimate), but
        // ops gets told (a broken activity pipeline shows up here first).
        if (
          community.previousBillableUsers !== null &&
          isAnomalousCountChange(
            community.previousBillableUsers,
            community.billableActiveUsers,
          )
        ) {
          anomalies.push(
            `${community.name} (${community.communityId}): ${community.previousBillableUsers} -> ${community.billableActiveUsers} active members`,
          );
        }

        // Pre-period disclosure: tell the community's admins what the 1st
        // will bill, while there's still time to mark members inactive.
        await notifyCommunityAdmins(ctx, {
          type: "billing.monthly_preview",
          communityId: community.communityId,
          channels: ["email"],
          data: {
            communityId: String(community.communityId),
            communityName: community.name,
            billableActiveUsers: community.billableActiveUsers,
            monthlyPriceUsd: community.billableActiveUsers,
          },
        });
      } catch (error) {
        // One community's Stripe failure must not block the rest.
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[billing] Failed to sync quantity for community ${community.communityId}:`,
          message,
        );
        failures.push(
          `${community.name} (${community.communityId}): ${message}`,
        );
      }
    }

    // Ops alert: silent billing drift is the #1 operational risk of the
    // pre-renewal sync pattern, so failures and anomalies go to a human.
    if (failures.length > 0 || anomalies.length > 0) {
      await sendBillingOpsAlert(ctx, { failures, anomalies, synced });
    }

    return { synced, failures: failures.length, anomalies: anomalies.length };
  },
});

/**
 * Email the ops address (BILLING_ALERT_EMAIL) when the monthly billing sync
 * hits failures or implausible count swings. Falls back to console.error if
 * the env var isn't configured — never throws, so alerting can't break the
 * sync itself.
 */
async function sendBillingOpsAlert(
  ctx: { runAction: (ref: any, args: any) => Promise<any> },
  report: { failures: string[]; anomalies: string[]; synced: number },
): Promise<void> {
  const summary = [
    `Billing sync completed: ${report.synced} synced, ${report.failures.length} failures, ${report.anomalies.length} anomalies.`,
    ...(report.failures.length > 0
      ? ["", "FAILURES (Stripe quantity NOT updated — will bill stale counts):", ...report.failures]
      : []),
    ...(report.anomalies.length > 0
      ? ["", "ANOMALIES (>30% month-over-month swing — synced, verify activity pipeline):", ...report.anomalies]
      : []),
  ].join("\n");

  console.error(`[billing] Ops alert:\n${summary}`);

  const alertEmail = process.env.BILLING_ALERT_EMAIL;
  if (!alertEmail) {
    console.warn(
      "[billing] BILLING_ALERT_EMAIL not configured — ops alert only logged",
    );
    return;
  }

  try {
    await ctx.runAction(
      internal.functions.notifications.internal.sendEmailNotification,
      {
        to: alertEmail,
        subject: `[Togather billing] sync: ${report.failures.length} failures, ${report.anomalies.length} anomalies`,
        htmlBody: `<pre>${summary.replace(/</g, "&lt;")}</pre>`,
        notificationType: "billing.ops_alert",
      },
    );
  } catch (error) {
    console.error(
      "[billing] Failed to send ops alert email:",
      error instanceof Error ? error.message : error,
    );
  }
}

// ============================================================================
// Legacy-plan migration to per-active-user billing
// ============================================================================

/**
 * Communities still on a legacy fixed-price subscription (no billingModel),
 * with what they pay today and what per-active-user billing would charge.
 */
export const listLegacyBillingCommunities = internalQuery({
  args: {},
  handler: async (ctx) => {
    const communities = await ctx.db.query("communities").collect();
    const results: Array<{
      communityId: Id<"communities">;
      name: string;
      stripeSubscriptionId: string;
      currentMonthlyPriceUsd: number | null;
      billableActiveUsers: number;
    }> = [];

    for (const community of communities) {
      if (community.billingModel) continue; // already migrated
      if (!community.stripeSubscriptionId) continue;
      if (community.isDemo) continue;
      if (community.subscriptionStatus === "canceled") continue;

      results.push({
        communityId: community._id,
        name: community.name ?? "Unnamed community",
        stripeSubscriptionId: community.stripeSubscriptionId,
        currentMonthlyPriceUsd: community.subscriptionPriceMonthly ?? null,
        billableActiveUsers: Math.max(
          1,
          await countBillableActiveUsers(ctx, community._id),
        ),
      });
    }
    return results;
  },
});

/** Record a completed migration on the community row. */
export const markCommunityPerUserBilling = internalMutation({
  args: {
    communityId: v.id("communities"),
    billableActiveUsers: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.communityId, {
      billingModel: "per_active_user",
      subscriptionPriceMonthly: args.billableActiveUsers, // $1 × active members
      updatedAt: Date.now(),
    });
  },
});

/**
 * Migrate existing fixed-price clients to $1/month per active member.
 *
 * Staff-run, dry-run by default:
 *   npx convex run functions/ee/billing:migrateToPerUserBilling '{}'
 *     -> report only: each legacy community's current price vs what
 *        per-active-user billing would charge. Nothing changes.
 *   npx convex run functions/ee/billing:migrateToPerUserBilling '{"dryRun": false}'
 *     -> swaps each subscription's item to a $1/member price with
 *        quantity = current billable count, proration_behavior "none" so the
 *        change lands on the next renewal invoice (legacy subscriptions are
 *        anchored to the 1st, same as new ones), and stamps
 *        billingModel = "per_active_user" so the monthly sync cron and the
 *        admin preview email pick the community up from then on.
 *   Pass "communityId" to migrate a single community.
 *
 * Review the dry-run before running live — for some churches the new model
 * is a price increase and deserves a heads-up email first.
 */
export const migrateToPerUserBilling = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;

    let candidates = await ctx.runQuery(
      internal.functions.ee.billing.listLegacyBillingCommunities,
      {},
    );
    if (args.communityId) {
      candidates = candidates.filter(
        (c: { communityId: string }) => c.communityId === args.communityId,
      );
    }

    const report: Array<{
      communityId: string;
      name: string;
      currentMonthlyPriceUsd: number | null;
      newMonthlyPriceUsd: number;
      migrated: boolean;
      error?: string;
    }> = [];

    if (candidates.length === 0) {
      return { dryRun, migrated: 0, report };
    }

    const Stripe = (await import("stripe")).default;
    const stripe = dryRun
      ? null
      : new Stripe(process.env.STRIPE_SECRET_KEY!, {
          apiVersion: "2026-02-25.clover",
        });

    let migrated = 0;
    for (const community of candidates) {
      const entry = {
        communityId: String(community.communityId),
        name: community.name,
        currentMonthlyPriceUsd: community.currentMonthlyPriceUsd,
        newMonthlyPriceUsd: community.billableActiveUsers,
        migrated: false,
      };

      if (dryRun) {
        report.push(entry);
        continue;
      }

      try {
        const subscription = await stripe!.subscriptions.retrieve(
          community.stripeSubscriptionId,
        );
        const item = subscription.items.data[0];
        if (!item) {
          report.push({
            ...entry,
            error: `subscription ${community.stripeSubscriptionId} has no items`,
          });
          continue;
        }

        const productId = await getOrCreateProductId(stripe!);
        const price = await stripe!.prices.create({
          unit_amount: PER_ACTIVE_USER_CENTS,
          currency: "usd",
          recurring: { interval: "month" },
          product: productId,
          metadata: {
            communityId: String(community.communityId),
            billingModel: "per_active_user",
          },
        });

        // Swap the item to the per-member price at the current billable
        // count. proration_behavior "none" defers the change to the next
        // renewal invoice — no mid-cycle charge or credit.
        await stripe!.subscriptions.update(community.stripeSubscriptionId, {
          items: [
            {
              id: item.id,
              price: price.id,
              quantity: community.billableActiveUsers,
            },
          ],
          proration_behavior: "none",
        });

        await ctx.runMutation(
          internal.functions.ee.billing.markCommunityPerUserBilling,
          {
            communityId: community.communityId,
            billableActiveUsers: community.billableActiveUsers,
          },
        );

        migrated++;
        report.push({ ...entry, migrated: true });
      } catch (error) {
        report.push({
          ...entry,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { dryRun, migrated, report };
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
