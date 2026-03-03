/**
 * Security Tests: PII Exposure Vulnerabilities
 *
 * These tests verify that security protections are in place to prevent
 * Personal Identifiable Information (PII) exposure through user queries.
 *
 * Vulnerabilities tested:
 * 1. Unauthenticated access to user data via getById, getByPhone, getByEmail, getByIds
 * 2. Member enumeration via communities.getMembers without membership check
 * 3. Deactivated user data exposure
 *
 * Expected secure behavior:
 * - getById, getByIds: Return only public fields (firstName, lastName, profilePhoto)
 * - getByPhone, getByEmail: Require authentication (throw on unauthenticated access)
 * - getMembers: Require authentication + community membership, return only public fields
 * - All functions: Filter out deactivated users (isActive: false)
 *
 * Run with: cd convex && pnpm test security-pii-exposure.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";

// Define modules relative to this test file location
// Exclude __mocks__ and __tests__ folders to ensure correct root resolution
const modules = import.meta.glob([
  "../**/*.*s",
  "!../__mocks__/**",
  "!../__tests__/**"
]);

// Mock the auth module to control authentication behavior
vi.mock("../lib/auth", () => ({
  requireAuth: vi.fn().mockRejectedValue(new Error("Not authenticated")),
  getOptionalAuth: vi.fn().mockResolvedValue(null),
}));

// ============================================================================
// PII Fields that should NOT be exposed without authentication
// ============================================================================

const PII_FIELDS = ["phone", "email", "dateOfBirth"] as const;

/**
 * Helper to check if a result contains PII fields
 */
function containsPII(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  return PII_FIELDS.some(
    (field) =>
      field in result && (result as Record<string, unknown>)[field] !== undefined
  );
}

/**
 * Helper to get which PII fields are present
 */
function getPIIFields(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  return PII_FIELDS.filter(
    (field) =>
      field in result && (result as Record<string, unknown>)[field] !== undefined
  );
}

// ============================================================================
// UNAUTHENTICATED PII EXPOSURE TESTS
// These tests verify that PII is NOT exposed without authentication
// ============================================================================

