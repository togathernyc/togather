/**
 * Events Tab queries.
 *
 * Three section model:
 *   - myEvents: upcoming meetings the user is RSVP'd to OR hosting. Not
 *     CWE-collapsed — the user sees the specific child they're attending.
 *   - nextUp: meetings in the next 48 hours. Both types, CWE-collapsed.
 *   - thisWeek: meetings within 7 days. Both types, CWE-collapsed.
 *
 * Sections can overlap — an RSVP'd event tomorrow shows in both myEvents
 * and nextUp. Later (>7d out) is a separate paginated query so the
 * payload stays small.
 *
 * See ADR-022.
 */

import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, QueryCtx } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";
import { getMediaUrl } from "../../lib/utils";
import { getOptionalAuth } from "../../lib/auth";
import { PAST_EVENT_BUFFER_MS } from "../../lib/meetingConfig";
import { getHostUserIds, isMeetingHost } from "../../lib/meetingPermissions";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MY_EVENTS_LIMIT = 20;
const NEXT_UP_LIMIT = 10;
const THIS_WEEK_LIMIT = 25;
const LATER_PAGE_SIZE = 20;
const TOP_GUEST_COUNT = 5;
const RSVP_FETCH_CAP = 100;
// Over-fetch factor for CWE-collapsing sections: if a CWE has 19 children,
// it consumes 19 candidate slots but produces 1 card, so we need headroom
// to still hit `limit` cards after collapsing. Without a cap, a 7-day
// window query in a large community would trigger per-meeting RSVP
// enrichment on hundreds of meetings the UI won't render.
const BUCKET_CANDIDATE_MULTIPLIER = 5;

type MeetingDoc = Doc<"meetings">;
type GroupDoc = Doc<"groups">;
export type MeetingWithGroup = MeetingDoc & { group: GroupDoc };

type SingleEventCard = {
  kind: "single";
  id: Id<"meetings">;
  shortId: string | null;
  title: string | null;
  scheduledAt: string;
  status: string;
  visibility: "group" | "community" | "public";
  coverImage: string | null;
  locationOverride: string | null;
  meetingType: number;
  rsvpEnabled: boolean;
  communityWideEventId: Id<"communityWideEvents"> | null;
  group: {
    id: Id<"groups">;
    name: string;
    image: string | null;
    groupTypeName: string;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  };
  rsvpSummary: {
    totalGoing: number;
    topGoingGuests: Array<{
      id: Id<"users">;
      firstName: string;
      profileImage: string | null;
    }>;
  };
  hideRsvpCount: boolean;
  createdById: Id<"users"> | null;
  viewerIsLeader: boolean;
};

type CommunityWideCard = {
  kind: "community_wide";
  parentId: Id<"communityWideEvents">;
  title: string;
  scheduledAt: string;
  status: string;
  meetingType: number;
  groupCount: number;
  totalGoing: number;
  coverImage: string | null;
  // The short link of the first child — used as a tappable fallback.
  // The UI opens an expand-sheet via getCommunityWideEventChildren.
  representativeShortId: string | null;
};

export type EventCard = SingleEventCard | CommunityWideCard;

