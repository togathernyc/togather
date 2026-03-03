import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import { GroupUpdateData } from "../types";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

/**
 * Extract time in HH:MM format from various time string formats.
 * Handles ISO strings like "1970-01-01T15:00:00.000Z" and simple "HH:MM" strings.
 */
function extractTimeString(timeValue: string | undefined): string | undefined {
  if (!timeValue) return undefined;

  // If it looks like an ISO string, extract the time part
  if (timeValue.includes("T")) {
    try {
      const date = new Date(timeValue);
      if (!isNaN(date.getTime())) {
        const hours = date.getUTCHours().toString().padStart(2, "0");
        const minutes = date.getUTCMinutes().toString().padStart(2, "0");
        return `${hours}:${minutes}`;
      }
    } catch {
      // Fall through to return original
    }
  }

  // Already in HH:MM format or similar
  return timeValue;
}

/**
 * Hook to update group information using Convex.
 * Only leaders/admins can update groups.
 */
export function useUpdateGroup(groupId?: string) {
  const router = useRouter();
  const updateGroupMutation = useAuthenticatedMutation(api.functions.groups.index.update);

  const mutateAsync = async (data: GroupUpdateData & { groupId?: string }) => {
    const targetGroupId = data.groupId || groupId;

    if (!targetGroupId) {
      throw new Error("Group ID is required");
    }

    try {
      const result = await updateGroupMutation({
        groupId: targetGroupId as Id<"groups">,
        name: data.name,
        description: data.description,
        preview: data.preview,
        addressLine1: data.address_line1,
        addressLine2: data.address_line2,
        city: data.city,
        state: data.state,
        zipCode: data.zip_code,
        defaultDay: data.default_day,
        defaultStartTime: extractTimeString(data.default_start_time),
        defaultEndTime: extractTimeString(data.default_end_time),
        defaultMeetingType: data.default_meeting_type,
        defaultMeetingLink: data.default_meeting_link,
        isOnBreak: data.is_on_break,
        breakUntil: data.break_until ? new Date(data.break_until).getTime() : undefined,
      });

      Alert.alert("Success", "Group updated successfully");

      // Small delay to ensure UI updates before navigating
      setTimeout(() => {
        router.back();
      }, 100);

      return result;
    } catch (error: any) {
      console.error("Update group error:", error);
      const errorMessage = formatError(error, "Failed to update group. Please try again.");
      Alert.alert("Error", errorMessage);
      throw error;
    }
  };

  return {
    mutateAsync,
    isPending: false, // Convex mutations don't expose pending state
  };
}
