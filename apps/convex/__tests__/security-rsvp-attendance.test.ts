/**
 * Security Tests - RSVP and Attendance Permissions
 *
 * These tests verify permission behavior for RSVP and attendance features
 * using the official convex-test library.
 *
 * **Event Permission Levels:**
 * - Group-only events: only group members can RSVP/attend
 * - Community-wide events: any community member can RSVP/attend
 * - Public events: anyone can RSVP/attend
 *
 * Run with: cd convex && pnpm test security-rsvp-attendance.test.ts
 */

import { convexTest } from "convex-test";
import { vi, expect, test, describe, beforeEach } from "vitest";

async function drainScheduledFunctions(t: ReturnType<typeof convexTest>) {
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } catch {
    // Expected - notification actions may fail in test environment
  }
}
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Test Helper Functions
// ============================================================================

/**
 * Generate a valid JWT token for a user ID
 */
async function generateTestToken(userId: Id<"users">): Promise<string> {
  const { accessToken } = await generateTokens(userId);
  return accessToken;
}

/**
 * Create a test setup with common data for RSVP/attendance tests
 */
async function createTestSetup(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    // Create community
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Create group type
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: Date.now(),
      displayOrder: 1,
    });

    // Create group
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Create users
    const leaderId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "User",
      email: "leader@test.com",
      phone: "+15555551001",
      createdAt: Date.now(),
    });

    const memberId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "User",
      email: "member@test.com",
      phone: "+15555551002",
      createdAt: Date.now(),
    });

    const outsiderId = await ctx.db.insert("users", {
      firstName: "Outsider",
      lastName: "User",
      email: "outsider@test.com",
      phone: "+15555551003",
      createdAt: Date.now(),
    });

    // Add leader to group
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });

    // Add member to group
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });

    // Add leader and member to community
    await ctx.db.insert("userCommunities", {
      userId: leaderId,
      communityId,
      roles: 2, // Leader role
      status: 1, // Active
      createdAt: Date.now(),
    });

    await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: 1, // Member role
      status: 1, // Active
      createdAt: Date.now(),
    });

    // Note: outsider is not added to group or community

    // Generate tokens for each user
    const leaderToken = await generateTestToken(leaderId);
    const memberToken = await generateTestToken(memberId);
    const outsiderToken = await generateTestToken(outsiderId);

    return {
      communityId,
      groupTypeId,
      groupId,
      leaderId,
      memberId,
      outsiderId,
      leaderToken,
      memberToken,
      outsiderToken,
    };
  });
}

/**
 * Create a meeting with specified visibility
 */
async function createMeeting(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  overrides: {
    visibility?: "group" | "community" | "public";
    rsvpEnabled?: boolean;
    status?: "scheduled" | "cancelled" | "completed";
    scheduledAt?: number;
  } = {}
) {
  return await t.run(async (ctx) => {
    const scheduledAt = overrides.scheduledAt ?? Date.now() + 86400000; // Tomorrow
    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      scheduledAt,
      status: overrides.status ?? "scheduled",
      meetingType: 1, // In-person
      visibility: overrides.visibility ?? "group",
      rsvpEnabled: overrides.rsvpEnabled ?? true,
      rsvpOptions: [
        { id: 1, label: "Yes", enabled: true },
        { id: 2, label: "No", enabled: true },
        { id: 3, label: "Maybe", enabled: true },
      ],
      createdAt: Date.now(),
    });
    return meetingId;
  });
}

// ============================================================================
// RSVP PERMISSION TESTS
// ============================================================================

