/**
 * Community Proposal functions (ELv2-licensed)
 *
 * Copyright (c) Togather, Inc. - All Rights Reserved
 * Licensed under the Elastic License 2.0 (ELv2)
 * See /ee/LICENSE for the full license text
 *
 * Functions for submitting, reviewing, and managing community proposals.
 * Proposals allow prospective community leaders to request creation of a new
 * community on the platform. Staff/superusers review and accept or reject them.
 */

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireAuth } from "../../lib/auth";

// Reserved slugs/subdomains that cannot be used as community slugs.
// These are used as app routes, infrastructure subdomains, or reserved for future use.
const RESERVED_SLUGS = new Set([
  // Infrastructure subdomains
  "api", "www", "app", "staging", "dev",
  // App routes that could conflict
  "admin", "billing", "onboarding", "help", "support", "blog",
  // Reserved for future use
  "docs", "status", "mail", "auth", "login", "signup",
]);

// ============================================================================
// Submit a Proposal
// ============================================================================

/**
 * Submit a new community proposal.
 *
 * Any authenticated user can submit a proposal. It starts in "pending" status
 * and triggers a notification to super admins for review.
 */
export const submit = mutation({
  args: {
    token: v.string(),
    communityName: v.string(),
    estimatedSize: v.number(),
    needsMigration: v.boolean(),
    proposedMonthlyPrice: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const now = Date.now();

    const proposalId = await ctx.db.insert("communityProposals", {
      proposerId: userId,
      communityName: args.communityName,
      estimatedSize: args.estimatedSize,
      needsMigration: args.needsMigration,
      proposedMonthlyPrice: args.proposedMonthlyPrice,
      notes: args.notes,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // Notify super admins of the new proposal
    await ctx.scheduler.runAfter(
      0,
      internal.functions.ee.notifications.proposalNotifications.notifySuperAdminsOfProposal,
      { proposalId }
    );

    return proposalId;
  },
});

// ============================================================================
// List Proposals (Staff/Superuser Only)
// ============================================================================

/**
 * List community proposals. Optionally filter by status.
 *
 * Only staff or superusers can view proposals. Each proposal is returned
 * with the proposer's name, phone, and email attached.
 */
export const list = query({
  args: {
    token: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify caller is staff or superuser
    const user = await ctx.db.get(userId);
    if (!user?.isStaff && !user?.isSuperuser) {
      throw new Error("Not authorized");
    }

    let proposals;
    if (args.status) {
      proposals = await ctx.db
        .query("communityProposals")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      proposals = await ctx.db
        .query("communityProposals")
        .withIndex("by_createdAt")
        .order("desc")
        .collect();
    }

    // Join proposer info for each proposal
    const results = await Promise.all(
      proposals.map(async (proposal) => {
        const proposer = await ctx.db.get(proposal.proposerId);
        return {
          ...proposal,
          proposerName: proposer
            ? [proposer.firstName, proposer.lastName].filter(Boolean).join(" ")
            : undefined,
          proposerPhone: proposer?.phone,
          proposerEmail: proposer?.email,
        };
      })
    );

    return results;
  },
});

// ============================================================================
// Get Proposal by ID (Staff/Superuser Only)
// ============================================================================

/**
 * Get a single proposal by ID with proposer details.
 *
 * Only staff or superusers can view proposals.
 */
export const getById = query({
  args: {
    token: v.string(),
    proposalId: v.id("communityProposals"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify caller is staff or superuser
    const user = await ctx.db.get(userId);
    if (!user?.isStaff && !user?.isSuperuser) {
      throw new Error("Not authorized");
    }

    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) {
      return null;
    }

    const proposer = await ctx.db.get(proposal.proposerId);
    return {
      ...proposal,
      proposerName: proposer
        ? [proposer.firstName, proposer.lastName].filter(Boolean).join(" ")
        : undefined,
      proposerPhone: proposer?.phone,
      proposerEmail: proposer?.email,
    };
  },
});

// ============================================================================
// Accept a Proposal (Staff/Superuser Only)
// ============================================================================

/**
 * Accept a pending proposal.
 *
 * This creates the community, makes the proposer the primary admin (role 4),
 * generates a setup token for community configuration, and sends an acceptance
 * email to the proposer.
 */
export const accept = mutation({
  args: {
    token: v.string(),
    proposalId: v.id("communityProposals"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify caller is staff or superuser
    const user = await ctx.db.get(userId);
    if (!user?.isStaff && !user?.isSuperuser) {
      throw new Error("Not authorized");
    }

    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) {
      throw new Error("Proposal not found");
    }
    if (proposal.status !== "pending") {
      throw new Error("Proposal is not pending");
    }

    const now = Date.now();
    const setupToken = crypto.randomUUID();

    // Create the community (proposer is NOT added as member yet — that
    // happens in handleCheckoutCompleted after payment is confirmed)
    const communityId = await ctx.db.insert("communities", {
      name: proposal.communityName,
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    });

    // Update the proposal with acceptance details
    await ctx.db.patch(args.proposalId, {
      status: "accepted",
      reviewedById: userId,
      reviewedAt: now,
      communityId,
      setupToken,
      updatedAt: now,
    });

    // Send acceptance email to the proposer
    await ctx.scheduler.runAfter(
      0,
      internal.functions.ee.notifications.proposalNotifications.sendProposalAcceptedEmail,
      { proposalId: args.proposalId }
    );

    return { success: true };
  },
});

// ============================================================================
// Reject a Proposal (Staff/Superuser Only)
// ============================================================================

/**
 * Reject a pending proposal with an optional reason.
 *
 * Sends a rejection email to the proposer.
 */
export const reject = mutation({
  args: {
    token: v.string(),
    proposalId: v.id("communityProposals"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Verify caller is staff or superuser
    const user = await ctx.db.get(userId);
    if (!user?.isStaff && !user?.isSuperuser) {
      throw new Error("Not authorized");
    }

    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) {
      throw new Error("Proposal not found");
    }
    if (proposal.status !== "pending") {
      throw new Error("Proposal is not pending");
    }

    const now = Date.now();

    await ctx.db.patch(args.proposalId, {
      status: "rejected",
      reviewedById: userId,
      reviewedAt: now,
      rejectionReason: args.reason,
      updatedAt: now,
    });

    // Send rejection email to the proposer
    await ctx.scheduler.runAfter(
      0,
      internal.functions.ee.notifications.proposalNotifications.sendProposalRejectedEmail,
      { proposalId: args.proposalId }
    );

    return { success: true };
  },
});

// ============================================================================
// Get Proposal by Setup Token (Public)
// ============================================================================

/**
 * Look up an accepted proposal by its setup token.
 *
 * No auth required -- the setup token itself serves as authorization.
 * Returns the proposal and its associated community, or null if the token
 * is invalid or the proposal is not in "accepted" status.
 */
export const getBySetupToken = query({
  args: {
    setupToken: v.string(),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db
      .query("communityProposals")
      .withIndex("by_setupToken", (q) => q.eq("setupToken", args.setupToken))
      .first();

    if (!proposal || proposal.status !== "accepted") {
      return null;
    }

    const community = proposal.communityId
      ? await ctx.db.get(proposal.communityId)
      : null;

    return { proposal, community };
  },
});

// ============================================================================
// Complete Setup (Public, token-authenticated)
// ============================================================================

/**
 * Complete community setup after a proposal has been accepted.
 *
 * No auth required -- the setup token itself serves as authorization.
 * Validates slug uniqueness, updates the community with branding/config fields,
 * and marks the proposal setup as completed (preventing reuse).
 */
export const completeSetup = mutation({
  args: {
    setupToken: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    logo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db
      .query("communityProposals")
      .withIndex("by_setupToken", (q) => q.eq("setupToken", args.setupToken))
      .first();

    if (!proposal) {
      throw new Error("Invalid setup token");
    }
    if (proposal.status !== "accepted") {
      throw new Error("Proposal is not accepted");
    }
    // Allow re-running setup if checkout hasn't been completed yet.
    // This prevents a dead-end when checkout creation fails after setup.
    if (proposal.setupCompletedAt !== undefined && proposal.stripeSubscriptionId) {
      throw new Error("Setup has already been completed and subscription is active");
    }
    if (!proposal.communityId) {
      throw new Error("Proposal has no associated community");
    }

    // Validate slug format
    const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
    if (args.slug.length < 2 || !slugRegex.test(args.slug)) {
      throw new Error(
        "Slug must be at least 2 characters, lowercase alphanumeric with hyphens, and cannot start or end with a hyphen"
      );
    }

    // Check against reserved slugs/subdomains
    if (RESERVED_SLUGS.has(args.slug)) {
      throw new Error(
        `"${args.slug}" is reserved and cannot be used as a community URL`
      );
    }

    // Validate slug uniqueness (allow the proposal's own community to keep its slug)
    const existingCommunity = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (existingCommunity && existingCommunity._id !== proposal.communityId) {
      throw new Error("Slug is already taken");
    }

    const now = Date.now();

    // Update the community with setup details
    await ctx.db.patch(proposal.communityId, {
      name: args.name,
      slug: args.slug,
      primaryColor: args.primaryColor,
      secondaryColor: args.secondaryColor,
      logo: args.logo,
      updatedAt: now,
    });

    // Mark setup as completed and persist the description on the proposal
    await ctx.db.patch(proposal._id, {
      setupCompletedAt: now,
      setupDescription: args.description,
      updatedAt: now,
    });

    return { success: true, communityId: proposal.communityId };
  },
});
