/**
 * Birthday Bot Scheduled Jobs Tests
 *
 * Tests the birthday bot query functions: getDueBirthdayBotConfigs,
 * getBirthdayBotLeaders, and getMembersWithBirthdayToday.
 *
 * Run with: cd apps/convex && pnpm test __tests__/scheduledJobs.birthday-bot.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";

import type { Id } from "../_generated/dataModel";

// ============================================================================
// Helpers
// ============================================================================

async function seedCommunityAndGroup(t: ReturnType<typeof convexTest>) {
  const now = Date.now();

  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Birthday Test Community",
      slug: "BDAY01",
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });
  });

  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      description: "Small groups",
      createdAt: now,
      isActive: true,
      displayOrder: 0,
    });
  });

  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      isAnnouncementGroup: false,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { communityId, groupId, groupTypeId, now };
}

async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    dateOfBirth?: number;
  } = {}
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: overrides.firstName ?? "Test",
      lastName: overrides.lastName ?? "User",
      phone: overrides.phone ?? `+1555555${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`,
      phoneVerified: true,
      dateOfBirth: overrides.dateOfBirth,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function addGroupMember(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  userId: Id<"users">,
  role: string = "member"
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("groupMembers", {
      groupId,
      userId,
      role,
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });
}

async function seedBotConfig(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  overrides: {
    enabled?: boolean;
    nextScheduledAt?: number;
    config?: Record<string, unknown>;
    state?: Record<string, unknown>;
  } = {}
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    return await ctx.db.insert("groupBotConfigs", {
      groupId,
      botType: "birthday",
      enabled: overrides.enabled ?? true,
      nextScheduledAt: overrides.nextScheduledAt ?? now,
      config: overrides.config ?? { mode: "leader_reminder" },
      state: overrides.state ?? { lastLeaderIndex: -1 },
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ============================================================================
// getDueBirthdayBotConfigs Tests
// ============================================================================

describe("getDueBirthdayBotConfigs", () => {
  test("returns configs within the time window", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, groupId, { nextScheduledAt: now + 1000 });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result).toHaveLength(1);
    expect(result[0].groupName).toBe("Test Group");
    expect(result[0].communityName).toBe("Birthday Test Community");
    expect(result[0].timezone).toBe("America/New_York");
  });

  test("excludes configs outside the time window", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    // Schedule far in the future
    await seedBotConfig(t, groupId, {
      nextScheduledAt: now + 24 * 60 * 60 * 1000,
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result).toHaveLength(0);
  });

  test("excludes disabled configs", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, groupId, {
      enabled: false,
      nextScheduledAt: now + 1000,
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result).toHaveLength(0);
  });

  test("returns correct leader count from group members", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, groupId, { nextScheduledAt: now + 1000 });

    // Add 2 leaders
    const leader1 = await seedUser(t, { firstName: "Leader", lastName: "One" });
    const leader2 = await seedUser(t, { firstName: "Leader", lastName: "Two" });
    await addGroupMember(t, groupId, leader1, "leader");
    await addGroupMember(t, groupId, leader2, "leader");

    const result = await t.query(
      internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result).toHaveLength(1);
    expect(result[0].leaderCount).toBe(2);
  });

  test("defaults leaderCount to 1 when no leaders exist", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, groupId, { nextScheduledAt: now + 1000 });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result[0].leaderCount).toBe(1);
  });

  test("uses default message when config has none", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, groupId, {
      nextScheduledAt: now + 1000,
      config: { mode: "leader_reminder" },
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result[0].message).toContain("happy birthday");
  });
});

// ============================================================================
// getBirthdayBotLeaders Tests
// ============================================================================

describe("getBirthdayBotLeaders", () => {
  test("returns leaders with display names", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const leaderId = await seedUser(t, {
      firstName: "Jane",
      lastName: "Smith",
    });
    await addGroupMember(t, groupId, leaderId, "leader");

    const result = await t.query(
      internal.functions.scheduledJobs.getBirthdayBotLeaders,
      { groupId }
    );

    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Jane Smith");
    expect(result[0].userId).toBe(leaderId);
  });

  test("excludes members who are not leaders", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const leaderId = await seedUser(t, { firstName: "Leader" });
    const memberId = await seedUser(t, { firstName: "Member" });
    await addGroupMember(t, groupId, leaderId, "leader");
    await addGroupMember(t, groupId, memberId, "member");

    const result = await t.query(
      internal.functions.scheduledJobs.getBirthdayBotLeaders,
      { groupId }
    );

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(leaderId);
  });

  test("excludes leaders who have left the group", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const activeLeader = await seedUser(t, { firstName: "Active" });
    const leftLeader = await seedUser(t, { firstName: "Left" });
    await addGroupMember(t, groupId, activeLeader, "leader");

    // Add leader who left
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: leftLeader,
        role: "leader",
        joinedAt: Date.now() - 100000,
        leftAt: Date.now() - 50000,
        notificationsEnabled: true,
      });
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getBirthdayBotLeaders,
      { groupId }
    );

    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(activeLeader);
  });

  test("returns empty array when no leaders exist", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const memberId = await seedUser(t, { firstName: "Regular" });
    await addGroupMember(t, groupId, memberId, "member");

    const result = await t.query(
      internal.functions.scheduledJobs.getBirthdayBotLeaders,
      { groupId }
    );

    expect(result).toHaveLength(0);
  });
});

// ============================================================================
// getMembersWithBirthdayToday Tests
// ============================================================================

describe("getMembersWithBirthdayToday", () => {
  test("returns members whose birthday matches today (UTC)", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    // Create a birthday that matches today in UTC
    const today = new Date();
    const birthdayDate = new Date(
      Date.UTC(1990, today.getUTCMonth(), today.getUTCDate())
    );

    const userId = await seedUser(t, {
      firstName: "Birthday",
      lastName: "Person",
      dateOfBirth: birthdayDate.getTime(),
    });
    await addGroupMember(t, groupId, userId, "member");

    const result = await t.query(
      internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      { groupId }
      // No timezone → defaults to UTC
    );

    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe("Birthday");
    expect(result[0].userId).toBe(userId);
  });

  test("excludes members without dateOfBirth", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const userId = await seedUser(t, { firstName: "NoBday" });
    await addGroupMember(t, groupId, userId, "member");

    const result = await t.query(
      internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      { groupId }
    );

    expect(result).toHaveLength(0);
  });

  test("excludes members whose birthday is not today", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    // Birthday tomorrow
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const birthdayDate = new Date(
      Date.UTC(1990, tomorrow.getUTCMonth(), tomorrow.getUTCDate())
    );

    const userId = await seedUser(t, {
      firstName: "NotToday",
      dateOfBirth: birthdayDate.getTime(),
    });
    await addGroupMember(t, groupId, userId, "member");

    const result = await t.query(
      internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      { groupId }
    );

    expect(result).toHaveLength(0);
  });

  test("excludes members who have left the group", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const today = new Date();
    const birthdayDate = new Date(
      Date.UTC(1990, today.getUTCMonth(), today.getUTCDate())
    );

    const userId = await seedUser(t, {
      firstName: "LeftMember",
      dateOfBirth: birthdayDate.getTime(),
    });

    // Add as left member
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: Date.now() - 100000,
        leftAt: Date.now() - 50000,
        notificationsEnabled: true,
      });
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      { groupId }
    );

    expect(result).toHaveLength(0);
  });

  test("handles multiple birthday members", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const today = new Date();
    const birthdayDate = new Date(
      Date.UTC(1990, today.getUTCMonth(), today.getUTCDate())
    );

    const user1 = await seedUser(t, {
      firstName: "Alice",
      dateOfBirth: birthdayDate.getTime(),
    });
    const user2 = await seedUser(t, {
      firstName: "Bob",
      dateOfBirth: new Date(
        Date.UTC(1985, today.getUTCMonth(), today.getUTCDate())
      ).getTime(),
    });
    await addGroupMember(t, groupId, user1, "member");
    await addGroupMember(t, groupId, user2, "member");

    const result = await t.query(
      internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      { groupId }
    );

    expect(result).toHaveLength(2);
    const names = result.map((r: { firstName: string }) => r.firstName).sort();
    expect(names).toEqual(["Alice", "Bob"]);
  });
});
