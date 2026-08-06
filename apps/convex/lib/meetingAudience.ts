/**
 * Meeting audience — who may see, RSVP to, and check in to an event.
 *
 * A meeting's `visibility` field is the single source of truth for its
 * audience:
 *
 * - `"public"`    — anyone, signed in or not.
 * - `"community"` — any member of the hosting group's community.
 * - `"group"`     — active members of the hosting group (the default).
 * - `"groups"`    — the hosting group, plus every group in `visibleGroupIds`.
 * - `"team"`      — the serving teams in `visibleTeamIds`, i.e. the people on
 *                   those rosters. Narrower than a group: a team is a roster
 *                   *inside* a group, so a "Prayer Team night" stays with the
 *                   Prayer Team instead of going out to the whole group.
 *
 * This rule used to live in six hand-copied branches (`meetings/events.ts`,
 * `meetings/explore.ts` twice, `meetings/queries.ts`, `meetingRsvps.ts`, and
 * `meetings/attendance.ts`). They drifted, and adding a case meant editing all
 * six. Everything now reads from here so seeing an event and acting on it can
 * never disagree.
 *
 * Two entry points, because the callers have genuinely different shapes:
 * - {@link isMeetingVisibleTo} is a *pure* predicate for list rendering, where
 *   the caller has already loaded the viewer's standing once and filters many
 *   meetings against it.
 * - {@link canAccessMeeting} does its own lookups for single-meeting checks
 *   (RSVP, check-in, event detail), short-circuiting so it only reads what the
 *   meeting's visibility actually requires.
 */

import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/** The audience-bearing fields of a meeting. */
export type MeetingAudience = {
  groupId: Id<"groups">;
  visibility?: string;
  visibleGroupIds?: Id<"groups">[];
  visibleTeamIds?: Id<"teams">[];
};

/**
 * A viewer's standing, resolved once and reused across many meetings.
 *
 * `groupIds` / `teamIds` hold ids the viewer is an ACTIVE member of. Callers
 * build them; see {@link resolveViewerTeamIds} for the team side.
 */
export type ViewerStanding = {
  userId: Id<"users"> | null;
  groupIds: Set<string>;
  teamIds: Set<string>;
  isCommunityMember: boolean;
};

/** Meetings default to group-only when the field was never written. */
export function meetingVisibility(meeting: MeetingAudience): string {
  return meeting.visibility || "group";
}

/**
 * Whether `meeting` is visible to a viewer with the given standing.
 *
 * Pure and synchronous — safe to call in a `.filter()` over a page of
 * meetings. For team-scoped events the caller must have populated
 * `teamIds` (see {@link resolveViewerTeamIds}); an empty set simply hides
 * team-scoped events, which is the safe direction to fail.
 */
export function isMeetingVisibleTo(
  meeting: MeetingAudience,
  viewer: ViewerStanding
): boolean {
  const visibility = meetingVisibility(meeting);

  if (visibility === "public") return true;

  if (visibility === "community") {
    return viewer.userId !== null && viewer.isCommunityMember;
  }

  if (visibility === "groups") {
    if (viewer.groupIds.has(meeting.groupId)) return true;
    return (meeting.visibleGroupIds ?? []).some((id) => viewer.groupIds.has(id));
  }

  if (visibility === "team") {
    // Team-scoped events do NOT fall back to hosting-group membership: the
    // whole point is to stay narrower than the group. Only people on one of
    // the named rosters get in.
    return (meeting.visibleTeamIds ?? []).some((id) => viewer.teamIds.has(id));
  }

  return viewer.groupIds.has(meeting.groupId);
}

/**
 * Which of the teams referenced by `meetings` the viewer actually belongs to.
 *
 * A serving team's roster IS its linked chat channel's membership (see
 * `teams.channelId` and `chatChannels.isServingTeam` in schema.ts), so this
 * resolves team → channel → membership.
 *
 * Scoped to the teams the meetings in hand actually name, so a page with no
 * team-scoped events costs nothing and a page with a few costs a few reads —
 * rather than enumerating every team the viewer is on.
 */
