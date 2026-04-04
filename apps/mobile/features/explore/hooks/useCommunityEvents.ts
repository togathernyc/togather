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

import { useMemo } from 'react';
import { useQuery, api } from '@services/api/convex';
import { useAuth } from '@providers/AuthProvider';
import type { Id } from '@services/api/convex';
import { ExploreFilters } from './useExploreFilters';

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
}

// Stable empty arrays/objects to prevent infinite re-renders
// Use any[] for events to avoid type conflicts with different event shapes
const EMPTY_EVENTS_DATA: { events: any[]; nextCursor: null } = { events: [], nextCursor: null };
const EMPTY_LEADER_GROUPS: any[] = [];
const EMPTY_RSVP_EVENTS_DATA: { events: any[] } = { events: [] };

export function useCommunityEvents(filters: ExploreFilters, options?: { enabled?: boolean }) {
  const { community, user, token } = useAuth();

  // Get community Convex ID
  const communityId = community?.id as Id<"communities"> | undefined;

  // Memoize query args to prevent unnecessary re-renders
  const queryArgs = useMemo(() => {
    // For authenticated queries, require token
    if (user?.id && !token) {
      return "skip" as const;
    }
    if (!communityId || filters.view !== 'events' || options?.enabled === false) {
      return "skip" as const;
    }

    // Convert hostingGroups (legacy string IDs) to Convex IDs
    const hostingGroupIds = filters.hostingGroups.length > 0
      ? filters.hostingGroups as unknown as Id<"groups">[]
      : undefined;

    // 'all' means no date filtering; map to undefined for the backend
    const datePreset = filters.dateFilter === 'all' ? undefined : (filters.dateFilter ?? undefined);

    const baseArgs = {
      communityId,
      datePreset,
      startDate: filters.startDate ?? undefined,
      endDate: filters.endDate ?? undefined,
      hostingGroupIds,
    };

    // Add token for authenticated queries
    if (user?.id && token) {
      return { ...baseArgs, token };
    }
    return baseArgs;
  }, [
    communityId,
    filters.view,
    filters.dateFilter,
    filters.startDate,
    filters.endDate,
    filters.hostingGroups,
    options?.enabled,
    user?.id,
    token,
  ]);

  const result = useQuery(api.functions.meetings.explore.communityEvents, queryArgs);

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
  const { community, user, token } = useAuth();
  const communityId = community?.id as Id<"communities"> | undefined;

  // Memoize query args to prevent unnecessary re-renders
  const queryArgs = useMemo(() => {
    // For authenticated queries, require token
    if (user?.id && !token) {
      return "skip" as const;
    }
    if (options?.enabled === false || !communityId) {
      return "skip" as const;
    }
    const baseArgs = { communityId };
    // Add token for authenticated queries
    if (user?.id && token) {
      return { ...baseArgs, token };
    }
    return baseArgs;
  }, [communityId, options?.enabled, user?.id, token]);

  const result = useQuery(api.functions.groups.index.myLeaderGroups, queryArgs);

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
 * Hook to fetch events the user has RSVPed to
 * This does NOT require community context - useful for users without a community
 */
export function useMyRsvpedEvents(options?: { enabled?: boolean; includePast?: boolean }) {
  const { user, token } = useAuth();

  // Memoize query args to prevent unnecessary re-renders
  const queryArgs = useMemo(() => {
    // For authenticated queries, require token
    if (user?.id && !token) {
      return "skip" as const;
    }
    if (options?.enabled === false) {
      return "skip" as const;
    }
    const baseArgs = {
      includePast: options?.includePast ?? false,
    };
    // Add token for authenticated queries
    if (user?.id && token) {
      return { ...baseArgs, token };
    }
    return baseArgs;
  }, [options?.enabled, options?.includePast, user?.id, token]);

  const result = useQuery(api.functions.meetings.explore.myRsvpEvents, queryArgs);

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