export const listForEventsTab = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    const currentTime = args.now;

    const {
      userGroupIds,
      userLeaderGroupIds,
      isCommunityMember,
      userRsvpMeetingIds,
    } = await loadVisibilityContext(ctx, userId, args.communityId);

    const communityGroups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    // Per-group fetch bounded by [now - 1d, now + 7d]. The 1-day past floor
    // lets us include meetings that started earlier today for the nextUp
    // window; the 7-day ceiling keeps the payload small (Later events come
    // from the paginated listLaterEvents query).
    const scheduledFloor = currentTime - ONE_DAY_MS;
    const weekCutoff = currentTime + SEVEN_DAYS_MS;
    const perGroupFetches = await Promise.all(
      communityGroups.map(async (group) => {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_group_scheduledAt", (q) =>
            q
              .eq("groupId", group._id)
              .gte("scheduledAt", scheduledFloor)
              .lt("scheduledAt", weekCutoff)
          )
          .filter((q) => q.neq(q.field("status"), "cancelled"))
          .collect();
        return meetings.map((m) => ({ ...m, group }));
      })
    );
    const inWindowMeetings = perGroupFetches.flat();

    const visibleInWindow = inWindowMeetings.filter((m) =>
      isVisible(m, userId, userGroupIds, isCommunityMember)
    );

    // nextUp: upcoming within 48h. Both types; CWE-collapsed. Past floor is
    // pulled back by PAST_EVENT_BUFFER_MS so events still in their grace
    // window keep appearing.
    const pastFloor = currentTime - PAST_EVENT_BUFFER_MS;
    const nextUpCutoff = currentTime + TWO_DAYS_MS;
    const nextUp = visibleInWindow
      .filter(
        (m) => m.scheduledAt > pastFloor && m.scheduledAt < nextUpCutoff
      )
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    // thisWeek: upcoming within 7 days. Both types; CWE-collapsed.
    // Overlaps with nextUp by design — the frontend decides what to show
    // where. No exclusion filter (that's what caused the CWE "0 going"
    // miscount in the old design).
    const thisWeek = visibleInWindow
      .filter((m) => m.scheduledAt > pastFloor)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    // myEvents: upcoming meetings the user RSVP'd to OR is hosting. Not
    // bounded to the 7-day window — a dinner party in 3 weeks that the
    // user RSVP'd to belongs here. Fetched directly from the user's
    // RSVP/hosted sets so we catch events outside the window above.
    const myEventsMeetings = await loadMyEventsMeetings(
      ctx,
      userId,
      args.communityId,
      currentTime,
      userGroupIds,
      userLeaderGroupIds,
      userRsvpMeetingIds
    );
    const myEventsVisible = myEventsMeetings.filter((m) =>
      isVisible(m, userId, userGroupIds, isCommunityMember)
    );
    // myEvents shows the exact meeting the user is going to — don't
    // collapse into CWE cards here. If they RSVP'd to "Manhattan Service",
    // they want that specific card, not a collapsed parent.

    // Cap candidate sets BEFORE enrichment. buildEnrichment runs a
    // per-meeting RSVP query for each input; without a cap, a 7-day
    // window in a large community fans out to hundreds of reads for a
    // UI that only renders `limit` cards per section.
    const nextUpCandidates = nextUp.slice(
      0,
      NEXT_UP_LIMIT * BUCKET_CANDIDATE_MULTIPLIER
    );
    const thisWeekCandidates = thisWeek.slice(
      0,
      THIS_WEEK_LIMIT * BUCKET_CANDIDATE_MULTIPLIER
    );
    const myEventsCandidates = myEventsVisible.slice(0, MY_EVENTS_LIMIT);

    const uniqueForEnrichment = Array.from(
      new Map(
        [...nextUpCandidates, ...thisWeekCandidates, ...myEventsCandidates].map(
          (m) => [m._id, m] as const
        )
      ).values()
    );
    const enrichment = await buildEnrichment(ctx, uniqueForEnrichment, {
      userId,
      leaderGroupIds: userLeaderGroupIds,
    });

    return {
      myEvents: myEventsCandidates.map((m) => buildSingleCard(m, enrichment)),
      nextUp: buildBucket(nextUpCandidates, NEXT_UP_LIMIT, enrichment),
      thisWeek: buildBucket(thisWeekCandidates, THIS_WEEK_LIMIT, enrichment),
    };
  },
});

/**
 * Lazy-loaded list of per-group instances for a community-wide parent.
 * Fired when the user taps a grouped card to expand it.
 */
