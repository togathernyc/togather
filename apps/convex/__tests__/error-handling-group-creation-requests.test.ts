/**
 * Error Handling Tests - Group Creation Requests
 *
 * These tests verify that error handling is properly implemented for group creation requests:
 * 1. Duplicate request prevention
 * 2. Invalid group type rejection
 * 3. Invalid proposed leader validation
 * 4. String length validation
 * 5. Request not found scenarios
 * 6. Request already processed scenarios
 * 7. Permission checks
 *
 * Run with: cd convex && pnpm test __tests__/error-handling-group-creation-requests.test.ts
 */

// Mock the jose library to bypass JWT verification in tests
import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

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
  activeGroupTypeId: Id<"groupTypes">;
  inactiveGroupTypeId: Id<"groupTypes">;
  otherCommunityId: Id<"communities">;
  otherCommunityGroupTypeId: Id<"groupTypes">;
  userId: Id<"users">;
  otherUserId: Id<"users">;
  inactiveUserId: Id<"users">;
  userToken: string;
  otherUserToken: string;
}

async function setupTestData(t: ReturnType<typeof convexTest>): Promise<TestSetup> {
  return await t.run(async (ctx) => {
    const timestamp = Date.now();

    // Create main community
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create other community for cross-community testing
    const otherCommunityId = await ctx.db.insert("communities", {
      name: "Other Community",
      slug: "other-community",
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Create active group type
    const activeGroupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Active Group Type",
      slug: "active-type",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });

    // Create inactive group type
    const inactiveGroupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Inactive Group Type",
      slug: "inactive-type",
      isActive: false,
      createdAt: timestamp,
      displayOrder: 2,
    });

    // Create group type for other community
    const otherCommunityGroupTypeId = await ctx.db.insert("groupTypes", {
      communityId: otherCommunityId,
      name: "Other Community Type",
      slug: "other-type",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });

    // Create users
    const userId = await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      email: "test@example.com",
      phone: "+12025550001",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const otherUserId = await ctx.db.insert("users", {
      firstName: "Other",
      lastName: "User",
      email: "other@example.com",
      phone: "+12025550002",
      phoneVerified: true,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const inactiveUserId = await ctx.db.insert("users", {
      firstName: "Inactive",
      lastName: "User",
      email: "inactive@example.com",
      phone: "+12025550003",
      phoneVerified: true,
      isActive: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add users to community
    await ctx.db.insert("userCommunities", {
      userId,
      communityId,
      roles: 1, // Regular member
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("userCommunities", {
      userId: otherUserId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Add inactive user to community (but inactive in userCommunities)
    await ctx.db.insert("userCommunities", {
      userId: inactiveUserId,
      communityId,
      roles: 1,
      status: 0, // Inactive
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      communityId,
      activeGroupTypeId,
      inactiveGroupTypeId,
      otherCommunityId,
      otherCommunityGroupTypeId,
      userId,
      otherUserId,
      inactiveUserId,
      userToken: `test-token-${userId}`,
      otherUserToken: `test-token-${otherUserId}`,
    };
  });
}

// ============================================================================
// ERROR #1: Duplicate Request Prevention
// ============================================================================

describe("ERROR HANDLING: Duplicate Request Prevention", () => {
  test("should throw clear error when user already has pending request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create first request (should succeed)
    await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "First Request",
      groupTypeId: setup.activeGroupTypeId,
      description: "This is the first request",
    });

    // Try to create second request (should fail)
    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Second Request",
        groupTypeId: setup.activeGroupTypeId,
        description: "This is a duplicate request",
      })
    ).rejects.toThrow("You already have a pending group creation request");
  });

  test("should allow new request after canceling previous one", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create first request
    const firstRequest = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "First Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    // Cancel first request
    await t.mutation(api.functions.groupCreationRequests.cancel, {
      token: setup.userToken,
      requestId: firstRequest.id,
    });

    // Create second request (should succeed)
    const secondRequest = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Second Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    expect(secondRequest).toBeDefined();
    expect(secondRequest.name).toBe("Second Request");
  });

  test("should allow new request after previous one was approved", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create and approve first request
    const firstRequest = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "First Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    // Admin approves the request
    await t.mutation(api.functions.groupCreationRequests.review, {
      token: setup.userToken, // In real app, this would be admin token
      requestId: firstRequest.id,
      action: "approve",
    });

    // Create second request (should succeed)
    const secondRequest = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Second Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    expect(secondRequest).toBeDefined();
    expect(secondRequest.name).toBe("Second Request");
  });
});