describe("RSVP Permission Tests", () => {
  describe("Group-only Event RSVP Restrictions", () => {
    test("non-group-member cannot RSVP to group-only event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Outsider is authenticated but NOT a member of the group
      await expect(
        t.mutation(api.functions.meetingRsvps.submit, {
          token: setup.outsiderToken,
          meetingId,
          optionId: 1,
        })
      ).rejects.toThrow("You must be a group member to RSVP to this event");
    });

    test("former group member (leftAt set) cannot RSVP to group-only event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Create a former member (leftAt set)
      const { formerId, formerToken } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          firstName: "Former",
          lastName: "Member",
          email: "former@test.com",
          createdAt: Date.now(),
        });

        // Add to group but with leftAt set
        await ctx.db.insert("groupMembers", {
          groupId: setup.groupId,
          userId,
          role: "member",
          joinedAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
          leftAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // Left 7 days ago
          notificationsEnabled: true,
        });

        const token = await generateTestToken(userId);
        return { formerId: userId, formerToken: token };
      });

      await expect(
        t.mutation(api.functions.meetingRsvps.submit, {
          token: formerToken,
          meetingId,
          optionId: 1,
        })
      ).rejects.toThrow("You must be a group member to RSVP to this event");
    });

    test("active group member can RSVP to group-only event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Member should be able to RSVP
      const result = await t.mutation(api.functions.meetingRsvps.submit, {
        token: setup.memberToken,
        meetingId,
        optionId: 1,
      });
      await drainScheduledFunctions(t);
      expect(result).toEqual({
        success: true,
        optionId: 1,
      });
    });
  });

  describe("Community-wide Event RSVP Restrictions", () => {
    test("non-community-member cannot RSVP to community-wide event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "community",
      });

      // Outsider is not a community member
      await expect(
        t.mutation(api.functions.meetingRsvps.submit, {
          token: setup.outsiderToken,
          meetingId,
          optionId: 1,
        })
      ).rejects.toThrow("You must be a community member to RSVP to this event");
    });

    test("community member (non-group member) can RSVP to community-wide event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "community",
      });

      // Create a community member who is not in the group
      const { communityMemberToken } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          firstName: "Community",
          lastName: "Member",
          email: "community@test.com",
          createdAt: Date.now(),
        });

        // Add to community but not to the group
        await ctx.db.insert("userCommunities", {
          userId,
          communityId: setup.communityId,
          roles: 1,
          status: 1,
          createdAt: Date.now(),
        });

        const token = await generateTestToken(userId);
        return { communityMemberToken: token };
      });

      const result = await t.mutation(api.functions.meetingRsvps.submit, {
        token: communityMemberToken,
        meetingId,
        optionId: 1,
      });
      await drainScheduledFunctions(t);
      expect(result).toEqual({
        success: true,
        optionId: 1,
      });
    });
  });

  describe("Public Event RSVP", () => {
    test("anyone authenticated can RSVP to public event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "public",
      });

      // Even outsider can RSVP to public events
      const result = await t.mutation(api.functions.meetingRsvps.submit, {
        token: setup.outsiderToken,
        meetingId,
        optionId: 1,
      });
      await drainScheduledFunctions(t);
      expect(result).toEqual({
        success: true,
        optionId: 1,
      });
    });
  });
});

// ============================================================================
// ATTENDANCE PERMISSION TESTS
// ============================================================================

describe("Attendance Permission Tests", () => {
  describe("Leader Attendance Marking", () => {
    test("leader can mark attendance for any group member", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Leader marks attendance for member
      const result = await t.mutation(api.functions.meetings.index.markAttendance, {
        token: setup.leaderToken,
        meetingId,
        userId: setup.memberId,
        status: 1, // Attended
      });

      expect(result).toBeDefined();
    });
  });

  describe("Non-Leader Attendance Restrictions", () => {
    test("non-leader cannot mark attendance for someone else", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Member tries to mark attendance for leader
      await expect(
        t.mutation(api.functions.meetings.index.markAttendance, {
          token: setup.memberToken,
          meetingId,
          userId: setup.leaderId, // Marking for someone else
          status: 1,
        })
      ).rejects.toThrow("Only leaders can mark attendance for others");
    });

    test("member can mark their own attendance (self-reporting)", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Member marks their own attendance using selfReportAttendance
      const result = await t.mutation(
        api.functions.meetings.index.selfReportAttendance,
        {
          token: setup.memberToken,
          meetingId,
          status: 1,
        }
      );

      expect(result).toBeDefined();
    });
  });

  describe("Group Membership Requirements for Self-Reporting", () => {
    test("non-group-member cannot self-report attendance at group-only event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      await expect(
        t.mutation(api.functions.meetings.index.selfReportAttendance, {
          token: setup.outsiderToken,
          meetingId,
          status: 1,
        })
      ).rejects.toThrow("You must be a group member to attend this event");
    });

    test("community member can self-report at community-wide event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "community",
      });

      // Create a community member who is not in the group
      const { communityMemberToken } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", {
          firstName: "Community",
          lastName: "Attendee",
          email: "attendee@test.com",
          createdAt: Date.now(),
        });

        await ctx.db.insert("userCommunities", {
          userId,
          communityId: setup.communityId,
          roles: 1,
          status: 1,
          createdAt: Date.now(),
        });

        const token = await generateTestToken(userId);
        return { communityMemberToken: token };
      });

      const result = await t.mutation(
        api.functions.meetings.index.selfReportAttendance,
        {
          token: communityMemberToken,
          meetingId,
          status: 1,
        }
      );

      expect(result).toBeDefined();
    });

    test("anyone authenticated can self-report at public event", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "public",
      });

      // Even outsider can report attendance at public events
      const result = await t.mutation(
        api.functions.meetings.index.selfReportAttendance,
        {
          token: setup.outsiderToken,
          meetingId,
          status: 1,
        }
      );

      expect(result).toBeDefined();
    });
  });
});

