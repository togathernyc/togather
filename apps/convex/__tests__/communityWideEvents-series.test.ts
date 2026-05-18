/**
 * Community-Wide Event Series Tests
 *
 * Tests for creating and managing community-wide event series,
 * including per-group eventSeries records, multi-date series creation,
 * scoped cancel, and scoped update.
 *
 * Run with: cd apps/convex && pnpm test __tests__/communityWideEvents-series.test.ts
 */

import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

// Mock the jose library to bypass JWT verification in tests
vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) throw new Error("Invalid token");
    return { payload: { userId: match[1], type: "access" } };
  }),
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock-signed-token"),
  })),
  decodeJwt: vi.fn((token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) return null;
    return { userId: match[1], type: "access" };
  }),
}));

import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

beforeEach(() => {
  vi.useFakeTimers();
  // Pin "now" well before every date these tests use, so series occurrences
  // are deterministically in the future regardless of the machine clock.
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Test Setup Helper
// ============================================================================

interface CommunityWideTestSetup {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  adminId: Id<"users">;
  nonAdminId: Id<"users">;
  adminToken: string;
  nonAdminToken: string;
  groupId1: Id<"groups">;
  groupId2: Id<"groups">;
  groupId3: Id<"groups">;
}

async function setupCommunityWideTestData(
  t: ReturnType<typeof convexTest>
): Promise<CommunityWideTestSetup> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();

    // Create community
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create group type
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Dinner Parties",
      slug: "dinner-parties",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });

    // Create admin user
    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      email: "admin@test.com",
      phone: "+12025551001",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Admin community membership (roles: 3 = admin, status: 1 = active)
    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: 3,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create non-admin user
    const nonAdminId = await ctx.db.insert("users", {
      firstName: "Regular",
      lastName: "User",
      email: "regular@test.com",
      phone: "+12025551002",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Non-admin community membership (roles: 1 = member, status: 1 = active)
    await ctx.db.insert("userCommunities", {
      userId: nonAdminId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create 3 active groups of the same type
    const groupId1 = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group Alpha",
      description: "First dinner group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupId2 = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group Beta",
      description: "Second dinner group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupId3 = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group Gamma",
      description: "Third dinner group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Admin is a leader of group1
    await ctx.db.insert("groupMembers", {
      groupId: groupId1,
      userId: adminId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    return {
      communityId,
      groupTypeId,
      adminId,
      nonAdminId,
      adminToken: `test-token-${adminId}`,
      nonAdminToken: `test-token-${nonAdminId}`,
      groupId1,
      groupId2,
      groupId3,
    };
  });
}

// ============================================================================
// communityWideEvents.create with seriesName
// ============================================================================

describe("communityWideEvents.create with seriesName", () => {
  test("creates per-group series when seriesName provided", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const tomorrow = Date.now() + 86400000;

    const result = await t.mutation(api.functions.communityWideEvents.create, {
      token: setup.adminToken,
      communityId: setup.communityId,
      groupTypeId: setup.groupTypeId,
      title: "Dinner",
      scheduledAt: tomorrow,
      meetingType: 1,
      seriesName: "Weekly Dinner",
    });

    // Verify communityWideEvent record created
    expect(result.communityWideEventId).toBeDefined();

    // Verify 3 meetings created (one per group)
    expect(result.meetingsCreated).toBe(3);

    // For each group, verify an eventSeries record exists with name "Weekly Dinner"
    await t.run(async (ctx) => {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", result.communityWideEventId)
        )
        .collect();

      expect(meetings).toHaveLength(3);

      const groupIds = new Set(meetings.map((m) => m.groupId));
      expect(groupIds.size).toBe(3);
      expect(groupIds.has(setup.groupId1)).toBe(true);
      expect(groupIds.has(setup.groupId2)).toBe(true);
      expect(groupIds.has(setup.groupId3)).toBe(true);

      // Each group should have an eventSeries with the correct name
      for (const gid of [setup.groupId1, setup.groupId2, setup.groupId3]) {
        const seriesList = await ctx.db
          .query("eventSeries")
          .withIndex("by_group", (q) => q.eq("groupId", gid))
          .collect();

        expect(seriesList).toHaveLength(1);
        expect(seriesList[0].name).toBe("Weekly Dinner");
        expect(seriesList[0].status).toBe("active");
      }

      // Each meeting should have both communityWideEventId and seriesId
      for (const meeting of meetings) {
        expect(meeting.communityWideEventId).toBe(result.communityWideEventId);
        expect(meeting.seriesId).toBeDefined();
      }
    });
  });

  test("does NOT create series when seriesName omitted", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const tomorrow = Date.now() + 86400000;

    const result = await t.mutation(api.functions.communityWideEvents.create, {
      token: setup.adminToken,
      communityId: setup.communityId,
      groupTypeId: setup.groupTypeId,
      title: "One-off Dinner",
      scheduledAt: tomorrow,
      meetingType: 1,
    });

    expect(result.meetingsCreated).toBe(3);

    await t.run(async (ctx) => {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", result.communityWideEventId)
        )
        .collect();

      // seriesId should be undefined on all meetings
      for (const meeting of meetings) {
        expect(meeting.seriesId).toBeUndefined();
      }

      // No eventSeries records should be created for any group
      for (const gid of [setup.groupId1, setup.groupId2, setup.groupId3]) {
        const seriesList = await ctx.db
          .query("eventSeries")
          .withIndex("by_group", (q) => q.eq("groupId", gid))
          .collect();

        expect(seriesList).toHaveLength(0);
      }
    });
  });

  test("find-or-create reuses existing series", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const tomorrow = Date.now() + 86400000;

    // Manually insert an eventSeries for group1 with name "Weekly Dinner"
    let existingSeriesId: Id<"eventSeries">;
    await t.run(async (ctx) => {
      existingSeriesId = await ctx.db.insert("eventSeries", {
        groupId: setup.groupId1,
        createdById: setup.adminId,
        name: "Weekly Dinner",
        status: "active",
        createdAt: Date.now(),
      });
    });

    const result = await t.mutation(api.functions.communityWideEvents.create, {
      token: setup.adminToken,
      communityId: setup.communityId,
      groupTypeId: setup.groupTypeId,
      title: "Dinner",
      scheduledAt: tomorrow,
      meetingType: 1,
      seriesName: "Weekly Dinner",
    });

    expect(result.meetingsCreated).toBe(3);

    await t.run(async (ctx) => {
      const meetings = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", result.communityWideEventId)
        )
        .collect();

      // group1's meeting should use the EXISTING seriesId
      const group1Meeting = meetings.find((m) => m.groupId === setup.groupId1);
      expect(group1Meeting).toBeDefined();
      expect(group1Meeting!.seriesId).toBe(existingSeriesId!);

      // group2 and group3 should get NEW eventSeries records
      const group2Meeting = meetings.find((m) => m.groupId === setup.groupId2);
      const group3Meeting = meetings.find((m) => m.groupId === setup.groupId3);
      expect(group2Meeting!.seriesId).toBeDefined();
      expect(group3Meeting!.seriesId).toBeDefined();
      expect(group2Meeting!.seriesId).not.toBe(existingSeriesId!);
      expect(group3Meeting!.seriesId).not.toBe(existingSeriesId!);

      // group1 should still only have 1 eventSeries (the existing one)
      const group1Series = await ctx.db
        .query("eventSeries")
        .withIndex("by_group", (q) => q.eq("groupId", setup.groupId1))
        .collect();
      expect(group1Series).toHaveLength(1);
      expect(group1Series[0]._id).toBe(existingSeriesId!);
    });
  });
});

