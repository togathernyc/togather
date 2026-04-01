/**
 * Auth Verification & Rate Limiting Tests
 *
 * Tests for email verification codes, phone verification tokens,
 * rate limiting, and community activation functions in authInternal.ts.
 *
 * Run with: cd convex && pnpm test __tests__/auth-verification.test.ts
 */

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";

// ============================================================================
// Test Helpers
// ============================================================================

async function seedUser(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      phone: "+12025550123",
      firstName: "Test",
      lastName: "User",
      phoneVerified: true,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function seedCommunity(t: ReturnType<typeof convexTest>, name = "Test Community") {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

// ============================================================================
// Email Verification Code Tests
// ============================================================================

describe("storeEmailVerificationCode", () => {
  test("stores a new verification code", async () => {
    const t = convexTest(schema, modules);

    const codeId = await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "test@example.com",
        code: "123456",
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    );

    expect(codeId).toBeTruthy();
  });

  test("normalizes email to lowercase", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "Test@EXAMPLE.com",
        code: "123456",
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    );

    // Verify code was stored with lowercase email
    const codes = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailVerificationCodes")
        .withIndex("by_email", (q) => q.eq("email", "test@example.com"))
        .collect();
    });

    expect(codes).toHaveLength(1);
    expect(codes[0].email).toBe("test@example.com");
  });

  test("deletes existing codes for same email before inserting", async () => {
    const t = convexTest(schema, modules);

    // Store first code
    await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "test@example.com",
        code: "111111",
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    );

    // Store second code for same email
    await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "test@example.com",
        code: "222222",
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    );

    // Only the second code should exist
    const codes = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailVerificationCodes")
        .withIndex("by_email", (q) => q.eq("email", "test@example.com"))
        .collect();
    });

    expect(codes).toHaveLength(1);
    expect(codes[0].code).toBe("222222");
  });
});

describe("verifyEmailCode", () => {
  test("returns valid for correct code", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "test@example.com",
        code: "123456",
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    );

    const result = await t.mutation(
      internal.functions.authInternal.verifyEmailCode,
      { email: "test@example.com", code: "123456" }
    );

    expect(result.valid).toBe(true);
  });

  test("returns invalid for wrong code", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "test@example.com",
        code: "123456",
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    );

    const result = await t.mutation(
      internal.functions.authInternal.verifyEmailCode,
      { email: "test@example.com", code: "999999" }
    );

    expect(result.valid).toBe(false);
  });

  test("returns invalid for non-existent email", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(
      internal.functions.authInternal.verifyEmailCode,
      { email: "nobody@example.com", code: "123456" }
    );

    expect(result.valid).toBe(false);
  });

  test("returns invalid for expired code", async () => {
    const t = convexTest(schema, modules);

    // Store code that's already expired
    await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "test@example.com",
        code: "123456",
        expiresAt: Date.now() - 1000, // expired 1 second ago
      }
    );

    const result = await t.mutation(
      internal.functions.authInternal.verifyEmailCode,
      { email: "test@example.com", code: "123456" }
    );

    expect(result.valid).toBe(false);
  });

  test("returns invalid for already-used code", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "test@example.com",
        code: "123456",
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    );

    // Use the code
    const first = await t.mutation(
      internal.functions.authInternal.verifyEmailCode,
      { email: "test@example.com", code: "123456" }
    );
    expect(first.valid).toBe(true);

    // Try to use it again
    const second = await t.mutation(
      internal.functions.authInternal.verifyEmailCode,
      { email: "test@example.com", code: "123456" }
    );
    expect(second.valid).toBe(false);
  });

  test("normalizes email for verification", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storeEmailVerificationCode,
      {
        email: "test@example.com",
        code: "123456",
        expiresAt: Date.now() + 10 * 60 * 1000,
      }
    );

    // Verify with different casing
    const result = await t.mutation(
      internal.functions.authInternal.verifyEmailCode,
      { email: "TEST@Example.COM", code: "123456" }
    );

    expect(result.valid).toBe(true);
  });
});

