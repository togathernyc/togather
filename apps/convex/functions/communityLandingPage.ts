/**
 * Community Landing Page — Queries & Mutations
 *
 * Public web form at /c/[slug] that digitizes the "gold card" —
 * newcomers fill out name, phone, email, and community-configured custom fields.
 *
 * This file contains queries and mutations (Convex runtime).
 * The submitForm action lives in communityLandingPageActions.ts ("use node" runtime).
 */

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { requireCommunityAdmin } from "../lib/permissions";
import { VALID_CUSTOM_SLOTS } from "../lib/followupConstants";
import { normalizePhone, buildSearchText, now } from "../lib/utils";
import { syncUserChannelMembershipsLogic } from "./sync/memberships";

// ============================================================================
// Public Queries (no auth required)
// ============================================================================

/**
 * Get landing page data for public display.
 * Returns community info + form configuration. Returns null if not found or disabled.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const community = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!community) return null;

    const landingPage = await ctx.db
      .query("communityLandingPages")
      .withIndex("by_community", (q) => q.eq("communityId", community._id))
      .first();

    if (!landingPage || !landingPage.isEnabled) return null;

    return {
      community: {
        name: community.name,
        logo: community.logo,
        primaryColor: community.primaryColor,
        slug: community.slug,
      },
      title: landingPage.title,
      description: landingPage.description,
      submitButtonText: landingPage.submitButtonText,
      successMessage: landingPage.successMessage,
      formFields: landingPage.formFields,
    };
  },
});

// ============================================================================
// Internal Queries (used by submitForm action)
// ============================================================================

/**
 * Get community + landing page config by slug (internal, no auth).
 */
export const getConfigBySlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const community = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!community) return null;

    const landingPage = await ctx.db
      .query("communityLandingPages")
      .withIndex("by_community", (q) => q.eq("communityId", community._id))
      .first();

    if (!landingPage || !landingPage.isEnabled) return null;

    return { community, landingPage };
  },
});

// ============================================================================
// Internal Mutations (used by submitForm action)
// ============================================================================

/**
 * Find existing user by phone or create a new one.
 * Returns the user ID.
 */
