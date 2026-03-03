import { useAuthenticatedMutation, api } from "@services/api/convex";
import { Id } from "@services/api/convex";
import { useAuth } from "@providers/AuthProvider";
import { validateEventDate, isFutureEvent } from "../utils/attendanceUtils";

interface NamedGuest {
  first_name: string;
  last_name?: string;
  phone?: string;
  notes?: string;
}

interface UseAttendanceSubmissionProps {
  groupId: string;
  eventDate: string;
  meetingId?: string;
  attendance: string[]; // Convex user IDs
  note: string;
  filteredMembers: any[];
  localGuests: any[];
  anonymousGuestCount: number;
  onCancelEdit: () => void;
  setAnonymousGuestCount: (count: number) => void;
  setLocalGuests: (guests: any[]) => void;
  // FIX for Issue #303: Track existing guests for proper edit handling
  existingAnonymousGuests?: any[];
  anonymousGuestDelta?: number;
  guestsToRemove?: string[]; // IDs of named guests to remove
}

export function useAttendanceSubmission({
  groupId,
  eventDate,
  meetingId,
  attendance,
  note,
  filteredMembers,
  localGuests,
  anonymousGuestCount,
  onCancelEdit,
  setAnonymousGuestCount,
  setLocalGuests,
  // FIX for Issue #303: Track existing guests for proper edit handling
  existingAnonymousGuests = [],
  anonymousGuestDelta = 0,
  guestsToRemove = [],
}: UseAttendanceSubmissionProps) {
  const { user } = useAuth();
  const currentUserId = user?.id as Id<"users"> | undefined;

  // Convex mutations for recording attendance and guests
  const markAttendance = useAuthenticatedMutation(api.functions.meetings.attendance.markAttendance);
  const addGuest = useAuthenticatedMutation(api.functions.meetings.attendance.addGuest);
  // FIX for Issue #303: Add removeGuest mutation for editing guest counts
  const removeGuestMutation = useAuthenticatedMutation(api.functions.meetings.attendance.removeGuest);

  const submitAttendance = async () => {
    // Prevent submitting attendance for future events
    if (isFutureEvent(eventDate)) {
      console.error("Cannot submit attendance for future events");
      return;
    }

    validateEventDate(eventDate);

    if (!meetingId) {
      console.error("Meeting ID is required to submit attendance");
      return;
    }

    if (!currentUserId) {
      console.error("User not authenticated");
      return;
    }

    // Create attendance data for members only (not guests)
    // Guests are now tracked separately using MeetingGuest model
    const attendanceIds = attendance || [];

    const attendanceData = filteredMembers
      .filter((member: any) => member.role !== "Guest" && !member.isNamedGuest && member.user?._id)
      .map((member: any) => {
        // Use Convex ID consistently
        const userId = member.user?._id;
        if (!userId) {
          throw new Error("Member user._id is required for attendance tracking");
        }
        return {
          userId,
          status: attendanceIds.includes(userId) ? 1 : 0,
        };
      });

    // Extract named guests (guests with isNamedGuest flag, added during this session)
    const namedGuests: NamedGuest[] = localGuests
      .filter((guest) => guest.isNamedGuest)
      .map((guest) => ({
        first_name: guest.first_name,
        last_name: guest.last_name,
        phone: guest.phone,
        notes: guest.notes,
      }));

    try {
      // Record member attendance using Convex
      await Promise.all(
        attendanceData.map((record) =>
          markAttendance({
            meetingId: meetingId as Id<"meetings">,
            userId: record.userId as Id<"users">,
            status: record.status,
          })
        )
      );

      // Record named guests (only new ones added during this session)
      if (namedGuests.length > 0) {
        await Promise.all(
          namedGuests.map((guest) =>
            addGuest({
              meetingId: meetingId as Id<"meetings">,
              firstName: guest.first_name,
              lastName: guest.last_name,
              phoneNumber: guest.phone,
              notes: guest.notes,
            })
          )
        );
      }

      // FIX for Issue #303: Handle anonymous guests based on delta
      // Only add/remove the DIFFERENCE, not the full count
      if (anonymousGuestDelta > 0) {
        // User increased guest count - add new guests
        const existingCount = existingAnonymousGuests.length;
        await Promise.all(
          Array.from({ length: anonymousGuestDelta }, (_, i) =>
            addGuest({
              meetingId: meetingId as Id<"meetings">,
              firstName: `Guest ${existingCount + i + 1}`,
            })
          )
        );
      } else if (anonymousGuestDelta < 0) {
        // User decreased guest count - remove excess guests
        // Note: transformed data uses 'id' not '_id'
        const anonymousGuestsToRemove = existingAnonymousGuests.slice(anonymousGuestDelta);
        await Promise.all(
          anonymousGuestsToRemove.map((guest: any) =>
            removeGuestMutation({
              guestId: guest.id as Id<"meetingGuests">,
            })
          )
        );
      }
      // If anonymousGuestDelta === 0, don't touch anonymous guests

      // FIX for Issue #303: Remove named guests that user marked for removal
      if (guestsToRemove.length > 0) {
        await Promise.all(
          guestsToRemove.map((guestId: string) =>
            removeGuestMutation({
              guestId: guestId as Id<"meetingGuests">,
            })
          )
        );
      }

      // Convex auto-updates reactive queries - no manual invalidation needed

      setAnonymousGuestCount(0);
      setLocalGuests([]);
      onCancelEdit();
    } catch (error) {
      console.error("Failed to submit attendance:", error);
      throw error;
    }
  };

  return { submitAttendance };
}

