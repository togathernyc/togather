/**
 * useEventSearch Hook
 *
 * Full-text search for events within a community using the
 * search_meetings Convex search index. Replaces client-side
 * event filtering with proper backend search.
 */

import { api, useAuthenticatedQuery } from '@services/api/convex';
import type { Id } from '@services/api/convex';

export function useEventSearch(searchTerm: string, communityId?: string) {
  const trimmed = searchTerm.trim();
  const shouldSkip = !trimmed || !communityId;

  // useAuthenticatedQuery handles token stability — see
  // features/events/__tests__/query-patterns.test.ts for the rationale.
  const result = useAuthenticatedQuery(
    api.functions.meetings.explore.searchEvents,
    shouldSkip
      ? 'skip'
      : {
          communityId: communityId as Id<'communities'>,
          searchTerm: trimmed,
          limit: 20,
        }
  );

  return {
    data: result,
    isLoading: result === undefined && !shouldSkip,
    isSearching: !shouldSkip,
  };
}
