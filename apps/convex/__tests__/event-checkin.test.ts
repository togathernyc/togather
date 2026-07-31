/**
 * Event Check-in feature (issue #651).
 *
 * The check-in screen is built entirely from existing attendance/guest
 * machinery, so these tests lock in the behaviors the screen relies on:
 *  - permission enforcement (only managers can check people in / add walk-ins)
 *  - check-in / undo via markAttendance (status 1 ↔ 0, upsert never duplicates)
 *  - walk-in add / remove via addGuest / removeGuest
 *  - canManageAttendance reflects the same rule the mutations enforce
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import { drainScheduledFunctions } from "./helpers/drainScheduledFunctions";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const GOING_RSVP_OPTION_ID = 1;

async function seedCheckInFixture(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const ids = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Check-in Community",
      slug: "checkin-community",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Marketplace Mandate Group",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    const leaderUserId = await ctx.db.insert("users", {
      firstName: "Lead",
      lastName: "Leader",
      email: "leader-checkin@test.com",
      phone: "+15555553001",
      createdAt: now,
      updatedAt: now,
    });

    const goingUserId = await ctx.db.insert("users", {
      firstName: "Gina",
      lastName: "Going",
      email: "going-checkin@test.com",
      phone: "+15555553002",
      createdAt: now,
      updatedAt: now,
    });

    const otherMemberId = await ctx.db.insert("users", {
      firstName: "Mel",
      lastName: "Member",
      email: "member-checkin@test.com",
      phone: "+15555553003",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: leaderUserId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: now,
    });
    await ctx.db.insert("userCommunities", {
      userId: goingUserId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: now,
    });
    await ctx.db.insert("userCommunities", {
      userId: otherMemberId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: now,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderUserId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: goingUserId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: otherMemberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      communityId,
      title: "Marketplace Mandate",
      scheduledAt: now + DAY_MS,
      status: "scheduled",
      meetingType: 1,
      rsvpEnabled: true,
      rsvpOptions: [
        { id: 1, label: "Going", enabled: true },
        { id: 2, label: "Maybe", enabled: true },
        { id: 3, label: "Can't Go", enabled: true },
      ],
      createdAt: now,
    });

    // Gina RSVPed "Going".
    await ctx.db.insert("meetingRsvps", {
      meetingId,
      userId: goingUserId,
      rsvpOptionId: GOING_RSVP_OPTION_ID,
      createdAt: now,
      updatedAt: now,
    });

    return {
      communityId,
      groupId,
      leaderUserId,
      goingUserId,
      otherMemberId,
      meetingId,
    };
  });

  const leaderTok = await generateTokens(
    ids.leaderUserId.toString(),
    ids.communityId.toString()
  );
  const memberTok = await generateTokens(
    ids.otherMemberId.toString(),
    ids.communityId.toString()
  );

  return {
    ...ids,
    leaderToken: leaderTok.accessToken,
    memberToken: memberTok.accessToken,
  };
}

describe("event check-in — permissions", () => {
  test("canManageAttendance is true for a group leader, false for a plain member", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, memberToken, meetingId } =
      await seedCheckInFixture(t);

    await expect(
      t.query(api.functions.meetings.attendance.canManageAttendance, {
        token: leaderToken,
        meetingId,
      })
    ).resolves.toBe(true);

    await expect(
      t.query(api.functions.meetings.attendance.canManageAttendance, {
        token: memberToken,
        meetingId,
      })
    ).resolves.toBe(false);
  });

  test("a non-manager cannot check in another attendee", async () => {
    const t = convexTest(schema, modules);
    const { memberToken, meetingId, goingUserId } =
      await seedCheckInFixture(t);

    await expect(
      t.mutation(api.functions.meetings.attendance.markAttendance, {
        token: memberToken,
        meetingId,
        userId: goingUserId,
        status: 1,
      })
    ).rejects.toThrow();
  });

  test("a non-manager cannot add a walk-in", async () => {
    const t = convexTest(schema, modules);
    const { memberToken, meetingId } = await seedCheckInFixture(t);

    await expect(
      t.mutation(api.functions.meetings.attendance.addGuest, {
        token: memberToken,
        meetingId,
        firstName: "Sneaky",
      })
    ).rejects.toThrow();
  });

  test("a non-manager cannot remove a walk-in", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, memberToken, meetingId } =
      await seedCheckInFixture(t);

    // A manager adds a walk-in...
    const guestId = await t.mutation(
      api.functions.meetings.attendance.addGuest,
      { token: leaderToken, meetingId, firstName: "Walk" }
    );

    // ...and a plain member cannot remove it.
    await expect(
      t.mutation(api.functions.meetings.attendance.removeGuest, {
        token: memberToken,
        guestId,
      })
    ).rejects.toThrow();
  });

  test("a non-manager cannot read the attendance list", async () => {
    const t = convexTest(schema, modules);
    const { memberToken, meetingId } = await seedCheckInFixture(t);

    await expect(
      t.query(api.functions.meetings.attendance.listAttendance, {
        token: memberToken,
        meetingId,
      })
    ).rejects.toThrow();
  });

  test("a non-manager cannot read the walk-in list", async () => {
    const t = convexTest(schema, modules);
    const { memberToken, meetingId } = await seedCheckInFixture(t);

    await expect(
      t.query(api.functions.meetings.attendance.listGuests, {
        token: memberToken,
        meetingId,
      })
    ).rejects.toThrow();
  });
});

// `markAttendance` schedules two background jobs (followup + community score
// recompute) via plain `runAfter(0, …)`. Left undrained, that leaks into
// other test files in the same worker — see `helpers/drainScheduledFunctions.ts`
// for the full mechanism. Deliberately NOT `vi.useFakeTimers()`: it's
// installed process-wide and shares the same worker-global lifetime, so a
// file that installs it owns a second way to strand another file's
// scheduled work.

describe("event check-in — check in / undo", () => {
  test("a leader checks a Going attendee in, then undoes it", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, meetingId, goingUserId } =
      await seedCheckInFixture(t);

    // Check in → Present (status 1).
    await t.mutation(api.functions.meetings.attendance.markAttendance, {
      token: leaderToken,
      meetingId,
      userId: goingUserId,
      status: 1,
    });
    await drainScheduledFunctions(t);

    let attendance = await t.query(
      api.functions.meetings.attendance.listAttendance,
      { token: leaderToken, meetingId }
    );
    const present = attendance.filter((a) => a.status === 1);
    expect(present).toHaveLength(1);
    expect(present[0].userId).toEqual(goingUserId);

    // Undo → Absent (status 0), same single record (upsert, no duplicate).
    await t.mutation(api.functions.meetings.attendance.markAttendance, {
      token: leaderToken,
      meetingId,
      userId: goingUserId,
      status: 0,
    });
    await drainScheduledFunctions(t);

    attendance = await t.query(
      api.functions.meetings.attendance.listAttendance,
      { token: leaderToken, meetingId }
    );
    expect(attendance).toHaveLength(1); // still one record, flipped
    expect(attendance.filter((a) => a.status === 1)).toHaveLength(0);
  });
});

describe("event check-in — Going roster", () => {
  test("goingRoster returns EVERY Going attendee to a manager who has not RSVPed (>10)", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, meetingId, communityId, groupId } =
      await seedCheckInFixture(t);

    // Add 14 more "Going" RSVPers (15 total with Gina) — well past the
    // 10-per-option preview cap in meetingRsvps.list. The leader running the
    // event has NOT RSVPed, which is the exact scenario that trips the cap.
    const EXTRA_GOING = 14;
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < EXTRA_GOING; i++) {
        const uid = await ctx.db.insert("users", {
          firstName: `Going${i}`,
          lastName: "Attendee",
          email: `going-${i}@test.com`,
          phone: `+1555599${String(i).padStart(4, "0")}`,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("userCommunities", {
          userId: uid,
          communityId,
          roles: 1,
          status: 1,
          createdAt: now,
        });
        await ctx.db.insert("groupMembers", {
          groupId,
          userId: uid,
          role: "member",
          joinedAt: now,
          notificationsEnabled: true,
        });
        await ctx.db.insert("meetingRsvps", {
          meetingId,
          userId: uid,
          rsvpOptionId: GOING_RSVP_OPTION_ID,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    const totalGoing = EXTRA_GOING + 1; // + Gina from the fixture

    // Sanity check: the shared list() query truncates to a 10-person preview
    // for the (non-RSVPed) manager — the bug this roster query exists to fix.
    const preview = await t.query(api.functions.meetingRsvps.list, {
      meetingId,
      token: leaderToken,
    });
    const previewGoing = preview.rsvps.find(
      (r) => r.option.id === GOING_RSVP_OPTION_ID
    );
    expect(previewGoing?.users.length).toBe(10);

    // goingRoster returns the FULL roster so the check-in list and the N/M
    // count are complete.
    const roster = await t.query(api.functions.meetingRsvps.goingRoster, {
      meetingId,
      token: leaderToken,
    });
    expect(roster).toHaveLength(totalGoing);
  });

  test("goingRoster rejects a non-manager", async () => {
    const t = convexTest(schema, modules);
    const { memberToken, meetingId } = await seedCheckInFixture(t);

    await expect(
      t.query(api.functions.meetingRsvps.goingRoster, {
        token: memberToken,
        meetingId,
      })
    ).rejects.toThrow();
  });
});

describe("event check-in — walk-ins", () => {
  test("a leader adds a walk-in and can remove it", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, meetingId } = await seedCheckInFixture(t);

    const guestId = await t.mutation(
      api.functions.meetings.attendance.addGuest,
      {
        token: leaderToken,
        meetingId,
        firstName: "Walk",
        lastName: "In",
      }
    );

    let guests = await t.query(
      api.functions.meetings.attendance.listGuests,
      { token: leaderToken, meetingId }
    );
    expect(guests).toHaveLength(1);
    expect(guests[0].firstName).toBe("Walk");

    await t.mutation(api.functions.meetings.attendance.removeGuest, {
      token: leaderToken,
      guestId,
    });

    guests = await t.query(api.functions.meetings.attendance.listGuests, {
      token: leaderToken,
      meetingId,
    });
    expect(guests).toHaveLength(0);
  });

  test("a walk-in added with only a first name is accepted", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, meetingId } = await seedCheckInFixture(t);

    const guestId = await t.mutation(
      api.functions.meetings.attendance.addGuest,
      { token: leaderToken, meetingId, firstName: "Solo" }
    );
    expect(guestId).toBeDefined();
  });
});

describe("event check-in — a member's guests (plus-ones)", () => {
  test("the Going roster exposes the plus-ones each member declared", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, meetingId, goingUserId } =
      await seedCheckInFixture(t);

    // Gina updates her RSVP to bring two people.
    await t.run(async (ctx) => {
      const rsvp = await ctx.db
        .query("meetingRsvps")
        .withIndex("by_meeting_user", (q) =>
          q.eq("meetingId", meetingId).eq("userId", goingUserId)
        )
        .first();
      await ctx.db.patch(rsvp!._id, { guestCount: 2 });
    });

    const roster = await t.query(api.functions.meetingRsvps.goingRoster, {
      token: leaderToken,
      meetingId,
    });
    expect(roster).toHaveLength(1);
    expect(roster[0].guestCount).toBe(2);
  });

  test("a guest checked in under a member is linked to that member", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, meetingId, goingUserId } =
      await seedCheckInFixture(t);

    const guestId = await t.mutation(
      api.functions.meetings.attendance.addGuest,
      { token: leaderToken, meetingId, hostUserId: goingUserId }
    );

    const guests = await t.query(
      api.functions.meetings.attendance.listGuests,
      { token: leaderToken, meetingId }
    );
    expect(guests).toHaveLength(1);
    expect(guests[0]._id).toBe(guestId);
    // Checked in first, named later — the row is valid with no name at all.
    expect(guests[0].hostUserId).toBe(goingUserId);
    expect(guests[0].firstName).toBeUndefined();
  });

  test("a guest's name can be filled in after they are checked in", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, meetingId, goingUserId } =
      await seedCheckInFixture(t);

    const guestId = await t.mutation(
      api.functions.meetings.attendance.addGuest,
      { token: leaderToken, meetingId, hostUserId: goingUserId }
    );

    await t.mutation(api.functions.meetings.attendance.updateGuest, {
      token: leaderToken,
      guestId,
      firstName: "Ada",
      lastName: "Lovelace",
    });

    const guests = await t.query(
      api.functions.meetings.attendance.listGuests,
      { token: leaderToken, meetingId }
    );
    expect(guests[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      hostUserId: goingUserId,
    });
  });

  test("undoing a guest check-in removes only that guest", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, meetingId, goingUserId } =
      await seedCheckInFixture(t);

    const first = await t.mutation(
      api.functions.meetings.attendance.addGuest,
      { token: leaderToken, meetingId, hostUserId: goingUserId }
    );
    await t.mutation(api.functions.meetings.attendance.addGuest, {
      token: leaderToken,
      meetingId,
      hostUserId: goingUserId,
      firstName: "Stays",
    });

    await t.mutation(api.functions.meetings.attendance.removeGuest, {
      token: leaderToken,
      guestId: first,
    });

    const guests = await t.query(
      api.functions.meetings.attendance.listGuests,
      { token: leaderToken, meetingId }
    );
    expect(guests).toHaveLength(1);
    expect(guests[0].firstName).toBe("Stays");
  });

  test("a non-manager cannot check in someone else's guest", async () => {
    const t = convexTest(schema, modules);
    const { memberToken, meetingId, goingUserId } =
      await seedCheckInFixture(t);

    await expect(
      t.mutation(api.functions.meetings.attendance.addGuest, {
        token: memberToken,
        meetingId,
        hostUserId: goingUserId,
      })
    ).rejects.toThrow(/Only the event creator, group leaders, or community admins/);
  });
});
