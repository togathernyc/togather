/**
 * Event Series Tests
 *
 * Tests for CRUD operations on event series: create, addMeetingToSeries,
 * removeMeetingFromSeries, createSeriesFromMeetings, get, listByGroup,
 * and listSeriesNamesByGroupType.
 *
 * Run with: cd apps/convex && pnpm test __tests__/eventSeries.test.ts
 */

import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

// Mock the jose library to bypass JWT verification in tests
vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) {
      throw new Error("Invalid token");
    }
    return {
      payload: {
        userId: match[1],
        type: "access",
      },
    };
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
// Setup Helper
// ============================================================================

async function setupTestData(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const communityId = await ctx.db.insert("communities", {
      name: "Series Test Community",
      slug: "series-test",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Dinner Party",
      slug: "dinner-party",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Friday Night Dinners",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    // Leader user
    const leaderId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "User",
      email: "leader-series@test.com",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // Member user
    const memberId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "User",
      email: "member-series@test.com",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // Non-member user
    const nonMemberId = await ctx.db.insert("users", {
      firstName: "NonMember",
      lastName: "User",
      email: "nonmember-series@test.com",
      createdAt: now,
      updatedAt: now,
    });

    // 3 meetings: tomorrow, day after, 3 days from now
    const meeting1Id = await ctx.db.insert("meetings", {
      groupId,
      createdById: leaderId,
      title: "Dinner 1",
      scheduledAt: now + DAY,
      status: "scheduled",
      meetingType: 1,
      createdAt: now,
    });

    const meeting2Id = await ctx.db.insert("meetings", {
      groupId,
      createdById: leaderId,
      title: "Dinner 2",
      scheduledAt: now + 2 * DAY,
      status: "scheduled",
      meetingType: 1,
      createdAt: now,
    });

    const meeting3Id = await ctx.db.insert("meetings", {
      groupId,
      createdById: leaderId,
      title: "Dinner 3",
      scheduledAt: now + 3 * DAY,
      status: "scheduled",
      meetingType: 1,
      createdAt: now,
    });

    return {
      communityId,
      groupTypeId,
      groupId,
      leaderId,
      memberId,
      nonMemberId,
      meeting1Id,
      meeting2Id,
      meeting3Id,
      leaderToken: `test-token-${leaderId}`,
      memberToken: `test-token-${memberId}`,
      nonMemberToken: `test-token-${nonMemberId}`,
    };
  });
}

// ============================================================================
// eventSeries.create
// ============================================================================

describe("eventSeries.create", () => {
  test("leader can create a series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const seriesId = await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Weekly Dinner Party",
    });

    expect(seriesId).toBeDefined();

    // Verify the record in the DB
    const series = await t.run(async (ctx) => {
      return await ctx.db.get(seriesId);
    });

    expect(series).not.toBeNull();
    expect(series!.name).toBe("Weekly Dinner Party");
    expect(series!.status).toBe("active");
    expect(series!.groupId).toBe(ids.groupId);
    expect(series!.createdById).toBe(ids.leaderId);
  });

  test("non-leader (member) cannot create a series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    await expect(
      t.mutation(api.functions.eventSeries.create, {
        token: ids.memberToken,
        groupId: ids.groupId,
        name: "Weekly Dinner Party",
      })
    ).rejects.toThrow("Only group leaders or community admins can create event series");
  });

  test("non-member cannot create a series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    await expect(
      t.mutation(api.functions.eventSeries.create, {
        token: ids.nonMemberToken,
        groupId: ids.groupId,
        name: "Weekly Dinner Party",
      })
    ).rejects.toThrow("Only group leaders or community admins can create event series");
  });
});

// ============================================================================
// eventSeries.addMeetingToSeries
// ============================================================================