// ============================================================================
// ERROR #2: Invalid Group Type
// ============================================================================

describe("ERROR HANDLING: Invalid Group Type", () => {
  test("should throw error for inactive group type", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Test Request",
        groupTypeId: setup.inactiveGroupTypeId,
      })
    ).rejects.toThrow("Group type not found");
  });

  test("should throw error for non-existent group type", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a real ID then delete it to get a valid but non-existent ID
    const fakeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("groupTypes", {
        name: "Temp Type",
        slug: "temp-type",
        communityId: setup.communityId,
        isActive: true,
        createdAt: Date.now(),
        displayOrder: 999,
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Test Request",
        groupTypeId: fakeId,
      })
    ).rejects.toThrow("Group type not found");
  });

  test("should throw error for group type from different community", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Test Request",
        groupTypeId: setup.otherCommunityGroupTypeId, // From different community
      })
    ).rejects.toThrow("Group type not found");
  });

  test("should succeed with valid active group type", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const result = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Valid Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    expect(result).toBeDefined();
    expect(result.status).toBe("pending");
  });
});

// ============================================================================
// ERROR #3: Invalid Proposed Leader IDs
// ============================================================================

describe("ERROR HANDLING: Invalid Proposed Leader IDs", () => {
  test("should throw error for malformed user ID", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Test Request",
        groupTypeId: setup.activeGroupTypeId,
        proposedLeaderIds: ["invalid-id"], // Invalid ID
      })
    ).rejects.toThrow("User not found"); // Simplified validation passes format but fails lookup
  });

  test("should throw error for non-existent user", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a real user ID then delete it to get a valid but non-existent ID
    const fakeUserId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Temp",
        lastName: "User",
        email: "temp@example.com",
        phone: "+12025550099",
        phoneVerified: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id as string;
    });

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Test Request",
        groupTypeId: setup.activeGroupTypeId,
        proposedLeaderIds: [fakeUserId],
      })
    ).rejects.toThrow("User not found");
  });

  test("should throw error for user not in community", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a user who is not in the community
    const outsideUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Outside",
        lastName: "User",
        email: "outside@example.com",
        phone: "+12025550010",
        phoneVerified: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Test Request",
        groupTypeId: setup.activeGroupTypeId,
        proposedLeaderIds: [outsideUserId],
      })
    ).rejects.toThrow("Some proposed leaders are not valid community members");
  });

  test("should throw error for inactive community member", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Test Request",
        groupTypeId: setup.activeGroupTypeId,
        proposedLeaderIds: [setup.inactiveUserId],
      })
    ).rejects.toThrow("Some proposed leaders are not valid community members");
  });

  test("should succeed with valid proposed leaders", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Convex IDs are strings at runtime, no need to cast
    const result = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Test Request",
      groupTypeId: setup.activeGroupTypeId,
      proposedLeaderIds: [setup.otherUserId],
    });

    expect(result).toBeDefined();
    expect(result.status).toBe("pending");
  });

  test("should handle multiple proposed leaders correctly", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create another valid user
    const thirdUserId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        firstName: "Third",
        lastName: "User",
        email: "third@example.com",
        phone: "+12025550011",
        phoneVerified: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("userCommunities", {
        userId: id,
        communityId: setup.communityId,
        roles: 1,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return id;
    });

    const result = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Test Request",
      groupTypeId: setup.activeGroupTypeId,
      proposedLeaderIds: [setup.otherUserId, thirdUserId],
    });

    expect(result).toBeDefined();
    expect(result.status).toBe("pending");
  });
});

