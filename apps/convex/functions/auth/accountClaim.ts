"use node";
/**
 * Account Claiming
 *
 * Handles account claiming flows for users who need to link a phone
 * to an existing account:
 * - claimAccount: Multi-step flow for email verification and phone linking
 * - submitAccountClaimRequest: Manual review request for account claims
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { normalizePhone } from "../../lib/utils";
import { generateTokens } from "../../lib/auth";
import { maskEmail } from "./helpers";
import { sendEmailOTP, verifyEmailOTP } from "./emailOtp";

/**
 * Claim account - lookup, send OTP, verify, and link phone to existing account
 * tRPC equivalent: claimAccount
 */
export const claimAccount = action({
  args: {
    action: v.union(
      v.literal("lookup"),
      v.literal("send_otp"),
      v.literal("send_otp_for_registration"),
      v.literal("verify_only"),
      v.literal("verify_and_link")
    ),
    email: v.optional(v.string()),
    code: v.optional(v.string()),
    phone: v.string(),
    countryCode: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    user_found?: boolean;
    masked_email?: string | null;
    otp_sent?: boolean;
    verified?: boolean;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    communities?: Array<{
      id: string;
      legacyId: string | undefined;
      name: string;
      logo: string | null;
      role: number;
      isAdmin: boolean;
      isPrimaryAdmin: boolean;
    } | null>;
    user?: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      phoneVerified: boolean;
    };
  }> => {
    const normalizedPhone = normalizePhone(args.phone);

    // ACTION: LOOKUP - Check if email exists
    if (args.action === "lookup") {
      if (!args.email) {
        throw new Error("Email is required for lookup");
      }

      const user = await ctx.runQuery(
        internal.functions.authInternal.getUserByEmailInternal,
        { email: args.email }
      );

      return {
        user_found: !!user,
        masked_email: user ? maskEmail(args.email) : null,
      };
    }

    // ACTION: SEND_OTP - Send verification code to email
    if (args.action === "send_otp") {
      if (!args.email) {
        throw new Error("Email is required to send OTP");
      }

      const user = await ctx.runQuery(
        internal.functions.authInternal.getUserByEmailInternal,
        { email: args.email }
      );

      if (!user) {
        throw new Error("No account found with this email");
      }

      // Send OTP via Resend
      await sendEmailOTP(ctx, args.email, "account_claim");

      return {
        user_found: true,
        masked_email: maskEmail(args.email),
        otp_sent: true,
      };
    }

    // ACTION: SEND_OTP_FOR_REGISTRATION - Send OTP for new user registration (no user check)
    if (args.action === "send_otp_for_registration") {
      if (!args.email) {
        throw new Error("Email is required to send OTP");
      }

      // Send OTP via Resend - no user existence check
      await sendEmailOTP(ctx, args.email, "account_claim");

      return {
        masked_email: maskEmail(args.email),
        otp_sent: true,
      };
    }

    // ACTION: VERIFY_ONLY - Just verify the code, don't link yet
    if (args.action === "verify_only") {
      if (!args.email || !args.code) {
        throw new Error("Email and code are required for verification");
      }

      const isValid = await verifyEmailOTP(
        ctx,
        args.email,
        args.code,
        "account_claim"
      );

      if (!isValid) {
        throw new Error("Invalid or expired verification code");
      }

      return { verified: true };
    }

    // ACTION: VERIFY_AND_LINK - Verify code and link phone to account
    if (args.action === "verify_and_link") {
      if (!args.email || !args.code) {
        throw new Error("Email and code are required for verification");
      }

      const isValid = await verifyEmailOTP(
        ctx,
        args.email,
        args.code,
        "account_claim"
      );

      if (!isValid) {
        throw new Error("Invalid verification code");
      }

      // Get user by email
      const user = await ctx.runQuery(
        internal.functions.authInternal.getUserByEmailInternal,
        { email: args.email }
      );

      if (!user) {
        throw new Error("User not found");
      }

      // Link phone to account
      await ctx.runMutation(internal.functions.authInternal.linkPhoneInternal, {
        userId: user._id,
        phone: normalizedPhone,
      });

      // Get communities
      const result = await ctx.runQuery(
        internal.functions.authInternal.getUserWithCommunitiesInternal,
        { phone: normalizedPhone }
      );

      const communities = result?.communities || [];

      // Generate JWT tokens (select first community if only one)
      const communityId =
        communities.length === 1 ? communities[0]?.id : undefined;
      const tokens = await generateTokens(user._id, communityId);

      return {
        verified: true,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
        communities,
        user: {
          id: user._id,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          email: user.email || "",
          phone: normalizedPhone,
          phoneVerified: true,
        },
      };
    }

    throw new Error("Invalid action");
  },
});

/**
 * Submit account claim request for manual review
 * tRPC equivalent: submitAccountClaimRequest
 */
export const submitAccountClaimRequest = action({
  args: {
    name: v.string(),
    communityName: v.string(),
    phone: v.string(),
    countryCode: v.optional(v.string()),
    possibleEmails: v.array(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    request_id: string;
    message: string;
  }> => {
    const normalizedPhone = normalizePhone(args.phone);

    // Create account claim request
    const claimId = await ctx.runMutation(
      internal.functions.authInternal.createAccountClaimRequestInternal,
      {
        name: args.name,
        communityName: args.communityName,
        phone: normalizedPhone,
        possibleEmails: args.possibleEmails,
      }
    );

    return {
      success: true,
      request_id: claimId,
      message: "Your request has been submitted for review",
    };
  },
});
