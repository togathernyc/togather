/**
 * Team Channel Auto-Sync Engine
 *
 * The native equivalent of the PCO Services rotation engine
 * (`functions/pcoServices/rotation.ts`), but sourced from event-plan role
 * assignments instead of Planning Center schedules.
 *
 * ADR-025 made a serving team a first-class `teams` row that *optionally* has
 * a chat channel. This engine mirrors a team's `roleAssignments` into its
 * channel's `chatChannelMembers` (`syncSource: "event_plan"`). A user belongs
 * to a team channel while they hold a role assignment (that they have not
 * declined) on an event plan whose `eventDate` falls inside a rotation window
 * around now: added ~5 days before the event, removed ~1 day after.
 *
 * There are two kinds of auto-synced channel:
 *   - a serving team's channel (`teams.channelId`): desired members come from
 *     `roleAssignments` keyed to that team via `by_team_eventDate`; and
 *   - a cross-team channel (`channelType === "cross_team"`, NOT a `teams`
 *     row): desired members come from `roleAssignments` across the source
 *     serving teams named in `crossTeamSync.selectors`.
 *
 * Only rows with `syncSource === "event_plan"` are managed here; the channel
 * creator and any manually-present members are left untouched (mirroring how
 * the PCO engine only touches `syncSource === "pco_services"` rows).
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { requireAuth } from "../../lib/auth";
import { getDisplayName, getMediaUrl } from "../../lib/utils";
import { updateChannelMemberCount } from "../messaging/helpers";
import { requireTeamScheduler } from "./permissions";

// ============================================================================
// Constants
// ============================================================================

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A user enters their team channel this many days before the event date. */
export const ADD_DAYS_BEFORE = 5;

/** A user leaves their team channel this many days after the event date. */
export const REMOVE_DAYS_AFTER = 1;

/** This sync engine's `syncSource` tag on `chatChannelMembers`. */
const SYNC_SOURCE = "event_plan";

/** Outcome of a reconcile pass. `skipped` marks a channel-less team no-op. */
type ReconcileResult = {
  added: number;
  removed: number;
  desiredCount: number;
  skipped?: boolean;
};

// ============================================================================
// Desired-set diff — shared by the serving-team and cross-team paths
// ============================================================================

/**
 * A single in-window assignment, flattened for desired-set computation. The
 * cross-team path tags each row with the `teamId` of the source serving team
 * that owns it (so sync metadata can name that team), while the serving-team
 * path tags every row with the team being reconciled.
 */
type WindowAssignment = {
  userId: Id<"users">;
  planId: Id<"eventPlans">;
  roleId: Id<"teamRoles">;
  teamId: Id<"teams">;
  eventDate: number;
};

/**
 * Diff a desired member set against a channel's auto-synced `chatChannelMembers`
 * rows and add / soft-remove rows so they match.
 *
 * Desired member set = distinct `userId` from `assignmentsInWindow`. We keep
 * the soonest in-window assignment per user for sync metadata and the latest
 * event date for `scheduledRemovalAt`.
 *
 * The desired set is diffed against `chatChannelMembers` rows for `channelId`
 * with `syncSource === "event_plan"`:
 *   - users in the desired set but not present (or soft-left) are added,
 *   - synced rows whose user left the window are soft-removed (`leftAt`).
 *
 * Non-synced members are never touched. `chatChannels.memberCount` is kept
 * accurate via `updateChannelMemberCount`.
 *
 * `fallbackTeamName` names the channel's own team and is used for sync
 * metadata when the assignment's source team cannot be resolved.
 */