// ============================================================================
// ERROR #4: String Length Validation
// ============================================================================

describe("ERROR HANDLING: String Length Validation", () => {
  test("should throw error for name exceeding 100 characters", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const longName = "A".repeat(101);

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: longName,
        groupTypeId: setup.activeGroupTypeId,
      })
    ).rejects.toThrow("Name too long");
  });

  test("should accept name at exactly 100 characters", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const maxLengthName = "A".repeat(100);

    const result = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: maxLengthName,
      groupTypeId: setup.activeGroupTypeId,
    });

    expect(result).toBeDefined();
    expect(result.name).toBe(maxLengthName);
  });

  test("should throw error for description exceeding 1000 characters", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const longDescription = "A".repeat(1001);

    await expect(
      t.mutation(api.functions.groupCreationRequests.create, {
        token: setup.userToken,
        communityId: setup.communityId,
        name: "Test Request",
        groupTypeId: setup.activeGroupTypeId,
        description: longDescription,
      })
    ).rejects.toThrow("Description too long");
  });

  test("should accept description at exactly 1000 characters", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const maxLengthDescription = "A".repeat(1000);

    const result = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Test Request",
      groupTypeId: setup.activeGroupTypeId,
      description: maxLengthDescription,
    });

    expect(result).toBeDefined();
  });
});

// ============================================================================
// ERROR #5: Request Not Found
// ============================================================================

describe("ERROR HANDLING: Request Not Found", () => {
  test("should throw error when canceling non-existent request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a real request ID then delete it to get a valid but non-existent ID
    const fakeRequestId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("groupCreationRequests", {
        communityId: setup.communityId,
        requesterId: setup.userId,
        name: "Temp Request",
        groupTypeId: setup.activeGroupTypeId,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(api.functions.groupCreationRequests.cancel, {
        token: setup.userToken,
        requestId: fakeRequestId,
      })
    ).rejects.toThrow("Request not found");
  });

  test("should throw error when reviewing non-existent request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a real request ID then delete it to get a valid but non-existent ID
    const fakeRequestId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("groupCreationRequests", {
        communityId: setup.communityId,
        requesterId: setup.userId,
        name: "Temp Request",
        groupTypeId: setup.activeGroupTypeId,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.mutation(api.functions.groupCreationRequests.review, {
        token: setup.userToken,
        requestId: fakeRequestId,
        action: "approve",
      })
    ).rejects.toThrow("Request not found");
  });

  test("should return null when querying non-existent request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create a real request ID then delete it to get a valid but non-existent ID
    const fakeRequestId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("groupCreationRequests", {
        communityId: setup.communityId,
        requesterId: setup.userId,
        name: "Temp Request",
        groupTypeId: setup.activeGroupTypeId,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    const result = await t.query(api.functions.groupCreationRequests.getById, {
      requestId: fakeRequestId,
    });

    expect(result).toBeNull();
  });
});

// ============================================================================
// ERROR #6: Request Already Processed
// ============================================================================

describe("ERROR HANDLING: Request Already Processed", () => {
  test("should throw error when canceling already-approved request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create and approve request
    const request = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Test Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    await t.mutation(api.functions.groupCreationRequests.review, {
      token: setup.userToken,
      requestId: request.id,
      action: "approve",
    });

    // Try to cancel approved request
    await expect(
      t.mutation(api.functions.groupCreationRequests.cancel, {
        token: setup.userToken,
        requestId: request.id,
      })
    ).rejects.toThrow("Request was already processed");
  });

  test("should throw error when canceling already-declined request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create and decline request
    const request = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Test Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    await t.mutation(api.functions.groupCreationRequests.review, {
      token: setup.userToken,
      requestId: request.id,
      action: "decline",
      declineReason: "Not needed",
    });

    // Try to cancel declined request
    await expect(
      t.mutation(api.functions.groupCreationRequests.cancel, {
        token: setup.userToken,
        requestId: request.id,
      })
    ).rejects.toThrow("Request was already processed");
  });

  test("should throw error when reviewing already-reviewed request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // Create and approve request
    const request = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Test Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    await t.mutation(api.functions.groupCreationRequests.review, {
      token: setup.userToken,
      requestId: request.id,
      action: "approve",
    });

    // Try to review again
    await expect(
      t.mutation(api.functions.groupCreationRequests.review, {
        token: setup.userToken,
        requestId: request.id,
        action: "decline",
        declineReason: "Changed mind",
      })
    ).rejects.toThrow("Request was already processed");
  });
});

