/**
 * Security Vulnerability Tests - Groups & Meetings
 *
 * These tests verify that security checks are properly implemented:
 * 1. Group update requires leadership
 * 2. Group role changes require leadership
 * 3. Meeting cancel requires leadership
 * 4. Meeting update requires leadership
 * 5. Join request review requires community admin
 * 6. Private groups require approval to join
 * 7. Adding members requires leadership
 * 8. Listing join requests requires community admin
 *
 * Run with: cd convex && pnpm test __tests__/security-groups-meetings.test.ts
 */

// Mock the jose library to bypass JWT verification in tests
// Note: vi.mock calls are hoisted to the top of the file by Vitest
import { vi, expect, test, describe, beforeEach } from "vitest";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    // Extract userId from token format: "test-token-{userId}"
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
import { afterEach, beforeEach } from "vitest";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// Use fake timers for all tests to handle scheduled functions properly
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Test Setup Helper
// ============================================================================

interface TestSetup {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupId: Id<"groups">;
  privateGroupId: Id<"groups">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  nonMemberId: Id<"users">;
  adminId: Id<"users">;
  meetingId: Id<"meetings">;
  leaderToken: string;
  memberToken: string;
  nonMemberToken: string;
  adminToken: string;
}

async function setupTestData(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
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
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });

    // Create users
    const leaderId = await ctx.db.insert("users", {
      firstName: "Group",
      lastName: "Leader",
      email: "leader@test.com",
      phone: "+12025551001",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const memberId = await ctx.db.insert("users", {
      firstName: "Regular",
      lastName: "Member",
      email: "member@test.com",
      phone: "+12025551002",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const nonMemberId = await ctx.db.insert("users", {
      firstName: "Non",
      lastName: "Member",
      email: "nonmember@test.com",
      phone: "+12025551003",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const adminId = await ctx.db.insert("users", {
      firstName: "Community",
      lastName: "Admin",
      email: "admin@test.com",
      phone: "+12025551004",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create public group
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      description: "A test group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create private group
    const privateGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Private Group",
      description: "A private test group",
      isArchived: false,
      isPublic: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add leader to group
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Add member to group
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Add community admin membership (role >= 3 is admin)
    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: 3, // Admin role
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add regular community membership for member
    await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: 1, // Regular member
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create a meeting
    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Test Meeting",
      scheduledAt: timestamp + 86400000, // Tomorrow
      meetingType: 1, // In-person
      status: "scheduled",
      createdById: leaderId,
      createdAt: timestamp,
    });

    return {
      communityId,
      groupTypeId,
      groupId,
      privateGroupId,
      leaderId,
      memberId,
      nonMemberId,
      adminId,
      meetingId,
      leaderToken: `test-token-${leaderId}`,
      memberToken: `test-token-${memberId}`,
      nonMemberToken: `test-token-${nonMemberId}`,
      adminToken: `test-token-${adminId}`,
    };
  });
}

// ============================================================================
// VULNERABILITY #1: Group Update Bypass
// ============================================================================

describe("SECURITY: Group Update requires leadership", () => {
  test("Non-leader cannot update group settings", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Regular member tries to update group
    await expect(
      t.mutation(api.functions.groups.index.update, {
        token: setup.memberToken,
        groupId: setup.groupId,
        name: "Hacked Group Name",
        description: "Malicious description change",
      })
    ).rejects.toThrow("You don't have permission to edit this group");
  });

  test("Non-member cannot update group settings", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Non-member tries to update group
    await expect(
      t.mutation(api.functions.groups.index.update, {
        token: setup.nonMemberToken,
        groupId: setup.groupId,
        name: "Attacked from outside",
      })
    ).rejects.toThrow("You don't have permission to edit this group");
  });

  test("Leader can update group settings", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Leader should be able to update
    const result = await t.mutation(api.functions.groups.index.update, {
      token: setup.leaderToken,
      groupId: setup.groupId,
      name: "Updated Group Name",
    });

    expect(result).toBeDefined();
    expect(result?.name).toBe("Updated Group Name");
  });
});

// ============================================================================
// VULNERABILITY #2: Group Role Escalation
// ============================================================================

describe("SECURITY: Group Role changes require leadership", () => {
  test("Member cannot promote themselves to leader", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groups.index.updateMemberRole, {
        token: setup.memberToken,
        groupId: setup.groupId,
        targetUserId: setup.memberId,
        role: "leader",
      })
    ).rejects.toThrow("Only group leaders can change member roles");
  });

  test("Member cannot demote a leader", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groups.index.updateMemberRole, {
        token: setup.memberToken,
        groupId: setup.groupId,
        targetUserId: setup.leaderId,
        role: "member",
      })
    ).rejects.toThrow("Only group leaders can change member roles");
  });

  test("Non-member cannot modify group roles", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groups.index.updateMemberRole, {
        token: setup.nonMemberToken,
        groupId: setup.groupId,
        targetUserId: setup.memberId,
        role: "leader",
      })
    ).rejects.toThrow("Only group leaders can change member roles");
  });

  test("Leader can change member roles", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.mutation(api.functions.groups.index.updateMemberRole, {
      token: setup.leaderToken,
      groupId: setup.groupId,
      targetUserId: setup.memberId,
      role: "leader",
    });

    expect(result).toBe(true);
  });
});

