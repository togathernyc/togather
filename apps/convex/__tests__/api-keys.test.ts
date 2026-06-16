/**
 * API Keys + Public Attendance API Tests
 *
 * Covers:
 * - admin/apiKeys: createApiKey, listApiKeys, revokeApiKey (admin gating, the
 *   raw key being returned exactly once, hashing, revocation)
 * - publicApi: verifyApiKey (hash lookup, revoked rejection, lastUsedAt) and
 *   getCommunityAttendanceAggregate (counts, filters, paging)
 *
 * Run with: cd apps/convex && pnpm test __tests__/api-keys.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";
import { hashApiKey, API_KEY_PREFIX } from "../lib/apiKeys";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const COMMUNITY_ROLES = { MEMBER: 1, ADMIN: 3 } as const;

interface TestSetup {
  adminId: Id<"users">;
  memberId: Id<"users">;
  communityId: Id<"communities">;
  dinnerTypeId: Id<"groupTypes">;
  smallGroupTypeId: Id<"groupTypes">;
  dinnerGroupId: Id<"groups">;
  smallGroupId: Id<"groups">;
  adminToken: string;
  memberToken: string;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      email: "admin@test.com",
      phone: "+12025551001",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const memberId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "User",
      email: "member@test.com",
      phone: "+12025551002",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const communityId = await ctx.db.insert("communities", {
      name: "Fount",
      slug: "fount",
      subdomain: "fount",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    const dinnerTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Dinner Parties",
      slug: "dinner-parties",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });
    const smallGroupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      createdAt: now,
      displayOrder: 2,
    });

    const dinnerGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId: dinnerTypeId,
      name: "Tuesday Dinner",
      createdAt: now,
      updatedAt: now,
      isArchived: false,
    });
    const smallGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId: smallGroupTypeId,
      name: "Bible Study",
      createdAt: now,
      updatedAt: now,
      isArchived: false,
    });

    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    return {
      adminId,
      memberId,
      communityId,
      dinnerTypeId,
      smallGroupTypeId,
      dinnerGroupId,
      smallGroupId,
    };
  });

  const [adminTokens, memberTokens] = await Promise.all([
    generateTokens(ids.adminId),
    generateTokens(ids.memberId),
  ]);

  return {
    ...ids,
    adminToken: adminTokens.accessToken,
    memberToken: memberTokens.accessToken,
  };
}

/** Insert a meeting + attendance/guest/rsvp rows. */
async function seedMeeting(
  t: ReturnType<typeof convexTest>,
  opts: {
    communityId: Id<"communities">;
    groupId: Id<"groups">;
    scheduledAt: number;
    status?: string;
    attendedUserIds?: Id<"users">[];
    absentUserIds?: Id<"users">[];
    guestCount?: number;
    rsvps?: { going?: number; notGoing?: number; maybe?: number; goingGuests?: number };
  }
): Promise<Id<"meetings">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const meetingId = await ctx.db.insert("meetings", {
      groupId: opts.groupId,
      communityId: opts.communityId,
      scheduledAt: opts.scheduledAt,
      status: opts.status ?? "completed",
      meetingType: 1,
      createdAt: now,
    });

    for (const userId of opts.attendedUserIds ?? []) {
      await ctx.db.insert("meetingAttendances", {
        meetingId,
        userId,
        status: 1, // attended
        recordedAt: now,
      });
    }
    for (const userId of opts.absentUserIds ?? []) {
      await ctx.db.insert("meetingAttendances", {
        meetingId,
        userId,
        status: 0, // did not attend
        recordedAt: now,
      });
    }
    for (let i = 0; i < (opts.guestCount ?? 0); i++) {
      await ctx.db.insert("meetingGuests", {
        meetingId,
        firstName: `Guest${i}`,
        recordedAt: now,
      });
    }

    const rsvps = opts.rsvps ?? {};
    let cursor = 0;
    const insertRsvps = async (count: number, optionId: number, guestCount?: number) => {
      for (let i = 0; i < count; i++) {
        const userId = await ctx.db.insert("users", {
          firstName: `R${optionId}-${cursor++}`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("meetingRsvps", {
          meetingId,
          userId,
          rsvpOptionId: optionId,
          guestCount,
          createdAt: now,
          updatedAt: now,
        });
      }
    };
    await insertRsvps(rsvps.going ?? 0, 1, rsvps.goingGuests);
    await insertRsvps(rsvps.notGoing ?? 0, 2);
    await insertRsvps(rsvps.maybe ?? 0, 3);

    return meetingId;
  });
}

