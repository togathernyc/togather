"use node";

/**
 * Community Landing Page — Actions (Node.js runtime)
 *
 * The submitForm action needs Node.js for JWT token generation (jose).
 * Queries and mutations live in communityLandingPage.ts.
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
    customFields: v.optional(
      v.array(
        v.object({
          slot: v.optional(v.string()),
          label: v.string(),
          value: v.any(),
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
        phone: args.phone,
        firstName: args.firstName,
        lastName: args.lastName,
        email: args.email,
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
        generateNoteSummary: landingPage.generateNoteSummary ?? true,
        automationRules: landingPage.automationRules,
      }
    );

    return {
      success: true,
      user: {
        id: userId,
        firstName: args.firstName,
        lastName: args.lastName,
      },
    };
  },
});
