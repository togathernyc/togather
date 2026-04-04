/**
 * Meetings Series Scope Tests
 *
 * Tests for scoped meeting update and cancel operations:
 * - update with scope: "this_only" vs "all_in_series"
 * - cancel with scope: "this_only" vs "all_in_series"
 * - createSeriesEvents mutation
 *
 * Run with: cd apps/convex && pnpm test __tests__/meetings-series-scope.test.ts
 */

import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

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

interface SeriesTestSetup {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  leaderId: Id<"users">;
  leaderToken: string;
  seriesId: Id<"eventSeries">;
  meetingId1: Id<"meetings">;
  meetingId2: Id<"meetings">;
  meetingId3: Id<"meetings">;
}

async function setupSeriesTestData(
  t: ReturnType<typeof convexTest>
): Promise<SeriesTestSetup> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();
    const tomorrow = timestamp + 24 * 60 * 60 * 1000;
    const dayAfterTomorrow = timestamp + 2 * 24 * 60 * 60 * 1000;
    const threeDaysOut = timestamp + 3 * 24 * 60 * 60 * 1000;

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
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });

    // Create group
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create leader user
    const leaderId = await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "Leader",
      phone: "+15551234567",
      createdAt: timestamp,
    });

    // Create group membership for leader
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Create user-community membership
    await ctx.db.insert("userCommunities", {
      userId: leaderId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: timestamp,
    });

    // Create event series
    const seriesId = await ctx.db.insert("eventSeries", {
      groupId,
      createdById: leaderId,
      name: "Weekly Dinner",
      status: "active",
      createdAt: timestamp,
    });

    // Create 3 meetings in the series
    const meetingId1 = await ctx.db.insert("meetings", {
      groupId,
      title: "Dinner #1",
      scheduledAt: tomorrow,
      meetingType: 1,
      status: "scheduled",
      createdById: leaderId,
      createdAt: timestamp,
      seriesId,
      communityId,
    });

    const meetingId2 = await ctx.db.insert("meetings", {
      groupId,
      title: "Dinner #2",
      scheduledAt: dayAfterTomorrow,
      meetingType: 1,
      status: "scheduled",
      createdById: leaderId,
      createdAt: timestamp,
      seriesId,
      communityId,
    });

    const meetingId3 = await ctx.db.insert("meetings", {
      groupId,
      title: "Dinner #3",
      scheduledAt: threeDaysOut,
      meetingType: 1,
      status: "scheduled",
      createdById: leaderId,
      createdAt: timestamp,
      seriesId,
      communityId,
    });

    const leaderToken = `test-token-${leaderId}`;

    return {
      communityId,
      groupId,
      leaderId,
      leaderToken,
      seriesId,
      meetingId1,
      meetingId2,
      meetingId3,
    };
  });
}

// ============================================================================
// meetings.update with scope
// ============================================================================

