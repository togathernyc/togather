import { useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

/**
 * Hook to archive a group (soft delete) using Convex
 *
 * @param groupId - Group ID (Convex ID)
 */
export function useArchiveGroup(groupId: number | string | null | undefined) {
  const router = useRouter();
  const updateGroupMutation = useAuthenticatedMutation(api.functions.groups.index.update);
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(async () => {
    if (!groupId) {
      Alert.alert("Error", "Group ID is required");
      return;
    }

    setIsPending(true);
    try {
      // Archive by setting isArchived to true via update mutation
      await updateGroupMutation({
        groupId: String(groupId) as Id<"groups">,
        isArchived: true,
      });

      Alert.alert("Success", "Group has been archived.", [
        {
          text: "OK",
          onPress: () => {
            // Navigate back to groups list
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/groups");
            }
          },
        },
      ]);
    } catch (error: any) {
      const errorMessage = formatError(error, "Failed to archive group. Please try again.");
      Alert.alert("Error", errorMessage);
    } finally {
      setIsPending(false);
    }
  }, [groupId, updateGroupMutation, router]);

  const mutateAsync = useCallback(async () => {
    if (!groupId) {
      throw new Error("Group ID is required");
    }

    setIsPending(true);
    try {
      await updateGroupMutation({
        groupId: String(groupId) as Id<"groups">,
        isArchived: true,
      });
    } finally {
      setIsPending(false);
    }
  }, [groupId, updateGroupMutation]);

  return {
    mutate,
    mutateAsync,
    isPending,
  };
}
