/**
 * Internal functions backing the public HTTP API (see http.ts).
 *
 * These are `internal*` functions — never callable directly by clients. The
 * HTTP action in http.ts authenticates the request via an API key, then calls
 * these to verify the key and read aggregated attendance data.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { now } from "../lib/utils";

// Attendance status code that means "attended" (see meetings/attendance.ts).
const ATTENDED_STATUS = 1;

// Standard RSVP option ids (see meetings.rsvpOptions defaults).
const RSVP_GOING = 1;
const RSVP_NOT_GOING = 2;
const RSVP_MAYBE = 3;

// Default and maximum number of events returned in a single call. Callers
// should page through history with the `since`/`until` filters.
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
// Hard cap on meetings scanned so a filtered query can't read unbounded rows.
const MAX_SCAN = 5000;

/**
 * Verify an API key by its hash and record usage.
 *
 * Looks the key up by hash, rejects revoked keys, stamps `lastUsedAt`, and
 * returns the owning community id. Returns null when the key is unknown or
 * revoked. A mutation (not a query) because it writes `lastUsedAt`.
 */
export const verifyApiKey = internalMutation({
  args: { keyHash: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .first();

    if (!key || key.revokedAt) {
      return null;
    }

    await ctx.db.patch(key._id, { lastUsedAt: now() });

    return { communityId: key.communityId };
  },
});

/**
 * Aggregate attendance for every group in a community.
 *
 * Returns one entry per event (meeting) with attendance, guest, and RSVP
 * counts — no personal information. Events are returned most-recent first.
 *
 * Filters:
 * - since/until: bound `scheduledAt` (Unix ms).
 * - groupTypeSlug: limit to one group type (e.g. "dinner-parties").
 * - status: limit to one meeting status ("scheduled" | "completed" | "cancelled").
 * - limit: cap the number of events (default 200, max 1000).
 */
export const getCommunityAttendanceAggregate = internalQuery({
  args: {
    communityId: v.id("communities"),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    groupTypeSlug: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const community = await ctx.db.get(args.communityId);
    if (!community) {
      throw new Error("Community not found");
    }

    const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Pre-fetch groups and group types so each event can be labeled and
    // filtered without per-meeting lookups.
    const [groups, groupTypes] = await Promise.all([
      ctx.db
        .query("groups")
        .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
        .collect(),
      ctx.db
        .query("groupTypes")
        .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
        .collect(),
    ]);
    const groupMap = new Map<Id<"groups">, Doc<"groups">>(
      groups.map((g) => [g._id, g])
    );
    const groupTypeMap = new Map<Id<"groupTypes">, Doc<"groupTypes">>(
      groupTypes.map((gt) => [gt._id, gt])
    );

    // Resolve the optional group-type filter to an id up front.
    let filterGroupTypeId: Id<"groupTypes"> | undefined;
    if (args.groupTypeSlug) {
      const match = groupTypes.find((gt) => gt.slug === args.groupTypeSlug);
      if (!match) {
        // Unknown type -> no events match.
        return buildResponse(community, [], limit, false);
      }
      filterGroupTypeId = match._id;
    }

    // Walk meetings newest-first via the community/scheduledAt index, stopping
    // once we've collected `limit` matches or scanned the safety cap.
    const matched: Doc<"meetings">[] = [];
    let scanned = 0;
    const iterator = ctx.db
      .query("meetings")
      .withIndex("by_community_scheduledAt", (q) => {
        const base = q.eq("communityId", args.communityId);
        if (args.since !== undefined && args.until !== undefined) {
          return base.gte("scheduledAt", args.since).lte("scheduledAt", args.until);
        }
        if (args.since !== undefined) {
          return base.gte("scheduledAt", args.since);
        }
        if (args.until !== undefined) {
          return base.lte("scheduledAt", args.until);
        }
        return base;
      })
      .order("desc");

    for await (const meeting of iterator) {
      if (scanned >= MAX_SCAN) break;
      scanned++;

      if (args.status && meeting.status !== args.status) continue;

      const group = groupMap.get(meeting.groupId);
      if (filterGroupTypeId && group?.groupTypeId !== filterGroupTypeId) {
        continue;
      }

      matched.push(meeting);
      if (matched.length >= limit) break;
    }

    // hasMore is true if there could be additional matching events beyond what
    // we returned (i.e. we stopped because we hit the limit, not exhaustion).
    const hasMore = matched.length >= limit;

    // Aggregate counts per matched event.
    const events = await Promise.all(
      matched.map(async (meeting) => {
        const [attendances, guests, rsvps] = await Promise.all([
          ctx.db
            .query("meetingAttendances")
            .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
            .collect(),
          ctx.db
            .query("meetingGuests")
            .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
            .collect(),
          ctx.db
            .query("meetingRsvps")
            .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
            .collect(),
        ]);

        const attended = attendances.filter(
          (a) => a.status === ATTENDED_STATUS
        ).length;

        let going = 0;
        let notGoing = 0;
        let maybe = 0;
        let goingGuests = 0;
        for (const rsvp of rsvps) {
          if (rsvp.rsvpOptionId === RSVP_GOING) {
            going++;
            goingGuests += rsvp.guestCount ?? 0;
          } else if (rsvp.rsvpOptionId === RSVP_NOT_GOING) {
            notGoing++;
          } else if (rsvp.rsvpOptionId === RSVP_MAYBE) {
            maybe++;
          }
        }

        const group = groupMap.get(meeting.groupId);
        const groupType = group?.groupTypeId
          ? groupTypeMap.get(group.groupTypeId)
          : undefined;

        return {
          id: meeting._id,
          title: meeting.title ?? null,
          scheduledAt: new Date(meeting.scheduledAt).toISOString(),
          status: meeting.status,
          group: {
            id: meeting.groupId,
            name: group?.name ?? null,
            groupType: groupType?.name ?? null,
            groupTypeSlug: groupType?.slug ?? null,
          },
          attendance: {
            attended,
            guests: guests.length,
            rsvps: {
              going,
              notGoing,
              maybe,
              guestsExpected: goingGuests,
            },
          },
        };
      })
    );

    return buildResponse(community, events, limit, hasMore);
  },
});

function buildResponse(
  community: Doc<"communities">,
  events: unknown[],
  limit: number,
  hasMore: boolean
) {
  return {
    community: {
      id: community._id,
      name: community.name ?? null,
      subdomain: community.subdomain ?? null,
    },
    generatedAt: new Date(now()).toISOString(),
    limit,
    hasMore,
    events,
  };
}
