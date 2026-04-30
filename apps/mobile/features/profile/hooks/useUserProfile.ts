/**
 * Aggregate hook that feeds `UserProfileScreen`.
 *
 * Wraps the three backend queries:
 *   - `users.getProfile` → public + community-scoped profile fields
 *   - `userProfiles.getMutualGroups` → mutual groups with viewer
 *   - `userProfiles.getVisibleUpcomingEvents` → privacy-filtered upcoming
 *
 * Viewer-scoped queries can be skipped (e.g. when viewing self) via the
 * `skipViewerScopedQueries` flag.
 */

import { useMemo } from 'react';
import { api, useAuthenticatedQuery } from '@services/api/convex';
import type { Id } from '@services/api/convex';

export interface UserProfile {
  _id: Id<'users'>;
  firstName?: string;
  lastName?: string;
  profilePhoto: string | null;
  notificationsDisabled: boolean;
  bio: string | null;
  instagramHandle: string | null;
  linkedinHandle: string | null;
  birthdayMonth: number | null;
  birthdayDay: number | null;
  location: string | null;
  memberSince: number | null;
  communityRole: number;
  isCommunityAdmin: boolean;
  isPrimaryAdmin: boolean;
  leaderGroupIds: Id<'groups'>[];
}

export interface MutualGroup {
  _id: Id<'groups'>;
  name: string;
  preview: string | null;
  shortId: string | null;
  memberCount: number;
}

// Mirrors the shape produced by the events tab `buildBucket`, extended with
// a `role` field returned by `getVisibleUpcomingEvents`. Typed loosely here
// to avoid duplicating the full EventCard union from the backend — the
// consumer (`UserProfileUpcomingEvents`) narrows on `kind`.
export type UpcomingEvent = {
  kind: 'single' | 'community_wide';
  id?: Id<'meetings'>;
  shortId?: string | null;
  title: string | null;
  scheduledAt: string;
  role?: 'hosting' | 'attending';
  [key: string]: unknown;
};

interface UseUserProfileInput {
  userId: Id<'users'> | null;
  communityId: Id<'communities'> | null;
  skipViewerScopedQueries?: boolean;
}

export function useUserProfile({
  userId,
  communityId,
  skipViewerScopedQueries,
}: UseUserProfileInput) {
  const profile = useAuthenticatedQuery(
    api.functions.users.getProfile,
    userId && communityId ? { userId, communityId } : 'skip',
  );

  const mutualGroups = useAuthenticatedQuery(
    api.functions.userProfiles.getMutualGroups,
    userId && communityId && !skipViewerScopedQueries
      ? { profileUserId: userId, communityId }
      : 'skip',
  );

  // `now` is memoized to a single mount-time timestamp so the query key
  // stays stable — otherwise every render re-subscribes.
  const now = useMemo(() => Date.now(), []);

  const upcomingEvents = useAuthenticatedQuery(
    api.functions.userProfiles.getVisibleUpcomingEvents,
    userId && communityId && !skipViewerScopedQueries
      ? { profileUserId: userId, communityId, now }
      : 'skip',
  );

  const isLoading =
    profile === undefined ||
    (!skipViewerScopedQueries &&
      (mutualGroups === undefined || upcomingEvents === undefined));

  return {
    profile: profile ?? null,
    mutualGroups: (mutualGroups as MutualGroup[] | undefined) ?? null,
    upcomingEvents: (upcomingEvents as UpcomingEvent[] | undefined) ?? null,
    isLoading,
  };
}
