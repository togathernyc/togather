import { useRouter } from "expo-router";
import { Alert } from "react-native";
import { useAuthenticatedMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";
import { formatError } from "@/utils/error-handling";

export interface CreateGroupFormData {
  name: string;
  groupTypeId: string;
  description?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  defaultDay?: number;
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultMeetingType?: number;
  defaultMeetingLink?: string;
}

/**
 * Hook to handle group creation using Convex
 */
export function useCreateGroup() {
  const router = useRouter();
  const { user, community } = useAuth();
  const createGroupMutation = useAuthenticatedMutation(api.functions.groups.index.create);

  const createGroup = async (data: CreateGroupFormData) => {
    if (!user?.id || !community?.id) {
      Alert.alert("Error", "You must be logged in to create a group.");
      return;
    }

    try {
      const result = await createGroupMutation({
        communityId: community.id as Id<"communities">,
        name: data.name,
        groupTypeId: data.groupTypeId as Id<"groupTypes">,
        description: data.description,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        defaultDay: data.defaultDay,
        defaultStartTime: data.defaultStartTime,
        defaultEndTime: data.defaultEndTime,
        defaultMeetingType: data.defaultMeetingType,
        defaultMeetingLink: data.defaultMeetingLink,
      });

      Alert.alert("Group Created", "Your group has been created successfully!", [
        {
          text: "OK",
          onPress: () => router.back(),
        },
      ]);

      return { id: result };
    } catch (error: any) {
      Alert.alert(
        "Error",
        formatError(error, "Failed to create group. Please try again.")
      );
      throw error;
    }
  };

  const createGroupAsync = async (data: CreateGroupFormData) => {
    if (!user?.id || !community?.id) {
      throw new Error("You must be logged in to create a group.");
    }

    const result = await createGroupMutation({
      communityId: community.id as Id<"communities">,
      name: data.name,
      groupTypeId: data.groupTypeId as Id<"groupTypes">,
      description: data.description,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      state: data.state,
      zipCode: data.zipCode,
      defaultDay: data.defaultDay,
      defaultStartTime: data.defaultStartTime,
      defaultEndTime: data.defaultEndTime,
      defaultMeetingType: data.defaultMeetingType,
      defaultMeetingLink: data.defaultMeetingLink,
    });

    return { id: result };
  };

  return {
    createGroup,
    createGroupAsync,
    isCreating: false, // Convex mutations don't have pending state exposed
    error: null,
  };
}
