/**
 * Pure helpers for the event Check-in screen.
 *
 * Keeping the roster/count math out of the screen makes the "N / M checked in"
 * summary unit-testable without a renderer, and keeps the screen a thin view.
 */

/** Attendance status codes (shared convention, see meetings/attendance.ts). */
export const ATTENDANCE_PRESENT = 1;
export const ATTENDANCE_ABSENT = 0;

/**
 * The event-page attendance entry point is one slot whose label and destination
 * depend on where we are in the event's lifecycle. Check-in and attendance
 * write the SAME record (`meetingAttendances.status === 1`); the only real
 * difference is timing — tapping people in as they arrive vs. reconciling the
 * roster afterward — so a single slot serves both.
 *
 * `isRsvpClosed` (now > scheduledAt + PAST_EVENT_BUFFER_MS) is the app's
 * existing "this event is over" signal; before it we show live check-in, after
 * it the post-event attendance editor.
 */
export interface AttendanceEntry {
  label: "Check in" | "Take attendance";
  /** Expo-router path for `router.push`. */
  href: string;
}

export function resolveAttendanceEntry(params: {
  isRsvpClosed: boolean;
  groupId: string;
  meetingId: string;
  /** ISO scheduledAt string, as carried on the event page. */
  scheduledAt: string;
}): AttendanceEntry {
  const encodedDate = encodeURIComponent(params.scheduledAt);
  if (!params.isRsvpClosed) {
    // Live check-in. Route matches the `id-<meetingId>|<date>` encoding the
    // check-in screen parses (see EventDetails.handleEdit / checkin.tsx).
    return {
      label: "Check in",
      href: `/(user)/leader-tools/${params.groupId}/events/id-${params.meetingId}|${encodedDate}/checkin`,
    };
  }
  // Post-event: the batch attendance editor (unchanged from the prior CTA).
  return {
    label: "Take attendance",
    href: `/(user)/leader-tools/${params.groupId}/attendance/edit?eventDate=${encodedDate}&meetingId=${encodeURIComponent(
      params.meetingId
    )}`,
  };
}

/** A person who RSVPed "Going" (subset of the RSVP roster user shape). */
export interface GoingUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImage?: string | null;
  /**
   * Plus-ones this person declared when they RSVPed (`meetingRsvps.guestCount`).
   * Drives how many guest slots the check-in screen offers under their row.
   */
  guestCount?: number | null;
}

/** An attendance record as returned by listAttendance (only fields we read). */
export interface AttendanceLike {
  userId: string;
  status: number;
  recordedAt?: number;
}

/** A guest as returned by listGuests (only fields we read). */
export interface WalkInLike {
  _id: string;
  firstName?: string | null;
  lastName?: string | null;
  recordedAt?: number;
  /**
   * The member who brought this guest (`meetingGuests.hostUserId`). Set for
   * plus-ones checked in under someone on the Going roster; absent for
   * unattached walk-ins.
   */
  hostUserId?: string | null;
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

/**
 * Split the meeting's guest rows into plus-ones (nested under the member who
 * brought them) and unattached walk-ins (their own section).
 *
 * A guest whose `hostUserId` is not on the Going roster — the host switched
 * their RSVP away from Going after the guest was checked in — is deliberately
 * treated as an unattached walk-in rather than dropped, so a checked-in person
 * can never vanish from the screen or the headcount.
 */
export function partitionGuests(
  goingUsers: readonly GoingUser[],
  guests: readonly WalkInLike[]
): { guestsByHost: Map<string, WalkInLike[]>; walkIns: WalkInLike[] } {
  const hostIds = new Set(goingUsers.map((u) => u.id));
  const guestsByHost = new Map<string, WalkInLike[]>();
  const walkIns: WalkInLike[] = [];

  for (const guest of guests) {
    const hostId = guest.hostUserId;
    if (hostId && hostIds.has(hostId)) {
      const existing = guestsByHost.get(hostId);
      if (existing) {
        existing.push(guest);
      } else {
        guestsByHost.set(hostId, [guest]);
      }
    } else {
      walkIns.push(guest);
    }
  }

  // Stable order so a slot doesn't jump position as names are filled in.
  for (const list of guestsByHost.values()) {
    list.sort((a, b) => (a.recordedAt ?? 0) - (b.recordedAt ?? 0));
  }

  return { guestsByHost, walkIns };
}

/** One plus-one position under a member: filled (checked in) or still empty. */
export interface GuestSlot {
  /** 1-based position within the member's party ("Guest 2 of 3"). */
  position: number;
  /** How many slots this member shows in total. */
  partySize: number;
  /** The persisted guest row once checked in; undefined while the slot is empty. */
  guest?: WalkInLike;
}

/**
 * Build the guest slots shown under a member.
 *
 * Slots come from the plus-ones they declared at RSVP, but a member who turns
 * up with more people than they declared must still be checkable — so the count
 * grows to fit whoever is actually checked in.
 */
export function buildGuestSlots(
  declaredCount: number | null | undefined,
  checkedInGuests: readonly WalkInLike[]
): GuestSlot[] {
  const declared = Math.max(0, Math.floor(declaredCount ?? 0));
  const partySize = Math.max(declared, checkedInGuests.length);
  return Array.from({ length: partySize }, (_, i) => ({
    position: i + 1,
    partySize,
    guest: checkedInGuests[i],
  }));
}

/** Full name, or "" when neither part is set. */
export function fullName(
  firstName?: string | null,
  lastName?: string | null
): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.replace(/\s+/g, " ").trim();
}

