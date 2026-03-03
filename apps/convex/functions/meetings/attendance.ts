/**
 * Meeting Attendance functions
 *
 * Functions for tracking meeting attendance, guests, and self-reporting.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";
import { now } from "../../lib/utils";
import { requireAuth, getOptionalAuth } from "../../lib/auth";

// ============================================================================
// Attendance Management
// ============================================================================

/**
 * Get attendance for a meeting
 */
export const listAttendance = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const attendance = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    // Collect all unique user IDs (both userId and recordedById)
    const allUserIds = new Set<Id<"users">>();
    for (const record of attendance) {
      allUserIds.add(record.userId);
      if (record.recordedById) {
        allUserIds.add(record.recordedById);
      }
    }

    // Batch fetch all users at once
    const userIdArray = [...allUserIds];
    const users = await Promise.all(userIdArray.map((id) => ctx.db.get(id)));
    const usersMap = new Map<Id<"users">, Doc<"users">>(
      users.filter((u): u is Doc<"users"> => u !== null).map((u) => [u._id, u])
    );

    // Map attendance records with users from pre-fetched data
    const withUsers = attendance.map((record) => ({
      ...record,
      user: usersMap.get(record.userId) ?? null,
      recordedBy: record.recordedById
        ? usersMap.get(record.recordedById) ?? null
        : null,
    }));

    return withUsers;
  },
});

/**
 * Mark attendance for a member
 *
 * Only leaders can mark attendance for others.
 * Members can only mark their own attendance.
 */
export const markAttendance = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    userId: v.id("users"), // The user whose attendance is being recorded
    status: v.number(), // Attendance status code
  },
  handler: async (ctx, args) => {
    const recordedById = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Get the meeting to find the group
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // If marking attendance for someone else, verify leader/admin role
    if (args.userId !== recordedById) {
      const recorderMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", meeting.groupId).eq("userId", recordedById)
        )
        .first();

      // Must be an active leader or admin to mark others' attendance
      if (
        !recorderMembership ||
        recorderMembership.leftAt ||
        !["leader", "admin"].includes(recorderMembership.role)
      ) {
        throw new Error("Only leaders can mark attendance for others");
      }
    }

    // Check for existing record
    const existing = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", args.userId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        recordedById,
        recordedAt: timestamp,
      });
      return existing._id;
    }

    return await ctx.db.insert("meetingAttendances", {
      meetingId: args.meetingId,
      userId: args.userId,
      status: args.status,
      recordedById,
      recordedAt: timestamp,
    });
  },
});

/**
 * Add guest to a meeting
 */
export const addGuest = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const recordedById = await requireAuth(ctx, args.token);
    const timestamp = now();

    return await ctx.db.insert("meetingGuests", {
      meetingId: args.meetingId,
      firstName: args.firstName,
      lastName: args.lastName,
      phoneNumber: args.phoneNumber,
      notes: args.notes,
      recordedById,
      recordedAt: timestamp,
    });
  },
});

/**
 * List guests for a meeting
 */
export const listGuests = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("meetingGuests")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();
  },
});

/**
 * Remove a guest from a meeting
 * FIX for Issue #303: Added ability to remove guests
 *
 * Only leaders can remove guests.
 */
export const removeGuest = mutation({
  args: {
    token: v.string(),
    guestId: v.id("meetingGuests"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the guest record
    const guest = await ctx.db.get(args.guestId);
    if (!guest) {
      throw new Error("Guest not found");
    }

    // Get the meeting to find the group
    const meeting = await ctx.db.get(guest.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Verify user is a leader or admin of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();

    if (
      !membership ||
      membership.leftAt ||
      !["leader", "admin"].includes(membership.role)
    ) {
      throw new Error("Only leaders can remove guests");
    }

    // Delete the guest record
    await ctx.db.delete(args.guestId);
    return { success: true };
  },
});

/**
 * Update a guest's information
 * FIX for Issue #303: Added ability to edit guests
 *
 * Only leaders can update guests.
 */
export const updateGuest = mutation({
  args: {
    token: v.string(),
    guestId: v.id("meetingGuests"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Get the guest record
    const guest = await ctx.db.get(args.guestId);
    if (!guest) {
      throw new Error("Guest not found");
    }

    // Get the meeting to find the group
    const meeting = await ctx.db.get(guest.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Verify user is a leader or admin of the group
    const membership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", userId)
      )
      .first();

    if (
      !membership ||
      membership.leftAt ||
      !["leader", "admin"].includes(membership.role)
    ) {
      throw new Error("Only leaders can update guests");
    }

    // Build update object with only provided fields
    const updates: Partial<{
      firstName: string;
      lastName: string;
      phoneNumber: string;
      notes: string;
    }> = {};

    if (args.firstName !== undefined) updates.firstName = args.firstName;
    if (args.lastName !== undefined) updates.lastName = args.lastName;
    if (args.phoneNumber !== undefined) updates.phoneNumber = args.phoneNumber;
    if (args.notes !== undefined) updates.notes = args.notes;

    // Update the guest record
    await ctx.db.patch(args.guestId, updates);
    return await ctx.db.get(args.guestId);
  },
});

// ============================================================================
// Attendance Self-Reporting
// ============================================================================

/**
 * Validate an attendance confirmation token (from email links)
 *
 * Returns token validity, meeting info, and whether already confirmed
 */
export const validateAttendanceToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token) {
      return { valid: false, error: "No token provided" };
    }

    // Look up the token
    const tokenRecord = await ctx.db
      .query("attendanceConfirmationTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!tokenRecord) {
      return { valid: false, error: "Invalid token" };
    }

    // Check if expired
    if (tokenRecord.expiresAt < now()) {
      return { valid: false, error: "This link has expired" };
    }

    // Check if already used
    if (tokenRecord.usedAt) {
      return { valid: false, error: "This link has already been used" };
    }

    // Get meeting info
    const meeting = await ctx.db.get(tokenRecord.meetingId);
    if (!meeting) {
      return { valid: false, error: "Meeting not found" };
    }

    // Get group info
    const group = await ctx.db.get(meeting.groupId);

    // Check if user already has attendance recorded
    const existingAttendance = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", tokenRecord.meetingId).eq("userId", tokenRecord.userId)
      )
      .first();

    return {
      valid: true,
      alreadyConfirmed: !!existingAttendance,
      existingStatus: existingAttendance?.status ?? null,
      meeting: {
        id: meeting._id,
        title: meeting.title || "Event",
        scheduledAt: new Date(meeting.scheduledAt).toISOString(),
        groupName: group?.name || "Group",
      },
    };
  },
});

