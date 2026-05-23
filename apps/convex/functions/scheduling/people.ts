/**
 * Scheduling — community-people search for the AssignSheet
 *
 * Powers the "search by name" leg of the assign-from-community flow
 * (see `assignFromCommunity` in `./assignments.ts`). Returns active members
 * of the group's community whose name matches the search, flagging which
 * ones are already in the group so the UI can branch between
 *   • "Assign" (in-group)
 *   • "Add to group + assign" (community-only).
 *
 * Read gate matches `listTeams` — any active group member may search. The
 * write side (`assignFromCommunity` / `inviteAndAssign`) re-asserts the
 * stricter `requirePlanScheduler` check.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getMediaUrl } from "../../lib/utils";
import { requireGroupMember } from "./permissions";

/** Default cap on returned candidates. */
const DEFAULT_LIMIT = 30;
/** Hard cap to keep the query bounded even when callers pass a large limit. */
const MAX_LIMIT = 100;

/**
 * Build the user's display name the same way the rest of the app does:
 * "first last", trimmed, falling back to first name alone.
 */
function buildDisplayName(
  firstName: string | undefined,
  lastName: string | undefined,
): string {
  const first = (firstName ?? "").trim();
  const last = (lastName ?? "").trim();
  if (first && last) return `${first} ${last}`;
  return first || last || "Someone";
}

/**
 * Case-insensitive substring match across firstName, lastName, and the
 * combined "first last" display name. Empty search returns everything (the
 * cap still applies).
 */
function matchesName(
  search: string,
  firstName: string | undefined,
  lastName: string | undefined,
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  const haystacks = [
    (firstName ?? "").toLowerCase(),
    (lastName ?? "").toLowerCase(),
    buildDisplayName(firstName, lastName).toLowerCase(),
  ];
  return haystacks.some((h) => h.includes(needle));
}

/**
 * Search active members of a group's community by name, flagging in-group
 * status. The caller is excluded — you cannot assign yourself through this
 * sheet, and listing yourself in the candidate set would be noise.
 *
 * Sort: in-group candidates first (alpha by display name), then
 * community-only candidates (alpha by display name). Capped at `limit`.
 *
 * Auth: active group member or community admin (same gate as `listTeams`).
 */
export const searchCommunityPeople = query({
  args: {
    token: v.string(),
    groupId: v.id("groups"),
    search: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const callerId = await requireAuth(ctx, args.token);
    const group = await requireGroupMember(ctx, args.groupId, callerId);

    const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Active community members (status === 1). The community-people list is
    // the candidate pool; we'll annotate each with their in-group status.
    const memberships = await ctx.db
      .query("userCommunities")
      .withIndex("by_community", (q) => q.eq("communityId", group.communityId))
      .filter((q) => q.eq(q.field("status"), 1))
      .collect();

    // Pre-fetch active group memberships once so we can flag candidates
    // without N round-trips.
    const groupMemberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    const activeGroupUserIds = new Set<string>(
      groupMemberships
        .filter(
          (m) =>
            !m.leftAt &&
            (!m.requestStatus || m.requestStatus === "accepted"),
        )
        .map((m) => m.userId),
    );

    type Candidate = {
      userId: Id<"users">;
      firstName: string;
      lastName?: string;
      displayName: string;
      profilePhoto?: string;
      phone?: string;
      isPlaceholder: boolean;
      inGroup: boolean;
    };

    const candidates: Candidate[] = [];
    for (const membership of memberships) {
      if (membership.userId === callerId) continue;
      const user = await ctx.db.get(membership.userId);
      if (!user) continue;
      // isActive can be undefined for legacy rows — treat undefined as active
      // to match the rest of the app, but exclude rows explicitly flagged false
      // (e.g. unclaimed placeholders are surfaced via `isPlaceholder`, not by
      // becoming searchable as real users — but we still want them in the
      // pool so leaders see "already invited" rather than re-inviting).
      // We deliberately keep placeholders in results; the `isPlaceholder` flag
      // lets the UI render them distinctly.
      if (!matchesName(args.search, user.firstName, user.lastName)) continue;

      const firstName = (user.firstName ?? "").trim();
      candidates.push({
        userId: user._id,
        firstName,
        lastName: user.lastName?.trim() || undefined,
        displayName: buildDisplayName(user.firstName, user.lastName),
        profilePhoto: getMediaUrl(user.profilePhoto),
        phone: user.phone || undefined,
        isPlaceholder: user.isPlaceholder === true,
        inGroup: activeGroupUserIds.has(user._id),
      });
    }

    // In-group first, then community-only; alpha within each bucket.
    candidates.sort((a, b) => {
      if (a.inGroup !== b.inGroup) return a.inGroup ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return candidates.slice(0, limit);
  },
});
