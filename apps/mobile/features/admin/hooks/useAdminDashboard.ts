import { useState, useEffect } from "react";
import { useQuery, api } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import type { Id } from "@services/api/convex";

/**
 * Hook to fetch admin dashboard data
 * Includes total attendance, new signups, and groups
 */
export function useAdminDashboard() {
  const { community, user, token } = useAuth();
  const [dateRange, setDateRange] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);

  // Calculate date range for last week
  useEffect(() => {
    const currentDate = new Date().toISOString().split("T")[0];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);
    setDateRange({
      startDate: startDate.toISOString().split("T")[0],
      endDate: currentDate,
    });
  }, []);

  // Convert date strings to unix timestamps for Convex
  const startTimestamp = dateRange?.startDate
    ? new Date(dateRange.startDate).getTime()
    : 0;
  const endTimestamp = dateRange?.endDate
    ? new Date(dateRange.endDate).getTime()
    : 0;

  // Fetch total attendance stats
  const totalAttendance = useQuery(
    api.functions.admin.stats.getTotalAttendance,
    dateRange && community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
          startDate: startTimestamp,
          endDate: endTimestamp,
        }
      : "skip"
  );

  // Fetch new signups
  const newSignups = useQuery(
    api.functions.admin.stats.getNewSignups,
    dateRange && community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
          startDate: startTimestamp,
          endDate: endTimestamp,
        }
      : "skip"
  );

  // Fetch all groups
  const groups = useQuery(
    api.functions.admin.settings.listAllGroups,
    community?.id && token
      ? {
          token,
          communityId: community.id as Id<"communities">,
        }
      : "skip"
  );

  const attendanceLoading = totalAttendance === undefined && !!dateRange;
  const signupsLoading = newSignups === undefined && !!dateRange;
  const groupsLoading = groups === undefined;

  const isLoading = attendanceLoading || signupsLoading || groupsLoading;
  const groupsList = Array.isArray(groups) ? groups : [];

  return {
    totalAttendance,
    newSignups,
    groupsList,
    dateRange,
    isLoading,
  };
}
