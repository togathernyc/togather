/**
 * Community-Level Score Computation Pipeline
 *
 * Maintains the `communityPeople` table — the community-wide view of all members
 * with system scores (Service, Attendance, Connection). Scores are recomputed:
 *   1. Daily via cron (time-decay scores shift each day)
 *   2. On-demand for a single member after followup actions
 *   3. Via backfill CLI command
 *
 * This pipeline runs ALONGSIDE the existing per-group pipeline
 * (followupScoreComputation.ts). The old pipeline continues untouched.
 *
 * Key differences from the per-group pipeline:
 * - Uses the announcement group as the canonical member list
 * - Computes system scores (fixed 3 scores) instead of configurable per-group scores
 * - Cross-group attendance is always computed (not optional)
 * - Writes to `communityPeople` table instead of `memberFollowupScores`
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { now, getMediaUrl, safeSliceForJson, getWeekStart } from "../lib/utils";
import {
  extractSystemRawValues,
  calculateAllSystemScores,
  evaluateSystemAlerts,
} from "./systemScoring";

// ============================================================================
// Constants
// ============================================================================

/** Members per page during batch processing */
const BATCH_SIZE = 100;

/** Users per cross-group attendance sub-batch (keeps reads under Convex limits) */
const CROSS_GROUP_BATCH_SIZE = 10;

/** Millisecond interval between staggered community score jobs */
const STAGGER_INTERVAL_MS = 3000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A person is auto-archived after this long with no activity. */
export const INACTIVITY_THRESHOLD_MS = 60 * DAY_MS;

/** Largest of the given timestamps, ignoring undefined. */
export function mostRecentTimestamp(
  ...timestamps: Array<number | undefined>
): number | undefined {
  let max: number | undefined;
  for (const ts of timestamps) {
    if (ts != null && (max == null || ts > max)) max = ts;
  }
  return max;
}

/**
 * Decide a person's active/archived state during the daily score refresh.
 *
 * `lastActivityTs` is the most recent of a person's real activity signals —
 * opening the app, attending a meeting, or serving (see the call site). Leader
 * actions (followups) are NOT counted; this is the person's own engagement.
 *
 * Rules (see the `isActive`/`archivedAt` fields in schema.ts):
 * - A manual or automatic archive sticks. The daily job never resurrects an
 *   archived person on its own.
 * - The ONE thing that reactivates an archived person is fresh activity after
 *   the archive: if `lastActivityTs` is newer than the moment they were archived,
 *   clear the flag. (For records archived before `archivedAt` was tracked, fall
 *   back to "active within the inactivity window".)
 * - An active person is auto-archived once they go quiet for the threshold.
 *   People with no recorded activity have no `lastActivityTs`, so we fall back to
 *   `addedAt` (date added).
 */
export function computePersonActiveState(params: {
  nowTs: number;
  lastActivityTs?: number;
  addedAt?: number;
  currentIsActive?: boolean;
  currentArchivedAt?: number;
}): { isActive: boolean; archivedAt: number | undefined } {
  const { nowTs, lastActivityTs, addedAt, currentIsActive, currentArchivedAt } =
    params;

  if (currentIsActive === false) {
    // Archived. Only activity that happened AFTER archiving brings them back.
    const activeSinceArchive =
      lastActivityTs != null &&
      (currentArchivedAt != null
        ? lastActivityTs > currentArchivedAt
        : nowTs - lastActivityTs <= INACTIVITY_THRESHOLD_MS);
    return activeSinceArchive
      ? { isActive: true, archivedAt: undefined }
      : { isActive: false, archivedAt: currentArchivedAt };
  }

  // Active (or brand new). Auto-archive once activity goes stale.
  const activityTs = lastActivityTs ?? addedAt;
  if (activityTs != null && nowTs - activityTs > INACTIVITY_THRESHOLD_MS) {
    return { isActive: false, archivedAt: nowTs };
  }
  return { isActive: true, archivedAt: undefined };
}

// ============================================================================
// Internal Queries
// ============================================================================

/**
 * Find the announcement group for a community.
 * Every community has exactly one group with isAnnouncementGroup === true.
 */
export const getAnnouncementGroup = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .filter((q) => q.eq(q.field("isAnnouncementGroup"), true))
      .first();

    return groups;
  },
});

/**
 * Get all community IDs (for daily cron fan-out).
 * Derives communities from those that have an announcement group.
 */
export const getAllCommunityIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const communities = await ctx.db.query("communities").collect();
    return communities.map((c) => c._id);
  },
});

/**
 * Get the community's custom alert configuration.
 */
export const getCommunityAlertConfig = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    const community = await ctx.db.get(args.communityId);
    return community?.alertConfig ?? null;
  },
});

/**
 * Get a paginated list of community members via the announcement group.
 * Returns member data with denormalized user info for upsert.
 */
