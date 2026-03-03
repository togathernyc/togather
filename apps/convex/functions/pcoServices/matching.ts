/**
 * PCO Services Member Matching
 *
 * Functions to match PCO people to Together users by phone or email.
 * Uses userCommunities.pcoPersonId (indexed) and externalIds.planningCenterId to track matched users.
 */

import { v } from "convex/values";
import { QueryCtx, MutationCtx } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";
import { normalizeEmail } from "../../lib/phoneNormalize";
import { normalizePhone } from "../../lib/utils";
import { internalMutation, internalQuery } from "../../_generated/server";

/**
 * Internal helper to link a user to their PCO person ID.
 * Used by both linkUserToPcoPerson and matchAndLinkPcoPerson to avoid duplication.
 */
async function linkUserToPcoPersonInternal(
  ctx: MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">,
  pcoPersonId: string
): Promise<void> {
  const uc = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .unique();

  if (uc) {
    await ctx.db.patch(uc._id, {
      externalIds: {
        ...uc.externalIds,
        planningCenterId: pcoPersonId,
      },
      // Also set denormalized field for indexed lookups
      pcoPersonId: pcoPersonId,
    });
  }
}

/**
 * Find a Together user by PCO person's phone or email within a community.
 * Returns the user ID if found, null otherwise.
 *
 * Match priority: Phone matches are preferred over email matches.
 * If a phone match is found anywhere in the community, it will be returned.
 * Email matches are only used as a fallback if no phone match exists.
 *
 * Performance: Uses indexed lookups on users table (by_phone, by_email) then
 * verifies community membership. This is O(1) instead of O(community size).
 */
export async function findTogetherUserByContact(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  pcoPhone: string | null,
  pcoEmail: string | null
): Promise<Id<"users"> | null> {
  if (!pcoPhone && !pcoEmail) return null;

  // Try phone match first (highest priority)
  if (pcoPhone) {
    // Try multiple phone formats to handle legacy data
    const phoneFormats = getPhoneFormats(pcoPhone);

    for (const phoneFormat of phoneFormats) {
      // Query users by phone (indexed)
      const usersWithPhone = await ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", phoneFormat))
        .collect();

      // Check if any of these users are in the community
      for (const user of usersWithPhone) {
        const membership = await ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", user._id).eq("communityId", communityId)
          )
          .first();

        // Only match ACTIVE members (status === 1)
        // Pending members should complete their signup before being linked to PCO
        if (membership && membership.status === 1) {
          return user._id;
        }
      }
    }
  }

  // Fallback to email match
  if (pcoEmail) {
    // Try multiple email formats to handle legacy data with mixed case
    const emailFormats = getEmailFormats(pcoEmail);

    for (const emailFormat of emailFormats) {
      // Query users by email (indexed)
      const usersWithEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", emailFormat))
        .collect();

      // Check if any of these users are in the community
      for (const user of usersWithEmail) {
        const membership = await ctx.db
          .query("userCommunities")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", user._id).eq("communityId", communityId)
          )
          .first();

        // Only match ACTIVE members (status === 1)
        // Pending members should complete their signup before being linked to PCO
        if (membership && membership.status === 1) {
          return user._id;
        }
      }
    }
  }

  return null;
}

/**
 * Get phone formats to try for lookup.
 * Handles legacy data that might be stored without normalization.
 */
function getPhoneFormats(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const formats: string[] = [];

  // Normalized format with +1 (current standard)
  const normalized = normalizePhone(phone);
  formats.push(normalized);

  // Digits only (legacy format)
  if (digits.length === 10) {
    // 10-digit US number
    formats.push(digits);
    formats.push(`1${digits}`); // With country code, no +
  } else if (digits.length === 11 && digits.startsWith("1")) {
    // 11-digit with US country code
    formats.push(digits);
    formats.push(digits.slice(1)); // Without country code
  }

  // Dedupe
  return [...new Set(formats)];
}

/**
 * Get email formats to try for lookup.
 * Handles legacy data that might be stored with mixed case.
 */
function getEmailFormats(email: string): string[] {
  const formats: string[] = [];

  // Normalized format (lowercase, trimmed)
  const normalized = normalizeEmail(email);
  formats.push(normalized);

  // Original format (for legacy data stored without normalization)
  const trimmed = email.trim();
  if (trimmed !== normalized) {
    formats.push(trimmed);
  }

  // Dedupe
  return [...new Set(formats)];
}

/**
 * Find a Together user by their PCO person ID (if already linked).
 *
 * Uses the by_community_pcoPersonId index for efficient lookups in large communities.
 * The pcoPersonId field is a denormalized copy of externalIds.planningCenterId
 * maintained at the top level for indexing.
 */
export async function findUserByPcoPersonId(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  pcoPersonId: string
): Promise<Id<"users"> | null> {
  // Use the dedicated index for efficient PCO person lookup
  const uc = await ctx.db
    .query("userCommunities")
    .withIndex("by_community_pcoPersonId", (q) =>
      q.eq("communityId", communityId).eq("pcoPersonId", pcoPersonId)
    )
    .first();

  return uc?.userId ?? null;
}

/**
 * Link a user to their PCO person ID in userCommunities.
 * Sets both externalIds.planningCenterId and the denormalized pcoPersonId field.
 */
export const linkUserToPcoPerson = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    pcoPersonId: v.string(),
  },
  handler: async (ctx, args) => {
    await linkUserToPcoPersonInternal(ctx, args.communityId, args.userId, args.pcoPersonId);
  },
});

/**
 * Match a PCO person to a Together user and link them.
 * Returns the matched user ID if found, null otherwise.
 */
export const matchAndLinkPcoPerson = internalMutation({
  args: {
    communityId: v.id("communities"),
    pcoPersonId: v.string(),
    pcoPhone: v.optional(v.string()),
    pcoEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // First check if already linked
    const existingUserId = await findUserByPcoPersonId(
      ctx,
      args.communityId,
      args.pcoPersonId
    );
    if (existingUserId) {
      return { userId: existingUserId, status: "already_linked" as const };
    }

    // Try to find by contact info
    const userId = await findTogetherUserByContact(
      ctx,
      args.communityId,
      args.pcoPhone || null,
      args.pcoEmail || null
    );

    if (!userId) {
      return { userId: null, status: "not_found" as const };
    }

    // Link the user to this PCO person (use shared helper)
    await linkUserToPcoPersonInternal(ctx, args.communityId, userId, args.pcoPersonId);

    return { userId, status: "matched" as const };
  },
});

/**
 * Get all users in a community who have PCO person IDs linked.
 * Uses the denormalized pcoPersonId field for filtering.
 */
export const getLinkedPcoUsers = internalQuery({
  args: {
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userCommunities = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();

    return userCommunities
      .filter((uc) => uc.pcoPersonId)
      .map((uc) => ({
        userId: uc.userId,
        pcoPersonId: uc.pcoPersonId!,
      }));
  },
});