// ============================================================================
// Key helpers
// ============================================================================

describe("api key helpers", () => {
  test("generateApiKey produces unique tgk_ prefixed keys, hashApiKey is deterministic", async () => {
    const { generateApiKey } = await import("../lib/apiKeys");
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.raw.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a.raw).not.toEqual(b.raw);
    expect(a.prefix).toBe(a.raw.slice(0, API_KEY_PREFIX.length + 8));

    const h1 = await hashApiKey(a.raw);
    const h2 = await hashApiKey(a.raw);
    expect(h1).toEqual(h2);
    expect(h1).not.toEqual(await hashApiKey(b.raw));
    expect(h1).not.toContain(a.raw); // hash must not embed the raw key
  });
});

// ============================================================================
// Admin CRUD
// ============================================================================

describe("admin api key management", () => {
  test("createApiKey returns the raw key once and stores only a hash", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const created = await t.mutation(api.functions.admin.apiKeys.createApiKey, {
      token: s.adminToken,
      communityId: s.communityId,
      name: "Fount Attendance Dashboard",
    });

    expect(created.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(created.keyPrefix).toBe(created.key.slice(0, API_KEY_PREFIX.length + 8));

    // The stored row must hold a hash, never the raw key.
    const stored = await t.run(async (ctx) => ctx.db.get(created.id));
    expect(stored?.keyHash).toBe(await hashApiKey(created.key));
    expect(stored?.keyHash).not.toBe(created.key);

    // The list view never exposes the raw key or hash.
    const list = await t.query(api.functions.admin.apiKeys.listApiKeys, {
      token: s.adminToken,
      communityId: s.communityId,
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "Fount Attendance Dashboard",
      keyPrefix: created.keyPrefix,
      isActive: true,
      createdByName: "Admin User",
    });
    expect(JSON.stringify(list[0])).not.toContain(created.key);
  });

  test("createApiKey rejects an empty name", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.mutation(api.functions.admin.apiKeys.createApiKey, {
        token: s.adminToken,
        communityId: s.communityId,
        name: "   ",
      })
    ).rejects.toThrow();
  });

  test("non-admins cannot create, list, or revoke keys", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await expect(
      t.mutation(api.functions.admin.apiKeys.createApiKey, {
        token: s.memberToken,
        communityId: s.communityId,
        name: "nope",
      })
    ).rejects.toThrow();

    await expect(
      t.query(api.functions.admin.apiKeys.listApiKeys, {
        token: s.memberToken,
        communityId: s.communityId,
      })
    ).rejects.toThrow();
  });

  test("revokeApiKey disables the key and is reflected in the list", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const created = await t.mutation(api.functions.admin.apiKeys.createApiKey, {
      token: s.adminToken,
      communityId: s.communityId,
      name: "Temp Key",
    });

    await t.mutation(api.functions.admin.apiKeys.revokeApiKey, {
      token: s.adminToken,
      communityId: s.communityId,
      keyId: created.id,
    });

    const list = await t.query(api.functions.admin.apiKeys.listApiKeys, {
      token: s.adminToken,
      communityId: s.communityId,
    });
    expect(list[0].isActive).toBe(false);
    expect(list[0].revokedAt).not.toBeNull();
  });
});

// ============================================================================
// verifyApiKey (internal)
// ============================================================================

