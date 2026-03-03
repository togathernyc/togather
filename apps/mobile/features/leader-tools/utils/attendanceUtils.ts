/**
 * Utility functions for attendance management
 */

/**
 * Check if a guest is an anonymous guest
 * Anonymous guests are named like "Guest 1", "Guest 2" (firstName only, no lastName)
 * They are created with firstName: `Guest ${n}` in useAttendanceSubmission.ts
 */
export function isAnonymousGuest(guest: {
  first_name?: string;
  last_name?: string;
}): boolean {
  return !!guest.first_name?.startsWith("Guest ") && !guest.last_name;
}

/**
 * Format date for API calls (ISO string without milliseconds)
 * Format: yyyy-MM-dd'T'HH:mm:ss'Z'
 */
export function formatDateForAPI(date: string | Date): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) {
    throw new Error("Invalid date");
  }
  // Set to UTC midnight and remove milliseconds
  dateObj.setUTCSeconds(0, 0);
  dateObj.setUTCMilliseconds(0);
  return dateObj.toISOString().split(".")[0] + "Z";
}

/**
 * Validate event date
 */
export function validateEventDate(eventDate: string | null | undefined): void {
  if (!eventDate) {
    throw new Error("Event date is required");
  }
  const dateObj = new Date(eventDate);
  if (isNaN(dateObj.getTime())) {
    throw new Error("Invalid event date");
  }
}

/**
 * Check if event is in the future
 */
export function isFutureEvent(eventDate: string | null | undefined): boolean {
  if (!eventDate) return false;
  return new Date(eventDate) > new Date();
}