describe("eventSeries.addMeetingToSeries", () => {
  test("leader can add meeting to series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const seriesId = await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Weekly Dinner Party",
    });

    await t.mutation(api.functions.eventSeries.addMeetingToSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting1Id,
      seriesId,
    });

    // Verify the meeting now has seriesId set
    const meeting = await t.run(async (ctx) => {
      return await ctx.db.get(ids.meeting1Id);
    });
    expect(meeting!.seriesId).toBe(seriesId);
  });

  test("cannot add meeting from different group", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    // Create a second group and a meeting in it
    const otherMeetingId = await t.run(async (ctx) => {
      const now = Date.now();
      const otherGroupId = await ctx.db.insert("groups", {
        communityId: ids.communityId,
        groupTypeId: ids.groupTypeId,
        name: "Other Group",
        isArchived: false,
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });
      // Leader needs to be in this group too for the meeting to exist there
      return await ctx.db.insert("meetings", {
        groupId: otherGroupId,
        createdById: ids.leaderId,
        title: "Other Meeting",
        scheduledAt: now + 24 * 60 * 60 * 1000,
        status: "scheduled",
        meetingType: 1,
        createdAt: now,
      });
    });

    // Create series in the original group
    const seriesId = await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Weekly Dinner Party",
    });

    await expect(
      t.mutation(api.functions.eventSeries.addMeetingToSeries, {
        token: ids.leaderToken,
        meetingId: otherMeetingId,
        seriesId,
      })
    ).rejects.toThrow("Meeting and series must belong to the same group");
  });

  test("non-leader cannot add meeting to series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const seriesId = await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Weekly Dinner Party",
    });

    await expect(
      t.mutation(api.functions.eventSeries.addMeetingToSeries, {
        token: ids.memberToken,
        meetingId: ids.meeting1Id,
        seriesId,
      })
    ).rejects.toThrow("Only group leaders or community admins can manage event series");
  });
});

// ============================================================================
// eventSeries.removeMeetingFromSeries
// ============================================================================

describe("eventSeries.removeMeetingFromSeries", () => {
  test("leader removes meeting from series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const seriesId = await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Weekly Dinner Party",
    });

    // Add two meetings to the series
    await t.mutation(api.functions.eventSeries.addMeetingToSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting1Id,
      seriesId,
    });
    await t.mutation(api.functions.eventSeries.addMeetingToSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting2Id,
      seriesId,
    });

    // Remove the first meeting
    await t.mutation(api.functions.eventSeries.removeMeetingFromSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting1Id,
    });

    // Verify seriesId is cleared
    const meeting = await t.run(async (ctx) => {
      return await ctx.db.get(ids.meeting1Id);
    });
    expect(meeting!.seriesId).toBeUndefined();

    // Series should still be active (meeting2 is still linked)
    const series = await t.run(async (ctx) => {
      return await ctx.db.get(seriesId);
    });
    expect(series!.status).toBe("active");
  });

  test("removing last meeting from series cancels the series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const seriesId = await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Weekly Dinner Party",
    });

    // Add only one meeting
    await t.mutation(api.functions.eventSeries.addMeetingToSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting1Id,
      seriesId,
    });

    // Remove it
    await t.mutation(api.functions.eventSeries.removeMeetingFromSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting1Id,
    });

    // Series should now be cancelled
    const series = await t.run(async (ctx) => {
      return await ctx.db.get(seriesId);
    });
    expect(series!.status).toBe("cancelled");
  });

  test("cannot remove meeting that is not in a series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    await expect(
      t.mutation(api.functions.eventSeries.removeMeetingFromSeries, {
        token: ids.leaderToken,
        meetingId: ids.meeting1Id,
      })
    ).rejects.toThrow("Meeting is not part of a series");
  });

  test("non-leader cannot remove meeting from series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const seriesId = await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Weekly Dinner Party",
    });

    await t.mutation(api.functions.eventSeries.addMeetingToSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting1Id,
      seriesId,
    });

    await expect(
      t.mutation(api.functions.eventSeries.removeMeetingFromSeries, {
        token: ids.memberToken,
        meetingId: ids.meeting1Id,
      })
    ).rejects.toThrow("Only group leaders or community admins can manage event series");
  });
});

// ============================================================================
// eventSeries.createSeriesFromMeetings
// ============================================================================