export const getCommunityMembers = internalQuery({
  args: {
    communityId: v.id("communities"),
    announcementGroupId: v.id("groups"),
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const query = ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.announcementGroupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined));

    const result = await query.paginate({
      numItems: args.limit,
      cursor: args.cursor ?? null,
    });

    // Fetch user data for denormalization
    const membersWithUsers = await Promise.all(
      result.page.map(async (member) => {
        const [user, communityMembership] = await Promise.all([
          ctx.db.get(member.userId),
          ctx.db
            .query("userCommunities")
            .withIndex("by_user_community", (q) =>
              q.eq("userId", member.userId).eq("communityId", args.communityId)
            )
            .first(),
        ]);
        return {
          groupMemberId: member._id,
          userId: member.userId,
          joinedAt: member.joinedAt,
          firstName: user?.firstName || "",
          lastName: user?.lastName || "",
          avatarUrl: getMediaUrl(user?.profilePhoto),
          email: user?.email,
          phone: user?.phone,
          zipCode: user?.zipCode,
          lastActiveAt: communityMembership?.lastLogin ?? user?.lastLogin,
        };
      })
    );

    return {
      members: membersWithUsers,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Score a batch of community members using system scores.
 *
 * For each member:
 * 1. Fetches their followup records from the announcement group
 * 2. Computes days-since for each followup type
 * 3. Reads PCO serving count from announcement group's pcoServingCounts
 * 4. Uses cross-group attendance from the pre-computed map
 * 5. Calculates system scores and evaluates alerts
 */
export const computeCommunityScoresBatch = internalQuery({
  args: {
    communityId: v.id("communities"),
    announcementGroupId: v.id("groups"),
    members: v.array(
      v.object({
        groupMemberId: v.id("groupMembers"),
        userId: v.id("users"),
        joinedAt: v.number(),
        firstName: v.string(),
        lastName: v.string(),
        avatarUrl: v.optional(v.string()),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        zipCode: v.optional(v.string()),
        lastActiveAt: v.optional(v.number()),
      })
    ),
    crossGroupAttendanceMap: v.optional(v.any()),
    customAlerts: v.optional(
      v.array(
        v.object({
          id: v.string(),
          variableId: v.string(),
          operator: v.string(),
          threshold: v.number(),
          label: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const currentTime = now();
    const announcementGroup = await ctx.db.get(args.announcementGroupId);

    // Build PCO serving map from announcement group doc
    const pcoServingMap = new Map<string, number>();
    if (announcementGroup?.pcoServingCounts?.counts) {
      for (const { userId, count } of announcementGroup.pcoServingCounts
        .counts) {
        pcoServingMap.set(userId.toString(), count);
      }
    }

    // Most recent serving date per user (counts as activity for archiving).
    const pcoLastServedMap = new Map<string, number>();
    if (announcementGroup?.pcoServingCounts?.servingDetails) {
      for (const { userId, date } of announcementGroup.pcoServingCounts
        .servingDetails) {
        const ts = Date.parse(date);
        if (!Number.isFinite(ts)) continue;
        const key = userId.toString();
        const prev = pcoLastServedMap.get(key);
        if (prev == null || ts > prev) pcoLastServedMap.set(key, ts);
      }
    }

    const results = await Promise.all(
      args.members.map(async (member) => {
        // Fetch followups for this member in the announcement group.
        // The top-20 window is used only for snooze/note state, both of which
        // are always written at `now` — so back-dating doesn't affect them.
        const followups = await ctx.db
          .query("memberFollowups")
          .withIndex("by_groupMember_createdAt", (q) =>
            q.eq("groupMemberId", member.groupMemberId)
          )
          .order("desc")
          .take(20);

        // Contact-type recency must query per-type so a back-dated Log Past
        // contact (createdAt set to its occurrence time) is still picked up
        // even if there are 20+ newer rows of other types in between. Use
        // the (groupMember, type, createdAt) compound index so the lookup is
        // bounded to rows of that type — a filtered scan would walk the
        // whole history for members with no matching row.
        const latestByType = (type: string) =>
          ctx.db
            .query("memberFollowups")
            .withIndex("by_groupMember_type_createdAt", (q) =>
              q.eq("groupMemberId", member.groupMemberId).eq("type", type),
            )
            .order("desc")
            .first();

        const [lastInPersonRaw, lastCallRaw, lastTextRaw, lastNoteRaw] = await Promise.all([
          latestByType("followed_up"),
          latestByType("call"),
          latestByType("text"),
          latestByType("note"),
        ]);
        // .first() returns T | null; `daysSince` consumes T | undefined.
        const lastInPerson = lastInPersonRaw ?? undefined;
        const lastCall = lastCallRaw ?? undefined;
        const lastText = lastTextRaw ?? undefined;
        const lastNote = lastNoteRaw ?? undefined;
        // "Last contact" for the days-since-contact score signal: only the
        // three contact types (call / text / followed_up) — notes don't count.
        const contactCandidates = [lastInPerson, lastCall, lastText].filter(
          (f): f is NonNullable<typeof f> => f != null,
        );
        const lastFollowup =
          contactCandidates.length > 0
            ? contactCandidates.reduce((a, b) =>
                a.createdAt >= b.createdAt ? a : b,
              )
            : undefined;
        // `lastFollowupAt` (the displayed "Last Contact" column) tracks the
        // most recent touch of ANY kind, including notes — matches the
        // addFollowup mutation's monotonic patch. Without including notes,
        // a recompute right after a back-dated contact insert would roll
        // back lastFollowupAt and erase a newer note's timestamp.
        const lastTouchCandidates = [
          lastInPerson,
          lastCall,
          lastText,
          lastNote,
        ].filter((f): f is NonNullable<typeof f> => f != null);
        const lastTouchAt =
          lastTouchCandidates.length > 0
            ? lastTouchCandidates.reduce((a, b) =>
                a.createdAt >= b.createdAt ? a : b,
              ).createdAt
            : undefined;

        const daysSince = (entry: { createdAt: number } | undefined): number =>
          entry
            ? Math.floor((currentTime - entry.createdAt) / DAY_MS)
            : Infinity;

        // lastAttendedAt will be computed from cross-group data below
        let lastAttendedAt: number | undefined;

        // Check snooze state
        let snoozedUntil: number | undefined;
        for (const f of followups) {
          if (
            f.type === "snooze" &&
            f.snoozeUntil &&
            f.snoozeUntil > currentTime
          ) {
            snoozedUntil = f.snoozeUntil;
            break;
          }
        }

        // Latest note for display in notes cell — use the per-type indexed
        // lookup (same back-dated-row reasoning as contacts).
        const latestNote = lastNote?.content
          ? safeSliceForJson(lastNote.content, 200)
          : undefined;
        const latestNoteAt = lastNote?.createdAt ?? undefined;

        // Cross-group attendance data
        const crossGroupData = args.crossGroupAttendanceMap?.[
          member.userId.toString()
        ] as
          | { pct: number; attendedWeekStarts: number[]; meetingWeekStarts?: number[]; meetingEntries?: Array<{ scheduledAt: number; attended: boolean }> }
          | number // backwards-compat with legacy callers
          | undefined;

        let crossGroupPct: number;
        let attendedWeeksInWindow: number;
        let totalWeeksInWindow: number;
        let meetingWeeksInWindow: number;

        // Count distinct ISO weeks in the join-date-adjusted window
        const WEEK_MS = 7 * DAY_MS;
        const windowStart = Math.max(
          member.joinedAt,
          currentTime - 60 * DAY_MS,
        );
        const firstWeek = getWeekStart(windowStart);
        const lastWeek = getWeekStart(currentTime);

        if (crossGroupData && typeof crossGroupData === "object") {
          crossGroupPct = crossGroupData.pct;
          // Count ISO weeks spanned by the window (inclusive of both ends)
          totalWeeksInWindow = Math.max(
            1,
            Math.round((lastWeek - firstWeek) / WEEK_MS) + 1,
          );
          // Derive attended/meeting weeks from meetingEntries filtered by full
          // `scheduledAt >= member.joinedAt` — a week-start cutoff alone would
          // keep a meeting that ran earlier in the same ISO week the member
          // joined, even though they couldn't have attended it.
          if (crossGroupData.meetingEntries) {
            const eligible = crossGroupData.meetingEntries.filter(
              (e: any) => e.scheduledAt >= member.joinedAt,
            );
            const meetingWeeks = new Set<number>();
            const attendedWeeks = new Set<number>();
            for (const e of eligible) {
              const ws = getWeekStart(e.scheduledAt);
              meetingWeeks.add(ws);
              if (e.attended) attendedWeeks.add(ws);
            }
            meetingWeeksInWindow = meetingWeeks.size;
            attendedWeeksInWindow = attendedWeeks.size;
          } else {
            // Pre-meetingEntries fallback (kept for safety; current
            // internalCrossGroupAttendance always returns entries).
            attendedWeeksInWindow = crossGroupData.attendedWeekStarts.filter(
              (ws) => ws >= firstWeek,
            ).length;
            meetingWeeksInWindow = crossGroupData.meetingWeekStarts
              ? crossGroupData.meetingWeekStarts.filter((ws) => ws >= firstWeek).length
              : totalWeeksInWindow;
          }
        } else {
          // Legacy fallback: plain number percentage
          crossGroupPct = (crossGroupData as number) ?? 0;
          totalWeeksInWindow = Math.max(
            1,
            Math.round((lastWeek - firstWeek) / WEEK_MS) + 1,
          );
          attendedWeeksInWindow = Math.round(
            (crossGroupPct / 100) * totalWeeksInWindow,
          );
          meetingWeeksInWindow = totalWeeksInWindow;
        }

        // Consecutive missed weeks — walk back week-by-week through weeks that had
        // meetings (post-join) until we find one the member attended. Counting weeks
        // (not raw meeting entries) keeps the unit consistent with the displayed
        // "Weeks with meetings" so a member in multiple groups isn't penalized
        // multiple times for the same week.
        //
        // We derive both meeting-week and attended-week sets from `meetingEntries`
        // filtered by `scheduledAt >= member.joinedAt`. A week-start cutoff alone
        // would count a meeting that happened earlier in the same ISO week the
        // member joined — they had no chance to attend it.
        let consecutiveMissed = 0;
        if (
          crossGroupData &&
          typeof crossGroupData === "object" &&
          crossGroupData.meetingEntries
        ) {
          const eligibleEntries = crossGroupData.meetingEntries.filter(
            (e: any) => e.scheduledAt >= member.joinedAt,
          );
          const eligibleMeetingWeeks = new Set<number>();
          const eligibleAttendedWeeks = new Set<number>();
          for (const e of eligibleEntries) {
            const ws = getWeekStart(e.scheduledAt);
            eligibleMeetingWeeks.add(ws);
            if (e.attended) eligibleAttendedWeeks.add(ws);
          }
          const meetingWeeksDesc = [...eligibleMeetingWeeks].sort(
            (a, b) => b - a,
          );
          for (const ws of meetingWeeksDesc) {
            if (eligibleAttendedWeeks.has(ws)) break;
            consecutiveMissed++;
          }
          // Last attended date — actual meeting timestamp (not week start).
          // `meetingEntries` is sorted desc, so .find returns the most recent.
          const lastAttendedEntry = eligibleEntries.find((e: any) => e.attended);
          if (lastAttendedEntry) {
            lastAttendedAt = lastAttendedEntry.scheduledAt;
          }
        }

        // PCO serving count
        const pcoCount = pcoServingMap.get(member.userId.toString()) ?? 0;

        // Serving activity = most recent of PCO serving and native rostering
        // (roleAssignments). A non-declined assignment means the person is
        // rostered to serve, which counts as activity for archiving. Not
        // community-scoped: serving anywhere keeps the person active, and this
        // only ever prevents archiving (never hides someone), so it's safe.
        const rosterAssignments = await ctx.db
          .query("roleAssignments")
          .withIndex("by_user", (q) => q.eq("userId", member.userId))
          .order("desc")
          .take(50);
        let lastRosteredAt: number | undefined;
        for (const a of rosterAssignments) {
          if (a.status === "declined") continue;
          if (lastRosteredAt == null || a.eventDate > lastRosteredAt) {
            lastRosteredAt = a.eventDate;
          }
        }
        const lastServedAt = mostRecentTimestamp(
          pcoLastServedMap.get(member.userId.toString()),
          lastRosteredAt,
        );

        // Extract system raw values
        const rawValues = extractSystemRawValues({
          crossGroupAttendancePct: crossGroupPct,
          consecutiveMissed,
          attendedWeeksInWindow,
          totalWeeksInWindow,
          meetingWeeksInWindow,
          daysSinceLastFollowup: daysSince(lastFollowup),
          daysSinceLastInPerson: daysSince(lastInPerson),
          daysSinceLastCall: daysSince(lastCall),
          daysSinceLastText: daysSince(lastText),
          pcoServicesCount: pcoCount,
        });

        // Calculate scores and alerts
        const scores = calculateAllSystemScores(rawValues);
        const alerts = evaluateSystemAlerts(rawValues, args.customAlerts);

        // Build search text
        const searchText = [
          member.firstName,
          member.lastName,
          member.email,
          member.phone,
          member.phone?.replace(/^\+\d{1,3}/, ""),
        ]
          .filter(Boolean)
          .join(" ");

        return {
          userId: member.userId,
          firstName: member.firstName,
          lastName: member.lastName,
          avatarUrl: member.avatarUrl,
          email: member.email,
          phone: member.phone,
          zipCode: member.zipCode,
          searchText,
          score1: scores.score1,
          score2: scores.score2,
          score3: scores.score3,
          alerts,
          isSnoozed: !!snoozedUntil,
          snoozedUntil,
          rawValues,
          lastFollowupAt: lastTouchAt,
          lastActiveAt: member.lastActiveAt,
          lastAttendedAt,
          lastServedAt,
          addedAt: member.joinedAt,
          addedAtInv: Number.MAX_SAFE_INTEGER - member.joinedAt,
          latestNote,
          latestNoteAt,
        };
      })
    );

    return results;
  },
});

// ============================================================================
// Upsert Mutations
// ============================================================================

/**
 * Upsert a batch of scored members into the communityPeople table.
 *
 * On update: patches scores, alerts, denormalized info, rawValues.
 *   Preserves: status, assigneeIds, connectionPoint, custom fields, isSnoozed (if not recomputed).
 * On insert: creates a new row with all computed fields.
 */
export const upsertCommunityPeopleBatch = internalMutation({
  args: {
    communityId: v.id("communities"),
    groupId: v.id("groups"),
    scoredMembers: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const nowTs = Date.now();

    for (const member of args.scoredMembers) {
      const existing = await ctx.db
        .query("communityPeople")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", args.groupId).eq("userId", member.userId)
        )
        .first();

      // Fields updated on every score recomputation
      const scoreDoc = {
        communityId: args.communityId,
        groupId: args.groupId,
        userId: member.userId,
        firstName: member.firstName,
        lastName: member.lastName,
        avatarUrl: member.avatarUrl,
        email: member.email,
        phone: member.phone,
        zipCode: member.zipCode,
        searchText: member.searchText,
        score1: member.score1,
        score2: member.score2,
        score3: member.score3,
        alerts: member.alerts,
        isSnoozed: member.isSnoozed,
        snoozedUntil: member.snoozedUntil,
        rawValues: member.rawValues,
        lastFollowupAt: member.lastFollowupAt,
        lastActiveAt: member.lastActiveAt,
        lastAttendedAt: member.lastAttendedAt,
        addedAt: member.addedAt,
        addedAtInv: member.addedAt ? Number.MAX_SAFE_INTEGER - member.addedAt : undefined,
        latestNote: member.latestNote,
        latestNoteAt: member.latestNoteAt,
        updatedAt: nowTs,
      };

      if (existing) {
        // Patch preserves custom fields, status, assigneeIds, connectionPoint (not in scoreDoc)
        // Keep assigneeId in sync with assigneeIds for indexing
        const assigneeId = (existing as any).assigneeIds?.[0];
        const activeState = computePersonActiveState({
          nowTs,
          lastActivityTs: mostRecentTimestamp(
            member.lastActiveAt,
            member.lastAttendedAt,
            member.lastServedAt,
          ),
          addedAt: member.addedAt,
          currentIsActive: (existing as any).isActive,
          currentArchivedAt: (existing as any).archivedAt,
        });
        await ctx.db.patch(existing._id, {
          ...scoreDoc,
          assigneeId,
          isActive: activeState.isActive,
          archivedAt: activeState.archivedAt,
        });
      } else {
        // Check if user has a record in another group — copy leader-set fields
        const siblingRecord = await ctx.db
          .query("communityPeople")
          .withIndex("by_community_user", (q) =>
            q.eq("communityId", args.communityId).eq("userId", member.userId)
          )
          .first();

        const siblingAssigneeId = (siblingRecord as any)?.assigneeIds?.[0];
        // Inherit archive state from a sibling record (archiving applies to the
        // person across all their groups); otherwise derive it from activity.
        const activeState =
          siblingRecord && (siblingRecord as any).isActive === false
            ? {
                isActive: false,
                archivedAt: (siblingRecord as any).archivedAt ?? nowTs,
              }
            : computePersonActiveState({
                nowTs,
                lastActivityTs: mostRecentTimestamp(
                  member.lastActiveAt,
                  member.lastAttendedAt,
                  member.lastServedAt,
                ),
                addedAt: member.addedAt,
                currentIsActive: (siblingRecord as any)?.isActive,
                currentArchivedAt: (siblingRecord as any)?.archivedAt,
              });
        const cpId = await ctx.db.insert("communityPeople", {
          ...scoreDoc,
          isActive: activeState.isActive,
          archivedAt: activeState.archivedAt,
          // Copy leader-set fields from sibling if exists
          status: siblingRecord?.status,
          assigneeIds: siblingRecord?.assigneeIds,
          assigneeId: siblingAssigneeId,
          assigneeSortKey: siblingRecord?.assigneeSortKey,
          connectionPoint: siblingRecord?.connectionPoint,
          customText1: siblingRecord?.customText1,
          customText2: siblingRecord?.customText2,
          customText3: siblingRecord?.customText3,
          customText4: siblingRecord?.customText4,
          customText5: siblingRecord?.customText5,
          customNum1: siblingRecord?.customNum1,
          customNum2: siblingRecord?.customNum2,
          customNum3: siblingRecord?.customNum3,
          customNum4: siblingRecord?.customNum4,
          customNum5: siblingRecord?.customNum5,
          customBool1: siblingRecord?.customBool1,
          customBool2: siblingRecord?.customBool2,
          customBool3: siblingRecord?.customBool3,
          customBool4: siblingRecord?.customBool4,
          customBool5: siblingRecord?.customBool5,
          createdAt: nowTs,
        });

        // Sync junction table for assignee filtering
        if (siblingRecord?.assigneeIds?.length) {
          for (const assigneeUserId of siblingRecord.assigneeIds) {
            await ctx.db.insert("communityPeopleAssignees", {
              communityPersonId: cpId,
              assigneeUserId,
              groupId: args.groupId,
              communityId: args.communityId,
            });
          }
        }
      }
    }
  },
});

/**
 * Delete communityPeople rows for members who are no longer active in the
 * record's group. Each communityPeople record is tied to a specific group,
 * so we verify membership per-group rather than only against the announcement group.
 */
export const pruneStaleRows = internalMutation({
  args: {
    communityId: v.id("communities"),
    announcementGroupId: v.id("groups"),
  },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("communityPeople")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .collect();

    let deleted = 0;
    for (const doc of docs) {
      // Each record has a groupId — check if user is still an active member of that group
      if (!doc.groupId) {
        // Clean up junction rows before deleting the communityPeople record
        const legacyJunctionRows = await ctx.db
          .query("communityPeopleAssignees")
          .withIndex("by_communityPerson", (q: any) =>
            q.eq("communityPersonId", doc._id),
          )
          .collect();
        for (const row of legacyJunctionRows) {
          await ctx.db.delete(row._id);
        }
        // Legacy record without groupId — prune it
        await ctx.db.delete(doc._id);
        deleted++;
        continue;
      }
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q
            .eq("groupId", doc.groupId!)
            .eq("userId", doc.userId)
        )
        .first();

      const isStale =
        !membership || membership.leftAt !== undefined;

      if (isStale) {
        // Clean up junction rows before deleting the communityPeople record
        const junctionRows = await ctx.db
          .query("communityPeopleAssignees")
          .withIndex("by_communityPerson", (q: any) =>
            q.eq("communityPersonId", doc._id),
          )
          .collect();
        for (const row of junctionRows) {
          await ctx.db.delete(row._id);
        }
        await ctx.db.delete(doc._id);
        deleted++;
      }
    }

    return { deleted };
  },
});

// ============================================================================
// Score Computation Actions
// ============================================================================

/**
 * Compute community-level scores for all members of a community.
 *
 * Orchestration:
 * 1. Find announcement group (canonical member list)
 * 2. Optionally refresh PCO serving data
 * 3. Paginate through members (BATCH_SIZE per page)
 * 4. For each page: compute cross-group attendance, score batch, upsert
 * 5. Prune stale rows for members who left
 */
export const computeCommunityScores = internalAction({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    // Step 1: Find announcement group
    const announcementGroup = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAnnouncementGroup,
      { communityId: args.communityId }
    );

    if (!announcementGroup) {
      console.log(
        `[community-scores] No announcement group found for community ${args.communityId}, skipping`
      );
      return;
    }

    const announcementGroupId = announcementGroup._id;

    // Step 1b: Fetch community alert config
    const community = await ctx.runQuery(
      internal.functions.communityScoreComputation.getCommunityAlertConfig,
      { communityId: args.communityId }
    );
    const customAlerts = community ?? undefined;

    // Step 2: Refresh PCO serving data for the announcement group
    try {
      await ctx.runAction(
        internal.functions.pcoServices.servingHistory.internalRefreshPcoServing,
        { groupId: announcementGroupId }
      );
    } catch (e) {
      // PCO fetch failed — continue with stale cached data
      console.log(
        `[community-scores] PCO refresh failed for community ${args.communityId}, using cached data: ${e}`
      );
    }

    // Step 3: Paginate through all members
    let cursor: string | undefined = undefined;
    let isDone = false;

    while (!isDone) {
      const page: {
        members: Array<{
          groupMemberId: Id<"groupMembers">;
          userId: Id<"users">;
          joinedAt: number;
          firstName: string;
          lastName: string;
          avatarUrl: string | undefined;
          email: string | undefined;
          phone: string | undefined;
          lastActiveAt: number | undefined;
        }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(
        internal.functions.communityScoreComputation.getCommunityMembers,
        {
          communityId: args.communityId,
          announcementGroupId,
          cursor,
          limit: BATCH_SIZE,
        }
      );

      if (page.members.length === 0) {
        isDone = page.isDone;
        cursor = page.continueCursor;
        continue;
      }

      // Step 4: Compute cross-group attendance for this batch
      const crossGroupAttendanceMap: Record<
        string,
        { pct: number; attendedWeekStarts: number[]; meetingWeekStarts: number[]; meetingEntries: Array<{ scheduledAt: number; attended: boolean }> }
      > = {};
      const userIds = page.members.map((m) => m.userId);
      for (let i = 0; i < userIds.length; i += CROSS_GROUP_BATCH_SIZE) {
        const batch = userIds.slice(i, i + CROSS_GROUP_BATCH_SIZE);
        const batchResults: Record<
          string,
          { pct: number; attendedWeekStarts: number[] }
        > = await ctx.runQuery(
          internal.functions.memberFollowups.internalCrossGroupAttendance,
          { groupId: announcementGroupId, userIds: batch }
        );
        Object.assign(crossGroupAttendanceMap, batchResults);
      }

      // Step 5: Score the batch
      const scoredMembers = await ctx.runQuery(
        internal.functions.communityScoreComputation.computeCommunityScoresBatch,
        {
          communityId: args.communityId,
          announcementGroupId,
          members: page.members,
          crossGroupAttendanceMap,
          customAlerts,
        }
      );

      // Step 6: Upsert results for the announcement group
      await ctx.runMutation(
        internal.functions.communityScoreComputation.upsertCommunityPeopleBatch,
        {
          communityId: args.communityId,
          groupId: announcementGroupId,
          scoredMembers,
        }
      );

      isDone = page.isDone;
      cursor = page.continueCursor;
    }

    // Step 7: Create per-group records for all non-announcement groups
    const allGroups = await ctx.runQuery(
      internal.functions.communityScoreComputation.getCommunityGroups,
      { communityId: args.communityId }
    );

    for (const group of allGroups) {
      if (group._id === announcementGroupId) continue; // already handled

      // Get active members for this group
      const groupMemberUserIds: Id<"users">[] = await ctx.runQuery(
        internal.functions.communityScoreComputation.getGroupMemberUserIds,
        { groupId: group._id }
      );

      if (groupMemberUserIds.length === 0) continue;

      // Find scored data for these users from the announcement group records
      const scoredForGroup = await ctx.runQuery(
        internal.functions.communityScoreComputation.getScoredDataForUsers,
        { communityId: args.communityId, userIds: groupMemberUserIds }
      );

      if (scoredForGroup.length > 0) {
        await ctx.runMutation(
          internal.functions.communityScoreComputation
            .upsertCommunityPeopleBatch,
          {
            communityId: args.communityId,
            groupId: group._id,
            scoredMembers: scoredForGroup,
          }
        );
      }
    }

    // Step 8: Prune stale rows
    await ctx.runMutation(
      internal.functions.communityScoreComputation.pruneStaleRows,
      {
        communityId: args.communityId,
        announcementGroupId,
      }
    );

    console.log(
      `[community-scores] Completed score computation for community ${args.communityId}`
    );
  },
});

/**
 * Compute scores for a single community member and upsert.
 * Used for real-time updates after followup actions.
 */
export const computeSingleCommunityMember = internalAction({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Find announcement group
    const announcementGroup = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAnnouncementGroup,
      { communityId: args.communityId }
    );

    if (!announcementGroup) return;

    // Find the user's membership in the announcement group
    const membership = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAnnouncementGroupMember,
      {
        announcementGroupId: announcementGroup._id,
        userId: args.userId,
      }
    );

    if (!membership) return;

    // Fetch community alert config
    const communityAlerts = await ctx.runQuery(
      internal.functions.communityScoreComputation.getCommunityAlertConfig,
      { communityId: args.communityId }
    );
    const customAlerts = communityAlerts ?? undefined;

    // Compute cross-group attendance for this single user
    const crossGroupAttendanceMap: Record<
      string,
      { pct: number; attendedWeekStarts: number[] }
    > = await ctx.runQuery(
      internal.functions.memberFollowups.internalCrossGroupAttendance,
      { groupId: announcementGroup._id, userIds: [args.userId] }
    );

    // Score the single member
    const scoredMembers = await ctx.runQuery(
      internal.functions.communityScoreComputation.computeCommunityScoresBatch,
      {
        communityId: args.communityId,
        announcementGroupId: announcementGroup._id,
        members: [membership],
        crossGroupAttendanceMap,
        customAlerts,
      }
    );

    if (scoredMembers.length === 0) return;

    // Upsert the result for the announcement group
    await ctx.runMutation(
      internal.functions.communityScoreComputation.upsertCommunityPeopleBatch,
      {
        communityId: args.communityId,
        groupId: announcementGroup._id,
        scoredMembers,
      }
    );

    // Also upsert into all other groups this user belongs to
    const allGroups = await ctx.runQuery(
      internal.functions.communityScoreComputation.getCommunityGroups,
      { communityId: args.communityId }
    );

    for (const group of allGroups) {
      if (group._id === announcementGroup._id) continue; // already handled

      // Check if user is an active member of this group
      const groupMembership = await ctx.runQuery(
        internal.functions.communityScoreComputation.getAnnouncementGroupMember,
        { announcementGroupId: group._id, userId: args.userId }
      );

      if (!groupMembership) continue;

      await ctx.runMutation(
        internal.functions.communityScoreComputation.upsertCommunityPeopleBatch,
        {
          communityId: args.communityId,
          groupId: group._id,
          scoredMembers,
        }
      );
    }
  },
});

