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

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
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

export function useEventsByTimeWindow(options?: { enabled?: boolean }) {
  const { community } = useAuth();
  const communityId = community?.id as Id<'communities'> | undefined;

  // `now` advances ONLY when the screen gains focus — NOT on a timer.
  // A timer-driven refresh forces the query to re-subscribe at every
  // tick, which is visible as a UI flicker. Refreshing on focus is both
  // cheaper and matches user expectation ("when I come back to this tab
  // it should be up-to-date"). See also feedback on PR #316.
  const [now, setNow] = useState<number>(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
    }, [])
  );

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
