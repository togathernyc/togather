/**
 * Community-Wide Event Override Lockout Tests
 *
 * Regression cover for the incident where a group leader moved a past
 * community-wide occurrence onto a future date. The edit flipped the child's
 * `isOverridden` latch, and because every admin cascade skips overridden
 * children — and nothing ever cleared the flag — the community admin was
 * permanently locked out of repairing the date while the mutation still
 * reported success.
 *
 * Covers:
 *  - leaders can no longer change the date of a community-wide child at all
 *  - admins keep date control through both `meetings.update` and the CWE update
 *  - the CWE cascade reports what it skipped instead of silently succeeding
 *  - `resetChildToCommunityDefault` un-latches a child and re-syncs it
 *
 * Run with: cd apps/convex && pnpm test __tests__/communityWideEvents-override-lockout.test.ts
 */

import { vi, expect, test, describe, beforeEach, afterEach } from "vitest";

// Mock the jose library to bypass JWT verification in tests
vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) throw new Error("Invalid token");
    return { payload: { userId: match[1], type: "access" } };
  }),
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock-signed-token"),
  })),
  decodeJwt: vi.fn((token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) return null;
    return { userId: match[1], type: "access" };
  }),
}));

import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { modules } from "../test.setup";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// "Now" sits between PAST_DATE and FUTURE_DATE so the series has one past and
// one future occurrence — the shape of the real incident.
const NOW = new Date("2026-08-10T12:00:00Z").getTime();
const PAST_DATE = new Date("2026-06-01T18:00:00Z").getTime();
const FUTURE_DATE = new Date("2026-09-01T18:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

interface Setup {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  adminId: Id<"users">;
  leaderId: Id<"users">;
  adminToken: string;
  leaderToken: string;
  groupId1: Id<"groups">;
  groupId2: Id<"groups">;
  groupId3: Id<"groups">;
}

async function setupTestData(t: ReturnType<typeof convexTest>): Promise<Setup> {
  return await t.run(async (ctx) => {
    const ts = NOW;

    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-community",
      isPublic: true,
      createdAt: ts,
      updatedAt: ts,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Dinner Parties",
      slug: "dinner-parties",
      isActive: true,
      createdAt: ts,
      displayOrder: 1,
    });

    // roles: 3 = admin, status: 1 = active
    const adminId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      email: "admin@test.com",
      phone: "+12025551001",
      phoneVerified: true,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    });
    await ctx.db.insert("userCommunities", {
      userId: adminId,
      communityId,
      roles: 3,
      status: 1,
      createdAt: ts,
      updatedAt: ts,
    });

    // roles: 1 = plain member; group leadership is granted per group below
    const leaderId = await ctx.db.insert("users", {
      firstName: "Group",
      lastName: "Leader",
      email: "leader@test.com",
      phone: "+12025551002",
      phoneVerified: true,
      isActive: true,
      createdAt: ts,
      updatedAt: ts,
    });
    await ctx.db.insert("userCommunities", {
      userId: leaderId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: ts,
      updatedAt: ts,
    });

    const makeGroup = async (name: string) =>
      await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name,
        description: name,
        isArchived: false,
        isPublic: true,
        createdAt: ts,
        updatedAt: ts,
      });

    const groupId1 = await makeGroup("Group Alpha");
    const groupId2 = await makeGroup("Group Beta");
    const groupId3 = await makeGroup("Group Gamma");

    // The leader leads Alpha only.
    await ctx.db.insert("groupMembers", {
      groupId: groupId1,
      userId: leaderId,
      role: "leader",
      joinedAt: ts,
      notificationsEnabled: true,
    });

    return {
      communityId,
      groupTypeId,
      adminId,
      leaderId,
      adminToken: `test-token-${adminId}`,
      leaderToken: `test-token-${leaderId}`,
      groupId1,
      groupId2,
      groupId3,
    };
  });
}

/** Create the two-occurrence community-wide series used by most tests. */
async function createSeries(t: ReturnType<typeof convexTest>, s: Setup) {
  return await t.mutation(api.functions.communityWideEvents.createSeries, {
    token: s.adminToken,
    communityId: s.communityId,
    groupTypeId: s.groupTypeId,
    seriesName: "Weekly Dinner",
    dates: [PAST_DATE, FUTURE_DATE],
    title: "Weekly Dinner",
    meetingType: 1,
  });
}

/** The child meeting for `groupId` on the occurrence scheduled at `date`. */
async function childMeeting(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  date: number
) {
  return await t.run(async (ctx) => {
    const all = await ctx.db.query("meetings").collect();
    return all.find((m) => m.groupId === groupId && m.scheduledAt === date)!;
  });
}

async function getMeeting(t: ReturnType<typeof convexTest>, id: Id<"meetings">) {
  return await t.run(async (ctx) => await ctx.db.get(id));
}

async function parentFor(t: ReturnType<typeof convexTest>, date: number) {
  return await t.run(async (ctx) => {
    const cwes = await ctx.db.query("communityWideEvents").collect();
    return cwes.find((c) => c.scheduledAt === date)!;
  });
}

