/**
 * Meeting Attendance functions
 *
 * Functions for tracking meeting attendance, guests, and self-reporting.
 */

import { v } from "convex/values";
import { query, mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id, Doc } from "../../_generated/dataModel";
import { now, getMediaUrl } from "../../lib/utils";
import { requireAuth, getOptionalAuth } from "../../lib/auth";
import { getMaxGuestsForMeeting, isGoingOption } from "../../lib/rsvpGuests";

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
    guestAttendedCount: v.optional(v.number()), // Plus-ones that actually showed up (leaders only)
  },
  handler: async (ctx, args) => {
    const recordedById = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Get the meeting to find the group
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Look up the recorder's group membership once — we may need it for
    // both the "marking someone else" check and the guest-count check.
    const recorderMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", meeting.groupId).eq("userId", recordedById)
      )
      .first();

    const recorderIsLeader =
      !!recorderMembership &&
      !recorderMembership.leftAt &&
      ["leader", "admin"].includes(recorderMembership.role);

    // If marking attendance for someone else, verify leader/admin role
    if (args.userId !== recordedById && !recorderIsLeader) {
      throw new Error("Only leaders can mark attendance for others");
    }

    // Validate guestAttendedCount (leader-only, capped at the meeting's max).
    // Members self-reporting (e.g. via email links) never touch guest counts.
    let guestAttendedCount: number | undefined;
    if (args.guestAttendedCount !== undefined) {
      if (!recorderIsLeader) {
        throw new Error("Only leaders can record guest attendance");
      }
      if (!Number.isInteger(args.guestAttendedCount) || args.guestAttendedCount < 0) {
        throw new Error("Guest attended count must be a non-negative integer");
      }
      const maxGuests = getMaxGuestsForMeeting(meeting);
      if (args.guestAttendedCount > maxGuests) {
        throw new Error(`Guest attended count cannot exceed ${maxGuests}`);
      }
      guestAttendedCount = args.guestAttendedCount;
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
        ...(guestAttendedCount !== undefined ? { guestAttendedCount } : {}),
      });
      resultId = existing._id;
    } else {
      resultId = await ctx.db.insert("meetingAttendances", {
        meetingId: args.meetingId,
        userId: args.userId,
        status: args.status,
        recordedById,
        recordedAt: timestamp,
        ...(guestAttendedCount !== undefined ? { guestAttendedCount } : {}),
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
 * Leader view: list RSVPs joined with attendance + guest counts.
 *
 * Returns one row per RSVP with the user's details, their RSVP option,
 * how many plus-ones they said they'd bring, and (if recorded) their
 * attendance status and how many of their guests actually showed up.
 *
 * Access: leader or admin of the event's group only.
 */
export const listAttendanceForLeader = query({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

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
      throw new Error("Only leaders can view attendance");
    }

    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .take(500);

    const attendanceRecords = await ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    const attendanceByUser = new Map<string, Doc<"meetingAttendances">>();
    for (const record of attendanceRecords) {
      attendanceByUser.set(record.userId, record);
    }

    // Batch fetch users
    const userIds = rsvps.map((r) => r.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const userMap = new Map<string, Doc<"users">>();
    users.forEach((u, i) => {
      if (u) userMap.set(userIds[i], u);
    });

    const rsvpOptions =
      (meeting.rsvpOptions as Array<{ id: number; label: string; enabled: boolean }> | null) ||
      [];

    const rows = rsvps.map((rsvp) => {
      const user = userMap.get(rsvp.userId);
      const attendance = attendanceByUser.get(rsvp.userId) ?? null;
      const option = rsvpOptions.find((opt) => opt.id === rsvp.rsvpOptionId) ?? null;
      return {
        rsvpId: rsvp._id,
        userId: rsvp.userId,
        user: user
          ? {
              id: user._id,
              firstName: user.firstName || "",
              lastName: user.lastName || "",
              profileImage: getMediaUrl(user.profilePhoto),
            }
          : null,
        rsvpOptionId: rsvp.rsvpOptionId,
        rsvpOptionLabel: option?.label ?? null,
        isGoing: isGoingOption(option),
        guestCount: rsvp.guestCount ?? 0,
        attendanceStatus: attendance?.status ?? null,
        guestAttendedCount: attendance?.guestAttendedCount ?? null,
        attendanceRecordedAt: attendance?.recordedAt ?? null,
      };
    });

    const totalGuests = rsvps.reduce((sum, r) => sum + (r.guestCount ?? 0), 0);
    const attendedRows = rows.filter((r) => r.attendanceStatus === 1);
    const attendedGuests = attendedRows.reduce(
      (sum, r) => sum + (r.guestAttendedCount ?? 0),
      0
    );
    const noShowCount = rows.filter((r) => r.attendanceStatus === 0).length;

    return {
      rows,
      maxGuestsPerRsvp: getMaxGuestsForMeeting(meeting),
      summary: {
        rsvpCount: rsvps.length,
        rsvpGuestCount: totalGuests,
        attendedCount: attendedRows.length,
        attendedGuestCount: attendedGuests,
        noShowCount,
        unmarkedCount: rows.length - attendedRows.length - noShowCount,
      },
    };
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
