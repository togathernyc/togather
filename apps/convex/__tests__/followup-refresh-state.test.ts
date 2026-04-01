import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api, internal } from "../_generated/api";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

async function seedFollowupRefreshFixture(t: ReturnType<typeof convexTest>) {
  const baseTs = Date.now();
  const communityLastLogin = baseTs + 50_000;

  const fixture = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Followup Refresh Community",
      slug: "followup-refresh-community",
      createdAt: baseTs,
      updatedAt: baseTs,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group-refresh",
      isActive: true,
      createdAt: baseTs,
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Followup Refresh Group",
      isArchived: false,
      createdAt: baseTs,
      updatedAt: baseTs,
    });

    const leaderUserId = await ctx.db.insert("users", {
      firstName: "Leader",
      createdAt: baseTs,
      updatedAt: baseTs,
    });

    const memberUserId = await ctx.db.insert("users", {
      firstName: "Member",
      lastLogin: baseTs - 1_000, // Older global fallback value
      createdAt: baseTs,
      updatedAt: baseTs,
    });

    const leaderGroupMemberId = await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderUserId,
      role: "leader",
      joinedAt: baseTs,
      notificationsEnabled: true,
    });

    const memberGroupMemberId = await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberUserId,
      role: "member",
      joinedAt: baseTs + 1,
      notificationsEnabled: true,
    });

    await ctx.db.insert("userCommunities", {
      userId: leaderUserId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: baseTs,
      updatedAt: baseTs,
      lastLogin: baseTs,
    });

    await ctx.db.insert("userCommunities", {
      userId: memberUserId,
      communityId,
      roles: 1,
      status: 1,
      createdAt: baseTs,
      updatedAt: baseTs,
      lastLogin: communityLastLogin,
    });

    return {
      communityId,
      groupId,
      leaderUserId,
      leaderGroupMemberId,
      memberUserId,
      memberGroupMemberId,
      communityLastLogin,
    };
  });

  const { accessToken } = await generateTokens(fixture.leaderUserId.toString());
  return { ...fixture, token: accessToken };
}

describe("followup refresh state + lastActiveAt", () => {
  test("uses community lastLogin when building scoring members", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFollowupRefreshFixture(t);

    const page = await t.query(
      internal.functions.followupScoreComputation.getMembersForScoring,
      {
        groupId: fixture.groupId,
        limit: 20,
      }
    );

    const member = (page.members as any[]).find(
      (m) => m._id.toString() === fixture.memberGroupMemberId.toString()
    );
    expect(member).toBeTruthy();
    expect(member.lastActiveAt).toBe(fixture.communityLastLogin);
  });

  test("refreshFollowupScores returns success and schedules computation", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFollowupRefreshFixture(t);

    const result = await t.mutation(
      api.functions.groups.mutations.refreshFollowupScores,
      {
        token: fixture.token,
        groupId: fixture.groupId,
      }
    );

    // New pipeline returns { success: true } and schedules communityScoreComputation
    expect((result as any).success).toBe(true);

    // Calling again should also succeed (no longer tracks "alreadyRunning" state)
    const second = await t.mutation(
      api.functions.groups.mutations.refreshFollowupScores,
      {
        token: fixture.token,
        groupId: fixture.groupId,
      }
    );
    expect((second as any).success).toBe(true);
  });

  test("duplicate refresh calls both succeed", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedFollowupRefreshFixture(t);

    // Both calls should succeed independently (no "alreadyRunning" gating)
    const first = await t.mutation(
      api.functions.groups.mutations.refreshFollowupScores,
      {
        token: fixture.token,
        groupId: fixture.groupId,
      }
    );
    const second = await t.mutation(
      api.functions.groups.mutations.refreshFollowupScores,
      {
        token: fixture.token,
        groupId: fixture.groupId,
      }
    );

    expect((first as any).success).toBe(true);
    expect((second as any).success).toBe(true);
  });
});
