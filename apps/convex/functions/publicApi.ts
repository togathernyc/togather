/**
 * Internal functions backing the public HTTP API (see http.ts).
 *
 * These are `internal*` functions — never callable directly by clients. The
 * HTTP action in http.ts authenticates the request via an API key, then calls
 * these to verify the key and read aggregated attendance data.
 */

import { v } from "convex/values";
import { internalQuery, internalMutation, QueryCtx } from "../_generated/server";
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

// ============================================================================
// Shared helpers
// ============================================================================

interface MeetingCounts {
  attended: number;
  guests: number;
  going: number;
  notGoing: number;
  maybe: number;
  guestsExpected: number;
}

/**
 * Count attendance, guests, and RSVPs for a single meeting.
 * Shared by the per-event and summary aggregations.
 */
async function countMeeting(
  ctx: QueryCtx,
  meetingId: Id<"meetings">
): Promise<MeetingCounts> {
  const [attendances, guests, rsvps] = await Promise.all([
    ctx.db
      .query("meetingAttendances")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect(),
    ctx.db
      .query("meetingGuests")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect(),
    ctx.db
      .query("meetingRsvps")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect(),
  ]);

  const attended = attendances.filter((a) => a.status === ATTENDED_STATUS).length;

  let going = 0;
  let notGoing = 0;
  let maybe = 0;
  let guestsExpected = 0;
  for (const rsvp of rsvps) {
    if (rsvp.rsvpOptionId === RSVP_GOING) {
      going++;
      guestsExpected += rsvp.guestCount ?? 0;
    } else if (rsvp.rsvpOptionId === RSVP_NOT_GOING) {
      notGoing++;
    } else if (rsvp.rsvpOptionId === RSVP_MAYBE) {
      maybe++;
    }
  }

  return { attended, guests: guests.length, going, notGoing, maybe, guestsExpected };
}

/** Pre-fetch a community's groups and group types into lookup maps. */
async function loadCommunityGroups(ctx: QueryCtx, communityId: Id<"communities">) {
  const [groups, groupTypes] = await Promise.all([
    ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect(),
    ctx.db
      .query("groupTypes")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect(),
  ]);
  return {
    groupTypes,
    groupMap: new Map<Id<"groups">, Doc<"groups">>(groups.map((g) => [g._id, g])),
    groupTypeMap: new Map<Id<"groupTypes">, Doc<"groupTypes">>(
      groupTypes.map((gt) => [gt._id, gt])
    ),
  };
}

/** A community's meetings ordered newest-first, optionally bounded by date. */
function meetingsByCommunityDesc(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  since?: number,
  until?: number
) {
  return ctx.db
    .query("meetings")
    .withIndex("by_community_scheduledAt", (q) => {
      const base = q.eq("communityId", communityId);
      if (since !== undefined && until !== undefined) {
        return base.gte("scheduledAt", since).lte("scheduledAt", until);
      }
      if (since !== undefined) {
        return base.gte("scheduledAt", since);
      }
      if (until !== undefined) {
        return base.lte("scheduledAt", until);
      }
      return base;
    })
    .order("desc");
}

/** Validate an IANA time zone, falling back to UTC if unsupported/missing. */
function resolveTimeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    // Throws RangeError for an invalid/unsupported zone.
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * Format a timestamp as a YYYY-MM-DD calendar date in the given (already
 * validated) time zone. en-CA's locale formats as YYYY-MM-DD.
 */
function localDateString(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function communityRef(community: Doc<"communities">) {
  return {
    id: community._id,
    name: community.name ?? null,
    subdomain: community.subdomain ?? null,
  };
}

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

    const { groupTypes, groupMap, groupTypeMap } = await loadCommunityGroups(
      ctx,
      args.communityId
    );

    // Resolve the optional group-type filter to an id up front.
    let filterGroupTypeId: Id<"groupTypes"> | undefined;
    if (args.groupTypeSlug) {
      const match = groupTypes.find((gt) => gt.slug === args.groupTypeSlug);
      if (!match) {
        // Unknown type -> no events match.
        return {
          community: communityRef(community),
          generatedAt: new Date(now()).toISOString(),
          limit,
          hasMore: false,
          events: [],
        };
      }
      filterGroupTypeId = match._id;
    }

    // Walk meetings newest-first, stopping once we've collected `limit` matches
    // or scanned the safety cap.
    const matched: Doc<"meetings">[] = [];
    let scanned = 0;
    let hitScanCap = false;
    for await (const meeting of meetingsByCommunityDesc(
      ctx,
      args.communityId,
      args.since,
      args.until
    )) {
      if (scanned >= MAX_SCAN) {
        hitScanCap = true;
        break;
      }
      scanned++;

      if (args.status && meeting.status !== args.status) continue;

      const group = groupMap.get(meeting.groupId);
      if (filterGroupTypeId && group?.groupTypeId !== filterGroupTypeId) {
        continue;
      }

      matched.push(meeting);
      if (matched.length >= limit) break;
    }

    // hasMore tells the caller more matching events may exist than were returned.
    // Two cases trigger it:
    // - we filled the page (matched.length >= limit), or
    // - we stopped at the scan cap before exhausting the timeline. The cap
    //   matters with selective status/groupType filters: many newer
    //   non-matching events can use up the scan budget before `limit` matches
    //   accumulate, leaving older matching events unseen. Without this, a
    //   filtered export could return partial/empty results with hasMore:false.
    // Callers page by narrowing the since/until window.
    const hasMore = matched.length >= limit || hitScanCap;

    const events = await Promise.all(
      matched.map(async (meeting) => {
        const counts = await countMeeting(ctx, meeting._id);
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
            attended: counts.attended,
            guests: counts.guests,
            rsvps: {
              going: counts.going,
              notGoing: counts.notGoing,
              maybe: counts.maybe,
              guestsExpected: counts.guestsExpected,
            },
          },
        };
      })
    );

    return {
      community: communityRef(community),
      generatedAt: new Date(now()).toISOString(),
      limit,
      hasMore,
      events,
    };
  },
});

