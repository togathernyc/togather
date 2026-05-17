/**
 * Scheduling permissions
 *
 * Shared authorization helpers for the native event-scheduling module
 * (ADR-023). There is no new role field — scheduler permission is derived
 * from existing systems:
 *
 *   - channel `admin` / `moderator` (chatChannelMembers.role)
 *   - campus group `leader` (groupMembers.role)
 *   - community admin (userCommunities.roles >= 3)
 *
 * All failures throw `ConvexError` (not a plain `Error`) so the mobile
 * client's `AuthErrorBoundary` can recognize and recover from them rather
 * than dead-ending in the root error boundary. See the repo memory note
 * "Convex requireAuth must throw ConvexError".
 */

import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { isLeaderRole } from "../../lib/helpers";
import { isCommunityAdmin } from "../../lib/permissions";

/** Channel-member roles that may manage a serving team's schedule. */
const SCHEDULER_CHANNEL_ROLES = new Set(["admin", "moderator"]);

/**
 * Resolve a channel and assert it can act as a serving team.
 * Throws `ConvexError` if the channel is missing or not a serving team.
 */
export async function requireServingChannel(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"chatChannels">,
): Promise<Doc<"chatChannels">> {
  const channel = await ctx.db.get(channelId);
  if (!channel) {
    throw new ConvexError("Channel not found");
  }
  if (channel.isServingTeam !== true) {
    throw new ConvexError("Channel is not a serving team");
  }
  return channel;
}

/**
 * Whether `userId` may manage the schedule for `channel` — channel
 * admin/moderator, OR campus group leader, OR community admin.
 *
 * `markChannelAsTeam` runs before a channel is a serving team, so this
 * accepts any channel doc and does not require `isServingTeam`.
 */
export async function isScheduler(
  ctx: QueryCtx | MutationCtx,
  channel: Doc<"chatChannels">,
  userId: Id<"users">,
): Promise<boolean> {
  // 1. Channel admin / moderator.
  const channelMembership = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel_user", (q) =>
      q.eq("channelId", channel._id).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  if (channelMembership && SCHEDULER_CHANNEL_ROLES.has(channelMembership.role)) {
    return true;
  }

  // 2. Campus group leader.
  if (channel.groupId) {
    const groupMembership = await ctx.db
      .query("groupMembers")
      .withIndex("by_group_user", (q) =>
        q.eq("groupId", channel.groupId!).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (groupMembership && isLeaderRole(groupMembership.role)) {
      return true;
    }
  }

  // 3. Community admin.
  const communityId = channel.communityId ?? (await groupCommunityId(ctx, channel));
  if (communityId && (await isCommunityAdmin(ctx, communityId, userId))) {
    return true;
  }

  return false;
}

/** Resolve a channel's communityId, falling back to its group when needed. */
async function groupCommunityId(
  ctx: QueryCtx | MutationCtx,
  channel: Doc<"chatChannels">,
): Promise<Id<"communities"> | null> {
  if (channel.communityId) return channel.communityId;
  if (!channel.groupId) return null;
  const group = await ctx.db.get(channel.groupId);
  return group?.communityId ?? null;
}

/**
 * Require that `userId` may manage the given channel's schedule.
 * Resolves the channel, then asserts scheduler permission.
 *
 * @throws ConvexError if the channel is missing or the user lacks permission.
 */
export async function requireScheduler(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
): Promise<Doc<"chatChannels">> {
  const channel = await ctx.db.get(channelId);
  if (!channel) {
    throw new ConvexError("Channel not found");
  }
  if (!(await isScheduler(ctx, channel, userId))) {
    throw new ConvexError(
      "You must be a team admin, group leader, or community admin to manage this team's schedule",
    );
  }
  return channel;
}

/**
 * Require scheduler permission for the campus group that owns an event plan.
 * Used by event/assignment mutations that are scoped to a `groupId` rather
 * than a single team channel — we resolve via the group's main channel-less
 * leadership rules: group leader or community admin.
 *
 * @throws ConvexError if the group is missing or the user lacks permission.
 */
export async function requireGroupScheduler(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
  userId: Id<"users">,
): Promise<Doc<"groups">> {
  const group = await ctx.db.get(groupId);
  if (!group) {
    throw new ConvexError("Group not found");
  }

  const groupMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  if (groupMembership && isLeaderRole(groupMembership.role)) {
    return group;
  }

  if (await isCommunityAdmin(ctx, group.communityId, userId)) {
    return group;
  }

  throw new ConvexError(
    "You must be a group leader or community admin to manage this group's events",
  );
}

/**
 * Require that `userId` may *view* a campus group's serving-team roster —
 * an active member of the group OR a community admin. This is a read-level
 * gate (weaker than `requireGroupScheduler`, which demands leadership) used
 * by listing queries so an authenticated outsider cannot enumerate a private
 * group's team channels.
 *
 * @throws ConvexError if the group is missing or the caller lacks access.
 */
export async function requireGroupMember(
  ctx: QueryCtx | MutationCtx,
  groupId: Id<"groups">,
  userId: Id<"users">,
): Promise<Doc<"groups">> {
  const group = await ctx.db.get(groupId);
  if (!group) {
    throw new ConvexError("Group not found");
  }

  const membership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", groupId).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  const isActiveMember = !!(
    membership &&
    (!membership.requestStatus || membership.requestStatus === "accepted")
  );
  if (isActiveMember) {
    return group;
  }

  if (await isCommunityAdmin(ctx, group.communityId, userId)) {
    return group;
  }

  throw new ConvexError(
    "You must be a member of this group to view its serving teams",
  );
}

/**
 * Require that `userId` may *view* a serving-team channel's data — resolves
 * the channel to its owning campus group, then delegates to
 * `requireGroupMember` (active group member or community admin).
 *
 * Used by read queries keyed by a `channelId` (channel roles, starter-role
 * suggestions) so an authenticated outsider cannot enumerate another group's
 * team data via a guessed channel id.
 *
 * @throws ConvexError if the channel/group is missing or the caller lacks
 *   access.
 */
export async function requireChannelGroupMember(
  ctx: QueryCtx | MutationCtx,
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
): Promise<Doc<"chatChannels">> {
  const channel = await ctx.db.get(channelId);
  if (!channel) {
    throw new ConvexError("Channel not found");
  }
  if (!channel.groupId) {
    throw new ConvexError("Channel is not attached to a campus group");
  }
  await requireGroupMember(ctx, channel.groupId, userId);
  return channel;
}

/**
 * Resolve the campus-group scheduler used by an event plan, asserting the
 * caller may manage it. Returns both the plan and its owning group.
 *
 * @throws ConvexError if the plan is missing or the user lacks permission.
 */
export async function requirePlanScheduler(
  ctx: QueryCtx | MutationCtx,
  planId: Id<"eventPlans">,
  userId: Id<"users">,
): Promise<{ plan: Doc<"eventPlans">; group: Doc<"groups"> }> {
  const plan = await ctx.db.get(planId);
  if (!plan) {
    throw new ConvexError("Event not found");
  }
  const group = await requireGroupScheduler(ctx, plan.groupId, userId);
  return { plan, group };
}