async function reconcileChannelMembership(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">,
  assignmentsInWindow: WindowAssignment[],
  fallbackTeamName: string,
): Promise<ReconcileResult> {
  const now = Date.now();

  // Desired member set: distinct userId. We keep the soonest in-window
  // assignment per user for sync metadata and the latest event date for
  // `scheduledRemovalAt`.
  type Desired = {
    planId: Id<"eventPlans">;
    roleId: Id<"teamRoles">;
    teamId: Id<"teams">;
    eventDate: number;
    latestEventDate: number;
  };
  const desired = new Map<Id<"users">, Desired>();
  for (const assignment of assignmentsInWindow) {
    const existing = desired.get(assignment.userId);
    if (!existing) {
      desired.set(assignment.userId, {
        planId: assignment.planId,
        roleId: assignment.roleId,
        teamId: assignment.teamId,
        eventDate: assignment.eventDate,
        latestEventDate: assignment.eventDate,
      });
      continue;
    }
    // Prefer the soonest event for the displayed assignment...
    if (assignment.eventDate < existing.eventDate) {
      existing.planId = assignment.planId;
      existing.roleId = assignment.roleId;
      existing.teamId = assignment.teamId;
      existing.eventDate = assignment.eventDate;
    }
    // ...but schedule removal off the latest event so multi-event
    // volunteers are not yanked out early.
    if (assignment.eventDate > existing.latestEventDate) {
      existing.latestEventDate = assignment.eventDate;
    }
  }

  // Current auto-synced rows for this channel (active + soft-left).
  const syncedMembers = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel_syncSource", (q) =>
      q.eq("channelId", channelId).eq("syncSource", SYNC_SOURCE),
    )
    .collect();
  const syncedByUser = new Map(syncedMembers.map((m) => [m.userId, m]));

  let added = 0;
  let removed = 0;

  // --- Add / refresh desired members -----------------------------------
  for (const [userId, info] of desired) {
    const removalAt = info.latestEventDate + REMOVE_DAYS_AFTER * MS_PER_DAY;
    const [user, role, plan, team] = await Promise.all([
      ctx.db.get(userId),
      ctx.db.get(info.roleId),
      ctx.db.get(info.planId),
      ctx.db.get(info.teamId),
    ]);
    const displayName = user
      ? getDisplayName(user.firstName, user.lastName)
      : "Unknown";
    // The metadata names the serving team that owns the assignment's role —
    // for a cross-team channel this is the source team, so a member's
    // metadata reads e.g. "Worship Team / Worship Leader".
    const syncMetadata = {
      teamName: team?.name ?? fallbackTeamName,
      position: role?.name ?? undefined,
      serviceDate: info.eventDate,
      serviceName: plan?.title ?? undefined,
    };

    const existing = syncedByUser.get(userId);
    if (existing) {
      const wasLeft = existing.leftAt !== undefined;
      await ctx.db.patch(existing._id, {
        syncEventId: info.planId,
        scheduledRemovalAt: removalAt,
        syncMetadata,
        leftAt: undefined,
        displayName,
        profilePhoto: user?.profilePhoto
          ? getMediaUrl(user.profilePhoto)
          : existing.profilePhoto,
      });
      if (wasLeft) added += 1;
      continue;
    }

    // The user may already have a non-synced row in the channel. We only
    // skip when that row is *active* (no `leftAt`) — an active manual /
    // creator member is not auto-managed, and inserting a synced duplicate
    // would give one user two active rows. A soft-left row, by contrast,
    // means the user is NOT in the channel, so we reactivate it as a synced
    // row (consistent with the re-add path above) rather than inserting a
    // duplicate.
    const priorRows = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId),
      )
      .collect();
    const activeRow = priorRows.find((r) => r.leftAt === undefined);
    if (activeRow) {
      continue;
    }
    const softLeftRow = priorRows.find((r) => r.leftAt !== undefined);
    if (softLeftRow) {
      await ctx.db.patch(softLeftRow._id, {
        role: "member",
        joinedAt: now,
        isMuted: false,
        syncSource: SYNC_SOURCE,
        syncEventId: info.planId,
        scheduledRemovalAt: removalAt,
        syncMetadata,
        leftAt: undefined,
        displayName,
        profilePhoto: user?.profilePhoto
          ? getMediaUrl(user.profilePhoto)
          : softLeftRow.profilePhoto,
      });
      added += 1;
      continue;
    }

    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId,
      role: "member",
      joinedAt: now,
      isMuted: false,
      syncSource: SYNC_SOURCE,
      syncEventId: info.planId,
      scheduledRemovalAt: removalAt,
      syncMetadata,
      displayName,
      profilePhoto: user?.profilePhoto
        ? getMediaUrl(user.profilePhoto)
        : undefined,
    });
    added += 1;
  }

  // --- Remove synced members no longer in the window -------------------
  for (const member of syncedMembers) {
    if (member.leftAt !== undefined) continue; // already gone
    if (desired.has(member.userId)) continue; // still wanted
    await ctx.db.patch(member._id, {
      leftAt: now,
      scheduledRemovalAt: undefined,
    });
    removed += 1;
  }

  if (added > 0 || removed > 0) {
    await updateChannelMemberCount(ctx, channelId);
  }

  return { added, removed, desiredCount: desired.size };
}