export const getCommunityWideEventChildren = query({
  args: {
    token: v.optional(v.string()),
    parentId: v.id("communityWideEvents"),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    const parent = await ctx.db.get(args.parentId);
    if (!parent) return { parent: null, children: [] };

    const { userGroupIds, userLeaderGroupIds, isCommunityMember } =
      await loadVisibilityContext(ctx, userId, parent.communityId);

    const children = await ctx.db
      .query("meetings")
      .withIndex("by_communityWideEvent", (q) =>
        q.eq("communityWideEventId", args.parentId)
      )
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .collect();

    const groupIds = [...new Set(children.map((c) => c.groupId))];
    const groups = await Promise.all(
      groupIds.map((id) => ctx.db.get(id))
    );
    const groupsMap = new Map(
      groups.filter(Boolean).map((g) => [g!._id, g!] as const)
    );

    const withGroup: MeetingWithGroup[] = children
      .map((c) => {
        const group = groupsMap.get(c.groupId);
        return group ? { ...c, group } : null;
      })
      .filter(Boolean) as MeetingWithGroup[];

    const visible = withGroup.filter((m) =>
      isVisible(m, userId, userGroupIds, isCommunityMember)
    );
    visible.sort((a, b) => a.scheduledAt - b.scheduledAt);

    const enrichment = await buildEnrichment(ctx, visible, {
      userId,
      leaderGroupIds: userLeaderGroupIds,
    });
    const cards = visible.map((m) => buildSingleCard(m, enrichment));

    return {
      parent: {
        id: parent._id,
        title: parent.title,
        scheduledAt: new Date(parent.scheduledAt).toISOString(),
        status: parent.status,
        meetingType: parent.meetingType,
      },
      children: cards,
    };
  },
});

/**
 * Paginated "Later" section — meetings beyond the 7-day window handled by
 * `listForEventsTab`. Uses the `by_community_scheduledAt` index to stream
 * meetings chronologically, collapsing CWE children in-page. Because
 * children of the same CWE share `scheduledAt` in the common case, a
 * given parent's children overwhelmingly land on the same page; when a
 * leader has overridden children to diverge, the parent may appear on
 * two consecutive pages. The client de-dupes by `parentId` across pages.
 *
 * Meetings without `communityId` set (legacy rows) are excluded.
 */
export const listLaterEvents = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    now: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    const { userGroupIds, userLeaderGroupIds, isCommunityMember } =
      await loadVisibilityContext(ctx, userId, args.communityId);

    const weekCutoff = args.now + SEVEN_DAYS_MS;
    const page = await ctx.db
      .query("meetings")
      .withIndex("by_community_scheduledAt", (q) =>
        q.eq("communityId", args.communityId).gte("scheduledAt", weekCutoff)
      )
      .filter((q) => q.neq(q.field("status"), "cancelled"))
      .paginate(args.paginationOpts);

    const groupIds = [...new Set(page.page.map((m) => m.groupId))];
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
    const groupsMap = new Map(
      groups.filter(Boolean).map((g) => [g!._id, g!] as const)
    );

    const withGroup = page.page
      .map((m) => {
        const group = groupsMap.get(m.groupId);
        return group ? ({ ...m, group } as MeetingWithGroup) : null;
      })
      .filter((m): m is MeetingWithGroup => m !== null);

    const visible = withGroup.filter((m) =>
      isVisible(m, userId, userGroupIds, isCommunityMember)
    );

    const enrichment = await buildEnrichment(ctx, visible, {
      userId,
      leaderGroupIds: userLeaderGroupIds,
    });
    // Use a limit equal to the fetched count so buildBucket never truncates
    // a page — Convex pagination controls the size upstream.
    const cards = buildBucket(visible, visible.length, enrichment);

    return {
      page: cards,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

// ============================================================================
// Helpers
// ============================================================================

async function loadVisibilityContext(
  ctx: QueryCtx,
  userId: Id<"users"> | null,
  communityId: Id<"communities">
) {
  const userGroupIds = new Set<string>();
  const userLeaderGroupIds = new Set<string>();
  const userRsvpMeetingIds = new Set<Id<"meetings">>();
  let isCommunityMember = false;

  if (!userId) {
    return {
      userGroupIds,
      userLeaderGroupIds,
      isCommunityMember,
      userRsvpMeetingIds,
    };
  }

  const communityMembership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId)
    )
    .filter((q) => q.eq(q.field("status"), 1))
    .first();
  isCommunityMember = !!communityMembership;

  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) =>
      q.and(
        q.eq(q.field("leftAt"), undefined),
        q.or(
          q.eq(q.field("requestStatus"), undefined),
          q.eq(q.field("requestStatus"), "accepted")
        )
      )
    )
    .collect();
  for (const m of memberships) {
    userGroupIds.add(m.groupId);
    if (m.role === "leader") userLeaderGroupIds.add(m.groupId);
  }

  const rsvps = await ctx.db
    .query("meetingRsvps")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) =>
      q.or(
        q.eq(q.field("rsvpOptionId"), 1),
        q.eq(q.field("rsvpOptionId"), 2)
      )
    )
    .collect();
  for (const r of rsvps) userRsvpMeetingIds.add(r.meetingId);

  return {
    userGroupIds,
    userLeaderGroupIds,
    isCommunityMember,
    userRsvpMeetingIds,
  };
}