// ============================================================================
// VULNERABILITY #3: Meeting Cancel Bypass
// ============================================================================

describe("SECURITY: Meeting Cancel requires leadership", () => {
  test("Non-leader cannot cancel meeting", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.meetings.index.cancel, {
        token: setup.memberToken,
        meetingId: setup.meetingId,
        cancellationReason: "Malicious cancellation",
      })
    ).rejects.toThrow("You do not have permission to cancel this event");
  });

  test("Non-member cannot cancel meeting", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.meetings.index.cancel, {
        token: setup.nonMemberToken,
        meetingId: setup.meetingId,
        cancellationReason: "External attack",
      })
    ).rejects.toThrow("You do not have permission to cancel this event");
  });

  test("Leader can cancel meeting", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.mutation(api.functions.meetings.index.cancel, {
      token: setup.leaderToken,
      meetingId: setup.meetingId,
      cancellationReason: "Legitimate cancellation",
    });

    expect(result).toBe(true);
  });
});

// ============================================================================
// VULNERABILITY #4: Meeting Update Bypass
// ============================================================================

describe("SECURITY: Meeting Update requires leadership", () => {
  test("Non-leader cannot update meeting", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.meetings.index.update, {
        token: setup.memberToken,
        meetingId: setup.meetingId,
        title: "Hijacked Meeting Title",
        note: "Meeting hijacked by attacker",
      })
    ).rejects.toThrow("You do not have permission to update this event");
  });

  test("Non-member cannot update meeting", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.meetings.index.update, {
        token: setup.nonMemberToken,
        meetingId: setup.meetingId,
        title: "External Attack",
      })
    ).rejects.toThrow("You do not have permission to update this event");
  });

  test("Leader can update meeting", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.mutation(api.functions.meetings.index.update, {
      token: setup.leaderToken,
      meetingId: setup.meetingId,
      title: "Updated Meeting Title",
    });

    expect(result).toBeDefined();
    expect(result?.title).toBe("Updated Meeting Title");
  });
});

// ============================================================================
// VULNERABILITY #5: Join Request Approval Bypass
// ============================================================================

describe("SECURITY: Join Request Review requires community admin", () => {
  test("Non-admin cannot approve join requests", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // First, create a pending join request and capture membership ID
    const membershipId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId: setup.nonMemberId,
        role: "member",
        joinedAt: Date.now(),
        leftAt: Date.now(),
        notificationsEnabled: true,
        requestStatus: "pending",
        requestedAt: Date.now(),
      });
    });

    // Regular member (not community admin) tries to approve
    await expect(
      t.mutation(api.functions.admin.index.reviewPendingRequest, {
        token: setup.memberToken,
        communityId: setup.communityId,
        membershipId,
        action: "accept",
      })
    ).rejects.toThrow("Community admin role required");
  });

  test("Non-admin cannot decline join requests", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a pending join request and capture membership ID
    const membershipId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId: setup.nonMemberId,
        role: "member",
        joinedAt: Date.now(),
        leftAt: Date.now(),
        notificationsEnabled: true,
        requestStatus: "pending",
        requestedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.functions.admin.index.reviewPendingRequest, {
        token: setup.memberToken,
        communityId: setup.communityId,
        membershipId,
        action: "decline",
      })
    ).rejects.toThrow("Community admin role required");
  });

  test("Community admin can approve join requests", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a pending join request and capture membership ID
    const membershipId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId: setup.nonMemberId,
        role: "member",
        joinedAt: Date.now(),
        leftAt: Date.now(),
        notificationsEnabled: true,
        requestStatus: "pending",
        requestedAt: Date.now(),
      });
    });

    const result = await t.mutation(api.functions.admin.index.reviewPendingRequest, {
      token: setup.adminToken,
      communityId: setup.communityId,
      membershipId,
      action: "accept",
    });

    expect(result.status).toBe("accepted");

    // Run any scheduled functions to completion (notifications)
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

// ============================================================================
// VULNERABILITY #6: Private Group Join Bypass
// ============================================================================

