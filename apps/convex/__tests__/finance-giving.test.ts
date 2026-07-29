/**
 * Group giving: donations, transparency screen, and allocation/reconcile
 * jobs tests (ADR-032 §3, §6).
 *
 * Covers functions/finance/giving.ts (getFundOverview aggregates + donor-name
 * gating, getGivingContext live-gating, recordDonationSucceeded idempotency)
 * functions/finance/jobs.ts (planAllocations, recordAllocation,
 * computePendingAllocationCents, recordReconcileResult), and
 * lib/finance/receipts.ts (buildDonationReceiptEmail content). The live
 * Stripe/Resend/Increase paths (createDonationIntent, sendDonationReceipt's
 * actual send, runAllocation/runNightlyReconcile's provider calls) are
 * exercised manually against sandbox keys, per repo convention — everything
 * here goes through internal mutations with synthetic inputs instead.
 *
 * Run with: cd apps/convex && pnpm test __tests__/finance-giving.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import { buildDonationReceiptEmail } from "../lib/finance/receipts";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Shared seeding
// ============================================================================

interface GivingFixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  fundId: Id<"funds">; // active, group-scoped
  donorUserId: Id<"users">; // active group member who gives
  memberUserId: Id<"users">; // active group member, no fund role
  managerUserId: Id<"users">; // active group member, fundRole: manager
  adminUserId: Id<"users">; // community admin, not a group member
}

async function seedGivingFixture(
  t: ReturnType<typeof convexTest>,
): Promise<GivingFixture> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Test Church",
      slug: "test-church",
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

    const mkUser = async (firstName: string, lastName: string) =>
      ctx.db.insert("users", {
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}@example.com`,
        phone: `+1555000${Math.floor(Math.random() * 9000 + 1000)}`,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const donorUserId = await mkUser("Donor", "Giver");
    const memberUserId = await mkUser("Plain", "Member");
    const managerUserId = await mkUser("Manager", "Person");
    const adminUserId = await mkUser("Admin", "Person");

    await ctx.db.insert("userCommunities", {
      userId: adminUserId,
      communityId,
      roles: 3, // COMMUNITY_ROLES.ADMIN
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    for (const userId of [donorUserId, memberUserId, managerUserId]) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    }

    const fundId = await ctx.db.insert("funds", {
      communityId,
      groupId,
      name: "Young Adults Fund",
      type: "group",
      status: "active",
      balanceCents: 10_000,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("fundRoles", {
      fundId,
      userId: managerUserId,
      role: "manager",
      grantedBy: adminUserId,
      grantedAt: timestamp,
    });

    await ctx.db.insert("communityFinance", {
      communityId,
      stripeConnectedAccountId: "acct_test123",
      onboardingStatus: "live",
      legalName: "Test Church Inc.",
      ein: "12-3456789",
      address: {
        addressLine1: "123 Main St",
        city: "Anytown",
        state: "CA",
        zipCode: "90210",
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      communityId,
      groupId,
      fundId,
      donorUserId,
      memberUserId,
      managerUserId,
      adminUserId,
    };
  });
}

async function tokenFor(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

function startOfMonthUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function startOfYearUTC(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), 0, 1);
}

// ============================================================================
// getFundOverview
// ============================================================================

describe("getFundOverview", () => {
  test("aggregates month-to-date / year-to-date and anonymizes activity for a plain member", async () => {
    const t = convexTest(schema, modules);
    const s = await seedGivingFixture(t);

    const nowMs = Date.now();
    // NOTE: "before this month but within this year" is constructed relative
    // to the real current month, so it's only accurate outside of January —
    // acceptable for a unit test (see the finance-ledger.test.ts fixture for
    // the same style of real-clock-relative seeding).
    const withinMonthTs = nowMs - 1_000;
    const withinYearNotMonthTs = startOfMonthUTC(nowMs) - 24 * 60 * 60 * 1000;
    const beforeYearTs = startOfYearUTC(nowMs) - 24 * 60 * 60 * 1000;

    await t.run(async (ctx) => {
      // Within this month: a donation credit (counts in both MTD and YTD).
      await ctx.db.insert("ledgerEntries", {
        fundId: s.fundId,
        communityId: s.communityId,
        direction: "credit",
        amountCents: 5000,
        kind: "donation",
        idempotencyKey: "donation:pi_month",
        actorUserId: s.donorUserId,
        createdAt: withinMonthTs,
      });
      // Within this month: a spend debit (counts in MTD and YTD spentCents).
      await ctx.db.insert("ledgerEntries", {
        fundId: s.fundId,
        communityId: s.communityId,
        direction: "debit",
        amountCents: 300,
        kind: "card_capture",
        idempotencyKey: "capture:txn_month",
        createdAt: withinMonthTs,
      });
      // Within this year but not this month: a donation credit (YTD only).
      await ctx.db.insert("ledgerEntries", {
        fundId: s.fundId,
        communityId: s.communityId,
        direction: "credit",
        amountCents: 9999,
        kind: "donation",
        idempotencyKey: "donation:pi_year",
        actorUserId: s.donorUserId,
        createdAt: withinYearNotMonthTs,
      });
      // Before this year: excluded from both MTD and YTD entirely.
      await ctx.db.insert("ledgerEntries", {
        fundId: s.fundId,
        communityId: s.communityId,
        direction: "credit",
        amountCents: 123456,
        kind: "donation",
        idempotencyKey: "donation:pi_ancient",
        actorUserId: s.donorUserId,
        createdAt: beforeYearTs,
      });
    });

    const memberResult = await t.query(api.functions.finance.giving.getFundOverview, {
      token: await tokenFor(s.memberUserId),
      groupId: s.groupId,
    });

    expect(memberResult).not.toBeNull();
    expect(memberResult!.balanceCents).toBe(10_000); // fund's cached balance, unaffected by these direct-insert entries
    expect(memberResult!.monthToDate).toEqual({
      donationsCents: 5000,
      spentCents: 300,
      donationCount: 1,
    });
    expect(memberResult!.yearToDate).toEqual({
      donationsCents: 5000 + 9999,
      spentCents: 300,
      donationCount: 2,
    });
    expect(memberResult!.viewerCanSeeDonorNames).toBe(false);

    // A plain member sees activity kind/amount/direction, never who gave.
    const donationItems = memberResult!.activity.filter((a) => a.kind === "donation");
    expect(donationItems.length).toBeGreaterThan(0);
    for (const item of donationItems) {
      expect((item as { donorName?: string }).donorName).toBeUndefined();
    }
  });

  test("a manager+ viewer sees donor names on donation activity", async () => {
    const t = convexTest(schema, modules);
    const s = await seedGivingFixture(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("ledgerEntries", {
        fundId: s.fundId,
        communityId: s.communityId,
        direction: "credit",
        amountCents: 5000,
        kind: "donation",
        idempotencyKey: "donation:pi_visible",
        actorUserId: s.donorUserId,
        createdAt: Date.now(),
      });
    });

    const managerResult = await t.query(api.functions.finance.giving.getFundOverview, {
      token: await tokenFor(s.managerUserId),
      groupId: s.groupId,
    });
    expect(managerResult!.viewerCanSeeDonorNames).toBe(true);
    const donationItem = managerResult!.activity.find((a) => a.kind === "donation");
    expect((donationItem as { donorName?: string }).donorName).toBe("Donor Giver");

    // Community admin (not even a group member) also sees donor names.
    const adminResult = await t.query(api.functions.finance.giving.getFundOverview, {
      token: await tokenFor(s.adminUserId),
      groupId: s.groupId,
    });
    expect(adminResult!.viewerCanSeeDonorNames).toBe(true);
  });

  test("rejects a user with no access to the fund's group", async () => {
    const t = convexTest(schema, modules);
    const s = await seedGivingFixture(t);
    const outsiderId = await t.run((ctx) =>
      ctx.db.insert("users", {
        firstName: "Outsider",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    await expect(
      t.query(api.functions.finance.giving.getFundOverview, {
        token: await tokenFor(outsiderId),
        groupId: s.groupId,
      }),
    ).rejects.toThrow();
  });

  test("returns null when the group has no fund yet", async () => {
    const t = convexTest(schema, modules);
    const s = await seedGivingFixture(t);
    const otherGroupId = await t.run(async (ctx) => {
      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId: s.communityId,
        name: "Other",
        slug: "other",
        isActive: true,
        createdAt: Date.now(),
        displayOrder: 2,
      });
      return ctx.db.insert("groups", {
        communityId: s.communityId,
        groupTypeId,
        name: "No Giving Yet",
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(api.functions.finance.giving.getFundOverview, {
      token: await tokenFor(s.adminUserId),
      groupId: otherGroupId,
    });
    expect(result).toBeNull();
  });
});

// ============================================================================
// getGivingContext
// ============================================================================

describe("getGivingContext", () => {
  test("givingLive is true only when onboarding is live and the fund is active", async () => {
    const t = convexTest(schema, modules);
    const s = await seedGivingFixture(t);
    const token = await tokenFor(s.memberUserId);

    const live = await t.query(api.functions.finance.giving.getGivingContext, {
      token,
      groupId: s.groupId,
    });
    expect(live).toEqual({
      fundId: s.fundId,
      communityLegalName: "Test Church Inc.",
      suggestedAmountsCents: [1000, 5000, 10000],
      givingLive: true,
    });

    await t.run(async (ctx) => {
      const finance = await ctx.db
        .query("communityFinance")
        .withIndex("by_community", (q) => q.eq("communityId", s.communityId))
        .first();
      await ctx.db.patch(finance!._id, { onboardingStatus: "collecting" });
    });

    const notLive = await t.query(api.functions.finance.giving.getGivingContext, {
      token,
      groupId: s.groupId,
    });
    expect(notLive!.givingLive).toBe(false);
  });
});

// ============================================================================
// recordDonationSucceeded
// ============================================================================

describe("recordDonationSucceeded", () => {
  test("writes the donation + ledger credit + audit event", async () => {
    const t = convexTest(schema, modules);
    const s = await seedGivingFixture(t);

    await t.mutation(internal.functions.finance.giving.recordDonationSucceeded, {
      paymentIntentId: "pi_test_123",
      fundId: s.fundId,
      donorUserId: s.donorUserId,
      amountCents: 2500,
      feeCoverCents: 150,
      communityId: s.communityId,
    });

    const donations = await t.run((ctx) =>
      ctx.db
        .query("donations")
        .withIndex("by_fund", (q) => q.eq("fundId", s.fundId))
        .collect(),
    );
    expect(donations).toHaveLength(1);
    expect(donations[0].allocationStatus).toBe("pending");
    expect(donations[0].receiptEmailStatus).toBe("pending");
    expect(donations[0].amountCents).toBe(2500);
    expect(donations[0].feeCoverCents).toBe(150);

    const fund = await t.run((ctx) => ctx.db.get(s.fundId));
    expect(fund?.balanceCents).toBe(10_000 + 2650); // seeded balance + (amount + fee-cover)

    const ledgerEntries = await t.run((ctx) =>
      ctx.db
        .query("ledgerEntries")
        .withIndex("by_fund", (q) => q.eq("fundId", s.fundId))
        .collect(),
    );
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].amountCents).toBe(2650);
    expect(ledgerEntries[0].kind).toBe("donation");
    expect(ledgerEntries[0].actorUserId).toBe(s.donorUserId);

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", s.fundId))
        .collect(),
    );
    expect(auditEvents.filter((e) => e.action === "donation.recorded")).toHaveLength(1);
  });

  test("is idempotent on a duplicate webhook delivery for the same PaymentIntent", async () => {
    const t = convexTest(schema, modules);
    const s = await seedGivingFixture(t);

    const args = {
      paymentIntentId: "pi_dupe_456",
      fundId: s.fundId,
      donorUserId: s.donorUserId,
      amountCents: 1000,
      feeCoverCents: 0,
      communityId: s.communityId,
    };

    await t.mutation(internal.functions.finance.giving.recordDonationSucceeded, args);
    await t.mutation(internal.functions.finance.giving.recordDonationSucceeded, args);

    const donations = await t.run((ctx) =>
      ctx.db
        .query("donations")
        .withIndex("by_fund", (q) => q.eq("fundId", s.fundId))
        .collect(),
    );
    expect(donations).toHaveLength(1);

    const fund = await t.run((ctx) => ctx.db.get(s.fundId));
    expect(fund?.balanceCents).toBe(10_000 + 1000); // not double-credited
  });

  test("schedules a receipt email that resolves to 'failed' with no Resend key configured (no real network)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const s = await seedGivingFixture(t);

    const donationId = await t.mutation(
      internal.functions.finance.giving.recordDonationSucceeded,
      {
        paymentIntentId: "pi_receipt_789",
        fundId: s.fundId,
        donorUserId: s.donorUserId,
        amountCents: 4200,
        feeCoverCents: 0,
        communityId: s.communityId,
      },
    );

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const donation = await t.run((ctx) => ctx.db.get(donationId as Id<"donations">));
    // RESEND_API_KEY is unset in the test environment, so getResendClient()
    // returns null and sendDonationReceipt marks the receipt "failed"
    // without making any network call.
    expect(donation?.receiptEmailStatus).toBe("failed");
  });
});

// ============================================================================
// planAllocations / recordAllocation / computePendingAllocationCents
// ============================================================================

interface JobsFixture {
  communityId: Id<"communities">;
  fundAId: Id<"funds">; // group fund
  fundBId: Id<"funds">; // group fund
}

async function seedJobsFixture(t: ReturnType<typeof convexTest>): Promise<JobsFixture> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    const communityId = await ctx.db.insert("communities", {
      name: "Jobs Test Church",
      slug: "jobs-test-church",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const fundAId = await ctx.db.insert("funds", {
      communityId,
      name: "Fund A",
      type: "group",
      status: "active",
      balanceCents: 10_000,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const fundBId = await ctx.db.insert("funds", {
      communityId,
      name: "Fund B",
      type: "group",
      status: "active",
      balanceCents: 5_000,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { communityId, fundAId, fundBId };
  });
}

describe("planAllocations", () => {
  test("selects pending donations oldest-first across the whole community, whole donations only, with leftover", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId, fundBId } = await seedJobsFixture(t);

    await t.run(async (ctx) => {
      // Oldest, on fund A: total 1000.
      await ctx.db.insert("donations", {
        fundId: fundAId,
        amountCents: 1000,
        feeCoverCents: 0,
        stripePaymentIntentId: "pi_1",
        allocationStatus: "pending",
        receiptEmailStatus: "sent",
        createdAt: 1_000,
      });
      // Second oldest, on fund B: total 2100.
      await ctx.db.insert("donations", {
        fundId: fundBId,
        amountCents: 2000,
        feeCoverCents: 100,
        stripePaymentIntentId: "pi_2",
        allocationStatus: "pending",
        receiptEmailStatus: "sent",
        createdAt: 2_000,
      });
      // Newest, on fund A: total 5000 — doesn't fit in a 3100-cent payout.
      await ctx.db.insert("donations", {
        fundId: fundAId,
        amountCents: 5000,
        feeCoverCents: 0,
        stripePaymentIntentId: "pi_3",
        allocationStatus: "pending",
        receiptEmailStatus: "sent",
        createdAt: 3_000,
      });
      // Already allocated — must never be selected, even though it's oldest.
      await ctx.db.insert("donations", {
        fundId: fundAId,
        amountCents: 999,
        feeCoverCents: 0,
        stripePaymentIntentId: "pi_0_already_allocated",
        allocationStatus: "allocated",
        receiptEmailStatus: "sent",
        createdAt: 500,
      });
    });

    const result = await t.mutation(internal.functions.finance.jobs.planAllocations, {
      communityId,
      payoutCents: 3100,
      stripePayoutId: "po_test_1",
    });

    expect(result.plan).toHaveLength(2);
    expect(result.plan[0]).toMatchObject({ fundId: fundAId, amountCents: 1000 });
    expect(result.plan[1]).toMatchObject({ fundId: fundBId, amountCents: 2100 });
    expect(result.leftoverCents).toBe(0);
  });

  test("leftoverCents reflects a payout that doesn't exactly cover whole donations", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedJobsFixture(t);

    await t.run((ctx) =>
      ctx.db.insert("donations", {
        fundId: fundAId,
        amountCents: 1000,
        feeCoverCents: 0,
        stripePaymentIntentId: "pi_solo",
        allocationStatus: "pending",
        receiptEmailStatus: "sent",
        createdAt: 1_000,
      }),
    );

    // Payout is $9.90 more than the one donation — e.g. Stripe's processing
    // fee taken out of the gross payout, never matching a whole donation.
    const result = await t.mutation(internal.functions.finance.jobs.planAllocations, {
      communityId,
      payoutCents: 1990,
      stripePayoutId: "po_test_2",
    });

    expect(result.plan).toHaveLength(1);
    expect(result.leftoverCents).toBe(990);
  });
});

describe("recordAllocation", () => {
  test("flips allocationStatus and audit-logs without changing the fund's balanceCents", async () => {
    const t = convexTest(schema, modules);
    const { fundAId } = await seedJobsFixture(t);

    const donationId = await t.run((ctx) =>
      ctx.db.insert("donations", {
        fundId: fundAId,
        amountCents: 1000,
        feeCoverCents: 50,
        stripePaymentIntentId: "pi_alloc",
        allocationStatus: "pending",
        receiptEmailStatus: "sent",
        createdAt: Date.now(),
      }),
    );

    const balanceBefore = await t.run(async (ctx) => (await ctx.db.get(fundAId))?.balanceCents);

    await t.mutation(internal.functions.finance.jobs.recordAllocation, {
      donationId,
      increaseTransferId: "increase_transfer_abc",
    });

    const donation = await t.run((ctx) => ctx.db.get(donationId));
    expect(donation?.allocationStatus).toBe("allocated");

    const balanceAfter = await t.run(async (ctx) => (await ctx.db.get(fundAId))?.balanceCents);
    expect(balanceAfter).toBe(balanceBefore); // no ledger entry posted — see jobs.ts's design-decision comment

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    const allocatedEvents = auditEvents.filter((e) => e.action === "donation.allocated");
    expect(allocatedEvents).toHaveLength(1);
    expect(JSON.parse(allocatedEvents[0].detailsJson!)).toMatchObject({
      donationId,
      increaseTransferId: "increase_transfer_abc",
      amountCents: 1050,
    });

    // Idempotent retry: calling it again is a no-op, no duplicate audit event.
    await t.mutation(internal.functions.finance.jobs.recordAllocation, {
      donationId,
      increaseTransferId: "increase_transfer_abc",
    });
    const auditEventsAfterRetry = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    expect(
      auditEventsAfterRetry.filter((e) => e.action === "donation.allocated"),
    ).toHaveLength(1);
  });
});

describe("computePendingAllocationCents", () => {
  test("sums pending donation totals per fund, excluding already-allocated donations", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId, fundBId } = await seedJobsFixture(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("donations", {
        fundId: fundAId,
        amountCents: 1000,
        feeCoverCents: 50,
        stripePaymentIntentId: "pi_a1",
        allocationStatus: "pending",
        receiptEmailStatus: "sent",
        createdAt: 1000,
      });
      await ctx.db.insert("donations", {
        fundId: fundAId,
        amountCents: 2000,
        feeCoverCents: 0,
        stripePaymentIntentId: "pi_a2",
        allocationStatus: "pending",
        receiptEmailStatus: "sent",
        createdAt: 2000,
      });
      await ctx.db.insert("donations", {
        fundId: fundAId,
        amountCents: 99999,
        feeCoverCents: 0,
        stripePaymentIntentId: "pi_a3_allocated",
        allocationStatus: "allocated",
        receiptEmailStatus: "sent",
        createdAt: 3000,
      });
      await ctx.db.insert("donations", {
        fundId: fundBId,
        amountCents: 500,
        feeCoverCents: 0,
        stripePaymentIntentId: "pi_b1",
        allocationStatus: "pending",
        receiptEmailStatus: "sent",
        createdAt: 1500,
      });
    });

    const result = await t.mutation(
      internal.functions.finance.jobs.computePendingAllocationCents,
      { communityId },
    );

    const fundAResult = result.find((r) => r.fundId === fundAId);
    const fundBResult = result.find((r) => r.fundId === fundBId);
    expect(fundAResult?.pendingCents).toBe(1050 + 2000);
    expect(fundBResult?.pendingCents).toBe(500);
  });
});

// ============================================================================
// recordReconcileResult (the pure comparison step of runNightlyReconcile)
// ============================================================================

describe("recordReconcileResult", () => {
  test("no audit event when the invariant holds", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedJobsFixture(t);

    const result = await t.mutation(internal.functions.finance.jobs.recordReconcileResult, {
      fundId: fundAId,
      communityId,
      ledgerBalanceCents: 5000,
      bankBalanceCents: 4000,
      pendingAllocationCents: 1000,
    });

    expect(result).toEqual({ ok: true, driftCents: 0 });

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    expect(auditEvents.filter((e) => e.action === "reconcile.drift")).toHaveLength(0);
  });

  test("writes a 'reconcile.drift' audit event when the invariant fails", async () => {
    const t = convexTest(schema, modules);
    const { communityId, fundAId } = await seedJobsFixture(t);

    const result = await t.mutation(internal.functions.finance.jobs.recordReconcileResult, {
      fundId: fundAId,
      communityId,
      ledgerBalanceCents: 5000,
      bankBalanceCents: 4000,
      pendingAllocationCents: 500,
    });

    expect(result).toEqual({ ok: false, driftCents: 500 });

    const auditEvents = await t.run((ctx) =>
      ctx.db
        .query("financeAuditEvents")
        .withIndex("by_fund", (q) => q.eq("fundId", fundAId))
        .collect(),
    );
    const driftEvents = auditEvents.filter((e) => e.action === "reconcile.drift");
    expect(driftEvents).toHaveLength(1);
    expect(JSON.parse(driftEvents[0].detailsJson!)).toMatchObject({
      driftCents: 500,
      ledgerBalanceCents: 5000,
      bankBalanceCents: 4000,
      pendingAllocationCents: 500,
    });
  });
});

// ============================================================================
// buildDonationReceiptEmail (lib/finance/receipts.ts)
// ============================================================================

describe("buildDonationReceiptEmail", () => {
  const baseInput = {
    legalName: "Test Church Inc.",
    ein: "12-3456789",
    donorName: "Donor Giver",
    amountCents: 2500,
    feeCoverCents: 0,
    fundName: "Young Adults Fund",
    dateMs: Date.UTC(2026, 6, 15), // July 15, 2026
  };

  test("includes legal name, EIN, formatted amount, fund, and the required no-goods-or-services sentence", () => {
    const email = buildDonationReceiptEmail(baseInput);

    expect(email.subject).toContain("Test Church Inc.");
    for (const body of [email.text, email.html]) {
      expect(body).toContain("Test Church Inc.");
      expect(body).toContain("12-3456789");
      expect(body).toContain("$25.00");
      expect(body).toContain("Young Adults Fund");
      expect(body).toContain(
        "No goods or services were provided in exchange for this contribution.",
      );
      expect(body).toContain("2026");
    }
  });

  test("omits the fee-cover line when feeCoverCents is 0", () => {
    const email = buildDonationReceiptEmail(baseInput);
    expect(email.text).not.toContain("processing fees");
    expect(email.html).not.toContain("processing fees");
  });

  test("includes a fee-cover line with the correct amount when feeCoverCents > 0, and totals both into the headline amount", () => {
    const email = buildDonationReceiptEmail({ ...baseInput, feeCoverCents: 150 });
    expect(email.text).toContain("processing fees");
    expect(email.text).toContain("$1.50");
    expect(email.html).toContain("processing fees");
    expect(email.html).toContain("$1.50");
    // Headline total is amountCents + feeCoverCents ($25.00 + $1.50 = $26.50).
    expect(email.text).toContain("$26.50");
  });
});
