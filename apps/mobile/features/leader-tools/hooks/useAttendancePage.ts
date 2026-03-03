import { useState, useEffect, useMemo } from "react";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { MeetingSummary } from "../types";
import { useAuth } from "@providers/AuthProvider";

export function useAttendancePage(groupId: string, initialEventDate?: string) {
  const { token: authToken } = useAuth();
  const [eventDate, setEventDate] = useState<string | null>(
    initialEventDate || null
  );

  // Fetch full group details using the Convex ID directly
  const groupData = useQuery(
    api.functions.groups.queries.getByIdWithRole,
    groupId && authToken ? { groupId: groupId as Id<"groups">, token: authToken } : "skip"
  );

  // Transform group data for backward compatibility
  const group = useMemo(() => {
    if (!groupData) return undefined;
    return {
      _id: groupData._id,
      id: groupData._id,
      name: groupData.name,
      description: groupData.description,
      group_type_id: groupData.groupTypeId,
      group_type_name: groupData.groupTypeName,
      date: groupData.defaultStartTime, // Use default start time as fallback
      first_meeting_date: groupData.defaultStartTime,
      default_start_time: groupData.defaultStartTime,
    };
  }, [groupData]);

  const isLoadingGroup = groupData === undefined && !!groupId && !!authToken;
  const groupError = null; // Convex throws on error, handle with ErrorBoundary

  // Fetch meetings for the past 90 days and next 1 day (to include today)
  const meetingsData = useQuery(
    api.functions.meetings.index.listByGroup,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  // Transform meetings data for backward compatibility
  const meetings = useMemo(() => {
    if (!meetingsData) return undefined;

    // Filter for past 90 days and next 1 day, exclude cancelled
    const now = new Date();
    const past90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const next1 = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    return meetingsData
      .filter((m) => {
        if (m.status === "cancelled") return false;
        const meetingDate = new Date(m.scheduledAt);
        return meetingDate >= past90 && meetingDate <= next1;
      })
      .map((meeting) => ({
        id: meeting._id,
        scheduled_at: new Date(meeting.scheduledAt).toISOString(),
        title: meeting.title,
        total_count: meeting.attendanceCount || 0,
        status: meeting.status,
      }));
  }, [meetingsData]);

  // Convert meetings to MeetingSummary format
  const meetingDates: MeetingSummary[] = Array.isArray(meetings)
    ? meetings.map((meeting) => ({
        date: meeting.scheduled_at,
        meeting_id: meeting.id,
        name: meeting.title || "Meeting",
        attendee_count: meeting.total_count || 0,
      }))
    : [];

  // Find the most recent event (today or most recently past event)
  // Compare dates by day (ignore time) to handle timezone issues
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Find events that are today or in the past
  const todayOrPastEvents = meetingDates
    .filter((meeting) => {
      const meetingDate = new Date(meeting.date);
      meetingDate.setHours(0, 0, 0, 0);
      return meetingDate <= todayStart; // Include today and past events
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Get the most recent event (today or most recently past)
  const mostRecentEvent = todayOrPastEvents[0];

  // Initialize event date from initialEventDate (if provided), most recent event, or group
  useEffect(() => {
    // If initialEventDate is provided, use it and don't override
    if (initialEventDate) {
      setEventDate(initialEventDate);
      return;
    }

    // Otherwise, calculate from most recent event or group
    if (mostRecentEvent && !eventDate) {
      setEventDate(mostRecentEvent.date);
    } else if (group && !eventDate) {
      // Fallback to group date if no events found
      setEventDate(
        group.date || group.first_meeting_date || new Date().toISOString()
      );
    }
  }, [group, mostRecentEvent, eventDate, initialEventDate]);

  // Check if there's an event available for attendance
  const hasScheduledEvent = !!mostRecentEvent;

  return {
    group,
    isLoadingGroup,
    groupError,
    meetingDates,
    eventDate,
    hasScheduledEvent,
  };
}
