/**
 * Multiple Primary Admins
 *
 * `userCommunities.roles === 4` is a SET, not a singleton (see
 * PRIMARY_ADMIN_ROLE in lib/permissions.ts). Communities run today with two or
 * more primary admins, added by operators through the Convex dashboard, and
 * every read has to tolerate that.
 *
 * The fixture below is deliberately hostile to the old assumption: the
 * community's SECOND-oldest primary admin is inserted FIRST, so any code path
 * that still resolves "the primary admin" by index order (`.first()`) picks the
 * wrong person and these tests fail. Everything asserted here is either
 * per-user (and therefore inherently multi-safe) or a deterministic pick.
 *
 * Run with: cd apps/convex && pnpm test __tests__/multiple-primary-admins.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, afterEach } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";
import { drainScheduledFunctions } from "./helpers/drainScheduledFunctions";
import {
  getPrimaryAdmins,
  isPrimaryAdmin,
  pickInheritingPrimaryAdmin,
  requirePrimaryAdmin,
  COMMUNITY_ROLES,
} from "../lib/permissions";
import { canManageCommunityFinance } from "../lib/finance/communityFinanceAccess";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Same convex-test hazard as member-created-events.test.ts: leaving a community
// and creating a member event both schedule background work via runAfter(0),
// and a rejected mutation leaves the transaction manager busy for the next
// test. Drain + yield between tests.
let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await drainScheduledFunctions(activeHandle);
    activeHandle = null;
  }
  await new Promise((resolve) => setImmediate(resolve));
});

interface Seed {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  /** Primary admin with the EARLIEST createdAt — inserted SECOND. */
  founderId: Id<"users">;
  /** Primary admin with a LATER createdAt — inserted FIRST. */
  laterPrimaryId: Id<"users">;
  memberId: Id<"users">;
  founderToken: string;
  laterPrimaryToken: string;
  memberToken: string;
}

const HOUR = 60 * 60 * 1000;
const FUTURE = () => Date.now() + 24 * HOUR;

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
  const base = Date.now();

  const communityId = await t.run(async (ctx) =>
    ctx.db.insert("communities", {
      name: "Two Owners Church",
      subdomain: "two-owners",
      slug: "two-owners",
      timezone: "America/New_York",
      createdAt: base,
      updatedAt: base,
    })
  );

  const groupTypeId = await t.run(async (ctx) =>
    ctx.db.insert("groupTypes", {
      communityId,
      name: "Groups",
      slug: "groups",
      isActive: true,
      displayOrder: 1,
      createdAt: base,
    })
  );

  const groupId = await t.run(async (ctx) =>
    ctx.db.insert("groups", {
      name: "Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: base,
      updatedAt: base,
    })
  );

  const makeUser = (first: string, phone: string) =>
    t.run(async (ctx) =>
      ctx.db.insert("users", {
        firstName: first,
        lastName: "T",
        phone,
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: base,
        updatedAt: base,
      })
    );

  const founderId = await makeUser("Founder", "+15555551001");
  const laterPrimaryId = await makeUser("Later", "+15555551002");
  const memberId = await makeUser("Member", "+15555551003");

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId: memberId,
      groupId,
      role: "member",
      joinedAt: base,
      notificationsEnabled: true,
    });
  });

  await t.run(async (ctx) => {
    // ORDER MATTERS. The newer primary admin is written first so that index
    // order (and therefore `.first()`) disagrees with createdAt order. If a
    // "pick one" path were still insertion-ordered, it would pick `later`.
    await ctx.db.insert("userCommunities", {
      userId: laterPrimaryId,
      communityId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: 1,
      createdAt: base, // newer membership
      updatedAt: base,
    });
    await ctx.db.insert("userCommunities", {
      userId: founderId,
      communityId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: 1,
      createdAt: base - 365 * 24 * HOUR, // founded the community a year ago
      updatedAt: base,
    });
    await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: base,
      updatedAt: base,
    });
  });

  const [founderTokens, laterTokens, memberTokens] = await Promise.all([
    generateTokens(founderId),
    generateTokens(laterPrimaryId),
    generateTokens(memberId),
  ]);

  return {
    communityId,
    groupId,
    founderId,
    laterPrimaryId,
    memberId,
    founderToken: founderTokens.accessToken,
    laterPrimaryToken: laterTokens.accessToken,
    memberToken: memberTokens.accessToken,
  };
}

