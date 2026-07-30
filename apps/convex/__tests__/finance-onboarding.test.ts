/**
 * Group giving onboarding + provider + webhook layer tests (ADR-032 §2/§6).
 *
 * Covers functions/finance/onboarding.ts (startOnboarding, recordProvisioned,
 * enableGroupGiving, applyStripeAccountStatus), functions/finance/webhooks.ts's
 * applyIncreaseEntityStatus, and lib/finance/increase.ts's
 * verifyIncreaseWebhookSignature.
 *
 * Scheduled actions (provisionProviders, provisionGroupFundAccount) are
 * queued by convex-test but never auto-execute unless
 * `t.finishInProgressScheduledFunctions()` is called — which none of these
 * tests do — so no real Stripe/Increase network call ever happens here.
 * `handleIncreaseWebhookRequest` / `handleFinanceStripeEvent` (the httpAction
 * entry points) aren't exercised directly for the same reason http.ts's own
 * Stripe webhook route isn't unit-tested: they're thin glue over the
 * independently-tested pieces below (signature verification, the internal
 * mutations) — the live paths are exercised manually against test keys, same
 * convention as billing-per-user.test.ts.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-onboarding.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import { isValidEin } from "../functions/finance/onboarding";
import { verifyIncreaseWebhookSignature } from "../lib/finance/increase";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// startOnboarding/enableGroupGiving schedule provisionProviders/
// provisionGroupFundAccount via ctx.scheduler.runAfter(0, ...) — convex-test
// runs scheduled functions on a REAL setTimeout, so without fake timers they
// would actually fire in the background (mirrors billing-per-user.test.ts's
// use of vi.useFakeTimers() for the same class of hazard). Freezing timers
// means those scheduled actions simply never run in this suite, so they can
// never reach a real Stripe/Increase fetch call.
vi.useFakeTimers();

const ADDRESS = {
  addressLine1: "1 Main St",
  city: "Austin",
  state: "TX",
  zipCode: "78701",
};

// ============================================================================
// Seeding
// ============================================================================

interface OnboardingFixture {
  communityId: Id<"communities">;
  otherCommunityId: Id<"communities">;
  groupId: Id<"groups">;
  otherCommunityGroupId: Id<"groups">;
  adminUserId: Id<"users">;
  adminToken: string;
  memberUserId: Id<"users">;
  memberToken: string;
  leaderUserId: Id<"users">;
  leaderTwoUserId: Id<"users">;
}

async function seedOnboardingFixture(
  t: ReturnType<typeof convexTest>,
): Promise<OnboardingFixture> {
  const ids = await t.run(async (ctx) => {
    // Group giving is behind the app-wide "group-giving" feature flag
    // (default OFF) — enable it for these tests; flag-off behavior has its
    // own dedicated cases.
    await ctx.db.insert("featureFlags", {
      key: "group-giving",
      enabled: true,
      updatedAt: Date.now(),
    });
    const timestamp = Date.now();
    const suffix = Math.floor(Math.random() * 1_000_000);

    const communityId = await ctx.db.insert("communities", {
      name: "Test Church",
      slug: `test-church-${suffix}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const otherCommunityId = await ctx.db.insert("communities", {
      name: "Other Church",
      slug: `other-church-${suffix}`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Young Adults",
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const otherGroupTypeId = await ctx.db.insert("groupTypes", {
      communityId: otherCommunityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });
    const otherCommunityGroupId = await ctx.db.insert("groups", {
      communityId: otherCommunityId,
      groupTypeId: otherGroupTypeId,
      name: "Other Group",
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const mkUser = async (name: string) =>
      ctx.db.insert("users", {
        firstName: name,
        lastName: "User",
        phone: `+1555${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const adminUserId = await mkUser("Admin");
    const memberUserId = await mkUser("Member");
    const leaderUserId = await mkUser("Leader");
    const leaderTwoUserId = await mkUser("LeaderTwo");

    await ctx.db.insert("userCommunities", {
      userId: adminUserId,
      communityId,
      roles: 3, // COMMUNITY_ROLES.ADMIN
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.insert("userCommunities", {
      userId: memberUserId,
      communityId,
      roles: 1, // COMMUNITY_ROLES.MEMBER
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderUserId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderTwoUserId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberUserId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    return {
      communityId,
      otherCommunityId,
      groupId,
      otherCommunityGroupId,
      adminUserId,
      memberUserId,
      leaderUserId,
      leaderTwoUserId,
    };
  });

  const { accessToken: adminToken } = await generateTokens(ids.adminUserId);
  const { accessToken: memberToken } = await generateTokens(ids.memberUserId);

  return { ...ids, adminToken, memberToken };
}

/** Insert a communityFinance row directly (bypassing startOnboarding) for tests that need one pre-seeded at a specific status. */
async function insertCommunityFinance(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  overrides: Partial<{
    onboardingStatus: "collecting" | "verifying" | "live" | "stripe_blocked" | "increase_blocked";
    stripeConnectedAccountId: string;
    increaseEntityId: string;
    increaseReceivingAccountId: string;
  }> = {},
) {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    return await ctx.db.insert("communityFinance", {
      communityId,
      legalName: "Test Church Inc",
      ein: "12-3456789",
      address: ADDRESS,
      onboardingStatus: overrides.onboardingStatus ?? "collecting",
      stripeConnectedAccountId: overrides.stripeConnectedAccountId,
      increaseEntityId: overrides.increaseEntityId,
      increaseReceivingAccountId: overrides.increaseReceivingAccountId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
}

// ============================================================================
// isValidEin
// ============================================================================

describe("isValidEin", () => {
  test("accepts NN-NNNNNNN", () => {
    expect(isValidEin("12-3456789")).toBe(true);
  });

  test("rejects missing dash, wrong digit counts, and non-digits", () => {
    expect(isValidEin("123456789")).toBe(false);
    expect(isValidEin("1-23456789")).toBe(false);
    expect(isValidEin("12-345678")).toBe(false);
    expect(isValidEin("ab-cdefghi")).toBe(false);
    expect(isValidEin("")).toBe(false);
  });
});

// ============================================================================
// startOnboarding
// ============================================================================

describe("startOnboarding", () => {
  test("community admin stores the form, sets status collecting, and audit-logs it", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedOnboardingFixture(t);

    const result = await t.mutation(api.functions.finance.onboarding.startOnboarding, {
      token: adminToken,
      communityId,
      legalName: "Test Church Inc",
      ein: "12-3456789",
      website: "https://example.com",
      address: ADDRESS,
    });
    expect(result.onboardingStatus).toBe("collecting");

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.legalName).toBe("Test Church Inc");
    expect(finance?.ein).toBe("12-3456789");
    expect(finance?.onboardingStatus).toBe("collecting");

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].action).toBe("onboarding.status_changed");
  });

  test("rejects a non-admin caller", async () => {
    const t = convexTest(schema, modules);
    const { communityId, memberToken } = await seedOnboardingFixture(t);

    await expect(
      t.mutation(api.functions.finance.onboarding.startOnboarding, {
        token: memberToken,
        communityId,
        legalName: "Test Church Inc",
        ein: "12-3456789",
        address: ADDRESS,
      }),
    ).rejects.toThrow();
  });

  test("rejects a malformed EIN", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedOnboardingFixture(t);

    await expect(
      t.mutation(api.functions.finance.onboarding.startOnboarding, {
        token: adminToken,
        communityId,
        legalName: "Test Church Inc",
        ein: "123456789",
        address: ADDRESS,
      }),
    ).rejects.toThrow(/EIN/);
  });

  test("resubmission clears a previously recorded provisioningError", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, { onboardingStatus: "collecting" });
    await t.mutation(internal.functions.finance.onboarding.recordProvisioningFailure, {
      communityId,
      provider: "stripe",
      message: "Stripe declined the connected account application",
    });

    let finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.provisioningError).toBeDefined();

    await t.mutation(api.functions.finance.onboarding.startOnboarding, {
      token: adminToken,
      communityId,
      legalName: "Test Church Inc",
      ein: "12-3456789",
      address: ADDRESS,
    });

    finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("collecting");
    expect(finance?.provisioningError).toBeUndefined();
  });
});

