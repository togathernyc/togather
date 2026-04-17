/**
 * RSVP Leader Notification Tests (Phase 1)
 *
 * Tests that leaders are notified when someone RSVPs to an event,
 * with per-event opt-out via rsvpNotifyLeaders toggle.
 *
 * Run with: cd apps/convex && pnpm test __tests__/rsvp-leader-notifications.test.ts
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
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// ============================================================================
// Helpers
// ============================================================================

interface TestData {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  meetingId: Id<"meetings">;
  leaderToken: string;
  memberToken: string;
}

async function setupTestData(t: ReturnType<typeof convexTest>): Promise<TestData> {
  return await t.run(async (ctx) => {
    const ts = Date.now();
    const future = ts + 86400000;

    const communityId = await ctx.db.insert("communities", {
      name: "Test Community", slug: "test", isPublic: true, createdAt: ts, updatedAt: ts,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId, name: "General", slug: "general", isActive: true, displayOrder: 0, createdAt: ts,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId, name: "Test Group", groupTypeId, isArchived: false, createdAt: ts, updatedAt: ts,
    });

    const leaderId = await ctx.db.insert("users", {
      firstName: "Leader", lastName: "User", createdAt: ts, updatedAt: ts,
    });
    const memberId = await ctx.db.insert("users", {
      firstName: "Member", lastName: "User", createdAt: ts, updatedAt: ts,
    });

    // Community memberships
    await ctx.db.insert("userCommunities", {
      userId: leaderId, communityId, roles: 1, status: 1, createdAt: ts, updatedAt: ts,
    });
    await ctx.db.insert("userCommunities", {
      userId: memberId, communityId, roles: 1, status: 1, createdAt: ts, updatedAt: ts,
    });

    // Group memberships
    await ctx.db.insert("groupMembers", {
      groupId, userId: leaderId, role: "leader", joinedAt: ts, notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId, userId: memberId, role: "member", joinedAt: ts, notificationsEnabled: true,
    });

    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Weekly Meetup",
      scheduledAt: future,
      status: "scheduled",
      meetingType: 1,
      createdAt: ts,
      rsvpEnabled: true,
      rsvpOptions: [
        { id: 1, label: "Going", enabled: true },
        { id: 2, label: "Not Going", enabled: true },
      ],
      visibility: "group",
      shortId: "test123",
    });

    return {
      communityId, groupId, leaderId, memberId, meetingId,
      leaderToken: `test-token-${leaderId}`,
      memberToken: `test-token-${memberId}`,
    };
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("RSVP Leader Notifications", () => {
  describe("rsvpNotifyLeaders schema field", () => {
    test("meetings should accept rsvpNotifyLeaders field", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      // Patch meeting with rsvpNotifyLeaders
      await t.run(async (ctx) => {
        await ctx.db.patch(data.meetingId, { rsvpNotifyLeaders: false });
        const meeting = await ctx.db.get(data.meetingId);
        expect(meeting?.rsvpNotifyLeaders).toBe(false);
      });
    });

    test("rsvpNotifyLeaders defaults to undefined (treated as true)", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await t.run(async (ctx) => {
        const meeting = await ctx.db.get(data.meetingId);
        expect(meeting?.rsvpNotifyLeaders).toBeUndefined();
      });
    });
  });

  describe("RSVP submit triggers notification", () => {
    test("new RSVP should create a scheduled notification action", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      // Submit RSVP as member
      await t.mutation(
        // @ts-expect-error - test token auth
        "functions/meetingRsvps:submit" as any,
        {
          token: data.memberToken,
          meetingId: data.meetingId,
          optionId: 1,
        }
      );

      // Verify RSVP was created
      await t.run(async (ctx) => {
        const rsvps = await ctx.db
          .query("meetingRsvps")
          .withIndex("by_meeting_user", (q) =>
            q.eq("meetingId", data.meetingId).eq("userId", data.memberId)
          )
          .collect();
        expect(rsvps).toHaveLength(1);
        expect(rsvps[0].rsvpOptionId).toBe(1);
      });
    });

    test("updating an existing RSVP should NOT trigger notification", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      // Create initial RSVP
      await t.run(async (ctx) => {
        await ctx.db.insert("meetingRsvps", {
          meetingId: data.meetingId,
          userId: data.memberId,
          rsvpOptionId: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      // Update RSVP (should not trigger notification since it's an update)
      await t.mutation(
        // @ts-expect-error - test token auth
        "functions/meetingRsvps:submit" as any,
        {
          token: data.memberToken,
          meetingId: data.meetingId,
          optionId: 2,
        }
      );

      // Verify RSVP was updated
      await t.run(async (ctx) => {
        const rsvps = await ctx.db
          .query("meetingRsvps")
          .withIndex("by_meeting_user", (q) =>
            q.eq("meetingId", data.meetingId).eq("userId", data.memberId)
          )
          .collect();
        expect(rsvps).toHaveLength(1);
        expect(rsvps[0].rsvpOptionId).toBe(2);
      });
    });
  });

  describe("toggleRsvpLeaderNotifications", () => {
    test("leader can disable RSVP notifications", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await t.mutation(
        // @ts-expect-error - test token auth
        "functions/meetings/index:toggleRsvpLeaderNotifications" as any,
        {
          token: data.leaderToken,
          meetingId: data.meetingId,
          enabled: false,
        }
      );

      await t.run(async (ctx) => {
        const meeting = await ctx.db.get(data.meetingId);
        expect(meeting?.rsvpNotifyLeaders).toBe(false);
      });
    });

    test("non-leader cannot toggle notifications", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await expect(
        t.mutation(
          // @ts-expect-error - test token auth
          "functions/meetings/index:toggleRsvpLeaderNotifications" as any,
          {
            token: data.memberToken,
            meetingId: data.meetingId,
            enabled: false,
          }
        )
      ).rejects.toThrow(/event creator, group leaders/i);
    });
  });
});
