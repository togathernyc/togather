"use node";
/**
 * Phone OTP Authentication
 *
 * Handles phone-based OTP verification for authentication.
 * - sendPhoneOTP: Send verification code to phone
 * - verifyPhoneOTP: Verify code and generate JWT tokens
 * - registerPhone: Register/verify phone for existing user
 */

import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { normalizePhone } from "../../lib/utils";
import { generateTokens, requireAuthFromToken } from "../../lib/auth";
import {
  MAGIC_CODE,
  isTestPhone,
  isMagicCodeAllowed,
  getTwilioAuthCredentials,
  mapTwilioError,
} from "./helpers";

/**
 * Send OTP to a phone number
 * tRPC equivalent: sendPhoneOTP
 */
export const sendPhoneOTP = action({
  args: {
    phone: v.string(),
    countryCode: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean; expiresIn: number }> => {
    const normalizedPhone = normalizePhone(args.phone);

    // Skip for test phones (no rate limiting, no Twilio)
    if (isTestPhone(normalizedPhone)) {
      console.log(`[TEST] Would send OTP to ${normalizedPhone}`);
      return { success: true, expiresIn: 300 };
    }

    // Rate limit: max 5 OTP sends per phone per hour
    await ctx.runMutation(
      internal.functions.authInternal.checkRateLimitInternal,
      {
        key: `otp:${normalizedPhone}`,
        maxAttempts: 5,
        windowMs: 60 * 60 * 1000, // 1 hour
      }
    );

    // Get Twilio credentials
    const twilioAuth = getTwilioAuthCredentials();
    const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!twilioAuth || !verifyServiceSid) {
      console.error(
        "Twilio not configured - missing required environment variables:",
        {
          hasTwilioAuth: !!twilioAuth,
          hasVerifyServiceSid: !!verifyServiceSid,
        }
      );
      throw new Error(
        "SMS service is not available. Please email togather@supa.media with your phone number and we'll help you."
      );
    }

    // Send OTP via Twilio Verify
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${twilioAuth.username}:${twilioAuth.password}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: normalizedPhone,
          Channel: "sms",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }

      console.error("Twilio Verify send error:", {
        status: response.status,
        statusText: response.statusText,
        errorCode: errorData?.code,
        errorMessage: errorData?.message,
        phone: normalizedPhone,
        fullError: errorData,
      });

      // Map Twilio errors to user-friendly messages
      const twilioErrorCode = errorData?.code;
      const twilioMessage = errorData?.message || "";
      const userMessage = mapTwilioError(
        response.status,
        twilioErrorCode,
        twilioMessage
      );

      throw new Error(userMessage);
    }

    return { success: true, expiresIn: 300 };
  },
});

/**
 * Verify phone OTP and return JWT tokens
 * tRPC equivalent: verifyPhoneOTP
 *
 * Returns { access_token, refresh_token, user } on successful verification.
 * Supports magic code "000000" for test phones.
 */
