/**
 * Meeting permission helpers
 *
 * Centralizes the "who can edit/cancel/create this meeting" logic that
 * ADR-022 introduces. Before PR 2, only group leaders could touch meetings;
 * now the hosts of the meeting + group leaders + community admins can.
 */

import type { Doc, Id } from "../_generated/dataModel";
import { isActiveLeader, isActiveMember } from "./helpers";
import { isCommunityAdmin } from "./permissions";

type Ctx = { db: any };

/**
 * The users who host an event. Returns an empty list when no hosts are set —
 * in that case the event is "delegated" and group leaders are the effective
 * host (see `canEditMeeting`, chat seating in `eventChat.ts`, and RSVP
 * notifications in `senders.ts`). Creator is intentionally NOT a fallback:
 * `createdById` is just a record of who filed the event, not a permission.
 */
export function getHostUserIds(meeting: Doc<"meetings">): Id<"users">[] {
  return meeting.hostUserIds ?? [];
}

/** True when the user is one of the meeting's hosts. */
export function isMeetingHost(
  meeting: Doc<"meetings">,
  userId: Id<"users">,
): boolean {
  return getHostUserIds(meeting).some((id) => id === userId);
}

/**
 * The users who should be seated as admins of the event chat and notified on
 * RSVP. Returns hosts when set, otherwise the group's active leaders. Single
 * source of truth — keep in sync with the edit-access rule in
 * `canEditMeeting` and the chat-access rule in `canAccessEventChannel`.
 */
export async function resolveEventAdmins(
  ctx: Ctx,
  meeting: Doc<"meetings">,
): Promise<Id<"users">[]> {
  const hosts = getHostUserIds(meeting);
  if (hosts.length > 0) return hosts;

  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_group", (q: any) => q.eq("groupId", meeting.groupId))
    .collect();
  return memberships
    .filter((m: any) => isActiveLeader(m))
    .map((m: any) => m.userId as Id<"users">);
}

/**
 * Can this user create an event in this group?
 * Per ADR-022: any active member of the group. Announcement groups
 * auto-include every member of the community (ADR-008), so all community
 * members can create community-wide events.
 */
export async function canCreateInGroup(
  ctx: Ctx,
  userId: Id<"users">,
  groupId: Id<"groups">
): Promise<{ allowed: boolean; isLeader: boolean }> {
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", groupId).eq("userId", userId)
    )
    .first();

  if (!isActiveMember(membership)) {
    return { allowed: false, isLeader: false };
  }
  return { allowed: true, isLeader: isActiveLeader(membership) };
}

/**
 * Can this user edit/cancel this meeting?
 * Per ADR-022 + hosts: host OR group leader OR community admin. When
 * `hostUserIds` is empty, falls back to the creator.
 */
export async function canEditMeeting(
  ctx: Ctx,
  userId: Id<"users">,
  meeting: Doc<"meetings">
): Promise<boolean> {
  if (isMeetingHost(meeting, userId)) {
    return true;
  }

  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", meeting.groupId).eq("userId", userId)
    )
    .first();
  if (isActiveLeader(membership)) {
    return true;
  }

  if (meeting.communityId) {
    return await isCommunityAdmin(ctx, meeting.communityId, userId);
  }
  return false;
}

/**
 * Can this user apply a series-wide edit or cancel from this anchor meeting?
 * Tighter than `canEditMeeting`: the bare creator of one sibling should NOT
 * be able to cascade changes to meetings they don't own or lead. Required
 * for `scope === "all_in_series"` paths.
 */
export async function canEditSeriesWide(
  ctx: Ctx,
  userId: Id<"users">,
  meeting: Doc<"meetings">
): Promise<boolean> {
  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q: any) =>
      q.eq("groupId", meeting.groupId).eq("userId", userId)
    )
    .first();
  if (isActiveLeader(membership)) return true;
  if (meeting.communityId) {
    return await isCommunityAdmin(ctx, meeting.communityId, userId);
  }
  return false;
}

/**
 * Count a user's current "future events being hosted" for the non-leader cap.
 * Future event = status ∈ {scheduled, confirmed} AND scheduledAt > now AND
 * the user is in `hostUserIds`. Cancelled and completed don't count. Scoped
 * to a community so a user hosting in community A isn't throttled when
 * creating in community B. See ADR-022.
 *
 * Counts by `hostUserIds`, not `createdById`, so the cap matches what the
 * user sees as "their" upcoming events (Events tab → "My Events" carousel,
 * Profile → My Events Hosted). Creating an event for someone else doesn't
 * count against your cap — only events you're actually hosting do.
 */
export async function countFutureEventsHostedBy(
  ctx: Ctx,
  userId: Id<"users">,
  nowMs: number,
  communityId: Id<"communities">
): Promise<number> {
  // No multi-value index on hostUserIds, so we scan future meetings in the
  // community via the (communityId, scheduledAt) compound index and filter
  // host membership in memory. Bounded by future events in this community.
  const rows = await ctx.db
    .query("meetings")
    .withIndex("by_community_scheduledAt", (q: any) =>
      q.eq("communityId", communityId).gt("scheduledAt", nowMs)
    )
    .collect();
  return rows.filter(
    (m: Doc<"meetings">) =>
      (m.status === "scheduled" || m.status === "confirmed") &&
      isMeetingHost(m, userId)
  ).length;
}

export const NON_LEADER_FUTURE_EVENT_CAP = 1;
