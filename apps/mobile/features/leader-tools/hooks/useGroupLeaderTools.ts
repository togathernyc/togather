import { useState, useMemo } from "react";
import { useRouter } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import type { Id } from "@services/api/convex";
import { LeaderToolsPage, BottomBarType } from "../types";
import { calculateClosestEventDate } from "../utils/eventUtils";
import { useAuth } from "@providers/AuthProvider";

/**
 * Hook for leader tools functionality.
 * Uses Convex endpoints.
 */
export function useGroupLeaderTools(groupId: string) {
  const router = useRouter();
  const { token: authToken } = useAuth();
  const [activePage, setActivePage] = useState<LeaderToolsPage>(
    LeaderToolsPage.DEFAULT
  );
  const [showBottomBar, setShowBottomBar] = useState(true);
  const [bottomBarType, setBottomBarType] = useState<BottomBarType>(
    BottomBarType.HOME
  );
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Fetch full group details using the Convex ID directly
  const groupData = useQuery(
    api.functions.groups.queries.getByIdWithRole,
    groupId && authToken ? { groupId: groupId as Id<"groups">, token: authToken } : "skip"
  );

  // Transform group data to expected format
  const group = useMemo(() => {
    if (!groupData) return undefined;
    return {
      id: groupData._id,
      name: groupData.name,
      description: groupData.description,
      group_type_id: groupData.groupTypeId,
      group_type_name: groupData.groupTypeName ?? undefined,
      group_type_slug: undefined, // Not available from getByIdWithRole
      user_role: groupData.userRole ?? undefined,
      is_archived: groupData.isArchived,
      archived_at: groupData.archivedAt,
      created_at: groupData.createdAt,
      updated_at: groupData.updatedAt,
      main_channel_id: undefined, // Stream channels are computed separately
      leaders_channel_id: undefined, // Stream channels are computed separately
      address_line1: groupData.addressLine1,
      address_line2: groupData.addressLine2,
      city: groupData.city,
      state: groupData.state,
      zip_code: groupData.zipCode,
      default_day: groupData.defaultDay,
      default_start_time: groupData.defaultStartTime,
      default_end_time: groupData.defaultEndTime,
      default_meeting_type: groupData.defaultMeetingType,
      default_meeting_link: groupData.defaultMeetingLink,
      is_on_break: groupData.isOnBreak,
      break_until: groupData.breakUntil,
      preview: groupData.preview,
      members: undefined, // Members are fetched separately via groupMembers queries
      leaders: undefined, // Leaders are fetched separately via groupMembers queries
    };
  }, [groupData]);

  const isLoadingGroup = groupData === undefined && !!groupId && !!authToken;
  const groupError = null; // Convex throws on error, handle with ErrorBoundary

  // Fetch user groups to get Stream Chat channel IDs
  // Note: This needs the current user's ID, which would come from auth context
  // For now, we'll use the group data which should include channel IDs
  const userGroup = group ? {
    mainChannelId: group.main_channel_id,
    name: group.name,
    groupTypeId: group.group_type_id,
    groupTypeSlug: group.group_type_slug,
    userRole: group.user_role,
    leadersChannelId: group.leaders_channel_id,
  } : undefined;

  // Fetch meetings for this group using Convex
  const allMeetingsData = useQuery(
    api.functions.meetings.index.listByGroup,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  // Transform and filter meetings for recent attendance stats (past 6)
  const recentMeetings = useMemo(() => {
    if (!allMeetingsData) return undefined;
    return allMeetingsData
      .filter((m) => m.scheduledAt <= Date.now())
      .slice(0, 6)
      .map((meeting) => ({
        id: meeting._id,
        scheduled_at: new Date(meeting.scheduledAt).toISOString(),
        title: meeting.title,
        total_count: meeting.attendanceCount || 0,
        status: meeting.status,
      }));
  }, [allMeetingsData]);

  // Calculate highest attendance for graph from recent meetings
  const highestAttendance = useMemo(() => {
    return recentMeetings?.reduce(
      (max: number, meeting: any) => Math.max(max, meeting.total_count || 0),
      0
    ) || 1;
  }, [recentMeetings]);

  // Transform all meetings (excluding cancelled) for closest event calculation
  const meetings = useMemo(() => {
    if (!allMeetingsData) return undefined;
    return allMeetingsData
      .filter((m) => m.status !== "cancelled")
      .map((meeting) => ({
        id: meeting._id,
        scheduled_at: new Date(meeting.scheduledAt).toISOString(),
        title: meeting.title,
        total_count: meeting.attendanceCount || 0,
        status: meeting.status,
      }));
  }, [allMeetingsData]);

  // Convert meetings to the format expected by calculateClosestEventDate
  const meetingDates = Array.isArray(meetings)
    ? meetings.map((meeting) => ({
        date: meeting.scheduled_at,
        meeting_id: meeting.id,
        name: meeting.title || "Meeting",
        attendee_count: meeting.total_count || 0,
      }))
    : [];

  // Handle page navigation
  const handlePageChange = (page: LeaderToolsPage) => {
    // Navigate to separate routes for events and members
    if (page === LeaderToolsPage.EVENTS) {
      const groupName = group?.name || 'Group';
      router.push(`/(user)/group-events?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`);
      return;
    }
    if (page === LeaderToolsPage.MEMBERS) {
      router.push(`/(user)/leader-tools/${groupId}/members`);
      return;
    }

    setActivePage(page);
    if (page === LeaderToolsPage.CUSTOMIZE) {
      setShowBottomBar(true);
      setBottomBarType(BottomBarType.CUSTOMIZE);
    } else {
      setShowBottomBar(true);
      setBottomBarType(BottomBarType.HOME);
    }
  };

  // Handle back navigation
  const handleBack = () => {
    if (activePage === LeaderToolsPage.NOTIFICATION_DETAIL) {
      setActivePage(LeaderToolsPage.NOTIFICATIONS);
    } else if (activePage === LeaderToolsPage.EVENT_STATS) {
      setActivePage(LeaderToolsPage.EVENTS);
    } else {
      setActivePage(LeaderToolsPage.DEFAULT);
    }
  };

  // Handle group chat navigation
  const handleGroupChat = () => {
    if (groupId && userGroup?.mainChannelId) {
      // Navigate directly to the chat room with full group metadata
      router.push({
        pathname: `/inbox/${userGroup.mainChannelId}`,
        params: {
          groupId: groupId,
          groupName: userGroup.name || "",
          groupType: userGroup.groupTypeId || "",
          groupTypeSlug: userGroup.groupTypeSlug || "",
          isLeader: userGroup.userRole === 'leader' ? "1" : "0",
          leadersChannelId: userGroup.leadersChannelId || "",
        },
      });
    } else if (groupId) {
      // Fallback to inbox list if channel ID not available
      router.push(`/(tabs)/chat`);
    }
  };

  // Handle attendance navigation with pre-calculated event date
  const handleAttendanceNavigation = () => {
    if (!groupId) {
      return;
    }

    // Calculate closest event date
    const closestEventDate = calculateClosestEventDate(meetingDates);

    // Build navigation URL with query parameter if we have an event date
    let url = `/(user)/leader-tools/${groupId}/attendance`;
    if (closestEventDate) {
      const encodedDate = encodeURIComponent(closestEventDate);
      url += `?eventDate=${encodedDate}`;
    }

    router.push(url);
  };

  return {
    group,
    isLoadingGroup,
    groupError,
    attendanceStats: recentMeetings,
    highestAttendance,
    activePage,
    showBottomBar,
    bottomBarType,
    selectedDate,
    setSelectedDate,
    handlePageChange,
    handleBack,
    handleGroupChat,
    handleAttendanceNavigation,
  };
}
