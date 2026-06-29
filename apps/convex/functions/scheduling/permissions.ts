/**
 * Scheduling permissions
 *
 * Shared authorization helpers for the native event-scheduling module
 * (ADR-023 / ADR-025). There is no new role field — scheduler permission is
 * derived from existing systems:
 *
 *   - the team channel's `admin` / `moderator` (chatChannelMembers.role)
 *   - campus group `leader` (groupMembers.role)
 *   - community admin (userCommunities.roles >= 3)
 *
 * ADR-025 made a team a first-class entity that *optionally* has a chat
 * channel. When a team has no channel, scheduler permission rests on group
 * leadership / community admin alone.
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
 * Resolve a team, throwing `ConvexError` if it is missing.
 */
export async function requireTeam(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
): Promise<Doc<"teams">> {
  const team = await ctx.db.get(teamId);
  if (!team) {
    throw new ConvexError("Team not found");
  }
  return team;
}

/**
 * Whether `userId` may manage `team`'s schedule — the team channel's
 * admin/moderator (when the team has a channel), OR the campus group leader,
 * OR a community admin.
 */
export async function isTeamScheduler(
  ctx: QueryCtx | MutationCtx,
  team: Doc<"teams">,
  userId: Id<"users">,
): Promise<boolean> {
  // 1. Team channel admin / moderator (only if the team has a channel).
  if (team.channelId) {
    const channelId = team.channelId;
    const channelMembership = await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .first();
    if (
      channelMembership &&
      SCHEDULER_CHANNEL_ROLES.has(channelMembership.role)
    ) {
      return true;
    }
  }

  // 2. Campus group leader.
  const groupMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", team.groupId).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  if (groupMembership && isLeaderRole(groupMembership.role)) {
    return true;
  }

  // 3. Community admin.
  if (await isCommunityAdmin(ctx, team.communityId, userId)) {
    return true;
  }

  return false;
}

/**
 * Require that `userId` may manage the given team's schedule.
 * Resolves the team, then asserts scheduler permission.
 *
 * @throws ConvexError if the team is missing or the user lacks permission.
 */
export async function requireTeamScheduler(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
  userId: Id<"users">,
): Promise<Doc<"teams">> {
  const team = await requireTeam(ctx, teamId);
  if (!(await isTeamScheduler(ctx, team, userId))) {
    throw new ConvexError(
      "You must be a team admin, group leader, or community admin to manage this team's schedule",
    );
  }
  return team;
}

/**
 * Whether `userId` currently has scheduler permission for `group` — an active
 * group leader, or a community admin. Boolean sibling of
 * `requireGroupScheduler`; use it to filter (rather than gate) — e.g. to drop
 * a stale recipient who has since left the group before notifying them.
 */
export async function isGroupScheduler(
  ctx: QueryCtx | MutationCtx,
  group: Doc<"groups">,
  userId: Id<"users">,
): Promise<boolean> {
  const groupMembership = await ctx.db
    .query("groupMembers")
    .withIndex("by_group_user", (q) =>
      q.eq("groupId", group._id).eq("userId", userId),
    )
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .first();
  if (groupMembership && isLeaderRole(groupMembership.role)) {
    return true;
  }
  return isCommunityAdmin(ctx, group.communityId, userId);
}

/**
 * Require scheduler permission for the campus group that owns an event plan.
 * Used by event/assignment mutations that are scoped to a `groupId` rather
 * than a single team — group leader or community admin.
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

  if (await isGroupScheduler(ctx, group, userId)) {
    return group;
  }

  throw new ConvexError(
    "You must be a group leader or community admin to manage this group's events",
  );
}

/**
 * Require that `userId` may *view* a campus group's serving-team data — an
 * active member of the group OR a community admin. This is a read-level gate
 * (weaker than `requireGroupScheduler`, which demands leadership) used by
 * listing queries so an authenticated outsider cannot enumerate a private
 * group's teams.
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
 * Require that `userId` may *view* a team's data — resolves the team to its
 * owning campus group, then delegates to `requireGroupMember` (active group
 * member or community admin).
 *
 * Used by read queries keyed by a `teamId` (team roles, starter-role
 * suggestions, team detail) so an authenticated outsider cannot enumerate
 * another group's team data via a guessed team id.
 *
 * @throws ConvexError if the team/group is missing or the caller lacks access.
 */
export async function requireTeamGroupMember(
  ctx: QueryCtx | MutationCtx,
  teamId: Id<"teams">,
  userId: Id<"users">,
): Promise<Doc<"teams">> {
  const team = await requireTeam(ctx, teamId);
  await requireGroupMember(ctx, team.groupId, userId);
  return team;
}

/**
 * Require that `userId` is an active member of `communityId`. Community-scoped
 * read gate for library resources (ADR-027 song library) that are not tied to a
 * single group. Throws `ConvexError` (not a plain `Error`) so the mobile
 * `AuthErrorBoundary` can recover, unlike `lib/permissions.requireCommunityAdmin`.
 *
 * @throws ConvexError if the caller is not an active community member.
 */
export async function requireCommunityMember(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">,
): Promise<void> {
  const membership = await ctx.db
    .query("userCommunities")
    .withIndex("by_user_community", (q) =>
      q.eq("userId", userId).eq("communityId", communityId),
    )
    .first();
  if (!membership || membership.status !== 1) {
    throw new ConvexError("You must be a member of this community");
  }
}

/**
 * Whether `userId` leads at least one group in `communityId`. The worship /
 * ministry leader who builds run sheets is a group leader (ADR-027), so song
 * library management is open to them, not only community admins.
 */
export async function isCommunityGroupLeader(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">,
): Promise<boolean> {
  const memberships = await ctx.db
    .query("groupMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .collect();
  for (const m of memberships) {
    if (!isLeaderRole(m.role)) continue;
    const group = await ctx.db.get(m.groupId);
    // Archived groups don't confer active leader status (memberships are
    // retained on archive), matching how leader status is derived elsewhere.
    if (group && group.communityId === communityId && !group.isArchived) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `userId` may edit the community song library (ADR-027): a community
 * admin OR a leader of any group in the community. Used both to gate mutations
 * (`requireCommunitySongEditor`) and to drive UI affordances (`canManageSongs`).
 */
export async function canEditCommunitySongs(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">,
): Promise<boolean> {
  if (await isCommunityAdmin(ctx, communityId, userId)) return true;
  return isCommunityGroupLeader(ctx, communityId, userId);
}

/**
 * Require that `userId` may edit the community song library (ADR-027): a
 * community admin or a group leader in the community. Throws `ConvexError`
 * (not a plain `Error`) so the mobile `AuthErrorBoundary` can recover.
 *
 * @throws ConvexError if the caller is neither.
 */
export async function requireCommunitySongEditor(
  ctx: QueryCtx | MutationCtx,
  communityId: Id<"communities">,
  userId: Id<"users">,
): Promise<void> {
  if (!(await canEditCommunitySongs(ctx, communityId, userId))) {
    throw new ConvexError(
      "You must be a group leader or community admin to manage the song library",
    );
  }
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
