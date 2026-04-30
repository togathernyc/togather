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
import { adjustEnabledCounter } from "../lib/notifications/enabledCounter";
import {
  getUsersWithNotificationsDisabled,
  isUserNotificationsDisabled,
} from "../lib/notifications/enabledStatus";

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
  /**
   * True when the user has no push tokens for the current environment — UI
   * surfaces render a "notifications disabled" badge so senders know not to
   * expect immediate delivery. Truth source matches `pushTokens` (see
   * `lib/notifications/enabledStatus.ts`).
   */
  notificationsDisabled: boolean;
};

/**
 * Extract only public fields from a user document
 */
function extractPublicFields(
  user: {
    _id: Id<"users">;
    firstName?: string;
    lastName?: string;
    profilePhoto?: string;
  },
  notificationsDisabled: boolean,
): PublicUserFields {
  return {
    _id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePhoto: user.profilePhoto,
    notificationsDisabled,
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
    const notificationsDisabled = await isUserNotificationsDisabled(ctx, user._id);
    return extractPublicFields(user, notificationsDisabled);
  },
});

/**
 * Get a user's public profile scoped to a community.
 *
 * Returns the data needed to render the user profile page:
 * - Always-public fields: name, photo, bio, socials, birthday (M/D), location.
 * - Community-scoped fields derived from the profile user's active
 *   `userCommunities` record: memberSince, communityRole, isCommunityAdmin,
 *   isPrimaryAdmin.
 * - `leaderGroupIds`: groups in this community where the profile user is
 *   an active leader.
 *
 * Returns `null` when:
 * - the profile user is missing or inactive, or
 * - the profile user has no active membership in the given community.
 *
 * Viewer auth is optional — anonymous viewers still see the public fields.
 * This mirrors the public-safe shape of `getById`.
 */
export const getProfile = query({
  args: {
    token: v.optional(v.string()),
    userId: v.id("users"),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    // Viewer auth is optional — we don't gate public fields on it.
    await getOptionalAuth(ctx, args.token);

    const user = await ctx.db.get(args.userId);
    if (!user || user.isActive === false) {
      return null;
    }

    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId),
      )
      .filter((q) => q.eq(q.field("status"), 1))
      .first();

    if (!membership) {
      return null;
    }

    const roleLevel = membership.roles ?? COMMUNITY_ROLES.MEMBER;

    // Find groups in this community where the profile user is an active leader.
    // Pull the user's group memberships first (by_user is indexed), then filter
    // by leader role + not-left + this community.
    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.and(
          q.eq(q.field("role"), "leader"),
          q.eq(q.field("leftAt"), undefined),
        ),
      )
      .collect();

    const leaderGroupIds: Id<"groups">[] = [];
    for (const gm of groupMemberships) {
      const group = await ctx.db.get(gm.groupId);
      if (group && group.communityId === args.communityId && group.isArchived !== true) {
        leaderGroupIds.push(group._id);
      }
    }

    const notificationsDisabled = await isUserNotificationsDisabled(ctx, user._id);

    return {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePhoto: getMediaUrl(user.profilePhoto) ?? null,
      notificationsDisabled,
      bio: user.bio ?? null,
      instagramHandle: user.instagramHandle ?? null,
      linkedinHandle: user.linkedinHandle ?? null,
      birthdayMonth: user.birthdayMonth ?? null,
      birthdayDay: user.birthdayDay ?? null,
      location: user.location ?? null,
      // Community-scoped:
      memberSince: membership.createdAt ?? null,
      communityRole: roleLevel,
      isCommunityAdmin: roleLevel >= COMMUNITY_ADMIN_THRESHOLD,
      isPrimaryAdmin: roleLevel === COMMUNITY_ROLES.PRIMARY_ADMIN,
      leaderGroupIds,
    };
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

// =============================================================================
// Profile field validators (used by the `update` mutation below)
// =============================================================================

