"use node";
/**
 * User Registration
 *
 * Handles new user registration flows:
 * - registerNewUser: Phone-based registration for new users
 * - signup: Legacy email/password signup
 * - changePassword: Password change for existing users
 * - sendResetPasswordEmail: Send password reset code via email
 * - resetPassword: Verify code and set new password
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { normalizePhone } from "../../lib/utils";
import { generateTokens, requireAuthFromTokenAction } from "../../lib/auth";
import { parseAndValidateDate, isTestEmail, MAGIC_CODE } from "./helpers";
import { sendEmailOTP, verifyEmailOTP } from "./emailOtp";

/**
 * Register a new user and return JWT tokens
 * tRPC equivalent: registerNewUser
 */
export const registerNewUser = action({
  args: {
    phone: v.string(),
    countryCode: v.optional(v.string()),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    otp: v.string(),
    phoneVerificationToken: v.optional(v.string()), // Token proving phone was verified
    dateOfBirth: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      phoneVerified: boolean;
    };
  }> => {
    const normalizedPhone = normalizePhone(args.phone);

    // Security: Verify that the phone was actually verified via verifyPhoneOTP.
    // This prevents attackers from calling registerNewUser directly without
    // going through the phone verification flow.

    // Validate that OTP was provided (indicates user went through verification flow)
    if (!args.otp) {
      throw new Error("Verification code is required");
    }

    if (args.otp.length !== 6) {
      throw new Error("Invalid verification code format");
    }

    // Require the phone verification token before any other work.
    if (!args.phoneVerificationToken) {
      throw new Error(
        "Phone verification token is required. Please complete phone verification first."
      );
    }

    // Validate dateOfBirth BEFORE consuming the phone verification token.
    // verifyPhoneToken is single-use; if we consumed it first and then
    // threw on a bad date, the user's retry would fail with "Token already
    // used" and they'd have to restart phone OTP for a fixable client error.
    const dateOfBirth = args.dateOfBirth
      ? parseAndValidateDate(args.dateOfBirth)
      : undefined;

    const tokenResult = await ctx.runMutation(
      internal.functions.authInternal.verifyPhoneToken,
      {
        phone: normalizedPhone,
        token: args.phoneVerificationToken,
      }
    );

    if (!tokenResult.valid) {
      console.error(
        `[registerNewUser] Phone verification token invalid: ${tokenResult.reason}`
      );
      throw new Error(
        "Phone verification failed. Please verify your phone number again."
      );
    }

    // Check if user already exists (handles race conditions and retries)
    const existingUser = await ctx.runQuery(
      internal.functions.authInternal.getUserByPhoneInternal,
      { phone: normalizedPhone }
    );

    if (existingUser) {
      // User already exists - this is a retry or race condition
      // Return their info instead of erroring (idempotent behavior)
      console.log(
        `[registerNewUser] User already exists with phone ${normalizedPhone}, returning existing user`
      );

      const tokens = await generateTokens(existingUser._id);

      return {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
        user: {
          id: existingUser._id,
          firstName: existingUser.firstName || args.firstName,
          lastName: existingUser.lastName || args.lastName,
          email: existingUser.email || args.email || "",
          phone: normalizedPhone,
          phoneVerified: existingUser.phoneVerified ?? true,
        },
      };
    }

    // Create new user
    // Wrap in try-catch to handle race condition where another request
    // created the user between our existence check and this mutation
    let userId: string;
    try {
      userId = await ctx.runMutation(
        internal.functions.authInternal.createUserInternal,
        {
          phone: normalizedPhone,
          firstName: args.firstName,
          lastName: args.lastName,
          email: args.email,
          dateOfBirth,
        }
      );
    } catch (error) {
      // Check if this is a duplicate phone error (race condition)
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("phone already exists") ||
        errorMessage.includes("duplicate")
      ) {
        // Re-query and return existing user (another request won the race)
        const raceWinnerUser = await ctx.runQuery(
          internal.functions.authInternal.getUserByPhoneInternal,
          { phone: normalizedPhone }
        );

        if (raceWinnerUser) {
          console.log(
            `[registerNewUser] Race condition detected - user created by another request`
          );
          const tokens = await generateTokens(raceWinnerUser._id);

          return {
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
            expires_in: tokens.expiresIn,
            user: {
              id: raceWinnerUser._id,
              firstName: raceWinnerUser.firstName || args.firstName,
              lastName: raceWinnerUser.lastName || args.lastName,
              email: raceWinnerUser.email || args.email || "",
              phone: normalizedPhone,
              phoneVerified: raceWinnerUser.phoneVerified ?? true,
            },
          };
        }
      }
      // Re-throw if not a duplicate error
      throw error;
    }

    // Generate JWT tokens (no community yet)
    const tokens = await generateTokens(userId);

    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      user: {
        id: userId,
        firstName: args.firstName,
        lastName: args.lastName,
        email: args.email || "",
        phone: normalizedPhone,
        phoneVerified: true,
      },
    };
  },
});

/**
 * Legacy email/password signup with JWT tokens
 * tRPC equivalent: signup
 */
