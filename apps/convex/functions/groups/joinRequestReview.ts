/**
 * Shared join-request review logic.
 *
 * A pending join request is a `groupMembers` row with `requestStatus === "pending"`.
 * Accepting/declining one has side effects (channel sync, score recomputation,
 * welcome + follow-up bots, and an approval notification to the requester) that
 * must be identical no matter who performs the review. Both review surfaces call
 * this single helper:
 *   - admin dashboard  -> admin/requests.ts:reviewPendingRequest
 *   - group-page leaders -> groupMembers.ts:reviewGroupJoinRequest
 */

import { internal } from "../../_generated/api";
import type { MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { now } from "../../lib/utils";
import { syncUserChannelMembershipsLogic } from "../sync/memberships";

/**
 * Apply an accept/decline decision to a pending join request.
 *
 * @returns the updated membership row (or null if it vanished mid-flight).
 */
export async function applyJoinRequestReview(
  ctx: MutationCtx,
  opts: {
    membership: Doc<"groupMembers">;
    action: "accept" | "decline";
    reviewerId: Id<"users">;
  },
): Promise<Doc<"groupMembers"> | null> {
  const { membership, action, reviewerId } = opts;
  const timestamp = now();

  if (action === "accept") {
    await ctx.db.patch(membership._id, {
      requestStatus: "accepted",
      leftAt: undefined,
      joinedAt: timestamp,
      requestReviewedAt: timestamp,
      requestReviewedById: reviewerId,
    });

    // Sync channel memberships so the user can access group chat (transactional)
    await syncUserChannelMembershipsLogic(
      ctx,
      membership.userId,
      membership.groupId,
    );

    // Create/update followup score for the approved member (non-blocking)
    await ctx.scheduler.runAfter(
      0,
      internal.functions.followupScoreComputation.computeSingleMemberScore,
      { groupId: membership.groupId, groupMemberId: membership._id },
    );

    await ctx.scheduler.runAfter(
      0,
      internal.functions.communityScoreComputation.recomputeForGroupMember,
      { groupId: membership.groupId, userId: membership.userId },
    );

    // Returning-member detection: for a brand-new member joinedAt, leftAt and
    // requestedAt are all stamped together at request time, so joinedAt ===
    // requestedAt. A returning member keeps their original joinedAt, so the two
    // differ. Only new members get the welcome + follow-up bots.
    const isReturningMember = membership.joinedAt !== membership.requestedAt;
    if (!isReturningMember) {
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduledJobs.sendWelcomeMessage,
        { groupId: membership.groupId, userId: membership.userId },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.functions.scheduledJobs.assignNewMemberFollowup,
        { groupId: membership.groupId, userId: membership.userId },
      );
    }

    // Notify the requester that they were approved (push + email + record).
    await ctx.scheduler.runAfter(
      0,
      internal.functions.notifications.senders.notifyJoinRequestApproved,
      { userId: membership.userId, groupId: membership.groupId },
    );
  } else {
    await ctx.db.patch(membership._id, {
      requestStatus: "declined",
      requestReviewedAt: timestamp,
      requestReviewedById: reviewerId,
    });
  }

  return await ctx.db.get(membership._id);
}