// Load meetings for the "My Events" section. A meeting belongs here when:
//   1. The user RSVP'd (going/interested), OR
//   2. The user is in `hostUserIds` (an explicit host), OR
//   3. `hostUserIds` is empty AND the user is a leader of the hosting group
//      (delegated event — leaders are the effective host per
//      `resolveEventAdmins` in lib/meetingPermissions.ts).
//
// Creator (`createdById`) is NOT a signal: per the host-decoupling work
// (commit c7fcf32), creator is metadata only — a filer who removed
// themselves from `hostUserIds` should not see the event in My Events
// unless they're also a leader of the now-delegated group.
//
// Hosting/delegated detection iterates the user's groups and pulls upcoming
// meetings via `by_group_scheduledAt`. There's no array-element index on
// `hostUserIds`, and a typical user is in a small handful of groups, so
// the fan-out is bounded. Not window-bounded on the upper end since a
// far-future RSVP'd or hosted event still belongs here.
async function loadMyEventsMeetings(
  ctx: QueryCtx,
  userId: Id<"users"> | null,
  communityId: Id<"communities">,
  now: number,
  userGroupIds: Set<string>,
  userLeaderGroupIds: Set<string>,
  userRsvpMeetingIds: Set<Id<"meetings">>
): Promise<MeetingWithGroup[]> {
  if (!userId) return [];

  const pastFloor = now - PAST_EVENT_BUFFER_MS;

  const rsvpMeetings = (
    await Promise.all([...userRsvpMeetingIds].map((id) => ctx.db.get(id)))
  ).filter((m): m is Doc<"meetings"> => m !== null);

  // Scope the per-group fan-out to groups in the requested community only.
  // For users who belong to multiple communities, iterating every membership
  // would scan future meetings across unrelated communities just to drop
  // them in the in-memory `communityId === communityId` filter below.
  // Fetching the user's group docs first is cheap (indexed by id) and lets
  // us skip those reads.
  const userGroupDocs = await Promise.all(
    [...userGroupIds].map((gid) => ctx.db.get(gid as Id<"groups">))
  );
  const userGroupIdsInCommunity = userGroupDocs
    .filter((g): g is Doc<"groups"> => g !== null && g.communityId === communityId)
    .map((g) => g._id);

  const groupMeetingsArrays = await Promise.all(
    userGroupIdsInCommunity.map((gid) =>
      ctx.db
        .query("meetings")
        .withIndex("by_group_scheduledAt", (q) =>
          q.eq("groupId", gid).gte("scheduledAt", pastFloor)
        )
        .filter((q) => q.neq(q.field("status"), "cancelled"))
        .collect()
    )
  );

  // Catch the "host but no longer a group member" case: a user who created
  // (and was defaulted as host of) a meeting and then left the group should
  // still see it in My Events while they're listed in `hostUserIds` —
  // matches the behavior of `isMeetingHost` / `canAccessEventChannel`.
  // `by_createdBy` covers the most common path (user creates → user is the
  // default host → user leaves the group). It does not cover the rarer
  // case of "I was added as host of someone else's event and never joined
  // the group" — there's no `hostUserIds` array index, so that gap stays.
  const createdMeetings = await ctx.db
    .query("meetings")
    .withIndex("by_createdBy", (q) => q.eq("createdById", userId))
    .filter((q) => q.neq(q.field("status"), "cancelled"))
    .collect();

  // Mirrors the host/delegated rule in `canAccessEventChannel` (event chat
  // access) and `canEditMeeting` — keep these in sync via the shared helpers
  // in lib/meetingPermissions.ts. The leader check uses the precomputed
  // `userLeaderGroupIds` set instead of a per-meeting groupMembers lookup;
  // the set is built from the same active-leader filter.
  const allCandidates = [...groupMeetingsArrays.flat(), ...createdMeetings];
  const hostedOrDelegated = allCandidates.filter((m) => {
    if (isMeetingHost(m, userId)) return true;
    if (
      getHostUserIds(m).length === 0 &&
      userLeaderGroupIds.has(m.groupId)
    ) {
      return true;
    }
    return false;
  });

  const byId = new Map<Id<"meetings">, Doc<"meetings">>();
  for (const m of [...rsvpMeetings, ...hostedOrDelegated]) {
    byId.set(m._id, m);
  }

  const upcoming = [...byId.values()].filter(
    (m) =>
      m.status !== "cancelled" &&
      m.communityId === communityId &&
      m.scheduledAt > pastFloor
  );

  const groupIds = [...new Set(upcoming.map((m) => m.groupId))];
  const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
  const groupsMap = new Map(
    groups.filter(Boolean).map((g) => [g!._id, g!] as const)
  );

  const withGroup = upcoming
    .map((m) => {
      const group = groupsMap.get(m.groupId);
      return group ? ({ ...m, group } as MeetingWithGroup) : null;
    })
    .filter((m): m is MeetingWithGroup => m !== null);

  withGroup.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return withGroup;
}

