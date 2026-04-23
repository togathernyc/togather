/**
 * Meeting RSVP functions
 *
 * Handles RSVP operations for meetings:
 * - Submit RSVP (upsert user's response)
 * - Remove RSVP (delete user's response)
 * - List RSVPs (get all responses grouped by option)
 * - Get current user's RSVP
 */

import { v } from "convex/values";
import { query, mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { now, getMediaUrl } from "../lib/utils";
import { requireAuth, getOptionalAuth } from "../lib/auth";
import { PAST_EVENT_BUFFER_MS } from "../lib/meetingConfig";
import {
  getMaxGuestsForMeeting,
  isGoingOption,
  normalizeGuestCount,
} from "../lib/rsvpGuests";

/**
 * RSVP option type (stored in meeting.rsvpOptions field)
 */
interface RsvpOption {
  id: number;
  label: string;
  enabled: boolean;
}

// ============================================================================
// RSVP Queries
// ============================================================================

/**
 * Get current user's RSVP for a meeting
 */
export const myRsvp = query({
  args: {
    token: v.optional(v.string()),
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return { optionId: null };

    const rsvp = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", userId)
      )
      .first();

    return {
      optionId: rsvp ? rsvp.rsvpOptionId : null,
      guestCount: rsvp?.guestCount ?? 0,
    };
  },
});

/**
 * List all RSVPs for a meeting, grouped by option
 *
 * Access control:
 * - Unauthenticated users: returns limited access response (counts + first 10 users per option for preview)
 * - Authenticated users who have NOT RSVPed: returns limited access response (counts + first 10 users per option for preview)
 * - Authenticated users who have RSVPed: returns full list with all user details
 */
export const list = query({
  args: {
    meetingId: v.id("meetings"),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get optional authentication - allows both authenticated and unauthenticated access
    const userId = await getOptionalAuth(ctx, args.token);

    // Fetch meeting to get RSVP options
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Fetch RSVPs for this meeting with safety limit
    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .take(500); // Safety limit to prevent unbounded queries

    // Check if authenticated user has RSVPed
    let userRsvp = null;
    if (userId) {
      userRsvp = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_meeting_user", (q) =>
          q.eq("meetingId", args.meetingId).eq("userId", userId)
        )
        .first();
    }

    // If user is NOT authenticated OR has NOT RSVPed, return limited access response
    if (!userId || !userRsvp) {
      // Get RSVP options from meeting
      const rsvpOptions = (meeting.rsvpOptions as RsvpOption[] | null) || [];

      // Fetch limited user details (first 10 per option) for preview
      const limitedRsvps = rsvps.slice(0, 50); // Limit total RSVPs to fetch
      const userIds = limitedRsvps.map((r) => r.userId);
      const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

      // Build userId -> user map for O(1) lookup
      const userMap = new Map<string, typeof users[0]>();
      users.forEach((user, i) => {
        if (user) {
          userMap.set(userIds[i], user);
        }
      });

      // Map RSVPs with limited user details
      const rsvpsWithLimitedUsers = limitedRsvps.map((rsvp) => {
        const user = userMap.get(rsvp.userId);
        return {
          ...rsvp,
          user: user
            ? {
                id: user._id,
                firstName: user.firstName || "",
                lastName: user.lastName || "",
                profileImage: getMediaUrl(user.profilePhoto),
              }
            : null,
        };
      });

      // Return counts and limited user preview (first 10 per option)
      const groupedRsvps = rsvpOptions.map((option) => {
        const optionRsvps = rsvpsWithLimitedUsers.filter(
          (rsvp) => rsvp.rsvpOptionId === option.id
        );
        const allOptionRsvps = rsvps.filter((rsvp) => rsvp.rsvpOptionId === option.id);
        const guestCount = allOptionRsvps.reduce(
          (sum, r) => sum + (r.guestCount ?? 0),
          0
        );

        return {
          option: {
            id: option.id,
            label: option.label,
            enabled: option.enabled,
          },
          count: allOptionRsvps.length,
          guestCount,
          users: optionRsvps
            .slice(0, 10) // First 10 users per option for preview
            .filter((r) => r.user !== null)
            .map((rsvp) => ({
              ...rsvp.user!,
              guestCount: rsvp.guestCount ?? 0,
            })),
        };
      });

      const totalGuests = rsvps.reduce((sum, r) => sum + (r.guestCount ?? 0), 0);

      return {
        rsvps: groupedRsvps,
        total: rsvps.length,
        totalWithGuests: rsvps.length + totalGuests,
        limitedAccess: true,
      };
    }

    // User has RSVPed - return full list
    // Batch fetch all users upfront
    const userIds = rsvps.map((r) => r.userId);
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));

    // Build userId -> user map for O(1) lookup
    const userMap = new Map<string, typeof users[0]>();
    users.forEach((user, i) => {
      if (user) {
        userMap.set(userIds[i], user);
      }
    });

    // Map RSVPs with user details
    const rsvpsWithUsers = rsvps.map((rsvp) => {
      const user = userMap.get(rsvp.userId);
      return {
        ...rsvp,
        user: user
          ? {
              id: user._id,
              firstName: user.firstName || "",
              lastName: user.lastName || "",
              profileImage: getMediaUrl(user.profilePhoto),
            }
          : null,
      };
    });

    // Get RSVP options from meeting
    const rsvpOptions = (meeting.rsvpOptions as RsvpOption[] | null) || [];

    // Group RSVPs by option
    const groupedRsvps = rsvpOptions.map((option) => {
      const optionRsvps = rsvpsWithUsers.filter(
        (rsvp) => rsvp.rsvpOptionId === option.id
      );
      const guestCount = optionRsvps.reduce(
        (sum, r) => sum + (r.guestCount ?? 0),
        0
      );

      return {
        option: {
          id: option.id,
          label: option.label,
          enabled: option.enabled,
        },
        count: optionRsvps.length,
        guestCount,
        users: optionRsvps
          .filter((r) => r.user !== null)
          .map((rsvp) => ({
            ...rsvp.user!,
            guestCount: rsvp.guestCount ?? 0,
          })),
      };
    });

    const totalGuests = rsvps.reduce((sum, r) => sum + (r.guestCount ?? 0), 0);

    return {
      rsvps: groupedRsvps,
      total: rsvps.length,
      totalWithGuests: rsvps.length + totalGuests,
    };
  },
});

