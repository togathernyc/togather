/**
 * useLaterEvents Hook
 *
 * Paginated query for the "Later" section (events beyond 7 days out). Wraps
 * `api.functions.meetings.events.listLaterEvents`. Handles CWE card de-
 * duplication across pages — in the edge case where a CWE parent has
 * override children on divergent dates, its card can appear on multiple
 * pages; we keep the first occurrence client-side.
 */

import { useMemo, useState } from 'react';
import { api, useAuthenticatedPaginatedQuery } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';

const INITIAL_PAGE_SIZE = 20;
const LOAD_MORE_PAGE_SIZE = 20;

export function useLaterEvents(options?: { enabled?: boolean }) {
  const { community } = useAuth();
  const communityId = community?.id as Id<'communities'> | undefined;
  // Pinned once so pagination pages use a consistent cutoff; the hook will
  // reset when the Events tab is revisited via useEventsByTimeWindow's own
  // refresh cycle.
  const [now] = useState<number>(() => Date.now());

  const shouldSkip = !communityId || options?.enabled === false;
  const { results, loadMore, status, isLoading } =
    useAuthenticatedPaginatedQuery(
      api.functions.meetings.events.listLaterEvents,
      shouldSkip ? 'skip' : { communityId: communityId!, now },
      { initialNumItems: INITIAL_PAGE_SIZE }
    );

  // De-dupe CWE cards that may appear across pages.
  const cards = useMemo(() => {
    const seenParents = new Set<string>();
    const out: any[] = [];
    for (const card of results) {
      if (card.kind === 'community_wide') {
        const key = String(card.parentId);
        if (seenParents.has(key)) continue;
        seenParents.add(key);
      }
      out.push(card);
    }
    return out;
  }, [results]);

  return {
    cards,
    loadMore: () => loadMore(LOAD_MORE_PAGE_SIZE),
    status,
    isLoading,
  };
}
