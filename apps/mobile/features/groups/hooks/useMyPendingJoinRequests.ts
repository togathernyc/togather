import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

/**
 * Maximum number of pending join requests a user may have at one time within
 * a single community before the client blocks them from requesting more.
 *
 * This is a frontend-only stopgap — the backend continues to allow unlimited
 * memberships so admins/leaders who legitimately need to be in many groups
 * are unaffected. See `listMyPendingJoinRequests` in apps/convex/functions/
 * groupMembers.ts for the data source.
 */
export const PENDING_JOIN_REQUEST_LIMIT = 2;

export type PendingJoinRequest = {
  id: string;
  groupId: string;
  groupName: string;
  groupTypeName: string;
  requestedAt: number;
};

/**
 * Returns the current user's pending join requests within the active community.
 *
 * - `requests` — list of pending requests, newest first.
 * - `count` — convenience accessor (length).
 * - `isAtLimit` — true when the user has hit `PENDING_JOIN_REQUEST_LIMIT`.
 * - `isLoading` — true while the query is in flight.
 *
 * Returns an empty list when the user is unauthenticated or no community is
 * selected (rather than throwing) so callers don't need to special-case those
 * states — the gate simply doesn't fire.
 */
export function useMyPendingJoinRequests() {
  const { token, community } = useAuth();

  const data = useQuery(
    api.functions.groupMembers.listMyPendingJoinRequests,
    token && community?.id
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  const requests: PendingJoinRequest[] = (data ?? []) as PendingJoinRequest[];

  return {
    requests,
    count: requests.length,
    isAtLimit: requests.length >= PENDING_JOIN_REQUEST_LIMIT,
    isLoading: data === undefined && !!token && !!community?.id,
  };
}
