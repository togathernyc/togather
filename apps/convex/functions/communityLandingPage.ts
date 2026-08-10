/**
 * Community Landing Page — Queries & Mutations
 *
 * Public web form at /c/[slug] that digitizes the "gold card" —
 * newcomers fill out name, phone, email, and community-configured custom fields.
 *
 * This file contains queries and mutations.
 * The submitForm action lives in communityLandingPageActions.ts.
 */

import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { requireCommunityAdmin, isCommunityAdmin } from "../lib/permissions";
import { VALID_CUSTOM_SLOTS } from "../lib/followupConstants";
import { normalizePhone, buildSearchText, now } from "../lib/utils";
import { syncUserChannelMembershipsLogic } from "./sync/memberships";
import { ensureChannelsForGroupLogic } from "./messaging/channels";
import { checkRateLimit, RateLimitExceededError } from "../lib/rateLimit";
import { parseDateOptional } from "../lib/validation";

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
    try {
      let community = await ctx.db
        .query("communities")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug))
        .first();

      // Fallback to subdomain lookup (legacy communities may only have subdomain set)
      if (!community) {
        community = await ctx.db
          .query("communities")
          .withIndex("by_subdomain", (q) => q.eq("subdomain", args.slug))
          .first();
      }

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
        requireZipCode: landingPage.requireZipCode ?? false,
        requireBirthday: landingPage.requireBirthday ?? false,
        formFields: landingPage.formFields,
      };
    } catch (e: any) {
      console.error("getBySlug error:", e.message, e.stack);
      throw e;
    }
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
    let community = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!community) {
      community = await ctx.db
        .query("communities")
        .withIndex("by_subdomain", (q) => q.eq("subdomain", args.slug))
        .first();
    }

    if (!community) return null;

    const landingPage = await ctx.db
      .query("communityLandingPages")
      .withIndex("by_community", (q) => q.eq("communityId", community._id))
      .first();

    if (!landingPage || !landingPage.isEnabled) return null;

    return { community, landingPage };
  },
});

/**
 * Whether `userId` is an admin of the community that owns the landing page at
 * `slug`. Used by the extractFormFromImage action to gate the OCR autofill
 * (an OpenAI-billed call) to community admins only.
 */
export const isAdminForSlugInternal = internalQuery({
  args: { slug: v.string(), userId: v.id("users") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    let community = await ctx.db
      .query("communities")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!community) {
      community = await ctx.db
        .query("communities")
        .withIndex("by_subdomain", (q) => q.eq("subdomain", args.slug))
        .first();
    }

    if (!community) return false;
    return await isCommunityAdmin(ctx, community._id, args.userId);
  },
});

// ============================================================================
// Internal Mutations (used by submitForm action)
// ============================================================================

/**
 * Rate limit form submissions by phone number.
 * Allows 5 submissions per hour to prevent spam.
 */
export const checkFormRateLimit = internalMutation({
  args: { phone: v.string() },
  handler: async (ctx, args) => {
    const normalizedPhone = normalizePhone(args.phone);
    const rateLimitKey = `landing_form:${normalizedPhone}`;
    const ONE_HOUR_MS = 60 * 60 * 1000;
    await checkRateLimit(ctx, rateLimitKey, 5, ONE_HOUR_MS);
  },
});

/**
 * Atomically check the per-phone SMS daily cap and (if allowed) schedule
 * the outbound SMS-with-audit action. Doing the cap check and the schedule
 * in one mutation prevents the quota from being burned when the schedule
 * step never lands — which would silently suppress future legitimate
 * auto-replies to the same recipient.
 *
 * Returns:
 *   - "scheduled": within cap, dispatch action is queued; that action will
 *     write the real outcome (sent/send_failed) to the audit note
 *   - "suppressed_cap": cap hit, nothing queued; caller writes the audit
 *
 * The form submission itself is already capped at 5/hour by phone, but the
 * tighter 2/24h SMS cap stops repeat submissions from spamming the same
 * recipient with auto-replies.
 */
