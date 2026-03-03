import { useState, useEffect, useRef } from "react";
import {
  isAnonymousGuest,
} from "../utils/attendanceUtils";

interface UseAttendanceGuestsProps {
  groupId: string;
  eventDate: string;
  editMode: boolean;
  attendanceReport: any;
  attendance: string[]; // Convex user IDs or local guest IDs
  onUpdateAttendance: (attendance: string[]) => void;
}

// Generate a unique local ID for guests (prefixed to avoid collision with Convex IDs)
let localGuestIdCounter = 1;
const generateLocalGuestId = () => `local_guest_${localGuestIdCounter++}`;

export function useAttendanceGuests({
  groupId,
  eventDate,
  editMode,
  attendanceReport,
  attendance,
  onUpdateAttendance,
}: UseAttendanceGuestsProps) {
  const [localGuests, setLocalGuests] = useState<any[]>([]);
  const [anonymousGuestCount, setAnonymousGuestCount] = useState(0);
  // Track existing guests from the database (for edit mode)
  // FIX for Issue #303: Track existing guests so we can calculate delta on submit
  const [existingAnonymousGuests, setExistingAnonymousGuests] = useState<any[]>([]);
  const [existingNamedGuests, setExistingNamedGuests] = useState<any[]>([]);
  // Track the original count to calculate delta
  const originalAnonymousCountRef = useRef<number>(0);
  // Track if we've already initialized from the report to prevent overwrites
  // FIX: Prevent reactive query updates from overwriting user edits during editing
  const hasInitializedRef = useRef<boolean>(false);

  // Initialize guests from attendance report when in edit mode (only once)
  useEffect(() => {
    // Only initialize once per edit session to prevent reactive query updates
    // from overwriting user changes during concurrent editing
    if (editMode && attendanceReport && !hasInitializedRef.current) {
      hasInitializedRef.current = true;

      const report = attendanceReport?.data || attendanceReport;
      const guestList = report?.guests || [];

      if (__DEV__) {
        console.log("📋 Loading guests from report:", guestList.length, "guests");
      }

      // Identify and load anonymous guests from the report
      const anonymousGuests = guestList.filter((guest: any) => {
        return isAnonymousGuest(guest);
      });

      // Identify named guests from the report (not anonymous)
      const namedGuestsFromReport = guestList.filter((guest: any) => {
        return !isAnonymousGuest(guest);
      });

      // Store existing guests (with their IDs for deletion)
      // Note: The transformed data uses 'id' not '_id'
      setExistingAnonymousGuests(anonymousGuests);
      setExistingNamedGuests(namedGuestsFromReport);

      // Set the count and track original for anonymous guests
      setAnonymousGuestCount(anonymousGuests.length);
      originalAnonymousCountRef.current = anonymousGuests.length;

      if (__DEV__) {
        console.log(
          "✅ Loaded",
          anonymousGuests.length,
          "anonymous guests and",
          namedGuestsFromReport.length,
          "named guests from attendance report"
        );
      }
    }

    // Reset initialization flag when leaving edit mode
    if (!editMode) {
      hasInitializedRef.current = false;
    }
  }, [editMode, attendanceReport]);

  // Add named guest - stored locally, submitted with attendance
  // No User record is created - guests are stored as MeetingGuest records on the backend
  const addGuest = async (guest: {
    email?: string;
    first_name: string;
    last_name: string;
    phone?: string;
  }) => {
    // Generate a local ID for UI purposes (won't be sent to backend)
    const localId = generateLocalGuestId();

    const guestMember = {
      id: localId,
      first_name: guest.first_name,
      last_name: guest.last_name,
      profile_photo: null,
      role: "Guest",
      phone: guest.phone,
      email: guest.email,
      // Flag to indicate this is a named guest (not anonymous)
      isNamedGuest: true,
    };

    if (__DEV__) {
      console.log(
        "✅ Adding named guest locally:",
        JSON.stringify(guestMember, null, 2)
      );
    }

    setLocalGuests((prev) => {
      const updated = [...prev, guestMember];
      if (__DEV__) {
        console.log("✅ Updated localGuests:", updated.length, "guests");
      }
      return updated;
    });

    // Auto-check the guest as attended (if attendance tracking is available)
    if (onUpdateAttendance) {
      const currentAttendance = attendance || [];
      onUpdateAttendance([...currentAttendance, localId]);
    }
  };

  // Increment anonymous guest count
  const incrementAnonymousGuests = () => {
    setAnonymousGuestCount((prev) => prev + 1);
  };

  // Decrement anonymous guest count
  const decrementAnonymousGuests = () => {
    setAnonymousGuestCount((prev) => Math.max(0, prev - 1));
  };

  // Get named guests (guests with isNamedGuest flag or non-anonymous guests)
  const namedGuests = localGuests.filter(
    (guest) => guest.isNamedGuest || !isAnonymousGuest(guest)
  );

  // Remove a named guest from the local list (newly added guests)
  const removeNamedGuest = (guestId: string) => {
    setLocalGuests((prev) => prev.filter((guest) => guest.id !== guestId));
  };

  // Track existing named guests that should be removed on submit
  const [guestsToRemove, setGuestsToRemove] = useState<string[]>([]);

  // Mark an existing named guest for removal
  const markExistingGuestForRemoval = (guestId: string) => {
    setGuestsToRemove((prev) => [...prev, guestId]);
    // Also remove from the displayed list
    setExistingNamedGuests((prev) => prev.filter((guest) => guest.id !== guestId));
  };

  // Anonymous guests don't have individual IDs - they're just a count
  // Return empty array for compatibility with code that filters by guest IDs
  const anonymousGuestIds: string[] = [];

  // Calculate the delta for anonymous guests
  // Positive = add this many, Negative = remove this many
  const anonymousGuestDelta = anonymousGuestCount - originalAnonymousCountRef.current;

  return {
    localGuests,
    anonymousGuestCount,
    namedGuests,
    anonymousGuestIds,
    addGuest,
    incrementAnonymousGuests,
    decrementAnonymousGuests,
    removeNamedGuest,
    setAnonymousGuestCount,
    setLocalGuests,
    // FIX for Issue #303: Export existing guests and delta for proper edit handling
    existingAnonymousGuests,
    existingNamedGuests,
    anonymousGuestDelta,
    originalAnonymousCount: originalAnonymousCountRef.current,
    // For removing existing named guests
    markExistingGuestForRemoval,
    guestsToRemove,
  };
}