// ============================================================================
// recordProvisioned
// ============================================================================

describe("recordProvisioned", () => {
  test("advances to verifying and creates the General fund exactly once, idempotently", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, { onboardingStatus: "collecting" });

    const provisionArgs = {
      communityId,
      stripeConnectedAccountId: "acct_test123",
      increaseEntityId: "entity_test123",
      increaseReceivingAccountId: "account_test123",
    };

    await t.mutation(internal.functions.finance.onboarding.recordProvisioned, provisionArgs);
    // Retry — must not duplicate the General fund or re-emit the status-change audit row.
    await t.mutation(internal.functions.finance.onboarding.recordProvisioned, provisionArgs);

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("verifying");
    expect(finance?.stripeConnectedAccountId).toBe("acct_test123");
    expect(finance?.increaseEntityId).toBe("entity_test123");

    const generalFunds = await t.run((ctx) =>
      ctx.db
        .query("funds")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .filter((q) => q.eq(q.field("type"), "general"))
        .collect(),
    );
    expect(generalFunds).toHaveLength(1);
    expect(generalFunds[0].balanceCents).toBe(0);
    expect(generalFunds[0].status).toBe("active");

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    // One "onboarding.status_changed" (collecting -> verifying) + one "fund.created" — the retry added nothing.
    expect(auditEvents.filter((e) => e.action === "onboarding.status_changed")).toHaveLength(1);
    expect(auditEvents.filter((e) => e.action === "fund.created")).toHaveLength(1);
  });

  test("never regresses an already-live community", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "live",
      stripeConnectedAccountId: "acct_live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_live",
    });

    await t.mutation(internal.functions.finance.onboarding.recordProvisioned, {
      communityId,
      stripeConnectedAccountId: "acct_live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_live",
    });

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("live");
  });
});