export const findOrCreateUser = internalMutation({
  args: {
    phone: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedPhone = normalizePhone(args.phone);
    const timestamp = now();

    // Check if user exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", normalizedPhone))
      .first();

    if (existing) {
      // Update name/email if user doesn't have them yet
      const updates: Record<string, any> = {};
      if (!existing.firstName && args.firstName) updates.firstName = args.firstName;
      if (!existing.lastName && args.lastName) updates.lastName = args.lastName;
      if (!existing.email && args.email) updates.email = args.email.toLowerCase();
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = timestamp;
        updates.searchText = buildSearchText({
          firstName: updates.firstName || existing.firstName,
          lastName: updates.lastName || existing.lastName,
          email: updates.email || existing.email,
          phone: normalizedPhone,
        });
        await ctx.db.patch(existing._id, updates);
      }
      return existing._id;
    }

    // Create new user
    const normalizedEmail = args.email?.toLowerCase();

    const userId = await ctx.db.insert("users", {
      phone: normalizedPhone,
      phoneVerified: false, // Not verified via OTP — will verify when they download app
      firstName: args.firstName,
      lastName: args.lastName,
      email: normalizedEmail,
      searchText: buildSearchText({
        firstName: args.firstName,
        lastName: args.lastName,
        email: normalizedEmail,
        phone: normalizedPhone,
      }),
      isActive: true,
      isStaff: false,
      isSuperuser: false,
      dateJoined: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return userId;
  },
});

/**
 * Join a user to a community (internal, no auth check).
 * Replicates communities.join logic but without requiring a token.
 */
export const joinCommunityInternal = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Check if already a member
    const existing = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", args.userId).eq("communityId", args.communityId)
      )
      .first();

    if (existing) {
      if (existing.status !== 1) {
        // Reactivate
        await ctx.db.patch(existing._id, {
          status: 1,
          updatedAt: timestamp,
        });
      }
      // If already active, still ensure announcement group membership below
    } else {
      // Create new membership
      await ctx.db.insert("userCommunities", {
        communityId: args.communityId,
        userId: args.userId,
        roles: 1, // MEMBER
        status: 1, // Active
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    // Add to announcement group (handles defensive creation)
    let announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    if (!announcementGroup) {
      // Defensive creation
      const community = await ctx.db.get(args.communityId);
      const communityName = community?.name || "Community";

      // Get or create announcements group type
      let groupType = await ctx.db
        .query("groupTypes")
        .withIndex("by_community_slug", (q: any) =>
          q.eq("communityId", args.communityId).eq("slug", "announcements")
        )
        .first();

      if (!groupType) {
        const groupTypeId = await ctx.db.insert("groupTypes", {
          communityId: args.communityId,
          name: "Announcements",
          slug: "announcements",
          description: "Community announcements",
          isActive: true,
          displayOrder: 0,
          createdAt: timestamp,
        });
        groupType = await ctx.db.get(groupTypeId);
      }

      const announcementGroupId = await ctx.db.insert("groups", {
        communityId: args.communityId,
        groupTypeId: groupType!._id,
        name: `${communityName} Announcements`,
        description: "Official community announcements",
        isAnnouncementGroup: true,
        isPublic: true,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      announcementGroup = await ctx.db.get(announcementGroupId);
    }

    const groupRole = "member"; // Landing page users are always members

    // Check existing membership in announcement group
    const existingGroupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", announcementGroup!._id).eq("userId", args.userId)
      )
      .first();

    if (existingGroupMembership) {
      if (existingGroupMembership.leftAt) {
        // Rejoin
        await ctx.db.patch(existingGroupMembership._id, {
          leftAt: undefined,
          role: groupRole,
          joinedAt: timestamp,
        });
        await syncUserChannelMembershipsLogic(ctx, args.userId, announcementGroup!._id);
      }
    } else {
      // Create new group membership
      await ctx.db.insert("groupMembers", {
        groupId: announcementGroup!._id,
        userId: args.userId,
        role: groupRole,
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      await syncUserChannelMembershipsLogic(ctx, args.userId, announcementGroup!._id);
    }
  },
});

/**
 * Set custom field values on announcement group follow-up record,
 * generate notes summary, and run automation rules.
 */
export const setCustomFieldsAndNotes = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    customFields: v.array(
      v.object({
        slot: v.optional(v.string()),
        label: v.string(),
        value: v.any(),
      })
    ),
    generateNoteSummary: v.boolean(),
    automationRules: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        isEnabled: v.boolean(),
        condition: v.object({
          field: v.string(),
          operator: v.string(),
          value: v.optional(v.string()),
        }),
        action: v.object({
          type: v.string(),
          assigneePhone: v.optional(v.string()),
          assigneeUserId: v.optional(v.id("users")),
        }),
      })
    ),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Find announcement group
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    if (!announcementGroup) return;

    // Find group membership
    const groupMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", announcementGroup._id).eq("userId", args.userId)
      )
      .first();

    if (!groupMember) return;

    // Find or create memberFollowupScores record
    let scoreDoc = await ctx.db
      .query("memberFollowupScores")
      .withIndex("by_groupMember", (q) => q.eq("groupMemberId", groupMember._id))
      .first();

    // Get user info for denormalized fields
    const user = await ctx.db.get(args.userId);

    if (!scoreDoc) {
      // Create minimal score doc
      const scoreDocId = await ctx.db.insert("memberFollowupScores", {
        groupId: announcementGroup._id,
        groupMemberId: groupMember._id,
        userId: args.userId,
        firstName: user?.firstName || "",
        lastName: user?.lastName,
        avatarUrl: user?.profilePhoto,
        email: user?.email,
        phone: user?.phone,
        score1: 0,
        score2: 0,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 0,
        connectionScore: 0,
        followupScore: 0,
        missedMeetings: 0,
        consecutiveMissed: 0,
        scoreIds: ["default_attendance", "default_connection"],
        searchText: [
          user?.firstName,
          user?.lastName,
          user?.email,
          user?.phone,
        ].filter(Boolean).join(" ").toLowerCase(),
        updatedAt: timestamp,
        addedAt: groupMember.joinedAt ?? timestamp,
      });
      scoreDoc = await ctx.db.get(scoreDocId);
    }

    if (!scoreDoc) return;

    // Set custom field values for fields with slots
    const customFieldUpdates: Record<string, any> = {};
    for (const field of args.customFields) {
      if (field.slot && VALID_CUSTOM_SLOTS.has(field.slot)) {
        customFieldUpdates[field.slot] = field.value;
      }
    }

    if (Object.keys(customFieldUpdates).length > 0) {
      customFieldUpdates.updatedAt = timestamp;
      await ctx.db.patch(scoreDoc._id, customFieldUpdates);
    }

    // Generate notes summary
    if (args.generateNoteSummary) {
      const date = new Date(timestamp);
      const dateStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      const lines = [`Landing Page Submission (${dateStr})`];
      for (const field of args.customFields) {
        const displayValue =
          typeof field.value === "boolean"
            ? field.value ? "Yes" : "No"
            : String(field.value ?? "");
        if (displayValue) {
          lines.push(`${field.label}: ${displayValue}`);
        }
      }

      const noteContent = lines.join("\n");

      await ctx.db.insert("memberFollowups", {
        groupMemberId: groupMember._id,
        createdById: args.userId, // Self-submitted
        type: "note",
        content: noteContent,
        createdAt: timestamp,
      });

      // Update latest note on score doc
      await ctx.db.patch(scoreDoc._id, {
        latestNote: noteContent,
        latestNoteAt: timestamp,
      });
    }

    // Run automation rules
    for (const rule of args.automationRules) {
      if (!rule.isEnabled) continue;

      const conditionMet = evaluateCondition(rule.condition, args.customFields);

      if (conditionMet && rule.action.type === "set_assignee") {
        let assigneeId = rule.action.assigneeUserId;

        // Look up assignee by phone if no direct ID
        if (!assigneeId && rule.action.assigneePhone) {
          const normalized = normalizePhone(rule.action.assigneePhone);
          const assignee = await ctx.db
            .query("users")
            .withIndex("by_phone", (q) => q.eq("phone", normalized))
            .first();
          if (assignee) {
            assigneeId = assignee._id;
          }
        }

        if (assigneeId) {
          await ctx.db.patch(scoreDoc._id, {
            assigneeId,
            updatedAt: timestamp,
          });
        }
      }
    }
  },
});