/**
 * Get a single member's data from the announcement group.
 * Used by computeSingleCommunityMember.
 */
export const getAnnouncementGroupMember = internalQuery({
  args: {
    announcementGroupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const member = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", args.announcementGroupId).eq("userId", args.userId)
      )
      .first();

    if (!member || member.leftAt) return null;

    const group = await ctx.db.get(args.announcementGroupId);
    const [user, communityMembership] = await Promise.all([
      ctx.db.get(member.userId),
      group
        ? ctx.db
            .query("userCommunities")
            .withIndex("by_user_community", (q) =>
              q.eq("userId", member.userId).eq("communityId", group.communityId)
            )
            .first()
        : Promise.resolve(null),
    ]);

    return {
      groupMemberId: member._id,
      userId: member.userId,
      joinedAt: member.joinedAt,
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      avatarUrl: getMediaUrl(user?.profilePhoto),
      email: user?.email,
      phone: user?.phone,
      zipCode: user?.zipCode,
      lastActiveAt: communityMembership?.lastLogin ?? user?.lastLogin,
    };
  },
});

/**
 * Get all groups in a community.
 * Used to iterate non-announcement groups for per-group record creation.
 */
export const getCommunityGroups = internalQuery({
  args: { communityId: v.id("communities") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("groups")
      .withIndex("by_community", (q) => q.eq("communityId", args.communityId))
      .collect();
  },
});

