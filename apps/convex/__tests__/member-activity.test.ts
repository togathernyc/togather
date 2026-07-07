/**
 * Per-active-user billing activity tests (functions/memberActivity.ts).
 *
 * Covers the billable-member definition (6-month activity window, manual
 * inactive flag, placeholder exclusion) and the permissions on manually
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

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

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
    await addMember(t, communityId, "+15555560003", { age: SIX_MONTHS_MS / 2 }); // active
    await addMember(t, communityId, "+15555560004", { age: SIX_MONTHS_MS * 2 }); // dormant
    await addMember(t, communityId, "+15555560005", { age: 0, isPlaceholder: true }); // fake

    const summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    // Admin + the two members active within 6 months.
    expect(summary.billableActiveUsers).toBe(3);
    expect(summary.monthlyPriceUsd).toBe(3);
  });

  test("manually marked inactive members are excluded until re-activated", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedCommunity(t);
    const memberId = await addMember(t, communityId, "+15555560006", { age: 0 });

    await t.mutation(api.functions.memberActivity.setMemberBillingActive, {
      token: adminToken,
      communityId,
      targetUserId: memberId,
      active: false,
    });
    let summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    expect(summary.billableActiveUsers).toBe(1); // admin only

    await t.mutation(api.functions.memberActivity.setMemberBillingActive, {
      token: adminToken,
      communityId,
      targetUserId: memberId,
      active: true,
    });
    summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    expect(summary.billableActiveUsers).toBe(2);
  });
});

describe("setMemberBillingActive permissions", () => {
  test("a plain member cannot mark others inactive", async () => {
    const t = convexTest(schema, modules);
    const { communityId } = await seedCommunity(t);
    const memberA = await addMember(t, communityId, "+15555560007", { age: 0 });
    const memberB = await addMember(t, communityId, "+15555560008", { age: 0 });

    const { accessToken } = await generateTokens(memberA);
    await expect(
      t.mutation(api.functions.memberActivity.setMemberBillingActive, {
        token: accessToken,
        communityId,
        targetUserId: memberB,
        active: false,
      }),
    ).rejects.toThrow("group leaders");
  });

  test("a group leader can mark their group's members inactive", async () => {
    const t = convexTest(schema, modules);
    const { communityId, adminToken } = await seedCommunity(t);
    const leaderId = await addMember(t, communityId, "+15555560009", { age: 0 });
    const memberId = await addMember(t, communityId, "+15555560010", { age: 0 });
    const outsiderId = await addMember(t, communityId, "+15555560011", { age: 0 });

    await t.run(async (ctx) => {
      const timestamp = Date.now();
      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId,
        name: "Small Groups",
        slug: "small-groups",
        isActive: true,
        displayOrder: 1,
        createdAt: timestamp,
      });
      const groupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Alpha Group",
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: leaderId,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: memberId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    });

    const { accessToken: leaderToken } = await generateTokens(leaderId);

    // Leader can manage a member of their group…
    await t.mutation(api.functions.memberActivity.setMemberBillingActive, {
      token: leaderToken,
      communityId,
      targetUserId: memberId,
      active: false,
    });
    const summary = await t.query(api.functions.memberActivity.getBillableSummary, {
      token: adminToken,
      communityId,
    });
    // admin + leader + outsider (member marked inactive)
    expect(summary.billableActiveUsers).toBe(3);

    // …but not someone outside their group.
    await expect(
      t.mutation(api.functions.memberActivity.setMemberBillingActive, {
        token: leaderToken,
        communityId,
        targetUserId: outsiderId,
        active: false,
      }),
    ).rejects.toThrow("group leaders");
  });
});
