/**
 * useEventSearch Hook
 *
 * Full-text search for events within a community using the
 * search_meetings Convex search index. Replaces client-side
 * event filtering with proper backend search.
 */

import { useMemo } from 'react';
import { useQuery, api } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';

export function useEventSearch(searchTerm: string, communityId?: string) {
  const { user, token } = useAuth();

  const queryArgs = useMemo(() => {
    const trimmed = searchTerm.trim();
    if (!trimmed || !communityId) {
      return "skip" as const;
    }

    // Wait for token if user is authenticated
    if (user?.id && !token) {
      return "skip" as const;
    }

    const baseArgs = {
      communityId: communityId as Id<"communities">,
      searchTerm: trimmed,
      limit: 20,
    };

    if (user?.id && token) {
      return { ...baseArgs, token };
    }
    return baseArgs;
  }, [searchTerm, communityId, user?.id, token]);

  const result = useQuery(api.functions.meetings.explore.searchEvents, queryArgs);

  return {
    data: result,
    isLoading: result === undefined && queryArgs !== "skip",
    isSearching: queryArgs !== "skip",
  };
}