export const dispatchAutoReplySmsIfAllowed = internalMutation({
  args: {
    phone: v.string(),
    message: v.string(),
    followupNoteId: v.union(v.id("memberFollowups"), v.null()),
  },
  returns: v.union(v.literal("scheduled"), v.literal("suppressed_cap")),
  handler: async (ctx, args): Promise<"scheduled" | "suppressed_cap"> => {
    const normalizedPhone = normalizePhone(args.phone);
    const rateLimitKey = `landing_sms:${normalizedPhone}`;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    try {
      await checkRateLimit(ctx, rateLimitKey, 2, ONE_DAY_MS);
    } catch (err) {
      // Only translate true cap-reached signals into "suppressed_cap".
      // Re-throw anything else (DB errors, etc.) so the caller's outer
      // try/catch logs the operational failure instead of misreporting
      // it as a daily-cap hit.
      if (err instanceof RateLimitExceededError) {
        return "suppressed_cap";
      }
      throw err;
    }
    await ctx.scheduler.runAfter(
      0,
      internal.functions.communityLandingPageActions.sendAutoReplySmsAndAudit,
      {
        phone: args.phone,
        message: args.message,
        followupNoteId: args.followupNoteId,
      },
    );
    return "scheduled";
  },
});

/**
 * Append an audit trail to the landing-page submission note describing
 * the auto-reply SMS outcome. Called once the SMS attempt resolves so
 * staff reviewing follow-ups see exactly what the submitter received
 * (or didn't, and why).
 *
 * Outcomes:
 *   - "sent": include the rendered body so staff can reproduce what was texted
 *   - "suppressed_cap": the per-phone daily SMS cap was hit; SMS not sent
 *   - "send_failed": the Twilio dispatch errored — body still recorded so
 *     staff know what the recipient missed and can follow up manually
 */