/**
 * Get active member user IDs for a group.
 * Returns only users who have not left (leftAt is undefined).
 */
export const getGroupMemberUserIds = internalQuery({
  args: { groupId: v.id("groups") },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    return members
      .filter((m) => m.leftAt === undefined)
      .map((m) => m.userId);
  },
});

/**
 * Get scored data for a list of users from existing communityPeople records.
 * Looks up any existing record for each user in the community (typically
 * the announcement group record) and returns the score fields needed for
 * creating per-group records.
 */
export const getScoredDataForUsers = internalQuery({
  args: {
    communityId: v.id("communities"),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, args) => {
    const results = [];
    for (const userId of args.userIds) {
      // Find ANY existing communityPeople record for this user in this community
      // (the announcement group record will have the scores)
      const existing = await ctx.db
        .query("communityPeople")
        .withIndex("by_community_user", (q) =>
          q.eq("communityId", args.communityId).eq("userId", userId)
        )
        .first();
      if (existing) {
        results.push({
          userId: existing.userId,
          firstName: existing.firstName,
          lastName: existing.lastName,
          avatarUrl: existing.avatarUrl,
          email: existing.email,
          phone: existing.phone,
          zipCode: existing.zipCode,
          searchText: existing.searchText,
          score1: existing.score1,
          score2: existing.score2,
          score3: existing.score3,
          alerts: existing.alerts,
          isSnoozed: existing.isSnoozed,
          snoozedUntil: existing.snoozedUntil,
          rawValues: existing.rawValues,
          lastFollowupAt: existing.lastFollowupAt,
          lastActiveAt: existing.lastActiveAt,
          lastAttendedAt: existing.lastAttendedAt,
          addedAt: existing.addedAt,
          addedAtInv: existing.addedAt ? Number.MAX_SAFE_INTEGER - existing.addedAt : undefined,
        });
      }
    }
    return results;
  },
});