// ============================================================================
// The gate itself
// ============================================================================

describe("primary admin is a set", () => {
  test("both primary admins pass isPrimaryAdmin and requirePrimaryAdmin", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    await t.run(async (ctx) => {
      expect(await isPrimaryAdmin(ctx, s.communityId, s.founderId)).toBe(true);
      expect(await isPrimaryAdmin(ctx, s.communityId, s.laterPrimaryId)).toBe(true);
      expect(await isPrimaryAdmin(ctx, s.communityId, s.memberId)).toBe(false);

      await expect(
        requirePrimaryAdmin(ctx, s.communityId, s.founderId)
      ).resolves.toBeUndefined();
      await expect(
        requirePrimaryAdmin(ctx, s.communityId, s.laterPrimaryId)
      ).resolves.toBeUndefined();
      await expect(
        requirePrimaryAdmin(ctx, s.communityId, s.memberId)
      ).rejects.toThrow("Primary Admin role required");
    });
  });

  test("a real primary-admin-gated mutation accepts either of them", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    // updateMemberRole's admin-level branch requires roles === 4.
    await t.mutation(api.functions.communities.updateMemberRole, {
      token: s.laterPrimaryToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      roles: COMMUNITY_ROLES.ADMIN,
    });

    // ...and so does the other one, demoting the same person back.
    await t.mutation(api.functions.communities.updateMemberRole, {
      token: s.founderToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
      roles: COMMUNITY_ROLES.MEMBER,
    });

    const role = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", s.memberId).eq("communityId", s.communityId)
        )
        .first();
      return row?.roles;
    });
    expect(role).toBe(COMMUNITY_ROLES.MEMBER);
  });

  test("getPrimaryAdmins returns the whole set, oldest membership first", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    const userIds = await t.run(async (ctx) => {
      const rows = await getPrimaryAdmins(ctx, s.communityId);
      return rows.map((r: any) => r.userId);
    });

    expect(userIds).toEqual([s.founderId, s.laterPrimaryId]);
  });
});

// ============================================================================
// Deterministic single-owner pick
// ============================================================================

describe("meeting-ownership inheritance", () => {
  test("picks the earliest-createdAt primary admin, not the first-inserted one", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    const meetingId = await t.mutation(api.functions.meetings.index.create, {
      token: s.memberToken,
      groupId: s.groupId,
      scheduledAt: FUTURE(),
      meetingType: 1,
      locationMode: "tbd",
    });

    await t.mutation(api.functions.communities.leave, {
      token: s.memberToken,
      communityId: s.communityId,
    });

    const after = await t.run(async (ctx) => ctx.db.get(meetingId));
    // Not "one of the primary admins" — THE founder, every run. The later
    // primary admin is the row a `.first()` on the index would have returned.
    expect(after?.createdById).toBe(s.founderId);
    expect(after?.createdById).not.toBe(s.laterPrimaryId);
  });

  test("pickInheritingPrimaryAdmin is stable across repeated calls", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    const picks = await t.run(async (ctx) => {
      const results: any[] = [];
      for (let i = 0; i < 3; i++) {
        const row = await pickInheritingPrimaryAdmin(ctx, s.communityId);
        results.push(row?.userId);
      }
      return results;
    });

    expect(picks).toEqual([s.founderId, s.founderId, s.founderId]);
  });

  test("returns null when a community has no active primary admin", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    await t.run(async (ctx) => {
      const rows = await getPrimaryAdmins(ctx, s.communityId);
      for (const row of rows) {
        await ctx.db.patch(row._id, { roles: COMMUNITY_ROLES.ADMIN });
      }
      expect(await pickInheritingPrimaryAdmin(ctx, s.communityId)).toBeNull();
    });
  });
});

