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
 * - `"private"`   — UNLISTED. Never appears in anyone's browse, search, or
 *                   feed on group membership alone. You get in by holding the
 *                   link, or by being invited. For a gathering someone wants
 *                   to keep small, distribution is the control.
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
  _id?: Id<"meetings">;
  groupId: Id<"groups">;
  visibility?: string;
  visibleGroupIds?: Id<"groups">[];
  /** Who owns the event. Hosts always see their own private events. */
  hostUserIds?: Id<"users">[];
  createdById?: Id<"users">;
};

/**
 * A viewer's standing, resolved once and reused across many meetings.
 *
 * `groupIds` holds the groups the viewer is an ACTIVE member of. Callers build
 * it; see {@link resolveInvitedMeetingIds} for the invite side.
 */
export type ViewerStanding = {
  userId: Id<"users"> | null;
  groupIds: Set<string>;
  /**
   * Meetings this viewer was explicitly invited to (`eventInvites` rows).
   * Only consulted for private events; see {@link resolveInvitedMeetingIds}.
   */
  invitedMeetingIds: Set<string>;
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
 * meetings. For private events the caller must have populated
 * `invitedMeetingIds` (see {@link resolveInvitedMeetingIds}); an empty set
 * simply hides them, which is the safe direction to fail.
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

  if (visibility === "private") {
    // Unlisted: group membership grants nothing. It surfaces in a list only
    // for the people who own it or were invited to it. Everyone else reaches
    // it through the link, which is a different path entirely (see
    // canAccessMeeting).
    if (isMeetingOwner(meeting, viewer.userId)) return true;
    return meeting._id ? viewer.invitedMeetingIds.has(meeting._id) : false;
  }

  return viewer.groupIds.has(meeting.groupId);
}

/**
 * Strip private events the viewer neither owns nor was invited to.
 *
 * For list queries that were never audience-filtered at all — `listByGroup`
 * and `listUpcomingForUser` scope by group membership and return everything
 * else. That was survivable while every visibility level was at least as wide
 * as the hosting group, but "private" is narrower, so membership alone must
 * stop being enough.
 *
 * This deliberately filters ONLY private events rather than applying the full
 * audience rule. Those queries have never enforced group/community/public
 * scoping, and quietly tightening them here would change behavior well beyond
 * this feature — `listByGroup` doesn't even take a token, so a full gate would
 * empty the group page for every caller that doesn't pass one. Closing the
 * hole this feature opens is in scope; retrofitting the rest is not.
 */
export async function withoutHiddenPrivateEvents<T extends MeetingAudience>(
  ctx: QueryCtx | MutationCtx,
  meetings: T[],
  userId: Id<"users"> | null
): Promise<T[]> {
  const hasPrivate = meetings.some((m) => meetingVisibility(m) === "private");
  if (!hasPrivate) return meetings;

  const invited = await resolveInvitedMeetingIds(ctx, meetings, userId);
  return meetings.filter((m) => {
    if (meetingVisibility(m) !== "private") return true;
    if (isMeetingOwner(m, userId)) return true;
    return m._id ? invited.has(m._id) : false;
  });
}

/** Hosts (and the creator, when no hosts are seated) own the event. */
export function isMeetingOwner(
  meeting: MeetingAudience,
  userId: Id<"users"> | null
): boolean {
  if (!userId) return false;
  const hosts = meeting.hostUserIds ?? [];
  if (hosts.length > 0) return hosts.some((id) => id === userId);
  return meeting.createdById === userId;
}

/**
 * Which of the given private meetings the viewer was explicitly invited to.
 *
 * Scoped to the private meetings actually in hand, so a page with none costs
 * nothing — rather than loading every invite the viewer has ever received.
 */
export async function resolveInvitedMeetingIds(
  ctx: QueryCtx | MutationCtx,
  meetings: MeetingAudience[],
  userId: Id<"users"> | null
): Promise<Set<string>> {
  if (!userId) return new Set();

  const invited = new Set<string>();
  for (const m of meetings) {
    if (meetingVisibility(m) !== "private" || !m._id) continue;
    if (invited.has(m._id)) continue;
    if (await isInvitedToMeeting(ctx, m._id, userId)) invited.add(m._id);
  }
  return invited;
}

/** Whether `userId` has an `eventInvites` row for `meetingId`. */
export async function isInvitedToMeeting(
  ctx: QueryCtx | MutationCtx,
  meetingId: Id<"meetings">,
  userId: Id<"users">
): Promise<boolean> {
  const invite = await ctx.db
    .query("eventInvites")
    .withIndex("by_meeting_recipient", (q) =>
      q.eq("meetingId", meetingId).eq("recipientUserId", userId)
    )
    .first();
  return !!invite;
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

  if (visibility === "private") {
    // Reaching this check at all means the caller already holds the event's
    // id — which is only obtainable from the link or an invite, since private
    // events appear in no listing. Possession of the link IS the grant, the
    // same bargain as an unlisted video. Privacy here is "not discoverable",
    // not "sealed": anyone the link is forwarded to can open and RSVP. That is
    // what makes it usable for a host who wants to pass it around a small
    // circle, and it is worth saying out loud rather than implying more.
    return true;
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
  if (visibility === "private") {
    return `This event is private — you need an invite or the link to ${action} it`;
  }
  return `You must be a group member to ${action} this event`;
}

/** Doc-typed convenience for callers holding a full meeting row. */
export function audienceOf(meeting: Doc<"meetings">): MeetingAudience {
  return {
    groupId: meeting.groupId,
    visibility: meeting.visibility,
    visibleGroupIds: meeting.visibleGroupIds,
    _id: meeting._id,
    hostUserIds: meeting.hostUserIds,
    createdById: meeting.createdById,
  };
}