// ============================================================================
// recordProvisioningFailure + retryProvisioning
// ============================================================================

describe("provisioning failure + retry", () => {
  test("recordProvisioningFailure(stripe) sets stripe_blocked + provisioningError, reflected in getOnboardingStatus", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, { onboardingStatus: "collecting" });

    await t.mutation(internal.functions.finance.onboarding.recordProvisioningFailure, {
      communityId,
      provider: "stripe",
      message: "Stripe declined the connected account application",
    });

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("stripe_blocked");
    expect(finance?.provisioningError).toBe(
      "Stripe declined the connected account application",
    );

    const status = await t.query(api.functions.finance.onboarding.getOnboardingStatus, {
      token: adminToken,
      communityId,
    });
    expect(status.providersReady).toBe(false);
    expect(status.blockedReason).toBe("stripe_blocked");
    expect(status.provisioningError).toBe(
      "Stripe declined the connected account application",
    );

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    expect(
      auditEvents.filter((e) => e.action === "onboarding.provisioning_failed"),
    ).toHaveLength(1);
  });

  test("recordProvisioningFailure(increase) sets increase_blocked", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "collecting",
      stripeConnectedAccountId: "acct_ok",
    });

    await t.mutation(internal.functions.finance.onboarding.recordProvisioningFailure, {
      communityId,
      provider: "increase",
      message: "Increase entity creation failed",
    });

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("increase_blocked");
    expect(finance?.provisioningError).toBe("Increase entity creation failed");
  });

  test("never regresses an already-live community, and leaves provisioningError unset", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "live",
      stripeConnectedAccountId: "acct_live",
      increaseEntityId: "entity_live",
      increaseReceivingAccountId: "account_live",
    });

    await t.mutation(internal.functions.finance.onboarding.recordProvisioningFailure, {
      communityId,
      provider: "stripe",
      message: "stray retry failure",
    });

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("live");
    expect(finance?.provisioningError).toBeUndefined();

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    expect(auditEvents).toHaveLength(0);
  });

  test("retryProvisioning resets a blocked community to collecting, clears provisioningError, and audit-logs the retry", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, { onboardingStatus: "collecting" });
    await t.mutation(internal.functions.finance.onboarding.recordProvisioningFailure, {
      communityId,
      provider: "stripe",
      message: "Stripe declined the connected account application",
    });

    const result = await t.mutation(api.functions.finance.onboarding.retryProvisioning, {
      token: adminToken,
      communityId,
    });
    expect(result.onboardingStatus).toBe("collecting");

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("collecting");
    expect(finance?.provisioningError).toBeUndefined();

    const status = await t.query(api.functions.finance.onboarding.getOnboardingStatus, {
      token: adminToken,
      communityId,
    });
    expect(status.provisioningError).toBeNull();

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    expect(
      auditEvents.filter((e) => e.action === "onboarding.provisioning_retried"),
    ).toHaveLength(1);
  });

  test("throws when onboarding hasn't started (no communityFinance row)", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedOnboardingFixture(t);

    await expect(
      t.mutation(api.functions.finance.onboarding.retryProvisioning, {
        token: adminToken,
        communityId,
      }),
    ).rejects.toThrow(/hasn't started/i);
  });

  test("throws 'already set up' once all three provider ids are present", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "verifying",
      stripeConnectedAccountId: "acct_done",
      increaseEntityId: "entity_done",
      increaseReceivingAccountId: "account_done",
    });

    await expect(
      t.mutation(api.functions.finance.onboarding.retryProvisioning, {
        token: adminToken,
        communityId,
      }),
    ).rejects.toThrow(/already set up/i);
  });

  test("rejects a non-admin member token", async () => {
    const t = convexTest(schema, modules);
    const { communityId, memberToken } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, { onboardingStatus: "stripe_blocked" });

    await expect(
      t.mutation(api.functions.finance.onboarding.retryProvisioning, {
        token: memberToken,
        communityId,
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// enableGroupGiving
// ============================================================================

describe("enableGroupGiving", () => {
  test("creates the group's fund and grants finance_admin to every active leader", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, adminToken, leaderUserId, leaderTwoUserId } =
      await seedOnboardingFixture(t);

    const result = await t.mutation(api.functions.finance.onboarding.enableGroupGiving, {
      token: adminToken,
      communityId,
      groupId,
    });
    expect(result.created).toBe(true);

    const fund = await t.run((ctx) => ctx.db.get(result.fundId));
    expect(fund?.type).toBe("group");
    expect(fund?.groupId).toBe(groupId);
    expect(fund?.status).toBe("active");
    expect(fund?.balanceCents).toBe(0);

    for (const leaderUserId_ of [leaderUserId, leaderTwoUserId]) {
      const roles = await t.run((ctx) =>
        ctx.db
          .query("fundRoles")
          .withIndex("by_user_fund", (q) =>
            q.eq("userId", leaderUserId_).eq("fundId", result.fundId),
          )
          .collect(),
      );
      expect(roles).toHaveLength(1);
      expect(roles[0].role).toBe("finance_admin");
    }

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", result.fundId))
        .collect(),
    );
    expect(auditEvents.filter((e) => e.action === "fund.created")).toHaveLength(1);
    expect(auditEvents.filter((e) => e.action === "role.granted")).toHaveLength(2);
  });

  test("is idempotent: calling twice does not duplicate the fund or roles", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId, adminToken } = await seedOnboardingFixture(t);

    const first = await t.mutation(api.functions.finance.onboarding.enableGroupGiving, {
      token: adminToken,
      communityId,
      groupId,
    });
    const second = await t.mutation(api.functions.finance.onboarding.enableGroupGiving, {
      token: adminToken,
      communityId,
      groupId,
    });

    expect(second.fundId).toBe(first.fundId);
    expect(second.created).toBe(false);

    const funds = await t.run((ctx) =>
      ctx.db
        .query("funds")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect(),
    );
    expect(funds).toHaveLength(1);

    const allRoles = await t.run((ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_fund", (q) => q.eq("fundId", first.fundId))
        .collect(),
    );
    // Two leaders in the fixture — still exactly two roles after the retry.
    expect(allRoles).toHaveLength(2);
  });

  test("rejects a group that belongs to a different community", async () => {
    const t = convexTest(schema, modules);
    const { communityId, otherCommunityGroupId, adminToken } = await seedOnboardingFixture(t);

    await expect(
      t.mutation(api.functions.finance.onboarding.enableGroupGiving, {
        token: adminToken,
        communityId,
        groupId: otherCommunityGroupId,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

// ============================================================================
// applyStripeAccountStatus
// ============================================================================

describe("applyStripeAccountStatus", () => {
  test("advances verifying -> live only once both charges/payouts are enabled AND Increase is provisioned", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "verifying",
      stripeConnectedAccountId: "acct_1",
      // Increase side NOT yet provisioned.
    });

    await t.mutation(internal.functions.finance.onboarding.applyStripeAccountStatus, {
      accountId: "acct_1",
      chargesEnabled: true,
      payoutsEnabled: true,
    });

    let finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    // Stripe is ready, but Increase isn't — must stay "verifying", not "live".
    expect(finance?.onboardingStatus).toBe("verifying");

    // Now provision the Increase side and re-send the same Stripe update.
    await t.run((ctx) =>
      ctx.db.patch(finance!._id, {
        increaseEntityId: "entity_1",
        increaseReceivingAccountId: "account_1",
      }),
    );
    await t.mutation(internal.functions.finance.onboarding.applyStripeAccountStatus, {
      accountId: "acct_1",
      chargesEnabled: true,
      payoutsEnabled: true,
    });

    finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("live");
  });

  test("sets stripe_blocked with the requirements summary when disabled_reason is present", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "verifying",
      stripeConnectedAccountId: "acct_2",
    });

    await t.mutation(internal.functions.finance.onboarding.applyStripeAccountStatus, {
      accountId: "acct_2",
      chargesEnabled: false,
      payoutsEnabled: false,
      disabledReason: "requirements.past_due",
      requirementsSummary: ["individual.verification.document"],
    });

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("stripe_blocked");

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    const transition = auditEvents.find((e) => e.action === "onboarding.status_changed");
    expect(transition).toBeDefined();
    expect(JSON.parse(transition!.detailsJson!).to).toBe("stripe_blocked");
  });

  test("never regresses an already-live community, even with disabled_reason present", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "live",
      stripeConnectedAccountId: "acct_3",
      increaseEntityId: "entity_3",
      increaseReceivingAccountId: "account_3",
    });

    await t.mutation(internal.functions.finance.onboarding.applyStripeAccountStatus, {
      accountId: "acct_3",
      chargesEnabled: false,
      payoutsEnabled: false,
      disabledReason: "requirements.past_due",
    });

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("live");

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    expect(auditEvents).toHaveLength(0);
  });
});