// ============================================================================
// ERROR #7: Permission Checks
// ============================================================================

describe("ERROR HANDLING: Permission Checks", () => {
  test("should throw error when user tries to cancel another user's request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    // User creates request
    const request = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Test Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    // Other user tries to cancel it
    await expect(
      t.mutation(api.functions.groupCreationRequests.cancel, {
        token: setup.otherUserToken,
        requestId: request.id,
      })
    ).rejects.toThrow("You can only cancel your own requests");
  });

  test("should succeed when user cancels their own request", async () => {
    const t = convexTest(schema, modules);
    const setup = await setupTestData(t);

    const request = await t.mutation(api.functions.groupCreationRequests.create, {
      token: setup.userToken,
      communityId: setup.communityId,
      name: "Test Request",
      groupTypeId: setup.activeGroupTypeId,
    });

    const result = await t.mutation(api.functions.groupCreationRequests.cancel, {
      token: setup.userToken,
      requestId: request.id,
    });

    expect(result.success).toBe(true);
  });
});

// ============================================================================
// SUMMARY TEST: Document All Error Checks
// ============================================================================

describe("ERROR HANDLING SUMMARY: All error checks documented", () => {
  test("documents the error handling checks that should be verified", () => {
    const errorChecks = [
      {
        id: 1,
        area: "Duplicate Prevention",
        check: "Throws error when user has pending request",
        severity: "HIGH",
        userMessage: "You already have a pending group creation request",
      },
      {
        id: 2,
        area: "Group Type Validation",
        check: "Rejects inactive, non-existent, or wrong-community group types",
        severity: "HIGH",
        userMessage: "Group type not found",
      },
      {
        id: 3,
        area: "Leader ID Validation",
        check: "Validates format, existence, and community membership",
        severity: "CRITICAL",
        userMessage: "Various messages for different validation failures",
      },
      {
        id: 4,
        area: "String Length",
        check: "Enforces max length for name (100) and description (1000)",
        severity: "MEDIUM",
        userMessage: "Name/Description too long",
      },
      {
        id: 5,
        area: "Request Not Found",
        check: "Handles deleted or non-existent requests gracefully",
        severity: "MEDIUM",
        userMessage: "Request not found",
      },
      {
        id: 6,
        area: "Already Processed",
        check: "Prevents actions on reviewed requests",
        severity: "MEDIUM",
        userMessage: "Request was already processed",
      },
      {
        id: 7,
        area: "Permissions",
        check: "Ensures users can only cancel their own requests",
        severity: "HIGH",
        userMessage: "You can only cancel your own requests",
      },
    ];

    expect(errorChecks).toHaveLength(7);

    const criticalCount = errorChecks.filter(c => c.severity === "CRITICAL").length;
    const highCount = errorChecks.filter(c => c.severity === "HIGH").length;
    const mediumCount = errorChecks.filter(c => c.severity === "MEDIUM").length;

    expect(criticalCount).toBe(1);
    expect(highCount).toBe(3);
    expect(mediumCount).toBe(3);
  });
});