/**
 * Per-group, per-day attendance rollup for a community.
 *
 * A lighter-weight companion to getCommunityAttendanceAggregate: instead of one
 * row per event, it returns one row per (group, calendar day) with summed
 * counts — ideal for dashboards/charts that don't need event-level detail.
 *
 * Dates are bucketed by the community's time zone (falling back to UTC), so an
 * evening event lands on its local calendar date. Rows are newest-day-first.
 *
 * Filters mirror the detailed endpoint (since/until/groupTypeSlug/status).
 * There is no `limit`: response size is bounded by the date window and the
 * number of groups. `truncated` is true if the internal scan cap was hit before
 * the timeline was exhausted (narrow the window to get complete buckets).
 */
export const getCommunityAttendanceSummary = internalQuery({
  args: {
    communityId: v.id("communities"),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    groupTypeSlug: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const community = await ctx.db.get(args.communityId);
    if (!community) {
      throw new Error("Community not found");
    }

    const timeZone = resolveTimeZone(community.timezone);
    const { groupTypes, groupMap, groupTypeMap } = await loadCommunityGroups(
      ctx,
      args.communityId
    );

    let filterGroupTypeId: Id<"groupTypes"> | undefined;
    if (args.groupTypeSlug) {
      const match = groupTypes.find((gt) => gt.slug === args.groupTypeSlug);
      if (!match) {
        return {
          community: communityRef(community),
          generatedAt: new Date(now()).toISOString(),
          timezone: timeZone,
          bucket: "day" as const,
          truncated: false,
          summary: [],
        };
      }
      filterGroupTypeId = match._id;
    }

    // Collect matching meetings (bounded by the scan cap), then count in
    // parallel — same read pattern as the detailed endpoint.
    const matched: Doc<"meetings">[] = [];
    let scanned = 0;
    let truncated = false;
    for await (const meeting of meetingsByCommunityDesc(
      ctx,
      args.communityId,
      args.since,
      args.until
    )) {
      if (scanned >= MAX_SCAN) {
        truncated = true;
        break;
      }
      scanned++;

      if (args.status && meeting.status !== args.status) continue;

      const group = groupMap.get(meeting.groupId);
      if (filterGroupTypeId && group?.groupTypeId !== filterGroupTypeId) {
        continue;
      }

      matched.push(meeting);
    }

    const counts = await Promise.all(
      matched.map((meeting) => countMeeting(ctx, meeting._id))
    );

    // Roll up into one bucket per (group, local calendar day).
    interface SummaryRow {
      groupId: Id<"groups">;
      groupName: string | null;
      groupType: string | null;
      groupTypeSlug: string | null;
      date: string;
      events: number;
      attended: number;
      guests: number;
      rsvps: { going: number; notGoing: number; maybe: number; guestsExpected: number };
    }
    const buckets = new Map<string, SummaryRow>();

    matched.forEach((meeting, i) => {
      const c = counts[i];
      const date = localDateString(meeting.scheduledAt, timeZone);
      const key = `${meeting.groupId}|${date}`;

      let row = buckets.get(key);
      if (!row) {
        const group = groupMap.get(meeting.groupId);
        const groupType = group?.groupTypeId
          ? groupTypeMap.get(group.groupTypeId)
          : undefined;
        row = {
          groupId: meeting.groupId,
          groupName: group?.name ?? null,
          groupType: groupType?.name ?? null,
          groupTypeSlug: groupType?.slug ?? null,
          date,
          events: 0,
          attended: 0,
          guests: 0,
          rsvps: { going: 0, notGoing: 0, maybe: 0, guestsExpected: 0 },
        };
        buckets.set(key, row);
      }

      row.events += 1;
      row.attended += c.attended;
      row.guests += c.guests;
      row.rsvps.going += c.going;
      row.rsvps.notGoing += c.notGoing;
      row.rsvps.maybe += c.maybe;
      row.rsvps.guestsExpected += c.guestsExpected;
    });

    // Newest day first, then group name.
    const summary = [...buckets.values()].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (a.groupName ?? "").localeCompare(b.groupName ?? "");
    });

    return {
      community: communityRef(community),
      generatedAt: new Date(now()).toISOString(),
      timezone: timeZone,
      bucket: "day" as const,
      truncated,
      summary,
    };
  },
});
