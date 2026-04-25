/**
 * useEventsByTimeWindow Hook
 *
 * Wraps `api.functions.meetings.events.listForEventsTab` — the backend query
 * that powers the Events tab. Returns three in-window sections: myEvents
 * (RSVP'd or hosted), nextUp (next 48h), thisWeek (next 7d). The Later
 * section (>7d out) has its own paginated query — see useLaterEvents.
 */

import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery, api, useAuthenticatedQuery } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';

type EventCard =
  ReturnType<typeof useQuery<typeof api.functions.meetings.events.listForEventsTab>> extends
    | { myEvents: infer T; nextUp: any; thisWeek: any }
    | undefined
    | null
    ? T extends Array<infer U>
      ? U
      : never
    : never;

type EventsTabData = {
  myEvents: EventCard[];
  nextUp: EventCard[];
  thisWeek: EventCard[];
};

// Stable empty fallback to prevent re-render loops while loading
const EMPTY_DATA: EventsTabData = {
  myEvents: [],
  nextUp: [],
  thisWeek: [],
};

export function useEventsByTimeWindow(options?: { enabled?: boolean }) {
  const { community } = useAuth();
  const communityId = community?.id as Id<'communities'> | undefined;

  // `now` advances only when the user leaves the Events tab and comes back
  // — NOT on initial mount (the useState initializer already set a fresh
  // `now`), and NOT on every focus event (stacked routes / sheets can fire
  // focus-regained without a meaningful departure, which read as flicker).
  // See feedback on PR #316 + follow-up.
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

  // useAuthenticatedQuery pulls the token from useStoredAuthToken (ref-stable
  // across refreshes) and handles memoization internally — avoids the
  // previously-fixed cascading re-render pattern from token changes.
  // See #299 / commit 01251be.
  const shouldSkip = !communityId || options?.enabled === false;
  const result = useAuthenticatedQuery(
    api.functions.meetings.events.listForEventsTab,
    shouldSkip ? 'skip' : { communityId: communityId!, now }
  );

  // Hold onto the last successful payload so a transient `undefined` from the
  // Convex subscription (e.g. a websocket reconnect) doesn't flash the screen
  // back to a loading spinner. `isLoading` only flips back to true on a fresh
  // mount or a hard skip → re-enable transition.
  const lastDataRef = useRef<EventsTabData | null>(null);
  if (result !== undefined) {
    lastDataRef.current = result as EventsTabData;
  }

  const data = (lastDataRef.current ?? EMPTY_DATA) as EventsTabData;
  const isLoading = result === undefined && lastDataRef.current === null;

  return { data, isLoading };
}
