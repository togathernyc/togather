/**
 * Shared validators for Convex functions
 *
 * These validators can be reused across multiple function definitions
 * to ensure consistent validation.
 */

import { v } from "convex/values";

// ============================================================================
// Common validators
// ============================================================================

/**
 * Pagination arguments validator
 */
export const paginationArgs = {
  cursor: v.optional(v.string()),
  limit: v.optional(v.number()),
};

/**
 * Standard response with pagination
 */
export const paginatedResponse = <T extends Parameters<typeof v.array>[0]>(itemValidator: T) => ({
  items: v.array(itemValidator),
  nextCursor: v.optional(v.string()),
  hasMore: v.boolean(),
});

// ============================================================================
// User validators
// ============================================================================

export const userRoleValidator = v.union(
  v.literal("admin"),
  v.literal("leader"),
  v.literal("member")
);

export const memberStatusValidator = v.union(
  v.literal("active"),
  v.literal("pending"),
  v.literal("inactive")
);

// ============================================================================
// Group validators
// ============================================================================

export const groupRoleValidator = v.union(
  v.literal("leader"),
  v.literal("member")
);

// ============================================================================
// Meeting validators
// ============================================================================

export const meetingStatusValidator = v.union(
  v.literal("scheduled"),
  v.literal("cancelled"),
  v.literal("completed")
);

export const rsvpStatusValidator = v.union(
  v.literal("attending"),
  v.literal("maybe"),
  v.literal("not_attending"),
  v.literal("pending")
);

export const attendanceStatusValidator = v.union(
  v.literal("present"),
  v.literal("absent"),
  v.literal("late")
);

// ============================================================================
// Chat validators
// ============================================================================

export const channelTypeValidator = v.union(
  v.literal("group_main"),
  v.literal("group_leaders"),
  v.literal("direct")
);

// ============================================================================
// Platform validators
// ============================================================================

export const platformValidator = v.union(
  v.literal("ios"),
  v.literal("android"),
  v.literal("web")
);

// ============================================================================
// Notification validators
// ============================================================================

export const notificationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("sent"),
  v.literal("failed")
);

export const notificationChannelValidator = v.union(
  v.literal("push"),
  v.literal("email"),
  v.literal("sms"),
  v.literal("chat")
);

export const environmentValidator = v.union(
  v.literal("staging"),
  v.literal("production")
);

// ============================================================================
// Join request validators
// ============================================================================

export const joinRequestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("declined")
);

// ============================================================================
// Group creation request validators
// ============================================================================

export const creationRequestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined")
);

// ============================================================================
// Follow-up validators
// ============================================================================

export const followupTypeValidator = v.union(
  v.literal("note"),
  v.literal("call"),
  v.literal("text"),
  v.literal("snooze"),
  v.literal("followed_up")
);

export const snoozeDurationValidator = v.union(
  v.literal("1_week"),
  v.literal("2_weeks"),
  v.literal("1_month"),
  v.literal("3_months")
);

export const followupSortByValidator = v.union(
  v.literal("connection"),
  v.literal("attendance")
);

// ============================================================================
// Bot validators
// ============================================================================

export const botTriggerTypeValidator = v.union(
  v.literal("cron"),
  v.literal("event")
);

// ============================================================================
// Meeting visibility validators
// ============================================================================

export const meetingVisibilityValidator = v.union(
  v.literal("group"),
  v.literal("community"),
  v.literal("public")
);
