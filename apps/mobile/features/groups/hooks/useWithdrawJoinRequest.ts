import { Alert } from "react-native";
import { useMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

/**
 * Hook to withdraw a pending join request using Convex
 */
export function useWithdrawJoinRequest(groupId: string | null | undefined) {
  const { user, token } = useAuth();
  const cancelJoinRequestMutation = useMutation(
    api.functions.groupMembers.cancelJoinRequest
  );

  const mutate = async () => {
    if (!groupId) {
      Alert.alert("Error", "Group ID is required");
      return;
    }

    if (!user?.id) {
      Alert.alert("Error", "You must be logged in");
      return;
    }

    if (!token) {
      Alert.alert("Error", "Authentication required. Please log in again.");
      return;
    }

    try {
      await cancelJoinRequestMutation({
        token,
        groupId: groupId as Id<"groups">,
      });

      // Show success message
      Alert.alert("Request Withdrawn", "Your join request has been withdrawn.");
    } catch (error: any) {
      const errorMessage = formatError(error, "Failed to withdraw request. Please try again.");
      Alert.alert("Error", errorMessage);
    }
  };

  const mutateAsync = async () => {
    if (!groupId) {
      throw new Error("Group ID is required");
    }

    if (!user?.id) {
      throw new Error("You must be logged in");
    }

    if (!token) {
      throw new Error("Authentication required. Please log in again.");
    }

    return cancelJoinRequestMutation({
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
