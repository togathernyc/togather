import { useMemo } from "react";
import { useQuery, api } from "@services/api/convex";
import { Id } from "@services/api/convex";

export function useRecentAttendanceStats(groupId: string | number, limit: number = 6) {
  // Fetch meetings using Convex
  const meetingsData = useQuery(
    api.functions.meetings.index.listByGroup,
    groupId ? { groupId: String(groupId) as Id<"groups"> } : "skip"
  );

  const isLoading = meetingsData === undefined;
  const error = null; // Convex throws on error, handle with ErrorBoundary

  // Transform data for backward compatibility
  const data = useMemo(() => {
    if (!meetingsData) return undefined;

    // Filter for past meetings, sort by date descending, take limit
    return meetingsData
      .filter((m) => m.scheduledAt <= Date.now())
      .sort((a, b) => b.scheduledAt - a.scheduledAt)
      .slice(0, limit)
      .map((meeting) => ({
        id: meeting._id,
        scheduled_at: new Date(meeting.scheduledAt).toISOString(),
        title: meeting.title,
        total_count: meeting.attendanceCount || 0,
        status: meeting.status,
      }));
  }, [meetingsData, limit]);

  return {
    data,
    isLoading,
    error,
  };
}

