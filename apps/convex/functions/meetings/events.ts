/**
 * Events Tab queries
 *
 * Powers the new Events tab (PR 1 of the events-first navigation split).
 * Returns four pre-sliced buckets (Happening now / Your RSVPs / This week /
 * Later) with community-wide child events collapsed into single grouped
 * cards server-side — client-side grouping would break pagination since
 * the same parent could appear across pages.
 *
 * See ADR-022.
 */

import { v } from "convex/values";
import { query, QueryCtx } from "../../_generated/server";
import { Id, Doc } from "../../_generated/dataModel";
import { getMediaUrl } from "../../lib/utils";
import { getOptionalAuth } from "../../lib/auth";
import { DEFAULT_MEETING_DURATION_MS } from "../../lib/meetingConfig";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const HAPPENING_NOW_LIMIT = 10;
const MY_RSVPS_LIMIT = 10;
const THIS_WEEK_LIMIT = 25;
const LATER_LIMIT = 25;
const PER_GROUP_FETCH = 100;
const TOP_GUEST_COUNT = 5;
const RSVP_FETCH_CAP = 100;

type MeetingDoc = Doc<"meetings">;
type GroupDoc = Doc<"groups">;
type MeetingWithGroup = MeetingDoc & { group: GroupDoc };

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

type EventCard = SingleEventCard | CommunityWideCard;

export const listForEventsTab = query({
  args: {
    token: v.optional(v.string()),
    communityId: v.id("communities"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getOptionalAuth(ctx, args.token);
    const currentTime = args.now;

    const { userGroupIds, isCommunityMember, userRsvpMeetingIds } =
      await loadVisibilityContext(ctx, userId, args.communityId);

    const communityGroups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .filter((q) => q.eq(q.field("isArchived"), false))
      .collect();

    const perGroupFetches = await Promise.all(
      communityGroups.map(async (group) => {
        const meetings = await ctx.db
          .query("meetings")
          .withIndex("by_group_scheduledAt", (q) =>
            q.eq("groupId", group._id)
          )
          .order("desc")
          .filter((q) => q.neq(q.field("status"), "cancelled"))
          .take(PER_GROUP_FETCH);
        return meetings.map((m) => ({ ...m, group }));
      })
    );
    const allMeetings = perGroupFetches.flat();

    const visible = allMeetings.filter((m) =>
      isVisible(m, userId, userGroupIds, isCommunityMember)
    );

    const endOfNow = currentTime;
    const weekCutoff = currentTime + SEVEN_DAYS_MS;

    const happeningNow = visible
      .filter(
        (m) =>
          m.scheduledAt <= endOfNow &&
          endOfNow <= m.scheduledAt + DEFAULT_MEETING_DURATION_MS
      )
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    const myRsvps = visible
      .filter(
        (m) =>
          m.scheduledAt > endOfNow && userRsvpMeetingIds.has(m._id)
      )
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    const myRsvpIdSet = new Set(myRsvps.map((m) => m._id));

    const thisWeek = visible
      .filter(
        (m) =>
          m.scheduledAt > endOfNow &&
          m.scheduledAt < weekCutoff &&
          !myRsvpIdSet.has(m._id)
      )
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    const later = visible
      .filter(
        (m) =>
          m.scheduledAt >= weekCutoff && !myRsvpIdSet.has(m._id)
      )
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    // Build per-bucket cards (with server-side community-wide collapsing).
    // We share a single batched enrichment pass across buckets to avoid
    // N+1 fetches of group types, RSVPs, and user profiles.
    const allForEnrichment = [
      ...happeningNow,
      ...myRsvps,
      ...thisWeek,
      ...later,
    ];
    const enrichment = await buildEnrichment(ctx, allForEnrichment);

    return {
      happeningNow: buildBucket(
        happeningNow,
        HAPPENING_NOW_LIMIT,
        enrichment
      ),
      myRsvps: buildBucket(myRsvps, MY_RSVPS_LIMIT, enrichment),
      thisWeek: buildBucket(thisWeek, THIS_WEEK_LIMIT, enrichment),
      later: buildBucket(later, LATER_LIMIT, enrichment),
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

    const { userGroupIds, isCommunityMember } =
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

    const enrichment = await buildEnrichment(ctx, visible);
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

// ============================================================================
// Helpers
// ============================================================================

async function loadVisibilityContext(
  ctx: QueryCtx,
  userId: Id<"users"> | null,
  communityId: Id<"communities">
) {
  const userGroupIds = new Set<string>();
  const userRsvpMeetingIds = new Set<string>();
  let isCommunityMember = false;

  if (!userId) {
    return { userGroupIds, isCommunityMember, userRsvpMeetingIds };
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
  for (const m of memberships) userGroupIds.add(m.groupId);

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

  return { userGroupIds, isCommunityMember, userRsvpMeetingIds };
}

function isVisible(
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
};

async function buildEnrichment(
  ctx: QueryCtx,
  meetings: MeetingWithGroup[]
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

  return { groupTypesMap, rsvpsByMeeting, usersMap, parentsMap };
}

function buildBucket(
  meetings: MeetingWithGroup[],
  limit: number,
  e: Enrichment
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

    let totalGoing = 0;
    for (const c of children) {
      totalGoing += (e.rsvpsByMeeting.get(c._id) ?? []).length;
    }

    const representative = children.find((c) => c.shortId);

    cards.push({
      kind: "community_wide",
      parentId,
      title: parent.title,
      scheduledAt: new Date(parent.scheduledAt).toISOString(),
      status: parent.status,
      meetingType: parent.meetingType,
      groupCount: children.length,
      totalGoing,
      coverImage: getMediaUrl(earliest.coverImage) ?? null,
      representativeShortId: representative?.shortId ?? null,
      sortAt: parent.scheduledAt,
    });
  }

  cards.sort((a, b) => a.sortAt - b.sortAt);
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
  };
}
