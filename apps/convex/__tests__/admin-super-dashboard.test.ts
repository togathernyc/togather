import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-super-dashboard-tests-32-chars";

const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

type SeedData = {
  internalUserId: Id<"users">;
  adminUserId: Id<"users">;
};

async function seedDashboardData(t: ReturnType<typeof convexTest>): Promise<SeedData> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const sixDaysAgo = now - 6 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
    const yesterday = now - 24 * 60 * 60 * 1000;

    const internalUserId = await ctx.db.insert("users", {
      firstName: "Primary",
      lastName: "Admin",
      email: "primary@test.com",
      isStaff: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const adminUserId = await ctx.db.insert("users", {
      firstName: "Regular",
      lastName: "Admin",
      email: "admin@test.com",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const memberOneId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "One",
      email: "member1@test.com",
      isActive: true,
      createdAt: sixDaysAgo,
      updatedAt: sixDaysAgo,
    });

    const memberTwoId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "Two",
      email: "member2@test.com",
      isActive: true,
      createdAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
    });

    const communityId = await ctx.db.insert("communities", {
      name: "Dashboard Test Community",
      slug: "dashboard-test",
      isPublic: true,
      createdAt: sixDaysAgo,
      updatedAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: internalUserId,
      communityId,
      roles: COMMUNITY_ROLES.PRIMARY_ADMIN,
      status: 1,
      createdAt: sixDaysAgo,
      lastLogin: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: adminUserId,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: sixDaysAgo,
      lastLogin: yesterday,
    });

    await ctx.db.insert("userCommunities", {
      userId: memberOneId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: sixDaysAgo,
      lastLogin: twoDaysAgo,
    });

    await ctx.db.insert("userCommunities", {
      userId: memberTwoId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: twoDaysAgo,
      lastLogin: yesterday,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: sixDaysAgo,
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Dashboard Group",
      isArchived: false,
      createdAt: sixDaysAgo,
      updatedAt: now,
    });

    const channelId = await ctx.db.insert("chatChannels", {
      groupId,
      channelType: "main",
      name: "General",
      slug: "general",
      createdById: internalUserId,
      createdAt: sixDaysAgo,
      updatedAt: now,
      isArchived: false,
      memberCount: 4,
    });

    await ctx.db.insert("chatMessages", {
      channelId,
      senderId: internalUserId,
      content: "Welcome",
      contentType: "text",
      createdAt: twoDaysAgo,
      isDeleted: false,
    });

    await ctx.db.insert("chatMessages", {
      channelId,
      senderId: memberOneId,
      content: "Hello",
      contentType: "text",
      createdAt: yesterday,
      isDeleted: false,
    });

    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      scheduledAt: yesterday,
      status: "completed",
      meetingType: 1,
      createdAt: yesterday,
    });

    await ctx.db.insert("meetingAttendances", {
      meetingId,
      userId: memberOneId,
      status: 1,
      recordedAt: yesterday,
    });

    await ctx.db.insert("meetingAttendances", {
      meetingId,
      userId: memberTwoId,
      status: 1,
      recordedAt: yesterday,
    });

    return {
      internalUserId,
      adminUserId,
    };
  });

  return ids;
}

describe("getInternalDashboard", () => {
  test("returns app-wide analytics for internal users", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedDashboardData(t);
    const internalToken = (await generateTokens(seed.internalUserId)).accessToken;

    const result = await t.query(api.functions.admin.stats.getInternalDashboard, {
      token: internalToken,
      range: "7d",
    });

    expect(result.overview.messagesSent).toBe(2);
    expect(result.overview.uniqueActiveSenders).toBe(2);
    expect(result.overview.newMembers).toBeGreaterThanOrEqual(2);
    expect(result.overview.meetingsHeld).toBe(1);
    expect(result.overview.attendanceCheckIns).toBe(2);
    expect(result.totals.totalMembers).toBe(4);
    expect(result.totals.activeGroups).toBe(1);
    expect(result.totals.activeChannels).toBe(1);
    expect(result.totals.totalCommunities).toBe(1);
    expect(result.trend.length).toBeGreaterThan(0);
    expect(result.topChannels[0]?.channelName).toBe("General");
  });

  test("rejects non-internal users", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedDashboardData(t);
    const adminToken = (await generateTokens(seed.adminUserId)).accessToken;

    await expect(
      t.query(api.functions.admin.stats.getInternalDashboard, {
        token: adminToken,
        range: "7d",
      })
    ).rejects.toThrow("Togather internal access required");
  });
});