export const recordSmsAuditOnNote = internalMutation({
  args: {
    noteId: v.id("memberFollowups"),
    outcome: v.union(
      v.literal("sent"),
      v.literal("suppressed_cap"),
      v.literal("send_failed"),
    ),
    body: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) return null;

    let block: string;
    switch (args.outcome) {
      case "sent":
        block = `\n\n---\nAuto-Reply SMS sent:\n${args.body ?? ""}`;
        break;
      case "suppressed_cap":
        block = `\n\n---\nAuto-Reply SMS suppressed: this phone has already received 2 auto-replies in the last 24 hours.`;
        break;
      case "send_failed":
        block = `\n\n---\nAuto-Reply SMS FAILED to send${args.error ? ` (${args.error})` : ""}. The recipient did not receive this message:\n${args.body ?? ""}`;
        break;
    }

    const updatedContent = `${note.content}${block}`;
    await ctx.db.patch(args.noteId, { content: updatedContent });

    // Mirror to latest-note denormalization on the score doc, if any
    const groupMember = await ctx.db.get(note.groupMemberId);
    if (groupMember) {
      const scoreDoc = await ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) =>
          q.eq("groupMemberId", note.groupMemberId),
        )
        .first();
      if (scoreDoc && scoreDoc.latestNoteAt === note.createdAt) {
        await ctx.db.patch(scoreDoc._id, { latestNote: updatedContent });
      }
    }
    return null;
  },
});

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
    zipCode: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedPhone = normalizePhone(args.phone);
    const timestamp = now();
    const dobTimestamp = parseDateOptional(args.dateOfBirth || undefined, "dateOfBirth");

    // Check if user exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", normalizedPhone))
      .first();

    if (existing) {
      // Update name/email/zipCode/dateOfBirth if user doesn't have them yet
      const updates: Record<string, any> = {};
      if (!existing.firstName && args.firstName) updates.firstName = args.firstName;
      if (!existing.lastName && args.lastName) updates.lastName = args.lastName;
      if (!existing.email && args.email) updates.email = args.email.toLowerCase();
      if (!existing.zipCode && args.zipCode) updates.zipCode = args.zipCode;
      if (!existing.dateOfBirth && dobTimestamp) updates.dateOfBirth = dobTimestamp;
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
      zipCode: args.zipCode || undefined,
      dateOfBirth: dobTimestamp,
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

    // A user becomes (or re-becomes) an active community member on either of
    // two paths: a brand-new insert, or reactivation of a previously inactive
    // membership. Both should trigger marketing sync — without the reactivation
    // case, someone who left and rejoined via the landing page would skip the
    // marketing destinations the other join paths handle.
    let membershipBecameActive = false;
    if (existing) {
      if (existing.status !== 1) {
        await ctx.db.patch(existing._id, {
          status: 1,
          updatedAt: timestamp,
        });
        membershipBecameActive = true;
      }
      // If already active, still ensure announcement group membership below
    } else {
      await ctx.db.insert("userCommunities", {
        communityId: args.communityId,
        userId: args.userId,
        roles: 1, // MEMBER
        status: 1, // Active
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      membershipBecameActive = true;
    }

    if (membershipBecameActive) {
      // Schedule marketing integration syncs (no-op if not connected)
      await ctx.scheduler.runAfter(
        0,
        internal.functions.marketing.clearstream.syncUser,
        { communityId: args.communityId, userId: args.userId },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.functions.marketing.flodesk.syncUser,
        { communityId: args.communityId, userId: args.userId },
      );
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
        name: communityName,
        description: "Official community announcements",
        isAnnouncementGroup: true,
        isPublic: true,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      // Create general + leaders channels for the announcement group
      await ensureChannelsForGroupLogic(ctx, announcementGroupId, args.userId, communityName);

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

    // Link any placeholder workflow tasks addressed to this user (by phone
    // or email). Covers landing-page signup flow which bypasses communities.join.
    await ctx.scheduler.runAfter(
      0,
      internal.functions.tasks.index.linkPlaceholderTasksForUser,
      { userId: args.userId },
    );
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
        includeInNotes: v.optional(v.boolean()),
      })
    ),
    zipCode: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
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
          snippet: v.optional(v.string()),
        }),
      })
    ),
  },
  returns: v.object({
    smsSnippets: v.array(v.string()),
    followupNoteId: v.union(v.id("memberFollowups"), v.null()),
  }),
  handler: async (ctx, args): Promise<{
    smsSnippets: string[];
    followupNoteId: Id<"memberFollowups"> | null;
  }> => {
    const timestamp = now();

    // Find announcement group
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    if (!announcementGroup) return { smsSnippets: [], followupNoteId: null };

    // Find group membership
    const groupMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", announcementGroup._id).eq("userId", args.userId)
      )
      .first();

    if (!groupMember) return { smsSnippets: [], followupNoteId: null };

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
        zipCode: user?.zipCode,
        dateOfBirth: user?.dateOfBirth,
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

    if (!scoreDoc) return { smsSnippets: [], followupNoteId: null };

    // Update denormalized zipCode/dateOfBirth on existing score docs
    const scoreUpdates: Record<string, any> = {};
    if (!scoreDoc.zipCode && user?.zipCode) scoreUpdates.zipCode = user.zipCode;
    if (!scoreDoc.dateOfBirth && user?.dateOfBirth) scoreUpdates.dateOfBirth = user.dateOfBirth;
    if (Object.keys(scoreUpdates).length > 0) {
      await ctx.db.patch(scoreDoc._id, scoreUpdates);
    }

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
    let followupNoteId: Id<"memberFollowups"> | null = null;
    if (args.generateNoteSummary) {
      const date = new Date(timestamp);
      const dateStr = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      const lines = [`Landing Page Submission (${dateStr})`];
      if (args.zipCode) {
        lines.push(`ZIP Code: ${args.zipCode}`);
      }
      if (args.dateOfBirth) {
        lines.push(`Birthday: ${args.dateOfBirth}`);
      }
      for (const field of args.customFields) {
        // Skip fields where includeInNotes is explicitly false
        if (field.includeInNotes === false) continue;

        const displayValue =
          typeof field.value === "boolean"
            ? field.value ? "Yes" : "No"
            : String(field.value ?? "");
        if (displayValue) {
          lines.push(`${field.label}: ${displayValue}`);
        }
      }

      const noteContent = lines.join("\n");

      followupNoteId = await ctx.db.insert("memberFollowups", {
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

    // Run automation rules.
    //   - set_assignee: first matching rule wins (preserves prior deterministic behavior)
    //   - append_sms: every matching rule contributes a snippet, in rule order
    let assigneeAssigned = false;
    const smsSnippets: string[] = [];

    for (const rule of args.automationRules) {
      if (!rule.isEnabled) continue;

      const conditionMet = evaluateCondition(rule.condition, args.customFields);
      if (!conditionMet) continue;

      if (rule.action.type === "set_assignee" && !assigneeAssigned) {
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

          // Notify the assignee about the auto-assignment
          await ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyFollowupAssigned, {
            assigneeId,
            groupId: announcementGroup._id,
            groupMemberId: groupMember._id,
          });

          assigneeAssigned = true;
        }
      } else if (rule.action.type === "append_sms") {
        const snippet = rule.action.snippet?.trim();
        if (snippet) smsSnippets.push(snippet);
      }
    }

    // Schedule communityPeople upsert so the People table is immediately
    // populated. This is the genuine public form submission, so reactivate the
    // person if they were previously archived (the leader-driven import /
    // quick-add callers deliberately do not pass this).
    await ctx.scheduler.runAfter(0, internal.functions.communityPeople.upsertFromSubmission, {
      communityId: args.communityId,
      userId: args.userId,
      reactivate: true,
    });

    return { smsSnippets, followupNoteId };
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
  customFields: Array<{ slot?: string; label: string; value: any; includeInNotes?: boolean }>
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
      if (condition.value === undefined || condition.value === "") return false;
      return String(fieldValue) !== condition.value;
    case "contains":
      if (condition.value === undefined || condition.value === "") return false;
      return String(fieldValue).toLowerCase().includes(condition.value.toLowerCase());
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

    // Fetch announcement group's custom fields for two-way sync
    const announcementGroup = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    const followupCustomFields =
      announcementGroup?.followupColumnConfig?.customFields ?? [];

    return {
      community: {
        slug: community?.slug,
        name: community?.name,
      },
      config: landingPage,
      followupCustomFields,
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
    requireZipCode: v.optional(v.boolean()),
    requireBirthday: v.optional(v.boolean()),
    formFields: v.array(
      v.object({
        slot: v.optional(v.string()),
        label: v.string(),
        type: v.string(),
        placeholder: v.optional(v.string()),
        options: v.optional(v.array(v.string())),
        buttonUrl: v.optional(v.string()),
        required: v.boolean(),
        order: v.number(),
        includeInNotes: v.optional(v.boolean()),
        showOnLanding: v.optional(v.boolean()),
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
          snippet: v.optional(v.string()),
        }),
      })
    ),
    autoReplySms: v.optional(
      v.object({
        enabled: v.boolean(),
        intro: v.string(),
        outro: v.string(),
        sendIfNoSnippetsMatch: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    await requireCommunityAdmin(ctx, args.communityId, userId);
    const timestamp = Date.now();

    // Validate automation rule actions
    for (const rule of args.automationRules) {
      if (rule.action.type === "append_sms") {
        if (!rule.action.snippet?.trim()) {
          throw new Error(
            `Rule "${rule.name}" needs a snippet to append to the auto-reply SMS`,
          );
        }
      } else if (rule.action.type === "set_assignee") {
        // Existing behavior: assigneePhone or assigneeUserId is checked at runtime;
        // saveConfig doesn't enforce so admins can stage rules before assignees exist
      } else {
        throw new Error(
          `Rule "${rule.name}" has unknown action type "${rule.action.type}"`,
        );
      }
    }

    // Validate auto-reply SMS template if enabled
    if (args.autoReplySms?.enabled) {
      const intro = args.autoReplySms.intro.trim();
      const outro = args.autoReplySms.outro.trim();
      if (!intro && !outro) {
        throw new Error(
          "Auto-reply SMS needs at least an intro or outro before it can be enabled",
        );
      }
      // Hard cap to keep auto-replies from blowing past Twilio's 1600-char limit
      // before we even append rule snippets. Snippets get capped at send time.
      if (intro.length + outro.length > 800) {
        throw new Error(
          "Auto-reply SMS intro + outro must be under 800 characters combined",
        );
      }
    }

    // Slot prefix to allowed types mapping
    const SLOT_PREFIX_TYPE: Record<string, string[]> = {
      customText: ["text", "dropdown", "multiselect"],
      customNum: ["number"],
      customBool: ["boolean"],
    };

    // Validate form field slots
    for (const field of args.formFields) {
      if (field.type === "section_header" || field.type === "subtitle" || field.type === "button") {
        if (field.type === "button") {
          if (field.slot) {
            throw new Error(`Button field "${field.label}" cannot map to a custom field slot`);
          }
          const url = field.buttonUrl?.trim();
          if (!url) {
            throw new Error(`Button field "${field.label}" requires a link URL`);
          }
          if (!/^https?:\/\/\S+$/i.test(url)) {
            throw new Error(`Button field "${field.label}" link must start with http:// or https://`);
          }
        }
        continue;
      }
      if (field.slot) {
        if (!VALID_CUSTOM_SLOTS.has(field.slot)) {
          throw new Error(`Invalid custom field slot: ${field.slot}`);
        }
        // Validate type matches slot prefix
        const prefix = field.slot.replace(/\d+$/, "");
        const allowedTypes = SLOT_PREFIX_TYPE[prefix];
        if (!allowedTypes || !allowedTypes.includes(field.type)) {
          throw new Error(`Slot ${field.slot} does not support type "${field.type}"`);
        }
      }
      if (field.type === "dropdown" || field.type === "multiselect") {
        const options = field.options?.map((opt) => opt.trim()).filter(Boolean) ?? [];
        if (options.length === 0) {
          throw new Error(`Field "${field.label}" requires at least one option`);
        }
        if (options.some((opt) => opt.includes(";"))) {
          throw new Error(`Field "${field.label}" options cannot contain semicolons`);
        }
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
      requireZipCode: args.requireZipCode,
      requireBirthday: args.requireBirthday,
      formFields: args.formFields,
      automationRules: args.automationRules,
      autoReplySms: args.autoReplySms,
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
            ...((f.options?.length ?? 0) > 0 ? { options: f.options } : {}),
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

    // Also sync to community-level peopleCustomFields for the People table
    const community = await ctx.db.get(args.communityId);
    if (community) {
      const existingPeopleFields = (community as any).peopleCustomFields ?? [];
      const peopleLandingSlots = new Set(
        args.formFields.filter((f) => f.slot).map((f) => f.slot!)
      );
      const mergedPeopleFields = [
        ...existingPeopleFields.filter((f: any) => !peopleLandingSlots.has(f.slot)),
        ...args.formFields
          .filter((f) => f.slot)
          .map((f) => ({
            slot: f.slot!,
            name: f.label,
            type: f.type,
            ...((f.options?.length ?? 0) > 0 ? { options: f.options } : {}),
          })),
      ];
      await ctx.db.patch(args.communityId, { peopleCustomFields: mergedPeopleFields });
    }

    return { success: true };
  },
});
