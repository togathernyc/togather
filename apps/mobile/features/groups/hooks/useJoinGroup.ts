import { Alert } from "react-native";
import { useMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

/**
 * Hook to request to join a group using Convex
 *
 * @param groupId - The group ID to join
 * @param queryKeyId - Unused, kept for backwards compatibility
 */
export function useJoinGroup(
  groupId: string | null | undefined,
  queryKeyId?: string | null | undefined
) {
  const { user, token } = useAuth();
  const createJoinRequestMutation = useMutation(
    api.functions.groupMembers.createJoinRequest
  );

  const mutate = async () => {
    if (!groupId) {
      Alert.alert("Error", "Group ID is required");
      return;
    }

    if (!user?.id) {
      Alert.alert("Error", "You must be logged in to join a group");
      return;
    }

    if (!token) {
      Alert.alert("Error", "Authentication required. Please log in again.");
      return;
    }

    try {
      await createJoinRequestMutation({
        token,
        groupId: groupId as Id<"groups">,
      });

      // Success handling is done by the calling component (shows modal)
    } catch (error: any) {
      const errorMessage = formatError(error, "Failed to request to join group. Please try again.");
      Alert.alert("Error", errorMessage);
    }
  };

  const mutateAsync = async () => {
    if (!groupId) {
      throw new Error("Group ID is required");
    }

    if (!user?.id) {
      throw new Error("You must be logged in to join a group");
    }

    if (!token) {
      throw new Error("Authentication required. Please log in again.");
    }

    return createJoinRequestMutation({
      token,
      groupId: groupId as Id<"groups">,
    });
  };

  return {
    mutate,
    mutateAsync,
    isPending: false,
  };
}
