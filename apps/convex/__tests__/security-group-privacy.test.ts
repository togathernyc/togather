/**
 * Security Vulnerability Tests - Group Privacy Data Leak
 *
 * These tests verify that private group data is protected from non-members:
 * 1. Non-members cannot see address/location data from getById
 * 2. Non-members cannot see externalChatLink from getById
 * 3. Non-members get empty array from getLeaders
 * 4. Non-members get empty response from groupMembers.list
 * 5. Members CAN see all sensitive data
 * 6. Community admins CAN see all sensitive data
 *
 * Run with: cd convex && pnpm test __tests__/security-group-privacy.test.ts
 */

import { vi, expect, test, describe, afterEach, beforeEach } from "vitest";

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

// Use fake timers for all tests
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
  publicGroupId: Id<"groups">;
  privateGroupId: Id<"groups">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  nonMemberId: Id<"users">;
  adminId: Id<"users">;
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

    // Create public group with sensitive data
    const publicGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Public Group",
      description: "A test public group",
      isArchived: false,
      isPublic: true,
      // Sensitive location data
      addressLine1: "123 Public St",
      addressLine2: "Suite 100",
      city: "Test City",
      state: "TS",
      zipCode: "12345",
      // Sensitive chat link
      externalChatLink: "https://chat.whatsapp.com/secret123",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create private group with sensitive data
    const privateGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Private Group",
      description: "A private test group",
      isArchived: false,
      isPublic: false,
      // Sensitive location data
      addressLine1: "456 Private Ave",
      addressLine2: "Floor 2",
      city: "Secret City",
      state: "SC",
      zipCode: "67890",
      // Sensitive chat link
      externalChatLink: "https://chat.whatsapp.com/supersecret456",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add leader to groups
    await ctx.db.insert("groupMembers", {
      groupId: publicGroupId,
      userId: leaderId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    await ctx.db.insert("groupMembers", {
      groupId: privateGroupId,
      userId: leaderId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // Add member to groups
    await ctx.db.insert("groupMembers", {
      groupId: publicGroupId,
      userId: memberId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    await ctx.db.insert("groupMembers", {
      groupId: privateGroupId,
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

    // Add regular community memberships
    await ctx.db.insert("userCommunities", {
      userId: memberId,
      communityId,
      roles: 1, // Regular member
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("userCommunities", {
      userId: nonMemberId,
      communityId,
      roles: 1, // Regular member
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      communityId,
      groupTypeId,
      publicGroupId,
      privateGroupId,
      leaderId,
      memberId,
      nonMemberId,
      adminId,
      leaderToken: `test-token-${leaderId}`,
      memberToken: `test-token-${memberId}`,
      nonMemberToken: `test-token-${nonMemberId}`,
      adminToken: `test-token-${adminId}`,
    };
  });
}

// ============================================================================
// VULNERABILITY #1: Non-members can see address data from getById
// ============================================================================

describe("SECURITY: Group getById hides address for non-members", () => {
  test("Non-member cannot see address fields for private group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.privateGroupId,
      token: setup.nonMemberToken,
    });

    expect(result).not.toBeNull();
    expect(result?.name).toBe("Private Group");
    // Address fields should be hidden
    expect(result?.addressLine1).toBeUndefined();
    expect(result?.addressLine2).toBeUndefined();
    expect(result?.city).toBeUndefined();
    expect(result?.state).toBeUndefined();
    expect(result?.zipCode).toBeUndefined();
  });

  test("Non-member cannot see address fields for public group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.publicGroupId,
      token: setup.nonMemberToken,
    });

    expect(result).not.toBeNull();
    expect(result?.name).toBe("Test Public Group");
    // Address fields should be hidden for non-members even on public groups
    expect(result?.addressLine1).toBeUndefined();
    expect(result?.addressLine2).toBeUndefined();
    expect(result?.city).toBeUndefined();
    expect(result?.state).toBeUndefined();
    expect(result?.zipCode).toBeUndefined();
  });

  test("Anonymous user cannot see address fields", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.publicGroupId,
      // No token provided
    });

    expect(result).not.toBeNull();
    expect(result?.name).toBe("Test Public Group");
    // Address fields should be hidden
    expect(result?.addressLine1).toBeUndefined();
    expect(result?.addressLine2).toBeUndefined();
    expect(result?.city).toBeUndefined();
    expect(result?.state).toBeUndefined();
    expect(result?.zipCode).toBeUndefined();
  });

  test("Member CAN see address fields", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.privateGroupId,
      token: setup.memberToken,
    });

    expect(result).not.toBeNull();
    expect(result?.addressLine1).toBe("456 Private Ave");
    expect(result?.addressLine2).toBe("Floor 2");
    expect(result?.city).toBe("Secret City");
    expect(result?.state).toBe("SC");
    expect(result?.zipCode).toBe("67890");
  });

  test("Community admin CAN see address fields even if not a member", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.privateGroupId,
      token: setup.adminToken,
    });

    expect(result).not.toBeNull();
    expect(result?.addressLine1).toBe("456 Private Ave");
    expect(result?.city).toBe("Secret City");
  });
});