describe("SECURITY: Private groups require approval", () => {
  test("User cannot directly join private group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groups.index.join, {
        token: setup.nonMemberToken,
        groupId: setup.privateGroupId,
      })
    ).rejects.toThrow("This is a private group");
  });

  test("User can join public group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.mutation(api.functions.groups.index.join, {
      token: setup.nonMemberToken,
      groupId: setup.groupId,
    });

    expect(result).toBeDefined();
  });
});

// ============================================================================
// VULNERABILITY #7: Add Members Without Permission
// ============================================================================

describe("SECURITY: Adding members requires leadership", () => {
  test("Non-leader cannot add members to group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groupMembers.add, {
        token: setup.memberToken,
        groupId: setup.groupId,
        userId: setup.nonMemberId,
        role: "member",
      })
    ).rejects.toThrow("Only group leaders or community admins can add members");
  });

  test("Non-leader cannot add someone as leader", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groupMembers.add, {
        token: setup.memberToken,
        groupId: setup.groupId,
        userId: setup.nonMemberId,
        role: "leader",
      })
    ).rejects.toThrow("Only group leaders or community admins can add members");
  });

  test("Non-member cannot add members to group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groupMembers.add, {
        token: setup.nonMemberToken,
        groupId: setup.groupId,
        userId: setup.adminId,
      })
    ).rejects.toThrow("Only group leaders or community admins can add members");
  });

  test("Leader can add members", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.mutation(api.functions.groupMembers.add, {
      token: setup.leaderToken,
      groupId: setup.groupId,
      userId: setup.nonMemberId,
      role: "member",
    });

    expect(result).toBeDefined();
    expect(result.role).toBe("member");
  });
});

// ============================================================================
// VULNERABILITY #8: List Join Requests Leak
// ============================================================================

describe("SECURITY: Listing join requests requires community admin", () => {
  test("Non-admin gets empty list when viewing join requests", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a pending join request
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId: setup.nonMemberId,
        role: "member",
        joinedAt: Date.now(),
        leftAt: Date.now(),
        notificationsEnabled: true,
        requestStatus: "pending",
        requestedAt: Date.now(),
      });
    });

    // Non-admin should get empty list (security by design - don't leak info)
    const result = await t.query(api.functions.groupMembers.listJoinRequests, {
      token: setup.memberToken,
      groupId: setup.groupId,
    });

    expect(result).toHaveLength(0);
  });

  test("Community admin can see pending join requests", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a pending join request
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId: setup.groupId,
        userId: setup.nonMemberId,
        role: "member",
        joinedAt: Date.now(),
        leftAt: Date.now(),
        notificationsEnabled: true,
        requestStatus: "pending",
        requestedAt: Date.now(),
      });
    });

    const result = await t.query(api.functions.groupMembers.listJoinRequests, {
      token: setup.adminToken,
      groupId: setup.groupId,
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].userId).toBe(setup.nonMemberId);
  });
});

// ============================================================================
// Summary Test: Document All Security Checks
// ============================================================================

describe("SECURITY SUMMARY: All security checks documented", () => {
  test("documents the security checks that should be verified", () => {
    const securityChecks = [
      {
        id: 1,
        file: "groups.ts",
        function: "update",
        check: "Verifies caller is a leader before allowing group updates",
        severity: "HIGH",
      },
      {
        id: 2,
        file: "groups.ts",
        function: "updateMemberRole",
        check: "Verifies caller is a leader before allowing role changes",
        severity: "CRITICAL",
      },
      {
        id: 3,
        file: "meetings.ts",
        function: "cancel",
        check: "Verifies caller is a leader before allowing meeting cancellation",
        severity: "CRITICAL",
      },
      {
        id: 4,
        file: "meetings.ts",
        function: "update",
        check: "Verifies caller is a leader before allowing meeting updates",
        severity: "CRITICAL",
      },
      {
        id: 5,
        file: "admin.ts",
        function: "reviewPendingRequest",
        check: "Verifies caller is a community admin before reviewing join requests",
        severity: "HIGH",
      },
      {
        id: 6,
        file: "groups.ts",
        function: "join",
        check: "Checks isPublic and blocks direct join for private groups",
        severity: "MEDIUM",
      },
      {
        id: 7,
        file: "groupMembers.ts",
        function: "add",
        check: "Verifies caller is a leader before adding members",
        severity: "HIGH",
      },
      {
        id: 8,
        file: "groupMembers.ts",
        function: "listJoinRequests",
        check: "Returns empty list for non-admins to prevent information leakage",
        severity: "MEDIUM",
      },
    ];

    expect(securityChecks).toHaveLength(8);

    const criticalCount = securityChecks.filter(c => c.severity === "CRITICAL").length;
    const highCount = securityChecks.filter(c => c.severity === "HIGH").length;

    expect(criticalCount).toBe(3);
    expect(highCount).toBe(3);
  });
});