// ============================================================================
// communityWideEvents.createSeries
// ============================================================================

describe("communityWideEvents.createSeries", () => {
  test("creates N communityWideEvents and NxM meetings", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const april10 = new Date("2026-04-10T18:00:00Z").getTime();
    const april17 = new Date("2026-04-17T18:00:00Z").getTime();
    const april24 = new Date("2026-04-24T18:00:00Z").getTime();

    const result = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "April Dinners",
        dates: [april10, april17, april24],
        title: "April Dinner",
        meetingType: 1,
      }
    );

    // Should return 3 communityWideEventIds and totalMeetingsCreated = 9
    expect(result.communityWideEventIds).toHaveLength(3);
    expect(result.totalMeetingsCreated).toBe(9);

    await t.run(async (ctx) => {
      // Verify 3 communityWideEvent records in DB
      for (const cweId of result.communityWideEventIds) {
        const cwe = await ctx.db.get(cweId);
        expect(cwe).not.toBeNull();
        expect(cwe!.status).toBe("scheduled");
      }

      // Verify 9 meetings total across all communityWideEvents
      let allMeetings: any[] = [];
      for (const cweId of result.communityWideEventIds) {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_communityWideEvent", (q) =>
            q.eq("communityWideEventId", cweId)
          )
          .collect();
        allMeetings.push(...meetings);
      }
      expect(allMeetings).toHaveLength(9);

      // Each meeting has both communityWideEventId and seriesId
      for (const meeting of allMeetings) {
        expect(meeting.communityWideEventId).toBeDefined();
        expect(meeting.seriesId).toBeDefined();
      }
    });
  });

  test("creates one eventSeries per group, not per date", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();
    const date3 = new Date("2026-04-24T18:00:00Z").getTime();

    await t.mutation(api.functions.communityWideEvents.createSeries, {
      token: setup.adminToken,
      communityId: setup.communityId,
      groupTypeId: setup.groupTypeId,
      seriesName: "Weekly Dinner",
      dates: [date1, date2, date3],
      title: "Dinner",
      meetingType: 1,
    });

    await t.run(async (ctx) => {
      // Count total eventSeries records: should be exactly 3 (one per group)
      const allSeries: any[] = [];
      for (const gid of [setup.groupId1, setup.groupId2, setup.groupId3]) {
        const seriesList = await ctx.db
          .query("eventSeries")
          .withIndex("by_group", (q) => q.eq("groupId", gid))
          .collect();
        allSeries.push(...seriesList);
      }
      expect(allSeries).toHaveLength(3);

      // All meetings for group1 share the same seriesId
      const group1Series = await ctx.db
        .query("eventSeries")
        .withIndex("by_group", (q) => q.eq("groupId", setup.groupId1))
        .collect();
      expect(group1Series).toHaveLength(1);
      const group1SeriesId = group1Series[0]._id;

      const group1Meetings = await ctx.db
        .query("meetings")
        .withIndex("by_series", (q) => q.eq("seriesId", group1SeriesId))
        .collect();
      expect(group1Meetings).toHaveLength(3);
      for (const m of group1Meetings) {
        expect(m.seriesId).toBe(group1SeriesId);
        expect(m.groupId).toBe(setup.groupId1);
      }

      // All meetings for group2 share a different seriesId
      const group2Series = await ctx.db
        .query("eventSeries")
        .withIndex("by_group", (q) => q.eq("groupId", setup.groupId2))
        .collect();
      expect(group2Series).toHaveLength(1);
      const group2SeriesId = group2Series[0]._id;
      expect(group2SeriesId).not.toBe(group1SeriesId);

      const group2Meetings = await ctx.db
        .query("meetings")
        .withIndex("by_series", (q) => q.eq("seriesId", group2SeriesId))
        .collect();
      expect(group2Meetings).toHaveLength(3);

      // All meetings for group3 share yet another seriesId
      const group3Series = await ctx.db
        .query("eventSeries")
        .withIndex("by_group", (q) => q.eq("groupId", setup.groupId3))
        .collect();
      expect(group3Series).toHaveLength(1);
      const group3SeriesId = group3Series[0]._id;
      expect(group3SeriesId).not.toBe(group1SeriesId);
      expect(group3SeriesId).not.toBe(group2SeriesId);
    });
  });

  test("requires at least 1 date", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    await expect(
      t.mutation(api.functions.communityWideEvents.createSeries, {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Lone Dinner",
        dates: [],
        title: "Dinner",
        meetingType: 1,
      })
    ).rejects.toThrow("Series must have at least 1 date");
  });

  test("requires admin role", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    await expect(
      t.mutation(api.functions.communityWideEvents.createSeries, {
        token: setup.nonAdminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Unauthorized Dinner",
        dates: [date1, date2],
        title: "Dinner",
        meetingType: 1,
      })
    ).rejects.toThrow("Community admin role required");
  });

  test("find-or-create appends to existing series on second call", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();
    const date3 = new Date("2026-04-24T18:00:00Z").getTime();
    const date4 = new Date("2026-05-01T18:00:00Z").getTime();

    // First call: create series with 2 dates
    const result1 = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Dinner",
        meetingType: 1,
      }
    );

    expect(result1.communityWideEventIds).toHaveLength(2);
    expect(result1.totalMeetingsCreated).toBe(6);

    // Record the seriesIds for each group
    let seriesIdsByGroup: Record<string, Id<"eventSeries">> = {};
    await t.run(async (ctx) => {
      for (const gid of [setup.groupId1, setup.groupId2, setup.groupId3]) {
        const seriesList = await ctx.db
          .query("eventSeries")
          .withIndex("by_group", (q) => q.eq("groupId", gid))
          .collect();
        expect(seriesList).toHaveLength(1);
        seriesIdsByGroup[gid] = seriesList[0]._id;
      }
    });

    // Second call: create series with 2 more dates using the same seriesName
    const result2 = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date3, date4],
        title: "Dinner",
        meetingType: 1,
      }
    );

    expect(result2.communityWideEventIds).toHaveLength(2);
    expect(result2.totalMeetingsCreated).toBe(6);

    await t.run(async (ctx) => {
      // Verify the SAME seriesIds are reused for each group (not new ones)
      for (const gid of [setup.groupId1, setup.groupId2, setup.groupId3]) {
        const seriesList = await ctx.db
          .query("eventSeries")
          .withIndex("by_group", (q) => q.eq("groupId", gid))
          .collect();
        // Still only 1 series per group
        expect(seriesList).toHaveLength(1);
        expect(seriesList[0]._id).toBe(seriesIdsByGroup[gid]);
      }

      // Each group's series now has 4 meetings total (2 from first + 2 from second)
      for (const gid of [setup.groupId1, setup.groupId2, setup.groupId3]) {
        const seriesId = seriesIdsByGroup[gid];
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_series", (q) => q.eq("seriesId", seriesId))
          .collect();
        expect(meetings).toHaveLength(4);
      }
    });
  });
});

