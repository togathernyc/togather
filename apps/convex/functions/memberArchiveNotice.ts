/**
 * Pre-Archive Check-In Notice
 *
 * Members are auto-archived (hidden from the People view) after
 * INACTIVITY_THRESHOLD_MS (60 days) with no activity — see
 * computePersonActiveState in communityScoreComputation.ts.
 *
 * This module sends a one-time "time to check in" nudge to a member's leaders
 * and assignees ~1 week BEFORE that happens, so someone can reach out while the
 * person is still surfaced. Recipients are:
 *   - the leaders/admins explicitly assigned to the person (assigneeIds), and
 *   - the leaders of the person's groups (e.g. their Dinner Party).
 *
 * It piggybacks on the daily community-score pipeline rather than a separate
 * cron: computeCommunityScores schedules sendCommunityPreArchiveNotices per
 * community right after it refreshes each person's active/archived state. The
 * sweep scans the announcement-group communityPeople rows (the canonical
 * per-person record) for people in the pre-archive window and notifies once per
 * inactivity spell.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { now } from "../lib/utils";
import { isLeaderRole } from "../lib/helpers";
import { notifyBatch } from "../lib/notifications/send";
import {
  INACTIVITY_THRESHOLD_MS,
  mostRecentTimestamp,
} from "./communityScoreComputation";

// ============================================================================
// Constants
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long before auto-archive the check-in notice fires (the "week before"). */
export const PRE_ARCHIVE_NOTICE_LEAD_MS = 7 * DAY_MS;

/** communityPeople rows scanned per page during the per-community sweep. */
const CANDIDATE_PAGE_SIZE = 100;

// ============================================================================
// Pure decision logic (unit-tested)
// ============================================================================

/**
 * Decide whether to send the pre-archive check-in notice for a person.
 *
 * Fires when an active person's most recent activity is inside the lead window
 * just before the 60-day auto-archive cutoff (i.e. ~53–60 days stale), and the
 * notice hasn't already gone out for this inactivity spell.
 *
 * `noticeSentAt >= activityTs` means we already notified since the last time the
 * person did anything — so we stay quiet. If they engage again (which bumps
 * `activityTs` past the old `noticeSentAt`) and later go quiet, a fresh notice
 * is allowed. Activity signals mirror the archive logic: app opens, attendance,
 * serving — falling back to `addedAt` for members who never engaged.
 */
export function shouldSendPreArchiveNotice(params: {
  nowTs: number;
  isActive?: boolean;
  lastActivityTs?: number;
  addedAt?: number;
  noticeSentAt?: number;
}): boolean {
  const { nowTs, isActive, lastActivityTs, addedAt, noticeSentAt } = params;

  // Already archived — nothing to pre-warn about.
  if (isActive === false) return false;

  const activityTs = lastActivityTs ?? addedAt;
  if (activityTs == null) return false;

  const age = nowTs - activityTs;
  const windowStart = INACTIVITY_THRESHOLD_MS - PRE_ARCHIVE_NOTICE_LEAD_MS;
  const inWindow = age > windowStart && age <= INACTIVITY_THRESHOLD_MS;
  if (!inWindow) return false;

  // Already notified during the current inactivity spell.
  if (noticeSentAt != null && noticeSentAt >= activityTs) return false;

  return true;
}

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Page through an announcement group's communityPeople rows and return the
 * people currently inside the pre-archive window who still need a notice.
 */
