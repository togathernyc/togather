import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

type LeaveGroupArgs = {
  groupId: string | number;
  userId: string;
};

/**
 * Hook to leave a group using Convex
 */
export function useLeaveGroup() {
  const router = useRouter();
  const { user } = useAuth();
  const removeMemberMutation = useAuthenticatedMutation(api.functions.groupMembers.remove);

  const mutate = async (args: LeaveGroupArgs) => {
    if (!user?.id) {
      Alert.alert("Error", "You must be logged in");
      return;
    }

    try {
      await removeMemberMutation({
        groupId: String(args.groupId) as Id<"groups">,
        userId: args.userId as Id<"users">,
      });

      // Navigate back if possible
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/groups");
      }
    } catch (error: any) {
      const errorMessage = formatError(error, "Failed to leave group. Please try again.");
      Alert.alert("Error", errorMessage);
    }
  };

  const mutateAsync = async (args: LeaveGroupArgs) => {
    if (!user?.id) {
      throw new Error("You must be logged in");
    }

    return removeMemberMutation({
      groupId: String(args.groupId) as Id<"groups">,
      userId: args.userId as Id<"users">,
    });
  };

  return {
    mutate,
    mutateAsync,
    isPending: false,
  };
}