/** The inclusive rotation window `[start, end]` around `now`, in ms. */
function rotationWindow(now: number): { start: number; end: number } {
  return {
    start: now - REMOVE_DAYS_AFTER * MS_PER_DAY,
    end: now + ADD_DAYS_BEFORE * MS_PER_DAY,
  };
}

// ============================================================================
// reconcileTeamChannel — serving-team reconcile
// ============================================================================

/**
 * Shared serving-team reconcile implementation.
 *
 * Reconcile a single serving team's chat channel against the team's event
 * plan assignments. If the team has no channel (`teams.channelId` is
 * undefined) this is a no-op — a channel-less team has assignments but no
 * chat roster to sync — and returns `{ skipped: true }`.
 *
 * In-window assignments are read via the `by_team_eventDate` index, bounded
 * to the rotation window and with `declined` assignments excluded. The
 * desired set then flows through `reconcileChannelMembership`.
 *
 * Holds the actual logic so it can be invoked from multiple mutation
 * entrypoints (the internal `reconcileTeamChannel` used by triggers and the
 * cron, and the public `triggerTeamChannelSync`). A mutation cannot
 * `ctx.runMutation` another mutation, so both entrypoints call this helper
 * directly to guarantee identical behavior.
 */
export async function reconcileTeamChannelImpl(
  ctx: MutationCtx,
  teamId: Id<"teams">,
): Promise<ReconcileResult> {
  const team = await ctx.db.get(teamId);
  if (!team) {
    return { added: 0, removed: 0, desiredCount: 0, skipped: true };
  }
  // A channel-less team has a roster of assignments but no chat surface to
  // mirror them into — reconcile is a no-op.
  if (!team.channelId) {
    return { added: 0, removed: 0, desiredCount: 0, skipped: true };
  }
  // Archived teams are out of rotation — `archiveTeam` purges their synced
  // members, and a subsequent assign/respond mutation would otherwise call
  // back here and silently re-populate the channel, undoing the archive.
  if (team.isArchived === true) {
    return { added: 0, removed: 0, desiredCount: 0, skipped: true };
  }

  const { start, end } = rotationWindow(Date.now());

  const rows = await ctx.db
    .query("roleAssignments")
    .withIndex("by_team_eventDate", (q) =>
      q.eq("teamId", teamId).gte("eventDate", start).lte("eventDate", end),
    )
    .collect();

  const assignmentsInWindow: WindowAssignment[] = rows
    .filter((row) => row.status !== "declined")
    .map((row) => ({
      userId: row.userId,
      planId: row.planId,
      roleId: row.roleId,
      teamId: row.teamId,
      eventDate: row.eventDate,
    }));

  return await reconcileChannelMembership(
    ctx,
    team.channelId,
    assignmentsInWindow,
    team.name,
  );
}

/**
 * Shared cross-team reconcile implementation.
 *
 * Reconcile a single cross-team channel (`channelType === "cross_team"`).
 * Desired members come from `roleAssignments` across the source serving teams
 * named in `crossTeamSync.selectors` — each selector pulls everyone assigned
 * `roleId` on `sourceTeamId`, or every role there when `roleId` is omitted.
 *
 * Source-team assignments are read via the `by_team_eventDate` index, bounded
 * to the rotation window and with `declined` assignments excluded.
 */
