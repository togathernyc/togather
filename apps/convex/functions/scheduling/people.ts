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
 * Implementation: delegates to the shared `searchCommunityMembersInternal`
 * helper so this stays in lock-step with the admin People search and the
 * group "Add people" picker — same `users.search_users` full-text index,
 * same isActive/isPlaceholder treatment, same phone-normalization
 * behaviour. A naïve `.collect()` of the whole community per keystroke
 * (the pre-refactor version) was O(community-size) and unusable at scale
 * — see PR #404 codex review.
 *
 * Read gate matches `listTeams` — any active group member may search. The
 * write side (`assignFromCommunity` / `inviteAndAssign`) re-asserts the
 * stricter `requirePlanScheduler` check.
 */

import { v } from "convex/values";
import { query } from "../../_generated/server";
import { requireAuth } from "../../lib/auth";
import { searchCommunityMembersInternal } from "../../lib/memberSearch";
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

    // Delegate to the shared helper — same search index + isActive /
    // isPlaceholder rules as the admin People and group Add People searches.
    // `annotateGroupId` makes each row carry `inGroup`; `fallbackToRecentWhenEmpty`
    // surfaces a sensible default list before the leader has typed anything.
    const rows = await searchCommunityMembersInternal(ctx, {
      communityId: group.communityId,
      search: args.search,
      excludeUserIds: [callerId],
      annotateGroupId: args.groupId,
      limit,
      fallbackToRecentWhenEmpty: true,
    });

    const candidates = rows.map((row) => ({
      userId: row.id,
      firstName: row.firstName,
      lastName: row.lastName || undefined,
      displayName: buildDisplayName(row.firstName, row.lastName),
      profilePhoto: row.profilePhoto ?? undefined,
      phone: row.phone ?? undefined,
      isPlaceholder: row.isPlaceholder === true,
      inGroup: row.inGroup === true,
    }));

    // In-group first, then community-only; alpha within each bucket. The
    // helper does not guarantee this ordering — it sorts by the search
    // index's relevance + last-login, which is the right call for the
    // admin People page but not for the AssignSheet where leaders need to
    // see who's already on the team first.
    candidates.sort((a, b) => {
      if (a.inGroup !== b.inGroup) return a.inGroup ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return candidates;
  },
});
