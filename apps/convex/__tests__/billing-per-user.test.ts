/**
 * Per-active-user billing infrastructure tests (functions/ee/billing.ts).
 *
 * Covers the sync anomaly guard, the legacy-community listing, and the
 * dry-run path of the fixed-price -> per-active-user migration. The live
 * Stripe paths are exercised manually against test keys.
 *
 * Run with: cd apps/convex && pnpm test __tests__/billing-per-user.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";
import { isAnomalousCountChange } from "../functions/ee/billing";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

describe("isAnomalousCountChange", () => {
  test("flags >30% swings on established communities", () => {
    expect(isAnomalousCountChange(100, 131)).toBe(true);
    expect(isAnomalousCountChange(100, 69)).toBe(true);
    expect(isAnomalousCountChange(100, 129)).toBe(false);
    expect(isAnomalousCountChange(100, 71)).toBe(false);
  });

  test("small baselines are exempt", () => {
    expect(isAnomalousCountChange(5, 15)).toBe(false);
    expect(isAnomalousCountChange(9, 1)).toBe(false);
    expect(isAnomalousCountChange(10, 20)).toBe(true);
  });
});

/** A live community with a Stripe subscription and one recently active admin. */
async function seedBillingCommunity(
  t: ReturnType<typeof convexTest>,
  opts: {
    name: string;
    slug: string;
    billingModel?: string;
    subscriptionPriceMonthly?: number;
    isDemo?: boolean;
    subscriptionStatus?: string;
  },
): Promise<Id<"communities">> {
  const timestamp = Date.now();
  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: opts.name,
      slug: opts.slug,
      stripeSubscriptionId: `sub_${opts.slug}`,
      subscriptionStatus: opts.subscriptionStatus ?? "active",
      subscriptionPriceMonthly: opts.subscriptionPriceMonthly,
      billingModel: opts.billingModel,
      isDemo: opts.isDemo,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const userId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: opts.slug,
      phone: `+1555556${String(1000 + (opts.slug.length * 37) % 8999)}`,
      phoneVerified: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.insert("userCommunities", {
      userId,
      communityId,
      roles: 4,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLogin: timestamp,
    });
    return communityId;
  });
}

describe("listLegacyBillingCommunities", () => {
  test("returns only live fixed-price communities, with old and new price", async () => {
    const t = convexTest(schema, modules);

    const legacyId = await seedBillingCommunity(t, {
      name: "Legacy Church",
      slug: "legacy",
      subscriptionPriceMonthly: 200,
    });
    await seedBillingCommunity(t, {
      name: "Already Migrated",
      slug: "migrated",
      billingModel: "per_active_user",
      subscriptionPriceMonthly: 40,
    });
    await seedBillingCommunity(t, {
      name: "Demo Church",
      slug: "demo-ch",
      isDemo: true,
    });
    await seedBillingCommunity(t, {
      name: "Canceled Church",
      slug: "canceled",
      subscriptionStatus: "canceled",
    });

    const legacy = await t.query(
      internal.functions.ee.billing.listLegacyBillingCommunities,
      {},
    );
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({
      communityId: legacyId,
      name: "Legacy Church",
      currentMonthlyPriceUsd: 200,
      billableActiveUsers: 1, // one active admin
    });
  });
});

describe("migrateToPerUserBilling", () => {
  test("dry run reports the price change without touching anything", async () => {
    const t = convexTest(schema, modules);
    const legacyId = await seedBillingCommunity(t, {
      name: "Legacy Church",
      slug: "legacy2",
      subscriptionPriceMonthly: 200,
    });

    const result = await t.action(
      internal.functions.ee.billing.migrateToPerUserBilling,
      {},
    );
    expect(result.dryRun).toBe(true);
    expect(result.migrated).toBe(0);
    expect(result.report).toHaveLength(1);
    expect(result.report[0]).toMatchObject({
      name: "Legacy Church",
      currentMonthlyPriceUsd: 200,
      newMonthlyPriceUsd: 1,
      migrated: false,
    });

    const community = await t.run(async (ctx) => ctx.db.get(legacyId));
    expect(community?.billingModel).toBeUndefined();
    expect(community?.subscriptionPriceMonthly).toBe(200);
  });

  test("markCommunityPerUserBilling stamps the model and synced count", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedBillingCommunity(t, {
      name: "Legacy Church",
      slug: "legacy3",
      subscriptionPriceMonthly: 200,
    });

    await t.mutation(
      internal.functions.ee.billing.markCommunityPerUserBilling,
      { communityId, billableActiveUsers: 37 },
    );

    const community = await t.run(async (ctx) => ctx.db.get(communityId));
    expect(community?.billingModel).toBe("per_active_user");
    expect(community?.subscriptionPriceMonthly).toBe(37);

    // Once migrated it must show up in the monthly sync list…
    const perUser = await t.query(
      internal.functions.ee.billing.listPerUserBillingCommunities,
      {},
    );
    expect(
      perUser.some(
        (c: { communityId: string }) => c.communityId === communityId,
      ),
    ).toBe(true);
    // …and drop out of the legacy list.
    const legacy = await t.query(
      internal.functions.ee.billing.listLegacyBillingCommunities,
      {},
    );
    expect(
      legacy.some(
        (c: { communityId: string }) => c.communityId === communityId,
      ),
    ).toBe(false);
  });
});
