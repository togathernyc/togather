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
});

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

    let attendance = await t.query(
      api.functions.meetings.attendance.listAttendance,
      { meetingId }
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

    attendance = await t.query(
      api.functions.meetings.attendance.listAttendance,
      { meetingId }
    );
    expect(attendance).toHaveLength(1); // still one record, flipped
    expect(attendance.filter((a) => a.status === 1)).toHaveLength(0);
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
      { meetingId }
    );
    expect(guests).toHaveLength(1);
    expect(guests[0].firstName).toBe("Walk");

    await t.mutation(api.functions.meetings.attendance.removeGuest, {
      token: leaderToken,
      guestId,
    });

    guests = await t.query(api.functions.meetings.attendance.listGuests, {
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