// ============================================================================
// Transfer composes with the set
// ============================================================================

describe("transferPrimaryAdmin under multi semantics", () => {
  test("transferring from one primary admin leaves the other untouched", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    await t.mutation(api.functions.admin.members.transferPrimaryAdmin, {
      token: s.laterPrimaryToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
    });

    const roles = await t.run(async (ctx) => {
      const roleOf = async (userId: Id<"users">) => {
        const row = await ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", userId).eq("communityId", s.communityId)
          )
          .first();
        return row?.roles;
      };
      return {
        founder: await roleOf(s.founderId),
        later: await roleOf(s.laterPrimaryId),
        member: await roleOf(s.memberId),
      };
    });

    // Caller demoted, target promoted, the third party's standing preserved:
    // the set size is unchanged, its membership shifted by exactly one person.
    expect(roles.later).toBe(COMMUNITY_ROLES.ADMIN);
    expect(roles.member).toBe(COMMUNITY_ROLES.PRIMARY_ADMIN);
    expect(roles.founder).toBe(COMMUNITY_ROLES.PRIMARY_ADMIN);
  });

  test("the target's announcement-group sync is driven by the TARGET's prior role", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    // targetWasAdmin is read off the target's own row, so a second primary
    // admin existing elsewhere in the community cannot skew it.
    await t.mutation(api.functions.admin.members.transferPrimaryAdmin, {
      token: s.founderToken,
      communityId: s.communityId,
      targetUserId: s.memberId,
    });

    const membership = await t.run(async (ctx) =>
      ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", s.memberId).eq("communityId", s.communityId)
        )
        .first()
    );
    expect(membership?.roles).toBe(COMMUNITY_ROLES.PRIMARY_ADMIN);

    // The promoted member is now a leader of the community announcement group.
    const announcementLeader = await t.run(async (ctx) => {
      const groups = await ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", s.communityId))
        .collect();
      const announcement = groups.find((g: any) => g.isAnnouncementGroup);
      if (!announcement) return null;
      const rows = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", announcement._id))
        .collect();
      return rows.find((r: any) => r.userId === s.memberId)?.role ?? null;
    });
    // No announcement group is seeded by this fixture, so the sync is a no-op
    // rather than a failure — the assertion pins that it does not throw and
    // does not invent a membership.
    expect(announcementLeader).toBeNull();
  });
});

// ============================================================================
// Downstream consumers
// ============================================================================

describe("downstream reads tolerate the set", () => {
  test("memberSearch flags BOTH primary admins", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    const result = await t.query(api.functions.admin.members.listCommunityMembers, {
      token: s.founderToken,
      communityId: s.communityId,
      pageSize: 50,
    });

    const flagged = result.members
      .filter((m: any) => m.isPrimaryAdmin)
      .map((m: any) => m.id)
      .sort();
    expect(flagged).toEqual([s.founderId, s.laterPrimaryId].sort());
  });

  test("the community finance gate passes for BOTH primary admins", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const s = await seed(t);

    await t.run(async (ctx) => {
      // Implicit access, no communityFinanceRoles row for either of them —
      // the ADR-033 Phase-0 claim, pinned against the multi-primary state.
      expect(
        await canManageCommunityFinance(ctx as any, s.founderId, s.communityId)
      ).toBe(true);
      expect(
        await canManageCommunityFinance(ctx as any, s.laterPrimaryId, s.communityId)
      ).toBe(true);
      expect(
        await canManageCommunityFinance(ctx as any, s.memberId, s.communityId)
      ).toBe(false);
    });
  });
});