describe("meetings.update with scope", () => {
  test("scope=this_only updates only the targeted meeting", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    await t.mutation(api.functions.meetings.index.update, {
      token: leaderToken,
      meetingId: meetingId1,
      title: "Updated Dinner",
      scope: "this_only",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));

    expect(m1!.title).toBe("Updated Dinner");
    expect(m2!.title).toBe("Dinner #2");
    expect(m3!.title).toBe("Dinner #3");
  });

  test("default scope (undefined) updates only the targeted meeting", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    await t.mutation(api.functions.meetings.index.update, {
      token: leaderToken,
      meetingId: meetingId1,
      title: "Updated Dinner",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));

    expect(m1!.title).toBe("Updated Dinner");
    expect(m2!.title).toBe("Dinner #2");
    expect(m3!.title).toBe("Dinner #3");
  });

  test("scope=all_in_series updates non-temporal fields across series", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    await t.mutation(api.functions.meetings.index.update, {
      token: leaderToken,
      meetingId: meetingId1,
      title: "New Title",
      note: "New Note",
      scope: "all_in_series",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));

    expect(m1!.title).toBe("New Title");
    expect(m1!.note).toBe("New Note");
    expect(m2!.title).toBe("New Title");
    expect(m2!.note).toBe("New Note");
    expect(m3!.title).toBe("New Title");
    expect(m3!.note).toBe("New Note");
  });

  test("scope=all_in_series does NOT cascade temporal fields (scheduledAt)", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    // Record original scheduledAt values
    const orig1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const orig2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const orig3 = await t.run(async (ctx) => ctx.db.get(meetingId3));

    const newScheduledAt = Date.now() + 10 * 24 * 60 * 60 * 1000; // 10 days out

    await t.mutation(api.functions.meetings.index.update, {
      token: leaderToken,
      meetingId: meetingId1,
      title: "New Title",
      scheduledAt: newScheduledAt,
      scope: "all_in_series",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));

    // meeting1 scheduledAt changed
    expect(m1!.scheduledAt).toBe(newScheduledAt);

    // meeting2 and meeting3 scheduledAt unchanged
    expect(m2!.scheduledAt).toBe(orig2!.scheduledAt);
    expect(m3!.scheduledAt).toBe(orig3!.scheduledAt);

    // Non-temporal cascade worked for all
    expect(m1!.title).toBe("New Title");
    expect(m2!.title).toBe("New Title");
    expect(m3!.title).toBe("New Title");
  });

  test("scope=all_in_series skips overridden meetings", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    // Mark meeting2 as overridden
    await t.run(async (ctx) => {
      await ctx.db.patch(meetingId2, { isOverridden: true });
    });

    await t.mutation(api.functions.meetings.index.update, {
      token: leaderToken,
      meetingId: meetingId1,
      title: "Updated",
      scope: "all_in_series",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));

    expect(m1!.title).toBe("Updated");
    expect(m2!.title).toBe("Dinner #2"); // Skipped because overridden
    expect(m3!.title).toBe("Updated");
  });

  test("scope=all_in_series skips cancelled meetings", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    // Cancel meeting2 directly
    await t.run(async (ctx) => {
      await ctx.db.patch(meetingId2, { status: "cancelled" });
    });

    await t.mutation(api.functions.meetings.index.update, {
      token: leaderToken,
      meetingId: meetingId1,
      title: "Updated",
      scope: "all_in_series",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));

    expect(m1!.title).toBe("Updated");
    expect(m2!.title).toBe("Dinner #2"); // Skipped because cancelled
    expect(m3!.title).toBe("Updated");
  });

  test("scope=all_in_series with no seriesId behaves like this_only", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, groupId, leaderId, communityId, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    // Create a standalone meeting (no seriesId)
    const standaloneMeetingId = await t.run(async (ctx) => {
      return await ctx.db.insert("meetings", {
        groupId,
        title: "Standalone Event",
        scheduledAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
        meetingType: 1,
        status: "scheduled",
        createdById: leaderId,
        createdAt: Date.now(),
        communityId,
      });
    });

    await t.mutation(api.functions.meetings.index.update, {
      token: leaderToken,
      meetingId: standaloneMeetingId,
      title: "New",
      scope: "all_in_series",
    });

    const standalone = await t.run(async (ctx) =>
      ctx.db.get(standaloneMeetingId)
    );
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));

    expect(standalone!.title).toBe("New");
    // Other meetings unaffected
    expect(m2!.title).toBe("Dinner #2");
    expect(m3!.title).toBe("Dinner #3");
  });
});

// ============================================================================
// meetings.cancel with scope
// ============================================================================

describe("meetings.cancel with scope", () => {
  test("scope=this_only cancels only the targeted meeting", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, seriesId, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    await t.mutation(api.functions.meetings.index.cancel, {
      token: leaderToken,
      meetingId: meetingId1,
      scope: "this_only",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));
    const series = await t.run(async (ctx) => ctx.db.get(seriesId));

    expect(m1!.status).toBe("cancelled");
    expect(m2!.status).toBe("scheduled");
    expect(m3!.status).toBe("scheduled");
    expect(series!.status).toBe("active");
  });

  test("scope=all_in_series cancels all meetings and the series", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, seriesId, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    await t.mutation(api.functions.meetings.index.cancel, {
      token: leaderToken,
      meetingId: meetingId1,
      scope: "all_in_series",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));
    const series = await t.run(async (ctx) => ctx.db.get(seriesId));

    expect(m1!.status).toBe("cancelled");
    expect(m2!.status).toBe("cancelled");
    expect(m3!.status).toBe("cancelled");
    expect(series!.status).toBe("cancelled");
  });

  test("scope=all_in_series includes overridden meetings", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, seriesId, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    // Mark meeting2 as overridden
    await t.run(async (ctx) => {
      await ctx.db.patch(meetingId2, { isOverridden: true });
    });

    await t.mutation(api.functions.meetings.index.cancel, {
      token: leaderToken,
      meetingId: meetingId1,
      scope: "all_in_series",
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));
    const series = await t.run(async (ctx) => ctx.db.get(seriesId));

    // Overridden meetings still get cancelled
    expect(m1!.status).toBe("cancelled");
    expect(m2!.status).toBe("cancelled");
    expect(m3!.status).toBe("cancelled");
    expect(series!.status).toBe("cancelled");
  });

  test("default scope (no scope arg) cancels only the targeted meeting", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, seriesId, meetingId1, meetingId2, meetingId3 } =
      await setupSeriesTestData(t);

    await t.mutation(api.functions.meetings.index.cancel, {
      token: leaderToken,
      meetingId: meetingId1,
    });

    const m1 = await t.run(async (ctx) => ctx.db.get(meetingId1));
    const m2 = await t.run(async (ctx) => ctx.db.get(meetingId2));
    const m3 = await t.run(async (ctx) => ctx.db.get(meetingId3));
    const series = await t.run(async (ctx) => ctx.db.get(seriesId));

    expect(m1!.status).toBe("cancelled");
    expect(m2!.status).toBe("scheduled");
    expect(m3!.status).toBe("scheduled");
    expect(series!.status).toBe("active");
  });
});

