/**
 * Billing Functions Tests
 *
 * Tests the Convex billing internal queries and mutations using convex-test.
 * Focuses on webhook handlers, billing access verification, and data integrity.
 * Actions (Stripe API calls) are excluded — they require external mocking.
 *
 * Run with: cd apps/convex && pnpm test __tests__/billing.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";

import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Constants
// ============================================================================

const COMMUNITY_ROLES = {
  MEMBER: 1,
  PRIMARY_ADMIN: 4,
} as const;

const MEMBERSHIP_STATUS = {
  ACTIVE: 1,
} as const;

// ============================================================================
// Helpers
// ============================================================================

async function seedCommunityWithAdmin(t: ReturnType<typeof convexTest>) {
  const now = Date.now();

  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Billing Test Community",
      slug: "BILL001",
      createdAt: now,
      updatedAt: now,
    });
  });

  const adminUserId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    });
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("userCommunities", {
      communityId,
      userId: adminUserId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: MEMBERSHIP_STATUS.ACTIVE,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { communityId, adminUserId, now };
}

async function seedProposal(
  t: ReturnType<typeof convexTest>,
  overrides: {
    communityId?: Id<"communities">;
    proposerId?: Id<"users">;
    status?: string;
    setupToken?: string;
    setupCompletedAt?: number;
    proposedMonthlyPrice?: number;
  } = {}
) {
  const now = Date.now();

  // Create a default proposer if none provided
  const proposerId =
    overrides.proposerId ??
    (await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Proposer",
        lastName: "Default",
        phone: "+15555559999",
        phoneVerified: true,
        createdAt: now,
        updatedAt: now,
      });
    }));

  return await t.run(async (ctx) => {
    return await ctx.db.insert("communityProposals", {
      proposerId,
      communityName: "Test Community",
      estimatedSize: 50,
      needsMigration: false,
      proposedMonthlyPrice: overrides.proposedMonthlyPrice ?? 49,
      status: overrides.status ?? "accepted",
      communityId: overrides.communityId,
      setupToken: overrides.setupToken ?? "test-setup-token",
      setupCompletedAt: overrides.setupCompletedAt ?? now,
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ============================================================================
// getProposalBySetupToken Tests
// ============================================================================

describe("getProposalBySetupToken", () => {
  test("returns proposal when setup token matches", async () => {
    const t = convexTest(schema, modules);
    const proposalId = await seedProposal(t, {
      setupToken: "valid-token-123",
    });

    const result = await t.query(
      internal.functions.billing.getProposalBySetupToken,
      { setupToken: "valid-token-123" }
    );

    expect(result).not.toBeNull();
    expect(result?._id).toBe(proposalId);
    expect(result?.communityName).toBe("Test Community");
  });

  test("returns null when setup token not found", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(
      internal.functions.billing.getProposalBySetupToken,
      { setupToken: "nonexistent-token" }
    );

    expect(result).toBeNull();
  });
});

// ============================================================================
// getCommunityBilling Tests
// ============================================================================

describe("getCommunityBilling", () => {
  test("returns billing fields for community with billing data", async () => {
    const t = convexTest(schema, modules);

    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Billed Community",
        slug: "BILLED01",
        stripeCustomerId: "cus_test123",
        stripeSubscriptionId: "sub_test456",
        subscriptionStatus: "active",
        subscriptionPriceMonthly: 49,
        billingEmail: "billing@test.com",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(
      internal.functions.billing.getCommunityBilling,
      { communityId }
    );

    expect(result).not.toBeNull();
    expect(result?.stripeCustomerId).toBe("cus_test123");
    expect(result?.stripeSubscriptionId).toBe("sub_test456");
    expect(result?.subscriptionStatus).toBe("active");
    expect(result?.subscriptionPriceMonthly).toBe(49);
    expect(result?.billingEmail).toBe("billing@test.com");
  });

  test("returns null fields for community without billing data", async () => {
    const t = convexTest(schema, modules);

    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Free Community",
        slug: "FREE01",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(
      internal.functions.billing.getCommunityBilling,
      { communityId }
    );

    expect(result).not.toBeNull();
    expect(result?.stripeCustomerId).toBeUndefined();
    expect(result?.subscriptionStatus).toBeUndefined();
  });

  test("returns null for non-existent community", async () => {
    const t = convexTest(schema, modules);

    // Use a fake community ID that doesn't exist
    const fakeCommunityId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("communities", {
        name: "Temp",
        slug: "TEMP",
      });
      await ctx.db.delete(id);
      return id;
    });

    const result = await t.query(
      internal.functions.billing.getCommunityBilling,
      { communityId: fakeCommunityId }
    );

    expect(result).toBeNull();
  });
});

// ============================================================================
// saveStripeIds Tests
// ============================================================================

describe("saveStripeIds", () => {
  test("saves Stripe customer and price IDs on proposal", async () => {
    const t = convexTest(schema, modules);
    const proposalId = await seedProposal(t);

    await t.mutation(internal.functions.billing.saveStripeIds, {
      proposalId,
      stripeCustomerId: "cus_new123",
      stripePriceId: "price_new456",
    });

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get(proposalId);
    });

    expect(updated?.stripeCustomerId).toBe("cus_new123");
    expect(updated?.stripePriceId).toBe("price_new456");
    expect(updated?.updatedAt).toBeGreaterThan(0);
  });

  test("overwrites existing Stripe IDs on proposal", async () => {
    const t = convexTest(schema, modules);
    const proposalId = await seedProposal(t);

    // First save
    await t.mutation(internal.functions.billing.saveStripeIds, {
      proposalId,
      stripeCustomerId: "cus_old",
      stripePriceId: "price_old",
    });

    // Overwrite
    await t.mutation(internal.functions.billing.saveStripeIds, {
      proposalId,
      stripeCustomerId: "cus_new",
      stripePriceId: "price_new",
    });

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get(proposalId);
    });

    expect(updated?.stripeCustomerId).toBe("cus_new");
    expect(updated?.stripePriceId).toBe("price_new");
  });
});

// ============================================================================
// handleCheckoutCompleted Tests
// ============================================================================

describe("handleCheckoutCompleted", () => {
  test("activates community with billing fields", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminUserId } = await seedCommunityWithAdmin(t);
    const proposalId = await seedProposal(t, {
      communityId,
      proposerId: adminUserId,
      proposedMonthlyPrice: 99,
    });

    await t.mutation(internal.functions.billing.handleCheckoutCompleted, {
      stripeCustomerId: "cus_checkout123",
      stripeSubscriptionId: "sub_checkout456",
      communityId: communityId as string,
      proposalId: proposalId as string,
    });

    const community = await t.run(async (ctx) => {
      return await ctx.db.get(communityId);
    });

    expect(community?.stripeCustomerId).toBe("cus_checkout123");
    expect(community?.stripeSubscriptionId).toBe("sub_checkout456");
    expect(community?.subscriptionStatus).toBe("active");
    expect(community?.subscriptionPriceMonthly).toBe(99);
    expect(community?.isPublic).toBe(true);
    expect(community?.updatedAt).toBeGreaterThan(0);
  });

  test("records subscription ID on proposal", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminUserId } = await seedCommunityWithAdmin(t);
    const proposalId = await seedProposal(t, {
      communityId,
      proposerId: adminUserId,
    });

    await t.mutation(internal.functions.billing.handleCheckoutCompleted, {
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      communityId: communityId as string,
      proposalId: proposalId as string,
    });

    const proposal = await t.run(async (ctx) => {
      return await ctx.db.get(proposalId);
    });

    expect(proposal?.stripeSubscriptionId).toBe("sub_test");
    expect(proposal?.updatedAt).toBeGreaterThan(0);
  });

  test("throws when proposal not found", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunityWithAdmin(t);

    await expect(
      t.mutation(internal.functions.billing.handleCheckoutCompleted, {
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_test",
        communityId: communityId as string,
        proposalId: "invalid_proposal_id",
      })
    ).rejects.toThrow();
  });
});

// ============================================================================
// handleSubscriptionUpdated Tests
// ============================================================================

describe("handleSubscriptionUpdated", () => {
  test("updates community subscription status", async () => {
    const t = convexTest(schema, modules);

    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Active Community",
        slug: "ACTIVE01",
        stripeSubscriptionId: "sub_update123",
        subscriptionStatus: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.billing.handleSubscriptionUpdated, {
      stripeSubscriptionId: "sub_update123",
      status: "past_due",
    });

    const community = await t.run(async (ctx) => {
      return await ctx.db.get(communityId);
    });

    expect(community?.subscriptionStatus).toBe("past_due");
  });

  test("handles unknown subscription gracefully (no throw)", async () => {
    const t = convexTest(schema, modules);

    // Should not throw — just logs and returns
    await t.mutation(internal.functions.billing.handleSubscriptionUpdated, {
      stripeSubscriptionId: "sub_nonexistent",
      status: "canceled",
    });
    // If we get here, the mutation didn't throw — that's the correct behavior
  });

  test("updates to canceled status", async () => {
    const t = convexTest(schema, modules);

    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Canceling Community",
        slug: "CANCEL01",
        stripeSubscriptionId: "sub_cancel123",
        subscriptionStatus: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.billing.handleSubscriptionUpdated, {
      stripeSubscriptionId: "sub_cancel123",
      status: "canceled",
    });

    const community = await t.run(async (ctx) => {
      return await ctx.db.get(communityId);
    });

    expect(community?.subscriptionStatus).toBe("canceled");
  });
});

// ============================================================================
// handlePaymentFailed Tests
// ============================================================================

describe("handlePaymentFailed", () => {
  test("marks community as past_due", async () => {
    const t = convexTest(schema, modules);

    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Payment Fail Community",
        slug: "PAYFAIL01",
        stripeCustomerId: "cus_fail123",
        subscriptionStatus: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.billing.handlePaymentFailed, {
      stripeCustomerId: "cus_fail123",
    });

    const community = await t.run(async (ctx) => {
      return await ctx.db.get(communityId);
    });

    expect(community?.subscriptionStatus).toBe("past_due");
    expect(community?.updatedAt).toBeGreaterThan(0);
  });

  test("handles unknown customer gracefully (no throw)", async () => {
    const t = convexTest(schema, modules);

    // Should not throw — just logs and returns
    await t.mutation(internal.functions.billing.handlePaymentFailed, {
      stripeCustomerId: "cus_nonexistent",
    });
    // If we get here, the mutation didn't throw — correct
  });
});

// ============================================================================
// getSubscriptionStatus Tests (requires auth)
// ============================================================================

describe("getSubscriptionStatus", () => {
  test("returns billing info for primary admin", async () => {
    const t = convexTest(schema, modules);

    // Create community with billing data
    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Billed Community",
        slug: "BILLED02",
        stripeCustomerId: "cus_status123",
        subscriptionStatus: "active",
        subscriptionPriceMonthly: 79,
        billingEmail: "admin@test.com",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const adminUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Admin",
        lastName: "Test",
        phone: "+15555550010",
        phoneVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId: adminUserId,
        roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
        status: MEMBERSHIP_STATUS.ACTIVE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken } = await generateTokens(adminUserId);

    const result = await t.query(api.functions.billing.getSubscriptionStatus, {
      token: accessToken,
      communityId,
    });

    expect(result.subscriptionStatus).toBe("active");
    expect(result.subscriptionPriceMonthly).toBe(79);
    expect(result.stripeCustomerId).toBe("cus_status123");
    expect(result.billingEmail).toBe("admin@test.com");
  });

  test("rejects non-admin user", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunityWithAdmin(t);

    // Create a regular member
    const memberId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Member",
        lastName: "Test",
        phone: "+15555550020",
        phoneVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId: memberId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: MEMBERSHIP_STATUS.ACTIVE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken } = await generateTokens(memberId);

    await expect(
      t.query(api.functions.billing.getSubscriptionStatus, {
        token: accessToken,
        communityId,
      })
    ).rejects.toThrow("Primary Admin role required");
  });

  test("returns null fields for community without billing", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminUserId } = await seedCommunityWithAdmin(t);
    const { accessToken } = await generateTokens(adminUserId);

    const result = await t.query(api.functions.billing.getSubscriptionStatus, {
      token: accessToken,
      communityId,
    });

    expect(result.subscriptionStatus).toBeNull();
    expect(result.subscriptionPriceMonthly).toBeNull();
    expect(result.stripeCustomerId).toBeNull();
    expect(result.billingEmail).toBeNull();
  });
});

// ============================================================================
// verifyBillingAccess Tests
// ============================================================================

describe("verifyBillingAccess", () => {
  test("returns userId for primary admin", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminUserId } = await seedCommunityWithAdmin(t);
    const { accessToken } = await generateTokens(adminUserId);

    const result = await t.query(
      internal.functions.billing.verifyBillingAccess,
      { token: accessToken, communityId }
    );

    expect(result.userId).toBe(adminUserId);
  });

  test("rejects regular member", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunityWithAdmin(t);

    const memberId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Member",
        lastName: "Only",
        phone: "+15555550030",
        phoneVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId: memberId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: MEMBERSHIP_STATUS.ACTIVE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken } = await generateTokens(memberId);

    await expect(
      t.query(internal.functions.billing.verifyBillingAccess, {
        token: accessToken,
        communityId,
      })
    ).rejects.toThrow("Primary Admin role required");
  });
});