// ============================================================================
// Cross-Table Sync
// ============================================================================

/**
 * Sync a community-level field change to all per-group memberFollowupScores rows
 * AND all communityPeople sibling records.
 *
 * When a leader updates status, assigneeIds, or custom fields at the community
 * level, this mutation propagates the change to:
 * 1. All memberFollowupScores rows for the same user across all groups (legacy table)
 * 2. All communityPeople rows for the same user across all groups in the community
 */
export const syncCommunityFieldToGroups = internalMutation({
  args: {
    communityId: v.id("communities"),
    userId: v.id("users"),
    field: v.string(),
    value: v.any(),
  },
  handler: async (ctx, args) => {
    // Find all groups in this community
    const groups = await ctx.db
      .query("groups")
      .withIndex("by_community", (q) =>
        q.eq("communityId", args.communityId)
      )
      .collect();

    let patched = 0;
    for (const group of groups) {
      // Find the user's membership in this group
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", group._id).eq("userId", args.userId)
        )
        .first();

      if (!membership || membership.leftAt) continue;

      // Find their score doc (legacy table)
      const scoreDoc = await ctx.db
        .query("memberFollowupScores")
        .withIndex("by_groupMember", (q) =>
          q.eq("groupMemberId", membership._id)
        )
        .first();

      if (scoreDoc) {
        await ctx.db.patch(scoreDoc._id, {
          [args.field]: args.value,
          updatedAt: Date.now(),
        });
        patched++;
      }
    }

    // Also sync across all communityPeople sibling records for this user
    const communityPeopleRows = await ctx.db
      .query("communityPeople")
      .withIndex("by_community_user", (q) =>
        q.eq("communityId", args.communityId).eq("userId", args.userId)
      )
      .collect();

    for (const row of communityPeopleRows) {
      await ctx.db.patch(row._id, {
        [args.field]: args.value,
        updatedAt: Date.now(),
      });
    }

    return { patched };
  },
});

