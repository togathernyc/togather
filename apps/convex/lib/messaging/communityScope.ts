/**
 * Resolve the community a chat message belongs to.
 *
 * `chatMessages.communityId` is denormalized at write time so inbox search can
 * filter by community directly in the search index (instead of pulling globally
 * relevance-ranked rows and discarding cross-community hits afterwards). A
 * message's community is the community of its channel:
 *   - ad-hoc channels (dm/group_dm) carry `communityId` directly;
 *   - group channels inherit it from their owning group.
 */

import type { QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

export async function resolveChannelCommunityId(
  ctx: QueryCtx,
  channelId: Id<"chatChannels">,
): Promise<Id<"communities"> | undefined> {
  const channel = await ctx.db.get(channelId);
  if (!channel) return undefined;
  if (channel.communityId) return channel.communityId;
  if (channel.groupId) {
    const group = await ctx.db.get(channel.groupId);
    return group?.communityId ?? undefined;
  }
  return undefined;
}