export async function reconcileCrossTeamChannelImpl(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">,
): Promise<ReconcileResult> {
  const channel = await ctx.db.get(channelId);
  if (
    !channel ||
    channel.channelType !== "cross_team" ||
    channel.crossTeamSync === undefined
  ) {
    return { added: 0, removed: 0, desiredCount: 0, skipped: true };
  }

  const { start, end } = rotationWindow(Date.now());

  // Assignments across each selector's source serving team, optionally
  // filtered to a single role.
  const assignmentsInWindow: WindowAssignment[] = [];
  for (const selector of channel.crossTeamSync.selectors) {
    // Archived source teams are out of rotation — skip them so an archived
    // team can't keep feeding members into the cross-team channel, matching
    // the early-return in `reconcileTeamChannelImpl`.
    const sourceTeam = await ctx.db.get(selector.sourceTeamId);
    if (!sourceTeam || sourceTeam.isArchived === true) continue;
    const rows = await ctx.db
      .query("roleAssignments")
      .withIndex("by_team_eventDate", (q) =>
        q
          .eq("teamId", selector.sourceTeamId)
          .gte("eventDate", start)
          .lte("eventDate", end),
      )
      .collect();
    for (const row of rows) {
      if (row.status === "declined") continue;
      if (selector.roleId !== undefined && row.roleId !== selector.roleId) {
        continue;
      }
      assignmentsInWindow.push({
        userId: row.userId,
        planId: row.planId,
        roleId: row.roleId,
        teamId: row.teamId,
        eventDate: row.eventDate,
      });
    }
  }

  return await reconcileChannelMembership(
    ctx,
    channelId,
    assignmentsInWindow,
    channel.name,
  );
}

/**
 * Soft-remove every active auto-synced (`syncSource === "event_plan"`) member
 * of a channel and refresh `chatChannels.memberCount`.
 *
 * Used when a team's channel is archived (`archiveTeam`): the rotation engine
 * early-returns once a channel is no longer reconciled, so its synced rows
 * would otherwise be stranded as active members forever. Non-synced (manual /
 * creator) rows are left untouched.
 *
 * Returns the number of rows soft-removed.
 */
export async function purgeSyncedMembers(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">,
): Promise<number> {
  const now = Date.now();
  const syncedMembers = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel_syncSource", (q) =>
      q.eq("channelId", channelId).eq("syncSource", SYNC_SOURCE),
    )
    .collect();

  let removed = 0;
  for (const member of syncedMembers) {
    if (member.leftAt !== undefined) continue; // already gone
    await ctx.db.patch(member._id, {
      leftAt: now,
      scheduledRemovalAt: undefined,
    });
    removed += 1;
  }

  if (removed > 0) {
    await updateChannelMemberCount(ctx, channelId);
  }
  return removed;
}

/**
 * Reconcile a single serving team's chat channel against its event plan
 * assignments. Internal entrypoint used by assignment triggers and the daily
 * cron. Thin wrapper over `reconcileTeamChannelImpl` — a no-op for a
 * channel-less team.
 */
export const reconcileTeamChannel = internalMutation({
  args: {
    teamId: v.id("teams"),
  },
  handler: async (ctx, args): Promise<ReconcileResult> => {
    return await reconcileTeamChannelImpl(ctx, args.teamId);
  },
});

/**
 * Reconcile a single cross-team channel's auto-synced membership. Internal
 * entrypoint used by `crossTeamChannels.ts` after a create/update and by the
 * daily cron. Thin wrapper over `reconcileCrossTeamChannelImpl`.
 */
export const reconcileCrossTeamChannel = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
  },
  handler: async (ctx, args): Promise<ReconcileResult> => {
    return await reconcileCrossTeamChannelImpl(ctx, args.channelId);
  },
});

// ============================================================================
// triggerTeamChannelSync — public manual sync
// ============================================================================

/**
 * Public "sync now" for a serving team. Lets a scheduler force a reconcile
 * outside the normal trigger/cron schedule (e.g. from the team detail page).
 *
 * Auth: `requireAuth` then `requireTeamScheduler` — team admin/moderator,
 * campus group leader, or community admin. Permission failures throw
 * `ConvexError`.
 *
 * This is a mutation (not an action) so it runs the reconcile transactionally.
 * It calls `reconcileTeamChannelImpl` directly because a mutation cannot
 * `ctx.runMutation` another mutation.
 */
export const triggerTeamChannelSync = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ addedCount: number; removedCount: number }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireTeamScheduler(ctx, args.teamId, userId);

    const result = await reconcileTeamChannelImpl(ctx, args.teamId);
    return { addedCount: result.added, removedCount: result.removed };
  },
});

// ============================================================================
// reconcileAllTeamChannels — cron entrypoint
// ============================================================================