// ============================================================================
// communityWideEvents.cancel with scope
// ============================================================================

describe("communityWideEvents.cancel with scope", () => {
  test("scope=this_date_all_groups cancels only one date's meetings", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    // Create a series with 2 dates (6 meetings: 2 dates x 3 groups)
    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Dinner",
        meetingType: 1,
      }
    );

    expect(createResult.totalMeetingsCreated).toBe(6);

    // Cancel the first communityWideEvent with scope: "this_date_all_groups"
    const cancelResult = await t.mutation(
      api.functions.communityWideEvents.cancel,
      {
        token: setup.adminToken,
        communityWideEventId: createResult.communityWideEventIds[0],
        scope: "this_date_all_groups",
      }
    );

    // Only 3 meetings cancelled (the ones for date1)
    expect(cancelResult.meetingsCancelled).toBe(3);

    await t.run(async (ctx) => {
      // Date1 meetings: cancelled
      const date1Meetings = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      expect(date1Meetings).toHaveLength(3);
      for (const m of date1Meetings) {
        expect(m.status).toBe("cancelled");
      }

      // Date2 meetings: still scheduled
      const date2Meetings = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      expect(date2Meetings).toHaveLength(3);
      for (const m of date2Meetings) {
        expect(m.status).toBe("scheduled");
      }

      // Each group's eventSeries should still be "active"
      for (const gid of [setup.groupId1, setup.groupId2, setup.groupId3]) {
        const seriesList = await ctx.db
          .query("eventSeries")
          .withIndex("by_group", (q) => q.eq("groupId", gid))
          .collect();
        expect(seriesList).toHaveLength(1);
        expect(seriesList[0].status).toBe("active");
      }
    });
  });

  test("scope=all_in_series cancels all dates across all groups", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    // Create a series with 2 dates (6 meetings)
    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Dinner",
        meetingType: 1,
      }
    );

    expect(createResult.totalMeetingsCreated).toBe(6);

    // Cancel the first communityWideEvent with scope: "all_in_series"
    const cancelResult = await t.mutation(
      api.functions.communityWideEvents.cancel,
      {
        token: setup.adminToken,
        communityWideEventId: createResult.communityWideEventIds[0],
        scope: "all_in_series",
      }
    );

    // ALL 6 meetings cancelled
    expect(cancelResult.meetingsCancelled).toBe(6);

    await t.run(async (ctx) => {
      // All meetings across both dates should be cancelled
      for (const cweId of createResult.communityWideEventIds) {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_communityWideEvent", (q) =>
            q.eq("communityWideEventId", cweId)
          )
          .collect();
        for (const m of meetings) {
          expect(m.status).toBe("cancelled");
        }
      }

      // All 3 eventSeries records should have status = "cancelled"
      for (const gid of [setup.groupId1, setup.groupId2, setup.groupId3]) {
        const seriesList = await ctx.db
          .query("eventSeries")
          .withIndex("by_group", (q) => q.eq("groupId", gid))
          .collect();
        expect(seriesList).toHaveLength(1);
        expect(seriesList[0].status).toBe("cancelled");
      }

      // BOTH communityWideEvent records should have status = "cancelled"
      for (const cweId of createResult.communityWideEventIds) {
        const cwe = await ctx.db.get(cweId);
        expect(cwe).not.toBeNull();
        expect(cwe!.status).toBe("cancelled");
      }
    });
  });
});

