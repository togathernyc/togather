import { useEffect } from "react";
import { useAuthenticatedQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useChannelsCache } from "@/stores/channelsCache";

export type UseGroupChannelsOptions = {
  /** When true, leaders see archived channels so they can turn them back on. */
  includeArchived?: boolean;
};

/**
 * Hook to fetch group channels with offline cache support.
 *
 * Wraps the listGroupChannels query with channelsCache for
 * stale-while-revalidate offline access. Used by ChannelsSection
 * on the group detail page.
 */
export function useGroupChannels(groupId: string, options?: UseGroupChannelsOptions) {
  const { setGroupChannels, getGroupChannels } = useChannelsCache();
  const includeArchived = options?.includeArchived === true;

  const liveChannels = useAuthenticatedQuery(
    api.functions.messaging.channels.listGroupChannels,
    { groupId: groupId as Id<"groups">, includeArchived }
  );

  // Write to cache when live data arrives
  useEffect(() => {
    if (liveChannels && groupId) {
      setGroupChannels(groupId, liveChannels);
    }
  }, [liveChannels, groupId, setGroupChannels]);

  // Read from cache while query is loading
  const cachedChannels = liveChannels === undefined ? getGroupChannels(groupId) : null;

  const channels = liveChannels ?? cachedChannels ?? undefined;
  const isStale = !liveChannels && !!cachedChannels;
  const isLoading = channels === undefined;

  return { channels, isLoading, isStale };
}
