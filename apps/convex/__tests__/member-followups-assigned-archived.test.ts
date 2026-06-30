/**
 * memberFollowups People-surface queries must exclude archived groups and
 * reject an out-of-scope groupFilter, and getCrossGroupConfig must drop
 * archived groups and archived (deactivated) users from the assignee picker.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

function scoreRow(
  overrides: Record<string, unknown>,
  timestamp: number,
): Record<string, unknown> {
  return {
    score1: 50,
    score2: 50,
    alerts: [],
    isSnoozed: false,
    attendanceScore: 50,
    connectionScore: 50,
    followupScore: 50,
    missedMeetings: 0,
    consecutiveMissed: 0,
    scoreIds: ["sys_service", "sys_attendance", "sys_togather"],
    updatedAt: timestamp,
    addedAt: timestamp,
    ...overrides,
  };
}

async function seedFixture(t: ReturnType<typeof convexTest>) {
  const timestamp = Date.now();

  const ids = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Assigned Archived Community",
      slug: "assigned-archived-community",
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

    const activeGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Active Group",
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const archivedGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Archived Group",
      isArchived: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // The caller leads both groups.
    const leaderUserId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "Both",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    // A co-leader only in the active group (should appear in the picker).
    const coLeaderUserId = await ctx.db.insert("users", {
      firstName: "Active",
      lastName: "Coleader",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    // An archived (deactivated) leader in the active group (should NOT appear).
    const archivedLeaderUserId = await ctx.db.insert("users", {
      firstName: "Archived",
      lastName: "Leader",
      isActive: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    for (const groupId of [activeGroupId, archivedGroupId]) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: leaderUserId,
        role: "leader",
        joinedAt: timestamp,
        notificationsEnabled: true,
      });
    }
    await ctx.db.insert("groupMembers", {
      groupId: activeGroupId,
      userId: coLeaderUserId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: activeGroupId,
      userId: archivedLeaderUserId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    // One follow-up score row in each group, assigned to the caller.
    const activeMemberId = await ctx.db.insert("groupMembers", {
      groupId: activeGroupId,
      userId: leaderUserId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });
    const archivedMemberId = await ctx.db.insert("groupMembers", {
      groupId: archivedGroupId,
      userId: leaderUserId,
      role: "member",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    const activeScoreId = await ctx.db.insert(
      "memberFollowupScores",
      scoreRow(
        {
          groupId: activeGroupId,
          groupMemberId: activeMemberId,
          userId: coLeaderUserId,
          firstName: "Active",
          lastName: "Person",
          assigneeId: leaderUserId,
          searchText: "active person",
        },
        timestamp,
      ) as any,
    );
    await ctx.db.insert(
      "memberFollowupScores",
      scoreRow(
        {
          groupId: archivedGroupId,
          groupMemberId: archivedMemberId,
          userId: archivedLeaderUserId,
          firstName: "Archived",
          lastName: "Person",
          assigneeId: leaderUserId,
          searchText: "archived person",
        },
        timestamp,
      ) as any,
    );

    return {
      activeGroupId,
      archivedGroupId,
      leaderUserId,
      coLeaderUserId,
      archivedLeaderUserId,
      activeScoreId,
    };
  });

  const { accessToken: leaderToken } = await generateTokens(
    ids.leaderUserId.toString(),
  );
  return { ...ids, leaderToken };
}

describe("memberFollowups.listAssignedToMe archived-group hardening", () => {
  test("excludes archived-group rows when no groupFilter is given", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, activeScoreId } = await seedFixture(t);

    const result: any = await t.query(
      api.functions.memberFollowups.listAssignedToMe,
      { token: leaderToken, paginationOpts: { cursor: null, numItems: 50 } },
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0]._id).toBe(activeScoreId);
  });

  test("returns empty for a groupFilter pointing at an archived group", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, archivedGroupId } = await seedFixture(t);

    const result: any = await t.query(
      api.functions.memberFollowups.listAssignedToMe,
      {
        token: leaderToken,
        groupFilter: archivedGroupId,
        paginationOpts: { cursor: null, numItems: 50 },
      },
    );

    expect(result.page).toHaveLength(0);
  });

  test("searchAssignedToMe also rejects an archived groupFilter", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, archivedGroupId } = await seedFixture(t);

    const result: any = await t.query(
      api.functions.memberFollowups.searchAssignedToMe,
      { token: leaderToken, searchText: "person", groupFilter: archivedGroupId },
    );

    expect(result).toHaveLength(0);
  });
});

describe("memberFollowups.getCrossGroupConfig assignee picker filtering", () => {
  test("excludes archived-group leaders and archived users", async () => {
    const t = convexTest(schema, modules);
    const { leaderToken, leaderUserId, coLeaderUserId, archivedLeaderUserId } =
      await seedFixture(t);

    const config: any = await t.query(
      api.functions.memberFollowups.getCrossGroupConfig,
      { token: leaderToken },
    );

    const leaderIds = config.leaders.map((l: any) => l.userId.toString());
    // The caller and the active co-leader are included.
    expect(leaderIds).toContain(leaderUserId.toString());
    expect(leaderIds).toContain(coLeaderUserId.toString());
    // The archived (deactivated) leader is excluded.
    expect(leaderIds).not.toContain(archivedLeaderUserId.toString());
    // Only the active group is reported (archived group dropped).
    expect(config.leaderGroups).toHaveLength(1);
    expect(config.leaderGroups[0].name).toBe("Active Group");
  });
});
