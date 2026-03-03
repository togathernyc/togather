import { useAuthenticatedMutation, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { Alert } from "react-native";
import { formatError } from "@/utils/error-handling";

export function useMemberActions(groupId: string) {
  const { user } = useAuth();
  const currentUserId = user?.id as Id<"users"> | undefined;

  const removeMember = useAuthenticatedMutation(api.functions.groupMembers.remove);
  const updateRole = useAuthenticatedMutation(api.functions.groupMembers.updateRole);

  // Use groupId directly as Convex ID
  const convexGroupId = groupId as Id<"groups">;

  const handleMemberAction = async (member: any, action: string) => {
    if (!currentUserId || !groupId) {
      console.error("User not authenticated or group not found");
      return;
    }

    try {
      // Use Convex ID only - no legacy fallbacks
      const memberId = member.user?.id;
      if (!memberId) {
        throw new Error("Member ID not found - user._id is required");
      }

      if (action === "remove") {
        await removeMember({
          groupId: convexGroupId,
          userId: memberId as Id<"users">,
        });
        // Convex auto-updates reactive queries - no manual invalidation needed
      } else if (action === "promote") {
        await updateRole({
          groupId: convexGroupId,
          userId: memberId as Id<"users">,
          role: "leader",
        });
        // Convex auto-updates reactive queries - no manual invalidation needed
      } else if (action === "demote") {
        await updateRole({
          groupId: convexGroupId,
          userId: memberId as Id<"users">,
          role: "member",
        });
        // Convex auto-updates reactive queries - no manual invalidation needed
      }
    } catch (error: any) {
      console.error("Failed to perform member action:", error);
      const errorMessage = formatError(error, "Failed to perform action. Please try again.");
      Alert.alert("Error", errorMessage);
    }
  };

  return {
    handleMemberAction,
  };
}
