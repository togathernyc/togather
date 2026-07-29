/**
 * Pure helpers for the event Check-in screen.
 *
 * Keeping the roster/count math out of the screen makes the "N / M checked in"
 * summary unit-testable without a renderer, and keeps the screen a thin view.
 */

/** Attendance status codes (shared convention, see meetings/attendance.ts). */
export const ATTENDANCE_PRESENT = 1;
export const ATTENDANCE_ABSENT = 0;

/** A person who RSVPed "Going" (subset of the RSVP roster user shape). */
export interface GoingUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImage?: string | null;
}

/** An attendance record as returned by listAttendance (only fields we read). */
export interface AttendanceLike {
  userId: string;
  status: number;
  recordedAt?: number;
}

/** A walk-in guest as returned by listGuests (only fields we read). */
export interface WalkInLike {
  _id: string;
  firstName?: string | null;
  lastName?: string | null;
  recordedAt?: number;
}

/**
 * Index attendance records by userId. When (defensively) more than one record
 * exists for a user, the most recently recorded one wins so the toggle state
 * reflects the latest tap.
 */
export function indexAttendanceByUser(
  attendances: readonly AttendanceLike[]
): Map<string, AttendanceLike> {
  const map = new Map<string, AttendanceLike>();
  for (const record of attendances) {
    const prev = map.get(record.userId);
    if (!prev || (record.recordedAt ?? 0) >= (prev.recordedAt ?? 0)) {
      map.set(record.userId, record);
    }
  }
  return map;
}

/** Is this "Going" user currently checked in (marked Present)? */
export function isCheckedIn(
  userId: string,
  attendanceByUser: Map<string, AttendanceLike>
): boolean {
  return attendanceByUser.get(userId)?.status === ATTENDANCE_PRESENT;
}

export interface CheckInSummary {
  /** How many people on the roster are checked in (Present Going + walk-ins). */
  checkedIn: number;
  /** Total roster size (everyone Going + walk-ins). */
  total: number;
  /** checkedIn / total, clamped to [0, 1]; 0 when the roster is empty. */
  fraction: number;
}

/**
 * Compute the live "N / M checked in" summary.
 *
 * The roster is everyone who RSVPed Going plus any walk-ins. A Going person
 * counts as checked in when their attendance status is Present; walk-ins are
 * added already-present, so every walk-in counts toward both N and M.
 */
export function computeCheckInSummary(
  goingUsers: readonly GoingUser[],
  attendanceByUser: Map<string, AttendanceLike>,
  walkIns: readonly WalkInLike[]
): CheckInSummary {
  const goingCheckedIn = goingUsers.reduce(
    (n, u) => (isCheckedIn(u.id, attendanceByUser) ? n + 1 : n),
    0
  );
  const checkedIn = goingCheckedIn + walkIns.length;
  const total = goingUsers.length + walkIns.length;
  const fraction = total === 0 ? 0 : Math.min(1, Math.max(0, checkedIn / total));
  return { checkedIn, total, fraction };
}