// ============================================================================
// freezeFundForArchivedGroup (security-review FIX 4)
// ============================================================================

describe("freezeFundForArchivedGroup", () => {
  async function insertFund(
    t: ReturnType<typeof convexTest>,
    communityId: Id<"communities">,
    groupId: Id<"groups">,
    status: "active" | "frozen" | "closed" = "active",
  ): Promise<Id<"funds">> {
    return await t.run(async (ctx) => {
      const timestamp = Date.now();
      return await ctx.db.insert("funds", {
        communityId,
        groupId,
        name: "Young Adults Fund",
        type: "group",
        status,
        balanceCents: 1000,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  }

  test("freezes an active fund and audit-logs it", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedOnboardingFixture(t);
    const fundId = await insertFund(t, communityId, groupId);

    await t.mutation(
      internal.functions.finance.onboarding.freezeFundForArchivedGroup,
      { groupId },
    );

    const fund = await t.run((ctx) => ctx.db.get(fundId));
    expect(fund?.status).toBe("frozen");

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(auditEvents.filter((e) => e.action === "fund.frozen")).toHaveLength(1);
  });

  test("is idempotent: retrying an already-frozen fund is a no-op, no duplicate audit row", async () => {
    const t = convexTest(schema, modules);
    const { communityId, groupId } = await seedOnboardingFixture(t);
    const fundId = await insertFund(t, communityId, groupId, "frozen");

    await t.mutation(
      internal.functions.finance.onboarding.freezeFundForArchivedGroup,
      { groupId },
    );

    const fund = await t.run((ctx) => ctx.db.get(fundId));
    expect(fund?.status).toBe("frozen");

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(auditEvents.filter((e) => e.action === "fund.frozen")).toHaveLength(0);
  });

  test("no-ops when the group has no fund yet (giving never enabled)", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedOnboardingFixture(t);

    await expect(
      t.mutation(
        internal.functions.finance.onboarding.freezeFundForArchivedGroup,
        { groupId },
      ),
    ).resolves.toBeNull();
  });
});

// ============================================================================
// applyIncreaseEntityStatus (functions/finance/webhooks.ts)
// ============================================================================

describe("applyIncreaseEntityStatus", () => {
  test("disabled sets increase_blocked, and re-activation recovers to verifying", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "verifying",
      increaseEntityId: "entity_disable_test",
    });

    await t.mutation(internal.functions.finance.webhooks.applyIncreaseEntityStatus, {
      entityId: "entity_disable_test",
      status: "disabled",
    });

    let finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("increase_blocked");

    await t.mutation(internal.functions.finance.webhooks.applyIncreaseEntityStatus, {
      entityId: "entity_disable_test",
      status: "active",
    });

    finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("verifying");

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect(),
    );
    expect(auditEvents.filter((e) => e.action === "onboarding.status_changed")).toHaveLength(2);
  });

  test("never regresses an already-live community", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedOnboardingFixture(t);
    await insertCommunityFinance(t, communityId, {
      onboardingStatus: "live",
      increaseEntityId: "entity_live_test",
    });

    await t.mutation(internal.functions.finance.webhooks.applyIncreaseEntityStatus, {
      entityId: "entity_live_test",
      status: "disabled",
    });

    const finance = await t.run((ctx) =>
      ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .first(),
    );
    expect(finance?.onboardingStatus).toBe("live");
  });
});