// ============================================================================
// meetings.createSeriesEvents
// ============================================================================

describe("meetings.createSeriesEvents", () => {
  test("creates series and multiple meetings", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, groupId } = await setupSeriesTestData(t);

    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    const dayAfter = Date.now() + 2 * 24 * 60 * 60 * 1000;
    const threeDays = Date.now() + 3 * 24 * 60 * 60 * 1000;

    const result = await t.mutation(
      api.functions.meetings.index.createSeriesEvents,
      {
        token: leaderToken,
        groupId,
        seriesName: "Movie Night",
        dates: [tomorrow, dayAfter, threeDays],
        title: "Movie",
        meetingType: 1,
      }
    );

    expect(result.seriesId).toBeDefined();
    expect(result.meetingIds).toHaveLength(3);

    // Verify all meetings exist and reference the series
    for (const mid of result.meetingIds) {
      const meeting = await t.run(async (ctx) =>
        ctx.db.get(mid as Id<"meetings">)
      );
      expect(meeting).not.toBeNull();
      expect(meeting!.seriesId).toBe(result.seriesId);
      expect(meeting!.title).toBe("Movie");
      expect(meeting!.status).toBe("scheduled");
    }

    // Verify the series record
    const series = await t.run(async (ctx) =>
      ctx.db.get(result.seriesId as Id<"eventSeries">)
    );
    expect(series).not.toBeNull();
    expect(series!.name).toBe("Movie Night");
    expect(series!.status).toBe("active");
  });

  test("requires at least 1 date", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, groupId } = await setupSeriesTestData(t);

    await expect(
      t.mutation(api.functions.meetings.index.createSeriesEvents, {
        token: leaderToken,
        groupId,
        seriesName: "Solo Event",
        dates: [],
        meetingType: 1,
      })
    ).rejects.toThrow("Series must have at least 1 date");
  });

  test("appends to existing series by name", async () => {
    const t = convexTest(schema, modules);

    const { leaderToken, groupId, seriesId } = await setupSeriesTestData(t);

    // The setup already created a series named "Weekly Dinner" with seriesId.
    // Call createSeriesEvents with the same name.
    const tomorrow = Date.now() + 10 * 24 * 60 * 60 * 1000;
    const dayAfter = Date.now() + 11 * 24 * 60 * 60 * 1000;

    const result = await t.mutation(
      api.functions.meetings.index.createSeriesEvents,
      {
        token: leaderToken,
        groupId,
        seriesName: "Weekly Dinner",
        dates: [tomorrow, dayAfter],
        title: "Dinner Continued",
        meetingType: 1,
      }
    );

    // Should reuse the existing seriesId, not create a new one
    expect(result.seriesId).toBe(seriesId);
    expect(result.meetingIds).toHaveLength(2);
  });

  test("non-leader cannot create series events", async () => {
    const t = convexTest(schema, modules);

    const { groupId, communityId } = await setupSeriesTestData(t);

    // Create a regular member
    const memberId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        firstName: "Regular",
        lastName: "Member",
        phone: "+15559876543",
        createdAt: Date.now(),
      });

      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });

      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: 1,
        status: 1,
        createdAt: Date.now(),
      });

      return userId;
    });

    const memberToken = `test-token-${memberId}`;
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    const dayAfter = Date.now() + 2 * 24 * 60 * 60 * 1000;

    await expect(
      t.mutation(api.functions.meetings.index.createSeriesEvents, {
        token: memberToken,
        groupId,
        seriesName: "Unauthorized Series",
        dates: [tomorrow, dayAfter],
        meetingType: 1,
      })
    ).rejects.toThrow("Only group leaders can create events");
  });
});
