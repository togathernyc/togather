import { useCallback, useState } from "react";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";

/**
 * Group type data structure
 */
export interface GroupType {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  isActive: boolean;
  displayOrder: number;
  groupCount: number;
}

/**
 * Hook for managing group types
 */
export function useGroupTypes() {
  const { community, user, token } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [updateError, setUpdateError] = useState<Error | null>(null);
  const [createError, setCreateError] = useState<Error | null>(null);

  // Only admins can list group types via admin API
  const isAdmin = user?.is_admin === true;

  // Fetch all group types (admin-only)
  const groupTypes = useQuery(
    api.functions.admin.settings.listGroupTypes,
    community?.id && token && isAdmin
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  // isLoading is true only when we're actually fetching (admin user with query in progress)
  // For non-admin users, the query is skipped so we're not loading
  const isLoading = isAdmin && groupTypes === undefined;

  // Mutations
  const updateMutation = useAuthenticatedMutation(api.functions.admin.settings.updateGroupType);
  const createMutation = useAuthenticatedMutation(api.functions.admin.settings.createGroupType);

  // Update group type function
  const updateGroupType = useCallback(
    async (data: {
      groupTypeId: string;
      name?: string;
      description?: string;
    }) => {
      if (!community?.id || !user?.id) {
        throw new Error("Not authenticated");
      }

      setIsUpdating(true);
      setUpdateError(null);

      try {
        const result = await updateMutation({
          communityId: community.id as Id<"communities">,
          groupTypeId: data.groupTypeId as Id<"groupTypes">,
          name: data.name,
          description: data.description,
        });
        return result;
      } catch (error) {
        setUpdateError(error as Error);
        throw error;
      } finally {
        setIsUpdating(false);
      }
    },
    [community?.id, user?.id, updateMutation]
  );

  // Create group type function
  const createGroupType = useCallback(
    async (data: { name: string; description?: string }) => {
      if (!community?.id || !user?.id) {
        throw new Error("Not authenticated");
      }

      setIsCreating(true);
      setCreateError(null);

      try {
        const result = await createMutation({
          communityId: community.id as Id<"communities">,
          name: data.name,
          description: data.description,
        });
        return result;
      } catch (error) {
        setCreateError(error as Error);
        throw error;
      } finally {
        setIsCreating(false);
      }
    },
    [community?.id, user?.id, createMutation]
  );

  // Refetch is a no-op in Convex (auto-updating), but keep for API compatibility
  const refetch = useCallback(() => {
    // Convex queries auto-update, no manual refetch needed
  }, []);

  return {
    groupTypes: groupTypes as GroupType[] | undefined,
    isLoading,
    isError: false, // Convex throws on error
    error: null,
    refetch,
    updateGroupType,
    isUpdating,
    updateError,
    createGroupType,
    isCreating,
    createError,
  };
}
