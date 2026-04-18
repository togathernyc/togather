/**
 * useLaterEvents Hook
 *
 * Paginated query for the "Later" section (events beyond 7 days out). Wraps
 * `api.functions.meetings.events.listLaterEvents`. Handles CWE card de-
 * duplication across pages — in the edge case where a CWE parent has
 * override children on divergent dates, its card can appear on multiple
 * pages; we keep the first occurrence client-side.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api, useAuthenticatedPaginatedQuery } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';

const INITIAL_PAGE_SIZE = 20;
const LOAD_MORE_PAGE_SIZE = 20;

export function useLaterEvents(options?: { enabled?: boolean }) {
  const { community } = useAuth();
  const communityId = community?.id as Id<'communities'> | undefined;
  // `now` advances when the user leaves the Events tab and comes back —
  // matching useEventsByTimeWindow so the 7-day cutoff stays consistent
  // across the two queries. Without this, tab-preserving navigation can
  // leave Later using a stale floor (events that crossed into the 7-day
  // window remain in Later, or appear in both sections).
  const [now, setNow] = useState<number>(() => Date.now());
  const hasBlurredRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasBlurredRef.current) {
        setNow(Date.now());
        hasBlurredRef.current = false;
      }
      return () => {
        hasBlurredRef.current = true;
      };
    }, [])
  );

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
