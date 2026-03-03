import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert } from "react-native";
import { useMutation, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";

export interface RequestGroupFormData {
  name: string;
  groupTypeId: string;
  description?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  proposedStartDay?: number;
  defaultStartTime?: string;
  defaultEndTime?: string;
  defaultMeetingType?: number;
  defaultMeetingLink?: string;
  maxCapacity?: number;
  proposedLeaderIds?: string[];
}

/**
 * Hook to handle group creation request submission using Convex
 */
export function useRequestGroup() {
  const router = useRouter();
  const { user, community, token } = useAuth();
  const createRequestMutation = useMutation(
    api.functions.groupCreationRequests.create
  );

  // Track loading and error states
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestGroup = async (data: RequestGroupFormData) => {
    if (!user?.id || !community?.id) {
      Alert.alert("Error", "You must be logged in to request a group.");
      return;
    }

    if (!token) {
      Alert.alert("Error", "Authentication required. Please log in again.");
      return;
    }

    setIsRequesting(true);
    setError(null);

    try {
      await createRequestMutation({
        token,
        communityId: community.id as Id<"communities">,
        name: data.name,
        groupTypeId: data.groupTypeId as Id<"groupTypes">,
        description: data.description,
        proposedStartDay: data.proposedStartDay,
        maxCapacity: data.maxCapacity,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        defaultStartTime: data.defaultStartTime,
        defaultEndTime: data.defaultEndTime,
        defaultMeetingType: data.defaultMeetingType,
        defaultMeetingLink: data.defaultMeetingLink,
        proposedLeaderIds: data.proposedLeaderIds,
      });

      setIsRequesting(false);

      Alert.alert(
        "Request Submitted",
        "Your group request has been submitted for review. You'll be notified when it's approved.",
        [
          {
            text: "OK",
            onPress: () => router.back(),
          },
        ]
      );
    } catch (err: any) {
      const errorMessage = (err instanceof Error && err.message) || err?.message || "Failed to submit request. Please try again.";
      setError(errorMessage);
      setIsRequesting(false);

      Alert.alert(
        "Error",
        errorMessage
      );
    }
  };

  const requestGroupAsync = async (data: RequestGroupFormData) => {
    if (!user?.id || !community?.id) {
      throw new Error("You must be logged in to request a group.");
    }

    if (!token) {
      throw new Error("Authentication required. Please log in again.");
    }

    setIsRequesting(true);
    setError(null);

    try {
      const result = await createRequestMutation({
        token,
        communityId: community.id as Id<"communities">,
        name: data.name,
        groupTypeId: data.groupTypeId as Id<"groupTypes">,
        description: data.description,
        proposedStartDay: data.proposedStartDay,
        maxCapacity: data.maxCapacity,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        state: data.state,
        zipCode: data.zipCode,
        defaultStartTime: data.defaultStartTime,
        defaultEndTime: data.defaultEndTime,
        defaultMeetingType: data.defaultMeetingType,
        defaultMeetingLink: data.defaultMeetingLink,
        proposedLeaderIds: data.proposedLeaderIds,
      });

      setIsRequesting(false);
      return result;
    } catch (err: any) {
      const errorMessage = (err instanceof Error && err.message) || err?.message || "Failed to submit request. Please try again.";
      setError(errorMessage);
      setIsRequesting(false);
      throw new Error(errorMessage);
    }
  };

  return {
    requestGroup,
    requestGroupAsync,
    isRequesting,
    error,
  };
}
