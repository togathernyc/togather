/**
 * Authentication Internal Functions
 *
 * Internal queries and mutations for auth operations.
 * These are called by the auth actions in auth.ts.
 *
 * This file does NOT use "use node" so it can have queries and mutations.
 */

import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { api, internal } from "../_generated/api";
import { now, normalizePhone, getMediaUrl, buildSearchText } from "../lib/utils";
import { requireAuth, requireAuthIgnoringRevocation } from "../auth";
import {
  isRevokedForJwtSubject,
  REFRESH_TOKEN_MAX_AGE_MS,
} from "../lib/auth";
import { COMMUNITY_ROLES, COMMUNITY_ADMIN_THRESHOLD } from "../lib/permissions";
import { checkRateLimit } from "../lib/rateLimit";

// ============================================================================
// Internal Queries (for use by actions)
// ============================================================================

/**
 * Internal: Look up user by phone
 */
export const getUserByPhoneInternal = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizePhone(args.phone);
    return await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", normalized))
      .first();
  },
});

/**
 * Internal: Look up user by email
 */
export const getUserByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();
  },
});

/**
 * Internal: Get community by ID
 */
export const getCommunityByIdInternal = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.communityId);
  },
});

/**
 * Internal: Get user with community memberships
 */
export const getUserWithCommunitiesInternal = internalQuery({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const normalized = normalizePhone(args.phone);
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", normalized))
      .first();

    if (!user) return null;

    // Get user's active community memberships only (status=1)
    // Status values: 1=Active, 2=Inactive (left), 3=Blocked
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("status"), 1)) // Active only
      .collect();

    // Fetch community details
    const communities = await Promise.all(
      memberships.map(async (membership) => {
        const community = await ctx.db.get(membership.communityId);
        if (!community) return null;
        const logoUrl = getMediaUrl(community.logo);
        console.log('[getUserWithCommunitiesInternal] Community logo resolution:', {
          communityName: community.name,
          rawLogoPath: community.logo,
          processedLogoUrl: logoUrl,
        });
        return {
          id: community._id,
          legacyId: community.legacyId,
          name: community.name || "",
          logo: logoUrl ?? null,
          role: membership.roles ?? COMMUNITY_ROLES.MEMBER,
          isAdmin: (membership.roles ?? 0) >= COMMUNITY_ADMIN_THRESHOLD,
          isPrimaryAdmin: membership.roles === COMMUNITY_ROLES.PRIMARY_ADMIN,
        };
      })
    );

    // Get active community
    let activeCommunity = null;
    if (user.activeCommunityId) {
      const active = await ctx.db.get(user.activeCommunityId);
      if (active) {
        const logoUrl = getMediaUrl(active.logo);
        console.log('[getUserWithCommunitiesInternal] Active community logo resolution:', {
          communityName: active.name,
          rawLogoPath: active.logo,
          processedLogoUrl: logoUrl,
        });
        activeCommunity = {
          id: active._id,
          legacyId: active.legacyId,
          name: active.name || "",
          logo: logoUrl ?? null,
        };
      }
    }

    return {
      user,
      communities: communities.filter(Boolean),
      activeCommunity,
    };
  },
});

// ============================================================================
// Internal Mutations (for use by actions)
// ============================================================================

/**
 * Internal: Mark user's phone as verified
 */
export const markPhoneVerifiedInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      phoneVerified: true,
      updatedAt: now(),
    });
  },
});

/**
 * Internal: Unlink phone from user
 */
export const unlinkPhoneInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      phone: undefined,
      phoneVerified: false,
      updatedAt: now(),
    });
  },
});

/**
 * Internal: Create new user
 */
