/**
 * communityPeople.listAssignedToMe — archived groups must not surface their
 * people on the People page, including when an explicit groupFilter is supplied.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const COMMUNITY_ROLES = { MEMBER: 1 } as const;

async function seedArchivedGroupFixture(t: ReturnType<typeof convexTest>) {
  const now = Date.now();

  const ids = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Archived Group Community",
      slug: "archived-group-community",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      createdAt: now,
      displayOrder: 0,
    });

    const activeGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Active Group",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    const archivedGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Archived Group",
      isArchived: true,
      createdAt: now,
      updatedAt: now,
    });

    const leaderUserId = await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "Both",
      email: "leader-both@test.com",
      phone: "+15555554001",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: leaderUserId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: now,
    });

    // Leader of both the active and the archived group.
    for (const groupId of [activeGroupId, archivedGroupId]) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: leaderUserId,
        role: "leader",
        joinedAt: now,
        notificationsEnabled: true,
      });
    }

    // One person in each group, both assigned to the leader.
    const activePersonUserId = await ctx.db.insert("users", {
      firstName: "Active",
      lastName: "Person",
      phone: "+15555554002",
      createdAt: now,
      updatedAt: now,
    });
    const archivedPersonUserId = await ctx.db.insert("users", {
      firstName: "Archived",
      lastName: "Person",
      phone: "+15555554003",
      createdAt: now,
      updatedAt: now,
    });

    const activePersonId = await ctx.db.insert("communityPeople", {
      communityId,
      groupId: activeGroupId,
      userId: activePersonUserId,
      firstName: "Active",
      lastName: "Person",
      assigneeIds: [leaderUserId],
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("communityPeople", {
      communityId,
      groupId: archivedGroupId,
      userId: archivedPersonUserId,
      firstName: "Archived",
      lastName: "Person",
      assigneeIds: [leaderUserId],
      createdAt: now,
      updatedAt: now,
    });

    return {
      communityId,
      activeGroupId,
      archivedGroupId,
      leaderUserId,
      activePersonId,
    };
  });

  const { accessToken: leaderToken } = await generateTokens(
    ids.leaderUserId.toString(),
    ids.communityId.toString(),
  );

  return { ...ids, leaderToken };
}

describe("communityPeople.listAssignedToMe archived-group filtering", () => {
  test("excludes archived-group people when no groupFilter is given", async () => {
    const t = convexTest(schema, modules);
    const { communityId, activePersonId, leaderToken } =
      await seedArchivedGroupFixture(t);

    const result = await t.query(api.functions.communityPeople.listAssignedToMe, {
      token: leaderToken,
      communityId,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page.length).toBe(1);
    expect(result.page[0]._id).toBe(activePersonId);
  });

  test("returns empty for a groupFilter pointing at an archived group", async () => {
    const t = convexTest(schema, modules);
    const { communityId, archivedGroupId, leaderToken } =
      await seedArchivedGroupFixture(t);

    const result = await t.query(api.functions.communityPeople.listAssignedToMe, {
      token: leaderToken,
      communityId,
      groupFilter: archivedGroupId,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page.length).toBe(0);
  });

  test("still returns people for a groupFilter pointing at an active group", async () => {
    const t = convexTest(schema, modules);
    const { communityId, activeGroupId, activePersonId, leaderToken } =
      await seedArchivedGroupFixture(t);

    const result = await t.query(api.functions.communityPeople.listAssignedToMe, {
      token: leaderToken,
      communityId,
      groupFilter: activeGroupId,
      paginationOpts: { numItems: 50, cursor: null },
    });

    expect(result.page.length).toBe(1);
    expect(result.page[0]._id).toBe(activePersonId);
  });
});
