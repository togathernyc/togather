/**
 * useCommunityEvents Hook
 *
 * Fetches community-wide events that the user has access to.
 * Visibility is filtered on the backend for security.
 *
 * Uses Convex queries:
 * - api.functions.meetings.explore.communityEvents - Community-wide event listing with filters
 * - api.functions.meetings.explore.myRsvpEvents - User's RSVPed events across all groups
 * - api.functions.groups.index.myLeaderGroups - Groups where user has leader role
 */

import { api, useAuthenticatedQuery } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';

export interface EventsFilters {
  dateFilter: 'all' | 'today' | 'this_week' | 'this_month' | 'custom';
  startDate?: string;
  endDate?: string;
  hostingGroups: string[];
}

export interface CommunityEvent {
  id: string;
  shortId: string | null;
  title: string | null;
  scheduledAt: string;
  status: string;
  visibility: 'group' | 'community' | 'public';
  coverImage?: string | null;
  locationOverride: string | null;
  meetingType: number;
  rsvpEnabled: boolean;
  /** If set, this event is part of a community-wide event */
  communityWideEventId?: string | null;
  group: {
    id: string;
    name: string;
    image?: string | null;
    groupTypeName: string;
    // Address for map display (events fall back to group location)
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  };
  rsvpSummary: {
    totalGoing: number;
    topGoingGuests: Array<{
      id: string;
      firstName: string;
      profileImage: string | null;
    }>;
  };
  /** When true, RSVP count is hidden from non-leaders. Leaders still see it with a "Leaders only" badge. */
  hideRsvpCount: boolean;
  createdById: string | null;
  /** True when the viewer is a leader of the hosting group or the event creator. */
  viewerIsLeader: boolean;
}

// Stable empty arrays/objects to prevent infinite re-renders
// Use any[] for events to avoid type conflicts with different event shapes
const EMPTY_EVENTS_DATA: { events: any[]; nextCursor: null } = { events: [], nextCursor: null };
const EMPTY_LEADER_GROUPS: any[] = [];
const EMPTY_RSVP_EVENTS_DATA: { events: any[] } = { events: [] };

export function useCommunityEvents(filters: EventsFilters, options?: { enabled?: boolean }) {
  const { community } = useAuth();

  // Get community Convex ID
  const communityId = community?.id as Id<"communities"> | undefined;

  const shouldSkip = !communityId || options?.enabled === false;
  const hostingGroupIds = filters.hostingGroups.length > 0
    ? (filters.hostingGroups as unknown as Id<"groups">[])
    : undefined;
  const datePreset = filters.dateFilter === 'all'
    ? undefined
    : (filters.dateFilter ?? undefined);

  // useAuthenticatedQuery handles token stability — see
  // features/events/__tests__/query-patterns.test.ts for the rationale.
  const result = useAuthenticatedQuery(
    api.functions.meetings.explore.communityEvents,
    shouldSkip
      ? 'skip'
      : {
          communityId: communityId!,
          datePreset,
          startDate: filters.startDate ?? undefined,
          endDate: filters.endDate ?? undefined,
          hostingGroupIds,
        }
  );

  // Convex returns undefined while loading, then the actual data
  const isLoading = result === undefined;
  // Use stable fallback to prevent infinite re-renders
  const data = result ?? EMPTY_EVENTS_DATA;

  return {
    data,
    isLoading,
    isFetching: isLoading, // Convex doesn't distinguish between loading and fetching
    isError: false, // Convex queries don't have an error state in the same way
    error: null,
    // Convex queries are reactive, no explicit refetch needed
    refetch: () => {},
  };
}

/**
 * Hook to fetch groups user can create events for (leader/admin groups)
 */
export function useLeaderGroups(options?: { enabled?: boolean }) {
  const { community } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;

  const shouldSkip = options?.enabled === false || !communityId;
  const result = useAuthenticatedQuery(
    api.functions.groups.index.myLeaderGroups,
    shouldSkip ? 'skip' : { communityId: communityId! }
  );

  // Convex returns undefined while loading
  const isLoading = result === undefined;
  // Use stable fallback to prevent infinite re-renders
  const data = result ?? EMPTY_LEADER_GROUPS;

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
 * Hook to fetch groups the current user can create events IN — i.e., any
 * active-membership group. Each row carries `isLeader` and
 * `isAnnouncementGroup` flags so the CreateEventScreen can toggle
 * leader-only UI and default the dropdown to the community announcement
 * group for members. See ADR-022.
 */
export function useCreatableGroups(options?: { enabled?: boolean }) {
  const { community } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;

  const shouldSkip = options?.enabled === false || !communityId;
  const result = useAuthenticatedQuery(
    api.functions.groups.members.myCreatableGroups,
    shouldSkip ? 'skip' : { communityId: communityId! }
  );

  const isLoading = result === undefined;
  const data = result ?? EMPTY_LEADER_GROUPS;

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
 * Hook to fetch events the user has RSVPed to
 * This does NOT require community context - useful for users without a community
 */
export function useMyRsvpedEvents(options?: { enabled?: boolean; includePast?: boolean }) {
  const shouldSkip = options?.enabled === false;
  const result = useAuthenticatedQuery(
    api.functions.meetings.explore.myRsvpEvents,
    shouldSkip ? 'skip' : { includePast: options?.includePast ?? false }
  );

  // Convex returns undefined while loading
  const isLoading = result === undefined;
  // Use stable fallback to prevent infinite re-renders
  const data = result ?? EMPTY_RSVP_EVENTS_DATA;

  return {
    data,
    isLoading,
    isFetching: isLoading,
    isError: false,
    error: null,
    refetch: () => {},
  };
}