export const createUserInternal = internalMutation({
  args: {
    phone: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    dateOfBirth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Check if user with this phone already exists
    const existingByPhone = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .first();

    if (existingByPhone) {
      throw new Error("User with this phone already exists");
    }

    // Check if email is already used
    if (args.email) {
      const existingByEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", args.email!.toLowerCase()))
        .first();

      if (existingByEmail) {
        throw new Error("User with this email already exists");
      }
    }

    const normalizedEmail = args.email?.toLowerCase();

    const userId = await ctx.db.insert("users", {
      phone: args.phone,
      phoneVerified: true,
      firstName: args.firstName,
      lastName: args.lastName,
      email: normalizedEmail,
      dateOfBirth: args.dateOfBirth,
      searchText: buildSearchText({
        firstName: args.firstName,
        lastName: args.lastName,
        email: normalizedEmail,
        phone: args.phone,
      }),
      isActive: true,
      isStaff: false,
      isSuperuser: false,
      dateJoined: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Link any placeholder workflow tasks that were addressed to this phone
    // before the user signed up. Runs after commit; failures do not block signup.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.tasks.index.linkPlaceholderTasksForUser,
      { userId },
    );

    return userId;
  },
});

/**
 * Internal: Create user with password (legacy signup)
 */
export const createUserWithPasswordInternal = internalMutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    passwordHash: v.string(),
    dateOfBirth: v.number(),
    phone: v.optional(v.string()),
    phoneVerified: v.boolean(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Check if email already exists
    const existingByEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();

    if (existingByEmail) {
      throw new Error("Email already registered");
    }

    // Check if phone already exists
    if (args.phone) {
      const existingByPhone = await ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", args.phone!))
        .first();

      if (existingByPhone) {
        throw new Error("Phone number already registered");
      }
    }

    // Create user
    const normalizedEmail = args.email.toLowerCase();

    const userId = await ctx.db.insert("users", {
      firstName: args.firstName,
      lastName: args.lastName,
      email: normalizedEmail,
      password: args.passwordHash,
      dateOfBirth: args.dateOfBirth,
      phone: args.phone,
      phoneVerified: args.phoneVerified,
      searchText: buildSearchText({
        firstName: args.firstName,
        lastName: args.lastName,
        email: normalizedEmail,
        phone: args.phone,
      }),
      isActive: true,
      isStaff: false,
      isSuperuser: false,
      dateJoined: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      activeCommunityId: args.communityId,
    });

    // Create user_community relationship
    await ctx.db.insert("userCommunities", {
      userId,
      communityId: args.communityId,
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Link any placeholder workflow tasks addressed to this phone.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.tasks.index.linkPlaceholderTasksForUser,
      { userId },
    );

    return userId;
  },
});

/**
 * Internal: Update user's active community
 */
export const updateActiveCommunityInternal = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      activeCommunityId: args.communityId,
      updatedAt: now(),
    });
  },
});

/**
 * Internal: Ensure user community membership AND update active community atomically
 *
 * This combines ensureUserCommunityInternal + updateActiveCommunityInternal
 * into a single transaction to prevent inconsistent state where a user has
 * membership but the wrong activeCommunityId.
 */
export const ensureAndActivateCommunityInternal = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    updateLastLogin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Check if membership already exists
    const existing = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId)
      )
      .first();

    let membershipId;

    if (existing) {
      // Check if blocked
      if (existing.status === 3) {
        throw new Error("You are blocked from this community");
      }
      // Update lastLogin if requested (for tracking active members)
      if (args.updateLastLogin) {
        await ctx.db.patch(existing._id, {
          lastLogin: timestamp,
          updatedAt: timestamp,
        });
      }
      membershipId = existing._id;
    } else {
      // Create new membership with lastLogin
      membershipId = await ctx.db.insert("userCommunities", {
        userId: args.userId,
        communityId: args.communityId,
        status: 1, // Active
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLogin: timestamp,
      });
    }

    // Update active community in the same transaction
    await ctx.db.patch(args.userId, {
      activeCommunityId: args.communityId,
      updatedAt: timestamp,
    });

    return membershipId;
  },
});

/**
 * Internal: Create or activate user community membership
 */
export const ensureUserCommunityInternal = internalMutation({
  args: {
    userId: v.id("users"),
    communityId: v.id("communities"),
    updateLastLogin: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Check if membership already exists
    const existing = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId)
      )
      .first();

    if (existing) {
      // Check if blocked
      if (existing.status === 3) {
        throw new Error("You are blocked from this community");
      }
      // Update lastLogin if requested (for tracking active members)
      if (args.updateLastLogin) {
        await ctx.db.patch(existing._id, {
          lastLogin: timestamp,
          updatedAt: timestamp,
        });
      }
      return existing._id;
    }

    // Create new membership with lastLogin
    return await ctx.db.insert("userCommunities", {
      userId: args.userId,
      communityId: args.communityId,
      status: 1, // Active
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLogin: timestamp,
    });
  },
});

/**
 * Internal: Update user's password
 */
export const updatePasswordInternal = internalMutation({
  args: {
    userId: v.id("users"),
    passwordHash: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      password: args.passwordHash,
      updatedAt: now(),
    });
  },
});

/**
 * Internal: Link phone to user
 */
