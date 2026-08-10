/**
 * Minimal channel shape needed to choose the inbox "main spot" channel.
 * Matches the relevant fields of `ChannelData` from the getInboxChannels query.
 */
export interface MainSpotChannel {
  channelType: string;
  unreadCount: number;
  lastMessageAt: number | null;
}

/**
 * Chooses which channel occupies the prominent "main spot" of a grouped inbox row.
 *
 * Previously the "General" channel (channelType === "main") always held the main
 * spot, even when it had no updates, pushing channels that *did* have updates into
 * a secondary position. Now the main spot follows the updates:
 *
 * - The General channel reclaims the main spot whenever it has its own unread
 *   updates — per product requirement, General takes priority when it has an update.
 * - Otherwise, the most recently updated channel with unread messages takes the spot.
 * - When no channel has updates, fall back to the General channel (or, if there is
 *   no General channel, the first channel) so the row still renders as before.
 */
export function selectMainChannel<T extends MainSpotChannel>(channels: T[]): T | undefined {
  if (channels.length === 0) {
    return undefined;
  }

  const generalChannel = channels.find((ch) => ch.channelType === "main");

  // General reclaims the main spot when it has its own updates.
  if (generalChannel && generalChannel.unreadCount > 0) {
    return generalChannel;
  }

  // Otherwise the most recently updated channel with unread messages wins.
  const mostRecentWithUpdates = channels
    .filter((ch) => ch.unreadCount > 0)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))[0];

  // Fall back to General (or the first channel) when nothing has updates.
  return mostRecentWithUpdates ?? generalChannel ?? channels[0];
}