export function isVisible(
  m: MeetingWithGroup,
  userId: Id<"users"> | null,
  userGroupIds: Set<string>,
  isCommunityMember: boolean
): boolean {
  const visibility = m.visibility || "group";
  if (visibility === "public") return true;
  if (visibility === "community") return userId !== null && isCommunityMember;
  return userGroupIds.has(m.groupId);
}

type Enrichment = {
  groupTypesMap: Map<Id<"groupTypes">, Doc<"groupTypes">>;
  rsvpsByMeeting: Map<Id<"meetings">, Array<Doc<"meetingRsvps">>>;
  usersMap: Map<Id<"users">, Doc<"users">>;
  parentsMap: Map<Id<"communityWideEvents">, Doc<"communityWideEvents">>;
  // Total "going" count per CWE parent, summed across ALL children of
  // the parent — not just the children surfaced in the current bucket.
  // Reading this prevents the old bug where a CWE card showed "0 going"
  // when the RSVP'd child was routed to a different section.
  totalGoingByParent: Map<Id<"communityWideEvents">, number>;
  // Viewer context — used to stamp each SingleEventCard with
  // `viewerIsLeader` so the client can decide whether to reveal a hidden
  // RSVP count. Populated only when enrichment is built inside a query
  // that knows the viewer; defaults to empty sets when not.
  viewerId?: Id<"users"> | null;
  viewerLeaderGroupIds?: Set<string>;
};