// ============================================================================
// RSVP LIST VISIBILITY TESTS
// ============================================================================

describe("RSVP List Visibility Tests", () => {
  describe("RSVP List Access Control", () => {
    test("unauthenticated user sees limited RSVP data with preview", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId);

      // Leader RSVPs
      await t.mutation(api.functions.meetingRsvps.submit, {
        token: setup.leaderToken,
        meetingId,
        optionId: 1,
      });
      await drainScheduledFunctions(t);
      // No token = unauthenticated
      const result = await t.query(api.functions.meetingRsvps.list, {
        meetingId,
      });

      // Should have limitedAccess flag
      expect(result.limitedAccess).toBe(true);
      expect(result.total).toBe(1);
      // Should see counts
      expect(result.rsvps[0].count).toBe(1);
      // Should see limited user preview (first 10 users)
      expect(result.rsvps[0].users.length).toBeGreaterThan(0);
      expect(result.rsvps[0].users.length).toBeLessThanOrEqual(10);
      // User should have basic info (for profile picture display)
      expect(result.rsvps[0].users[0]).toHaveProperty('id');
      expect(result.rsvps[0].users[0]).toHaveProperty('firstName');
    });

    test("authenticated user who has not RSVPed sees limited data with preview", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId);

      // Leader RSVPs
      await t.mutation(api.functions.meetingRsvps.submit, {
        token: setup.leaderToken,
        meetingId,
        optionId: 1,
      });
      await drainScheduledFunctions(t);
      // Member (who has NOT RSVPed) views the list
      const result = await t.query(api.functions.meetingRsvps.list, {
        meetingId,
        token: setup.memberToken,
      });

      // Should have limitedAccess flag
      expect(result.limitedAccess).toBe(true);
      expect(result.total).toBe(1);
      // Should see limited user preview (first 10 users)
      expect(result.rsvps[0].users.length).toBeGreaterThan(0);
      expect(result.rsvps[0].users.length).toBeLessThanOrEqual(10);
    });

    test("authenticated user who has RSVPed sees full list", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId);

      // Both leader and member RSVP
      await t.mutation(api.functions.meetingRsvps.submit, {
        token: setup.leaderToken,
        meetingId,
        optionId: 1,
      });
      await drainScheduledFunctions(t);
      await t.mutation(api.functions.meetingRsvps.submit, {
        token: setup.memberToken,
        meetingId,
        optionId: 1,
      });
      await drainScheduledFunctions(t);
      // Member (who HAS RSVPed) views the list
      const result = await t.query(api.functions.meetingRsvps.list, {
        meetingId,
        token: setup.memberToken,
      });

      // Should NOT have limitedAccess flag
      expect(result.limitedAccess).toBeUndefined();
      expect(result.total).toBe(2);
      // Should have user details
      expect(result.rsvps[0].users.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe("RSVP/Attendance Edge Cases", () => {
  describe("Cancelled Meeting Restrictions", () => {
    test("cannot RSVP to cancelled meeting", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        status: "cancelled",
      });

      await expect(
        t.mutation(api.functions.meetingRsvps.submit, {
          token: setup.memberToken,
          meetingId,
          optionId: 1,
        })
      ).rejects.toThrow("Cannot RSVP to cancelled event");
    });
  });

  describe("Past Meeting Restrictions", () => {
    test("cannot RSVP to past meeting", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        scheduledAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
        status: "completed",
      });

      await expect(
        t.mutation(api.functions.meetingRsvps.submit, {
          token: setup.memberToken,
          meetingId,
          optionId: 1,
        })
      ).rejects.toThrow("Cannot RSVP to past event");
    });
  });

  describe("RSVP-Disabled Meeting Restrictions", () => {
    test("cannot RSVP when RSVP is disabled", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        rsvpEnabled: false,
      });

      await expect(
        t.mutation(api.functions.meetingRsvps.submit, {
          token: setup.memberToken,
          meetingId,
          optionId: 1,
        })
      ).rejects.toThrow("RSVP is not enabled for this event");
    });
  });
});

// ============================================================================
// GUEST MANAGEMENT TESTS (Issue #303)
// ============================================================================