/**
 * Evaluate a condition against submitted custom field values.
 */
function evaluateCondition(
  condition: {
    field: string;
    operator: string;
    value?: string;
  },
  customFields: Array<{ slot?: string; label: string; value: any }>
): boolean {
  const field = customFields.find(
    (f) => f.slot === condition.field || f.label === condition.field
  );

  if (!field) return false;

  const fieldValue = field.value;

  switch (condition.operator) {
    case "equals":
      return String(fieldValue) === condition.value;
    case "not_equals":
      return String(fieldValue) !== condition.value;
    case "contains":
      return String(fieldValue).toLowerCase().includes((condition.value || "").toLowerCase());
    case "is_true":
      return fieldValue === true;
    case "is_false":
      return fieldValue === false || fieldValue === undefined || fieldValue === null;
    default:
      return false;
  }
}

// ============================================================================
// Admin Queries (auth required)
// ============================================================================

/**
 * Get landing page config for admin editing.
 */
export const getConfig = query({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);

    const community = await ctx.db.get(args.communityId);

    const landingPage = await ctx.db
      .query("communityLandingPages")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();

    return {
      community: {
        slug: community?.slug,
        name: community?.name,
      },
      config: landingPage,
    };
  },
});

// ============================================================================
// Admin Mutations (auth required)
// ============================================================================

/**
 * Save landing page config. Upserts the communityLandingPages record.
 * Also syncs followupColumnConfig on the announcement group for field visibility.
 */
export const saveConfig = mutation({
  args: {
    token: v.string(),
    communityId: v.id("communities"),
    isEnabled: v.boolean(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    submitButtonText: v.optional(v.string()),
    successMessage: v.optional(v.string()),
    generateNoteSummary: v.optional(v.boolean()),
    formFields: v.array(
      v.object({
        slot: v.optional(v.string()),
        label: v.string(),
        type: v.string(),
        options: v.optional(v.array(v.string())),
        required: v.boolean(),
        order: v.number(),
        includeInNotes: v.optional(v.boolean()),
      })
    ),
    automationRules: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        isEnabled: v.boolean(),
        condition: v.object({
          field: v.string(),
          operator: v.string(),
          value: v.optional(v.string()),
        }),
        action: v.object({
          type: v.string(),
          assigneePhone: v.optional(v.string()),
          assigneeUserId: v.optional(v.id("users")),
        }),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    const timestamp = Date.now();

    // Validate form field slots
    for (const field of args.formFields) {
      if (field.slot && !VALID_CUSTOM_SLOTS.has(field.slot)) {
        throw new Error(`Invalid custom field slot: ${field.slot}`);
      }
    }

    // Check for duplicate slots
    const usedSlots = new Set<string>();
    for (const field of args.formFields) {
      if (field.slot) {
        if (usedSlots.has(field.slot)) {
          throw new Error(`Duplicate slot: ${field.slot}`);
        }
        usedSlots.add(field.slot);
      }
    }

    // Upsert landing page config
    const existing = await ctx.db
      .query("communityLandingPages")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .first();

    const data = {
      communityId: args.communityId,
      isEnabled: args.isEnabled,
      title: args.title,
      description: args.description,
      submitButtonText: args.submitButtonText,
      successMessage: args.successMessage,
      generateNoteSummary: args.generateNoteSummary,
      formFields: args.formFields,
      automationRules: args.automationRules,
      updatedAt: timestamp,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("communityLandingPages", {
        ...data,
        createdAt: timestamp,
      });
    }

    // Sync followupColumnConfig on announcement group so fields are visible in follow-up tool
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    if (announcementGroup) {
      const existingConfig = announcementGroup.followupColumnConfig;
      const existingCustomFields = existingConfig?.customFields || [];

      // Build custom fields from form fields that have slots
      const landingPageSlots = new Set(
        args.formFields.filter((f) => f.slot).map((f) => f.slot!)
      );

      // Merge: keep existing custom fields not from landing page, add landing page ones
      const mergedCustomFields = [
        ...existingCustomFields.filter((f: any) => !landingPageSlots.has(f.slot)),
        ...args.formFields
          .filter((f) => f.slot)
          .map((f) => ({
            slot: f.slot!,
            name: f.label,
            type: f.type,
            ...(f.options ? { options: f.options } : {}),
          })),
      ];

      await ctx.db.patch(announcementGroup._id, {
        followupColumnConfig: {
          columnOrder: existingConfig?.columnOrder || [],
          hiddenColumns: existingConfig?.hiddenColumns || [],
          customFields: mergedCustomFields,
        },
        updatedAt: timestamp,
      });
    }

    return { success: true };
  },
});
