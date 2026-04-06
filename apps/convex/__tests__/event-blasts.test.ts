/**
 * Event Blast Tests (Phase 2)
 *
 * Tests that leaders can send message blasts to RSVPed attendees,
 * and that blast history is recorded correctly.
 *
 * Run with: cd apps/convex && pnpm test __tests__/event-blasts.test.ts
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
  attendeeId: Id<"users">;
  meetingId: Id<"meetings">;
  leaderToken: string;
  memberToken: string;
}

async function setupTestData(t: ReturnType<typeof convexTest>): Promise<TestData> {
  return await t.run(async (ctx) => {
    const ts = Date.now();
    const future = ts + 86400000;

    const communityId = await ctx.db.insert("communities", {
      name: "Test Community", slug: "test-blast", isPublic: true, createdAt: ts, updatedAt: ts,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId, name: "General", slug: "general", isActive: true, displayOrder: 0, createdAt: ts,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId, name: "Blast Group", groupTypeId, isArchived: false, createdAt: ts, updatedAt: ts,
    });

    const leaderId = await ctx.db.insert("users", {
      firstName: "Leader", lastName: "Blaster", phone: "+15551234567", createdAt: ts, updatedAt: ts,
    });
    const memberId = await ctx.db.insert("users", {
      firstName: "Regular", lastName: "Member", createdAt: ts, updatedAt: ts,
    });
    const attendeeId = await ctx.db.insert("users", {
      firstName: "Going", lastName: "Attendee", phone: "+15559876543", createdAt: ts, updatedAt: ts,
    });

    // Community memberships
    for (const uid of [leaderId, memberId, attendeeId]) {
      await ctx.db.insert("userCommunities", {
        userId: uid, communityId, roles: 1, status: 1, createdAt: ts, updatedAt: ts,
      });
    }

    // Group memberships
    await ctx.db.insert("groupMembers", {
      groupId, userId: leaderId, role: "leader", joinedAt: ts, notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId, userId: memberId, role: "member", joinedAt: ts, notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId, userId: attendeeId, role: "member", joinedAt: ts, notificationsEnabled: true,
    });

    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Blast Event",
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
      shortId: "blast123",
    });

    // Create RSVPs — attendee is "Going"
    await ctx.db.insert("meetingRsvps", {
      meetingId, userId: attendeeId, rsvpOptionId: 1, createdAt: ts, updatedAt: ts,
    });
    // Member is "Not Going"
    await ctx.db.insert("meetingRsvps", {
      meetingId, userId: memberId, rsvpOptionId: 2, createdAt: ts, updatedAt: ts,
    });

    return {
      communityId, groupId, leaderId, memberId, attendeeId, meetingId,
      leaderToken: `test-token-${leaderId}`,
      memberToken: `test-token-${memberId}`,
    };
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("Event Blasts", () => {
  describe("eventBlasts schema", () => {
    test("eventBlasts table accepts valid records", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await t.run(async (ctx) => {
        const blastId = await ctx.db.insert("eventBlasts", {
          meetingId: data.meetingId,
          groupId: data.groupId,
          communityId: data.communityId,
          sentById: data.leaderId,
          message: "Reminder: bring snacks!",
          channels: ["push", "sms"],
          recipientCount: 1,
          status: "sent",
          results: { pushSucceeded: 1, pushFailed: 0, smsSucceeded: 1, smsFailed: 0 },
          createdAt: Date.now(),
        });

        const blast = await ctx.db.get(blastId);
        expect(blast).not.toBeNull();
        expect(blast?.message).toBe("Reminder: bring snacks!");
        expect(blast?.channels).toEqual(["push", "sms"]);
        expect(blast?.recipientCount).toBe(1);
      });
    });

    test("eventBlasts by_meeting index works", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await t.run(async (ctx) => {
        await ctx.db.insert("eventBlasts", {
          meetingId: data.meetingId,
          groupId: data.groupId,
          communityId: data.communityId,
          sentById: data.leaderId,
          message: "First blast",
          channels: ["push"],
          recipientCount: 1,
          status: "sent",
          createdAt: Date.now(),
        });
        await ctx.db.insert("eventBlasts", {
          meetingId: data.meetingId,
          groupId: data.groupId,
          communityId: data.communityId,
          sentById: data.leaderId,
          message: "Second blast",
          channels: ["sms"],
          recipientCount: 1,
          status: "sent",
          createdAt: Date.now() + 1000,
        });

        const blasts = await ctx.db
          .query("eventBlasts")
          .withIndex("by_meeting", (q) => q.eq("meetingId", data.meetingId))
          .collect();
        expect(blasts).toHaveLength(2);
      });
    });
  });

  describe("initiate mutation", () => {
    test("leader can initiate a blast", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      const result = await t.mutation(
        // @ts-expect-error - test token auth
        "functions/eventBlasts:initiate" as any,
        {
          token: data.leaderToken,
          meetingId: data.meetingId,
          message: "Don't forget to RSVP!",
          channels: ["push"],
        }
      );

      expect(result.success).toBe(true);
    });

    test("non-leader cannot initiate a blast", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      await expect(
        t.mutation(
          // @ts-expect-error - test token auth
          "functions/eventBlasts:initiate" as any,
          {
            token: data.memberToken,
            meetingId: data.meetingId,
            message: "Sneaky blast",
            channels: ["push"],
          }
        )
      ).rejects.toThrow("Only group leaders");
    });
  });

  describe("getRsvpUserIds helper", () => {
    test("returns only users with matching RSVP option", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      const goingUsers = await t.run(async (ctx) => {
        const rsvps = await ctx.db
          .query("meetingRsvps")
          .withIndex("by_meeting", (q) => q.eq("meetingId", data.meetingId))
          .collect();
        return rsvps.filter((r) => r.rsvpOptionId === 1).map((r) => r.userId);
      });

      expect(goingUsers).toHaveLength(1);
      expect(goingUsers[0]).toBe(data.attendeeId);
    });
  });

  describe("blast list query", () => {
    test("returns blasts with sender name", async () => {
      const t = convexTest(schema, modules);
      const data = await setupTestData(t);

      // Insert a blast record directly
      await t.run(async (ctx) => {
        await ctx.db.insert("eventBlasts", {
          meetingId: data.meetingId,
          groupId: data.groupId,
          communityId: data.communityId,
          sentById: data.leaderId,
          message: "Test blast message",
          channels: ["push"],
          recipientCount: 1,
          status: "sent",
          createdAt: Date.now(),
        });
      });

      const blasts = await t.query(
        // @ts-expect-error - test token auth
        "functions/eventBlasts:list" as any,
        { meetingId: data.meetingId }
      );

      expect(blasts).toHaveLength(1);
      expect(blasts[0].message).toBe("Test blast message");
      expect(blasts[0].sentByName).toBe("Leader Blaster");
    });
  });
});