// ============================================================================
// Leaders cannot move a community-wide event's date
// ============================================================================

describe("meetings.update — community-wide date ownership", () => {
  test("group leader cannot change the date of a community-wide child", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);

    const pastAlpha = await childMeeting(t, s.groupId1, PAST_DATE);

    await expect(
      t.mutation(api.functions.meetings.index.update, {
        token: s.leaderToken,
        meetingId: pastAlpha._id,
        scheduledAt: FUTURE_DATE,
      })
    ).rejects.toThrow(/community admin/i);

    // The date must be untouched, and the failed edit must not have latched
    // the override flag — otherwise the admin is locked out by a rejected edit.
    const after = await getMeeting(t, pastAlpha._id);
    expect(after?.scheduledAt).toBe(PAST_DATE);
    expect(after?.isOverridden).toBe(false);
  });

  test("the block also applies to the series-wide scope", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);

    const pastAlpha = await childMeeting(t, s.groupId1, PAST_DATE);

    await expect(
      t.mutation(api.functions.meetings.index.update, {
        token: s.leaderToken,
        meetingId: pastAlpha._id,
        scheduledAt: FUTURE_DATE,
        scope: "all_in_series",
      })
    ).rejects.toThrow(/community admin/i);

    expect((await getMeeting(t, pastAlpha._id))?.scheduledAt).toBe(PAST_DATE);
  });

  test("leader can still edit non-date fields, which latches the override", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);

    const futureAlpha = await childMeeting(t, s.groupId1, FUTURE_DATE);

    await t.mutation(api.functions.meetings.index.update, {
      token: s.leaderToken,
      meetingId: futureAlpha._id,
      note: "Bring a side dish",
    });

    const after = await getMeeting(t, futureAlpha._id);
    expect(after?.note).toBe("Bring a side dish");
    expect(after?.isOverridden).toBe(true);
    expect(after?.scheduledAt).toBe(FUTURE_DATE);
  });

  test("resubmitting the unchanged date alongside another field is allowed", async () => {
    // The edit form always sends `scheduledAt`, so a leader saving a note edit
    // posts the existing date back. That must not read as a date change.
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);

    const futureAlpha = await childMeeting(t, s.groupId1, FUTURE_DATE);

    await t.mutation(api.functions.meetings.index.update, {
      token: s.leaderToken,
      meetingId: futureAlpha._id,
      scheduledAt: FUTURE_DATE,
      note: "Bring a side dish",
    });

    const after = await getMeeting(t, futureAlpha._id);
    expect(after?.note).toBe("Bring a side dish");
    expect(after?.scheduledAt).toBe(FUTURE_DATE);
  });

  test("community admin can still change a community-wide child's date", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);

    const futureAlpha = await childMeeting(t, s.groupId1, FUTURE_DATE);
    const newDate = FUTURE_DATE + 24 * 60 * 60 * 1000;

    await t.mutation(api.functions.meetings.index.update, {
      token: s.adminToken,
      meetingId: futureAlpha._id,
      scheduledAt: newDate,
    });

    expect((await getMeeting(t, futureAlpha._id))?.scheduledAt).toBe(newDate);
  });

  test("leaders keep full date control over ordinary group events", async () => {
    // The restriction is scoped to community-wide children only — a normal
    // group event a leader owns must stay freely editable.
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);

    const meetingId = await t.run(async (ctx) =>
      await ctx.db.insert("meetings", {
        groupId: s.groupId1,
        title: "Alpha Game Night",
        shortId: "alpha01",
        scheduledAt: FUTURE_DATE,
        meetingType: 1,
        status: "scheduled",
        createdById: s.leaderId,
        createdAt: NOW,
        visibility: "community",
        communityId: s.communityId,
      })
    );

    const newDate = FUTURE_DATE + 24 * 60 * 60 * 1000;
    await t.mutation(api.functions.meetings.index.update, {
      token: s.leaderToken,
      meetingId,
      scheduledAt: newDate,
    });

    expect((await getMeeting(t, meetingId))?.scheduledAt).toBe(newDate);
  });
});

// ============================================================================
// The cascade reports what it skipped
// ============================================================================

describe("communityWideEvents.update — skipped children are reported", () => {
  test("returns the count and group names of overridden children it skipped", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);

    // Leader customizes Alpha's future copy, latching the override.
    const futureAlpha = await childMeeting(t, s.groupId1, FUTURE_DATE);
    await t.mutation(api.functions.meetings.index.update, {
      token: s.leaderToken,
      meetingId: futureAlpha._id,
      note: "Alpha does its own thing",
    });

    const futureParent = await parentFor(t, FUTURE_DATE);
    const result = await t.mutation(api.functions.communityWideEvents.update, {
      token: s.adminToken,
      communityWideEventId: futureParent._id,
      title: "Renamed Dinner",
    });

    expect(result.meetingsUpdated).toBe(2);
    expect(result.meetingsSkipped).toBe(1);
    expect(result.skippedGroupNames).toEqual(["Group Alpha"]);
  });

  test("reports nothing skipped when no child is overridden", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);

    const futureParent = await parentFor(t, FUTURE_DATE);
    const result = await t.mutation(api.functions.communityWideEvents.update, {
      token: s.adminToken,
      communityWideEventId: futureParent._id,
      title: "Renamed Dinner",
    });

    expect(result.meetingsUpdated).toBe(3);
    expect(result.meetingsSkipped).toBe(0);
    expect(result.skippedGroupNames).toEqual([]);
  });
});