export const linkPhoneInternal = internalMutation({
  args: {
    userId: v.id("users"),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if phone is already used by another user
    const existing = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .filter((q) => q.neq(q.field("_id"), args.userId))
      .first();

    if (existing) {
      throw new Error("Phone number already linked to another account");
    }

    // Get existing user to rebuild searchText
    const user = await ctx.db.get(args.userId);

    await ctx.db.patch(args.userId, {
      phone: args.phone,
      phoneVerified: true,
      searchText: buildSearchText({
        firstName: user?.firstName,
        lastName: user?.lastName,
        email: user?.email,
        phone: args.phone,
      }),
      updatedAt: now(),
    });
  },
});

/**
 * Internal: Create legacy account claim request
 */
export const createAccountClaimRequestInternal = internalMutation({
  args: {
    name: v.string(),
    communityName: v.string(),
    phone: v.string(),
    possibleEmails: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    const claimId = await ctx.db.insert("legacyAccountClaims", {
      name: args.name,
      communityName: args.communityName,
      phone: args.phone,
      possibleEmails: args.possibleEmails,
      status: "pending",
      notes: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return claimId;
  },
});

/**
 * Internal: Check if a recent email verification code exists
 *
 * Returns true if a code was created within the rate limit window (30 seconds).
 * Used to prevent race conditions when users click "Resend" rapidly.
 */
export const hasRecentEmailCode = internalQuery({
  args: {
    email: v.string(),
    purpose: v.union(v.literal("account_claim"), v.literal("password_reset")),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const normalizedEmail = args.email.toLowerCase();
    const rateLimitWindow = 30 * 1000; // 30 seconds
    const cutoffTime = Date.now() - rateLimitWindow;

    const recentCode = await ctx.db
      .query("emailVerificationCodes")
      .withIndex("by_email_purpose", (q) =>
        q.eq("email", normalizedEmail).eq("purpose", args.purpose)
      )
      .filter((q) =>
        q.and(
          q.gt(q.field("createdAt"), cutoffTime),
          q.eq(q.field("usedAt"), undefined)
        )
      )
      .first();

    return recentCode !== null;
  },
});

/**
 * Internal: Store email verification code
 *
 * Stores a verification code for email-based authentication.
 * Cleans up any existing codes for the same email and purpose before inserting.
 */
export const storeEmailVerificationCode = internalMutation({
  args: {
    email: v.string(),
    purpose: v.union(v.literal("account_claim"), v.literal("password_reset")),
    code: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase();

    // Delete any existing codes for this email and flow only (other flows keep their OTP)
    const existingCodes = await ctx.db
      .query("emailVerificationCodes")
      .withIndex("by_email_purpose", (q) =>
        q.eq("email", normalizedEmail).eq("purpose", args.purpose)
      )
      .collect();

    for (const code of existingCodes) {
      await ctx.db.delete(code._id);
    }

    // Insert new verification code
    const codeId = await ctx.db.insert("emailVerificationCodes", {
      email: normalizedEmail,
      purpose: args.purpose,
      code: args.code,
      expiresAt: args.expiresAt,
      createdAt: now(),
    });

    return codeId;
  },
});

/**
 * Internal: Verify email code
 *
 * Checks if the provided code is valid for the email address.
 * A valid code must: exist, not be expired, and not be used.
 * If valid, marks the code as used.
 */
export const verifyEmailCode = internalMutation({
  args: {
    email: v.string(),
    purpose: v.union(v.literal("account_claim"), v.literal("password_reset")),
    code: v.string(),
  },
  handler: async (ctx, args): Promise<{ valid: boolean }> => {
    const normalizedEmail = args.email.toLowerCase();
    const currentTime = Date.now();

    // Query for matching email + code + purpose that hasn't expired and hasn't been used
    const verificationCode = await ctx.db
      .query("emailVerificationCodes")
      .withIndex("by_email_code_purpose", (q) =>
        q
          .eq("email", normalizedEmail)
          .eq("code", args.code)
          .eq("purpose", args.purpose)
      )
      .first();

    // Check if code exists, is not expired, and hasn't been used
    if (
      !verificationCode ||
      verificationCode.expiresAt < currentTime ||
      verificationCode.usedAt !== undefined
    ) {
      return { valid: false };
    }

    // Mark code as used
    await ctx.db.patch(verificationCode._id, {
      usedAt: currentTime,
    });

    return { valid: true };
  },
});

/**
 * Internal: Cleanup expired email codes
 *
 * Deletes all verification codes that have expired.
 * Can be called periodically for cleanup.
 */
export const cleanupExpiredEmailCodes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const currentTime = Date.now();

    // Query for expired codes
    const expiredCodes = await ctx.db
      .query("emailVerificationCodes")
      .withIndex("by_expiresAt")
      .filter((q) => q.lt(q.field("expiresAt"), currentTime))
      .collect();

    // Delete all expired codes
    for (const code of expiredCodes) {
      await ctx.db.delete(code._id);
    }

    return { deletedCount: expiredCodes.length };
  },
});

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Internal: Check and enforce rate limit for auth endpoints.
 *
 * Called from actions (sendPhoneOTP, verifyPhoneOTP) since they
 * cannot write to the database directly. Throws if rate limit exceeded.
 */