const BIO_MAX_LENGTH = 500;
const LOCATION_MAX_LENGTH = 100;
const INSTAGRAM_REGEX = /^[A-Za-z0-9._]{1,30}$/;
const LINKEDIN_SLUG_REGEX = /^[A-Za-z0-9-]{3,100}$/;

/**
 * Normalize an Instagram handle:
 * - trim whitespace
 * - strip a leading `@`
 */
function normalizeInstagramHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

/**
 * Normalize a LinkedIn handle:
 * - trim whitespace
 * - if the user pasted a URL, strip the `https?://.../in/` prefix and any
 *   trailing slash/query — leaving just the slug.
 * - strip a leading `@` (users sometimes prefix handles with it)
 */
function normalizeLinkedinHandle(raw: string): string {
  let handle = raw.trim();
  const urlMatch = handle.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (urlMatch) {
    handle = urlMatch[1];
  }
  handle = handle.replace(/^@+/, "");
  // Drop any trailing slash users may have typed
  handle = handle.replace(/\/+$/, "");
  return handle;
}

/**
 * Check whether (month, day) is a valid calendar M/D. Feb 29 is allowed
 * (leap day). Rejects Feb 30, Apr 31, Jun 31, Sep 31, Nov 31, etc.
 */
function isValidMonthDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const daysInMonth: Record<number, number> = {
    1: 31,
    2: 29, // leap day allowed
    3: 31,
    4: 30,
    5: 31,
    6: 30,
    7: 31,
    8: 31,
    9: 30,
    10: 31,
    11: 30,
    12: 31,
  };
  return day <= daysInMonth[month];
}

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
    zipCode: v.optional(v.string()),
    // Public profile fields
    bio: v.optional(v.string()),
    instagramHandle: v.optional(v.string()),
    linkedinHandle: v.optional(v.string()),
    birthdayMonth: v.optional(v.number()),
    birthdayDay: v.optional(v.number()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Build update object, converting dateOfBirth string to timestamp
    const updates: Record<string, unknown> = {};

    if (args.firstName !== undefined) updates.firstName = args.firstName;
    if (args.lastName !== undefined) updates.lastName = args.lastName;
    if (args.profilePhoto !== undefined) updates.profilePhoto = args.profilePhoto || undefined;
    if (args.timezone !== undefined) updates.timezone = args.timezone;
    if (args.dateOfBirth !== undefined) {
      // Convert YYYY-MM-DD string to timestamp for storage
      updates.dateOfBirth = parseDate(args.dateOfBirth, "dateOfBirth");
    }
    if (args.zipCode !== undefined) updates.zipCode = args.zipCode;

    // Profile fields — validate & normalize. Empty string → clear the field.
    if (args.bio !== undefined) {
      const trimmed = args.bio.trim();
      if (trimmed.length > BIO_MAX_LENGTH) {
        throw new Error(`Bio must be ${BIO_MAX_LENGTH} characters or fewer`);
      }
      updates.bio = trimmed.length > 0 ? trimmed : undefined;
    }

    if (args.location !== undefined) {
      const trimmed = args.location.trim();
      if (trimmed.length > LOCATION_MAX_LENGTH) {
        throw new Error(`Location must be ${LOCATION_MAX_LENGTH} characters or fewer`);
      }
      updates.location = trimmed.length > 0 ? trimmed : undefined;
    }

    if (args.instagramHandle !== undefined) {
      const normalized = normalizeInstagramHandle(args.instagramHandle);
      if (normalized.length === 0) {
        updates.instagramHandle = undefined;
      } else if (!INSTAGRAM_REGEX.test(normalized)) {
        throw new Error(
          "Invalid Instagram handle. Use letters, numbers, periods, or underscores (max 30).",
        );
      } else {
        updates.instagramHandle = normalized;
      }
    }

    if (args.linkedinHandle !== undefined) {
      const normalized = normalizeLinkedinHandle(args.linkedinHandle);
      if (normalized.length === 0) {
        updates.linkedinHandle = undefined;
      } else if (!LINKEDIN_SLUG_REGEX.test(normalized)) {
        throw new Error(
          "Invalid LinkedIn handle. Use the slug from linkedin.com/in/<slug> (letters, numbers, hyphens).",
        );
      } else {
        updates.linkedinHandle = normalized;
      }
    }

    // Birthday M/D: require both together to either be set or cleared as a pair.
    // The client uses 0 as an explicit "clear" sentinel for either field.
    const bmProvided = args.birthdayMonth !== undefined;
    const bdProvided = args.birthdayDay !== undefined;
    if (bmProvided || bdProvided) {
      const clearing =
        (bmProvided && args.birthdayMonth === 0) ||
        (bdProvided && args.birthdayDay === 0);

      if (clearing) {
        updates.birthdayMonth = undefined;
        updates.birthdayDay = undefined;
      } else {
        // Merge with existing so one-sided edits keep the paired value intact.
        const existing = bmProvided && bdProvided ? null : await ctx.db.get(userId);
        const month = bmProvided ? args.birthdayMonth! : existing?.birthdayMonth;
        const day = bdProvided ? args.birthdayDay! : existing?.birthdayDay;

        if (month == null || day == null) {
          throw new Error("Birthday must include both month and day");
        } else if (!isValidMonthDay(month, day)) {
          throw new Error("Invalid birthday — month must be 1–12 and day must be valid for that month");
        } else {
          updates.birthdayMonth = month;
          updates.birthdayDay = day;
        }
      }
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

    // If zipCode changed, sync to all communityPeople records for this user
    if (args.zipCode !== undefined) {
      const cpRecords = await ctx.db
        .query("communityPeople")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const cp of cpRecords) {
        await ctx.db.patch(cp._id, { zipCode: args.zipCode, updatedAt: now() });
      }
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
 * Record that the current user is active (app foregrounded / session start).
 * Updates lastActiveAt once per day at most to avoid excessive writes.
 */
export const recordActivity = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const user = await ctx.db.get(userId);
    if (!user) return;

    // Only update if lastActiveAt is not already today (UTC)
    const nowMs = Date.now();
    const todayStart = new Date(nowMs);
    todayStart.setUTCHours(0, 0, 0, 0);

    if (user.lastActiveAt && user.lastActiveAt >= todayStart.getTime()) {
      return; // Already recorded today
    }

    await ctx.db.patch(userId, { lastActiveAt: nowMs });
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
    const livingUsers = users.filter(
      (user): user is NonNullable<typeof user> =>
        user !== null && user.isActive !== false,
    );
    const disabled = await getUsersWithNotificationsDisabled(
      ctx,
      livingUsers.map((u) => u._id),
    );
    return livingUsers.map((u) => extractPublicFields(u, disabled.has(u._id)));
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

    const notificationsDisabled = await isUserNotificationsDisabled(ctx, userId);

    return {
      id: user._id,
      legacyId: user.legacyId,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      isStaff: user.isStaff || false,
      isSuperuser: user.isSuperuser || false,
      notificationsDisabled,
      phone: user.phone || null,
      phoneVerified: user.phoneVerified || false,
      profilePhoto: getMediaUrl(user.profilePhoto),
      dateOfBirth: user.dateOfBirth
        ? new Date(user.dateOfBirth).toISOString().split("T")[0]
        : null,
      timezone: user.timezone || "America/New_York",
      zipCode: user.zipCode || null,
      // Public profile fields — surfaced here so the Edit Profile form can
      // seed its defaults without making a second query.
      bio: user.bio ?? null,
      instagramHandle: user.instagramHandle ?? null,
      linkedinHandle: user.linkedinHandle ?? null,
      birthdayMonth: user.birthdayMonth ?? null,
      birthdayDay: user.birthdayDay ?? null,
      location: user.location ?? null,
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
// Account Deletion
// ============================================================================

/**
 * Soft-delete a user account by anonymizing PII and removing memberships.
 *
 * This does NOT hard-delete the user record (to preserve referential integrity
 * in chat messages, tasks, etc.). Instead it:
 * 1. Anonymizes the user record (clears PII, sets isActive: false)
 * 2. Removes community memberships (userCommunities)
 * 3. Removes group memberships (groupMembers)
 * 4. Removes chat channel memberships (chatChannelMembers)
 * 5. Removes push tokens
 * 6. Removes notifications
 * 7. Removes chat read states and typing indicators
 * 8. Removes attendance confirmation tokens
 */
export const deleteAccountInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const timestamp = now();

    const communityMemberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const communityIdsForAssigneeCleanup = new Set(
      communityMemberships.map((m) => m.communityId.toString()),
    );

    async function buildAssigneeSortKey(
      assigneeIds: Id<"users">[] | undefined,
    ): Promise<string | undefined> {
      if (!assigneeIds?.length) return undefined;
      const names: string[] = [];
      for (const id of assigneeIds) {
        const u = await ctx.db.get(id);
        if (u) {
          names.push(
            `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || id,
          );
        }
      }
      return names.length > 0 ? names.join(", ") : undefined;
    }

    // 1. Anonymize the user record
    await ctx.db.patch(args.userId, {
      firstName: "Deleted",
      lastName: "User",
      email: undefined,
      phone: undefined,
      password: undefined,
      profilePhoto: undefined,
      dateOfBirth: undefined,
      zipCode: undefined,
      timezone: undefined,
      phoneVerified: false,
      isActive: false,
      pushNotificationsEnabled: false,
      emailNotificationsEnabled: false,
      smsNotificationsEnabled: false,
      activeCommunityId: undefined,
      searchText: "deleted user",
      externalIds: undefined,
      associatedEmails: undefined,
      updatedAt: timestamp,
    });

    // Helper to collect and delete all records from a table by index
    async function deleteByUserIndex(
      table: string,
      index: string = "by_user"
    ) {
      const records = await ctx.db
        .query(table as any)
        .withIndex(index, (q: any) => q.eq("userId", args.userId))
        .collect();
      for (const record of records) {
        await ctx.db.delete(record._id);
      }
      return records.length;
    }

    // 2. Remove community memberships
    await deleteByUserIndex("userCommunities", "by_user");

    // 3. Remove group memberships (collect IDs first for followup score cleanup)
    const groupMemberRecords = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q: any) => q.eq("userId", args.userId))
      .collect();
    for (const record of groupMemberRecords) {
      // Remove associated memberFollowupScores
      const followupScores = await ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) => q.eq("groupMemberId", record._id))
        .collect();
      for (const score of followupScores) {
        await ctx.db.delete(score._id);
      }
      await ctx.db.delete(record._id);
    }

    // 4. Remove chat channel memberships
    await deleteByUserIndex("chatChannelMembers", "by_user");

    // 5. Remove push tokens — decrement the per-environment enabled counter
    //    once per env where this user had ≥1 token, BEFORE deletion (so we
    //    can still see what envs they had tokens in).
    {
      const userTokens = await ctx.db
        .query("pushTokens")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
      const envs = new Set<string>();
      for (const t of userTokens) {
        if (t.environment) envs.add(t.environment);
      }
      for (const env of envs) {
        await adjustEnabledCounter(ctx, env, -1);
      }
    }
    await deleteByUserIndex("pushTokens", "by_user");

    // 6. Remove notifications
    await deleteByUserIndex("notifications", "by_user");

    // 7. Remove chat read states
    await deleteByUserIndex("chatReadState", "by_user");

    // 8. Typing indicators are ephemeral (auto-expire in 5s) — no cleanup needed

    // 9. Remove attendance confirmation tokens (uses by_user_meeting index)
    const confirmTokens = await ctx.db
      .query("attendanceConfirmationTokens")
      .withIndex("by_user_meeting", (q) => q.eq("userId", args.userId))
      .collect();
    for (const record of confirmTokens) {
      await ctx.db.delete(record._id);
    }

    // 10. Remove chat blocks (both as blocker and blocked)
    const blockerRecords = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", args.userId))
      .collect();
    for (const record of blockerRecords) {
      await ctx.db.delete(record._id);
    }

    const blockedRecords = await ctx.db
      .query("chatUserBlocks")
      .withIndex("by_blocked", (q) => q.eq("blockedId", args.userId))
      .collect();
    for (const record of blockedRecords) {
      await ctx.db.delete(record._id);
    }

    // 10b. Remove channel join requests
    await deleteByUserIndex("channelJoinRequests", "by_user");

    // 10c. Remove chat message reactions
    await deleteByUserIndex("chatMessageReactions", "by_user");

    // 10d. Remove chat user flags (both as reporter and reported)
    await deleteByUserIndex("chatUserFlags", "by_user");
    const userFlagsByReporter = await ctx.db
      .query("chatUserFlags")
      .withIndex("by_reportedBy", (q: any) => q.eq("reportedById", args.userId))
      .collect();
    for (const record of userFlagsByReporter) {
      await ctx.db.delete(record._id);
    }

    // 10e. Remove chat message flags reported by this user
    const messageFlagsByReporter = await ctx.db
      .query("chatMessageFlags")
      .withIndex("by_reportedBy", (q: any) => q.eq("reportedById", args.userId))
      .collect();
    for (const record of messageFlagsByReporter) {
      await ctx.db.delete(record._id);
    }

    // 11. Remove meeting RSVPs and attendances
    await deleteByUserIndex("meetingRsvps", "by_user");
    await deleteByUserIndex("meetingAttendances", "by_user");

    // 11b. Remove this user as assignee on other members' communityPeople rows
    for (const communityIdStr of communityIdsForAssigneeCleanup) {
      const communityId = communityIdStr as Id<"communities">;
      const junctionAsAssignee = await ctx.db
        .query("communityPeopleAssignees")
        .withIndex("by_community_assignee", (q) =>
          q.eq("communityId", communityId).eq("assigneeUserId", args.userId),
        )
        .collect();
      const affectedPersonIds = new Set(
        junctionAsAssignee.map((r) => r.communityPersonId.toString()),
      );
      for (const row of junctionAsAssignee) {
        await ctx.db.delete(row._id);
      }
      for (const personIdStr of affectedPersonIds) {
        const cp = await ctx.db.get(personIdStr as Id<"communityPeople">);
        if (!cp) continue;
        const filtered = (cp.assigneeIds ?? []).filter(
          (id) => id !== args.userId,
        ) as Id<"users">[];
        const newAssigneeIds =
          filtered.length > 0 ? filtered : undefined;
        const newAssigneeId = newAssigneeIds?.[0];
        await ctx.db.patch(cp._id, {
          assigneeIds: newAssigneeIds,
          assigneeId: newAssigneeId,
          assigneeSortKey: await buildAssigneeSortKey(newAssigneeIds),
          updatedAt: timestamp,
        });
      }
    }

    // 12. Remove communityPeople records
    const cpRecords = await ctx.db
      .query("communityPeople")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const record of cpRecords) {
      // Also remove associated assignee junction records
      const assigneeRecords = await ctx.db
        .query("communityPeopleAssignees")
        .withIndex("by_communityPerson", (q) =>
          q.eq("communityPersonId", record._id)
        )
        .collect();
      for (const assignee of assigneeRecords) {
        await ctx.db.delete(assignee._id);
      }
      await ctx.db.delete(record._id);
    }

    return { success: true };
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

