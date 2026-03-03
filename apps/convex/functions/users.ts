/**
 * User functions
 *
 * Functions for managing user profiles and authentication.
 *
 * Authentication Pattern:
 * - Protected functions accept a `token` argument (JWT from tRPC API)
 * - They call `requireAuth(ctx, token)` to verify and get userId
 * - If valid, they proceed with the userId
 * - If invalid, they throw "Not authenticated"
 */

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { now, normalizePhone, getMediaUrl, buildSearchText } from "../lib/utils";
import { requireAuth, getOptionalAuth } from "../lib/auth";
import { parseDate } from "../lib/validation";
import { COMMUNITY_ROLES, COMMUNITY_ADMIN_THRESHOLD } from "../lib/permissions";

/**
 * Get current user profile
 *
 * Returns the user document for the authenticated user.
 * Returns null if not authenticated or token invalid.
 */
export const getCurrentUser = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return null;

    return await ctx.db.get(userId);
  },
});

/**
 * Public user fields that are safe to return without authentication
 */
type PublicUserFields = {
  _id: Id<"users">;
  firstName: string | undefined;
  lastName: string | undefined;
  profilePhoto: string | undefined;
};

/**
 * Extract only public fields from a user document
 */
function extractPublicFields(user: {
  _id: Id<"users">;
  firstName?: string;
  lastName?: string;
  profilePhoto?: string;
}): PublicUserFields {
  return {
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePhoto: user.profilePhoto,
  };
}

/**
 * Get user by ID
 *
 * Security: Returns only public fields (firstName, lastName, profilePhoto)
 * to prevent PII exposure. Filters out deactivated users.
 */
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    // Filter out deactivated users
    if (!user || user.isActive === false) {
      return null;
    }

    // Return only public fields to prevent PII exposure
    return extractPublicFields(user);
  },
});

/**
 * Get user by phone number
 *
 * Security: Requires authentication to prevent phone enumeration attacks.
 * Filters out deactivated users.
 */
export const getByPhone = query({
  args: {
    token: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    // Require authentication to prevent phone enumeration attacks
    await requireAuth(ctx, args.token);

    const normalized = normalizePhone(args.phone);
    const user = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", normalized))
      .first();

    // Filter out deactivated users
    if (!user || user.isActive === false) {
      return null;
    }

    return user;
  },
});

/**
 * Get user by email
 *
 * Security: Requires authentication to prevent email enumeration attacks.
 * Filters out deactivated users.
 */
export const getByEmail = query({
  args: {
    token: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Require authentication to prevent email enumeration attacks
    await requireAuth(ctx, args.token);

    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();

    // Filter out deactivated users
    if (!user || user.isActive === false) {
      return null;
    }

    return user;
  },
});

/**
 * Create a new user profile
 */
export const create = internalMutation({
  args: {
    externalIds: v.optional(v.any()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = now();
    const normalizedPhone = args.phone ? normalizePhone(args.phone) : undefined;
    const normalizedEmail = args.email?.toLowerCase();

    const userId = await ctx.db.insert("users", {
      externalIds: args.externalIds,
      phone: normalizedPhone,
      email: normalizedEmail,
      firstName: args.firstName,
      lastName: args.lastName,
      searchText: buildSearchText({
        firstName: args.firstName,
        lastName: args.lastName,
        email: normalizedEmail,
        phone: normalizedPhone,
      }),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return userId;
  },
});

/**
 * Update user profile
 */
export const update = mutation({
  args: {
    token: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    profilePhoto: v.optional(v.string()),
    timezone: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()), // YYYY-MM-DD format
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Build update object, converting dateOfBirth string to timestamp
    const updates: Record<string, unknown> = {};

    if (args.firstName !== undefined) updates.firstName = args.firstName;
    if (args.lastName !== undefined) updates.lastName = args.lastName;
    if (args.profilePhoto !== undefined) updates.profilePhoto = args.profilePhoto;
    if (args.timezone !== undefined) updates.timezone = args.timezone;
    if (args.dateOfBirth !== undefined) {
      // Convert YYYY-MM-DD string to timestamp for storage
      updates.dateOfBirth = parseDate(args.dateOfBirth, "dateOfBirth");
    }

    // If name changed, rebuild searchText for full-text search
    if (args.firstName !== undefined || args.lastName !== undefined) {
      const existingUser = await ctx.db.get(userId);
      updates.searchText = buildSearchText({
        firstName: args.firstName ?? existingUser?.firstName,
        lastName: args.lastName ?? existingUser?.lastName,
        email: existingUser?.email,
        phone: existingUser?.phone,
      });
    }

    await ctx.db.patch(userId, {
      ...updates,
      updatedAt: now(),
    });

    // If profile display data changed, sync to channel memberships
    // This updates the denormalized displayName/profilePhoto in chatChannelMembers
    if (args.firstName !== undefined || args.lastName !== undefined || args.profilePhoto !== undefined) {
      await ctx.scheduler.runAfter(0, internal.functions.sync.memberships.syncUserProfileToChannels, {
        userId,
      });
    }

    return await ctx.db.get(userId);
  },
});

/**
 * Clear active community for current user
 * tRPC equivalent: user.clearActiveCommunity
 *
 * Used when user wants to continue without a community selected.
 */
export const clearActiveCommunity = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    await ctx.db.patch(userId, {
      activeCommunityId: undefined,
      updatedAt: now(),
    });

    return { success: true };
  },
});

/**
 * Get users by IDs (batch lookup)
 *
 * Security: Returns only public fields (firstName, lastName, profilePhoto)
 * to prevent PII exposure. Filters out deactivated users.
 */
