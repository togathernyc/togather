/**
 * Meeting permission helpers
 *
 * Centralizes the "who can edit/cancel/create this meeting" logic that
 * ADR-022 introduces. Before PR 2, only group leaders could touch meetings;
 * now the creator of the meeting + group leaders + community admins can.
 */

import type { Doc, Id } from "../_generated/dataModel";
import { isActiveLeader, isActiveMember } from "./helpers";
import { isCommunityAdmin } from "./permissions";

type Ctx = { db: any };

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
 * Per ADR-022: creator OR group leader OR community admin.
 */
export async function canEditMeeting(
  ctx: Ctx,
  userId: Id<"users">,
  meeting: Doc<"meetings">
): Promise<boolean> {
  if (meeting.createdById && meeting.createdById === userId) {
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
 * Count a user's current "future events" for the non-leader cap.
 * Future event = status ∈ {scheduled, confirmed} AND scheduledAt > now.
 * Cancelled and completed don't count. See ADR-022.
 */
export async function countFutureEventsCreatedBy(
  ctx: Ctx,
  userId: Id<"users">,
  nowMs: number
): Promise<number> {
  const rows = await ctx.db
    .query("meetings")
    .withIndex("by_createdBy", (q: any) => q.eq("createdById", userId))
    .collect();
  return rows.filter(
    (m: Doc<"meetings">) =>
      (m.status === "scheduled" || m.status === "confirmed") &&
      m.scheduledAt > nowMs
  ).length;
}

export const NON_LEADER_FUTURE_EVENT_CAP = 1;

/**
 * Validates the locationMode / location pair.
 * - "address": locationOverride must be non-empty
 * - "online": meetingLink must be non-empty
 * - "tbd": no location required
 * Called from create/update before writing. See ADR-022.
 */
export function validateLocationMode(args: {
  locationMode?: "address" | "online" | "tbd";
  locationOverride?: string;
  meetingLink?: string;
}): void {
  if (!args.locationMode) return; // legacy path; creation screen always sends one

  if (args.locationMode === "address" && !args.locationOverride?.trim()) {
    throw new Error("Location address is required when location mode is 'address'");
  }
  if (args.locationMode === "online" && !args.meetingLink?.trim()) {
    throw new Error("Meeting link is required when location mode is 'online'");
  }
}