export const checkRateLimitInternal = internalMutation({
  args: {
    key: v.string(),
    maxAttempts: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await checkRateLimit(ctx, args.key, args.maxAttempts, args.windowMs);
  },
});

// ============================================================================
// Phone Verification Token Management
// ============================================================================

/**
 * Internal: Store a phone verification token
 *
 * Creates a token proving the phone was verified.
 * Used to secure the registration flow.
 * Token expires in 10 minutes.
 */
export const storePhoneVerificationToken = internalMutation({
  args: {
    phone: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const currentTime = Date.now();
    const expiresAt = currentTime + 10 * 60 * 1000; // 10 minutes

    // Delete any existing tokens for this phone
    const existingTokens = await ctx.db
      .query("phoneVerificationTokens")
      .withIndex("by_phone", (q) => q.eq("phone", args.phone))
      .collect();

    for (const existingToken of existingTokens) {
      await ctx.db.delete(existingToken._id);
    }

    // Create new token
    await ctx.db.insert("phoneVerificationTokens", {
      phone: args.phone,
      token: args.token,
      expiresAt,
      createdAt: currentTime,
    });

    return { success: true };
  },
});

/**
 * Internal: Verify a phone verification token
 *
 * Checks if the token is valid and not expired.
 * Marks the token as used on successful verification.
 */
export const verifyPhoneToken = internalMutation({
  args: {
    phone: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const currentTime = Date.now();

    const verificationToken = await ctx.db
      .query("phoneVerificationTokens")
      .withIndex("by_phone_token", (q) =>
        q.eq("phone", args.phone).eq("token", args.token)
      )
      .first();

    if (!verificationToken) {
      return { valid: false, reason: "Token not found" };
    }

    if (verificationToken.usedAt) {
      return { valid: false, reason: "Token already used" };
    }

    if (currentTime > verificationToken.expiresAt) {
      return { valid: false, reason: "Token expired" };
    }

    // Mark token as used
    await ctx.db.patch(verificationToken._id, {
      usedAt: currentTime,
    });

    return { valid: true };
  },
});

/**
 * Internal: Cleanup expired phone verification tokens
 *
 * Deletes all tokens that have expired.
 */
export const cleanupExpiredPhoneTokens = internalMutation({
  args: {},
  handler: async (ctx) => {
    const currentTime = Date.now();

    const expiredTokens = await ctx.db
      .query("phoneVerificationTokens")
      .withIndex("by_expiresAt")
      .filter((q) => q.lt(q.field("expiresAt"), currentTime))
      .collect();

    for (const token of expiredTokens) {
      await ctx.db.delete(token._id);
    }

    return { deletedCount: expiredTokens.length };
  },
});

/**
 * Internal: Cleanup stale token revocation records
 *
 * Revocations must cover the longest-lived JWT we validate against them (refresh tokens,
 * ~10 years). Only delete once no refresh token issued before revokedBefore could still be valid.
 */
export const cleanupStaleTokenRevocations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const cutoffRevokedBefore =
      Date.now() - REFRESH_TOKEN_MAX_AGE_MS - oneDayMs;

    const staleRevocations = await ctx.db
      .query("tokenRevocations")
      .filter((q) => q.lt(q.field("revokedBefore"), cutoffRevokedBefore))
      .collect();

    for (const revocation of staleRevocations) {
      await ctx.db.delete(revocation._id);
    }

    return { deletedCount: staleRevocations.length };
  },
});

/**
 * Internal: refresh-token blacklist check (same iat vs revokedBefore as access tokens).
 */