describe("eventSeries.createSeriesFromMeetings", () => {
  test("leader creates new series from 2 meetings", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const result = await t.mutation(
      api.functions.eventSeries.createSeriesFromMeetings,
      {
        token: ids.leaderToken,
        groupId: ids.groupId,
        name: "New Dinner Series",
        meetingIds: [ids.meeting1Id, ids.meeting2Id],
      }
    );

    expect(result.seriesId).toBeDefined();
    expect(result.meetingsLinked).toBe(2);

    // Both meetings should have seriesId set
    const meeting1 = await t.run(async (ctx) => {
      return await ctx.db.get(ids.meeting1Id);
    });
    const meeting2 = await t.run(async (ctx) => {
      return await ctx.db.get(ids.meeting2Id);
    });
    expect(meeting1!.seriesId).toBe(result.seriesId);
    expect(meeting2!.seriesId).toBe(result.seriesId);

    // Verify series record
    const series = await t.run(async (ctx) => {
      return await ctx.db.get(result.seriesId);
    });
    expect(series!.name).toBe("New Dinner Series");
    expect(series!.status).toBe("active");
  });

  test("reuses existing active series with same name", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    // First, create a series with a specific name
    const existingSeriesId = await t.mutation(
      api.functions.eventSeries.create,
      {
        token: ids.leaderToken,
        groupId: ids.groupId,
        name: "Recurring Dinner",
      }
    );

    // Now call createSeriesFromMeetings with the same name
    const result = await t.mutation(
      api.functions.eventSeries.createSeriesFromMeetings,
      {
        token: ids.leaderToken,
        groupId: ids.groupId,
        name: "Recurring Dinner",
        meetingIds: [ids.meeting1Id, ids.meeting2Id],
      }
    );

    // Should reuse the existing series, not create a new one
    expect(result.seriesId).toBe(existingSeriesId);
    expect(result.meetingsLinked).toBe(2);
  });

  test("non-leader cannot create series from meetings", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    await expect(
      t.mutation(api.functions.eventSeries.createSeriesFromMeetings, {
        token: ids.memberToken,
        groupId: ids.groupId,
        name: "New Dinner Series",
        meetingIds: [ids.meeting1Id, ids.meeting2Id],
      })
    ).rejects.toThrow("Only group leaders or community admins can create event series");
  });
});

// ============================================================================
// getSeriesNumber (tested via the `get` query)
// ============================================================================

describe("getSeriesNumber via eventSeries.get", () => {
  test("3 meetings get seriesNumber 1,2,3 and seriesTotalCount 3", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    // Create series and add all 3 meetings
    const result = await t.mutation(
      api.functions.eventSeries.createSeriesFromMeetings,
      {
        token: ids.leaderToken,
        groupId: ids.groupId,
        name: "Numbered Series",
        meetingIds: [ids.meeting1Id, ids.meeting2Id, ids.meeting3Id],
      }
    );

    const series = await t.query(api.functions.eventSeries.get, {
      token: ids.leaderToken,
      seriesId: result.seriesId,
    });

    expect(series).not.toBeNull();
    expect(series!.meetings).toHaveLength(3);

    // Meetings should be sorted by scheduledAt, so meeting1 < meeting2 < meeting3
    expect(series!.meetings[0].seriesNumber).toBe(1);
    expect(series!.meetings[0].seriesTotalCount).toBe(3);
    expect(series!.meetings[1].seriesNumber).toBe(2);
    expect(series!.meetings[1].seriesTotalCount).toBe(3);
    expect(series!.meetings[2].seriesNumber).toBe(3);
    expect(series!.meetings[2].seriesTotalCount).toBe(3);
  });

  test("cancel middle meeting adjusts numbering to 1,2 with total 2", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    // Create series with all 3 meetings
    const result = await t.mutation(
      api.functions.eventSeries.createSeriesFromMeetings,
      {
        token: ids.leaderToken,
        groupId: ids.groupId,
        name: "Numbered Series",
        meetingIds: [ids.meeting1Id, ids.meeting2Id, ids.meeting3Id],
      }
    );

    // Cancel the middle meeting directly in DB
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.meeting2Id, { status: "cancelled" });
    });

    const series = await t.query(api.functions.eventSeries.get, {
      token: ids.leaderToken,
      seriesId: result.seriesId,
    });

    expect(series).not.toBeNull();
    // Only 2 active meetings remain
    expect(series!.meetings).toHaveLength(2);
    expect(series!.meetings[0]._id).toBe(ids.meeting1Id);
    expect(series!.meetings[0].seriesNumber).toBe(1);
    expect(series!.meetings[0].seriesTotalCount).toBe(2);
    expect(series!.meetings[1]._id).toBe(ids.meeting3Id);
    expect(series!.meetings[1].seriesNumber).toBe(2);
    expect(series!.meetings[1].seriesTotalCount).toBe(2);
  });
});

