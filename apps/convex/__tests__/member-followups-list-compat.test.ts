import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

async function seedFollowupListFixture(t: ReturnType<typeof convexTest>) {
  const timestamp = Date.now();

  const { groupId, userId, groupMemberId } = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Followup Compat Community",
      slug: "followup-compat-community",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: timestamp,
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Compatibility Group",
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const userId = await ctx.db.insert("users", {
      firstName: "Alex",
      lastName: "Tester",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const groupMemberId = await ctx.db.insert("groupMembers", {
      groupId,
      userId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    return { groupId, userId, groupMemberId };
  });

  await t.run(async (ctx) => {
    await ctx.db.insert("memberFollowupScores", {
      groupId,
      groupMemberId,
      userId,
      firstName: "Alex",
      lastName: "Tester",
      score1: 72,
      score2: 64,
      alerts: [],
      isSnoozed: false,
      attendanceScore: 72,
      connectionScore: 64,
      followupScore: 58,
      missedMeetings: 1,
      consecutiveMissed: 1,
      scoreIds: ["default_attendance", "default_connection"],
      updatedAt: timestamp,
      addedAt: timestamp,
      searchText: "alex tester",
    });
  });

  const { accessToken } = await generateTokens(userId.toString());
  return { groupId, token: accessToken };
}

describe("memberFollowups.list compatibility", () => {
  test("returns paginated shape when paginationOpts are provided", async () => {
    const t = convexTest(schema, modules);
    const { groupId, token } = await seedFollowupListFixture(t);

    const result = await t.query(api.functions.memberFollowups.list, {
      token,
      groupId,
      sortBy: "firstName",
      sortDirection: "asc",
      paginationOpts: { cursor: null, numItems: 20 },
    });

    const pageResult = result as any;
    expect(Array.isArray(pageResult.page)).toBe(true);
    expect(pageResult.page).toHaveLength(1);
    expect(pageResult.page[0].firstName).toBe("Alex");
  });

  test("returns legacy shape when paginationOpts are omitted", async () => {
    const t = convexTest(schema, modules);
    const { groupId, token } = await seedFollowupListFixture(t);

    const result = await t.query(api.functions.memberFollowups.list, {
      token,
      groupId,
      sortDirection: "asc",
    });

    const legacyResult = result as any;
    expect(Array.isArray(legacyResult.members)).toBe(true);
    expect(legacyResult.members).toHaveLength(1);
    expect(legacyResult.members[0].firstName).toBe("Alex");
    expect(Array.isArray(legacyResult.scoreConfig)).toBe(true);
    expect(legacyResult.toolDisplayName).toBe("People");
  });

  test("supports sorting by lastActiveAt", async () => {
    const t = convexTest(schema, modules);
    const timestamp = Date.now();

    const { groupId, token } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Followup Last Active Community",
        slug: "followup-last-active-community",
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId,
        name: "Small Group",
        slug: "small-group-last-active",
        isActive: true,
        createdAt: timestamp,
        displayOrder: 1,
      });

      const groupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Last Active Group",
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const firstUserId = await ctx.db.insert("users", {
        firstName: "Older",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const secondUserId = await ctx.db.insert("users", {
        firstName: "Newer",
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const firstGroupMemberId = await ctx.db.insert("groupMembers", {
        groupId,
        userId: firstUserId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      const secondGroupMemberId = await ctx.db.insert("groupMembers", {
        groupId,
        userId: secondUserId,
        role: "member",
        joinedAt: timestamp + 1,
        notificationsEnabled: true,
      });

      await ctx.db.insert("memberFollowupScores", {
        groupId,
        groupMemberId: firstGroupMemberId,
        userId: firstUserId,
        firstName: "Older",
        score1: 10,
        score2: 20,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 10,
        connectionScore: 20,
        followupScore: 15,
        missedMeetings: 1,
        consecutiveMissed: 1,
        scoreIds: ["default_attendance", "default_connection"],
        updatedAt: timestamp,
        addedAt: timestamp,
        lastActiveAt: timestamp - 10_000,
        searchText: "older",
      });
      await ctx.db.insert("memberFollowupScores", {
        groupId,
        groupMemberId: secondGroupMemberId,
        userId: secondUserId,
        firstName: "Newer",
        score1: 30,
        score2: 40,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 30,
        connectionScore: 40,
        followupScore: 35,
        missedMeetings: 1,
        consecutiveMissed: 1,
        scoreIds: ["default_attendance", "default_connection"],
        updatedAt: timestamp,
        addedAt: timestamp,
        lastActiveAt: timestamp + 10_000,
        searchText: "newer",
      });

      const { accessToken } = await generateTokens(firstUserId.toString());
      return { groupId, token: accessToken };
    });

    const result = await t.query(api.functions.memberFollowups.list, {
      token,
      groupId,
      sortBy: "lastActiveAt",
      sortDirection: "desc",
      paginationOpts: { cursor: null, numItems: 20 },
    });

    const pageResult = result as any;
    expect(pageResult.page).toHaveLength(2);
    expect(pageResult.page[0].firstName).toBe("Newer");
    expect(pageResult.page[1].firstName).toBe("Older");
  });

  test("applies excluded assignee and addedAt range filters server-side", async () => {
    const t = convexTest(schema, modules);
    const timestamp = Date.now();

    const { groupId, token, assigneeToExclude } = await t.run(async (ctx) => {
      const communityId = await ctx.db.insert("communities", {
        name: "Followup Filter Community",
        slug: "followup-filter-community",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId,
        name: "Small Group",
        slug: "small-group-filter",
        isActive: true,
        createdAt: timestamp,
        displayOrder: 1,
      });
      const groupId = await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "Filter Group",
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const requesterId = await ctx.db.insert("users", {
        firstName: "Requester",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const assigneeA = await ctx.db.insert("users", {
        firstName: "AssigneeA",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const assigneeB = await ctx.db.insert("users", {
        firstName: "AssigneeB",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const memberAUserId = await ctx.db.insert("users", {
        firstName: "MemberA",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const memberBUserId = await ctx.db.insert("users", {
        firstName: "MemberB",
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const memberAId = await ctx.db.insert("groupMembers", {
        groupId,
        userId: memberAUserId,
        role: "member",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
      const memberBId = await ctx.db.insert("groupMembers", {
        groupId,
        userId: memberBUserId,
        role: "member",
        joinedAt: timestamp + 1,
        notificationsEnabled: true,
      });

      await ctx.db.insert("memberFollowupScores", {
        groupId,
        groupMemberId: memberAId,
        userId: memberAUserId,
        firstName: "MemberA",
        score1: 20,
        score2: 30,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 20,
        connectionScore: 30,
        followupScore: 25,
        missedMeetings: 1,
        consecutiveMissed: 1,
        scoreIds: ["default_attendance", "default_connection"],
        updatedAt: timestamp,
        addedAt: timestamp - 2000,
        assigneeId: assigneeA,
        searchText: "membera",
      });
      await ctx.db.insert("memberFollowupScores", {
        groupId,
        groupMemberId: memberBId,
        userId: memberBUserId,
        firstName: "MemberB",
        score1: 40,
        score2: 50,
        alerts: [],
        isSnoozed: false,
        attendanceScore: 40,
        connectionScore: 50,
        followupScore: 45,
        missedMeetings: 1,
        consecutiveMissed: 1,
        scoreIds: ["default_attendance", "default_connection"],
        updatedAt: timestamp,
        addedAt: timestamp + 2000,
        assigneeId: assigneeB,
        searchText: "memberb",
      });

      const { accessToken } = await generateTokens(requesterId.toString());
      return { groupId, token: accessToken, assigneeToExclude: assigneeA };
    });

    const result = await t.query(api.functions.memberFollowups.list, {
      token,
      groupId,
      excludedAssigneeFilters: [assigneeToExclude],
      addedAtMin: timestamp,
      paginationOpts: { cursor: null, numItems: 20 },
    });

    const pageResult = result as any;
    expect(pageResult.page).toHaveLength(1);
    expect(pageResult.page[0].firstName).toBe("MemberB");
  });
});
