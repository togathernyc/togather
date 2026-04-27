/**
 * Profile → My Events queries.
 *
 * ADR-022: the Profile → My Events surface has two segments — Hosted and
 * Attended — each with "upcoming" and "past" sections. Both return the same
 * grouped-CWE shape as `listForEventsTab` so the client renders events
 * identically across surfaces.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { Doc } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { isMeetingHost } from "../../lib/meetingPermissions";
import {
  buildBucket,
  buildEnrichment,
  EventCard,
  MeetingWithGroup,
} from "./events";

// Hosted/attended lists are capped so we don't accidentally turn the Profile
// page into an unbounded scan — covers the long tail but prevents pathological
// power users from dragging the query into a slow path.
const HOSTED_PAST_LIMIT = 50;
const HOSTED_UPCOMING_LIMIT = 50;
const ATTENDED_PAST_LIMIT = 50;
const ATTENDED_UPCOMING_LIMIT = 50;

async function withGroups(
  ctx: any,
  meetings: Doc<"meetings">[]
): Promise<MeetingWithGroup[]> {
  const groupIds = [...new Set(meetings.map((m) => m.groupId))];
  const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
  const groupMap = new Map(
    groups.filter(Boolean).map((g: any) => [g!._id, g!] as const)
  );
  return meetings
    .map((m) => {
      const group = groupMap.get(m.groupId);
      return group ? ({ ...m, group } as MeetingWithGroup) : null;
    })
    .filter((m): m is MeetingWithGroup => m !== null);
}

function splitByTime(
  meetings: MeetingWithGroup[],
  nowMs: number
): { upcoming: MeetingWithGroup[]; past: MeetingWithGroup[] } {
  const upcoming: MeetingWithGroup[] = [];
  const past: MeetingWithGroup[] = [];
  for (const m of meetings) {
    if (m.scheduledAt > nowMs) upcoming.push(m);
    else past.push(m);
  }
  upcoming.sort((a, b) => a.scheduledAt - b.scheduledAt);
  past.sort((a, b) => b.scheduledAt - a.scheduledAt); // newest-first per ADR-022
  return { upcoming, past };
}

/**
 * Events this user is hosting (in `hostUserIds`). Excludes cancelled. Split
 * into upcoming and past sections, both in the grouped-CWE shape.
 *
 * Filters by `hostUserIds`, not `createdById`, so this matches "what events
 * am I hosting" — events the user filed for someone else are excluded, and
 * events the user was added to as a co-host (without creating them) are
 * included. Aligned with the Events tab "My Events" carousel and the
 * non-leader hosting cap on `meetings.create`.
 */
export const myHostedEvents = query({
  args: {
    token: v.string(),
    now: v.number(),
    communityId: v.id("communities"),
    includePast: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ upcoming: EventCard[]; past: EventCard[] }> => {
    const userId = await requireAuth(ctx, args.token);

    // No multi-value index on hostUserIds — scan by (communityId, scheduledAt)
    // and filter host membership in memory. Two range queries (future, past)
    // bound the work; past is only scanned when `includePast` is set.
    const futureRows = await ctx.db
      .query("meetings")
      .withIndex("by_community_scheduledAt", (q) =>
        q.eq("communityId", args.communityId).gt("scheduledAt", args.now)
      )
      .collect();
    const pastRows = args.includePast
      ? await ctx.db
          .query("meetings")
          .withIndex("by_community_scheduledAt", (q) =>
            q
              .eq("communityId", args.communityId)
              .lte("scheduledAt", args.now)
          )
          .collect()
      : [];

    const live: Doc<"meetings">[] = [...futureRows, ...pastRows].filter(
      (m) => m.status !== "cancelled" && isMeetingHost(m, userId)
    );
    const withGroupDocs = await withGroups(ctx, live);
    const { upcoming, past } = splitByTime(withGroupDocs, args.now);

    const upcomingCapped = upcoming.slice(0, HOSTED_UPCOMING_LIMIT);
    const pastCapped = args.includePast ? past.slice(0, HOSTED_PAST_LIMIT) : [];

    const enrichment = await buildEnrichment(ctx, [
      ...upcomingCapped,
      ...pastCapped,
    ]);

    return {
      upcoming: buildBucket(upcomingCapped, HOSTED_UPCOMING_LIMIT, enrichment),
      // ADR-022: past events render newest-first. `buildBucket` defaults to
      // ASC (what the Events tab wants); we pass `desc` here to match the
      // Profile → My Events behavior.
      past: buildBucket(pastCapped, HOSTED_PAST_LIMIT, enrichment, {
        order: "desc",
      }),
    };
  },
});

/**
 * Events this user has RSVP'd "Going" to. Excludes cancelled and events this
 * user hosted (those show up under `myHostedEvents` instead — avoids double
 * counting).
 */
export const myAttendedEvents = query({
  args: {
    token: v.string(),
    now: v.number(),
    communityId: v.id("communities"),
    includePast: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ upcoming: EventCard[]; past: EventCard[] }> => {
    const userId = await requireAuth(ctx, args.token);

    const goingRsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("rsvpOptionId"), 1))
      .collect();

    const meetingIds = [...new Set(goingRsvps.map((r) => r.meetingId))];
    const meetings = (await Promise.all(meetingIds.map((id) => ctx.db.get(id))))
      .filter((m): m is Doc<"meetings"> => m !== null)
      .filter((m) => m.status !== "cancelled")
      // Dedupe with myHostedEvents by host membership, not creator — matches
      // the new "hosted = in hostUserIds" semantic so an event the user RSVPs
      // to but doesn't host shows here even if they happened to file it for
      // someone else.
      .filter((m) => !isMeetingHost(m, userId))
      .filter((m) => m.communityId === args.communityId);

    const withGroupDocs = await withGroups(ctx, meetings);
    const { upcoming, past } = splitByTime(withGroupDocs, args.now);

    const upcomingCapped = upcoming.slice(0, ATTENDED_UPCOMING_LIMIT);
    const pastCapped = args.includePast ? past.slice(0, ATTENDED_PAST_LIMIT) : [];

    const enrichment = await buildEnrichment(ctx, [
      ...upcomingCapped,
      ...pastCapped,
    ]);

    return {
      upcoming: buildBucket(upcomingCapped, ATTENDED_UPCOMING_LIMIT, enrichment),
      past: buildBucket(pastCapped, ATTENDED_PAST_LIMIT, enrichment, {
        order: "desc",
      }),
    };
  },
});
