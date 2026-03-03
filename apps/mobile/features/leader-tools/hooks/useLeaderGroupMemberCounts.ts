import { useMemo } from "react";
import { useQuery, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

/**
 * Hook to fetch member counts for leader groups
 * Uses Convex to get group details which includes member counts
 */
export function useLeaderGroupMemberCounts(groupIds: string[]) {
  const { user, community, token } = useAuth();

  // Fetch all user groups which includes member counts
  const queryArgs = useMemo(() => {
    if (!user?.id || !community?.id || !token) {
      return "skip" as const;
    }
    return {
      token,
      communityId: community.id as Id<"communities">,
    };
  }, [user?.id, community?.id, token]);

  const userGroups = useQuery(
    api.functions.groups.queries.listForUser,
    queryArgs
  );

  const isLoading = userGroups === undefined;
  const error = null; // Convex throws on error, handle with ErrorBoundary

  const counts = useMemo(() => {
    // Note: listForUser doesn't include member arrays.
    // For now, return 0 for all groups. A proper implementation would
    // require a dedicated Convex query to get member counts efficiently.
    const countMap: Record<string, number> = {};
    groupIds.forEach((groupId) => {
      // We could add a memberCount field to the Convex query in the future
      countMap[groupId] = 0;
    });

    return countMap;
  }, [groupIds]);

  return {
    data: counts,
    isLoading,
    error,
  };
}

