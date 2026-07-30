import {
  computeCheckInSummary,
  indexAttendanceByUser,
  isCheckedIn,
  resolveAttendanceEntry,
  ATTENDANCE_PRESENT,
  ATTENDANCE_ABSENT,
  type GoingUser,
  type AttendanceLike,
  type WalkInLike,
} from "../checkIn";

const going = (id: string): GoingUser => ({
  id,
  firstName: "F",
  lastName: id,
});

describe("indexAttendanceByUser", () => {
  it("keeps the most recently recorded status per user", () => {
    const records: AttendanceLike[] = [
      { userId: "u1", status: ATTENDANCE_PRESENT, recordedAt: 100 },
      { userId: "u1", status: ATTENDANCE_ABSENT, recordedAt: 200 }, // newer wins
    ];
    const map = indexAttendanceByUser(records);
    expect(map.get("u1")?.status).toBe(ATTENDANCE_ABSENT);
  });
});

describe("isCheckedIn", () => {
  it("is true only when the latest status is Present", () => {
    const map = indexAttendanceByUser([
      { userId: "u1", status: ATTENDANCE_PRESENT, recordedAt: 1 },
      { userId: "u2", status: ATTENDANCE_ABSENT, recordedAt: 1 },
    ]);
    expect(isCheckedIn("u1", map)).toBe(true);
    expect(isCheckedIn("u2", map)).toBe(false);
    expect(isCheckedIn("u3", map)).toBe(false); // no record
  });
});

describe("computeCheckInSummary — live count", () => {
  const goingUsers = [going("u1"), going("u2"), going("u3")];

  it("counts zero checked in when nobody is marked present", () => {
    const summary = computeCheckInSummary(goingUsers, new Map(), []);
    expect(summary).toEqual({ checkedIn: 0, total: 3, fraction: 0 });
  });

  it("counts Going attendees marked Present", () => {
    const map = indexAttendanceByUser([
      { userId: "u1", status: ATTENDANCE_PRESENT, recordedAt: 1 },
      { userId: "u2", status: ATTENDANCE_ABSENT, recordedAt: 1 },
    ]);
    const summary = computeCheckInSummary(goingUsers, map, []);
    expect(summary.checkedIn).toBe(1);
    expect(summary.total).toBe(3);
    expect(summary.fraction).toBeCloseTo(1 / 3);
  });

  it("counts walk-ins toward both checked-in and total", () => {
    const walkIns: WalkInLike[] = [
      { _id: "g1", firstName: "Ada" },
      { _id: "g2", firstName: "Ben" },
    ];
    const map = indexAttendanceByUser([
      { userId: "u1", status: ATTENDANCE_PRESENT, recordedAt: 1 },
    ]);
    const summary = computeCheckInSummary(goingUsers, map, walkIns);
    // 1 Going present + 2 walk-ins = 3 checked in; 3 Going + 2 walk-ins = 5.
    expect(summary.checkedIn).toBe(3);
    expect(summary.total).toBe(5);
    expect(summary.fraction).toBeCloseTo(3 / 5);
  });

  it("handles an empty roster (RSVP disabled / nobody going, no walk-ins)", () => {
    const summary = computeCheckInSummary([], new Map(), []);
    expect(summary).toEqual({ checkedIn: 0, total: 0, fraction: 0 });
  });

  it("reaches a full bar when everyone is checked in", () => {
    const map = indexAttendanceByUser(
      goingUsers.map((u) => ({
        userId: u.id,
        status: ATTENDANCE_PRESENT,
        recordedAt: 1,
      }))
    );
    const summary = computeCheckInSummary(goingUsers, map, []);
    expect(summary.checkedIn).toBe(3);
    expect(summary.total).toBe(3);
    expect(summary.fraction).toBe(1);
  });
});

describe("resolveAttendanceEntry", () => {
  const base = {
    groupId: "g1",
    meetingId: "m1",
    scheduledAt: "2026-07-31T00:31:00.000Z",
  };

  it("is live check-in before the grace window closes", () => {
    const entry = resolveAttendanceEntry({ ...base, isRsvpClosed: false });
    expect(entry.label).toBe("Check in");
    // Routes to the check-in screen with the id-<meetingId>|<date> encoding
    // the screen parses.
    expect(entry.href).toBe(
      `/(user)/leader-tools/g1/events/id-m1|${encodeURIComponent(
        base.scheduledAt
      )}/checkin`
    );
  });

  it("becomes the attendance editor after the grace window closes", () => {
    const entry = resolveAttendanceEntry({ ...base, isRsvpClosed: true });
    expect(entry.label).toBe("Take attendance");
    expect(entry.href).toBe(
      `/(user)/leader-tools/g1/attendance/edit?eventDate=${encodeURIComponent(
        base.scheduledAt
      )}&meetingId=${encodeURIComponent(base.meetingId)}`
    );
  });
});
