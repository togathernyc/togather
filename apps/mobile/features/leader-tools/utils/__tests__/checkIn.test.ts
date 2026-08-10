import {
  buildGuestSlots,
  computeCheckInSummary,
  filterGoingUsers,
  filterWalkIns,
  guestSlotLabel,
  indexAttendanceByUser,
  isCheckedIn,
  nameMatchesQuery,
  partitionGuests,
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

const present = (...userIds: string[]) =>
  indexAttendanceByUser(
    userIds.map((userId) => ({
      userId,
      status: ATTENDANCE_PRESENT,
      recordedAt: 1,
    }))
  );

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

describe("partitionGuests — plus-ones vs. unattached walk-ins", () => {
  it("nests guests under the member who brought them", () => {
    const guests: WalkInLike[] = [
      { _id: "g1", hostUserId: "u1", recordedAt: 20 },
      { _id: "g2", hostUserId: "u1", recordedAt: 10 },
      { _id: "g3", firstName: "Solo" },
    ];
    const { guestsByHost, walkIns } = partitionGuests([going("u1")], guests);
    // Sorted by recordedAt so a slot never jumps position as names fill in.
    expect(guestsByHost.get("u1")?.map((g) => g._id)).toEqual(["g2", "g1"]);
    expect(walkIns.map((g) => g._id)).toEqual(["g3"]);
  });

  it("keeps a guest visible as a walk-in when their host is no longer Going", () => {
    const guests: WalkInLike[] = [{ _id: "g1", hostUserId: "gone" }];
    const { guestsByHost, walkIns } = partitionGuests([going("u1")], guests);
    expect(guestsByHost.size).toBe(0);
    expect(walkIns.map((g) => g._id)).toEqual(["g1"]);
  });
});

describe("buildGuestSlots", () => {
  it("offers one slot per declared plus-one, filled in order", () => {
    const slots = buildGuestSlots(2, [{ _id: "g1", firstName: "Ada" }]);
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ position: 1, partySize: 2 });
    expect(slots[0].guest?._id).toBe("g1");
    expect(slots[1].guest).toBeUndefined();
  });

  it("grows past the declared count when more people actually turn up", () => {
    const slots = buildGuestSlots(1, [{ _id: "g1" }, { _id: "g2" }]);
    expect(slots).toHaveLength(2);
    expect(slots.every((s) => s.partySize === 2)).toBe(true);
  });

  it("has no slots when no guests were declared or added", () => {
    expect(buildGuestSlots(0, [])).toEqual([]);
    expect(buildGuestSlots(undefined, [])).toEqual([]);
    expect(buildGuestSlots(-3, [])).toEqual([]);
  });
});

describe("guestSlotLabel", () => {
  it("uses the guest's name once it has been captured", () => {
    const [slot] = buildGuestSlots(1, [
      { _id: "g1", firstName: "Ada", lastName: "Lovelace" },
    ]);
    expect(guestSlotLabel(slot)).toBe("Ada Lovelace");
  });

  it("falls back to the position while the guest is unnamed", () => {
    const slots = buildGuestSlots(2, []);
    expect(guestSlotLabel(slots[0])).toBe("Guest 1 of 2");
    expect(guestSlotLabel(slots[1])).toBe("Guest 2 of 2");
    expect(guestSlotLabel(buildGuestSlots(1, [])[0])).toBe("Guest");
  });
});

describe("search", () => {
  it("matches on first, last, or full name, case-insensitively", () => {
    expect(nameMatchesQuery("bri", "Brittany", "Smigielski")).toBe(true);
    expect(nameMatchesQuery("SMIG", "Brittany", "Smigielski")).toBe(true);
    expect(nameMatchesQuery("brittany smig", "Brittany", "Smigielski")).toBe(
      true
    );
    expect(nameMatchesQuery("kevin", "Brittany", "Smigielski")).toBe(false);
  });

  it("matches everyone on an empty or whitespace query", () => {
    expect(nameMatchesQuery("", "Amy", "Perez")).toBe(true);
    expect(nameMatchesQuery("   ", "Amy", "Perez")).toBe(true);
  });

  it("filters the Going roster by name", () => {
    const users: GoingUser[] = [
      { id: "u1", firstName: "Amy", lastName: "Perez" },
      { id: "u2", firstName: "Kevin", lastName: "Myers" },
    ];
    expect(filterGoingUsers(users, new Map(), "myer").map((u) => u.id)).toEqual(
      ["u2"]
    );
    expect(filterGoingUsers(users, new Map(), "")).toHaveLength(2);
  });

  it("surfaces the host when a guest's name matches", () => {
    const users: GoingUser[] = [
      { id: "u1", firstName: "Amy", lastName: "Perez" },
    ];
    const guestsByHost = new Map<string, WalkInLike[]>([
      ["u1", [{ _id: "g1", firstName: "Ada" }]],
    ]);
    expect(filterGoingUsers(users, guestsByHost, "ada").map((u) => u.id)).toEqual(
      ["u1"]
    );
  });

  it("filters walk-ins by name", () => {
    const walkIns: WalkInLike[] = [
      { _id: "g1", firstName: "Ada" },
      { _id: "g2", firstName: "Ben" },
    ];
    expect(filterWalkIns(walkIns, "be").map((g) => g._id)).toEqual(["g2"]);
  });
});

describe("computeCheckInSummary — plus-ones", () => {
  it("counts declared plus-ones toward the expected headcount", () => {
    const users: GoingUser[] = [
      { id: "u1", guestCount: 2 },
      { id: "u2", guestCount: 0 },
    ];
    // Nobody tapped in yet: 2 members + 2 declared guests are all expected.
    const summary = computeCheckInSummary(users, new Map(), []);
    expect(summary).toEqual({ checkedIn: 0, total: 4, fraction: 0 });
  });

  it("counts a checked-in guest toward the count without changing the total", () => {
    const users: GoingUser[] = [{ id: "u1", guestCount: 2 }];
    const summary = computeCheckInSummary(users, present("u1"), [
      { _id: "g1", hostUserId: "u1" },
    ]);
    // Member + 1 of 2 guests in; total stays 3 (member + 2 declared).
    expect(summary.checkedIn).toBe(2);
    expect(summary.total).toBe(3);
  });

  it("grows the total when a member brings more guests than declared", () => {
    const users: GoingUser[] = [{ id: "u1", guestCount: 1 }];
    const summary = computeCheckInSummary(users, present("u1"), [
      { _id: "g1", hostUserId: "u1" },
      { _id: "g2", hostUserId: "u1" },
    ]);
    expect(summary.checkedIn).toBe(3);
    expect(summary.total).toBe(3);
    expect(summary.fraction).toBe(1);
  });

  it("still counts a guest whose host is no longer on the Going roster", () => {
    const summary = computeCheckInSummary([going("u1")], new Map(), [
      { _id: "g1", hostUserId: "someone-who-left" },
    ]);
    // Falls back to a walk-in: checked in, and part of the total.
    expect(summary.checkedIn).toBe(1);
    expect(summary.total).toBe(2);
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
