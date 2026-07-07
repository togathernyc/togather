/**
 * Per-active-user billing activity tests (functions/memberActivity.ts).
 *
 * Covers the billable-member definition (opened the app in THIS community
 * within the past month — per-community membership.lastLogin, not app-wide
 * activity — matching the admin Stats "Active Members" card), the manual
 * inactive flag, placeholder exclusion, and the permissions on manually
 * marking members inactive (community admins + the member's group leaders).
 *
 * Run with: cd apps/convex && pnpm test __tests__/member-activity.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

type Fixture = {
  communityId: Id<"communities">;
  adminId: Id<"users">;
  adminToken: string;
};

/** Community + primary admin who joined recently. */
async function seedCommunity(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  const timestamp = Date.now();
  const { communityId, adminId } = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Billing Church",
      slug: "billing-church",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      phone: "+15555560001",
      phoneVerified: true,
      lastActiveAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLogin: timestamp,
    });
    return { communityId, adminId };
  });
  const { accessToken } = await generateTokens(adminId);
  return { communityId, adminId, adminToken: accessToken };
}

/** Add a member whose join + activity timestamps are `age` ms in the past. */
async function addMember(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  phone: string,
  opts: { age: number; isPlaceholder?: boolean },
): Promise<Id<"users">> {
  const when = Date.now() - opts.age;
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: phone.slice(-4),
      phone,
      phoneVerified: true,
      isPlaceholder: opts.isPlaceholder,
      lastActiveAt: when,
      lastLogin: when,
      createdAt: when,
      updatedAt: when,
    });
    await ctx.db.insert("userCommunities", {
      userId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: when,
      updatedAt: when,
      lastLogin: when,
    });
    return userId;
  });
}

describe("getBillableSummary", () => {
  test("counts recently active real members only", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedCommunity(t);

    await addMember(t, communityId, "+15555560002", { age: 0 }); // active
    await addMember(t, communityId, "+15555560003", { age: ONE_MONTH_MS / 2 }); // active
    await addMember(t, communityId, "+15555560004", { age: ONE_MONTH_MS * 2 }); // dormant
    await addMember(t, communityId, "+15555560005", { age: 0, isPlaceholder: true }); // fake

    const summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    // Admin + the two members who opened the app here this month.
    expect(summary.billableActiveUsers).toBe(3);
    expect(summary.monthlyPriceUsd).toBe(3);
  });

  test("members added but never opened here don't bill, even if just added", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedCommunity(t);

    // Imported/admin-added member: fresh membership, no lastLogin — the
    // billing promise is "opened the app here", so they must not count.
    await t.run(async (ctx) => {
      const nowMs = Date.now();
      const userId = await ctx.db.insert("users", {
        firstName: "Imported",
        lastName: "Member",
        phone: "+15555560030",
        phoneVerified: true,
        createdAt: nowMs,
        updatedAt: nowMs,
      });
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: 1,
        createdAt: nowMs,
        updatedAt: nowMs,
        // no lastLogin
      });
    });

    const summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    expect(summary.billableActiveUsers).toBe(1); // admin only
  });

  test("activity is per community, not app-wide", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedCommunity(t);

    // A user who opened the app TODAY (recent lastActiveAt) but hasn't been
    // in THIS community for months must not be billable here.
    await t.run(async (ctx) => {
      const nowMs = Date.now();
      const monthsAgo = nowMs - ONE_MONTH_MS * 3;
      const userId = await ctx.db.insert("users", {
        firstName: "Elsewhere",
        lastName: "Active",
        phone: "+15555560020",
        phoneVerified: true,
        lastActiveAt: nowMs, // active app-wide…
        lastLogin: nowMs,
        createdAt: monthsAgo,
        updatedAt: nowMs,
      });
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: 1,
        createdAt: monthsAgo,
        updatedAt: monthsAgo,
        lastLogin: monthsAgo, // …but not in this community
      });
    });

    const summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    expect(summary.billableActiveUsers).toBe(1); // admin only
  });

  test("opening the app while in a community refreshes its activity", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedCommunity(t);

    // Long-dormant member whose active community is this one.
    const memberId = await addMember(t, communityId, "+15555560021", {
      age: ONE_MONTH_MS * 3,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(memberId, { activeCommunityId: communityId });
    });

    let summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    expect(summary.billableActiveUsers).toBe(1); // admin only

    // Foregrounding the app stamps the active community's membership.
    const { accessToken: memberToken } = await generateTokens(memberId);
    await t.mutation(api.functions.users.recordActivity, { token: memberToken });

    summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    expect(summary.billableActiveUsers).toBe(2);
  });

  test("an active member always counts — the count is purely automatic", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedCommunity(t);
    await addMember(t, communityId, "+15555560006", { age: 0 });

    // There is no manual override mutation to exclude an active member; the
    // count is purely the automatic 30-day rule. Even a stray billingInactive
    // value left on a row (from before the override was removed) is ignored.
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("userCommunities")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .collect();
      const memberRow = membership.find((m) => m.roles === COMMUNITY_ROLES.MEMBER);
      await ctx.db.patch(memberRow!._id, { billingInactive: true } as never);
    });

    const summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    // admin + the active member — the stale billingInactive flag does nothing.
    expect(summary.billableActiveUsers).toBe(2);
  });
});
