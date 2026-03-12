import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { modules } from "../test.setup";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

interface SeededGroupLeader {
  groupId: Id<"groups">;
  leaderToken: string;
}

async function seedGroupLeader(
  t: ReturnType<typeof convexTest>
): Promise<SeededGroupLeader> {
  const { groupId, leaderId } = await t.run(async (ctx) => {
    const timestamp = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Toolbar Test Community",
      slug: "toolbar-test-community",
      isPublic: true,
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
      name: "Toolbar Test Group",
      isArchived: false,
      isPublic: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const leaderId = await ctx.db.insert("users", {
      firstName: "Toolbar",
      lastName: "Leader",
      phone: "+12025550999",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: timestamp,
      notificationsEnabled: true,
    });

    return { groupId, leaderId };
  });

  const { accessToken: leaderToken } = await generateTokens(leaderId);
  return { groupId, leaderToken };
}

describe("groups.updateLeaderToolbarTools", () => {
  test("persists tasks when leader saves toolbar tools", async () => {
    const t = convexTest(schema, modules);
    const { groupId, leaderToken } = await seedGroupLeader(t);

    const result = await t.mutation(
      api.functions.groups.index.updateLeaderToolbarTools,
      {
        token: leaderToken,
        groupId,
        tools: ["attendance", "tasks", "events"],
      }
    );

    expect(result).toEqual({ success: true });

    const group = await t.run(async (ctx) => ctx.db.get(groupId));
    expect(group?.leaderToolbarTools).toEqual(["attendance", "tasks", "events"]);
  });
});