/**
 * Get meetings the current user has RSVP'd to
 *
 * Returns meetings with the user's RSVP and group info.
 * Can optionally include past meetings.
 */
export const myRsvpEvents = query({
  args: {
    token: v.optional(v.string()),
    includePast: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    if (!userId) return [];

    // Get user's RSVPs with safety limit
    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(200); // Safety limit

    const currentTime = now();

    // Batch fetch all meetings upfront
    const meetingIds = rsvps.map((r) => r.meetingId);
    const meetings = await Promise.all(meetingIds.map((id) => ctx.db.get(id)));

    // Build meetingId -> meeting map for O(1) lookup
    const meetingMap = new Map<string, typeof meetings[0]>();
    meetings.forEach((meeting, i) => {
      if (meeting) {
        meetingMap.set(meetingIds[i], meeting);
      }
    });

    // Collect unique group IDs from valid meetings
    const groupIdSet = new Set<Id<"groups">>();
    for (const meeting of meetings) {
      if (
        meeting &&
        meeting.status !== "cancelled" &&
        (args.includePast || meeting.scheduledAt >= currentTime)
      ) {
        groupIdSet.add(meeting.groupId);
      }
    }
    const groupIds = Array.from(groupIdSet);

    // Batch fetch all groups upfront
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));

    // Build groupId -> group map for O(1) lookup
    type GroupDoc = NonNullable<typeof groups[0]>;
    const groupMap = new Map<string, GroupDoc>();
    groups.forEach((group, i) => {
      if (group) {
        groupMap.set(groupIds[i], group);
      }
    });

    // Map RSVPs to meeting details
    const meetingsWithRsvps = rsvps.map((r) => {
      const meeting = meetingMap.get(r.meetingId);
      if (!meeting) return null;

      // Skip past meetings unless includePast is true
      if (!args.includePast && meeting.scheduledAt < currentTime) return null;

      // Skip cancelled meetings
      if (meeting.status === "cancelled") return null;

      const group = groupMap.get(meeting.groupId);

      return {
        ...meeting,
        group,
        myRsvp: {
          optionId: r.rsvpOptionId,
          guestCount: r.guestCount ?? 0,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        },
      };
    });

    // Filter out nulls and sort by scheduledAt
    const validMeetings = meetingsWithRsvps.filter(Boolean);
    validMeetings.sort((a, b) => a!.scheduledAt - b!.scheduledAt);

    return validMeetings;
  },
});

/**
 * Get RSVP counts by option for a meeting
 */
export const getCounts = query({
  args: { meetingId: v.id("meetings") },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    const rsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .collect();

    const rsvpOptions = (meeting.rsvpOptions as RsvpOption[] | null) || [];

    const counts = rsvpOptions.reduce(
      (acc, option) => {
        acc[option.id] = rsvps.filter((r) => r.rsvpOptionId === option.id).length;
        return acc;
      },
      {} as Record<number, number>
    );

    return {
      total: rsvps.length,
      byOption: counts,
    };
  },
});

// ============================================================================
// RSVP Mutations
// ============================================================================

/**
 * Submit or update user's RSVP
 */