// ============================================================================
// communityWideEvents.update with scope
// ============================================================================

describe("communityWideEvents.update with scope", () => {
  test("default scope updates only this date's meetings", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    // Create series with 2 dates
    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Original Title",
        meetingType: 1,
      }
    );

    // Update first communityWideEvent with default scope (this_date_all_groups)
    await t.mutation(api.functions.communityWideEvents.update, {
      token: setup.adminToken,
      communityWideEventId: createResult.communityWideEventIds[0],
      title: "New Title",
      scope: "this_date_all_groups",
    });

    await t.run(async (ctx) => {
      // Date1's 3 meetings should have "New Title"
      const date1Meetings = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      expect(date1Meetings).toHaveLength(3);
      for (const m of date1Meetings) {
        expect(m.title).toBe("New Title");
      }

      // Date2's 3 meetings should still have "Original Title"
      const date2Meetings = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      expect(date2Meetings).toHaveLength(3);
      for (const m of date2Meetings) {
        expect(m.title).toBe("Original Title");
      }
    });
  });

  test("scope=all_in_series updates all meetings across all dates and groups", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    // Create series with 2 dates, 3 groups (6 meetings)
    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Original Title",
        meetingType: 1,
      }
    );

    // Update first communityWideEvent with scope: "all_in_series"
    const updateResult = await t.mutation(
      api.functions.communityWideEvents.update,
      {
        token: setup.adminToken,
        communityWideEventId: createResult.communityWideEventIds[0],
        title: "Updated",
        scope: "all_in_series",
      }
    );

    // Should have updated all 6 meetings
    expect(updateResult.meetingsUpdated).toBe(6);

    await t.run(async (ctx) => {
      // ALL 6 meetings should have title "Updated"
      for (const cweId of createResult.communityWideEventIds) {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_communityWideEvent", (q) =>
            q.eq("communityWideEventId", cweId)
          )
          .collect();
        for (const m of meetings) {
          expect(m.title).toBe("Updated");
        }
      }
    });
  });

  test("scope=all_in_series does NOT collapse other occurrences' dates", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    // Create series with 2 dates, 3 groups (6 meetings)
    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Dinner",
        meetingType: 1,
      }
    );

    // Move the FIRST occurrence to a new time, with scope: "all_in_series".
    // The title change should cascade to every occurrence, but the date
    // change must apply ONLY to this occurrence — the second occurrence
    // keeps its own date2.
    const newDate1 = new Date("2026-04-11T19:00:00Z").getTime();
    await t.mutation(api.functions.communityWideEvents.update, {
      token: setup.adminToken,
      communityWideEventId: createResult.communityWideEventIds[0],
      title: "Renamed",
      scheduledAt: newDate1,
      scope: "all_in_series",
    });

    await t.run(async (ctx) => {
      // Occurrence 1: children moved to newDate1
      const occ1 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      expect(occ1).toHaveLength(3);
      for (const m of occ1) {
        expect(m.scheduledAt).toBe(newDate1);
        expect(m.title).toBe("Renamed");
      }

      // Occurrence 2: children KEPT date2 — not collapsed onto newDate1.
      const occ2 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      expect(occ2).toHaveLength(3);
      for (const m of occ2) {
        expect(m.scheduledAt).toBe(date2);
        // Non-date fields still cascade.
        expect(m.title).toBe("Renamed");
      }

      // The second occurrence's parent CWE also keeps its own date.
      const cwe2 = await ctx.db.get(createResult.communityWideEventIds[1]);
      expect(cwe2!.scheduledAt).toBe(date2);
    });
  });

  test("scope=all_in_series leaves PAST occurrences untouched", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    // System time is pinned to 2026-01-01 (see beforeEach).
    const pastDate = new Date("2025-12-01T18:00:00Z").getTime();
    const futureDate1 = new Date("2026-04-10T18:00:00Z").getTime();
    const futureDate2 = new Date("2026-04-17T18:00:00Z").getTime();

    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [pastDate, futureDate1, futureDate2],
        title: "Original",
        meetingType: 1,
      }
    );

    // Edit the first FUTURE occurrence with scope: "all_in_series".
    const updateResult = await t.mutation(
      api.functions.communityWideEvents.update,
      {
        token: setup.adminToken,
        communityWideEventId: createResult.communityWideEventIds[1],
        title: "Updated",
        scope: "all_in_series",
      }
    );

    // Only the two future occurrences' meetings (3 groups x 2 dates).
    expect(updateResult.meetingsUpdated).toBe(6);

    await t.run(async (ctx) => {
      // Past occurrence: untouched.
      const pastMeetings = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      for (const m of pastMeetings) {
        expect(m.title).toBe("Original");
      }

      // Both future occurrences: updated.
      for (const cweId of [
        createResult.communityWideEventIds[1],
        createResult.communityWideEventIds[2],
      ]) {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_communityWideEvent", (q) =>
            q.eq("communityWideEventId", cweId)
          )
          .collect();
        for (const m of meetings) {
          expect(m.title).toBe("Updated");
        }
      }

      // Parent communityWideEvents: future ones cascade, the past one does not.
      // The Events feed renders titles from the parent record.
      const pastParent = await ctx.db.get(createResult.communityWideEventIds[0]);
      expect(pastParent!.title).toBe("Original");
      for (const cweId of [
        createResult.communityWideEventIds[1],
        createResult.communityWideEventIds[2],
      ]) {
        const parent = await ctx.db.get(cweId);
        expect(parent!.title).toBe("Updated");
      }
    });
  });

  test("scope=all_in_series skips cancelled direct children", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Original",
        meetingType: 1,
      }
    );

    // One group's occurrence-1 meeting is already cancelled.
    let cancelledId: Id<"meetings">;
    await t.run(async (ctx) => {
      const occ1 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      cancelledId = occ1[0]._id;
      await ctx.db.patch(cancelledId, { status: "cancelled" });
    });

    const newDate1 = new Date("2026-04-11T19:00:00Z").getTime();
    const updateResult = await t.mutation(
      api.functions.communityWideEvents.update,
      {
        token: setup.adminToken,
        communityWideEventId: createResult.communityWideEventIds[0],
        title: "Updated",
        scheduledAt: newDate1,
        scope: "all_in_series",
      }
    );

    // occ1: 2 non-cancelled children; occ2: 3 — the cancelled one is skipped.
    expect(updateResult.meetingsUpdated).toBe(5);

    await t.run(async (ctx) => {
      const cancelled = await ctx.db.get(cancelledId);
      // Untouched by the update: still cancelled, original title and date.
      expect(cancelled!.status).toBe("cancelled");
      expect(cancelled!.title).toBe("Original");
      expect(cancelled!.scheduledAt).toBe(date1);

      const occ1 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      for (const m of occ1) {
        if (m._id === cancelledId) continue;
        expect(m.title).toBe("Updated");
        expect(m.scheduledAt).toBe(newDate1);
      }
    });
  });

  test("scope=all_in_series cascades even when edited occurrence is fully overridden", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Original",
        meetingType: 1,
      }
    );

    // Every direct child of occurrence 1 is overridden. Series discovery must
    // still find the seriesId from these rows so the cascade reaches occ 2.
    await t.run(async (ctx) => {
      const occ1 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      for (const m of occ1) {
        await ctx.db.patch(m._id, { isOverridden: true });
      }
    });

    const updateResult = await t.mutation(
      api.functions.communityWideEvents.update,
      {
        token: setup.adminToken,
        communityWideEventId: createResult.communityWideEventIds[0],
        title: "Updated",
        scope: "all_in_series",
      }
    );

    // Occurrence 1's children are all overridden — only occ 2's 3 update.
    expect(updateResult.meetingsUpdated).toBe(3);

    await t.run(async (ctx) => {
      const occ1 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      for (const m of occ1) {
        expect(m.title).toBe("Original");
      }

      const occ2 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      for (const m of occ2) {
        expect(m.title).toBe("Updated");
      }
    });
  });

  test("scope=all_in_series cascades to a future parent whose children are all overridden", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Original",
        meetingType: 1,
      }
    );

    // The future occurrence 2 has every child overridden — none of its
    // meetings will be in cascadeMeetings, but its parent record must still
    // receive the all-series title change (the feed renders parent.title).
    await t.run(async (ctx) => {
      const occ2 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      for (const m of occ2) {
        await ctx.db.patch(m._id, { isOverridden: true });
      }
    });

    await t.mutation(api.functions.communityWideEvents.update, {
      token: setup.adminToken,
      communityWideEventId: createResult.communityWideEventIds[0],
      title: "Updated",
      scope: "all_in_series",
    });

    await t.run(async (ctx) => {
      // Occurrence 2's parent record cascaded despite all children overridden.
      const parent2 = await ctx.db.get(createResult.communityWideEventIds[1]);
      expect(parent2!.title).toBe("Updated");

      // Its overridden child meetings are still left untouched.
      const occ2 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      for (const m of occ2) {
        expect(m.title).toBe("Original");
      }
    });
  });

  test("scope=all_in_series skips a past occurrence even if its child dates are corrupt", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    // System time is 2026-01-01 (see beforeEach).
    const pastDate = new Date("2025-12-01T18:00:00Z").getTime();
    const futureDate = new Date("2026-04-10T18:00:00Z").getTime();

    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [pastDate, futureDate],
        title: "Original",
        meetingType: 1,
      }
    );

    // Simulate the collapsed-date corruption: the PAST occurrence's children
    // carry a future scheduledAt. The parent CWE keeps its real past date.
    const corruptDate = new Date("2026-06-01T18:00:00Z").getTime();
    await t.run(async (ctx) => {
      const pastChildren = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      for (const m of pastChildren) {
        await ctx.db.patch(m._id, { scheduledAt: corruptDate });
      }
    });

    const updateResult = await t.mutation(
      api.functions.communityWideEvents.update,
      {
        token: setup.adminToken,
        communityWideEventId: createResult.communityWideEventIds[1],
        title: "Updated",
        scope: "all_in_series",
      }
    );

    // Only the future occurrence's 3 children — the past occurrence is excluded
    // because its parent CWE date is in the past, not its (corrupt) child date.
    expect(updateResult.meetingsUpdated).toBe(3);

    await t.run(async (ctx) => {
      const pastChildren = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[0])
        )
        .collect();
      for (const m of pastChildren) {
        expect(m.title).toBe("Original");
      }
      // The past occurrence's parent record is left stale too.
      const pastParent = await ctx.db.get(createResult.communityWideEventIds[0]);
      expect(pastParent!.title).toBe("Original");
    });
  });
});