export async function buildEnrichment(
  ctx: QueryCtx,
  meetings: MeetingWithGroup[],
  viewer?: {
    userId: Id<"users"> | null;
    leaderGroupIds: Set<string>;
  }
): Promise<Enrichment> {
  const groupTypeIds = [
    ...new Set(meetings.map((m) => m.group.groupTypeId)),
  ];
  const groupTypes = await Promise.all(
    groupTypeIds.map((id) => ctx.db.get(id))
  );
  const groupTypesMap = new Map(
    groupTypes
      .filter(Boolean)
      .map((gt) => [gt!._id, gt!] as const)
  );

  const meetingIds = meetings.map((m) => m._id);
  const allGoingRsvps = await Promise.all(
    meetingIds.map((id) =>
      ctx.db
        .query("meetingRsvps")
        .withIndex("by_meeting", (q) => q.eq("meetingId", id))
        .filter((q) => q.eq(q.field("rsvpOptionId"), 1))
        .take(RSVP_FETCH_CAP)
    )
  );
  const rsvpsByMeeting = new Map(
    meetingIds.map((id, i) => [id, allGoingRsvps[i]] as const)
  );

  const userIdsToFetch = new Set<Id<"users">>();
  for (const rsvps of allGoingRsvps) {
    for (const r of rsvps.slice(0, TOP_GUEST_COUNT)) {
      userIdsToFetch.add(r.userId);
    }
  }
  const users = await Promise.all(
    [...userIdsToFetch].map((id) => ctx.db.get(id))
  );
  const usersMap = new Map<Id<"users">, Doc<"users">>(
    users
      .filter((u): u is Doc<"users"> => u !== null)
      .map((u) => [u._id, u])
  );

  const parentIds = [
    ...new Set(
      meetings
        .map((m) => m.communityWideEventId)
        .filter((id): id is Id<"communityWideEvents"> => !!id)
    ),
  ];
  const parents = await Promise.all(
    parentIds.map((id) => ctx.db.get(id))
  );
  const parentsMap = new Map(
    parents.filter(Boolean).map((p) => [p!._id, p!] as const)
  );

  // Per-parent totalGoing aggregated across ALL children, regardless of
  // which section they land in. Fetch all children of each surfaced CWE
  // parent and count their "going" RSVPs (option 1) directly via the
  // rsvps index — cheaper than re-fetching full RSVP rows.
  const childrenByParentAll = await Promise.all(
    parentIds.map(async (parentId) => {
      const children = await ctx.db
        .query("meetings")
        .withIndex("by_communityWideEvent", (q) =>
          q.eq("communityWideEventId", parentId)
        )
        .filter((q) => q.neq(q.field("status"), "cancelled"))
        .collect();
      return { parentId, children };
    })
  );

  const totalGoingByParent = new Map<Id<"communityWideEvents">, number>();
  await Promise.all(
    childrenByParentAll.map(async ({ parentId, children }) => {
      const counts = await Promise.all(
        children.map((c) => {
          const cached = rsvpsByMeeting.get(c._id);
          if (cached) return Promise.resolve(cached.length);
          return ctx.db
            .query("meetingRsvps")
            .withIndex("by_meeting", (q) => q.eq("meetingId", c._id))
            .filter((q) => q.eq(q.field("rsvpOptionId"), 1))
            .take(RSVP_FETCH_CAP)
            .then((rs) => rs.length);
        })
      );
      totalGoingByParent.set(
        parentId,
        counts.reduce((a, b) => a + b, 0)
      );
    })
  );

  return {
    groupTypesMap,
    rsvpsByMeeting,
    usersMap,
    parentsMap,
    totalGoingByParent,
    viewerId: viewer?.userId ?? null,
    viewerLeaderGroupIds: viewer?.leaderGroupIds ?? new Set(),
  };
}

