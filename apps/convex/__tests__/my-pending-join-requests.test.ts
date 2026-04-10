/**
 * Tests for listMyPendingJoinRequests query
 *
 * Powers the frontend "pending join request limit" feature: a user may have at
 * most 2 pending join requests within a single community before the client
 * blocks them from requesting a 3rd. This query returns the user's current
 * pending requests so the UI can count them and surface a "My Requests"
 * section on the profile page.
 *
 * Run with: cd convex && pnpm test __tests__/my-pending-join-requests.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

/**
 * Seed a community with two group types and a test user.
 */
async function seedCommunityWithUser(t: ReturnType<typeof convexTest>) {
  const timestamp = Date.now();

  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "TEST001",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  const dinnerPartyTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Dinner Parties",
      slug: "dinner-parties",
      createdAt: timestamp,
      isActive: true,
      displayOrder: 0,
    });
  });

  const teamTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Teams",
      slug: "teams",
      createdAt: timestamp,
      isActive: true,
      displayOrder: 1,
    });
  });

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  return { communityId, dinnerPartyTypeId, teamTypeId, userId, timestamp };
}

async function createGroup(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  groupTypeId: Id<"groupTypes">,
  name: string,
  timestamp: number
): Promise<Id<"groups">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
}

async function createPendingRequest(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  userId: Id<"users">,
  requestedAt: number
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      groupId,
      userId,
      role: "member",
      joinedAt: requestedAt,
      leftAt: requestedAt, // pending requests are marked as left until approved
      notificationsEnabled: true,
      requestStatus: "pending",
      requestedAt,
    });
  });
}

async function createActiveMembership(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  userId: Id<"users">,
  joinedAt: number
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      groupId,
      userId,
      role: "member",
      joinedAt,
      // No leftAt → active
      notificationsEnabled: true,
      // No requestStatus → legacy direct membership, also valid
    });
  });
}

