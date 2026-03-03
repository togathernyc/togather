import { useMemo } from "react";
import { useQuery, api } from "@services/api/convex";
import { Id } from "@services/api/convex";

export function useAttendanceReport(
  groupId: string | number,
  options: { meetingId?: string; eventDate?: string },
  enabled: boolean = true
) {
  // Fetch attendance data using Convex
  const attendanceData = useQuery(
    api.functions.meetings.attendance.listAttendance,
    groupId && options.meetingId && enabled
      ? { meetingId: options.meetingId as Id<"meetings"> }
      : "skip"
  );

  // Fetch guests data using Convex
  const guestsData = useQuery(
    api.functions.meetings.attendance.listGuests,
    groupId && options.meetingId && enabled
      ? { meetingId: options.meetingId as Id<"meetings"> }
      : "skip"
  );

  const isLoading = attendanceData === undefined || guestsData === undefined;
  const error = null; // Convex throws on error, handle with ErrorBoundary

  // Transform data for backward compatibility
  const data = useMemo(() => {
    if (attendanceData === undefined || guestsData === undefined) return undefined;

    const rawAttendance = attendanceData || [];
    const rawGuests = guestsData || [];

    // Transform camelCase to snake_case for backward compatibility
    const attendances = rawAttendance.map((a: any) => ({
      _id: a._id,
      id: a._id, // Use Convex _id consistently
      status: a.status,
      recorded_at: a.recordedAt ? new Date(a.recordedAt).toISOString() : null,
      user: {
        _id: a.user?._id,
        id: a.user?._id,
        first_name: a.user?.firstName,
        last_name: a.user?.lastName,
        profile_photo: a.user?.profilePhoto,
      },
      recorded_by: a.recordedBy
        ? {
            _id: a.recordedBy._id,
            id: a.recordedBy._id,
            first_name: a.recordedBy.firstName,
            last_name: a.recordedBy.lastName,
          }
        : null,
    }));

    // Transform guests
    const guests = rawGuests.map((g: any) => ({
      id: g._id,
      first_name: g.firstName,
      last_name: g.lastName,
      phone_number: g.phoneNumber,
      notes: g.notes,
      recorded_at: g.recordedAt ? new Date(g.recordedAt).toISOString() : null,
    }));

    // Calculate stats from attendance and guest data
    const attendedMembers = attendances.filter((a: any) => a.status === 1);
    const memberCount = attendedMembers.length;
    const guestCount = guests.length;

    // Get the first recorded_at as submission time
    const firstRecordedAt = attendances.length > 0
      ? attendances.reduce((earliest: string | null, a: any) => {
          const recordedAt = a.recorded_at;
          return !earliest || recordedAt < earliest ? recordedAt : earliest;
        }, null as string | null)
      : null;

    // Get who submitted (first recorder)
    const firstRecorder = attendances.find((a: any) => a.recorded_by)?.recorded_by;

    return {
      attendances,
      guests,
      stats: {
        member_count: memberCount,
        guest_count: guestCount,
        total_count: memberCount + guestCount,
        prev_diff: 0, // Would need historical data to calculate
      },
      attendance_details: firstRecordedAt
        ? {
            created_at: firstRecordedAt,
            updated_by: firstRecorder,
          }
        : null,
      note: "", // Notes are not stored in current schema
    };
  }, [attendanceData, guestsData]);

  return {
    data,
    isLoading,
    error,
  };
}