export function buildBucket(
  meetings: MeetingWithGroup[],
  limit: number,
  e: Enrichment,
  opts?: { order?: "asc" | "desc" }
): EventCard[] {
  // Partition into standalones vs community-wide children.
  const standalones: MeetingWithGroup[] = [];
  const childrenByParent = new Map<
    Id<"communityWideEvents">,
    MeetingWithGroup[]
  >();

  for (const m of meetings) {
    if (m.communityWideEventId && e.parentsMap.has(m.communityWideEventId)) {
      const arr = childrenByParent.get(m.communityWideEventId) ?? [];
      arr.push(m);
      childrenByParent.set(m.communityWideEventId, arr);
    } else {
      standalones.push(m);
    }
  }

  // Build cards. Each group of children collapses into one card positioned
  // at the earliest child's scheduledAt, so merged ordering stays correct.
  const cards: Array<EventCard & { sortAt: number }> = [];

  for (const m of standalones) {
    const card = buildSingleCard(m, e);
    cards.push({ ...card, sortAt: m.scheduledAt });
  }

  for (const [parentId, children] of childrenByParent) {
    const parent = e.parentsMap.get(parentId);
    if (!parent) continue;
    children.sort((a, b) => a.scheduledAt - b.scheduledAt);
    const earliest = children[0];

    // Read the pre-aggregated parent total (all children, all sections),
    // not a bucket-local sum — avoids undercounting when an RSVP'd child
    // is routed to a different section.
    const totalGoing = e.totalGoingByParent.get(parentId) ?? 0;

    const representative = children.find((c) => c.shortId);

    // Use the earliest child's scheduledAt (and its sort key). Children
    // may be overridden to diverge from the parent's time, so relying on
    // the parent here can surface a card with the wrong date for the
    // bucketed content.
    cards.push({
      kind: "community_wide",
      parentId,
      title: parent.title,
      scheduledAt: new Date(earliest.scheduledAt).toISOString(),
      status: parent.status,
      meetingType: parent.meetingType,
      groupCount: children.length,
      totalGoing,
      // Prefer the shared parent cover. Falls back to the earliest child's
      // cover so legacy rows without a parent cover don't lose their art.
      coverImage:
        getMediaUrl((parent as any).coverImage) ??
        getMediaUrl(earliest.coverImage) ??
        null,
      representativeShortId: representative?.shortId ?? null,
      sortAt: earliest.scheduledAt,
    });
  }

  const dir = opts?.order === "desc" ? -1 : 1;
  cards.sort((a, b) => dir * (a.sortAt - b.sortAt));
  return cards.slice(0, limit).map(({ sortAt: _, ...card }) => card);
}

function buildSingleCard(
  m: MeetingWithGroup,
  e: Enrichment
): SingleEventCard {
  const goingRsvps = e.rsvpsByMeeting.get(m._id) ?? [];
  const groupType = e.groupTypesMap.get(m.group.groupTypeId);
  const topGoingGuests = goingRsvps
    .slice(0, TOP_GUEST_COUNT)
    .map((r) => {
      const u = e.usersMap.get(r.userId);
      return u
        ? {
            id: u._id,
            firstName: u.firstName || "",
            profileImage: getMediaUrl(u.profilePhoto) ?? null,
          }
        : null;
    })
    .filter(
      (
        g
      ): g is {
        id: Id<"users">;
        firstName: string;
        profileImage: string | null;
      } => g !== null
    );

  return {
    kind: "single",
    id: m._id,
    shortId: m.shortId || null,
    title: m.title || null,
    scheduledAt: new Date(m.scheduledAt).toISOString(),
    status: m.status,
    visibility: (m.visibility || "group") as
      | "group"
      | "community"
      | "public",
    coverImage: getMediaUrl(m.coverImage) ?? null,
    locationOverride: m.locationOverride || null,
    meetingType: m.meetingType,
    rsvpEnabled: m.rsvpEnabled ?? true,
    communityWideEventId: m.communityWideEventId || null,
    group: {
      id: m.group._id,
      name: m.group.name,
      image: getMediaUrl(m.group.preview) ?? null,
      groupTypeName: groupType?.name || "Group",
      addressLine1: m.group.addressLine1 || null,
      addressLine2: m.group.addressLine2 || null,
      city: m.group.city || null,
      state: m.group.state || null,
      zipCode: m.group.zipCode || null,
    },
    rsvpSummary: {
      totalGoing: goingRsvps.length,
      topGoingGuests,
    },
    hideRsvpCount: m.hideRsvpCount === true,
    createdById: m.createdById ?? null,
    viewerIsLeader:
      (e.viewerLeaderGroupIds?.has(m.group._id) ?? false) ||
      (!!e.viewerId && !!m.createdById && e.viewerId === m.createdById),
  };
}
