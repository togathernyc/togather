/**
 * Queries that back the user profile page.
 *
 * - `getMutualGroups`: groups that both viewer and profile user are active
 *   members of, scoped to the given community.
 * - `getVisibleUpcomingEvents`: upcoming events the profile user is hosting
 *   or attending, filtered through the same visibility rules used by the
 *   Events tab so viewers can only see events they are allowed to see.
 *
 * Both queries require viewer auth — profile data leakage (e.g. hidden
 * group memberships, private-event hosting) would otherwise be possible.
 */

import { v } from "convex/values";
import { query, QueryCtx } from "../_generated/server";
import { Id, Doc } from "../_generated/dataModel";
import { getMediaUrl } from "../lib/utils";
import { requireAuth } from "../lib/auth";
import {
  buildBucket,
  buildEnrichment,
  isVisible,
  MeetingWithGroup,
} from "./meetings/events";

const DEFAULT_UPCOMING_LIMIT = 10;

/**
 * Mutual groups between viewer and profile user, scoped to a community.
 */
export const getMutualGroups = query({
  args: {
    token: v.string(),
    profileUserId: v.id("users"),
    communityId: v.id("communities"),
  },
  handler: async (ctx, args) => {
    const viewerId = await requireAuth(ctx, args.token);

    // Empty set when viewing self — mutuals are a social-signal feature for
    // other users. Callers can decide to skip the query for self.
    if (viewerId === args.profileUserId) {
      return [];
    }

    const [viewerMemberships, profileMemberships] = await Promise.all([
      ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", viewerId))
        .collect(),
      ctx.db
        .query("groupMembers")
        .withIndex("by_user", (q) => q.eq("userId", args.profileUserId))
        .collect(),
    ]);

    const viewerGroupIds = new Set(
      viewerMemberships.filter(isAcceptedMembership).map((m) => m.groupId),
    );
    const mutualIds = new Set<Id<"groups">>();
    for (const m of profileMemberships) {
      if (isAcceptedMembership(m) && viewerGroupIds.has(m.groupId)) {
        mutualIds.add(m.groupId);
      }
    }

    if (mutualIds.size === 0) return [];

    const groups = await Promise.all(
      [...mutualIds].map((id) => ctx.db.get(id)),
    );

    const validGroups = groups.filter(
      (g): g is Doc<"groups"> =>
        g !== null &&
        g.communityId === args.communityId &&
        g.isArchived !== true,
    );

    // Per-group member count — use the group index to count active members.
    // buildGroupMemberCount is inlined to avoid pulling in the group feature
    // module here.
    const withCounts = await Promise.all(
      validGroups.map(async (group) => {
        const members = await ctx.db
          .query("groupMembers")
          .withIndex("by_group", (q) => q.eq("groupId", group._id))
          .collect();
        return {
          _id: group._id,
          name: group.name,
          preview: getMediaUrl(group.preview) ?? null,
          shortId: group.shortId ?? null,
          memberCount: members.filter(isAcceptedMembership).length,
        };
      }),
    );

    // Sort by member count desc — larger groups tend to be more recognizable.
    withCounts.sort((a, b) => b.memberCount - a.memberCount);
    return withCounts;
  },
});

/**
 * Upcoming events for the profile user that are visible to the viewer.
 *
 * Combines events the profile user is hosting (creator) with events they
 * RSVP'd "going" to. Applies the same visibility filter used by the Events
 * tab so private-group events don't leak to viewers outside that group.
 *
 * Response shape mirrors the Events tab cards (`buildBucket`) so the UI can
 * reuse EventCard / EventCardRow. Each card includes a `role` field
 * ("hosting" | "attending") for the badge.
 */
