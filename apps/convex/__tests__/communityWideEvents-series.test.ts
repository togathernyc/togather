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
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

beforeEach(() => {
  vi.useFakeTimers();
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
});