describe("cleanupExpiredEmailCodes", () => {
  test("deletes expired codes", async () => {
    const t = convexTest(schema, modules);

    // Store an expired code directly
    await t.run(async (ctx) => {
      await ctx.db.insert("emailVerificationCodes", {
        email: "old@example.com",
        code: "111111",
        expiresAt: Date.now() - 60 * 1000, // expired 1 min ago
        createdAt: Date.now() - 120 * 1000,
      });
    });

    const result = await t.mutation(
      internal.functions.authInternal.cleanupExpiredEmailCodes,
      {}
    );

    expect(result.deletedCount).toBe(1);
  });

  test("preserves non-expired codes", async () => {
    const t = convexTest(schema, modules);

    // Store a valid code
    await t.run(async (ctx) => {
      await ctx.db.insert("emailVerificationCodes", {
        email: "active@example.com",
        code: "222222",
        expiresAt: Date.now() + 60 * 60 * 1000, // expires in 1 hour
        createdAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.functions.authInternal.cleanupExpiredEmailCodes,
      {}
    );

    expect(result.deletedCount).toBe(0);

    // Verify code still exists
    const codes = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailVerificationCodes")
        .withIndex("by_email", (q) => q.eq("email", "active@example.com"))
        .collect();
    });
    expect(codes).toHaveLength(1);
  });
});

// ============================================================================
// Phone Verification Token Tests
// ============================================================================

describe("storePhoneVerificationToken", () => {
  test("stores a new verification token", async () => {
    const t = convexTest(schema, modules);

    const result = await t.mutation(
      internal.functions.authInternal.storePhoneVerificationToken,
      { phone: "+12025550123", token: "abc-token-123" }
    );

    expect(result.success).toBe(true);
  });

  test("deletes existing tokens for same phone before inserting", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storePhoneVerificationToken,
      { phone: "+12025550123", token: "old-token" }
    );

    await t.mutation(
      internal.functions.authInternal.storePhoneVerificationToken,
      { phone: "+12025550123", token: "new-token" }
    );

    const tokens = await t.run(async (ctx) => {
      return await ctx.db
        .query("phoneVerificationTokens")
        .withIndex("by_phone", (q) => q.eq("phone", "+12025550123"))
        .collect();
    });

    expect(tokens).toHaveLength(1);
    expect(tokens[0].token).toBe("new-token");
  });
});

describe("verifyPhoneToken", () => {
  test("returns valid for correct token", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storePhoneVerificationToken,
      { phone: "+12025550123", token: "valid-token" }
    );

    const result = await t.mutation(
      internal.functions.authInternal.verifyPhoneToken,
      { phone: "+12025550123", token: "valid-token" }
    );

    expect(result.valid).toBe(true);
  });

  test("returns invalid for wrong token", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storePhoneVerificationToken,
      { phone: "+12025550123", token: "correct-token" }
    );

    const result = await t.mutation(
      internal.functions.authInternal.verifyPhoneToken,
      { phone: "+12025550123", token: "wrong-token" }
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Token not found");
  });

  test("returns invalid for already-used token", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(
      internal.functions.authInternal.storePhoneVerificationToken,
      { phone: "+12025550123", token: "one-time-token" }
    );

    // Use the token
    const first = await t.mutation(
      internal.functions.authInternal.verifyPhoneToken,
      { phone: "+12025550123", token: "one-time-token" }
    );
    expect(first.valid).toBe(true);

    // Try to reuse
    const second = await t.mutation(
      internal.functions.authInternal.verifyPhoneToken,
      { phone: "+12025550123", token: "one-time-token" }
    );
    expect(second.valid).toBe(false);
    expect(second.reason).toBe("Token already used");
  });

  test("returns invalid for expired token", async () => {
    const t = convexTest(schema, modules);

    // Insert an already-expired token directly
    await t.run(async (ctx) => {
      await ctx.db.insert("phoneVerificationTokens", {
        phone: "+12025550123",
        token: "expired-token",
        expiresAt: Date.now() - 1000,
        createdAt: Date.now() - 15 * 60 * 1000,
      });
    });

    const result = await t.mutation(
      internal.functions.authInternal.verifyPhoneToken,
      { phone: "+12025550123", token: "expired-token" }
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Token expired");
  });
});

describe("cleanupExpiredPhoneTokens", () => {
  test("deletes expired tokens and preserves valid ones", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      // Expired token
      await ctx.db.insert("phoneVerificationTokens", {
        phone: "+12025550001",
        token: "expired",
        expiresAt: Date.now() - 60 * 1000,
        createdAt: Date.now() - 120 * 1000,
      });
      // Valid token
      await ctx.db.insert("phoneVerificationTokens", {
        phone: "+12025550002",
        token: "valid",
        expiresAt: Date.now() + 60 * 60 * 1000,
        createdAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.functions.authInternal.cleanupExpiredPhoneTokens,
      {}
    );

    expect(result.deletedCount).toBe(1);

    // Verify valid token still exists
    const remaining = await t.run(async (ctx) => {
      return await ctx.db
        .query("phoneVerificationTokens")
        .withIndex("by_phone", (q) => q.eq("phone", "+12025550002"))
        .collect();
    });
    expect(remaining).toHaveLength(1);
  });
});

// ============================================================================
// Rate Limiting Tests
// ============================================================================