export const verifyPhoneOTP = action({
  args: {
    phone: v.string(),
    code: v.string(),
    countryCode: v.optional(v.string()),
    confirmIdentity: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    verified: boolean;
    requiresIdentityFlow?: boolean;
    requiresCommunitySelection?: boolean;
    phoneVerificationToken?: string; // Token to prove phone was verified (for new users)
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    communities: Array<{
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
      legacyId: string | undefined;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      phoneVerified: boolean;
      activeCommunityId?: string;
      activeCommunityName?: string;
    };
  }> => {
    const normalizedPhone = normalizePhone(args.phone);
    const confirmIdentity = args.confirmIdentity ?? true;

    // Check magic code bypass
    const isMagicCode =
      isMagicCodeAllowed(normalizedPhone) && args.code === MAGIC_CODE;

    // Rate limit verification attempts (skip for test phones using magic code)
    const skipRateLimit = isMagicCode && isTestPhone(normalizedPhone);
    if (!skipRateLimit) {
      await ctx.runMutation(
        internal.functions.authInternal.checkRateLimitInternal,
        {
          key: `verify:${normalizedPhone}`,
          maxAttempts: 10,
          windowMs: 15 * 60 * 1000, // 15 minutes
        }
      );
    }

    let isValid = isMagicCode;

    // Verify with Twilio if not magic code
    if (!isValid) {
      const twilioAuth = getTwilioAuthCredentials();
      const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

      if (twilioAuth && verifyServiceSid) {
        const response = await fetch(
          `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${twilioAuth.username}:${twilioAuth.password}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: normalizedPhone,
              Code: args.code,
            }),
          }
        );

        if (response.ok) {
          const result = await response.json();
          isValid = result.status === "approved";

          // Log non-approved statuses for debugging
          if (!isValid && result.status) {
            console.log("Twilio verification check result:", {
              status: result.status,
              phone: normalizedPhone,
            });
          }
        } else {
          // Handle Twilio API errors during verification check
          const errorText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { message: errorText };
          }

          console.error("Twilio Verify check error:", {
            status: response.status,
            statusText: response.statusText,
            errorCode: errorData?.code,
            errorMessage: errorData?.message,
            phone: normalizedPhone,
            fullError: errorData,
          });

          // Map Twilio errors to user-friendly messages
          const twilioErrorCode = errorData?.code;
          const twilioMessage = errorData?.message || "";

          // Special handling for expired verifications (404)
          if (response.status === 404 || twilioErrorCode === 20404) {
            throw new Error(
              "Verification code expired. Please request a new code."
            );
          }

          // Map other errors
          const userMessage = mapTwilioError(
            response.status,
            twilioErrorCode,
            twilioMessage
          );
          throw new Error(userMessage);
        }
      }
    }

    if (!isValid) {
      throw new Error("Invalid verification code");
    }

    // Look up user
    const result = await ctx.runQuery(
      internal.functions.authInternal.getUserWithCommunitiesInternal,
      { phone: normalizedPhone }
    );

    // If confirmIdentity is false, unlink phone and generate token for new registration
    if (!confirmIdentity && result?.user) {
      await ctx.runMutation(
        internal.functions.authInternal.unlinkPhoneInternal,
        {
          userId: result.user._id,
        }
      );

      // Generate token so user can register as new user after unlinking
      const phoneVerificationToken = crypto.randomUUID();
      await ctx.runMutation(
        internal.functions.authInternal.storePhoneVerificationToken,
        {
          phone: normalizedPhone,
          token: phoneVerificationToken,
        }
      );

      return {
        verified: true,
        requiresIdentityFlow: true,
        phoneVerificationToken,
        communities: [],
      };
    }

    if (!result) {
      // New user - needs registration
      // Generate a verification token to prove the phone was verified
      // crypto.randomUUID() is available in both Node.js and Web Crypto API
      const phoneVerificationToken = crypto.randomUUID();

      // Store the token
      await ctx.runMutation(
        internal.functions.authInternal.storePhoneVerificationToken,
        {
          phone: normalizedPhone,
          token: phoneVerificationToken,
        }
      );

      return {
        verified: true,
        requiresCommunitySelection: false,
        phoneVerificationToken,
        communities: [],
      };
    }

    const { user, communities } = result;

    // Mark phone as verified if not already
    if (!user.phoneVerified) {
      await ctx.runMutation(
        internal.functions.authInternal.markPhoneVerifiedInternal,
        {
          userId: user._id,
        }
      );
    }

    // Get active community details if set
    let activeCommunityName: string | undefined;
    if (user.activeCommunityId) {
      const activeCommunity = await ctx.runQuery(
        internal.functions.authInternal.getCommunityByIdInternal,
        { communityId: user.activeCommunityId }
      );
      activeCommunityName = activeCommunity?.name;
    }

    // If user has no communities or multiple communities, they need to select
    // UNLESS they already have an active community set
    if (
      (communities.length === 0 || communities.length > 1) &&
      !user.activeCommunityId
    ) {
      // Generate tokens without community (user will select one later)
      const tokens = await generateTokens(user._id, undefined);

      return {
        verified: true,
        requiresCommunitySelection: true,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_in: tokens.expiresIn,
        communities,
        user: {
          id: user._id,
          legacyId: user.legacyId,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          email: user.email || "",
          phone: user.phone || "",
          phoneVerified: true,
          activeCommunityId: user.activeCommunityId,
          activeCommunityName,
        },
      };
    }

    // User has active community OR single community - direct login
    // Use activeCommunityId if set, otherwise use the single community
    const targetCommunityId = user.activeCommunityId || communities[0]?.id;
    const targetCommunityName = activeCommunityName || communities[0]?.name;

    // Update lastLogin on the community membership for active member tracking
    if (targetCommunityId) {
      await ctx.runMutation(
        internal.functions.authInternal.ensureUserCommunityInternal,
        {
          userId: user._id,
          communityId: targetCommunityId,
          updateLastLogin: true,
        }
      );
    }

    // Generate tokens with community
    const tokens = await generateTokens(user._id, targetCommunityId);

    return {
      verified: true,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      user: {
        id: user._id,
        legacyId: user.legacyId,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phone: user.phone || "",
        phoneVerified: true,
        activeCommunityId: targetCommunityId,
        activeCommunityName: targetCommunityName,
      },
      communities,
    };
  },
});

/**
 * Register/verify phone for existing user
 * tRPC equivalent: registerPhone
 */
export const registerPhone = action({
  args: {
    token: v.string(),
    phone: v.string(),
    code: v.string(),
    countryCode: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    success: boolean;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      phoneVerified: boolean;
    } | null;
  }> => {
    // Derive userId from auth token instead of accepting from client
    const tokenUserId = await requireAuthFromToken(args.token);
    const resolved = await ctx.runQuery(internal.functions.users.resolveUserIdInternal, {
      tokenUserId,
    });
    if (!resolved) {
      throw new Error("Not authenticated");
    }
    const userId = resolved.userId;

    const normalizedPhone = normalizePhone(args.phone);

    // Verify OTP
    const isMagicCode =
      isMagicCodeAllowed(normalizedPhone) && args.code === MAGIC_CODE;

    // Rate limit verification attempts (skip for test phones using magic code)
    const skipRateLimit = isMagicCode && isTestPhone(normalizedPhone);
    if (!skipRateLimit) {
      await ctx.runMutation(
        internal.functions.authInternal.checkRateLimitInternal,
        {
          key: `register:${normalizedPhone}`,
          maxAttempts: 10,
          windowMs: 15 * 60 * 1000, // 15 minutes
        }
      );
    }

    let isValid = isMagicCode;

    if (!isValid) {
      const twilioAuth = getTwilioAuthCredentials();
      const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

      if (twilioAuth && verifyServiceSid) {
        const response = await fetch(
          `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${twilioAuth.username}:${twilioAuth.password}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: normalizedPhone,
              Code: args.code,
            }),
          }
        );

        if (response.ok) {
          const result = await response.json();
          isValid = result.status === "approved";

          // Log non-approved statuses for debugging
          if (!isValid && result.status) {
            console.log("Twilio verification check result:", {
              status: result.status,
              phone: normalizedPhone,
            });
          }
        } else {
          // Handle Twilio API errors during verification check
          const errorText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { message: errorText };
          }

          console.error("Twilio Verify check error:", {
            status: response.status,
            statusText: response.statusText,
            errorCode: errorData?.code,
            errorMessage: errorData?.message,
            phone: normalizedPhone,
            fullError: errorData,
          });

          // Special handling for expired verifications (404)
          if (response.status === 404 || errorData?.code === 20404) {
            throw new Error(
              "Verification code expired. Please request a new code."
            );
          }

          // Map other errors
          const twilioErrorCode = errorData?.code;
          const twilioMessage = errorData?.message || "";
          const userMessage = mapTwilioError(
            response.status,
            twilioErrorCode,
            twilioMessage
          );
          throw new Error(userMessage);
        }
      }
    }

    if (!isValid) {
      throw new Error("Invalid verification code");
    }

    // Link phone to user
    await ctx.runMutation(internal.functions.authInternal.linkPhoneInternal, {
      userId,
      phone: normalizedPhone,
    });

    // Get updated user
    const user = await ctx.runQuery(internal.functions.users.getByIdInternal, {
      userId,
    });

    return {
      success: true,
      user: user
        ? {
            id: user._id,
            firstName: user.firstName || "",
            lastName: user.lastName || "",
            email: user.email || "",
            phone: normalizedPhone,
            phoneVerified: true,
          }
        : null,
    };
  },
});

