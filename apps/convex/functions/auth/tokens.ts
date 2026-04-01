"use node";
/**
 * Token Management
 *
 * Handles JWT token operations:
 * - refreshToken: Generate new access token from refresh token
 * - updateLastActivity: Update user activity timestamp
 */

import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { generateTokens, verifyRefreshToken, requireAuthFromTokenAction, getCommunityFromToken } from "../../lib/auth";

/**
 * Refresh access token using a refresh token
 * tRPC equivalent: refreshToken
 *
 * Takes a valid refresh token and returns a new access token.
 * Optionally allows specifying a different community for the new token.
 */
export const refreshToken = action({
  args: {
    refreshToken: v.string(),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }> => {
    // Verify the refresh token
    const payload = await verifyRefreshToken(args.refreshToken);

    if (!payload) {
      throw new Error("Invalid refresh token");
    }

    const revoked = await ctx.runQuery(
      internal.functions.authInternal.isJwtSubjectRevokedInternal,
      { jwtUserId: payload.userId, issuedAt: payload.issuedAt }
    );
    if (revoked) {
      throw new Error("Session revoked");
    }

    // Verify user still exists
    // Try to get user by Convex ID first
    let user = null;
    try {
      user = await ctx.runQuery(internal.functions.users.getByIdInternal, {
        userId: payload.userId as any,
      });
    } catch {
      // Invalid ID format — user stays null and we throw "User not found" below
    }

    if (!user) {
      throw new Error("User not found");
    }

    // If communityId provided, verify it exists and user has access
    if (args.communityId) {
      const community = await ctx.runQuery(
        internal.functions.communities.getByIdInternal,
        { communityId: args.communityId }
      );

      if (!community) {
        throw new Error("Community not found");
      }

      // Verify user is a member of this community
      const userCommunities = await ctx.runQuery(
        internal.functions.authInternal.getUserWithCommunitiesInternal,
        { phone: user.phone || "" }
      );

      const isMember = userCommunities?.communities.some(
        (c: { id: string } | null) => c?.id === args.communityId
      );

      if (!isMember) {
        throw new Error("User is not a member of this community");
      }
    }

    // Generate new tokens
    const tokens = await generateTokens(payload.userId, args.communityId);

    return {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_in: tokens.expiresIn,
    };
  },
});

/**
 * Update last activity timestamp for the user in their current community.
 * Called when app comes to foreground to track active users.
 */
export const updateLastActivity = action({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    // Verify the access token (with revocation check)
    const userId = await requireAuthFromTokenAction(ctx, args.token);

    // Get community from token payload
    const communityId = await getCommunityFromToken(args.token);

    // Must have a community selected to update last activity
    if (!communityId) {
      throw new Error("No community selected");
    }

    // Update lastLogin timestamp using the existing internal mutation
    await ctx.runMutation(
      internal.functions.authInternal.ensureUserCommunityInternal,
      {
        userId: userId as Id<"users">,
        communityId: communityId as Id<"communities">,
        updateLastLogin: true,
      }
    );

    return { success: true };
  },
});
