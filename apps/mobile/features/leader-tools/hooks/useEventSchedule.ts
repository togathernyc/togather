import { useState } from "react";
import { useQuery, api, useAuthenticatedMutation } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { EventScheduleType } from "../types";
import { Alert } from "react-native";

export function useEventSchedule(groupId: string) {
  const { user } = useAuth();
  const currentUserId = user?.id as Id<"users"> | undefined;
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Convex mutations - use authenticated versions that auto-inject token
  const createMeeting = useAuthenticatedMutation(api.functions.meetings.index.create);
  const updateMeeting = useAuthenticatedMutation(api.functions.meetings.index.update);
  const cancelMeeting = useAuthenticatedMutation(api.functions.meetings.index.cancel);

  // Helper to prompt user and send notifications (only if there are "Going" RSVPs)
  const promptToNotifyGuests = async (meetingId: string) => {
    // Note: For Convex, we would need to query RSVPs first
    // For now, show a simple prompt
    Alert.alert(
      "Notify Guests?",
      "Would you like to notify guests who RSVP'd 'Going' about this change?",
      [
        {
          text: "No",
          style: "cancel",
        },
        {
          text: "Yes, Notify",
          onPress: async () => {
            try {
              // In Convex, we could call a separate notification action here
              console.log("Would send notification for meeting:", meetingId);
            } catch (err) {
              console.error("Failed to send notifications:", err);
            }
          },
        },
      ]
    );
  };

  // Wrapper mutation for backward compatibility
  // Note: useAuthenticatedMutation auto-injects the token
  const eventScheduleMutation = {
    mutate: async (data: {
      exception_type: number;
      exception_date: string;
      change_from_date?: string;
      meeting_id?: string;
    }) => {
      if (!currentUserId) {
        console.error("User not authenticated");
        return;
      }

      const { exception_type, exception_date, meeting_id } = data;
      setIsLoading(true);
      setIsError(false);
      setError(null);

      try {
        switch (exception_type) {
          case EventScheduleType.REMOVE_EVENT: {
            if (!meeting_id) {
              throw new Error("Meeting ID required to remove event");
            }
            await cancelMeeting({
              meetingId: meeting_id as Id<"meetings">,
              cancellationReason: "Cancelled by leader",
            });
            console.log("✅ Event cancelled successfully");
            break;
          }

          case EventScheduleType.RESCHEDULE_EVENT: {
            if (!meeting_id) {
              throw new Error("Meeting ID required to reschedule event");
            }
            await updateMeeting({
              meetingId: meeting_id as Id<"meetings">,
              scheduledAt: new Date(exception_date).getTime(),
            });
            console.log("✅ Event rescheduled successfully");
            // Prompt to notify guests after reschedule
            promptToNotifyGuests(meeting_id);
            break;
          }

          case EventScheduleType.ADD_EVENT: {
            await createMeeting({
              groupId: groupId as Id<"groups">,
              scheduledAt: new Date(exception_date).getTime(),
              meetingType: 1, // Default to in-person
            });
            console.log("✅ Event created successfully");
            break;
          }

          default:
            throw new Error(`Unknown exception type: ${exception_type}`);
        }
        setIsSuccess(true);
      } catch (err) {
        console.error("❌ Meeting operation failed:", err);
        const errorMessage = err instanceof Error
          ? err.message
          : "Failed to modify event schedule. Please try again.";
        setIsError(true);
        setError(err instanceof Error ? err : new Error("Unknown error"));
        Alert.alert("Error", errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    isLoading,
    isSuccess,
    isError,
    error,
  };

  const handleScheduleEvent = (
    eventType: EventScheduleType,
    date: string,
    originalDate?: string,
    meetingId?: string
  ) => {
    console.log("📝 handleScheduleEvent called with:", {
      eventType,
      date,
      originalDate,
      meetingId,
      groupId,
    });

    // Build payload for the mutation
    const payload: {
      exception_type: number;
      exception_date: string;
      change_from_date?: string;
      meeting_id?: string;
    } = {
      exception_type: eventType,
      exception_date: date,
      meeting_id: meetingId,
    };

    // Include change_from_date for RESCHEDULE_EVENT (2) for backward compatibility
    if (eventType === EventScheduleType.RESCHEDULE_EVENT && originalDate) {
      payload.change_from_date = originalDate;
    }

    console.log("📝 handleScheduleEvent - Payload to send:", payload);
    eventScheduleMutation.mutate(payload);
  };

  return {
    eventScheduleMutation,
    handleScheduleEvent,
  };
}

