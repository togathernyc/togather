/**
 * Leadership relationship (DM sender → recipient).
 *
 * Used to decide whether a 1:1 DM skips the "message request" step and which
 * first-message notification copy to use. A DM from someone with a leadership
 * tie to the recipient lands as a normal (accepted) DM instead of a pending
 * request, and its first message carries relationship-specific copy so the
 * recipient understands why the sender is suddenly in their inbox.
 */

import type { Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { isActiveLeader, isActiveMembership } from "./helpers";
import { isCommunityAdmin } from "./permissions";

/**
 * The kinds of leadership relationship a DM sender can have with the recipient,
 * in precedence order (first match wins): a co-leader of a shared group beats a
 * group leader, which beats a community admin. "none" means no relationship —
 * the DM behaves exactly as a normal request.
 */
export type LeaderDmRelationship =
  | "co_leader"
  | "group_leader"
  | "community_admin"
  | "none";

/**
 * Resolve the sender's leadership relationship to the recipient within a single
 * community. Precedence (first match wins):
 *
 *   1. "co_leader"       — both are active leaders of the same group.
 *   2. "group_leader"    — sender is an active leader of a group the recipient
 *                          is an active member of (any role).
 *   3. "community_admin" — sender is a community admin.
 *   4. "none"            — no relationship.
 *
 * Co-leader is checked before group-leader because a co-lead pair are also both
 * *members* of the shared group (so they'd satisfy the group-leader rule too) —
 * checking co-leader first gives the warmer peer copy. Group-leader is checked
 * before community-admin because "community leader" reads as intimidating; it's
 * only the fallback when there's no closer (group-level) tie.
 *
 * Community-scoped: only groups belonging to `communityId` are considered.
 */
export async function getLeaderDmRelationship(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  senderId: Id<"users">,
  recipientId: Id<"users">,
): Promise<LeaderDmRelationship> {
  // Groups in THIS community where the sender is an active leader.
  const senderMemberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", senderId))
    .collect();

  const leaderGroupIds: Id<"groups">[] = [];
  for (const row of senderMemberships) {
    if (!isActiveLeader(row)) continue;
    const group = await ctx.db.get(row.groupId);
    // DMs are per-community; only leadership inside this community counts.
    if (!group || group.communityId !== communityId) continue;
    leaderGroupIds.push(row.groupId);
  }

  // Walk the sender's leader-groups once. A co-leader match (recipient is an
  // active leader of the same group) wins outright; otherwise note whether the
  // recipient is an active member of any of them (group-leader relationship).
  let isGroupLeaderOfRecipient = false;
  for (const groupId of leaderGroupIds) {
    const recipientRow = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", groupId).eq("userId", recipientId),
      )
      .first();
    if (!isActiveMembership(recipientRow)) continue;
    if (isActiveLeader(recipientRow)) {
      return "co_leader";
    }
    isGroupLeaderOfRecipient = true;
  }
  if (isGroupLeaderOfRecipient) return "group_leader";

  if (await isCommunityAdmin(ctx, communityId, senderId)) {
    return "community_admin";
  }

  return "none";
}