export async function resolveViewerTeamIds(
  ctx: QueryCtx | MutationCtx,
  meetings: MeetingAudience[],
  userId: Id<"users"> | null
): Promise<Set<string>> {
  if (!userId) return new Set();

  const referenced = new Set<string>();
  for (const m of meetings) {
    if (meetingVisibility(m) !== "team") continue;
    for (const id of m.visibleTeamIds ?? []) referenced.add(id);
  }
  if (referenced.size === 0) return new Set();

  const memberOf = new Set<string>();
  for (const teamId of referenced) {
    if (await isOnTeamRoster(ctx, teamId as Id<"teams">, userId)) {
      memberOf.add(teamId);
    }
  }
  return memberOf;
}

/**
 * Whether `userId` is on `teamId`'s roster — an active member of the team's
 * linked channel. A team with no channel has no roster to check, so nobody
 * passes; `meetings/index.ts` rejects such teams at create/update time so an
 * event can't be addressed to an audience that can never see it.
 */
export async function isOnTeamRoster(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
  userId: Id<"users">
): Promise<boolean> {
  const team = await ctx.db.get(teamId);
  if (!team || team.isArchived || !team.channelId) return false;

  const membership = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", team.channelId!).eq("userId", userId)
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  return !!membership;
}

/**
 * Whether `userId` is an ACTIVE member of `groupId`.
 *
 * "Active" means present and accepted: no `leftAt`, and either no
 * `requestStatus` (legacy rows) or an accepted one — a pending join request
 * must not grant access to a group-scoped event.
 */
export async function isActiveGroupMember(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
  userId: Id<"users">
): Promise<boolean> {
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", userId)
    )
    .first();
  return (
    !!membership &&
    !membership.leftAt &&
    (!membership.requestStatus || membership.requestStatus === "accepted")
  );
}

/**
 * Whether `userId` may act on `meeting` — RSVP, check in, or open its detail.
 *
 * Does its own reads, short-circuiting on the meeting's visibility so a public
 * event costs zero lookups and a group event costs one. Mirrors
 * {@link isMeetingVisibleTo} exactly; the two must never disagree.
 */
export async function canAccessMeeting(
  ctx: QueryCtx | MutationCtx,
  meeting: MeetingAudience,
  userId: Id<"users"> | null
): Promise<boolean> {
  const visibility = meetingVisibility(meeting);

  if (visibility === "public") return true;
  if (!userId) return false;

  if (visibility === "community") {
    const group = await ctx.db.get(meeting.groupId);
    if (!group) return false;
    const membership = await ctx.db
      .query("userCommunities")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", group.communityId)
      )
      .first();
    return !!membership;
  }

  if (visibility === "team") {
    for (const teamId of meeting.visibleTeamIds ?? []) {
      if (await isOnTeamRoster(ctx, teamId, userId)) return true;
    }
    return false;
  }

  if (await isActiveGroupMember(ctx, meeting.groupId, userId)) return true;

  if (visibility === "groups") {
    for (const sharedGroupId of meeting.visibleGroupIds ?? []) {
      if (await isActiveGroupMember(ctx, sharedGroupId, userId)) return true;
    }
  }

  return false;
}

/**
 * The rejection message for a viewer who failed {@link canAccessMeeting}.
 *
 * `action` is the verb phrase the caller is gating — "RSVP to", "attend".
 * Wording is kept per-visibility (rather than one generic string) because it
 * tells the user what they'd have to be in order to get in.
 */
export function audienceDenialMessage(
  meeting: MeetingAudience,
  action: string
): string {
  const visibility = meetingVisibility(meeting);
  if (visibility === "community") {
    return `You must be a community member to ${action} this event`;
  }
  if (visibility === "team") {
    return `This event is limited to its team — you must be on the team to ${action} it`;
  }
  return `You must be a group member to ${action} this event`;
}

/** Doc-typed convenience for callers holding a full meeting row. */
export function audienceOf(meeting: Doc<"meetings">): MeetingAudience {
  return {
    groupId: meeting.groupId,
    visibility: meeting.visibility,
    visibleGroupIds: meeting.visibleGroupIds,
    visibleTeamIds: meeting.visibleTeamIds,
  };
}