describe("verifyApiKey", () => {
  test("verifies an active key, records lastUsedAt, and returns its community", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const created = await t.mutation(api.functions.admin.apiKeys.createApiKey, {
      token: s.adminToken,
      communityId: s.communityId,
      name: "Dashboard",
    });

    const verified = await t.mutation(internal.functions.publicApi.verifyApiKey, {
      keyHash: await hashApiKey(created.key),
    });
    expect(verified).toEqual({ communityId: s.communityId });

    const stored = await t.run(async (ctx) => ctx.db.get(created.id));
    expect(stored?.lastUsedAt).toBeTypeOf("number");
  });

  test("rejects unknown and revoked keys", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    expect(
      await t.mutation(internal.functions.publicApi.verifyApiKey, {
        keyHash: await hashApiKey("tgk_does-not-exist"),
      })
    ).toBeNull();

    const created = await t.mutation(api.functions.admin.apiKeys.createApiKey, {
      token: s.adminToken,
      communityId: s.communityId,
      name: "Soon Revoked",
    });
    await t.mutation(api.functions.admin.apiKeys.revokeApiKey, {
      token: s.adminToken,
      communityId: s.communityId,
      keyId: created.id,
    });

    expect(
      await t.mutation(internal.functions.publicApi.verifyApiKey, {
        keyHash: await hashApiKey(created.key),
      })
    ).toBeNull();
  });
});

// ============================================================================
// getCommunityAttendanceAggregate (internal)
// ============================================================================

describe("getCommunityAttendanceAggregate", () => {
  const DAY = 24 * 60 * 60 * 1000;

  test("aggregates attendance, guests, and rsvp counts per event", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: Date.now() - DAY,
      attendedUserIds: [s.adminId, s.memberId],
      absentUserIds: [], // status 0 should not count toward attended
      guestCount: 3,
      // 4 "going" RSVPs, each bringing 5 plus-ones -> guestsExpected sums to 20.
      rsvps: { going: 4, notGoing: 1, maybe: 2, goingGuests: 5 },
    });

    const result = await t.query(
      internal.functions.publicApi.getCommunityAttendanceAggregate,
      { communityId: s.communityId }
    );

    expect(result.community).toMatchObject({ name: "Fount", subdomain: "fount" });
    expect(result.events).toHaveLength(1);
    const event = result.events[0] as any;
    expect(event.group.name).toBe("Tuesday Dinner");
    expect(event.group.groupTypeSlug).toBe("dinner-parties");
    expect(event.attendance).toEqual({
      attended: 2,
      guests: 3,
      rsvps: { going: 4, notGoing: 1, maybe: 2, guestsExpected: 20 },
    });
  });

  test("only counts status===1 toward attended", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: Date.now(),
      attendedUserIds: [s.adminId],
      absentUserIds: [s.memberId],
    });

    const result = await t.query(
      internal.functions.publicApi.getCommunityAttendanceAggregate,
      { communityId: s.communityId }
    );
    expect((result.events[0] as any).attendance.attended).toBe(1);
  });

  test("filters by group type slug", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: Date.now() - DAY,
      attendedUserIds: [s.adminId],
    });
    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.smallGroupId,
      scheduledAt: Date.now(),
      attendedUserIds: [s.memberId],
    });

    const dinnersOnly = await t.query(
      internal.functions.publicApi.getCommunityAttendanceAggregate,
      { communityId: s.communityId, groupTypeSlug: "dinner-parties" }
    );
    expect(dinnersOnly.events).toHaveLength(1);
    expect((dinnersOnly.events[0] as any).group.groupTypeSlug).toBe("dinner-parties");

    const unknownType = await t.query(
      internal.functions.publicApi.getCommunityAttendanceAggregate,
      { communityId: s.communityId, groupTypeSlug: "does-not-exist" }
    );
    expect(unknownType.events).toHaveLength(0);
  });

  test("filters by meeting status and date range", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const old = Date.now() - 10 * DAY;
    const recent = Date.now() - DAY;

    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: old,
      status: "completed",
    });
    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: recent,
      status: "cancelled",
    });

    const completedOnly = await t.query(
      internal.functions.publicApi.getCommunityAttendanceAggregate,
      { communityId: s.communityId, status: "completed" }
    );
    expect(completedOnly.events).toHaveLength(1);
    expect((completedOnly.events[0] as any).status).toBe("completed");

    const sinceRecent = await t.query(
      internal.functions.publicApi.getCommunityAttendanceAggregate,
      { communityId: s.communityId, since: recent - 1 }
    );
    expect(sinceRecent.events).toHaveLength(1);
    expect((sinceRecent.events[0] as any).scheduledAt).toBe(
      new Date(recent).toISOString()
    );
  });

  test("respects limit and reports hasMore, newest first", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const base = Date.now() - 30 * DAY;
    for (let i = 0; i < 3; i++) {
      await seedMeeting(t, {
        communityId: s.communityId,
        groupId: s.dinnerGroupId,
        scheduledAt: base + i * DAY,
      });
    }

    const limited = await t.query(
      internal.functions.publicApi.getCommunityAttendanceAggregate,
      { communityId: s.communityId, limit: 2 }
    );
    expect(limited.events).toHaveLength(2);
    expect(limited.hasMore).toBe(true);
    // Newest first.
    const first = limited.events[0] as any;
    const second = limited.events[1] as any;
    expect(new Date(first.scheduledAt).getTime()).toBeGreaterThan(
      new Date(second.scheduledAt).getTime()
    );

    const all = await t.query(
      internal.functions.publicApi.getCommunityAttendanceAggregate,
      { communityId: s.communityId, limit: 50 }
    );
    expect(all.events).toHaveLength(3);
    expect(all.hasMore).toBe(false);
  });
});