export const isJwtSubjectRevokedInternal = internalQuery({
  args: {
    jwtUserId: v.string(),
    issuedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await isRevokedForJwtSubject(ctx, args.jwtUserId, args.issuedAt);
  },
});

// ============================================================================
// Public Queries
// ============================================================================

/**
 * Get phone verification status for authenticated user
 * tRPC equivalent: phoneStatus
 */
export const phoneStatus = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    return {
      phone: user.phone ?? null,
      phoneVerified: user.phoneVerified ?? false,
    };
  },
});

// ============================================================================
// Public Mutations
// ============================================================================

/**
 * Sign out
 * tRPC equivalent: signout
 */
export const signout = mutation({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.token) {
      // No token provided — client-only logout (clear local storage)
      return { success: true };
    }

    const userId = await requireAuthIgnoringRevocation(ctx, args.token);

    // Record revocation: all tokens issued before now are invalid for this user
    const now = Date.now();

    // Upsert: replace existing revocation record for this user
    const existing = await ctx.db
      .query("tokenRevocations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      // Never move revokedBefore backward (clock skew / NTP) — would shrink the revocation window
      const revokedBefore = Math.max(now, existing.revokedBefore);
      await ctx.db.patch(existing._id, { revokedBefore, createdAt: revokedBefore });
    } else {
      await ctx.db.insert("tokenRevocations", {
        userId,
        revokedBefore: now,
        createdAt: now,
      });
    }

    return { success: true };
  },
});

/**
 * Select/switch to a community for the authenticated user
 *
 * This mutation allows authenticated users to select a community
 * without needing to pass their own userId. The userId is obtained
 * from the auth session.
 *
 * If the user is not already a member of the community, a new
 * membership will be created.
 *
 * @example
 * // From the mobile app:
 * const selectCommunity = useMutation(api.functions.authInternal.selectCommunityForUser);
 * await selectCommunity({ communityId: "..." });
 */
export const selectCommunityForUser = mutation({
  args: {
    communityId: v.id("communities"),
    token: v.string(),
  },
  handler: async (ctx, args): Promise<{
    communityId: string;
    communityName: string;
  }> => {
    const userId = await requireAuth(ctx, args.token);

    // Verify community exists
    const community = await ctx.db.get(args.communityId);
    if (!community) {
      throw new Error("Community not found");
    }

    const timestamp = now();

    // Check if user already has membership
    const existingMembership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", args.communityId)
      )
      .first();

    if (existingMembership) {
      // Check if blocked
      if (existingMembership.status === 3) {
        throw new Error("You are blocked from this community");
      }

      // Check if was inactive (left) - treat as rejoining
      const isRejoining = existingMembership.status === 2;

      // Update lastLogin and reactivate if inactive
      await ctx.db.patch(existingMembership._id, {
        status: 1, // Reactivate if was inactive
        lastLogin: timestamp,
        updatedAt: timestamp,
      });

      // If rejoining, trigger Planning Center sync and announcement group join
      if (isRejoining) {
        console.log("[selectCommunityForUser] User rejoining community, triggering sync", {
          userId,
          communityId: args.communityId,
        });

        // Schedule Planning Center sync
        await ctx.scheduler.runAfter(0, api.functions.integrations.syncUserToPlanningCenter, {
          userId,
          communityId: args.communityId,
        });

        // Add to announcement group
        await ctx.runMutation(internal.functions.sync.memberships.syncMemberships, {
          userId,
          syncAnnouncementGroup: true,
          communityId: args.communityId,
        });
      }
    } else {
      // Create new membership with lastLogin
      await ctx.db.insert("userCommunities", {
        userId,
        communityId: args.communityId,
        status: 1, // Active
        createdAt: timestamp,
        updatedAt: timestamp,
        lastLogin: timestamp,
      });

      console.log("[selectCommunityForUser] New membership created, triggering sync", {
        userId,
        communityId: args.communityId,
      });

      // Schedule Planning Center sync for new members
      await ctx.scheduler.runAfter(0, api.functions.integrations.syncUserToPlanningCenter, {
        userId,
        communityId: args.communityId,
      });

      // Add to announcement group
      await ctx.runMutation(internal.functions.sync.memberships.syncMemberships, {
        userId,
        syncAnnouncementGroup: true,
        communityId: args.communityId,
      });
    }

    // Update active community
    await ctx.db.patch(userId, {
      activeCommunityId: args.communityId,
      updatedAt: timestamp,
    });

    return {
      communityId: args.communityId,
      communityName: community.name || "",
    };
  },
});