/**
 * Send SMS notification (helper for sending custom messages)
 */
export const sendSMS = internalAction({
  args: {
    phone: v.string(),
    message: v.string(),
  },
  handler: async (_ctx, args): Promise<{ success: boolean }> => {
    const normalizedPhone = normalizePhone(args.phone);

    // Skip for test phones
    if (isTestPhone(normalizedPhone)) {
      console.log(
        `[TEST] Would send SMS to ${normalizedPhone}: ${args.message}`
      );
      return { success: true };
    }

    const twilioAuth = getTwilioAuthCredentials();
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!twilioAuth || !accountSid || !fromNumber) {
      console.warn("Twilio not configured for SMS");
      return { success: false };
    }

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${twilioAuth.username}:${twilioAuth.password}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: normalizedPhone,
          From: fromNumber,
          Body: args.message,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Twilio SMS error:", error);
      throw new Error(
        `SMS delivery failed (HTTP ${response.status}): ${error}. Please try again.`
      );
    }

    return { success: true };
  },
});

/**
 * Delete user account after OTP verification.
 *
 * Flow:
 * 1. Client calls sendPhoneOTP to send a code to the user's phone
 * 2. Client calls this action with the token + OTP code
 * 3. This action verifies the OTP, then runs the internal deletion mutation
 */