export const signup = action({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    password: v.string(),
    dateOfBirth: v.string(),
    communityId: v.id("communities"),
    location: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    otp: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    };
  }> => {
    // Validate password length
    if (args.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    // Hash password
    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(args.password, 10);

    // Normalize phone if provided
    let normalizedPhone: string | undefined;
    if (args.phone) {
      normalizedPhone = normalizePhone(args.phone);
    }

    // Create user
    // Validate dateOfBirth with strict calendar date validation
    const dateOfBirth = parseAndValidateDate(args.dateOfBirth);

    const userId = await ctx.runMutation(
      internal.functions.authInternal.createUserWithPasswordInternal,
      {
        firstName: args.firstName,
        lastName: args.lastName,
        email: args.email,
        passwordHash,
        dateOfBirth,
        phone: normalizedPhone,
        phoneVerified: !!args.otp,
        communityId: args.communityId,
      }
    );

    // Generate JWT tokens with community
    const tokens = await generateTokens(userId, args.communityId);

    return {
      success: true,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      user: {
        id: userId,
        firstName: args.firstName,
        lastName: args.lastName,
        email: args.email,
      },
    };
  },
});

/**
 * Change password
 * tRPC equivalent: changePassword
 */
export const changePassword = action({
  args: {
    token: v.string(),
    oldPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    // Derive userId from auth token instead of accepting from client
    const tokenUserId = await requireAuthFromTokenAction(ctx, args.token);

    // Resolve to Convex user ID
    const resolved = await ctx.runQuery(internal.functions.users.resolveUserIdInternal, {
      tokenUserId,
    });
    if (!resolved) {
      throw new Error("Not authenticated");
    }
    const userId = resolved.userId;

    // Validate new password length
    if (args.newPassword.length < 8) {
      throw new Error("New password must be at least 8 characters");
    }

    // Get user
    const user = await ctx.runQuery(internal.functions.users.getByIdInternal, {
      userId,
    });

    if (!user || !user.password) {
      throw new Error("Password not set for this account");
    }

    // Verify old password
    const bcrypt = await import("bcryptjs");
    const isValidPassword = await bcrypt.compare(
      args.oldPassword,
      user.password
    );

    if (!isValidPassword) {
      throw new Error("Invalid current password");
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(args.newPassword, 10);

    // Update password
    await ctx.runMutation(
      internal.functions.authInternal.updatePasswordInternal,
      {
        userId,
        passwordHash: newPasswordHash,
      }
    );

    return { success: true };
  },
});

/**
 * Send a password reset code to the user's email.
 *
 * Looks up the user by email and sends a 6-digit OTP via Resend.
 * For security, always returns success even if no user is found
 * (prevents email enumeration).
 */
export const sendResetPasswordEmail = action({
  args: {
    email: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const normalizedEmail = args.email.toLowerCase().trim();

    // Look up user by email (don't reveal if they exist)
    const user = await ctx.runQuery(
      internal.functions.authInternal.getUserByEmailInternal,
      { email: normalizedEmail }
    );

    if (!user) {
      // Return success to prevent email enumeration
      return { success: true };
    }

    // Send OTP via Resend (reuses email OTP infrastructure).
    // Swallow send failures so responses match the non-existent-user path (enumeration-safe).
    try {
      await sendEmailOTP(ctx, normalizedEmail, "password_reset");
    } catch (error) {
      console.error("sendResetPasswordEmail: failed to send OTP", {
        email: normalizedEmail,
        error,
      });
    }

    return { success: true };
  },
});

/**
 * Reset password using email OTP verification.
 *
 * Verifies the email OTP code, then sets the new password.
 */
export const resetPassword = action({
  args: {
    email: v.string(),
    code: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const normalizedEmail = args.email.toLowerCase().trim();

    // Validate new password length
    if (args.newPassword.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    // Rate limit verification attempts (aligned with verifyPhoneOTP: 10 / 15 min).
    // Skip when test email uses magic code — same conditions as verifyEmailOTP.
    const isProduction = process.env.NODE_ENV === "production";
    const isDebug = process.env.DEBUG === "true";
    const skipRateLimit =
      isTestEmail(normalizedEmail) &&
      args.code === MAGIC_CODE &&
      (!isProduction || isDebug);
    if (!skipRateLimit) {
      await ctx.runMutation(
        internal.functions.authInternal.checkRateLimitInternal,
        {
          key: `reset_password_verify:${normalizedEmail}`,
          maxAttempts: 10,
          windowMs: 15 * 60 * 1000,
        }
      );
    }

    // Verify the OTP code
    const isValid = await verifyEmailOTP(
      ctx,
      normalizedEmail,
      args.code,
      "password_reset"
    );
    if (!isValid) {
      throw new Error("Invalid or expired reset code");
    }

    // Look up user by email
    const user = await ctx.runQuery(
      internal.functions.authInternal.getUserByEmailInternal,
      { email: normalizedEmail }
    );

    if (!user) {
      // Return generic error to prevent account enumeration.
      // The OTP was already consumed, so an attacker can't retry.
      throw new Error("Invalid or expired reset code");
    }

    // Hash new password
    const bcrypt = await import("bcryptjs");
    const passwordHash = await bcrypt.hash(args.newPassword, 10);

    // Update password
    await ctx.runMutation(
      internal.functions.authInternal.updatePasswordInternal,
      {
        userId: user._id,
        passwordHash,
      }
    );

    return { success: true };
  },
});
