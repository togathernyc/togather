/**
 * useChannelMembers Hook
 *
 * Fetch channel members for @mention autocomplete and member lists.
 */

import { useQuery, api, useStoredAuthToken } from '@services/api/convex';
import type { Id } from '@services/api/convex';

interface ChannelMember {
  userId: Id<"users">;
  displayName: string;
  profilePhoto?: string;
  role: string;
}

interface UseChannelMembersResult {
  members: ChannelMember[];
  isLoading: boolean;
}

/**
 * Fetch channel members with real-time updates
 *
 * @param channelId - The channel ID to fetch members for, or null to skip
 * @returns Channel members and loading state
 *
 * @example
 * ```tsx
 * const { members, isLoading } = useChannelMembers(channelId);
 *
 * // Filter for autocomplete
 * const filtered = members.filter(m =>
 *   m.displayName.toLowerCase().includes(search.toLowerCase())
 * );
 * ```
 */
export function useChannelMembers(channelId: Id<"chatChannels"> | null): UseChannelMembersResult {
  const token = useStoredAuthToken();

  // Skip query if no channelId or no token
  const shouldSkip = !channelId || !token;

  // Safe: shouldSkip ensures token exists when not skipping
  const result = useQuery(
    api.functions.messaging.channels.getChannelMembers,
    shouldSkip ? "skip" : { token: token as string, channelId }
  );

  return {
    members: result?.members ?? [],
    isLoading: result === undefined,
  };
}
