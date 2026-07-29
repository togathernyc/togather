/**
 * Group giving universal feature flag (lib/finance/flag.ts).
 *
 * The entire feature is behind the app-wide "group-giving" flag in the admin
 * feature-flag system (functions/admin/featureFlags.ts), DEFAULT OFF — no
 * featureFlags row means disabled. These tests exercise the off state: reads
 * that surface the feature return null (hiding all UI), and activity-
 * initiating mutations throw. Webhook/cron/internal settlement paths are
 * deliberately NOT gated (see lib/finance/flag.ts) — covered implicitly by
 * the other finance suites, whose internal-mutation tests never touch the
 * flag.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-flag.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

/** Minimal world with a live fund but NO "group-giving" featureFlags row. */
async function seedWithoutFlag(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    const communityId = await ctx.db.insert("communities", {
      name: "Flagless Church",
      slug: "flagless-church",
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
    const adminUserId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "Person",
      email: "admin@example.com",
      phone: "+15550001111",
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.insert("userCommunities", {
      userId: adminUserId,
      communityId,
      roles: 3, // COMMUNITY_ROLES.ADMIN
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: adminUserId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Young Adults Fund",
      type: "group",
      status: "active",
      balanceCents: 5000,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { communityId, groupId, fundId, adminUserId };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

describe("group-giving feature flag (default off)", () => {
  test("read surfaces return null, hiding the feature even when a fund exists", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWithoutFlag(t);
    const token = await tokenFor(s.adminUserId);

    const context = await t.query(api.functions.finance.giving.getGivingContext, {
      token,
      groupId: s.groupId,
    });
    expect(context).toBeNull();

    const overview = await t.query(api.functions.finance.giving.getFundOverview, {
      token,
      groupId: s.groupId,
    });
    expect(overview).toBeNull();
  });

  test("activity-initiating mutations throw while the flag is off", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWithoutFlag(t);
    const token = await tokenFor(s.adminUserId);

    await expect(
      t.mutation(api.functions.finance.onboarding.startOnboarding, {
        token,
        communityId: s.communityId,
        legalName: "Flagless Church Inc.",
        ein: "12-3456789",
        address: {
          addressLine1: "1 Main St",
          city: "Anytown",
          state: "CA",
          zipCode: "90210",
        },
      }),
    ).rejects.toThrow(/not enabled/i);

    await expect(
      t.mutation(api.functions.finance.onboarding.enableGroupGiving, {
        token,
        communityId: s.communityId,
        groupId: s.groupId,
      }),
    ).rejects.toThrow(/not enabled/i);

    await expect(
      t.mutation(api.functions.finance.expenses.submitExpense, {
        token,
        fundId: s.fundId,
        amountCents: 1000,
        kind: "reimbursement",
        description: "Should be blocked",
        receiptKey: "r2:receipts/blocked.jpg",
      }),
    ).rejects.toThrow(/not enabled/i);

    await expect(
      t.mutation(api.functions.finance.roles.grantFundRole, {
        token,
        fundId: s.fundId,
        userId: s.adminUserId,
        role: "manager",
      }),
    ).rejects.toThrow(/not enabled/i);
  });

  test("flipping the flag on via setFeatureFlag opens the gates", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWithoutFlag(t);
    // Make the admin a superuser so they can flip the flag the same way
    // /(user)/admin/features does.
    await t.run(async (ctx) => {
      await ctx.db.patch(s.adminUserId, { isSuperuser: true });
    });
    const token = await tokenFor(s.adminUserId);

    await t.mutation(api.functions.admin.featureFlags.setFeatureFlag, {
      token,
      key: "group-giving",
      enabled: true,
      description: "Group giving, spending, receipting, reimbursements (ADR-032)",
    });

    const context = await t.query(api.functions.finance.giving.getGivingContext, {
      token,
      groupId: s.groupId,
    });
    expect(context).not.toBeNull();
    expect(context?.fundId).toBe(s.fundId);
  });
});