describe("Guest Management Tests (Issue #303)", () => {
  describe("Add Guest", () => {
    test("leader can add a guest to a meeting", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      const result = await t.mutation(api.functions.meetings.attendance.addGuest, {
        token: setup.leaderToken,
        meetingId,
        firstName: "John",
        lastName: "Guest",
      });

      expect(result).toBeDefined();
    });
  });

  describe("Remove Guest", () => {
    test("leader can remove a guest from a meeting", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // First add a guest
      const guestId = await t.mutation(api.functions.meetings.attendance.addGuest, {
        token: setup.leaderToken,
        meetingId,
        firstName: "John",
        lastName: "Guest",
      });

      // Then remove it
      const result = await t.mutation(api.functions.meetings.attendance.removeGuest, {
        token: setup.leaderToken,
        guestId,
      });

      expect(result).toEqual({ success: true });

      // Verify guest is removed
      const guests = await t.query(api.functions.meetings.attendance.listGuests, {
        meetingId,
      });
      expect(guests.length).toBe(0);
    });

    test("non-leader cannot remove a guest", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Leader adds a guest
      const guestId = await t.mutation(api.functions.meetings.attendance.addGuest, {
        token: setup.leaderToken,
        meetingId,
        firstName: "John",
        lastName: "Guest",
      });

      // Member tries to remove it - should fail
      await expect(
        t.mutation(api.functions.meetings.attendance.removeGuest, {
          token: setup.memberToken,
          guestId,
        })
      ).rejects.toThrow("Only leaders can remove guests");
    });

    test("cannot remove non-existent guest", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Create a guest, then delete it directly to have a valid but deleted ID
      const guestId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("meetingGuests", {
          meetingId,
          firstName: "Deleted",
          lastName: "Guest",
          recordedAt: Date.now(),
        });
        // Delete it immediately
        await ctx.db.delete(id);
        return id;
      });

      await expect(
        t.mutation(api.functions.meetings.attendance.removeGuest, {
          token: setup.leaderToken,
          guestId,
        })
      ).rejects.toThrow("Guest not found");
    });
  });

  describe("Update Guest", () => {
    test("leader can update a guest's information", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // First add a guest
      const guestId = await t.mutation(api.functions.meetings.attendance.addGuest, {
        token: setup.leaderToken,
        meetingId,
        firstName: "John",
        lastName: "Guest",
      });

      // Update the guest
      const result = await t.mutation(api.functions.meetings.attendance.updateGuest, {
        token: setup.leaderToken,
        guestId,
        firstName: "Jane",
        lastName: "Updated",
        notes: "Updated notes",
      });

      expect(result).toBeDefined();
      expect(result?.firstName).toBe("Jane");
      expect(result?.lastName).toBe("Updated");
      expect(result?.notes).toBe("Updated notes");
    });

    test("non-leader cannot update a guest", async () => {
      const t = convexTest(schema, modules);

      const setup = await createTestSetup(t);
      const meetingId = await createMeeting(t, setup.groupId, {
        visibility: "group",
      });

      // Leader adds a guest
      const guestId = await t.mutation(api.functions.meetings.attendance.addGuest, {
        token: setup.leaderToken,
        meetingId,
        firstName: "John",
        lastName: "Guest",
      });

      // Member tries to update it - should fail
      await expect(
        t.mutation(api.functions.meetings.attendance.updateGuest, {
          token: setup.memberToken,
          guestId,
          firstName: "Updated",
        })
      ).rejects.toThrow("Only leaders can update guests");
    });
  });
});

// ============================================================================
// SUMMARY OF SECURITY REQUIREMENTS
// ============================================================================

/**
 * SECURITY REQUIREMENTS TESTED:
 *
 * 1. RSVP Submit (meetingRsvps.submit):
 *    [x] Membership check for group-only events
 *    [x] Community membership check for community-wide events
 *    [x] Public events allow any authenticated user
 *    [x] Check for cancelled meetings
 *    [x] Check for past meetings
 *    [x] Check for rsvpEnabled flag
 *    [x] Former members (leftAt set) cannot RSVP
 *
 * 2. Attendance Marking (meetings.markAttendance):
 *    [x] Leader role required to mark others' attendance
 *    [x] Members can mark their own attendance
 *
 * 3. Self-Report Attendance (meetings.selfReportAttendance):
 *    [x] Membership check for group-only events
 *    [x] Community membership check for community-wide events
 *    [x] Public events allow any authenticated user
 *
 * 4. RSVP List (meetingRsvps.list):
 *    [x] Supports unauthenticated access with limited preview
 *    [x] Limited visibility (first 10 users per option) for non-RSVPed users
 *    [x] Full visibility for RSVPed users
 *
 * 5. Guest Management (Issue #303):
 *    [x] Leaders can add guests
 *    [x] Leaders can remove guests
 *    [x] Leaders can update guests
 *    [x] Non-leaders cannot remove guests
 *    [x] Non-leaders cannot update guests
 */
