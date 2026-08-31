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
 * Returns the current user's pending join requests within a community.
 *
 * Defaults to the user's active community, which is what every in-app caller
 * wants. Pass `communityId` when the surface can show a group from a *different*
 * community than the active one — a share link, for example: the cap has to be
 * counted in the community the request would actually be created in, or it
 * blocks and permits the wrong things.
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
export function useMyPendingJoinRequests(communityId?: string | null) {
  const { token, community } = useAuth();

  const targetCommunityId = communityId ?? community?.id;

  const data = useQuery(
    api.functions.groupMembers.listMyPendingJoinRequests,
    token && targetCommunityId
      ? {
          token,
          communityId: targetCommunityId as Id<"communities">,
        }
      : "skip"
  );

  const requests: PendingJoinRequest[] = (data ?? []) as PendingJoinRequest[];

  return {
    requests,
    count: requests.length,
    isAtLimit: requests.length >= PENDING_JOIN_REQUEST_LIMIT,
    isLoading: data === undefined && !!token && !!targetCommunityId,
  };
}
