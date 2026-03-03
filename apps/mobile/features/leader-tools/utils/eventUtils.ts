import { MeetingSummary } from "../types";

/**
 * Calculates the closest event date (today or most recently past event)
 * Priority: 1) Today's event, 2) Most recently past event
 *
 * @param meetingDates - Array of meeting summaries
 * @returns The date string of the closest event, or null if no events found
 */
export function calculateClosestEventDate(
  meetingDates: MeetingSummary[]
): string | null {
  if (!meetingDates || meetingDates.length === 0) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter and transform events with valid dates
  const validEvents = meetingDates
    .map((meeting) => {
      if (!meeting.date) {
        return null;
      }

      const meetingDate = new Date(meeting.date);
      if (isNaN(meetingDate.getTime())) {
        return null;
      }

      meetingDate.setHours(0, 0, 0, 0);
      return {
        date: meeting.date,
        dateObj: meetingDate,
      };
    })
    .filter(
      (event): event is { date: string; dateObj: Date } => event !== null
    );

  if (validEvents.length === 0) {
    return null;
  }

  // First, try to find today's event
  const todayEvent = validEvents.find(
    (event) => event.dateObj.getTime() === today.getTime()
  );

  if (todayEvent) {
    return todayEvent.date;
  }

  // If no today's event, find the most recently past event
  const pastEvents = validEvents
    .filter((event) => event.dateObj <= today)
    .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime()); // Sort descending (most recent first)

  if (pastEvents.length > 0) {
    return pastEvents[0].date;
  }

  // If no past events, return null (we don't want to select future events for attendance)
  return null;
}
