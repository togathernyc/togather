/**
 * Messaging helper functions
 *
 * Shared utilities for messaging functions (channels, messages, etc.)
 */

import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

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
