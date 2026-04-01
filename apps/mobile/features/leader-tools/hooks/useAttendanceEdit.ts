import { useState, useEffect, useMemo } from "react";
import { useRouter } from "expo-router";
import { useQuery, useAuthenticatedMutation, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { useGroupMembers } from "./useGroupMembers";
import { ToastManager } from "@components/ui/Toast";

export function useAttendanceEdit(
  groupId: string,
  initialEventDate?: string | null,
  initialMeetingId?: string | null
) {
  const router = useRouter();
  const { user } = useAuth();
  const currentUserId = user?.id as Id<"users"> | undefined;
  const [attendanceList, setAttendanceList] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [eventDate, setEventDate] = useState<string | null>(initialEventDate || null);
  // FIX for Issue #303: Always use the meetingId passed from navigation
  // Every meeting has an ID - no date-based search needed
  const [meetingId] = useState<string | null>(initialMeetingId || null);

  // Fetch group details using Convex
  const groupData = useQuery(
    api.functions.groups.index.getById,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  // Transform group data for backward compatibility
  const group = useMemo(() => {
    if (!groupData) return undefined;
    return {
      id: groupData._id,
      name: groupData.name,
      default_start_time: groupData.defaultStartTime,
    };
  }, [groupData]);

  const isLoadingGroup = groupData === undefined;
  const groupError = null; // Convex throws on error, handle with ErrorBoundary

  // Format date to YYYY-MM-DD for RSVP API
  const formatDateForRSVP = (date: string | null): string | undefined => {
    if (!date) return undefined;
    try {
      const dateObj = new Date(date);
      return dateObj.toISOString().split("T")[0]; // YYYY-MM-DD format
    } catch {
      return undefined;
    }
  };

  // Fetch members who RSVP'd as "going" for the event date
  const {
    members: rsvpMembers,
    isLoading: isLoadingRSVPs,
  } = useGroupMembers(groupId, {
    rsvpStatus: "going",
    rsvpDate: formatDateForRSVP(eventDate),
    enabled: !!eventDate && !!groupId,
  });

  // Initialize event date from parameter or current date
  useEffect(() => {
    if (initialEventDate && !eventDate) {
      setEventDate(initialEventDate);
    } else if (group && !eventDate) {
      setEventDate(new Date().toISOString());
    }
  }, [group, eventDate, initialEventDate]);

  // Note: RSVP preselection removed - users should manually select who attended
  // The attendance list starts empty and the user picks which members were present

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(user)/leader-tools/${groupId}/attendance`);
    }
  };

  const handleCancelEdit = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push(`/(user)/leader-tools/${groupId}/attendance`);
    }
  };

  const handleDateSelect = (date: Date | string) => {
    // Ensure date is a Date object
    let dateObj: Date;
    if (date instanceof Date) {
      dateObj = date;
    } else if (typeof date === "string") {
      dateObj = new Date(date);
    } else {
      console.warn("Invalid date received, using current date");
      dateObj = new Date();
    }

    // Validate the date
    if (isNaN(dateObj.getTime())) {
      console.warn("Invalid date, using current date");
      dateObj = new Date();
    }

    const dateString = dateObj.toISOString();
    setEventDate(dateString);
    // Clear attendance list when date changes
    setAttendanceList([]);
    // Convex auto-updates reactive queries - no manual invalidation needed
  };

  // Mutation for recording attendance
  const markAttendance = useAuthenticatedMutation(api.functions.meetings.attendance.markAttendance);

  // Get group members for attendance submission
  const { members: groupMembers } = useGroupMembers(groupId, { enabled: !!groupId });

  const handleSubmitAttendance = async () => {
    if (!eventDate || attendanceList.length === 0) {
      console.warn("No event date or attendance list");
      return;
    }

    if (!meetingId) {
      console.error("Meeting ID not found for selected date. Cannot submit attendance.");
      ToastManager.error("No meeting found for this date. Please select a valid meeting.");
      return;
    }

    if (!currentUserId) {
      console.error("User not authenticated");
      return;
    }

    // Prevent submitting attendance for future events
    const eventDateObj = new Date(eventDate);
    if (isNaN(eventDateObj.getTime()) || eventDateObj > new Date()) {
      console.error("Cannot submit attendance for future events");
      ToastManager.error("Cannot submit attendance for future events.");
      return;
    }

    try {
      // Record attendance for each member using Convex
      await Promise.all(
        groupMembers.map((member: any) => {
          // Use Convex user ID from nested user object
          const userId = member.user?._id || member.user?.id;
          return markAttendance({
            meetingId: meetingId as Id<"meetings">,
            userId: userId as Id<"users">,
            status: attendanceList.includes(userId) ? 1 : 0,
          });
        })
      );

      // Convex auto-updates reactive queries - no manual invalidation needed

      // Navigate back to attendance page
      router.push(`/(user)/leader-tools/${groupId}/attendance`);
    } catch (error) {
      console.error("Failed to submit attendance:", error);
      ToastManager.error("Failed to save attendance. Please try again.");
    }
  };

  return {
    group,
    isLoadingGroup,
    groupError,
    attendanceList,
    note,
    eventDate,
    meetingId,
    setAttendanceList,
    setNote,
    handleBack,
    handleCancelEdit,
    handleDateSelect,
    handleSubmitAttendance,
    isLoadingRSVPs,
  };
}

