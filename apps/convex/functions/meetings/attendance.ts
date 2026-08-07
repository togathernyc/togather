/**
 * Meeting Attendance functions
 *
 * Functions for tracking meeting attendance, guests, and self-reporting.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id, Doc } from "../../_generated/dataModel";
import { now } from "../../lib/utils";
import { requireAuth, getOptionalAuth } from "../../lib/auth";
import { canEditMeeting } from "../../lib/meetingPermissions";
import {
  audienceOf,
  audienceDenialMessage,
  canAccessMeeting,
} from "../../lib/meetingAudience";

// ============================================================================
// Attendance Management
// ============================================================================

/**
 * Get attendance for a meeting
 *
 * Attendance joins the full user doc (name, email, phone) and is only for the
 * people managing the event, so it is gated by `canEditMeeting` — the same rule
 * the mutations and the check-in roster enforce. Without this gate any
 * authenticated client could read a meeting's attendee PII by meetingId.
 */
export const listAttendance = query({
  args: { token: v.string(), meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can view attendance"
      );
    }

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
 * Whether the current user is allowed to manage attendance / check-in for a
 * meeting (event creator, group leaders, or community admins — same rule as
 * editing the event). Used to gate the Check-in screen and its entry point so
 * the UI reflects the exact permission the mutations enforce server-side.
 */
export const canManageAttendance = query({
  args: { token: v.string(), meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return false;

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) return false;

    return await canEditMeeting(ctx, userId, meeting);
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

    // Marking attendance for someone else is a host action (ADR-022):
    // event creator, group leaders, and community admins are all allowed.
    if (args.userId !== recordedById) {
      if (!(await canEditMeeting(ctx, recordedById, meeting))) {
        throw new Error(
          "Only the event creator, group leaders, or community admins can mark attendance for others"
        );
      }
    }

    // Check for existing record
    const existing = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", args.userId)
      )
      .first();

    let resultId: Id<"meetingAttendances">;
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        recordedById,
        recordedAt: timestamp,
      });
      resultId = existing._id;
    } else {
      resultId = await ctx.db.insert("meetingAttendances", {
        meetingId: args.meetingId,
        userId: args.userId,
        status: args.status,
        recordedById,
        recordedAt: timestamp,
      });
    }

    // Recompute followup scores after attendance change
    const groupMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", meeting.groupId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (groupMember) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeSingleMemberScore,
        { groupId: meeting.groupId, groupMemberId: groupMember._id }
      );
    }

    // Recompute community scores after attendance change
    await ctx.scheduler.runAfter(
      0,
      internal.functions.communityScoreComputation.recomputeForGroupMember,
      { groupId: meeting.groupId, userId: args.userId }
    );

    return resultId;
  },
});

/**
 * Add guest to a meeting
 *
 * Covers both walk-ins (nobody's plus-one) and a member's guests — pass
 * `hostUserId` for the latter so the check-in screen can nest them under the
 * member who brought them. A guest row is one attending person either way, so
 * headcount stats need no special-casing.
 */
export const addGuest = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    hostUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const recordedById = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Get the meeting so we can check permissions.
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Adding a guest is a host action (ADR-022): event creator, group
    // leaders, and community admins can add to the list. Mirrors the check
    // already guarding removeGuest / updateGuest.
    if (!(await canEditMeeting(ctx, recordedById, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can add guests"
      );
    }

    return await ctx.db.insert("meetingGuests", {
      meetingId: args.meetingId,
      firstName: args.firstName,
      lastName: args.lastName,
      phoneNumber: args.phoneNumber,
      notes: args.notes,
      hostUserId: args.hostUserId,
      recordedById,
      recordedAt: timestamp,
    });
  },
});

/**
 * List guests for a meeting
 *
 * Guest rows carry walk-in PII (`phoneNumber`, `notes`), so this read is gated
 * by `canEditMeeting` — the same rule that guards adding/removing guests.
 * Without the gate any authenticated client could read a meeting's walk-in
 * phone numbers by meetingId.
 */
export const listGuests = query({
  args: { token: v.string(), meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can view guests"
      );
    }

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

    // Managing guests is a host action (ADR-022): event creator, group
    // leaders, and community admins can trim the list.
    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can remove guests"
      );
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

    // Editing guests is a host action (ADR-022): creator, leaders, admins.
    if (!(await canEditMeeting(ctx, userId, meeting))) {
      throw new Error(
        "Only the event creator, group leaders, or community admins can update guests"
      );
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

    // Audience gate — identical rule to what the event lists render.
    if (!(await canAccessMeeting(ctx, audienceOf(meeting), userId))) {
      throw new Error(audienceDenialMessage(meeting, "attend"));
    }

    // Check for existing attendance record
    const existing = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", userId)
      )
      .first();

    let resultId: Id<"meetingAttendances">;
    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        status: args.status,
        recordedAt: timestamp,
        recordedById: userId, // Self-reported
      });
      resultId = existing._id;
    } else {
      // Create new attendance record
      resultId = await ctx.db.insert("meetingAttendances", {
        meetingId: args.meetingId,
        userId,
        status: args.status,
        recordedAt: timestamp,
        recordedById: userId, // Self-reported
      });
    }

    // Recompute followup scores after attendance change
    const groupMember = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", meeting.groupId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (groupMember) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.followupScoreComputation.computeSingleMemberScore,
        { groupId: meeting.groupId, groupMemberId: groupMember._id }
      );
    }

    // Recompute community scores after attendance change
    await ctx.scheduler.runAfter(
      0,
      internal.functions.communityScoreComputation.recomputeForGroupMember,
      { groupId: meeting.groupId, userId }
    );

    return resultId;
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

    let resultId: Id<"meetingAttendances">;
    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        status: args.status,
        recordedAt: timestamp,
        recordedById: tokenRecord.userId, // Self-reported via token
      });
      resultId = existing._id;
    } else {
      // Create new attendance record
      resultId = await ctx.db.insert("meetingAttendances", {
        meetingId: tokenRecord.meetingId,
        userId: tokenRecord.userId,
        status: args.status,
        recordedAt: timestamp,
        recordedById: tokenRecord.userId, // Self-reported via token
      });
    }

    // Recompute followup scores after attendance change
    const meeting = await ctx.db.get(tokenRecord.meetingId);
    if (meeting) {
      const groupMember = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", meeting.groupId))
        .filter((q) => q.eq(q.field("userId"), tokenRecord.userId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .first();
      if (groupMember) {
        await ctx.scheduler.runAfter(
          0,
          internal.functions.followupScoreComputation.computeSingleMemberScore,
          { groupId: meeting.groupId, groupMemberId: groupMember._id }
        );
      }

      // Recompute community scores after attendance change
      await ctx.scheduler.runAfter(
        0,
        internal.functions.communityScoreComputation.recomputeForGroupMember,
        { groupId: meeting.groupId, userId: tokenRecord.userId }
      );
    }

    return resultId;
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
