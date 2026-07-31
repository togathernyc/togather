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

  test("role-gated management reads throw while the flag is off", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWithoutFlag(t);
    const token = await tokenFor(s.adminUserId);

    // The caller here is a community admin AND a group leader — they'd sail
    // through every permission check. The flag is the only thing stopping
    // them, which is the point: these are the fund's management surfaces
    // (roster of who can move money, every expense and receipt on the fund),
    // and the kill switch has to reach them like it reaches cards.ts's reads.
    await expect(
      t.query(api.functions.finance.roles.listFundRoles, { token, fundId: s.fundId }),
    ).rejects.toThrow(/not enabled/i);

    await expect(
      t.query(api.functions.finance.roles.getMyFundRole, { token, fundId: s.fundId }),
    ).rejects.toThrow(/not enabled/i);

    await expect(
      t.query(api.functions.finance.expenses.listExpenses, { token, fundId: s.fundId }),
    ).rejects.toThrow(/not enabled/i);

    await expect(
      t.query(api.functions.finance.expenses.listMyExpenses, { token, fundId: s.fundId }),
    ).rejects.toThrow(/not enabled/i);
  });

  test("de-escalation stays available with the flag off (deliberately ungated)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWithoutFlag(t);
    const adminToken = await tokenFor(s.adminUserId);

    // Flipping the kill switch is most likely DURING an incident. Revoking a
    // compromised finance_admin and denying a pending expense both only ever
    // take power away or stop money moving — gating them would lock the
    // response out along with the feature. Same call as setCardFrozen /
    // cancelCard in cards.ts.
    const { treasurerUserId, expenseId } = await t.run(async (ctx) => {
      const timestamp = Date.now();
      const treasurerUserId = await ctx.db.insert("users", {
        firstName: "Treasurer",
        lastName: "Person",
        phone: "+15550002222",
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("groupMembers", {
        groupId: s.groupId,
        userId: treasurerUserId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      await ctx.db.insert("fundRoles", {
        fundId: s.fundId,
        userId: treasurerUserId,
        role: "finance_admin" as const,
        grantedBy: s.adminUserId,
        grantedAt: timestamp,
      });
      const expenseId = await ctx.db.insert("expenses", {
        fundId: s.fundId,
        submitterId: treasurerUserId,
        amountCents: 2500,
        kind: "reimbursement" as const,
        description: "Pending when the switch flipped",
        receiptKey: "r2:uploads/legacy-receipt.jpg",
        status: "pending" as const,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return { treasurerUserId, expenseId };
    });

    await t.mutation(api.functions.finance.expenses.denyExpense, {
      token: adminToken,
      expenseId,
      reason: "Feature paused",
    });
    expect(await t.run((ctx) => ctx.db.get(expenseId))).toMatchObject({
      status: "denied",
    });

    await t.mutation(api.functions.finance.roles.revokeFundRole, {
      token: adminToken,
      fundId: s.fundId,
      userId: treasurerUserId,
    });
    const roles = await t.run((ctx) =>
      ctx.db
        .query("fundRoles")
        .withIndex("by_user_fund", (q) =>
          q.eq("userId", treasurerUserId).eq("fundId", s.fundId),
        )
        .collect(),
    );
    expect(roles.every((r) => r.revokedAt !== undefined)).toBe(true);
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

// ============================================================================
// Codex review fixes (PR #653) — regression coverage
// ============================================================================

import { splitDonationAmounts } from "../functions/finance/webhooks";
import { internal } from "../_generated/api";

describe("splitDonationAmounts (fee-cover double-count fix)", () => {
  test("splits charged total back into base gift + cover", () => {
    expect(splitDonationAmounts(10320, 320)).toEqual({
      baseCents: 10000,
      feeCoverCents: 320,
    });
  });

  test("malformed cover normalizes to zero, never inflating the gift", () => {
    expect(splitDonationAmounts(5000, -1)).toEqual({ baseCents: 5000, feeCoverCents: 0 });
    expect(splitDonationAmounts(5000, 5000)).toEqual({ baseCents: 5000, feeCoverCents: 0 });
    expect(splitDonationAmounts(5000, 12.5)).toEqual({ baseCents: 5000, feeCoverCents: 0 });
    expect(splitDonationAmounts(5000, Number.NaN)).toEqual({ baseCents: 5000, feeCoverCents: 0 });
  });
});

describe("planAllocations (payout.paid replay protection)", () => {
  test("re-planning the same payout records it once and reports alreadyClaimed", async () => {
    const t = convexTest(schema, modules);
    const s = await seedWithoutFlag(t);

    // Settlement paths are deliberately NOT flag-gated (see this file's
    // header): a payout that arrives while the flag is off must still
    // allocate, and must still be replay-safe.
    const args = {
      communityId: s.communityId,
      stripePayoutId: "po_replay_test",
      payoutCents: 12345,
      charges: [],
    };
    const first = await t.mutation(internal.functions.finance.jobs.planAllocations, args);
    const second = await t.mutation(internal.functions.finance.jobs.planAllocations, args);

    expect(first.alreadyClaimed).toBe(false);
    expect(second.alreadyClaimed).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.query("processedStripePayouts").collect()),
    ).toHaveLength(1);
  });
});