// ============================================================================
// Resetting a child back to the community default
// ============================================================================

describe("communityWideEvents.resetChildToCommunityDefault", () => {
  /** Latch Alpha's past copy onto a divergent date, the way the incident did. */
  async function corruptAlphaPastCopy(
    t: ReturnType<typeof convexTest>,
    s: Setup
  ) {
    const pastAlpha = await childMeeting(t, s.groupId1, PAST_DATE);
    await t.run(async (ctx) => {
      await ctx.db.patch(pastAlpha._id, {
        scheduledAt: FUTURE_DATE,
        title: "Moved By Leader",
        note: "leader note",
        isOverridden: true,
      });
    });
    return pastAlpha._id;
  }

  test("clears the override and re-syncs the child to its parent", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);
    const meetingId = await corruptAlphaPastCopy(t, s);

    await t.mutation(
      api.functions.communityWideEvents.resetChildToCommunityDefault,
      { token: s.adminToken, meetingId }
    );

    const parent = await parentFor(t, PAST_DATE);
    const after = await getMeeting(t, meetingId);
    expect(after?.isOverridden).toBe(false);
    expect(after?.scheduledAt).toBe(parent.scheduledAt);
    expect(after?.title).toBe(parent.title);
    expect(after?.note).toBe(parent.note);
  });

  test("a reset child is reachable by the admin cascade again", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);
    const meetingId = await corruptAlphaPastCopy(t, s);

    await t.mutation(
      api.functions.communityWideEvents.resetChildToCommunityDefault,
      { token: s.adminToken, meetingId }
    );

    const pastParent = await parentFor(t, PAST_DATE);
    const result = await t.mutation(api.functions.communityWideEvents.update, {
      token: s.adminToken,
      communityWideEventId: pastParent._id,
      title: "Repaired Title",
    });

    expect(result.meetingsSkipped).toBe(0);
    expect((await getMeeting(t, meetingId))?.title).toBe("Repaired Title");
  });

  test("re-syncs reminder timing to the parent's date", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);
    const meetingId = await corruptAlphaPastCopy(t, s);

    await t.mutation(
      api.functions.communityWideEvents.resetChildToCommunityDefault,
      { token: s.adminToken, meetingId }
    );

    const parent = await parentFor(t, PAST_DATE);
    const after = await getMeeting(t, meetingId);
    // Reminder/confirmation windows must follow the restored date, not the
    // date the leader moved the event to.
    expect(after?.reminderAt).toBeLessThan(parent.scheduledAt);
    expect(after?.attendanceConfirmationAt).toBeGreaterThan(parent.scheduledAt);
    // The restored occurrence is in the past, so nothing may re-fire for it.
    expect(after?.reminderSent).toBe(true);
    expect(after?.attendanceConfirmationSent).toBe(true);
    expect(after?.reminderJobId).toBeUndefined();
    expect(after?.attendanceConfirmationJobId).toBeUndefined();
  });

  test("a group leader cannot reset a child", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);
    const meetingId = await corruptAlphaPastCopy(t, s);

    await expect(
      t.mutation(
        api.functions.communityWideEvents.resetChildToCommunityDefault,
        { token: s.leaderToken, meetingId }
      )
    ).rejects.toThrow();

    expect((await getMeeting(t, meetingId))?.isOverridden).toBe(true);
  });

  test("the internal CLI variant performs the same reset", async () => {
    // Backend deploys land before the mobile OTA carrying the button, so the
    // CLI path is the on-call fix. It must match the in-app one exactly.
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);
    await createSeries(t, s);
    const meetingId = await corruptAlphaPastCopy(t, s);

    await t.mutation(
      internal.functions.communityWideEvents
        .resetChildToCommunityDefaultInternal,
      { meetingId }
    );

    const parent = await parentFor(t, PAST_DATE);
    const after = await getMeeting(t, meetingId);
    expect(after?.isOverridden).toBe(false);
    expect(after?.scheduledAt).toBe(parent.scheduledAt);
    expect(after?.title).toBe(parent.title);
  });

  test("rejects a meeting that is not a community-wide child", async () => {
    const t = convexTest(schema, modules);
    const s = await setupTestData(t);

    const meetingId = await t.run(async (ctx) =>
      await ctx.db.insert("meetings", {
        groupId: s.groupId1,
        title: "Standalone",
        shortId: "solo001",
        scheduledAt: FUTURE_DATE,
        meetingType: 1,
        status: "scheduled",
        createdById: s.adminId,
        createdAt: NOW,
        visibility: "community",
        communityId: s.communityId,
      })
    );

    await expect(
      t.mutation(
        api.functions.communityWideEvents.resetChildToCommunityDefault,
        { token: s.adminToken, meetingId }
      )
    ).rejects.toThrow(/community-wide/i);
  });
});
