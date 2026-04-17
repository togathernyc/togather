/**
 * Profile → My Events hooks (and the non-leader cap gate on CreateEventScreen).
 *
 * Both hooks use `useAuthenticatedQuery` (ref-stable across JWT refresh — see
 * PR #316 and `__tests__/query-patterns.test.ts`). Never swap in raw
 * `useQuery` + token or the Events tab flicker returns.
 */

import { useMemo } from 'react';
import { api, useAuthenticatedQuery } from '@services/api/convex';

type EventCard = unknown; // keep the client loose; Convex return types flow through

interface MyEventsResult {
  upcoming: EventCard[];
  past: EventCard[];
}

const EMPTY_MY_EVENTS: MyEventsResult = { upcoming: [], past: [] };

interface Options {
  enabled?: boolean;
  includePast?: boolean;
}

/**
 * Events the current user created. Drives Profile → My Events (Hosted) and
 * the 1-future-event cap on CreateEventScreen.
 */
export function useMyHostedEvents(options?: Options) {
  // `now` is memoised so the query key stays stable across renders — we don't
  // want a new `Date.now()` each render re-subscribing the query.
  const nowMs = useMemo(() => Date.now(), []);
  const shouldSkip = options?.enabled === false;

  const result = useAuthenticatedQuery(
    api.functions.meetings.myEvents.myHostedEvents,
    shouldSkip
      ? 'skip'
      : { now: nowMs, includePast: options?.includePast ?? false }
  );

  const isLoading = result === undefined;
  const data = (result ?? EMPTY_MY_EVENTS) as MyEventsResult;
  return {
    data,
    isLoading,
    isFetching: isLoading,
    isError: false,
    error: null,
    refetch: () => {},
  };
}

/**
 * Events the current user has RSVP'd Going to (excluding events they hosted).
 * Drives Profile → My Events (Attended).
 */
export function useMyAttendedEvents(options?: Options) {
  const nowMs = useMemo(() => Date.now(), []);
  const shouldSkip = options?.enabled === false;

  const result = useAuthenticatedQuery(
    api.functions.meetings.myEvents.myAttendedEvents,
    shouldSkip
      ? 'skip'
      : { now: nowMs, includePast: options?.includePast ?? false }
  );

  const isLoading = result === undefined;
  const data = (result ?? EMPTY_MY_EVENTS) as MyEventsResult;
  return {
    data,
    isLoading,
    isFetching: isLoading,
    isError: false,
    error: null,
    refetch: () => {},
  };
}