/**
 * Reconcile every team channel in the database. Called by the daily cron so
 * the rotation window advances even when no assignment mutation fires (e.g.
 * a volunteer simply ages out of the window).
 *
 * Iterates every non-archived `teams` row that has a channel, plus every
 * cross-team channel.
 */
export const reconcileAllTeamChannels = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ processed: number; totalAdded: number; totalRemoved: number }> => {
    const targets: {
      teamIds: Id<"teams">[];
      crossTeamChannelIds: Id<"chatChannels">[];
    } = await ctx.runQuery(
      internal.functions.scheduling.teamChannelSync.listTeamChannelIds,
      {},
    );

    let totalAdded = 0;
    let totalRemoved = 0;

    for (const teamId of targets.teamIds) {
      try {
        const result = await ctx.runMutation(
          internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
          { teamId },
        );
        totalAdded += result.added;
        totalRemoved += result.removed;
      } catch (error) {
        // A single team failing (e.g. deleted mid-run) should not abort the
        // rest of the rotation.
        console.error(`Failed to reconcile team ${teamId}:`, error);
      }
    }

    for (const channelId of targets.crossTeamChannelIds) {
      try {
        const result = await ctx.runMutation(
          internal.functions.scheduling.teamChannelSync
            .reconcileCrossTeamChannel,
          { channelId },
        );
        totalAdded += result.added;
        totalRemoved += result.removed;
      } catch (error) {
        console.error(
          `Failed to reconcile cross-team channel ${channelId}:`,
          error,
        );
      }
    }

    return {
      processed: targets.teamIds.length + targets.crossTeamChannelIds.length,
      totalAdded,
      totalRemoved,
    };
  },
});

/**
 * Internal: ids of every auto-synced surface — non-archived `teams` rows that
 * have a channel, plus cross-team channels (`channelType === "cross_team"`).
 * The daily cron reconciles all of them so the rotation window advances even
 * when no assignment mutation fires.
 */
export const listTeamChannelIds = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    teamIds: Id<"teams">[];
    crossTeamChannelIds: Id<"chatChannels">[];
  }> => {
    const teams = await ctx.db.query("teams").collect();
    const teamIds = teams
      .filter((team) => team.isArchived !== true && team.channelId !== undefined)
      .map((team) => team._id);

    const channels = await ctx.db
      .query("chatChannels")
      .filter((q) => q.eq(q.field("channelType"), "cross_team"))
      .collect();
    const crossTeamChannelIds = channels.map((c) => c._id);

    return { teamIds, crossTeamChannelIds };
  },
});

// ============================================================================
// reconcileCrossTeamChannelsForSource — cross-team fan-out trigger
// ============================================================================

/**
 * Reconcile every cross-team channel that draws from a given source serving
 * team. Called alongside `reconcileTeamChannel` at each assignment-/event-
 * mutation trigger site so an assignment change on a source team also updates
 * any cross-team channel that selects from it.
 *
 * Scans `chatChannels` for `channelType === "cross_team"` and keeps those
 * whose `crossTeamSync.selectors` include `sourceTeamId`. Cross-team channels
 * are rare, so a filtered `.collect()` scan is acceptable. Calls
 * `reconcileCrossTeamChannelImpl` directly because a mutation cannot
 * `ctx.runMutation` another mutation.
 */
export const reconcileCrossTeamChannelsForSource = internalMutation({
  args: {
    sourceTeamId: v.id("teams"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ processed: number; totalAdded: number; totalRemoved: number }> => {
    const crossTeamChannels = await ctx.db
      .query("chatChannels")
      .filter((q) => q.eq(q.field("channelType"), "cross_team"))
      .collect();

    let processed = 0;
    let totalAdded = 0;
    let totalRemoved = 0;
    for (const channel of crossTeamChannels) {
      const selectsSource = channel.crossTeamSync?.selectors.some(
        (s) => s.sourceTeamId === args.sourceTeamId,
      );
      if (!selectsSource) continue;
      const result = await reconcileCrossTeamChannelImpl(ctx, channel._id);
      processed += 1;
      totalAdded += result.added;
      totalRemoved += result.removed;
    }

    return { processed, totalAdded, totalRemoved };
  },
});
