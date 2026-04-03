/**
 * useChannel Hook
 *
 * Subscribe to channel updates with real-time synchronization.
 * Returns channel data that automatically updates when the channel changes.
 */

import { useQuery, api, useStoredAuthToken } from '@services/api/convex';
import type { Id } from '@services/api/convex';

/**
 * Subscribe to a channel's data with real-time updates
 *
 * @param channelId - The channel ID to subscribe to, or null to skip
 * @returns Channel data with real-time updates, or undefined if loading
 *
 * @example
 * ```tsx
 * const channel = useChannel(channelId);
 * if (!channel) return <LoadingSpinner />;
 * return <Text>{channel.name}</Text>;
 * ```
 */
export function useChannel(channelId: Id<"chatChannels"> | null) {
  const token = useStoredAuthToken();

  // Skip query if no channelId or no token
  const shouldSkip = !channelId || !token;

  // Safe: shouldSkip ensures token exists when not skipping
  const channel = useQuery(
    api.functions.messaging.channels.getChannel,
    shouldSkip ? "skip" : { token: token as string, channelId }
  );

  return channel;
}
