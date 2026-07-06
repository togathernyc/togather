/**
 * Messaging helper functions
 *
 * Shared utilities for messaging functions (channels, messages, etc.)
 */

import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { isCommunityAdmin } from "../../lib/permissions";

/**
 * Whether `userId` may view this group's channels purely on community-admin
 * standing — i.e. without joining the group.
 *
 * Community admins get read-only "oversight" access to any group's channels in
 * their community without a `groupMembers` (or `chatChannelMembers`) row, so
 * they never show up in rosters or pick up inbox / notification entries. This
 * grants VIEW access only; the send / manage mutations keep their own
 * membership gates, so an admin viewer can read but not post or alter a group
 * they haven't joined.
 *
 * Callers fold this into their existing membership checks as an extra escape
 * hatch. Mirrors the admin bypass already baked into `listGroupChannels`.
 */
export async function isCommunityAdminForGroup(
  ctx: QueryCtx,
  groupId: Id<"groups">,
  userId: Id<"users">
): Promise<boolean> {
  const group = await ctx.db.get(groupId);
  if (!group) return false;
  return isCommunityAdmin(ctx, group.communityId, userId);
}

/**
 * Channel-keyed convenience wrapper around {@link isCommunityAdminForGroup}.
 * Ad-hoc DM/group_dm channels have no owning group, so admin oversight never
 * applies to them.
 */
export async function isCommunityAdminForChannel(
  ctx: QueryCtx,
  channel: Doc<"chatChannels">,
  userId: Id<"users">
): Promise<boolean> {
  if (!channel.groupId) return false;
  return isCommunityAdminForGroup(ctx, channel.groupId, userId);
}

/**
 * Recomputes and updates the member count for a channel from actual membership records.
 *
 * This function queries the actual membership data to get an accurate count,
 * avoiding drift that can occur with optimistic +1/-1 updates during concurrent operations.
 *
 * @param ctx - The mutation context
 * @param channelId - The channel to update the member count for
 */
export async function updateChannelMemberCount(
  ctx: MutationCtx,
  channelId: Id<"chatChannels">
): Promise<void> {
  const activeMembers = await ctx.db
    .query("chatChannelMembers")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .filter((q) => q.eq(q.field("leftAt"), undefined))
    .collect();

  await ctx.db.patch(channelId, { memberCount: activeMembers.length });
}

/** One entry of `chatChannels.sharedGroups`. */
export type SharedGroupEntry = NonNullable<
  Doc<"chatChannels">["sharedGroups"]
>[number];

/**
 * Finds non-archived shared ANNOUNCEMENTS channels where `groupId` is an
 * ACCEPTED secondary group (i.e. the group receives announcements through
 * another group's channel).
 *
 * Same `by_isShared` scan pattern as `listActiveSharedChannelsForGroup`:
 * shared channels are rare, so the indexed scan stays cheap.
 */
export async function findAcceptedSharedAnnouncementsChannelsForGroup(
  ctx: QueryCtx,
  groupId: Id<"groups">
): Promise<Array<{ channel: Doc<"chatChannels">; entry: SharedGroupEntry }>> {
  const sharedChannels = await ctx.db
    .query("chatChannels")
    .withIndex("by_isShared", (q) => q.eq("isShared", true))
    .filter((q) => q.eq(q.field("archivedAt"), undefined))
    .collect();

  const results: Array<{ channel: Doc<"chatChannels">; entry: SharedGroupEntry }> = [];
  for (const channel of sharedChannels) {
    if (channel.channelType !== "announcements") continue;
    if (!channel.groupId || channel.groupId === groupId) continue;
    const entry = (channel.sharedGroups ?? []).find(
      (sg) => sg.groupId === groupId && sg.status === "accepted"
    );
    if (entry) {
      results.push({ channel, entry });
    }
  }
  return results;
}
