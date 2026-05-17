/**
 * Team Channel Auto-Sync Engine
 *
 * The native equivalent of the PCO Services rotation engine
 * (`functions/pcoServices/rotation.ts`), but sourced from event-plan role
 * assignments instead of Planning Center schedules.
 *
 * A "team channel" is a `chatChannels` row with `isServingTeam === true`. Its
 * membership is **purely auto-synced** — derived from `roleAssignments`, not
 * managed by hand. A user belongs to a team channel while they hold a role
 * assignment (that they have not declined) on an event plan whose `eventDate`
 * falls inside a rotation window around now: added ~5 days before the event,
 * removed ~1 day after.
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
import { requireScheduler } from "./permissions";

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

// ============================================================================
// reconcileTeamChannel
// ============================================================================

/**
 * Shared reconcile implementation.
 *
 * Reconcile a single team channel's auto-synced membership against its event
 * plan assignments.
 *
 * Desired member set = distinct `userId` from `roleAssignments` where:
 *   - `channelId` matches this channel,
 *   - `status !== "declined"`, and
 *   - the assignment's `eventDate` is within
 *     `[now - REMOVE_DAYS_AFTER days, now + ADD_DAYS_BEFORE days]`.
 *
 * The desired set is diffed against current `chatChannelMembers` rows for the
 * channel with `syncSource === "event_plan"`:
 *   - users in the desired set but not present (or soft-left) are added,
 *   - synced rows whose user left the window are soft-removed (`leftAt`).
 *
 * Non-synced members are never touched. `chatChannels.memberCount` is kept
 * accurate via `updateChannelMemberCount`.
 *
 * Holds the actual diff/add/remove logic so it can be invoked from multiple
 * mutation entrypoints (the internal `reconcileTeamChannel` used by triggers
 * and the cron, and the public `triggerTeamChannelSync`). A mutation cannot
 * `ctx.runMutation` another mutation, so both entrypoints call this helper
 * directly to guarantee identical behavior.
 */
async function reconcileTeamChannelImpl(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">,
): Promise<{ added: number; removed: number; desiredCount: number }> {
  const args = { channelId };
  const now = Date.now();

  const channel = await ctx.db.get(args.channelId);
  if (!channel || channel.isServingTeam !== true) {
    return { added: 0, removed: 0, desiredCount: 0 };
  }

  const windowStart = now - REMOVE_DAYS_AFTER * MS_PER_DAY;
  const windowEnd = now + ADD_DAYS_BEFORE * MS_PER_DAY;

  // Assignments for this channel whose event date falls inside the rotation
  // window. The `by_channel_eventDate` index bounds the scan to the window.
  const assignmentsInWindow = await ctx.db
    .query("roleAssignments")
    .withIndex("by_channel_eventDate", (q) =>
      q
        .eq("channelId", args.channelId)
        .gte("eventDate", windowStart)
        .lte("eventDate", windowEnd),
    )
    .collect();

  // Desired member set: distinct userId, declined assignments excluded.
  // We keep the soonest in-window assignment per user for sync metadata and
  // the latest event date for `scheduledRemovalAt`.
  type Desired = {
    planId: Id<"eventPlans">;
    roleId: Id<"teamRoles">;
    eventDate: number;
    latestEventDate: number;
  };
  const desired = new Map<Id<"users">, Desired>();
  for (const assignment of assignmentsInWindow) {
    if (assignment.status === "declined") continue;
    const existing = desired.get(assignment.userId);
    if (!existing) {
      desired.set(assignment.userId, {
        planId: assignment.planId,
        roleId: assignment.roleId,
        eventDate: assignment.eventDate,
        latestEventDate: assignment.eventDate,
      });
      continue;
    }
    // Prefer the soonest event for the displayed assignment...
    if (assignment.eventDate < existing.eventDate) {
      existing.planId = assignment.planId;
      existing.roleId = assignment.roleId;
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
      q.eq("channelId", args.channelId).eq("syncSource", SYNC_SOURCE),
    )
    .collect();
  const syncedByUser = new Map(syncedMembers.map((m) => [m.userId, m]));

  let added = 0;
  let removed = 0;

  // --- Add / refresh desired members -----------------------------------
  for (const [userId, info] of desired) {
    const removalAt = info.latestEventDate + REMOVE_DAYS_AFTER * MS_PER_DAY;
    const [user, role, plan] = await Promise.all([
      ctx.db.get(userId),
      ctx.db.get(info.roleId),
      ctx.db.get(info.planId),
    ]);
    const displayName = user
      ? getDisplayName(user.firstName, user.lastName)
      : "Unknown";
    const syncMetadata = {
      teamName: channel.name,
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
        q.eq("channelId", args.channelId).eq("userId", userId),
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
      channelId: args.channelId,
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
    await updateChannelMemberCount(ctx, args.channelId);
  }

  return { added, removed, desiredCount: desired.size };
}

/**
 * Soft-remove every active auto-synced (`syncSource === "event_plan"`) member
 * of a channel and refresh `chatChannels.memberCount`.
 *
 * Used when a channel stops being a serving team (`markChannelAsTeam` with
 * `isTeam: false`): the rotation engine early-returns for non-serving
 * channels, so its synced rows would otherwise be stranded as active members
 * forever. Non-synced (manual / creator) rows are left untouched.
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
 * Reconcile a single team channel's auto-synced membership against its event
 * plan assignments. Internal entrypoint used by assignment triggers and the
 * daily cron. Thin wrapper over `reconcileTeamChannelImpl`.
 */
export const reconcileTeamChannel = internalMutation({
  args: {
    channelId: v.id("chatChannels"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ added: number; removed: number; desiredCount: number }> => {
    return await reconcileTeamChannelImpl(ctx, args.channelId);
  },
});

// ============================================================================
// triggerTeamChannelSync — public manual sync
// ============================================================================

/**
 * Public "sync now" for a team channel. Lets a scheduler force a reconcile
 * outside the normal trigger/cron schedule (e.g. from the channel info page).
 *
 * Auth: `requireAuth` then `requireScheduler` — channel admin/moderator,
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
    channelId: v.id("chatChannels"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ addedCount: number; removedCount: number }> => {
    const userId = await requireAuth(ctx, args.token);
    await requireScheduler(ctx, args.channelId, userId);

    const result = await reconcileTeamChannelImpl(ctx, args.channelId);
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
 */
export const reconcileAllTeamChannels = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ processed: number; totalAdded: number; totalRemoved: number }> => {
    const channelIds: Id<"chatChannels">[] = await ctx.runQuery(
      internal.functions.scheduling.teamChannelSync.listTeamChannelIds,
      {},
    );

    let totalAdded = 0;
    let totalRemoved = 0;
    for (const channelId of channelIds) {
      try {
        const result = await ctx.runMutation(
          internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
          { channelId },
        );
        totalAdded += result.added;
        totalRemoved += result.removed;
      } catch (error) {
        // A single channel failing (e.g. deleted mid-run) should not abort
        // the rest of the rotation.
        console.error(
          `Failed to reconcile team channel ${channelId}:`,
          error,
        );
      }
    }

    return { processed: channelIds.length, totalAdded, totalRemoved };
  },
});

/**
 * Internal: ids of every channel flagged as a serving team.
 */
export const listTeamChannelIds = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"chatChannels">[]> => {
    const channels = await ctx.db
      .query("chatChannels")
      .filter((q) => q.eq(q.field("isServingTeam"), true))
      .collect();
    return channels.map((c) => c._id);
  },
});
