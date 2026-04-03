/**
 * Hook to get Convex channel ID from group ID and channel type.
 * 
 * This hook queries Convex to get the channel for a specific group and channel type.
 * If channels don't exist, it automatically creates them.
 * Returns the Convex channel ID that can be used with messaging hooks.
 */

import { useEffect, useRef } from 'react';
import { useQuery, useAction, api, useStoredAuthToken } from '@services/api/convex';
import type { Id } from '@services/api/convex';

export function useConvexChannelFromGroup(
  groupId: Id<"groups"> | null | undefined,
  channelType: "main" | "leaders"
): Id<"chatChannels"> | null | undefined {
  const token = useStoredAuthToken();

  // Skip query if no groupId or no token
  const shouldSkip = !groupId || !token;

  // Safe: shouldSkip ensures token exists when not skipping
  const channels = useQuery(
    api.functions.messaging.channels.getChannelsByGroup,
    shouldSkip ? "skip" : { token: token as string, groupId }
  );

  // Action to ensure channels exist
  const ensureChannels = useAction(api.functions.messaging.channels.ensureChannels);
  // Track which groupIds we've already ensured channels for
  const ensuredGroupsRef = useRef<Set<string>>(new Set());

  // Auto-create channels if they don't exist
  useEffect(() => {
    if (shouldSkip || !groupId) return;
    if (ensuredGroupsRef.current.has(groupId)) return;

    // If channels query returned empty array (not undefined/loading), check if we need to create channels
    if (channels !== undefined && channels.length === 0 && groupId && token) {
      ensuredGroupsRef.current.add(groupId);
      ensureChannels({ token, groupId }).catch((err) => {
        console.error('[useConvexChannelFromGroup] Failed to ensure channels:', err);
        ensuredGroupsRef.current.delete(groupId); // Retry on next render
      });
    }
  }, [channels, groupId, token, shouldSkip, ensureChannels]);

  if (!channels) {
    return undefined; // Loading
  }

  // Find channel with matching type
  const channel = channels.find(
    (ch) => ch.channelType === channelType
  );

  return channel?._id ?? null;
}