// ============================================================================
// VULNERABILITY #2: Non-members can see externalChatLink from getById
// ============================================================================

describe("SECURITY: Group getById hides externalChatLink for non-members", () => {
  test("Non-member cannot see externalChatLink for private group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.privateGroupId,
      token: setup.nonMemberToken,
    });

    expect(result).not.toBeNull();
    expect(result?.externalChatLink).toBeUndefined();
  });

  test("Non-member cannot see externalChatLink for public group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.publicGroupId,
      token: setup.nonMemberToken,
    });

    expect(result).not.toBeNull();
    expect(result?.externalChatLink).toBeUndefined();
  });

  test("Anonymous user cannot see externalChatLink", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.publicGroupId,
    });

    expect(result).not.toBeNull();
    expect(result?.externalChatLink).toBeUndefined();
  });

  test("Member CAN see externalChatLink", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.privateGroupId,
      token: setup.memberToken,
    });

    expect(result).not.toBeNull();
    expect(result?.externalChatLink).toBe("https://chat.whatsapp.com/supersecret456");
  });

  test("Community admin CAN see externalChatLink even if not a member", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getById, {
      groupId: setup.privateGroupId,
      token: setup.adminToken,
    });

    expect(result).not.toBeNull();
    expect(result?.externalChatLink).toBe("https://chat.whatsapp.com/supersecret456");
  });
});

// ============================================================================
// VULNERABILITY #3: Non-members can see leader list from getLeaders
// NOTE: getMembers was removed - use groupMembers.list instead (tested below)
// ============================================================================

describe("SECURITY: Group getLeaders returns empty for non-members", () => {
  test("Non-member gets empty array from getLeaders for private group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getLeaders, {
      groupId: setup.privateGroupId,
      token: setup.nonMemberToken,
    });

    expect(result).toEqual([]);
  });

  test("Non-member gets empty array from getLeaders for public group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getLeaders, {
      groupId: setup.publicGroupId,
      token: setup.nonMemberToken,
    });

    expect(result).toEqual([]);
  });

  test("Anonymous user gets empty array from getLeaders", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getLeaders, {
      groupId: setup.publicGroupId,
    });

    expect(result).toEqual([]);
  });

  test("Member CAN see leader list", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getLeaders, {
      groupId: setup.privateGroupId,
      token: setup.memberToken,
    });

    expect(result.length).toBeGreaterThan(0);
  });

  test("Community admin CAN see leader list even if not a group member", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groups.index.getLeaders, {
      groupId: setup.privateGroupId,
      token: setup.adminToken,
    });

    expect(result.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// VULNERABILITY #4: Non-members can see member list from groupMembers.list
// ============================================================================

describe("SECURITY: groupMembers.list returns empty for non-members", () => {
  test("Non-member gets empty items from groupMembers.list for private group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groupMembers.list, {
      groupId: setup.privateGroupId,
      token: setup.nonMemberToken,
    });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  test("Non-member gets empty items from groupMembers.list for public group", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groupMembers.list, {
      groupId: setup.publicGroupId,
      token: setup.nonMemberToken,
    });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  test("Anonymous user gets empty items from groupMembers.list", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groupMembers.list, {
      groupId: setup.publicGroupId,
    });

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  test("Member CAN see member list from groupMembers.list", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groupMembers.list, {
      groupId: setup.privateGroupId,
      token: setup.memberToken,
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.totalCount).toBeGreaterThan(0);
  });

  test("Community admin CAN see member list from groupMembers.list even if not a group member", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.query(api.functions.groupMembers.list, {
      groupId: setup.privateGroupId,
      token: setup.adminToken,
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.totalCount).toBeGreaterThan(0);
  });
});

// ============================================================================
// Summary Test
// ============================================================================

describe("SECURITY SUMMARY: Group Privacy Data Leak Prevention", () => {
  test("documents the security checks for group privacy", () => {
    const securityChecks = [
      {
        id: 1,
        file: "groups.ts",
        function: "getById",
        check: "Hides address fields for non-members",
        severity: "HIGH",
      },
      {
        id: 2,
        file: "groups.ts",
        function: "getById",
        check: "Hides externalChatLink for non-members",
        severity: "HIGH",
      },
      {
        id: 3,
        file: "groups.ts",
        function: "getLeaders",
        check: "Returns empty array for non-members",
        severity: "HIGH",
      },
      {
        id: 4,
        file: "groupMembers.ts",
        function: "list",
        check: "Returns empty items for non-members",
        severity: "HIGH",
      },
    ];

    expect(securityChecks).toHaveLength(4);
    expect(securityChecks.every(c => c.severity === "HIGH")).toBe(true);
  });
});