describe("checkRateLimitInternal", () => {
  test("allows first attempt", async () => {
    const t = convexTest(schema, modules);

    // Should not throw
    await t.mutation(
      internal.functions.authInternal.checkRateLimitInternal,
      { key: "test:rate-limit", maxAttempts: 3, windowMs: 60000 }
    );
  });

  test("allows attempts up to the limit", async () => {
    const t = convexTest(schema, modules);

    // Attempt 1, 2, 3 should all succeed
    for (let i = 0; i < 3; i++) {
      await t.mutation(
        internal.functions.authInternal.checkRateLimitInternal,
        { key: "test:limit-3", maxAttempts: 3, windowMs: 60000 }
      );
    }
  });

  test("throws when rate limit exceeded", async () => {
    const t = convexTest(schema, modules);

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      await t.mutation(
        internal.functions.authInternal.checkRateLimitInternal,
        { key: "test:exceeded", maxAttempts: 3, windowMs: 60000 }
      );
    }

    // 4th attempt should throw
    await expect(
      t.mutation(
        internal.functions.authInternal.checkRateLimitInternal,
        { key: "test:exceeded", maxAttempts: 3, windowMs: 60000 }
      )
    ).rejects.toThrow("Too many attempts");
  });

  test("different keys have independent limits", async () => {
    const t = convexTest(schema, modules);

    // Max out key A
    for (let i = 0; i < 2; i++) {
      await t.mutation(
        internal.functions.authInternal.checkRateLimitInternal,
        { key: "test:key-a", maxAttempts: 2, windowMs: 60000 }
      );
    }

    // Key B should still work
    await t.mutation(
      internal.functions.authInternal.checkRateLimitInternal,
      { key: "test:key-b", maxAttempts: 2, windowMs: 60000 }
    );
  });
});

// ============================================================================
// ensureAndActivateCommunityInternal Tests
// ============================================================================

describe("ensureAndActivateCommunityInternal", () => {
  test("creates new membership and sets active community", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const communityId = await seedCommunity(t);

    const membershipId = await t.mutation(
      internal.functions.authInternal.ensureAndActivateCommunityInternal,
      { userId, communityId }
    );

    expect(membershipId).toBeTruthy();

    // Verify membership created
    const membership = await t.run(async (ctx) => {
      return await ctx.db.get(membershipId);
    });
    expect(membership?.userId).toBe(userId);
    expect(membership?.communityId).toBe(communityId);
    expect(membership?.status).toBe(1); // Active

    // Verify active community set
    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });
    expect(user?.activeCommunityId).toBe(communityId);
  });

  test("returns existing membership without creating duplicate", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const communityId = await seedCommunity(t);

    const first = await t.mutation(
      internal.functions.authInternal.ensureAndActivateCommunityInternal,
      { userId, communityId }
    );

    const second = await t.mutation(
      internal.functions.authInternal.ensureAndActivateCommunityInternal,
      { userId, communityId }
    );

    expect(first).toBe(second);
  });

  test("throws for blocked user", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const communityId = await seedCommunity(t);

    // Create blocked membership
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        status: 3, // Blocked
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(
        internal.functions.authInternal.ensureAndActivateCommunityInternal,
        { userId, communityId }
      )
    ).rejects.toThrow("blocked from this community");
  });

  test("updates lastLogin when requested", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const communityId = await seedCommunity(t);

    // Create membership
    const membershipId = await t.mutation(
      internal.functions.authInternal.ensureAndActivateCommunityInternal,
      { userId, communityId }
    );

    const before = await t.run(async (ctx) => {
      return await ctx.db.get(membershipId);
    });

    // Call again with updateLastLogin
    await t.mutation(
      internal.functions.authInternal.ensureAndActivateCommunityInternal,
      { userId, communityId, updateLastLogin: true }
    );

    const after = await t.run(async (ctx) => {
      return await ctx.db.get(membershipId);
    });

    expect(after?.lastLogin).toBeGreaterThanOrEqual(before?.lastLogin ?? 0);
  });

  test("switches active community atomically", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const community1 = await seedCommunity(t, "Community 1");
    const community2 = await seedCommunity(t, "Community 2");

    // Join community 1
    await t.mutation(
      internal.functions.authInternal.ensureAndActivateCommunityInternal,
      { userId, communityId: community1 }
    );

    // Switch to community 2
    await t.mutation(
      internal.functions.authInternal.ensureAndActivateCommunityInternal,
      { userId, communityId: community2 }
    );

    const user = await t.run(async (ctx) => {
      return await ctx.db.get(userId);
    });
    expect(user?.activeCommunityId).toBe(community2);
  });
});