// ============================================================================
// getCommunityAttendanceSummary (internal)
// ============================================================================

describe("getCommunityAttendanceSummary", () => {
  test("rolls up multiple events for the same group+day into one row", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // Two dinner events on the same local day (2026-06-10, America/New_York).
    const morning = Date.UTC(2026, 5, 10, 18, 0, 0); // 14:00 ET
    const evening = Date.UTC(2026, 5, 10, 23, 0, 0); // 19:00 ET (same ET day)
    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: morning,
      attendedUserIds: [s.adminId],
      guestCount: 1,
      rsvps: { going: 2 },
    });
    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: evening,
      attendedUserIds: [s.memberId],
      rsvps: { going: 1, maybe: 1 },
    });
    // A small-group event on a different day.
    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.smallGroupId,
      scheduledAt: Date.UTC(2026, 5, 12, 18, 0, 0),
      attendedUserIds: [s.adminId],
    });

    const result = await t.query(
      internal.functions.publicApi.getCommunityAttendanceSummary,
      { communityId: s.communityId }
    );

    expect(result.timezone).toBe("America/New_York");
    expect(result.bucket).toBe("day");
    expect(result.truncated).toBe(false);
    expect(result.summary).toHaveLength(2);

    const dinnerRow = result.summary.find(
      (r: any) => r.groupTypeSlug === "dinner-parties"
    ) as any;
    expect(dinnerRow.date).toBe("2026-06-10");
    expect(dinnerRow.events).toBe(2);
    expect(dinnerRow.attended).toBe(2);
    expect(dinnerRow.guests).toBe(1);
    expect(dinnerRow.rsvps).toEqual({
      going: 3,
      notGoing: 0,
      maybe: 1,
      guestsExpected: 0,
    });

    // Newest day first.
    expect((result.summary[0] as any).date).toBe("2026-06-12");
  });

  test("buckets by the community's local date, not UTC", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    // 2026-06-11 01:00 UTC == 2026-06-10 21:00 in America/New_York.
    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: Date.UTC(2026, 5, 11, 1, 0, 0),
      attendedUserIds: [s.adminId],
    });

    const result = await t.query(
      internal.functions.publicApi.getCommunityAttendanceSummary,
      { communityId: s.communityId }
    );

    expect(result.summary).toHaveLength(1);
    // Local ET date, not the UTC date (which would be 2026-06-11).
    expect((result.summary[0] as any).date).toBe("2026-06-10");
  });

  test("filters by group type", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.dinnerGroupId,
      scheduledAt: Date.UTC(2026, 5, 10, 18, 0, 0),
      attendedUserIds: [s.adminId],
    });
    await seedMeeting(t, {
      communityId: s.communityId,
      groupId: s.smallGroupId,
      scheduledAt: Date.UTC(2026, 5, 10, 18, 0, 0),
      attendedUserIds: [s.memberId],
    });

    const dinners = await t.query(
      internal.functions.publicApi.getCommunityAttendanceSummary,
      { communityId: s.communityId, groupTypeSlug: "dinner-parties" }
    );
    expect(dinners.summary).toHaveLength(1);
    expect((dinners.summary[0] as any).groupTypeSlug).toBe("dinner-parties");

    const unknown = await t.query(
      internal.functions.publicApi.getCommunityAttendanceSummary,
      { communityId: s.communityId, groupTypeSlug: "nope" }
    );
    expect(unknown.summary).toHaveLength(0);
  });
});