// ============================================================================
// Daily Cron Handler
// ============================================================================

/**
 * Daily refresh: fan out score computation for all communities.
 * Staggered via ctx.scheduler to avoid thundering herd.
 */
export const dailyRefreshAllCommunityScores = internalAction({
  args: {},
  handler: async (ctx) => {
    const communityIds: Id<"communities">[] = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAllCommunityIds,
      {}
    );

    // Stagger: schedule each community 3s apart to respect PCO rate limits
    for (let i = 0; i < communityIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * STAGGER_INTERVAL_MS,
        internal.functions.communityScoreComputation.computeCommunityScores,
        { communityId: communityIds[i] }
      );
    }

    console.log(
      `[community-score-refresh] Scheduled ${communityIds.length} communities for score recomputation`
    );
  },
});

// ============================================================================
// Backfill (CLI command)
// ============================================================================

/**
 * One-time backfill for all communities.
 * Usage: npx convex run functions/communityScoreComputation:backfillAllCommunities
 */
export const backfillAllCommunities = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const communityIds: Id<"communities">[] = await ctx.runQuery(
      internal.functions.communityScoreComputation.getAllCommunityIds,
      {}
    );

    for (let i = 0; i < communityIds.length; i++) {
      await ctx.scheduler.runAfter(
        i * STAGGER_INTERVAL_MS,
        internal.functions.communityScoreComputation.computeCommunityScores,
        { communityId: communityIds[i] }
      );
    }

    return { scheduled: communityIds.length };
  },
});

// ============================================================================
// Event-triggered single member recomputation (convenience wrapper)
// ============================================================================

/**
 * Recompute community scores for a single member, given a groupId.
 * Resolves the communityId from the group doc and delegates to
 * computeSingleCommunityMember. This avoids every call site needing
 * to look up the community themselves.
 */
export const recomputeForGroupMember = internalMutation({
  args: {
    groupId: v.id("groups"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const group = await ctx.db.get(args.groupId);
    if (!group?.communityId) return;

    await ctx.scheduler.runAfter(
      0,
      internal.functions.communityScoreComputation.computeSingleCommunityMember,
      { communityId: group.communityId, userId: args.userId }
    );
  },
});