// ============================================================================
// eventSeries.listByGroup
// ============================================================================

describe("eventSeries.listByGroup", () => {
  test("returns all active series for a group", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    // Create two active series
    await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Series A",
    });
    await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Series B",
    });

    const result = await t.query(api.functions.eventSeries.listByGroup, {
      groupId: ids.groupId,
    });

    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name).sort();
    expect(names).toEqual(["Series A", "Series B"]);
  });

  test("includes meetingCount for each series", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const result = await t.mutation(
      api.functions.eventSeries.createSeriesFromMeetings,
      {
        token: ids.leaderToken,
        groupId: ids.groupId,
        name: "Counted Series",
        meetingIds: [ids.meeting1Id, ids.meeting2Id],
      }
    );

    const list = await t.query(api.functions.eventSeries.listByGroup, {
      groupId: ids.groupId,
    });

    expect(list).toHaveLength(1);
    expect(list[0]._id).toBe(result.seriesId);
    expect(list[0].meetingCount).toBe(2);
  });

  test("filtering by status works", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    // Create an active series
    await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Active Series",
    });

    // Create a series and then cancel it (add a meeting, remove it to trigger cancel)
    const cancelledSeriesId = await t.mutation(
      api.functions.eventSeries.create,
      {
        token: ids.leaderToken,
        groupId: ids.groupId,
        name: "Cancelled Series",
      }
    );
    await t.mutation(api.functions.eventSeries.addMeetingToSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting1Id,
      seriesId: cancelledSeriesId,
    });
    await t.mutation(api.functions.eventSeries.removeMeetingFromSeries, {
      token: ids.leaderToken,
      meetingId: ids.meeting1Id,
    });

    // Filter active only
    const activeList = await t.query(api.functions.eventSeries.listByGroup, {
      groupId: ids.groupId,
      status: "active",
    });
    expect(activeList).toHaveLength(1);
    expect(activeList[0].name).toBe("Active Series");

    // Filter cancelled only
    const cancelledList = await t.query(api.functions.eventSeries.listByGroup, {
      groupId: ids.groupId,
      status: "cancelled",
    });
    expect(cancelledList).toHaveLength(1);
    expect(cancelledList[0].name).toBe("Cancelled Series");
  });
});

// ============================================================================
// eventSeries.listSeriesNamesByGroupType
// ============================================================================

describe("eventSeries.listSeriesNamesByGroupType", () => {
  test("returns distinct names across groups of a type", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    // Create a second group of the same type
    const secondGroupId = await t.run(async (ctx) => {
      const now = Date.now();
      const gId = await ctx.db.insert("groups", {
        communityId: ids.communityId,
        groupTypeId: ids.groupTypeId,
        name: "Saturday Dinners",
        isArchived: false,
        isPublic: true,
        createdAt: now,
        updatedAt: now,
      });
      // Leader needs to be in this group to create series
      await ctx.db.insert("groupMembers", {
        groupId: gId,
        userId: ids.leaderId,
        role: "leader",
        joinedAt: now,
        notificationsEnabled: true,
      });
      return gId;
    });

    // Create series in both groups with overlapping names
    await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Holiday Special",
    });
    await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: ids.groupId,
      name: "Weekly Dinner",
    });
    await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: secondGroupId,
      name: "Holiday Special", // Same name in different group
    });
    await t.mutation(api.functions.eventSeries.create, {
      token: ids.leaderToken,
      groupId: secondGroupId,
      name: "Monthly Brunch",
    });

    const names = await t.query(
      api.functions.eventSeries.listSeriesNamesByGroupType,
      {
        communityId: ids.communityId,
        groupTypeId: ids.groupTypeId,
      }
    );

    // Should be distinct and sorted
    expect(names).toEqual(["Holiday Special", "Monthly Brunch", "Weekly Dinner"]);
  });

  test("returns empty array if no series exist", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupTestData(t);

    const names = await t.query(
      api.functions.eventSeries.listSeriesNamesByGroupType,
      {
        communityId: ids.communityId,
        groupTypeId: ids.groupTypeId,
      }
    );

    expect(names).toEqual([]);
  });
});