describe("listMyPendingJoinRequests", () => {
  test("returns empty array when the user has no pending requests", async () => {
    const t = convexTest(schema, modules);
    const { communityId, userId } = await seedCommunityWithUser(t);
    const { accessToken } = await generateTokens(userId);

    const result = await t.query(
      api.functions.groupMembers.listMyPendingJoinRequests,
      { token: accessToken, communityId }
    );

    expect(result).toEqual([]);
  });

  test("returns a single pending request with group + type metadata", async () => {
    const t = convexTest(schema, modules);
    const { communityId, dinnerPartyTypeId, userId, timestamp } =
      await seedCommunityWithUser(t);
    const groupId = await createGroup(
      t,
      communityId,
      dinnerPartyTypeId,
      "Smith Family Dinner",
      timestamp
    );
    await createPendingRequest(t, groupId, userId, timestamp);

    const { accessToken } = await generateTokens(userId);

    const result = await t.query(
      api.functions.groupMembers.listMyPendingJoinRequests,
      { token: accessToken, communityId }
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      groupId,
      groupName: "Smith Family Dinner",
      groupTypeName: "Dinner Parties",
      requestedAt: timestamp,
    });
  });

  test("returns multiple pending requests across different group types", async () => {
    const t = convexTest(schema, modules);
    const { communityId, dinnerPartyTypeId, teamTypeId, userId, timestamp } =
      await seedCommunityWithUser(t);

    const dpGroupId = await createGroup(
      t,
      communityId,
      dinnerPartyTypeId,
      "Dinner Party A",
      timestamp
    );
    const teamGroupId = await createGroup(
      t,
      communityId,
      teamTypeId,
      "Worship Team",
      timestamp
    );
    await createPendingRequest(t, dpGroupId, userId, timestamp);
    await createPendingRequest(t, teamGroupId, userId, timestamp + 1);

    const { accessToken } = await generateTokens(userId);

    const result = await t.query(
      api.functions.groupMembers.listMyPendingJoinRequests,
      { token: accessToken, communityId }
    );

    expect(result).toHaveLength(2);
    const names = result.map((r) => r.groupName).sort();
    expect(names).toEqual(["Dinner Party A", "Worship Team"]);
  });

  test("does NOT count active memberships (only pending requests)", async () => {
    const t = convexTest(schema, modules);
    const { communityId, dinnerPartyTypeId, userId, timestamp } =
      await seedCommunityWithUser(t);

    // Create 30 active memberships — none should appear
    for (let i = 0; i < 30; i++) {
      const groupId = await createGroup(
        t,
        communityId,
        dinnerPartyTypeId,
        `Active DP ${i}`,
        timestamp
      );
      await createActiveMembership(t, groupId, userId, timestamp);
    }

    const { accessToken } = await generateTokens(userId);

    const result = await t.query(
      api.functions.groupMembers.listMyPendingJoinRequests,
      { token: accessToken, communityId }
    );

    expect(result).toEqual([]);
  });

  test("does NOT include declined requests", async () => {
    const t = convexTest(schema, modules);
    const { communityId, dinnerPartyTypeId, userId, timestamp } =
      await seedCommunityWithUser(t);

    const groupId = await createGroup(
      t,
      communityId,
      dinnerPartyTypeId,
      "Declined DP",
      timestamp
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: timestamp,
        leftAt: timestamp,
        notificationsEnabled: true,
        requestStatus: "declined",
        requestedAt: timestamp,
      });
    });

    const { accessToken } = await generateTokens(userId);

    const result = await t.query(
      api.functions.groupMembers.listMyPendingJoinRequests,
      { token: accessToken, communityId }
    );

    expect(result).toEqual([]);
  });

  test("scopes to the requested community only", async () => {
    const t = convexTest(schema, modules);
    const { communityId, dinnerPartyTypeId, userId, timestamp } =
      await seedCommunityWithUser(t);

    // Create a SECOND community + group type + group
    const otherCommunityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Other Community",
        slug: "OTHER01",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
    const otherTypeId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupTypes", {
        communityId: otherCommunityId,
        name: "Other Type",
        slug: "other",
        createdAt: timestamp,
        isActive: true,
        displayOrder: 0,
      });
    });
    const otherGroupId = await createGroup(
      t,
      otherCommunityId,
      otherTypeId,
      "Other Community Group",
      timestamp
    );
    await createPendingRequest(t, otherGroupId, userId, timestamp);

    // Also create one in the current community
    const localGroupId = await createGroup(
      t,
      communityId,
      dinnerPartyTypeId,
      "Local DP",
      timestamp
    );
    await createPendingRequest(t, localGroupId, userId, timestamp);

    const { accessToken } = await generateTokens(userId);

    // Querying current community returns only the local one
    const localResult = await t.query(
      api.functions.groupMembers.listMyPendingJoinRequests,
      { token: accessToken, communityId }
    );
    expect(localResult).toHaveLength(1);
    expect(localResult[0]?.groupName).toBe("Local DP");

    // Querying the other community returns only the other one
    const otherResult = await t.query(
      api.functions.groupMembers.listMyPendingJoinRequests,
      { token: accessToken, communityId: otherCommunityId }
    );
    expect(otherResult).toHaveLength(1);
    expect(otherResult[0]?.groupName).toBe("Other Community Group");
  });

  test("does NOT include other users' pending requests", async () => {
    const t = convexTest(schema, modules);
    const { communityId, dinnerPartyTypeId, userId, timestamp } =
      await seedCommunityWithUser(t);

    const otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Other",
        lastName: "User",
        phone: "+15555550099",
        phoneVerified: true,
        activeCommunityId: communityId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });

    const groupId = await createGroup(
      t,
      communityId,
      dinnerPartyTypeId,
      "Some DP",
      timestamp
    );
    await createPendingRequest(t, groupId, otherUserId, timestamp);

    const { accessToken } = await generateTokens(userId);

    const result = await t.query(
      api.functions.groupMembers.listMyPendingJoinRequests,
      { token: accessToken, communityId }
    );

    expect(result).toEqual([]);
  });
});
