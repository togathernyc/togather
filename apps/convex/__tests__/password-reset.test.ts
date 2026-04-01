/**
 * Password Reset Tests
 *
 * Tests the sendResetPasswordEmail and resetPassword actions
 * using test email bypass (no actual Resend calls).
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// Set up environment variables for test
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";
process.env.OTP_TEST_EMAIL_ADDRESSES = "test@example.com,reset@test.com";

const MAGIC_CODE = "000000";

// ============================================================================
// Test Helpers
// ============================================================================

async function createUserWithPassword(
  t: ReturnType<typeof convexTest>,
  email: string = "test@example.com"
) {
  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.hash("oldpassword123", 10);

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      email: email.toLowerCase(),
      phone: "+15555550001",
      phoneVerified: true,
      password: passwordHash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return userId;
}

// ============================================================================
// Tests
// ============================================================================

describe("sendResetPasswordEmail", () => {
  test("returns success for existing user", async () => {
    const t = convexTest(schema, modules);
    await createUserWithPassword(t);

    const result = await t.action(
      api.functions.auth.registration.sendResetPasswordEmail,
      { email: "test@example.com" }
    );

    expect(result.success).toBe(true);
  });

  test("returns success for non-existent user (prevents enumeration)", async () => {
    const t = convexTest(schema, modules);

    const result = await t.action(
      api.functions.auth.registration.sendResetPasswordEmail,
      { email: "nonexistent@example.com" }
    );

    // Should still return success to prevent email enumeration
    expect(result.success).toBe(true);
  });

  test("handles case-insensitive emails", async () => {
    const t = convexTest(schema, modules);
    await createUserWithPassword(t, "Test@Example.com");

    const result = await t.action(
      api.functions.auth.registration.sendResetPasswordEmail,
      { email: "TEST@EXAMPLE.COM" }
    );

    expect(result.success).toBe(true);
  });

  test("returns success when Resend is unavailable (prevents enumeration vs missing user)", async () => {
    const t = convexTest(schema, modules);
    const prevKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      await createUserWithPassword(t, "realuser@example.com");
      const result = await t.action(
        api.functions.auth.registration.sendResetPasswordEmail,
        { email: "realuser@example.com" }
      );
      expect(result.success).toBe(true);
    } finally {
      if (prevKey !== undefined) {
        process.env.RESEND_API_KEY = prevKey;
      } else {
        delete process.env.RESEND_API_KEY;
      }
    }
  });
});

describe("resetPassword", () => {
  test("resets password with valid code", async () => {
    const t = convexTest(schema, modules);
    const userId = await createUserWithPassword(t);

    // Send reset email (stores magic code for test email)
    await t.action(
      api.functions.auth.registration.sendResetPasswordEmail,
      { email: "test@example.com" }
    );

    // Reset password using magic code
    const result = await t.action(
      api.functions.auth.registration.resetPassword,
      {
        email: "test@example.com",
        code: MAGIC_CODE,
        newPassword: "newpassword123",
      }
    );

    expect(result.success).toBe(true);

    // Verify the password was actually updated
    const user = await t.run(async (ctx) => ctx.db.get(userId));
    expect(user!.password).toBeDefined();
    expect(user!.password).not.toBe(""); // Should be a bcrypt hash

    // Verify the new password works
    const bcrypt = await import("bcryptjs");
    const isValid = await bcrypt.compare("newpassword123", user!.password!);
    expect(isValid).toBe(true);
  });

  test("rejects short passwords", async () => {
    const t = convexTest(schema, modules);
    await createUserWithPassword(t);

    await expect(
      t.action(api.functions.auth.registration.resetPassword, {
        email: "test@example.com",
        code: MAGIC_CODE,
        newPassword: "short",
      })
    ).rejects.toThrow("Password must be at least 8 characters");
  });

  test("rejects invalid code", async () => {
    const t = convexTest(schema, modules);
    await createUserWithPassword(t);

    await expect(
      t.action(api.functions.auth.registration.resetPassword, {
        email: "test@example.com",
        code: "999999",
        newPassword: "newpassword123",
      })
    ).rejects.toThrow();
  });

  test("rejects for non-existent user after valid code", async () => {
    const t = convexTest(schema, modules);
    // Don't create a user, but use a test email that allows magic code

    await expect(
      t.action(api.functions.auth.registration.resetPassword, {
        email: "reset@test.com",
        code: MAGIC_CODE,
        newPassword: "newpassword123",
      })
    ).rejects.toThrow("No account found with this email");
  });
});
