import { useMemo } from "react";
import { differenceInDays, startOfMonth, endOfMonth, startOfDay } from "date-fns";
import { useQuery, api } from "@services/api/convex";
import { Id } from "@services/api/convex";

interface UseMeetingDatesOptions {
  startDate?: Date;
  endDate?: Date;
  enabled?: boolean;
}

export function useMeetingDates(
  groupId: string | number,
  options?: UseMeetingDatesOptions
) {
  const { startDate, endDate, enabled = true } = options || {};

  // Default to next 7 days if not provided
  const today = startOfDay(new Date());
  const defaultStartDate = startDate ? startOfDay(startDate) : today;
  const defaultEndDate = endDate ? startOfDay(endDate) : startOfDay(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000));

  // Calculate relative day counts from today
  const pastDays = Math.max(0, differenceInDays(today, defaultStartDate));
  const nextDays = Math.max(0, differenceInDays(defaultEndDate, today));

  // Use Convex to fetch meetings
  const meetingsData = useQuery(
    api.functions.meetings.index.listByGroup,
    groupId && enabled
      ? { groupId: String(groupId) as Id<"groups"> }
      : "skip"
  );

  const isLoading = meetingsData === undefined;
  const error = null; // Convex throws on error, handle with ErrorBoundary

  // Transform data for backward compatibility
  const data = useMemo(() => {
    if (!meetingsData) return undefined;

    // Filter meetings by date range and exclude cancelled
    const now = new Date();
    const meetings = meetingsData.filter((meeting) => {
      if (meeting.status === "cancelled") return false;
      const meetingDate = new Date(meeting.scheduledAt);
      const daysFromNow = differenceInDays(meetingDate, now);
      return daysFromNow >= -pastDays && daysFromNow <= nextDays;
    });

    // Transform to match expected format
    return {
      data: meetings.map((meeting) => ({
        meeting_id: meeting._id,
        short_id: meeting.shortId,
        date: new Date(meeting.scheduledAt).toISOString(),
        dateOfMeeting: new Date(meeting.scheduledAt).toISOString(),
        name: meeting.title || "Meeting",
        // Total attendees = members + guests
        attendee_count: (meeting.attendanceCount || 0) + (meeting.guestCount || 0),
        cover_image_url: meeting.coverImage || null,
      })),
    };
  }, [meetingsData, pastDays, nextDays]);

  return {
    data,
    isLoading,
    error,
    // Convex queries auto-update, but provide refetch stub for compatibility
    refetch: () => {},
    isRefetching: false,
  };
}

// Hook for fetching meeting dates for a specific month
export function useMeetingDatesForMonth(
  groupId: string | number,
  month: Date,
  enabled: boolean = true
) {
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);

  return useMeetingDates(groupId, {
    startDate: monthStart,
    endDate: monthEnd,
    enabled,
  });
}
