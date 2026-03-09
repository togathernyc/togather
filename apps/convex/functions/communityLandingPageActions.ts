/**
 * Community Landing Page — Actions
 *
 * The submitForm action orchestrates user creation, community join,
 * and follow-up data setup. Queries and mutations live in communityLandingPage.ts.
 */

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

/**
 * Submit the landing page form.
 *
 * 1. Find or create user by phone
 * 2. Join community + announcement group
 * 3. Set custom field values on announcement group follow-up record
 * 4. Generate notes summary (if enabled)
 * 5. Run automation rules
 */
export const submitForm = action({
  args: {
    slug: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    customFields: v.optional(
      v.array(
        v.object({
          slot: v.optional(v.string()),
          label: v.string(),
          value: v.any(),
          includeInNotes: v.optional(v.boolean()),
        })
      )
    ),
  },
  returns: v.object({
    success: v.boolean(),
    user: v.object({
      id: v.string(),
      firstName: v.string(),
      lastName: v.string(),
    }),
  }),
  handler: async (ctx, args) => {
    // Server-side input validation
    const trimmedFirstName = args.firstName.trim();
    const trimmedLastName = args.lastName.trim();
    const trimmedPhone = args.phone.trim();

    if (!trimmedFirstName) {
      throw new Error("First name is required");
    }
    if (!trimmedLastName) {
      throw new Error("Last name is required");
    }

    // Validate phone has at least some digits
    const phoneDigits = trimmedPhone.replace(/\D/g, "");
    if (phoneDigits.length < 10) {
      throw new Error("Please enter a valid phone number");
    }

    // Rate limit by phone number (5 attempts per hour)
    await ctx.runMutation(
      internal.functions.communityLandingPage.checkFormRateLimit,
      { phone: trimmedPhone }
    );

    // 1. Look up community + landing page config
    const result = await ctx.runQuery(
      internal.functions.communityLandingPage.getConfigBySlugInternal,
      { slug: args.slug }
    );

    if (!result) {
      throw new Error("Landing page not found or not enabled");
    }

    const { community, landingPage } = result;

    // 2. Find or create user by phone
    const userId: string = await ctx.runMutation(
      internal.functions.communityLandingPage.findOrCreateUser,
      {
        phone: trimmedPhone,
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
        email: args.email,
        zipCode: args.zipCode,
        dateOfBirth: args.dateOfBirth,
      }
    );

    // 3. Join community + announcement group
    await ctx.runMutation(
      internal.functions.communityLandingPage.joinCommunityInternal,
      {
        communityId: community._id as Id<"communities">,
        userId: userId as Id<"users">,
      }
    );

    // 4. Set custom field values + notes + automation
    // Always call even without custom fields — ensures followup record, notes, and automation rules run
    await ctx.runMutation(
      internal.functions.communityLandingPage.setCustomFieldsAndNotes,
      {
        communityId: community._id as Id<"communities">,
        userId: userId as Id<"users">,
        customFields: args.customFields ?? [],
        zipCode: args.zipCode,
        dateOfBirth: args.dateOfBirth,
        generateNoteSummary: landingPage.generateNoteSummary ?? true,
        automationRules: landingPage.automationRules,
      }
    );

    return {
      success: true,
      user: {
        id: userId,
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
      },
    };
  },
});