/** What a guest slot is labelled — their name once known, else the position. */
export function guestSlotLabel(slot: GuestSlot): string {
  const name = fullName(slot.guest?.firstName, slot.guest?.lastName);
  if (name) return name;
  return slot.partySize > 1
    ? `Guest ${slot.position} of ${slot.partySize}`
    : "Guest";
}

/** Case-insensitive "does this name contain the query" test. Empty query matches. */
export function nameMatchesQuery(
  query: string,
  firstName?: string | null,
  lastName?: string | null
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fullName(firstName, lastName).toLowerCase().includes(needle);
}

/**
 * Filter the Going roster by the search box. A member also matches when one of
 * their named guests does — searching a guest's name should surface the row
 * that guest is checked in under, not hide it.
 */
export function filterGoingUsers(
  goingUsers: readonly GoingUser[],
  guestsByHost: Map<string, WalkInLike[]>,
  query: string
): GoingUser[] {
  if (!query.trim()) return [...goingUsers];
  return goingUsers.filter(
    (user) =>
      nameMatchesQuery(query, user.firstName, user.lastName) ||
      (guestsByHost.get(user.id) ?? []).some((g) =>
        nameMatchesQuery(query, g.firstName, g.lastName)
      )
  );
}

/** Filter unattached walk-ins by the search box. */
export function filterWalkIns(
  walkIns: readonly WalkInLike[],
  query: string
): WalkInLike[] {
  if (!query.trim()) return [...walkIns];
  return walkIns.filter((g) =>
    nameMatchesQuery(query, g.firstName, g.lastName)
  );
}

export interface CheckInSummary {
  /** How many people are checked in (Present Going + their guests + walk-ins). */
  checkedIn: number;
  /** Expected headcount (everyone Going + their declared plus-ones + walk-ins). */
  total: number;
  /** checkedIn / total, clamped to [0, 1]; 0 when the roster is empty. */
  fraction: number;
}

/**
 * Compute the live "N / M checked in" summary.
 *
 * The roster is everyone who RSVPed Going, the plus-ones they declared, and any
 * walk-ins. A Going person counts as checked in when their attendance status is
 * Present; guests and walk-ins exist as rows only once checked in, so each
 * counts toward both N and M — while an *un*checked declared plus-one still
 * counts toward M, because the venue is expecting them.
 */
export function computeCheckInSummary(
  goingUsers: readonly GoingUser[],
  attendanceByUser: Map<string, AttendanceLike>,
  guests: readonly WalkInLike[]
): CheckInSummary {
  const { guestsByHost, walkIns } = partitionGuests(goingUsers, guests);

  let checkedIn = walkIns.length;
  let total = walkIns.length;

  for (const user of goingUsers) {
    total += 1;
    if (isCheckedIn(user.id, attendanceByUser)) checkedIn += 1;

    const hosted = guestsByHost.get(user.id) ?? [];
    checkedIn += hosted.length;
    total += buildGuestSlots(user.guestCount, hosted).length;
  }

  const fraction = total === 0 ? 0 : Math.min(1, Math.max(0, checkedIn / total));
  return { checkedIn, total, fraction };
}