describe("Security: Unauthenticated PII Exposure", () => {
  describe("users.getById - Returns only public fields", () => {
    /**
     * SECURE BEHAVIOR: getById returns only public fields without authentication
     *
     * This prevents PII exposure while still allowing basic user info lookup.
     */
    test("returns only public fields without authentication (no PII exposure)", async () => {
      const t = convexTest(schema, modules);

      // Create user with PII
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "John",
          lastName: "Doe",
          email: "john.doe@private.com",
          phone: "+12025559999",
          phoneVerified: true,
          dateOfBirth: Date.now() - 30 * 365 * 24 * 60 * 60 * 1000,
          isActive: true,
        });
      });

      // Call getById WITHOUT any token/auth
      const result = await t.query(api.functions.users.getById, { userId });

      // The result should NOT contain PII fields
      const piiFound = getPIIFields(result);
      expect(piiFound).toEqual([]);

      // Result should only have public fields
      if (result) {
        expect(result).not.toHaveProperty("phone");
        expect(result).not.toHaveProperty("email");
        expect(result).not.toHaveProperty("dateOfBirth");
        // Should have public fields
        expect(result).toHaveProperty("_id");
        expect(result).toHaveProperty("firstName");
        expect(result).toHaveProperty("lastName");
      }
    });

    test("returns only public fields for any user ID (limited data)", async () => {
      const t = convexTest(schema, modules);

      // Create user with PII (simulating a "victim")
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "Victim",
          lastName: "User",
          email: "victim@private.com",
          phone: "+15551234567",
          dateOfBirth: Date.now() - 25 * 365 * 24 * 60 * 60 * 1000,
          isActive: true,
        });
      });

      // User IDs can be queried but only return public fields
      const result = await t.query(api.functions.users.getById, { userId });

      // Result should have only public fields, not PII
      expect(result).not.toBeNull();
      expect(result).toHaveProperty("_id");
      expect(result).toHaveProperty("firstName");
      expect(result).toHaveProperty("lastName");
      expect(result).not.toHaveProperty("email");
      expect(result).not.toHaveProperty("phone");
      expect(result).not.toHaveProperty("dateOfBirth");
    });
  });

  describe("users.getByPhone - Requires authentication", () => {
    /**
     * SECURE BEHAVIOR: getByPhone requires authentication
     *
     * This prevents phone enumeration attacks where attackers could
     * check if phone numbers are registered in the system.
     */
    test("throws authentication error when called without auth", async () => {
      const t = convexTest(schema, modules);

      // Create user with phone
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          firstName: "John",
          lastName: "Doe",
          phone: "+12025559999",
          isActive: true,
        });
      });

      // SECURE: Should throw "Not authenticated" error
      await expect(
        t.query(api.functions.users.getByPhone, {
          token: "",
          phone: "+12025559999",
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("prevents phone enumeration attacks", async () => {
      const t = convexTest(schema, modules);

      // Attempting to lookup by phone without valid auth should fail
      await expect(
        t.query(api.functions.users.getByPhone, {
          token: "invalid",
          phone: "+12025559999",
        })
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("users.getByEmail - Requires authentication", () => {
    /**
     * SECURE BEHAVIOR: getByEmail requires authentication
     *
     * This prevents email enumeration attacks where attackers could
     * check if email addresses are registered in the system.
     */
    test("throws authentication error when called without auth", async () => {
      const t = convexTest(schema, modules);

      // Create user with email
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          firstName: "John",
          lastName: "Doe",
          email: "john.doe@private.com",
          isActive: true,
        });
      });

      // SECURE: Should throw authentication error
      await expect(
        t.query(api.functions.users.getByEmail, {
          token: "",
          email: "john.doe@private.com",
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("prevents email enumeration attacks", async () => {
      const t = convexTest(schema, modules);

      // Attempting to lookup by email without valid auth should fail
      await expect(
        t.query(api.functions.users.getByEmail, {
          token: "invalid",
          email: "john.doe@private.com",
        })
      ).rejects.toThrow("Not authenticated");
    });
  });

  describe("users.getByIds - Returns only public fields", () => {
    /**
     * SECURE BEHAVIOR: getByIds returns only public fields without authentication
     *
     * This prevents batch PII harvesting while still allowing batch user info lookup.
     */
    test("batch lookup returns only public fields (no PII exposure)", async () => {
      const t = convexTest(schema, modules);

      // Create multiple users with PII
      const userIds = await t.run(async (ctx) => {
        const user1 = await ctx.db.insert("users", {
          firstName: "User",
          lastName: "One",
          email: "user1@test.com",
          phone: "+11111111111",
          isActive: true,
        });
        const user2 = await ctx.db.insert("users", {
          firstName: "User",
          lastName: "Two",
          email: "user2@test.com",
          phone: "+12222222222",
          isActive: true,
        });
        const user3 = await ctx.db.insert("users", {
          firstName: "User",
          lastName: "Three",
          email: "user3@test.com",
          phone: "+13333333333",
          isActive: true,
        });
        return [user1, user2, user3];
      });

      const result = await t.query(api.functions.users.getByIds, { userIds });

      // Check that no user in the batch has PII
      const usersWithPII = result.filter((user: unknown) => containsPII(user));
      expect(usersWithPII).toHaveLength(0);

      // Each user should have only public fields
      result.forEach((user: Record<string, unknown>) => {
        expect(user).toHaveProperty("_id");
        expect(user).toHaveProperty("firstName");
        expect(user).toHaveProperty("lastName");
        expect(user).not.toHaveProperty("email");
        expect(user).not.toHaveProperty("phone");
      });
    });

    test("does not require authentication but returns limited data", async () => {
      const t = convexTest(schema, modules);

      // Create a user
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "Any",
          lastName: "User",
          email: "any@test.com",
          phone: "+10000000000",
          isActive: true,
        });
      });

      // Should not throw - just return limited data
      const result = await t.query(api.functions.users.getByIds, {
        userIds: [userId],
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      // Should only have public fields
      expect(result[0]).not.toHaveProperty("email");
      expect(result[0]).not.toHaveProperty("phone");
    });
  });
});

// ============================================================================
// MEMBER ENUMERATION TESTS
// These tests verify that member enumeration is protected
// ============================================================================

describe("Security: Member Enumeration", () => {
  describe("communities.getMembers - Requires authentication and membership", () => {
    /**
     * SECURE BEHAVIOR: getMembers requires authentication
     *
     * This prevents unauthenticated enumeration of community members
     * which could be used for targeted phishing or social engineering.
     */
    test("throws authentication error when called without auth", async () => {
      const t = convexTest(schema, modules);

      // Create community and member
      const communityId = await t.run(async (ctx) => {
        const cId = await ctx.db.insert("communities", {
          name: "Test Community",
          isPublic: true,
        });

        const userId = await ctx.db.insert("users", {
          firstName: "Admin",
          lastName: "User",
          isActive: true,
        });

        await ctx.db.insert("userCommunities", {
          userId,
          communityId: cId,
          roles: 3,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return cId;
      });

      // Non-authenticated caller should get an error
      await expect(
        t.query(api.functions.communities.getMembers, {
          token: "",
          communityId,
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("prevents non-member from filtering by role", async () => {
      const t = convexTest(schema, modules);

      // Create private community
      const communityId = await t.run(async (ctx) => {
        return await ctx.db.insert("communities", {
          name: "Private Community",
          isPublic: false,
        });
      });

      // Should throw without valid auth
      await expect(
        t.query(api.functions.communities.getMembers, {
          token: "invalid",
          communityId,
          roles: 3, // Specifically looking for admins
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("requires auth token", async () => {
      const t = convexTest(schema, modules);

      // Create community
      const communityId = await t.run(async (ctx) => {
        return await ctx.db.insert("communities", {
          name: "Demo Community",
          isPublic: true,
        });
      });

      // getMembers now requires a token argument
      await expect(
        t.query(api.functions.communities.getMembers, {
          token: "",
          communityId,
        })
      ).rejects.toThrow();
    });
  });
});

// ============================================================================
// DEACTIVATED USER DATA EXPOSURE TESTS
// These tests verify that deactivated users are filtered out
// ============================================================================

describe("Security: Deactivated User Data Exposure", () => {
  describe("Deactivated users should not be queryable", () => {
    /**
     * SECURE BEHAVIOR: Deactivated users are filtered out
     *
     * When a user deactivates their account, their data should not
     * be accessible through public queries (GDPR/CCPA compliance).
     */
    test("getById returns null for deactivated user", async () => {
      const t = convexTest(schema, modules);

      // Create deactivated user
      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          firstName: "Deactivated",
          lastName: "User",
          email: "deactivated@test.com",
          phone: "+12025558888",
          isActive: false,
        });
      });

      const result = await t.query(api.functions.users.getById, { userId });

      // Should return null for deactivated users
      expect(result).toBeNull();
    });

    test("getByEmail throws for unauthenticated access (deactivated or not)", async () => {
      const t = convexTest(schema, modules);

      // Create deactivated user
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          firstName: "Deactivated",
          lastName: "User",
          email: "deactivated@test.com",
          isActive: false,
        });
      });

      // Should throw due to auth requirement
      await expect(
        t.query(api.functions.users.getByEmail, {
          token: "",
          email: "deactivated@test.com",
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("getByPhone throws for unauthenticated access (deactivated or not)", async () => {
      const t = convexTest(schema, modules);

      // Create deactivated user
      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          firstName: "Deactivated",
          lastName: "User",
          phone: "+12025558888",
          isActive: false,
        });
      });

      // Should throw due to auth requirement
      await expect(
        t.query(api.functions.users.getByPhone, {
          token: "",
          phone: "+12025558888",
        })
      ).rejects.toThrow("Not authenticated");
    });

    test("getByIds filters out deactivated users", async () => {
      const t = convexTest(schema, modules);

      // Create active and deactivated users
      const { activeId, deactivatedId } = await t.run(async (ctx) => {
        const active = await ctx.db.insert("users", {
          firstName: "Active",
          lastName: "User",
          isActive: true,
        });
        const deactivated = await ctx.db.insert("users", {
          firstName: "Deactivated",
          lastName: "User",
          isActive: false,
        });
        return { activeId: active, deactivatedId: deactivated };
      });

      const result = await t.query(api.functions.users.getByIds, {
        userIds: [activeId, deactivatedId],
      });

      // Deactivated user should be filtered out
      const deactivatedInResult = result.find(
        (u: { _id: string }) => u._id === deactivatedId
      );
      expect(deactivatedInResult).toBeUndefined();

      // Active user should be present
      const activeInResult = result.find(
        (u: { _id: string }) => u._id === activeId
      );
      expect(activeInResult).toBeDefined();
    });

    test("community members list throws for unauthenticated access", async () => {
      const t = convexTest(schema, modules);

      // Create community with members (including deactivated user)
      const communityId = await t.run(async (ctx) => {
        const cId = await ctx.db.insert("communities", {
          name: "Test Community",
          isPublic: true,
        });

        // Active member
        const activeUser = await ctx.db.insert("users", {
          firstName: "Active",
          lastName: "Member",
          isActive: true,
        });

        // Deactivated member
        const deactivatedUser = await ctx.db.insert("users", {
          firstName: "Deactivated",
          lastName: "Member",
          isActive: false,
        });

        await ctx.db.insert("userCommunities", {
          userId: activeUser,
          communityId: cId,
          roles: 1,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        await ctx.db.insert("userCommunities", {
          userId: deactivatedUser,
          communityId: cId,
          roles: 1,
          status: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return cId;
      });

      // Should throw due to auth requirement
      await expect(
        t.query(api.functions.communities.getMembers, {
          token: "",
          communityId,
        })
      ).rejects.toThrow("Not authenticated");
    });
  });
});

// ============================================================================
// SUMMARY OF IMPLEMENTED SECURE BEHAVIOR
// ============================================================================

/**
 * SECURITY PROTECTIONS IMPLEMENTED:
 *
 * 1. users.getById:
 *    - Returns only public fields (firstName, lastName, profilePhoto)
 *    - Filters out deactivated users (isActive: false)
 *
 * 2. users.getByPhone:
 *    - Requires `token` argument and calls requireAuth
 *    - Filters out deactivated users
 *
 * 3. users.getByEmail:
 *    - Requires `token` argument and calls requireAuth
 *    - Filters out deactivated users
 *
 * 4. users.getByIds:
 *    - Returns only public fields for each user
 *    - Filters out deactivated users
 *
 * 5. communities.getMembers:
 *    - Requires `token` argument and calls requireAuth
 *    - Verifies caller is a member of the community
 *    - Returns only public user fields (not phone, email, DOB)
 *    - Filters out deactivated users from results
 *
 * PUBLIC FIELDS (safe to return without auth):
 * - _id, firstName, lastName, profilePhoto
 *
 * SENSITIVE FIELDS (require auth):
 * - phone, email, dateOfBirth, phoneVerified, externalIds
 */