// ============================================================================
// verifyIncreaseWebhookSignature (lib/finance/increase.ts) — pure crypto, no network.
// ============================================================================

describe("verifyIncreaseWebhookSignature", () => {
  const secret = "test-increase-webhook-secret";

  async function sign(webhookId: string, webhookTimestamp: string, body: string) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`${webhookId}.${webhookTimestamp}.${body}`),
    );
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return `v1,${btoa(binary)}`;
  }

  test("accepts a correctly-signed payload", async () => {
    const body = JSON.stringify({ id: "event_123", category: "entity.updated" });
    const webhookId = "msg_abc";
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(webhookId, webhookTimestamp, body);

    const valid = await verifyIncreaseWebhookSignature(
      body,
      { webhookId, webhookTimestamp, webhookSignature: signature },
      secret,
    );
    expect(valid).toBe(true);
  });

  test("rejects a tampered body", async () => {
    const webhookId = "msg_abc";
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(
      webhookId,
      webhookTimestamp,
      JSON.stringify({ id: "event_123", category: "entity.updated" }),
    );

    const valid = await verifyIncreaseWebhookSignature(
      JSON.stringify({ id: "event_123", category: "entity.updated", tampered: true }),
      { webhookId, webhookTimestamp, webhookSignature: signature },
      secret,
    );
    expect(valid).toBe(false);
  });

  test("rejects a signature signed with the wrong secret", async () => {
    const body = JSON.stringify({ id: "event_123" });
    const webhookId = "msg_abc";
    const webhookTimestamp = String(Math.floor(Date.now() / 1000));

    const encoder = new TextEncoder();
    const wrongKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode("wrong-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign(
      "HMAC",
      wrongKey,
      encoder.encode(`${webhookId}.${webhookTimestamp}.${body}`),
    );
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    const badSignature = `v1,${btoa(binary)}`;

    const valid = await verifyIncreaseWebhookSignature(
      body,
      { webhookId, webhookTimestamp, webhookSignature: badSignature },
      secret,
    );
    expect(valid).toBe(false);
  });

  test("rejects a stale timestamp outside the 300-second replay window", async () => {
    const body = JSON.stringify({ id: "event_123" });
    const webhookId = "msg_abc";
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const signature = await sign(webhookId, staleTimestamp, body);

    const valid = await verifyIncreaseWebhookSignature(
      body,
      { webhookId, webhookTimestamp: staleTimestamp, webhookSignature: signature },
      secret,
    );
    expect(valid).toBe(false);
  });
});

