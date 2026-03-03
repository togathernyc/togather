import { useMemo } from "react";
import { useRouter } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";

export function useMembersPage(groupId: string) {
  const router = useRouter();
  const { token: authToken } = useAuth();

  // Fetch full group details using the Convex ID directly
  const groupData = useQuery(
    api.functions.groups.queries.getByIdWithRole,
    groupId && authToken ? { groupId: groupId as Id<"groups">, token: authToken } : "skip"
  );

  // Transform group data for backward compatibility
  const group = useMemo(() => {
    if (!groupData) return undefined;
    return {
      _id: groupData._id,
      id: groupData._id,
      name: groupData.name,
      description: groupData.description,
      group_type_id: groupData.groupTypeId,
      group_type_name: groupData.groupTypeName ?? undefined,
      userRole: groupData.userRole ?? undefined,
    };
  }, [groupData]);

  const isLoadingGroup = groupData === undefined && !!groupId && !!authToken;
  const groupError = null; // Convex throws on error, handle with ErrorBoundary

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // Fallback to group page if can't go back
      router.push(`/(user)/leader-tools/${groupId}`);
    }
  };

  return {
    group,
    isLoadingGroup,
    groupError,
    handleBack,
  };
}

