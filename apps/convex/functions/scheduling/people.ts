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

/** Default cap on returned candidates when the leader is searching. */
const DEFAULT_LIMIT = 30;
/** Hard cap to keep the SEARCH path bounded even when callers pass a large limit. */
const MAX_LIMIT = 100;
/**
 * Cap on the EMPTY-search (full-list) path — roster #477 FR-1. Large enough to
 * return every assignable member of a very large church group (≥500) without
 * search-gating the population; mirrors the helper's `GROUP_COMPLETE_LIMIT`.
 */
const GROUP_FULL_LIST_LIMIT = 1000;

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
 * status. The caller IS included — leaders often serve on their own teams, so
 * they must be able to assign themselves through this sheet.
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
    // surfaces wider-community people before the leader has typed anything; and
    // `includeAllGroupMembersWhenEmpty` guarantees EVERY assignable group
    // member is in the set on empty search (roster #477 FR-1) — not just a
    // recency slice. A volunteer who hasn't logged in recently must be findable
    // without typing their name.
    //
    // On EMPTY search, pass a high limit (`GROUP_FULL_LIST_LIMIT`) so the full
    // group population survives the helper's truncation before the in-group-
    // first re-sort below; we deliberately do NOT slice the empty-search result
    // (completeness > the recency cap — FR-1.1/FR-1.4). When the leader is
    // SEARCHING, the search index already covers everyone, so we keep the
    // tighter `MAX_LIMIT` and slice as before.
    //
    // Read cost is bounded: the helper sources completeness from the group's
    // OWN membership (O(group size)) and caps the wider-community recency tail
    // to a small constant — it does NOT over-fetch the community in proportion
    // to `GROUP_FULL_LIST_LIMIT`. (Earlier the tail scaled with this 1000
    // ceiling → up to 3000 `userCommunities` reads → past Convex's per-query
    // cap → the query threw → infinite spinner on larger communities.)
    const isEmptySearch = args.search.trim().length === 0;
    const rows = await searchCommunityMembersInternal(ctx, {
      communityId: group.communityId,
      search: args.search,
      annotateGroupId: args.groupId,
      limit: isEmptySearch ? GROUP_FULL_LIST_LIMIT : MAX_LIMIT,
      fallbackToRecentWhenEmpty: true,
      includeAllGroupMembersWhenEmpty: args.groupId,
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

    // On empty search return the COMPLETE list (FR-1) — slicing to `limit`
    // here would re-introduce the very recency cap the fix removes. The leader
    // can still pass a small `limit` for the SEARCH path (e.g. typeahead). The
    // client scrolls / virtualizes the full list (FR-1.4 / FR-9).
    if (isEmptySearch) {
      return candidates;
    }
    return candidates.slice(0, limit);
  },
});
