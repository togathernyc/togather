import { useMemo } from "react";
import { useQuery, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { MembershipRole } from "@/constants/membership";
import { useAuth } from "@providers/AuthProvider";

/**
 * Hook to fetch groups where the user is a leader
 * Filters groups by role === LEADER (2) or "leader"
 */
export function useLeaderGroups() {
  const { token } = useAuth();

  // Fetch user's groups using Convex
  const groupsData = useQuery(
    api.functions.groups.queries.listForUser,
    token ? { token } : "skip"
  );

  // Transform data for backward compatibility
  const groups = useMemo(() => {
    if (!groupsData) return undefined;
    return groupsData.map((group: any) => ({
      _id: group._id,
      id: group._id,
      name: group.name,
      description: group.description,
      group_type_id: group.groupTypeId,
      group_type_name: group.groupTypeName,
      group_type_slug: group.groupTypeSlug,
      role: group.role,
      user_role: group.role,
      is_archived: group.isArchived,
      created_at: group.createdAt,
      updated_at: group.updatedAt,
      main_channel_id: group.mainChannelId,
      leaders_channel_id: group.leadersChannelId,
      members: group.members,
      leaders: group.leaders,
      is_on_break: group.isOnBreak,
      break_until: group.breakUntil,
    }));
  }, [groupsData]);

  const isLoading = groupsData === undefined;
  const error = null; // Convex throws on error, handle with ErrorBoundary

  // Backend assigns "member" or "leader" only — the legacy "admin" enum
  // is no longer produced. Keep the MembershipRole.LEADER comparison for
  // any callers that still pass the typed enum.
  const leaderGroups = useMemo(() => {
    return groups?.filter(
      (group: any) =>
        group.role === "leader" || group.role === MembershipRole.LEADER
    ) || [];
  }, [groups]);

  return {
    leaderGroups,
    isLoading,
    error,
  };
}

