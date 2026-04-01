"use node";
/**
 * Login Functions
 *
 * Handles authentication login flows:
 * - phoneLookup: Check if user exists by phone number
 * - legacyLogin: Email/password authentication
 * - selectCommunity: Community selection for multi-community users
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { normalizePhone, isValidPhone } from "../../lib/utils";
import { generateTokens, requireAuthFromTokenAction } from "../../lib/auth";

/**
 * Look up a phone number to check if user exists
 * tRPC equivalent: phoneLookup
 */
export const phoneLookup = action({
  args: {
    phone: v.string(),
    countryCode: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    exists: boolean;
    hasVerifiedPhone: boolean;
    userName: string | null;
    communities: Array<{
      id: string;
      legacyId: string | undefined;
      name: string;
      logo: string | null;
      role: number;
      isAdmin: boolean;
      isPrimaryAdmin: boolean;
    } | null>;
    activeCommunity: {
      id: string;
      legacyId: string | undefined;
      name: string;
      logo: string | null;
    } | null;
  }> => {
    // Validate and normalize phone
    if (!isValidPhone(args.phone)) {
      throw new Error("Invalid phone number");
    }
    const normalizedPhone = normalizePhone(args.phone);

    // Look up user
    const result = await ctx.runQuery(
      internal.functions.authInternal.getUserWithCommunitiesInternal,
      { phone: normalizedPhone },
    );

    if (!result) {
      return {
        exists: false,
        hasVerifiedPhone: false,
        userName: null,
        communities: [],
        activeCommunity: null,
      };
    }

    const { user, communities, activeCommunity } = result;

    return {
      exists: true,
      hasVerifiedPhone: user.phoneVerified ?? false,
      userName: user.firstName
        ? `${user.firstName} ${user.lastName || ""}`.trim()
        : null,
      communities,
      activeCommunity,
    };
  },
});

/**
 * Legacy email/password login with JWT tokens
 * tRPC equivalent: legacyLogin
 */
export const legacyLogin = action({
  args: {
    email: v.string(),
    password: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: {
      id: string;
      legacyId: string | undefined;
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      phoneVerified: boolean;
      communityId: string | undefined;
    };
    requiresPhoneVerification: boolean;
  }> => {
    // Get user by email
    const user = await ctx.runQuery(
      internal.functions.authInternal.getUserByEmailInternal,
      { email: args.email },
    );

    if (!user || !user.password) {
      throw new Error("Invalid email or password");
    }

    // Verify password using bcrypt
    const bcrypt = await import("bcryptjs");
    const isValidPassword = await bcrypt.compare(args.password, user.password);

    if (!isValidPassword) {
      throw new Error("Invalid email or password");
    }

    // Get communities
    const result = await ctx.runQuery(
      internal.functions.authInternal.getUserWithCommunitiesInternal,
      { phone: user.phone || "" },
    );

    const communities = result?.communities || [];
    const communityId =
      communities.length === 1 ? communities[0]?.id : undefined;

    // Generate JWT tokens
    const tokens = await generateTokens(user._id, communityId);

    return {
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
        phoneVerified: user.phoneVerified || false,
        communityId,
      },
      requiresPhoneVerification: !user.phoneVerified,
    };
  },
});

/**
 * Select a community (for users with multiple communities) and return new JWT tokens
 * tRPC equivalent: selectCommunity
 *
 * Requires a valid access token to prevent IDOR attacks.
 * The userId is derived from the token, not from client-supplied args.
 */
export const selectCommunity = action({
  args: {
    communityId: v.id("communities"),
    token: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    communityId: string;
    communityName: string;
  }> => {
    // Verify the caller's identity via token (including revocation) to prevent IDOR
    const userIdRaw = await requireAuthFromTokenAction(ctx, args.token);
    const userId = userIdRaw as Id<"users">;

    // Verify community exists
    const community = await ctx.runQuery(
      internal.functions.communities.getByIdInternal,
      { communityId: args.communityId },
    );

    if (!community) {
      throw new Error("Community not found");
    }

    // Ensure user has membership AND update active community atomically
    // This prevents inconsistent state where user has membership but wrong activeCommunityId
    await ctx.runMutation(
      internal.functions.authInternal.ensureAndActivateCommunityInternal,
      {
        userId,
        communityId: args.communityId,
        updateLastLogin: true,
      },
    );

    // Generate new JWT tokens with community
    const tokens = await generateTokens(userId, args.communityId);

    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
      communityId: args.communityId,
      communityName: community.name || "",
    };
  },
});
