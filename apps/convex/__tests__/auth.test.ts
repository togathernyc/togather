/**
 * Authentication Internal Functions Tests
 *
 * Tests the Convex auth functions using the convex-test library.
 * These tests verify the actual business logic with a simulated Convex backend.
 *
 * Run with: cd convex && pnpm test __tests__/auth.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import {
  generateTokens,
  verifyRefreshToken,
  REFRESH_TOKEN_MAX_AGE_MS,
} from "../lib/auth";

// ============================================================================
// Constants
// ============================================================================

const COMMUNITY_ROLES = {
  MEMBER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

const MEMBERSHIP_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  BLOCKED: 3,
} as const;

// ============================================================================
// Token revocation (signout blacklist)
// ============================================================================

describe("Token revocation", () => {
  test("signout succeeds with valid access token even if already revoked", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { accessToken } = await generateTokens(userId);
    const revokedBefore = Date.now() + 60_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("tokenRevocations", {
        userId,
        revokedBefore,
        createdAt: Date.now(),
      });
    });

    await expect(
      t.query(api.functions.authInternal.phoneStatus, { token: accessToken })
    ).rejects.toThrow("Not authenticated");

    const out = await t.mutation(api.functions.authInternal.signout, {
      token: accessToken,
    });
    expect(out).toEqual({ success: true });
  });

  test("isJwtSubjectRevokedInternal flags refresh tokens issued before signout", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        phone: "+11234567891",
        firstName: "Jane",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const { refreshToken } = await generateTokens(userId);
    const refreshPayload = await verifyRefreshToken(refreshToken);
    expect(refreshPayload).not.toBeNull();

    const notRevoked = await t.query(
      internal.functions.authInternal.isJwtSubjectRevokedInternal,
      { jwtUserId: userId, issuedAt: refreshPayload!.issuedAt }
    );
    expect(notRevoked).toBe(false);

    const revokedBefore = Date.now() + 60_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("tokenRevocations", {
        userId,
        revokedBefore,
        createdAt: Date.now(),
      });
    });

    const revoked = await t.query(
      internal.functions.authInternal.isJwtSubjectRevokedInternal,
      { jwtUserId: userId, issuedAt: refreshPayload!.issuedAt }
    );
    expect(revoked).toBe(true);
  });

  test("cleanupStaleTokenRevocations keeps rows needed for refresh token lifetime", async () => {
    const t = convexTest(schema, modules);
    const oneDayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const keepUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        phone: "+11234567892",
        firstName: "Keep",
        lastName: "Revocation",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });
    const deleteUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        phone: "+11234567893",
        firstName: "Stale",
        lastName: "Revocation",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    });

    const stillNeededRevokedBefore = now - REFRESH_TOKEN_MAX_AGE_MS;
    const staleRevokedBefore =
      now - REFRESH_TOKEN_MAX_AGE_MS - 2 * oneDayMs;

    await t.run(async (ctx) => {
      await ctx.db.insert("tokenRevocations", {
        userId: keepUserId,
        revokedBefore: stillNeededRevokedBefore,
        createdAt: now,
      });
      await ctx.db.insert("tokenRevocations", {
        userId: deleteUserId,
        revokedBefore: staleRevokedBefore,
        createdAt: now,
      });
    });

    const { deletedCount } = await t.mutation(
      internal.functions.authInternal.cleanupStaleTokenRevocations,
      {}
    );
    expect(deletedCount).toBe(1);

    const remaining = await t.run(async (ctx) => {
      return await ctx.db.query("tokenRevocations").collect();
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toEqual(keepUserId);
    expect(remaining[0].revokedBefore).toBe(stillNeededRevokedBefore);
  });
});

// ============================================================================
// getUserByPhoneInternal Tests
// ============================================================================

describe("getUserByPhoneInternal", () => {
  test("returns user when phone exists", async () => {
    const t = convexTest(schema, modules);

    // Seed the database with a user
    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        phoneVerified: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Query for the user by phone
    const result = await t.query(internal.functions.authInternal.getUserByPhoneInternal, {
      phone: "+11234567890",
    });

    expect(result).not.toBeNull();
    expect(result?._id).toBe(userId);
    expect(result?.phone).toBe("+11234567890");
    expect(result?.firstName).toBe("John");
  });

  test("returns null when phone not found", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(internal.functions.authInternal.getUserByPhoneInternal, {
      phone: "+19999999999",
    });

    expect(result).toBeNull();
  });

  test("normalizes phone numbers before lookup", async () => {
    const t = convexTest(schema, modules);

    // Create user with normalized phone
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Query with 10-digit number (should be normalized to +1...)
    const result = await t.query(internal.functions.authInternal.getUserByPhoneInternal, {
      phone: "1234567890",
    });

    expect(result).not.toBeNull();
    expect(result?.phone).toBe("+11234567890");
  });
});

// ============================================================================
// getUserByEmailInternal Tests
// ============================================================================

describe("getUserByEmailInternal", () => {
  test("returns user when email exists", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(internal.functions.authInternal.getUserByEmailInternal, {
      email: "john@example.com",
    });

    expect(result).not.toBeNull();
    expect(result?._id).toBe(userId);
    expect(result?.email).toBe("john@example.com");
  });

  test("returns null when email not found", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(internal.functions.authInternal.getUserByEmailInternal, {
      email: "unknown@example.com",
    });

    expect(result).toBeNull();
  });

  test("normalizes email to lowercase before lookup", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Query with uppercase email
    const result = await t.query(internal.functions.authInternal.getUserByEmailInternal, {
      email: "JOHN@EXAMPLE.COM",
    });

    expect(result).not.toBeNull();
    expect(result?.email).toBe("john@example.com");
  });
});

// ============================================================================
// getUserWithCommunitiesInternal Tests
// ============================================================================

describe("getUserWithCommunitiesInternal", () => {
  test("returns null when user not found", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(internal.functions.authInternal.getUserWithCommunitiesInternal, {
      phone: "+19999999999",
    });

    expect(result).toBeNull();
  });

  test("returns user with empty communities when no memberships exist", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(internal.functions.authInternal.getUserWithCommunitiesInternal, {
      phone: "+11234567890",
    });

    expect(result).not.toBeNull();
    expect(result?.user.firstName).toBe("John");
    expect(result?.communities).toEqual([]);
    expect(result?.activeCommunity).toBeNull();
  });

  test("returns user with community memberships", async () => {
    const t = convexTest(schema, modules);

    const { userId, communityId } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Community",
        legacyId: "legacy-1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const userId = await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        activeCommunityId: communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: COMMUNITY_ROLES.ADMIN,
        status: MEMBERSHIP_STATUS.ACTIVE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return { userId, communityId };
    });

    const result = await t.query(internal.functions.authInternal.getUserWithCommunitiesInternal, {
      phone: "+11234567890",
    });

    expect(result).not.toBeNull();
    expect(result?.user._id).toBe(userId);
    expect(result?.communities).toHaveLength(1);
    expect(result?.communities[0].id).toBe(communityId);
    expect(result?.communities[0].isAdmin).toBe(true);
    expect(result?.activeCommunity?.id).toBe(communityId);
  });

  test("filters out blocked memberships", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Blocked Community",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const userId = await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        status: MEMBERSHIP_STATUS.BLOCKED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(internal.functions.authInternal.getUserWithCommunitiesInternal, {
      phone: "+11234567890",
    });

    expect(result?.communities).toEqual([]);
  });
});

// ============================================================================
// createUserInternal Tests
// ============================================================================

describe("createUserInternal", () => {
  test("creates a new user successfully", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.mutation(internal.functions.authInternal.createUserInternal, {
      phone: "+19999999999",
      firstName: "New",
      lastName: "User",
      email: "new@example.com",
    });

    expect(userId).toBeDefined();

    // Verify the user was created correctly
    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });

    expect(user?.phone).toBe("+19999999999");
    expect(user?.firstName).toBe("New");
    expect(user?.lastName).toBe("User");
    expect(user?.email).toBe("new@example.com");
    expect(user?.phoneVerified).toBe(true);
    expect(user?.isActive).toBe(true);
  });

  test("throws error when phone already exists", async () => {
    const t = convexTest(schema, modules);

    // Create existing user with same phone
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        phone: "+19999999999",
        firstName: "Existing",
        lastName: "User",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(internal.functions.authInternal.createUserInternal, {
        phone: "+19999999999",
        firstName: "New",
        lastName: "User",
      })
    ).rejects.toThrow("User with this phone already exists");
  });

  test("throws error when email already exists", async () => {
    const t = convexTest(schema, modules);

    // Create existing user with same email
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        email: "taken@example.com",
        firstName: "Existing",
        lastName: "User",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(internal.functions.authInternal.createUserInternal, {
        phone: "+19999999999",
        firstName: "New",
        lastName: "User",
        email: "taken@example.com",
      })
    ).rejects.toThrow("User with this email already exists");
  });

  test("creates user without email", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.mutation(internal.functions.authInternal.createUserInternal, {
      phone: "+19999999999",
      firstName: "New",
      lastName: "User",
    });

    expect(userId).toBeDefined();

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });

    expect(user?.email).toBeUndefined();
  });
});

// ============================================================================
// markPhoneVerifiedInternal Tests
// ============================================================================

describe("markPhoneVerifiedInternal", () => {
  test("marks phone as verified", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        phoneVerified: false,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.authInternal.markPhoneVerifiedInternal, {
      userId,
    });

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });

    expect(user?.phoneVerified).toBe(true);
  });
});

// ============================================================================
// unlinkPhoneInternal Tests
// ============================================================================

describe("unlinkPhoneInternal", () => {
  test("unlinks phone from user", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        phoneVerified: true,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.authInternal.unlinkPhoneInternal, {
      userId,
    });

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });

    expect(user?.phone).toBeUndefined();
    expect(user?.phoneVerified).toBe(false);
  });
});

// ============================================================================
// updateActiveCommunityInternal Tests
// ============================================================================

describe("updateActiveCommunityInternal", () => {
  test("updates user active community", async () => {
    const t = convexTest(schema, modules);

    const { userId, communityId } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Community",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const userId = await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return { userId, communityId };
    });

    await t.mutation(internal.functions.authInternal.updateActiveCommunityInternal, {
      userId,
      communityId,
    });

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });

    expect(user?.activeCommunityId).toBe(communityId);
  });
});

// ============================================================================
// ensureUserCommunityInternal Tests
// ============================================================================

describe("ensureUserCommunityInternal", () => {
  test("creates new membership when none exists", async () => {
    const t = convexTest(schema, modules);

    const { userId, communityId } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Community",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const userId = await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return { userId, communityId };
    });

    const membershipId = await t.mutation(internal.functions.authInternal.ensureUserCommunityInternal, {
      userId,
      communityId,
    });

    expect(membershipId).toBeDefined();

    const membership = await t.run(async (ctx) => {
      return await ctx.db.get(membershipId);
    });

    expect(membership?.userId).toBe(userId);
    expect(membership?.communityId).toBe(communityId);
    expect(membership?.status).toBe(MEMBERSHIP_STATUS.ACTIVE);
  });

  test("returns existing membership ID when already exists", async () => {
    const t = convexTest(schema, modules);

    const { userId, communityId, existingMembershipId } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Community",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const userId = await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const existingMembershipId = await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        status: MEMBERSHIP_STATUS.ACTIVE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return { userId, communityId, existingMembershipId };
    });

    const membershipId = await t.mutation(internal.functions.authInternal.ensureUserCommunityInternal, {
      userId,
      communityId,
    });

    expect(membershipId).toBe(existingMembershipId);
  });

  test("throws error when user is blocked from community", async () => {
    const t = convexTest(schema, modules);

    const { userId, communityId } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Community",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const userId = await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        status: MEMBERSHIP_STATUS.BLOCKED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return { userId, communityId };
    });

    await expect(
      t.mutation(internal.functions.authInternal.ensureUserCommunityInternal, {
        userId,
        communityId,
      })
    ).rejects.toThrow("You are blocked from this community");
  });

  test("updates lastLogin when updateLastLogin is true", async () => {
    const t = convexTest(schema, modules);

    const originalTime = Date.now() - 86400000; // 1 day ago

    const { userId, communityId, membershipId } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Test Community",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const userId = await ctx.db.insert("users", {
        phone: "+11234567890",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const membershipId = await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        status: MEMBERSHIP_STATUS.ACTIVE,
        lastLogin: originalTime,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return { userId, communityId, membershipId };
    });

    await t.mutation(internal.functions.authInternal.ensureUserCommunityInternal, {
      userId,
      communityId,
      updateLastLogin: true,
    });

    const membership = await t.run(async (ctx) => {
      return await ctx.db.get(membershipId);
    });

    expect(membership?.lastLogin).toBeGreaterThan(originalTime);
  });
});

// ============================================================================
// linkPhoneInternal Tests
// ============================================================================

describe("linkPhoneInternal", () => {
  test("links phone to user successfully", async () => {
    const t = convexTest(schema, modules);

    const userId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        email: "user@example.com",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(internal.functions.authInternal.linkPhoneInternal, {
      userId,
      phone: "+19999999999",
    });

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });

    expect(user?.phone).toBe("+19999999999");
    expect(user?.phoneVerified).toBe(true);
  });

  test("throws error when phone already linked to another user", async () => {
    const t = convexTest(schema, modules);

    const { userId } = await t.run(async (ctx) => {
      // Create another user with the phone number
      await ctx.db.insert("users", {
        phone: "+19999999999",
        firstName: "Other",
        lastName: "User",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Create the user we want to link the phone to
      const userId = await ctx.db.insert("users", {
        email: "user@example.com",
        firstName: "John",
        lastName: "Doe",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      return { userId };
    });

    await expect(
      t.mutation(internal.functions.authInternal.linkPhoneInternal, {
        userId,
        phone: "+19999999999",
      })
    ).rejects.toThrow("Phone number already linked to another account");
  });
});

// ============================================================================
// createAccountClaimRequestInternal Tests
// ============================================================================

describe("createAccountClaimRequestInternal", () => {
  test("creates account claim request", async () => {
    const t = convexTest(schema, modules);

    const claimId = await t.mutation(internal.functions.authInternal.createAccountClaimRequestInternal, {
      name: "Jane Smith",
      communityName: "Test Church",
      phone: "+19999999999",
      possibleEmails: ["jane@example.com", "j.smith@work.com"],
    });

    expect(claimId).toBeDefined();

    const claim = await t.run(async (ctx) => {
      return await ctx.db.get(claimId);
    });

    expect(claim?.name).toBe("Jane Smith");
    expect(claim?.communityName).toBe("Test Church");
    expect(claim?.phone).toBe("+19999999999");
    expect(claim?.possibleEmails).toEqual(["jane@example.com", "j.smith@work.com"]);
    expect(claim?.status).toBe("pending");
    expect(claim?.notes).toBe("");
  });
});

// ============================================================================
// Integration-Like Flow Tests
// ============================================================================

describe("Auth Flow Integration Tests", () => {
  describe("New User Registration Flow", () => {
    test("handles complete new user registration", async () => {
      const t = convexTest(schema, modules);

      // Step 1: Phone lookup returns no user
      const lookupResult = await t.query(internal.functions.authInternal.getUserByPhoneInternal, {
        phone: "+19999999999",
      });
      expect(lookupResult).toBeNull();

      // Step 2: Create new user
      const userId = await t.mutation(internal.functions.authInternal.createUserInternal, {
        phone: "+19999999999",
        firstName: "New",
        lastName: "User",
        email: "new@example.com",
      });

      expect(userId).toBeDefined();

      // Step 3: Verify user can now be found
      const user = await t.query(internal.functions.authInternal.getUserByPhoneInternal, {
        phone: "+19999999999",
      });

      expect(user).not.toBeNull();
      expect(user?._id).toBe(userId);
    });
  });

  describe("Existing User Login Flow", () => {
    test("handles user lookup and community membership check", async () => {
      const t = convexTest(schema, modules);

      const { communityId } = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const userId = await ctx.db.insert("users", {
          phone: "+11234567890",
          firstName: "John",
          lastName: "Doe",
          phoneVerified: true,
          activeCommunityId: communityId,
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        await ctx.db.insert("userCommunities", {
          userId,
          communityId,
          status: MEMBERSHIP_STATUS.ACTIVE,
          roles: COMMUNITY_ROLES.MEMBER,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { communityId };
      });

      const result = await t.query(internal.functions.authInternal.getUserWithCommunitiesInternal, {
        phone: "+11234567890",
      });

      expect(result).not.toBeNull();
      expect(result?.user.phoneVerified).toBe(true);
      expect(result?.communities).toHaveLength(1);
      expect(result?.activeCommunity?.id).toBe(communityId);
    });
  });

  describe("Account Claim Flow", () => {
    test("handles claim account request creation", async () => {
      const t = convexTest(schema, modules);

      // Create claim request
      const claimId = await t.mutation(internal.functions.authInternal.createAccountClaimRequestInternal, {
        name: "Jane Smith",
        communityName: "Test Church",
        phone: "+19999999999",
        possibleEmails: ["jane@example.com"],
      });

      expect(claimId).toBeDefined();

      // Verify claim was created
      const claim = await t.run(async (ctx) => {
        return await ctx.db.get(claimId);
      });

      expect(claim?.status).toBe("pending");
    });
  });

  describe("Phone Linking Flow", () => {
    test("handles linking phone to existing account", async () => {
      const t = convexTest(schema, modules);

      const userId = await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          email: "user@example.com",
          firstName: "John",
          lastName: "Doe",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      await t.mutation(internal.functions.authInternal.linkPhoneInternal, {
        userId,
        phone: "+19999999999",
      });

      const user = await t.run(async (ctx) => {
        return await ctx.db.get(userId);
      });

      expect(user?.phone).toBe("+19999999999");
      expect(user?.phoneVerified).toBe(true);
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Auth Edge Cases", () => {
  describe("Phone Number Handling", () => {
    test("handles various phone number formats", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          phone: "+11234567890",
          firstName: "John",
          lastName: "Doe",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      // Test with 10 digit number (gets +1 prefix)
      const result = await t.query(internal.functions.authInternal.getUserByPhoneInternal, {
        phone: "1234567890",
      });

      expect(result).not.toBeNull();
      expect(result?.phone).toBe("+11234567890");
    });
  });

  describe("Email Normalization", () => {
    test("handles mixed case emails", async () => {
      const t = convexTest(schema, modules);

      await t.run(async (ctx) => {
        await ctx.db.insert("users", {
          email: "john.doe@example.com",
          firstName: "John",
          lastName: "Doe",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const result = await t.query(internal.functions.authInternal.getUserByEmailInternal, {
        email: "John.Doe@Example.COM",
      });

      expect(result).not.toBeNull();
      expect(result?.email).toBe("john.doe@example.com");
    });
  });

  describe("Blocked User Handling", () => {
    test("prevents blocked users from joining community", async () => {
      const t = convexTest(schema, modules);

      const { userId, communityId } = await t.run(async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Test Community",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        const userId = await ctx.db.insert("users", {
          phone: "+11234567890",
          firstName: "John",
          lastName: "Doe",
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        await ctx.db.insert("userCommunities", {
          userId,
          communityId,
          status: MEMBERSHIP_STATUS.BLOCKED,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        return { userId, communityId };
      });

      await expect(
        t.mutation(internal.functions.authInternal.ensureUserCommunityInternal, {
          userId,
          communityId,
        })
      ).rejects.toThrow("You are blocked from this community");
    });
  });
});