describe("enableGroupGiving on a frozen fund (unarchive lifecycle)", () => {
  test("reactivates the frozen fund of an un-archived group", async () => {
    const t = convexTest(schema, modules);
    const s = await seedOnboardingFixture(t);
    const { accessToken: token } = await generateTokens(s.adminUserId);

    // Enable once, freeze (as the archive cascade does), then re-enable on
    // the (now un-archived) group: same fund comes back active.
    const { fundId } = await t.mutation(
      api.functions.finance.onboarding.enableGroupGiving,
      { token, communityId: s.communityId, groupId: s.groupId },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(fundId, { status: "frozen" as const });
    });

    const again = await t.mutation(
      api.functions.finance.onboarding.enableGroupGiving,
      { token, communityId: s.communityId, groupId: s.groupId },
    );
    expect(again.fundId).toBe(fundId);
    expect(again.created).toBe(false);

    const fund = await t.run(async (ctx) => ctx.db.get(fundId));
    expect(fund?.status).toBe("active");

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundId))
        .collect(),
    );
    expect(audits.some((a) => a.action === "fund.reactivated")).toBe(true);
  });

  test("closed funds are not silently reopened", async () => {
    const t = convexTest(schema, modules);
    const s = await seedOnboardingFixture(t);
    const { accessToken: token } = await generateTokens(s.adminUserId);

    const { fundId } = await t.mutation(
      api.functions.finance.onboarding.enableGroupGiving,
      { token, communityId: s.communityId, groupId: s.groupId },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(fundId, { status: "closed" as const });
    });

    await expect(
      t.mutation(api.functions.finance.onboarding.enableGroupGiving, {
        token,
        communityId: s.communityId,
        groupId: s.groupId,
      }),
    ).rejects.toThrow(/closed/i);
  });
});
