/**
 * Messaging helper functions
 *
 * Shared utilities for messaging functions (channels, messages, etc.)
 */

import { ConvexError } from "convex/values";
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

/** How many channels a single group may have visible in its channel list. */
export const MAX_CHANNELS_PER_GROUP = 20;

/** The message shown when {@link assertChannelCapacity} rejects a creation. */
export const CHANNEL_CAP_MESSAGE =
  `This group has reached the maximum of ${MAX_CHANNELS_PER_GROUP} channels. ` +
  `Archive or hide some channels to create new ones.`;

/**
 * Count the channels that occupy a group's channel-list capacity.
 *
 * "Occupies capacity" means exactly what a leader sees in the active section of
 * the group's channel list (`ChannelsSection`), which folds three kinds of row
 * out of view:
 *
 *  - **Archived** (`isArchived === true`).
 *  - **Hidden** (`isEnabled === false`) — a leader turned the channel off. The
 *    channel list groups these under "Archived · hidden from members" alongside
 *    truly archived rows, so counting them against the cap tells the leader
 *    they are at 20 while the list shows 8. This is what blocked serving-team
 *    creation for a group carrying 12 disabled `pco_services` channels.
 *  - **Event channels** (`channelType === "event"`) — auto-created one per
 *    meeting, never listed, and unbounded over time.
 *
 * Keeping the cap's definition of "active" identical to the UI's is the whole
 * point: a leader must always be able to act on the error by archiving or
 * hiding a channel they can actually see.
 */
export async function countCapacityChannels(
  ctx: QueryCtx,
  groupId: Id<"groups">
): Promise<number> {
  const channels = await ctx.db
    .query("chatChannels")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();

  return channels.filter(
    (ch) =>
      ch.isArchived === false &&
      ch.isEnabled !== false &&
      ch.channelType !== "event"
  ).length;
}

/**
 * Throw the shared cap error if `groupId` has no room for another channel.
 * Used by every channel-creating path (custom, PCO services, serving team) so
 * they can't drift apart on what counts.
 */
export async function assertChannelCapacity(
  ctx: QueryCtx,
  groupId: Id<"groups">
): Promise<void> {
  const count = await countCapacityChannels(ctx, groupId);
  if (count >= MAX_CHANNELS_PER_GROUP) {
    throw new ConvexError(CHANNEL_CAP_MESSAGE);
  }
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
 * Shared channels are community-scoped (`inviteGroupToChannel` enforces it
 * and stamps `communityId`), so the scan uses `by_community_isShared` to
 * stay cheap even on deployments with many communities. This runs on hot
 * paths (membership sync), so it must never scan shares deployment-wide.
 */
export async function findAcceptedSharedAnnouncementsChannelsForGroup(
  ctx: QueryCtx,
  groupId: Id<"groups">
): Promise<Array<{ channel: Doc<"chatChannels">; entry: SharedGroupEntry }>> {
  const group = await ctx.db.get(groupId);
  if (!group) return [];

  const sharedChannels = await ctx.db
    .query("chatChannels")
    .withIndex("by_community_isShared", (q) =>
      q.eq("communityId", group.communityId).eq("isShared", true)
    )
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