export const getByIds = query({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const users = await Promise.all(
      args.userIds.map((id) => ctx.db.get(id))
    );

    // Filter out null users and deactivated users, return only public fields
    return users
      .filter((user): user is NonNullable<typeof user> =>
        user !== null && user.isActive !== false
      )
      .map(extractPublicFields);
  },
});

// Use centralized COMMUNITY_ADMIN_THRESHOLD from lib/permissions

/**
 * Get user profile with community memberships
 * tRPC equivalent: user.me
 *
 * Returns full user profile with community memberships for use in AuthProvider.
 * Returns null if not authenticated or token invalid.
 */
export const me = query({
  args: { token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) {
      return null;
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return null;
    }

    // Get user's active community memberships only (status=1)
    // Status values: 1=Active, 2=Inactive (left), 3=Blocked
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), 1)) // Active only
      .collect();

    // Fetch community details
    const communityMemberships = await Promise.all(
      memberships.map(async (membership) => {
        const community = await ctx.db.get(membership.communityId);
        if (!community) return null;
        const roleLevel = membership.roles ?? COMMUNITY_ROLES.MEMBER;
        return {
          communityId: community._id,
          communityLegacyId: community.legacyId,
          communityName: community.name || "",
          communityLogo: getMediaUrl(community.logo),
          role: roleLevel,
          isAdmin: roleLevel >= COMMUNITY_ADMIN_THRESHOLD,
          isPrimaryAdmin: roleLevel === COMMUNITY_ROLES.PRIMARY_ADMIN,
          status: membership.status || 0,
          communityAnniversary: membership.communityAnniversary || null,
        };
      })
    );

    // Get active community details
    let activeCommunityName: string | null = null;
    let activeCommunityPrimaryColor: string | null = null;
    let activeCommunitySecondaryColor: string | null = null;

    if (user.activeCommunityId) {
      const activeCommunity = await ctx.db.get(user.activeCommunityId);
      if (activeCommunity) {
        activeCommunityName = activeCommunity.name || null;
        activeCommunityPrimaryColor = activeCommunity.primaryColor || null;
        activeCommunitySecondaryColor = activeCommunity.secondaryColor || null;
      }
    }

    return {
      id: user._id,
      legacyId: user.legacyId,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      phone: user.phone || null,
      phoneVerified: user.phoneVerified || false,
      profilePhoto: getMediaUrl(user.profilePhoto),
      dateOfBirth: user.dateOfBirth
        ? new Date(user.dateOfBirth).toISOString().split("T")[0]
        : null,
      timezone: user.timezone || "America/New_York",
      activeCommunityId: user.activeCommunityId || null,
      activeCommunityName,
      activeCommunityPrimaryColor,
      activeCommunitySecondaryColor,
      communityMemberships: communityMemberships.filter(Boolean),
    };
  },
});

// ============================================================================
// Internal Queries (for actions to call)
// ============================================================================

/**
 * Internal query to get user by ID.
 * Used by chat actions.
 */
export const getByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

/**
 * Internal query to get user contact info by legacy ID.
 * Used by moderation email to include contact details.
 */
export const getContactInfoByLegacyId = internalQuery({
  args: { legacyId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.legacyId))
      .first();

    if (!user) {
      return null;
    }

    return {
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown",
      email: user.email || null,
      phone: user.phone || null,
    };
  },
});

/**
 * Internal query to get user contact info by Convex ID.
 * Used by user blocking email to include contact details.
 */
export const getContactInfoByConvexId = internalQuery({
  args: { convexId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.convexId);

    if (!user) {
      return null;
    }

    return {
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown",
      email: user.email || null,
      phone: user.phone || null,
    };
  },
});

/**
 * Internal query to resolve a token user ID to a Convex user ID.
 * Used by actions that need to resolve the raw token userId string
 * (which may be a Convex ID or legacy ID) to a valid Convex user ID.
 */
export const resolveUserIdInternal = internalQuery({
  args: { tokenUserId: v.string() },
  handler: async (ctx, args) => {
    // First, try to look up as a Convex ID
    try {
      const user = await ctx.db.get(args.tokenUserId as Id<"users">);
      if (user) {
        return { userId: user._id };
      }
    } catch {
      // Not a valid Convex ID format, continue to legacy lookup
    }

    // Fall back to legacy ID lookup
    const legacyUser = await ctx.db
      .query("users")
      .withIndex("by_legacyId", (q) => q.eq("legacyId", args.tokenUserId))
      .first();

    if (legacyUser) {
      return { userId: legacyUser._id };
    }

    return null;
  },
});

// ============================================================================
// Migration Functions (for Supabase to Convex sync)
// ============================================================================

/**
 * List users with legacy IDs for sync script (paginated)
 * Returns minimal data needed for ID mapping
 */
export const listAllForSync = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 1000;

    let query = ctx.db.query("users").order("asc");

    // If we have a cursor, filter to users after that ID
    if (args.cursor) {
      const cursorDoc = await ctx.db.get(args.cursor as Id<"users">);
      if (cursorDoc) {
        query = ctx.db
          .query("users")
          .order("asc")
          .filter((q) => q.gt(q.field("_creationTime"), cursorDoc._creationTime));
      }
    }

    const users = await query.take(limit + 1);

    const hasMore = users.length > limit;
    const results = hasMore ? users.slice(0, limit) : users;
    const nextCursor = hasMore ? results[results.length - 1]._id : null;

    return {
      users: results.map((u) => ({
        _id: u._id,
        legacyId: u.legacyId,
      })),
      nextCursor,
      hasMore,
    };
  },
});

