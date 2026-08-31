/**
 * Private groups reached through a share link.
 *
 * Regression coverage for the "[CONVEX M(functions/groups/mutations:join)]
 * Server Error" report: the share page sent private groups through
 * `groups.join`, which rejects them outright. The supported path is
 * `groupMembers.createJoinRequest`, after which `getByShortId` reports the
 * pending status the UI renders as "Request Pending".
 *
 * Run with: cd apps/convex && pnpm test __tests__/private-group-share-join.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import { drainScheduledFunctions } from "./helpers/drainScheduledFunctions";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

async function seed(t: ReturnType<typeof convexTest>, isPublic: boolean) {
  const timestamp = Date.now();

  const { communityId, groupTypeId, userId } = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "TEST001",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Teams",
      slug: "teams",
      createdAt: timestamp,
      isActive: true,
      displayOrder: 0,
    });
    const userId = await ctx.db.insert("users", {
      firstName: "David",
      lastName: "S",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { communityId, groupTypeId, userId };
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "DP Connect Leaders",
      shortId: "abc123",
      isPublic,
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  const { accessToken } = await generateTokens(userId);
  return { communityId, groupId, userId, accessToken };
}

describe("joining a private group from a share link", () => {
  test("groups.join refuses private groups with a client-visible message", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seed(t, false);

    await expect(
      t.mutation(api.functions.groups.mutations.join, {
        token: accessToken,
        groupId,
      })
    ).rejects.toThrow("This is a private group. Please request to join.");
  });

  test("createJoinRequest records a pending request that getByShortId reports", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seed(t, false);

    const request = await t.mutation(
      api.functions.groupMembers.createJoinRequest,
      { token: accessToken, groupId }
    );
    // createJoinRequest notifies admins via ctx.scheduler; let that settle so
    // it cannot leak into a later test file sharing this vitest worker.
    await drainScheduledFunctions(t);
    expect(request.status).toBe("pending");

    const group = await t.query(api.functions.groups.queries.getByShortId, {
      shortId: "abc123",
      token: accessToken,
    });

    expect(group?.userRequestStatus).toBe("pending");
    // A pending request must not grant membership before a leader approves it.
    expect(group?.userRole).toBeNull();
    expect(group?.memberCount).toBe(0);
  });

  test("a second request for the same group is rejected with its reason", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seed(t, false);

    await t.mutation(api.functions.groupMembers.createJoinRequest, {
      token: accessToken,
      groupId,
    });
    await drainScheduledFunctions(t);

    await expect(
      t.mutation(api.functions.groupMembers.createJoinRequest, {
        token: accessToken,
        groupId,
      })
    ).rejects.toThrow("You already have a pending join request for this group");
  });

  test("public groups still join directly", async () => {
    const t = convexTest(schema, modules);
    const { groupId, accessToken } = await seed(t, true);

    await t.mutation(api.functions.groups.mutations.join, {
      token: accessToken,
      groupId,
    });
    await drainScheduledFunctions(t);

    const group = await t.query(api.functions.groups.queries.getByShortId, {
      shortId: "abc123",
      token: accessToken,
    });

    expect(group?.userRole).toBe("member");
  });
});
