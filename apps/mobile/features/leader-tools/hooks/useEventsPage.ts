import { useState, useMemo } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { MeetingSummary } from "../types";

export function useEventsPage(groupId: string) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showEventSchedule, setShowEventSchedule] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [editingDate, setEditingDate] = useState<Date | null>(null);

  // Fetch meetings for this group using Convex
  const meetingsData = useQuery(
    api.functions.meetings.index.listByGroup,
    groupId ? { groupId: groupId as Id<"groups"> } : "skip"
  );

  // Transform to attendance stats format for the chart
  const attendanceStats = useMemo(() => {
    if (!meetingsData) return [];
    // Get past meetings, sorted by date descending, take 6
    return meetingsData
      .filter((m) => m.scheduledAt <= Date.now())
      .sort((a, b) => b.scheduledAt - a.scheduledAt)
      .slice(0, 6)
      .map((meeting) => ({
        date: new Date(meeting.scheduledAt).toISOString(),
        // present_count for AttendanceChart compatibility (members + guests)
        present_count:
          (meeting.attendanceCount || 0) + (meeting.guestCount || 0),
      }));
  }, [meetingsData]);

  // Handle new event
  const handleNewEvent = () => {
    setSelectedDate(new Date());
    setIsCreatingEvent(true);
    setEditingDate(null);
    setShowEventSchedule(true);
  };

  // Handle event press - navigate to details page
  const handleEventPress = (event: MeetingSummary) => {
    console.log("📅 handleEventPress called:", {
      short_id: event.short_id,
      meeting_id: event.meeting_id,
    });
    if (!event.short_id) {
      console.error("Event is missing short_id:", {
        meeting_id: event.meeting_id,
        event,
      });
      Alert.alert(
        "Error",
        "This event is missing a share link. Please contact support."
      );
      return;
    }
    // Navigate to event details page using short_id
    const path = `/e/${event.short_id}?source=app`;
    console.log("📅 Navigating to:", path);
    router.push(path);
  };

  const handleCloseEventSchedule = () => {
    setShowEventSchedule(false);
    setIsCreatingEvent(false);
    setEditingDate(null);
  };

  return {
    attendanceStats,
    selectedDate,
    showEventSchedule,
    isCreatingEvent,
    editingDate,
    setSelectedDate,
    setShowEventSchedule,
    setIsCreatingEvent,
    setEditingDate,
    handleNewEvent,
    handleEventPress,
    handleCloseEventSchedule,
  };
}