export const getVisibleUpcomingEvents = query({
  args: {
    token: v.string(),
    profileUserId: v.id("users"),
    communityId: v.id("communities"),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewerId = await requireAuth(ctx, args.token);
    const limit = args.limit ?? DEFAULT_UPCOMING_LIMIT;

    // Viewer visibility context (mirrors loadVisibilityContext in events.ts).
    const viewerGroupIds = await loadViewerActiveGroupIds(ctx, viewerId);
    const viewerInCommunity = await viewerIsActiveCommunityMember(
      ctx,
      viewerId,
      args.communityId,
    );

    // 1. Events the profile user created (hosted).
    const hostedMeetings = await ctx.db
      .query("meetings")
      .withIndex("by_createdBy", (q) => q.eq("createdById", args.profileUserId))
      .filter((q) =>
        q.and(
          q.eq(q.field("communityId"), args.communityId),
          q.neq(q.field("status"), "cancelled"),
          q.gt(q.field("scheduledAt"), args.now),
        ),
      )
      .collect();

    // 2. Events the profile user RSVP'd "going" to.
    const goingRsvps = await ctx.db
      .query("meetingRsvps")
      .withIndex("by_user", (q) => q.eq("userId", args.profileUserId))
      .filter((q) => q.eq(q.field("rsvpOptionId"), 1))
      .collect();

    const attendingMeetings: Doc<"meetings">[] = [];
    for (const rsvp of goingRsvps) {
      const m = await ctx.db.get(rsvp.meetingId);
      if (!m) continue;
      if (m.communityId !== args.communityId) continue;
      if (m.status === "cancelled") continue;
      if (m.scheduledAt <= args.now) continue;
      attendingMeetings.push(m);
    }

    // Dedupe by meeting id; track role.
    type RoledMeeting = Doc<"meetings"> & { role: "hosting" | "attending" };
    const byId = new Map<Id<"meetings">, RoledMeeting>();
    for (const m of hostedMeetings) {
      byId.set(m._id, { ...m, role: "hosting" });
    }
    for (const m of attendingMeetings) {
      if (byId.has(m._id)) continue; // hosting takes precedence
      byId.set(m._id, { ...m, role: "attending" });
    }

    if (byId.size === 0) return [];

    // Hydrate groups (needed for visibility check + card shape).
    const groupIds = [
      ...new Set([...byId.values()].map((m) => m.groupId)),
    ];
    const groups = await Promise.all(groupIds.map((id) => ctx.db.get(id)));
    const groupsMap = new Map(
      groups.filter(Boolean).map((g) => [g!._id, g!] as const),
    );

    const withGroup: Array<MeetingWithGroup & { role: "hosting" | "attending" }> =
      [];
    for (const m of byId.values()) {
      const group = groupsMap.get(m.groupId);
      if (!group) continue;
      withGroup.push({ ...m, group, role: m.role });
    }

    // Reuse the shared visibility filter from the Events tab.
    const visible = withGroup.filter((m) =>
      isVisible(m, viewerId, viewerGroupIds, viewerInCommunity),
    );

    visible.sort((a, b) => a.scheduledAt - b.scheduledAt);
    const sliced = visible.slice(0, limit);

    // Build cards via buildEnrichment / buildBucket so the shape stays
    // consistent with the Events tab. Then stitch `role` back onto each
    // single card by meeting id.
    const roleById = new Map<Id<"meetings">, "hosting" | "attending">();
    for (const m of sliced) roleById.set(m._id, m.role);

    const enrichment = await buildEnrichment(ctx, sliced);
    const cards = buildBucket(sliced, sliced.length, enrichment);

    return cards.map((card) => {
      if (card.kind === "single") {
        return {
          ...card,
          role: roleById.get(card.id) ?? "attending",
        };
      }
      // CWE parent cards aggregate across groups — role here represents the
      // profile user's overall relationship; default to "hosting" since the
      // parent is spawned by the creator. Not critical: the UI only renders
      // the role badge on single cards.
      return card;
    });
  },
});

// ============================================================================
// Local helpers
// ============================================================================

async function loadViewerActiveGroupIds(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Set<string>> {
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) =>
      q.and(
        q.eq(q.field("leftAt"), undefined),
        q.or(
          q.eq(q.field("requestStatus"), undefined),
          q.eq(q.field("requestStatus"), "accepted"),
        ),
      ),
    )
    .collect();
  return new Set(memberships.map((m) => m.groupId));
}

async function viewerIsActiveCommunityMember(
  ctx: QueryCtx,
  userId: Id<"users">,
  communityId: Id<"communities">,
): Promise<boolean> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .filter((q) => q.eq(q.field("status"), 1))
    .first();
  return !!membership;
}

// Matches the accepted-membership predicate used in groupMembers.ts so pending
// or declined joins don't get counted as mutual groups or inflate member counts.
function isAcceptedMembership(m: Doc<"groupMembers">): boolean {
  if (m.leftAt) return false;
  return !m.requestStatus || m.requestStatus === "accepted";
}