export const submit = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
    optionId: v.number(),
    guestCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);
    const timestamp = now();

    // Fetch meeting to validate option
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    // Check if RSVP is enabled
    if (meeting.rsvpEnabled === false) {
      throw new Error("RSVP is not enabled for this event");
    }

    // Check if meeting is cancelled
    if (meeting.status === "cancelled") {
      throw new Error("Cannot RSVP to cancelled event");
    }

    // Check if meeting is past its grace window. Late arrivals can still RSVP
    // for PAST_EVENT_BUFFER_MS after start.
    if (meeting.scheduledAt < timestamp - PAST_EVENT_BUFFER_MS) {
      throw new Error("Cannot RSVP to past event");
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
        throw new Error("You must be a group member to RSVP to this event");
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
        throw new Error("You must be a community member to RSVP to this event");
      }
    }
    // For public events, anyone authenticated can RSVP (no additional check needed)

    // Validate the option exists and is enabled
    const rsvpOptions = (meeting.rsvpOptions as RsvpOption[] | null) || [];
    const selectedOption = rsvpOptions.find((opt) => opt.id === args.optionId);

    if (!selectedOption) {
      throw new Error("Invalid RSVP option");
    }

    if (!selectedOption.enabled) {
      throw new Error("RSVP option is disabled");
    }

    const maxGuests = getMaxGuestsForMeeting(meeting);

    // Check for existing RSVP
    const existing = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", userId)
      )
      .first();

    // Resolve the guestCount to persist, preserving plus-ones for
    // legacy callers that don't pass guestCount at all.
    //
    // Rules:
    // - Explicit guestCount (any value, including 0): normalize + use it.
    //   This covers the new plus-one flows in EventPageClient and
    //   EventLinkCard, and explicit clears.
    // - Undefined guestCount + same option as before + Going:
    //   preserve the existing guestCount so older call sites (e.g.
    //   rsvp/confirm.tsx, rsvp/verify.tsx, leader-tools EventDetails)
    //   don't silently wipe the user's plus-ones when they re-submit.
    // - Undefined guestCount + different option (or not Going):
    //   clear to 0, since guests are only valid on the Going option.
    let guestCount: number;
    if (args.guestCount !== undefined) {
      guestCount = normalizeGuestCount(args.guestCount, selectedOption, maxGuests);
    } else if (
      existing &&
      existing.rsvpOptionId === args.optionId &&
      isGoingOption(selectedOption)
    ) {
      guestCount = existing.guestCount ?? 0;
    } else {
      guestCount = 0;
    }

    if (existing) {
      const previousOptionId = existing.rsvpOptionId;
      // Update existing RSVP
      await ctx.db.patch(existing._id, {
        rsvpOptionId: args.optionId,
        guestCount,
        updatedAt: timestamp,
      });

      // Notify leaders when RSVP changes (different option).
      // We intentionally don't re-notify on guestCount-only changes.
      if (previousOptionId !== args.optionId) {
        await ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyRsvpReceived, {
          meetingId: args.meetingId,
          userId,
          rsvpOptionLabel: selectedOption.label,
        });
      }

      return {
        success: true,
        optionId: args.optionId,
        guestCount,
      };
    }

    // Create new RSVP
    await ctx.db.insert("meetingRsvps", {
      meetingId: args.meetingId,
      userId,
      rsvpOptionId: args.optionId,
      guestCount,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Notify group leaders of the new RSVP
    await ctx.scheduler.runAfter(0, internal.functions.notifications.senders.notifyRsvpReceived, {
      meetingId: args.meetingId,
      userId,
      rsvpOptionLabel: selectedOption.label,
    });

    return {
      success: true,
      optionId: args.optionId,
      guestCount,
    };
  },
});

/**
 * Remove user's RSVP
 */
export const remove = mutation({
  args: {
    token: v.string(),
    meetingId: v.id("meetings"),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx, args.token);

    // Find and delete user's RSVP
    const rsvp = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting_user", (q) =>
        q.eq("meetingId", args.meetingId).eq("userId", userId)
      )
      .first();

    if (rsvp) {
      await ctx.db.delete(rsvp._id);
    }

    return { success: true };
  },
});

/**
 * Batch update RSVPs (for bulk operations)
 */
export const batchUpdate = mutation({
  args: {
    meetingId: v.id("meetings"),
    rsvps: v.array(
      v.object({
        userId: v.id("users"),
        optionId: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const timestamp = now();

    // Fetch meeting to validate options
    const meeting = await ctx.db.get(args.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }

    const rsvpOptions = (meeting.rsvpOptions as RsvpOption[] | null) || [];
    const validOptionIds = new Set(
      rsvpOptions.filter((o) => o.enabled).map((o) => o.id)
    );

    // Batch fetch all existing RSVPs for this meeting upfront
    const existingRsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
      .take(500); // Safety limit

    // Build userId -> existing RSVP map for O(1) lookup
    const existingRsvpMap = new Map<string, typeof existingRsvps[0]>();
    for (const rsvp of existingRsvps) {
      existingRsvpMap.set(rsvp.userId, rsvp);
    }

    for (const rsvpUpdate of args.rsvps) {
      if (!validOptionIds.has(rsvpUpdate.optionId)) {
        continue; // Skip invalid options
      }

      const existing = existingRsvpMap.get(rsvpUpdate.userId);

      if (existing) {
        await ctx.db.patch(existing._id, {
          rsvpOptionId: rsvpUpdate.optionId,
          updatedAt: timestamp,
        });
      } else {
        await ctx.db.insert("meetingRsvps", {
          meetingId: args.meetingId,
          userId: rsvpUpdate.userId,
          rsvpOptionId: rsvpUpdate.optionId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }

    return { success: true };
  },
});