/**
 * Self-report attendance (authenticated user)
 *
 * Allows an authenticated user to report their own attendance.
 * Checks membership based on meeting visibility:
 * - Group-only events: user must be a group member
 * - Community-wide events: user must be a community member
 * - Public events: any authenticated user can report
 */
export const selfReportAttendance = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    status: v.number(), // 1 = attended, 0 = did not attend
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Get the meeting to check visibility
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Check visibility-based membership
    const visibility = meeting.visibility || "group";

    if (visibility === "group") {
      // For group-only events, user must be an active member of the group
      const groupMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", meeting.groupId).eq("userId", userId)
        )
        .first();

      if (
        !groupMembership ||
        groupMembership.leftAt ||
        (groupMembership.requestStatus &&
          groupMembership.requestStatus !== "accepted")
      ) {
        throw new Error("You must be a group member to attend this event");
      }
    } else if (visibility === "community") {
      // For community-wide events, user must be a member of the community
      const group = await ctx.db.get(meeting.groupId);
      if (!group) {
        throw new Error("Group not found");
      }

      const communityMembership = await ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", userId).eq("communityId", group.communityId)
        )
        .first();

      if (!communityMembership) {
        throw new Error("You must be a community member to attend this event");
      }
    }
    // For public events, any authenticated user can report (no additional check needed)

    // Check for existing attendance record
    const existing = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", userId)
      )
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        status: args.status,
        recordedAt: timestamp,
        recordedById: userId, // Self-reported
      });
      return existing._id;
    }

    // Create new attendance record
    return await ctx.db.insert("meetingAttendances", {
      meetingId: args.meetingId,
      userId,
      status: args.status,
      recordedAt: timestamp,
      recordedById: userId, // Self-reported
    });
  },
});

/**
 * Confirm attendance with token (unauthenticated - from email link)
 *
 * Validates the token and records attendance for the associated user.
 */
export const confirmAttendanceWithToken = mutation({
  args: {
    token: v.string(),
    status: v.number(), // 1 = attended, 0 = did not attend
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Look up the token
    const tokenRecord = await ctx.db
      .query("attendanceConfirmationTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!tokenRecord) {
      throw new Error("Invalid token");
    }

    // Check if expired
    if (tokenRecord.expiresAt < timestamp) {
      throw new Error("This link has expired");
    }

    // Check if already used
    if (tokenRecord.usedAt) {
      throw new Error("This link has already been used");
    }

    // Mark token as used
    await ctx.db.patch(tokenRecord._id, { usedAt: timestamp });

    // Check for existing attendance record
    const existing = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", tokenRecord.meetingId).eq("userId", tokenRecord.userId)
      )
      .first();

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        status: args.status,
        recordedAt: timestamp,
        recordedById: tokenRecord.userId, // Self-reported via token
      });
      return existing._id;
    }

    // Create new attendance record
    return await ctx.db.insert("meetingAttendances", {
      meetingId: tokenRecord.meetingId,
      userId: tokenRecord.userId,
      status: args.status,
      recordedAt: timestamp,
      recordedById: tokenRecord.userId, // Self-reported via token
    });
  },
});

/**
 * Get the current user's attendance for a meeting
 */
export const getMyAttendance = query({
  args: { token: v.optional(v.string()), meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return null;

    return await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", userId)
      )
      .first();
  },
});
