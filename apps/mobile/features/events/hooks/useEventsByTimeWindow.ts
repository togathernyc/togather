/**
 * useEventsByTimeWindow Hook
 *
 * Wraps `api.functions.meetings.events.listForEventsTab` — the backend query
 * that powers the Events tab. Returns four pre-sliced buckets of event cards.
 *
 * We pass `now` as a state value that advances every 30s via a setInterval,
 * so time-window boundaries (happening now / this week / later) stay fresh
 * without re-running the query on every render.
 */

import { useEffect, useState } from 'react';
import { useQuery, api, useAuthenticatedQuery } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';

type EventCard =
  ReturnType<typeof useQuery<typeof api.functions.meetings.events.listForEventsTab>> extends
    | { happeningNow: infer T; myRsvps: any; thisWeek: any; later: any }
    | undefined
    | null
    ? T extends Array<infer U>
      ? U
      : never
    : never;

type EventsTabData = {
  happeningNow: EventCard[];
  myRsvps: EventCard[];
  thisWeek: EventCard[];
  later: EventCard[];
};

// Stable empty fallback to prevent re-render loops while loading
const EMPTY_DATA: EventsTabData = {
  happeningNow: [],
  myRsvps: [],
  thisWeek: [],
  later: [],
};

// How often to advance `now` so time-window boundaries stay fresh.
const NOW_REFRESH_INTERVAL_MS = 30 * 1000;

export function useEventsByTimeWindow(options?: { enabled?: boolean }) {
  const { community } = useAuth();
  const communityId = community?.id as Id<'communities'> | undefined;

  // `now` advances every 30s so the backend can re-slice buckets without us
  // re-querying on every render. useState initializer ensures one initial value.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, NOW_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // useAuthenticatedQuery pulls the token from useStoredAuthToken (ref-stable
  // across refreshes) and handles memoization internally — avoids the
  // previously-fixed cascading re-render pattern from token changes.
  // See #299 / commit 01251be.
  const shouldSkip = !communityId || options?.enabled === false;
  const result = useAuthenticatedQuery(
    api.functions.meetings.events.listForEventsTab,
    shouldSkip ? 'skip' : { communityId: communityId!, now }
  );

  const isLoading = result === undefined;
  const data = (result ?? EMPTY_DATA) as EventsTabData;

  return { data, isLoading };
}