// ============================================================================
// communityWideEvents.repairCollapsedChildDates
// ============================================================================

describe("communityWideEvents.repairCollapsedChildDates", () => {
  test("restores collapsed child dates, skips overrides", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Dinner",
        meetingType: 1,
      }
    );

    // Simulate the old bug: collapse occurrence 2's children onto date1, and
    // mark one of them as an override that the repair must NOT touch.
    let overriddenId: Id<"meetings">;
    await t.run(async (ctx) => {
      const occ2 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      for (const [i, m] of occ2.entries()) {
        if (i === 0) {
          // An intentional per-group override at a custom time.
          overriddenId = m._id;
          await ctx.db.patch(m._id, { scheduledAt: date1, isOverridden: true });
        } else {
          await ctx.db.patch(m._id, { scheduledAt: date1 });
        }
      }
    });

    const result = await t.mutation(
      internal.functions.communityWideEvents.repairCollapsedChildDates,
      {}
    );

    // 2 of occurrence 2's 3 children were collapsed and non-overridden.
    expect(result.meetingsRepaired).toBe(2);

    await t.run(async (ctx) => {
      const occ2 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      for (const m of occ2) {
        if (m._id === overriddenId) {
          // Override left exactly as the leader set it.
          expect(m.scheduledAt).toBe(date1);
          expect(m.isOverridden).toBe(true);
        } else {
          expect(m.scheduledAt).toBe(date2);
        }
      }
    });

    // Idempotent — a second run finds nothing to repair.
    const second = await t.mutation(
      internal.functions.communityWideEvents.repairCollapsedChildDates,
      {}
    );
    expect(second.meetingsRepaired).toBe(0);
  });

  test("leaves cancelled children untouched", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupCommunityWideTestData(t);

    const date1 = new Date("2026-04-10T18:00:00Z").getTime();
    const date2 = new Date("2026-04-17T18:00:00Z").getTime();

    const createResult = await t.mutation(
      api.functions.communityWideEvents.createSeries,
      {
        token: setup.adminToken,
        communityId: setup.communityId,
        groupTypeId: setup.groupTypeId,
        seriesName: "Weekly Dinner",
        dates: [date1, date2],
        title: "Dinner",
        meetingType: 1,
      }
    );

    // Collapse occurrence 2's children onto date1; cancel one of them.
    let cancelledId: Id<"meetings">;
    await t.run(async (ctx) => {
      const occ2 = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", createResult.communityWideEventIds[1])
        )
        .collect();
      for (const [i, m] of occ2.entries()) {
        if (i === 0) {
          cancelledId = m._id;
          await ctx.db.patch(m._id, { scheduledAt: date1, status: "cancelled" });
        } else {
          await ctx.db.patch(m._id, { scheduledAt: date1 });
        }
      }
    });

    const result = await t.mutation(
      internal.functions.communityWideEvents.repairCollapsedChildDates,
      {}
    );

    // Only the 2 non-cancelled collapsed children are repaired.
    expect(result.meetingsRepaired).toBe(2);

    await t.run(async (ctx) => {
      const cancelled = await ctx.db.get(cancelledId);
      // Cancelled meeting is never repaired or rescheduled.
      expect(cancelled!.status).toBe("cancelled");
      expect(cancelled!.scheduledAt).toBe(date1);
    });
  });
});