export const deleteAccount = action({
  args: {
    token: v.string(),
    phone: v.string(),
    code: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean }> => {
    // 1. Verify the user is authenticated
    const tokenUserId = await requireAuthFromToken(args.token);

    // Resolve to Convex user ID
    const resolved = await ctx.runQuery(
      internal.functions.users.resolveUserIdInternal,
      { tokenUserId }
    );
    if (!resolved) {
      throw new Error("User not found");
    }
    const userId = resolved.userId;

    // 2. Verify OTP code
    const normalizedPhone = normalizePhone(args.phone);
    const isMagicCode =
      isMagicCodeAllowed(normalizedPhone) && args.code === MAGIC_CODE;

    let isValid = isMagicCode;

    if (!isValid) {
      const twilioAuth = getTwilioAuthCredentials();
      const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

      if (twilioAuth && verifyServiceSid) {
        const response = await fetch(
          `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationCheck`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${twilioAuth.username}:${twilioAuth.password}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: normalizedPhone,
              Code: args.code,
            }),
          }
        );

        if (response.ok) {
          const result = await response.json();
          isValid = result.status === "approved";
        } else {
          const errorText = await response.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { message: errorText };
          }

          if (response.status === 404 || errorData?.code === 20404) {
            throw new Error(
              "Verification code expired. Please request a new code."
            );
          }

          const userMessage = mapTwilioError(
            response.status,
            errorData?.code,
            errorData?.message || ""
          );
          throw new Error(userMessage);
        }
      }
    }

    if (!isValid) {
      throw new Error("Invalid verification code");
    }

    // 3. Delete the account
    await ctx.runMutation(
      internal.functions.users.deleteAccountInternal,
      { userId }
    );

    return { success: true };
  },
});