export const getPreArchiveCandidatesPage = internalQuery({
  args: {
    announcementGroupId: v.id("groups"),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const nowTs = now();
    const result = await ctx.db
      .query("communityPeople")
      .withIndex("by_group", (q) => q.eq("groupId", args.announcementGroupId))
      .paginate({ numItems: args.limit, cursor: args.cursor ?? null });

    const candidates = result.page
      .filter((row) =>
        shouldSendPreArchiveNotice({
          nowTs,
          isActive: row.isActive,
          lastActivityTs: mostRecentTimestamp(
            row.lastActiveAt,
            row.lastAttendedAt,
            row.lastServedAt,
          ),
          addedAt: row.addedAt,
          noticeSentAt: row.preArchiveNoticeSentAt,
        }),
      )
      .map((row) => ({
        userId: row.userId,
        communityId: row.communityId,
        firstName: row.firstName,
        lastName: row.lastName,
        assigneeIds: row.assigneeIds ?? [],
      }));

    return {
      candidates,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Resolve who should be told to check in on a person: their explicit assignees
 * plus the leaders of their groups (excluding the announcement group, whose
 * "leaders" are all community admins, and the person themselves).
 */
export const getPreArchiveRecipients = internalQuery({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    assigneeIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const recipients = new Set<string>();

    for (const assigneeId of args.assigneeIds) {
      if (assigneeId !== args.userId) recipients.add(assigneeId);
    }

    const memberships = await ctx.db
      .query("groupMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    for (const membership of memberships) {
      if (membership.leftAt !== undefined) continue;

      const group = await ctx.db.get(membership.groupId);
      // Only notify leaders of the candidate's own community. A user can belong
      // to groups across communities; without this guard, leaders of an
      // unrelated community would receive the check-in (leaking the member name
      // and originating community id).
      if (!group || group.communityId !== args.communityId) continue;
      if (group.isAnnouncementGroup) continue;

      const groupMembers = await ctx.db
        .query("groupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", membership.groupId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();

      for (const m of groupMembers) {
        if (m.userId !== args.userId && isLeaderRole(m.role)) {
          recipients.add(m.userId);
        }
      }
    }

    return [...recipients] as Id<"users">[];
  },
});

// ============================================================================
// Internal Mutations
// ============================================================================

/**
 * Record that the pre-archive notice was sent for a person. Stamped on every
 * communityPeople row for the person so the spell check stays consistent
 * regardless of which group row is read next.
 */
export const markPreArchiveNoticeSent = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("communityPeople")
      .withIndex("by_community_user", (q) =>
        q.eq("communityId", args.communityId).eq("userId", args.userId),
      )
      .collect();

    for (const row of rows) {
      await ctx.db.patch(row._id, { preArchiveNoticeSentAt: args.sentAt });
    }
  },
});

// ============================================================================
// Actions
// ============================================================================

/**
 * Scan one community for people approaching auto-archive and notify their
 * leaders/assignees. Marks each person as notified so the nudge is one-shot
 * per inactivity spell.
 *
 * Scheduled by computeCommunityScores once that community's daily score refresh
 * has committed fresh active/archived state — no separate cron of its own.
 */
export const sendCommunityPreArchiveNotices = internalAction({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const announcementGroup = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAnnouncementGroup,
      { communityId: args.communityId },
    );
    if (!announcementGroup) return;

    let cursor: string | undefined = undefined;
    let isDone = false;
    let notified = 0;

    while (!isDone) {
      const page: {
        candidates: Array<{
          userId: Id<"users">;
          communityId: Id<"communities">;
          firstName?: string;
          lastName?: string;
          assigneeIds: Id<"users">[];
        }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(
        internal.functions.memberArchiveNotice.getPreArchiveCandidatesPage,
        {
          announcementGroupId: announcementGroup._id,
          cursor,
          limit: CANDIDATE_PAGE_SIZE,
        },
      );

      for (const candidate of page.candidates) {
        const recipients: Id<"users">[] = await ctx.runQuery(
          internal.functions.memberArchiveNotice.getPreArchiveRecipients,
          {
            communityId: candidate.communityId,
            userId: candidate.userId,
            assigneeIds: candidate.assigneeIds,
          },
        );

        // No one to tell — leave the person unmarked so a later-assigned leader
        // can still be notified while the person is in the window.
        if (recipients.length === 0) continue;

        const memberName =
          [candidate.firstName, candidate.lastName]
            .filter(Boolean)
            .join(" ") || "A member";

        await notifyBatch(ctx, {
          type: "member.pre_archive_checkin",
          userIds: recipients,
          communityId: candidate.communityId,
          data: {
            memberName,
            communityId: candidate.communityId,
            userId: candidate.userId,
          },
        });

        await ctx.runMutation(
          internal.functions.memberArchiveNotice.markPreArchiveNoticeSent,
          {
            communityId: candidate.communityId,
            userId: candidate.userId,
            sentAt: now(),
          },
        );
        notified++;
      }

      isDone = page.isDone;
      cursor = page.continueCursor;
    }

    if (notified > 0) {
      console.log(
        `[pre-archive-notice] Sent ${notified} check-in notice(s) for community ${args.communityId}`,
      );
    }
  },
});
