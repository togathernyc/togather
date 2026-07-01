/**
 * Tests for the event-invite recipient picker backend
 * (`eventInvites.listGroupMembersForInvite`) and the recipient cap on
 * `eventInvites.initiate`.
 *
 * Background: the picker query used to `.collect()` every group member and then
 * fire a user-row read + a push-token query for each one. In large groups that
 * blew past Convex's per-execution read limit (4096) — the production error
 * "Too many reads in a single function execution" seen in
 * `listGroupMembersForInvite`. The query now:
 *
 *  - returns at most MEMBER_PICKER_LIMIT (50) members per call, so it never
 *    fans reads out across the whole group;
 *  - searches server-side against the users full-text index, so a member beyond
 *    the first page is still findable by name;
 *  - always surfaces the caller (test-invite-to-self) in the default view.
 *
 * And `initiate`/`reinvite` reject more than 20 recipients per call.
 *
 * Run with: cd apps/convex && pnpm test __tests__/eventInvites-invite-picker.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

// JWT secret must be at least 32 characters
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();
afterEach(() => {
  vi.clearAllTimers();
});

// The picker caps its result at this many members (mirrors MEMBER_PICKER_LIMIT
// in functions/eventInvites.ts).
const PICKER_LIMIT = 50;
// Enough ordinary members to exceed the picker limit and prove bounding.
const MEMBER_COUNT = 60;

interface PickerTestData {
  groupId: Id<"groups">;
  meetingId: Id<"meetings">;
  leaderId: Id<"users">;
  leaderToken: string;
  // A member who joins last, so they fall beyond the default (un-searched) page.
  farawayId: Id<"users">;
  memberIds: Id<"users">[];
}

async function seedLargeGroupWithMeeting(
  t: ReturnType<typeof convexTest>,
): Promise<PickerTestData> {
  const ids = await t.run(async (ctx) => {
    const ts = Date.now();
    const future = ts + 86_400_000;

    const communityId = await ctx.db.insert("communities", {
      name: "Big Community",
      slug: "big-community-invite",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: ts,
      updatedAt: ts,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Group",
      slug: "group",
      isActive: true,
      displayOrder: 1,
      createdAt: ts,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Big Group",
      isArchived: false,
      createdAt: ts,
      updatedAt: ts,
    });

    // Caller is a leader so they pass canEditMeeting.
    const leaderId = await ctx.db.insert("users", {
      firstName: "Caller",
      lastName: "Leader",
      email: "caller@test.com",
      phone: "+15551110000",
      searchText: "caller leader caller@test.com +15551110000",
      createdAt: ts,
      updatedAt: ts,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: ts,
      notificationsEnabled: true,
    });

    const memberIds: Id<"users">[] = [];
    for (let i = 0; i < MEMBER_COUNT; i++) {
      const userId = await ctx.db.insert("users", {
        firstName: `Member${i}`,
        lastName: "Test",
        email: `member${i}@test.com`,
        phone: `+1555200${String(i).padStart(4, "0")}`,
        searchText: `member${i} test member${i}@test.com`,
        createdAt: ts,
        updatedAt: ts,
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: ts + i + 1,
        notificationsEnabled: true,
      });
      memberIds.push(userId);
    }

    // Joins last, so they land beyond the default first page.
    const farawayId = await ctx.db.insert("users", {
      firstName: "Zelda",
      lastName: "Faraway",
      email: "zelda@test.com",
      phone: "+15559990000",
      searchText: "zelda faraway zelda@test.com +15559990000",
      createdAt: ts,
      updatedAt: ts,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: farawayId,
      role: "member",
      joinedAt: ts + MEMBER_COUNT + 1000,
      notificationsEnabled: true,
    });

    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Big Event",
      scheduledAt: future,
      status: "scheduled",
      meetingType: 1,
      createdAt: ts,
      rsvpEnabled: true,
      rsvpOptions: [{ id: 1, label: "Going", enabled: true }],
      visibility: "group",
      shortId: "bigevt01",
    });

    return { groupId, meetingId, leaderId, farawayId, memberIds };
  });

  const { accessToken: leaderToken } = await generateTokens(ids.leaderId);

  return { ...ids, leaderToken };
}

describe("listGroupMembersForInvite (bounded picker query)", () => {
  test("caps the default result well below the group size", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroupWithMeeting(t);

    const rows = await t.query(
      api.functions.eventInvites.listGroupMembersForInvite,
      { token: data.leaderToken, meetingId: data.meetingId },
    );

    // Group has MEMBER_COUNT + leader + faraway members, but the query must not
    // return (or read) the whole group — that was the "too many reads" bug.
    expect(rows.length).toBeLessThanOrEqual(PICKER_LIMIT);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("always includes the caller for a test-invite-to-self", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroupWithMeeting(t);

    const rows = await t.query(
      api.functions.eventInvites.listGroupMembersForInvite,
      { token: data.leaderToken, meetingId: data.meetingId },
    );

    const self = rows.find((r) => r.userId === data.leaderId);
    expect(self).toBeDefined();
    expect(self?.isSelf).toBe(true);
  });

  test("a member beyond the first page is absent by default but found via server-side search", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroupWithMeeting(t);

    const defaultRows = await t.query(
      api.functions.eventInvites.listGroupMembersForInvite,
      { token: data.leaderToken, meetingId: data.meetingId },
    );
    expect(defaultRows.map((r) => r.userId)).not.toContain(data.farawayId);

    const searched = await t.query(
      api.functions.eventInvites.listGroupMembersForInvite,
      { token: data.leaderToken, meetingId: data.meetingId, search: "zelda" },
    );
    expect(searched.map((r) => r.userId)).toContain(data.farawayId);
  });

  test("search only returns members of the meeting's group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroupWithMeeting(t);

    // An outsider whose name matches the search term but who is not in the group.
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        firstName: "Zelda",
        lastName: "Outsider",
        email: "zelda-out@test.com",
        searchText: "zelda outsider zelda-out@test.com",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const searched = await t.query(
      api.functions.eventInvites.listGroupMembersForInvite,
      { token: data.leaderToken, meetingId: data.meetingId, search: "zelda" },
    );

    // Only the in-group Zelda comes back.
    expect(searched.map((r) => r.userId)).toEqual([data.farawayId]);
  });
});

describe("initiate recipient cap", () => {
  test("rejects more than 20 recipients", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroupWithMeeting(t);

    const twentyOne = data.memberIds.slice(0, 21);
    expect(twentyOne.length).toBe(21);

    await expect(
      t.mutation(api.functions.eventInvites.initiate, {
        token: data.leaderToken,
        meetingId: data.meetingId,
        recipientUserIds: twentyOne,
      }),
    ).rejects.toThrow(/up to 20 people/i);
  });

  test("accepts exactly 20 recipients", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroupWithMeeting(t);

    const twenty = data.memberIds.slice(0, 20);
    const result = await t.mutation(api.functions.eventInvites.initiate, {
      token: data.leaderToken,
      meetingId: data.meetingId,
      recipientUserIds: twenty,
    });

    expect(result.invited).toBe(20);
  });
});
