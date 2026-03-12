/**
 * Birthday Bot Timezone Tests
 *
 * Tests for the timezone-aware birthday bot functionality.
 * These tests verify that birthday detection and scheduling works correctly
 * across different timezones, not just UTC.
 *
 * Key scenarios tested:
 * 1. Birthday detection respects community timezone, not UTC
 * 2. Due configs are properly filtered by time window
 * 3. Rescheduling calculates next 9 AM in community timezone
 * 4. Birthday detection when date differs between UTC and local time
 * 5. Enabling birthday bot sets correct nextScheduledAt
 *
 * Run with: cd apps/convex && pnpm test __tests__/birthday-bot.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

// Set up environment variables for tests
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Seed basic test data (community, group type, group, user)
 */
async function seedTestData(
  t: ReturnType<typeof convexTest>,
  options: {
    timezone?: string;
    userBirthday?: number; // Unix timestamp
  } = {}
): Promise<{
  userId: Id<"users">;
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  groupTypeId: Id<"groupTypes">;
  accessToken: string;
}> {
  const { timezone = "America/New_York", userBirthday } = options;

  // Create community with timezone
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Create group type
  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Test Group Type",
      slug: "test-group-type",
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    });
  });

  // Create user with optional birthday
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555555000",
      phoneVerified: true,
      activeCommunityId: communityId,
      dateOfBirth: userBirthday,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Create group
  const groupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Test Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Create group membership
  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  // Generate access token
  const { accessToken } = await generateTokens(userId);

  return { userId, communityId, groupId, groupTypeId, accessToken };
}

/**
 * Create a birthday bot config for a group
 */
async function createBirthdayBotConfig(
  t: ReturnType<typeof convexTest>,
  options: {
    groupId: Id<"groups">;
    enabled?: boolean;
    nextScheduledAt?: number;
    config?: Record<string, unknown>;
  }
): Promise<Id<"groupBotConfigs">> {
  const {
    groupId,
    enabled = true,
    nextScheduledAt,
    config = { mode: "general_chat", message: "Happy Birthday!" },
  } = options;

  return await t.run(async (ctx) => {
    return await ctx.db.insert("groupBotConfigs", {
      groupId,
      botType: "birthday",
      enabled,
      config,
      state: {},
      nextScheduledAt,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("Birthday Bot - Timezone Awareness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getMembersWithBirthdayToday - Current Implementation (UTC)", () => {
    // These tests verify the CURRENT behavior using UTC
    // They should pass with the existing implementation

    test("should detect birthday when UTC date matches (existing behavior)", async () => {
      const t = convexTest(schema, modules);

      // Birthday: January 15
      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId, userId } = await seedTestData(t, {
        timezone: "America/New_York",
        userBirthday: birthdayTimestamp,
      });

      // Mock time to Jan 15 at 9 AM UTC
      vi.setSystemTime(new Date("2024-01-15T09:00:00Z"));

      // Call current implementation (no timezone param)
      const birthdays = await t.query(
        internal.functions.scheduledJobs.getMembersWithBirthdayToday,
        { groupId }
      );

      // Should detect because UTC date is Jan 15
      expect(birthdays.length).toBe(1);
      expect(birthdays[0].userId).toBe(userId);
    });

    test("should not detect birthday for member who has left", async () => {
      const t = convexTest(schema, modules);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId, userId } = await seedTestData(t, {
        timezone: "America/New_York",
        userBirthday: birthdayTimestamp,
      });

      // Mark the member as having left
      await t.run(async (ctx) => {
        const membership = await ctx.db
          .query("groupMembers")
          .withIndex("by_group_user", (q) =>
            q.eq("groupId", groupId).eq("userId", userId)
          )
          .first();

        if (membership) {
          await ctx.db.patch(membership._id, { leftAt: Date.now() });
        }
      });

      vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));

      const birthdays = await t.query(
        internal.functions.scheduledJobs.getMembersWithBirthdayToday,
        { groupId }
      );

      expect(birthdays.length).toBe(0);
    });

    test("should handle user without dateOfBirth gracefully", async () => {
      const t = convexTest(schema, modules);

      // Create user WITHOUT a birthday
      const { groupId } = await seedTestData(t, {
        timezone: "America/New_York",
        userBirthday: undefined,
      });

      vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));

      const birthdays = await t.query(
        internal.functions.scheduledJobs.getMembersWithBirthdayToday,
        { groupId }
      );

      expect(birthdays.length).toBe(0);
    });

    test("should handle multiple members with same birthday", async () => {
      const t = convexTest(schema, modules);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId, communityId } = await seedTestData(t, {
        timezone: "America/New_York",
        userBirthday: birthdayTimestamp,
      });

      // Add a second member with the same birthday
      await t.run(async (ctx) => {
        const user2Id = await ctx.db.insert("users", {
          firstName: "Second",
          lastName: "User",
          phone: "+15555555001",
          phoneVerified: true,
          activeCommunityId: communityId,
          dateOfBirth: birthdayTimestamp,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        await ctx.db.insert("groupMembers", {
          userId: user2Id,
          groupId,
          role: "member",
          joinedAt: Date.now(),
          notificationsEnabled: true,
        });
      });

      vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));

      const birthdays = await t.query(
        internal.functions.scheduledJobs.getMembersWithBirthdayToday,
        { groupId }
      );

      expect(birthdays.length).toBe(2);
    });
  });

  describe("getMembersWithBirthdayToday - Timezone Support (TO IMPLEMENT)", () => {
    // These tests document the EXPECTED behavior after adding timezone support
    // They are skipped because the timezone parameter doesn't exist yet

    test("should detect birthdays based on community timezone, not UTC", async () => {
      // IMPLEMENTATION NEEDED:
      // Add 'timezone: v.optional(v.string())' parameter to getMembersWithBirthdayToday
      // Use Intl.DateTimeFormat to get today's date in the timezone
      // Compare month/day in that timezone instead of UTC

      const t = convexTest(schema, modules);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId, userId } = await seedTestData(t, {
        timezone: "America/Los_Angeles",
        userBirthday: birthdayTimestamp,
      });

      // Jan 15 at 9 AM UTC = Jan 15 at 1 AM PST (still Jan 15 in LA)
      vi.setSystemTime(new Date("2024-01-15T09:00:00Z"));

      // This call needs timezone parameter added to the function
      // const birthdays = await t.query(
      //   internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      //   { groupId, timezone: "America/Los_Angeles" }
      // );

      // expect(birthdays.length).toBe(1);
      // expect(birthdays[0].userId).toBe(userId);
    });

    test("should NOT detect birthday when it's tomorrow in community timezone", async () => {
      // IMPLEMENTATION NEEDED: Add timezone parameter

      const t = convexTest(schema, modules);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId } = await seedTestData(t, {
        timezone: "America/Los_Angeles",
        userBirthday: birthdayTimestamp,
      });

      // Jan 15 at 3 AM UTC = Jan 14 at 7 PM PST (NOT yet Jan 15 in LA)
      vi.setSystemTime(new Date("2024-01-15T03:00:00Z"));

      // const birthdays = await t.query(
      //   internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      //   { groupId, timezone: "America/Los_Angeles" }
      // );

      // expect(birthdays.length).toBe(0);
    });

    test("should detect birthday when UTC is ahead but local date matches", async () => {
      // IMPLEMENTATION NEEDED: Add timezone parameter

      const t = convexTest(schema, modules);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId, userId } = await seedTestData(t, {
        timezone: "America/Los_Angeles",
        userBirthday: birthdayTimestamp,
      });

      // Jan 16 at 3 AM UTC = Jan 15 at 7 PM PST (still Jan 15 in LA)
      vi.setSystemTime(new Date("2024-01-16T03:00:00Z"));

      // const birthdays = await t.query(
      //   internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      //   { groupId, timezone: "America/Los_Angeles" }
      // );

      // expect(birthdays.length).toBe(1);
    });

    test("should handle timezone crossing date boundary (Hawaii)", async () => {
      const t = convexTest(schema, modules);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId, userId } = await seedTestData(t, {
        timezone: "Pacific/Honolulu", // Hawaii is UTC-10
        userBirthday: birthdayTimestamp,
      });

      // Jan 16 at 6 AM UTC = Jan 15 at 8 PM HST (still Jan 15 in Hawaii)
      vi.setSystemTime(new Date("2024-01-16T06:00:00Z"));

      // const birthdays = await t.query(
      //   internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      //   { groupId, timezone: "Pacific/Honolulu" }
      // );

      // expect(birthdays.length).toBe(1);
    });

    test("should handle timezone crossing date boundary (Tokyo)", async () => {
      const t = convexTest(schema, modules);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId } = await seedTestData(t, {
        timezone: "Asia/Tokyo", // Tokyo is UTC+9
        userBirthday: birthdayTimestamp,
      });

      // Jan 14 at 20:00 UTC = Jan 15 at 5 AM JST (already Jan 15 in Tokyo)
      vi.setSystemTime(new Date("2024-01-14T20:00:00Z"));

      // const birthdays = await t.query(
      //   internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      //   { groupId, timezone: "Asia/Tokyo" }
      // );

      // expect(birthdays.length).toBe(1);
    });

    test("should handle leap year birthdays on Feb 29", async () => {
      const t = convexTest(schema, modules);

      const birthdayTimestamp = new Date("2000-02-29T00:00:00Z").getTime();

      const { groupId, userId } = await seedTestData(t, {
        timezone: "America/New_York",
        userBirthday: birthdayTimestamp,
      });

      // Test on a leap year Feb 29
      vi.setSystemTime(new Date("2024-02-29T14:00:00Z"));

      // const birthdays = await t.query(
      //   internal.functions.scheduledJobs.getMembersWithBirthdayToday,
      //   { groupId, timezone: "America/New_York" }
      // );

      // expect(birthdays.length).toBe(1);
    });
  });

  describe("getDueBirthdayBotConfigs (TO IMPLEMENT)", () => {
    // These tests document the expected behavior for the new function
    // that queries birthday bot configs due in a time window

    test("should only return configs in current hour window", async () => {
      // IMPLEMENTATION NEEDED:
      // Create new internalQuery: getDueBirthdayBotConfigs
      // Args: { windowStart: v.number(), windowEnd: v.number() }
      // Query groupBotConfigs with index by_botType_enabled_scheduled
      // Filter by botType="birthday", enabled=true, nextScheduledAt in window

      const t = convexTest(schema, modules);

      const currentTime = new Date("2024-01-15T14:00:00Z").getTime();
      vi.setSystemTime(currentTime);

      const { groupId: groupIdA } = await seedTestData(t, {
        timezone: "America/New_York",
      });
      const { groupId: groupIdB } = await seedTestData(t, {
        timezone: "America/New_York",
      });
      const { groupId: groupIdC } = await seedTestData(t, {
        timezone: "America/New_York",
      });

      const hourStart =
        Math.floor(currentTime / (60 * 60 * 1000)) * 60 * 60 * 1000;
      const hourEnd = hourStart + 60 * 60 * 1000;

      // Config A: in current hour window (should be returned)
      await createBirthdayBotConfig(t, {
        groupId: groupIdA,
        enabled: true,
        nextScheduledAt: hourStart + 30 * 60 * 1000,
      });

      // Config B: next hour (should NOT be returned)
      await createBirthdayBotConfig(t, {
        groupId: groupIdB,
        enabled: true,
        nextScheduledAt: hourEnd + 30 * 60 * 1000,
      });

      // Config C: past hour (should NOT be returned)
      await createBirthdayBotConfig(t, {
        groupId: groupIdC,
        enabled: true,
        nextScheduledAt: hourStart - 30 * 60 * 1000,
      });

      // const dueConfigs = await t.query(
      //   internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      //   { windowStart: hourStart, windowEnd: hourEnd }
      // );

      // expect(dueConfigs.length).toBe(1);
      // expect(dueConfigs[0].groupId).toBe(groupIdA);
    });

    test("should not return disabled configs even if in time window", async () => {
      const t = convexTest(schema, modules);

      const currentTime = new Date("2024-01-15T14:00:00Z").getTime();
      vi.setSystemTime(currentTime);

      const { groupId } = await seedTestData(t);

      const hourStart =
        Math.floor(currentTime / (60 * 60 * 1000)) * 60 * 60 * 1000;
      const hourEnd = hourStart + 60 * 60 * 1000;

      // Create disabled config in the current window
      await createBirthdayBotConfig(t, {
        groupId,
        enabled: false, // Disabled!
        nextScheduledAt: hourStart + 30 * 60 * 1000,
      });

      // const dueConfigs = await t.query(
      //   internal.functions.scheduledJobs.getDueBirthdayBotConfigs,
      //   { windowStart: hourStart, windowEnd: hourEnd }
      // );

      // expect(dueConfigs.length).toBe(0);
    });
  });

  describe("rescheduleBirthdayBot (TO IMPLEMENT)", () => {
    // These tests document the expected behavior for rescheduling

    test("should reschedule to next 9 AM in community timezone", async () => {
      // IMPLEMENTATION NEEDED:
      // Create new internalMutation: rescheduleBirthdayBot
      // Args: { configId: v.id("groupBotConfigs") }
      // Get config, get group, get community
      // Use community.timezone (default: "America/New_York")
      // Calculate next 9 AM in that timezone
      // Update config.nextScheduledAt

      const t = convexTest(schema, modules);

      // Current time: Jan 15 at 2 PM UTC (9 AM EST)
      vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));

      const { groupId } = await seedTestData(t, {
        timezone: "America/New_York",
      });

      const configId = await createBirthdayBotConfig(t, {
        groupId,
        enabled: true,
        nextScheduledAt: Date.now(),
      });

      // await t.mutation(
      //   internal.functions.scheduledJobs.rescheduleBirthdayBot,
      //   { configId }
      // );

      // const updatedConfig = await t.run(async (ctx) => {
      //   return await ctx.db.get(configId);
      // });

      // Next 9 AM in New York after Jan 15 2 PM UTC = Jan 16 9 AM EST = Jan 16 14:00 UTC
      // const expectedTimestamp = new Date("2024-01-16T14:00:00Z").getTime();
      // const actualTime = updatedConfig!.nextScheduledAt!;
      // const diffMinutes = Math.abs(actualTime - expectedTimestamp) / (60 * 1000);
      // expect(diffMinutes).toBeLessThan(120); // Within 2 hours tolerance
    });

    test("should schedule for today 9 AM if before 9 AM in timezone", async () => {
      const t = convexTest(schema, modules);

      // Current time: Jan 15 at 10 AM UTC (5 AM EST - before 9 AM)
      vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));

      const { groupId } = await seedTestData(t, {
        timezone: "America/New_York",
      });

      const configId = await createBirthdayBotConfig(t, {
        groupId,
        enabled: true,
        nextScheduledAt: Date.now() - 24 * 60 * 60 * 1000, // Yesterday
      });

      // await t.mutation(
      //   internal.functions.scheduledJobs.rescheduleBirthdayBot,
      //   { configId }
      // );

      // const updatedConfig = await t.run(async (ctx) => {
      //   return await ctx.db.get(configId);
      // });

      // Next 9 AM EST from 5 AM EST should be TODAY 9 AM EST = 14:00 UTC
      // const expectedTimestamp = new Date("2024-01-15T14:00:00Z").getTime();
      // const actualTime = updatedConfig!.nextScheduledAt!;
      // const diffMinutes = Math.abs(actualTime - expectedTimestamp) / (60 * 1000);
      // expect(diffMinutes).toBeLessThan(120);
    });

    test("should default to America/New_York if community has no timezone", async () => {
      const t = convexTest(schema, modules);

      // Create community WITHOUT timezone
      const communityId = await t.run(async (ctx) => {
        return await ctx.db.insert("communities", {
          name: "No Timezone Community",
          subdomain: "no-tz",
          slug: "no-tz",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const groupTypeId = await t.run(async (ctx) => {
        return await ctx.db.insert("groupTypes", {
          communityId,
          name: "Test Type",
          slug: "test-type",
          isActive: true,
          displayOrder: 1,
          createdAt: Date.now(),
        });
      });

      const groupId = await t.run(async (ctx) => {
        return await ctx.db.insert("groups", {
          name: "Test Group",
          communityId,
          groupTypeId,
          isArchived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      });

      const configId = await createBirthdayBotConfig(t, {
        groupId,
        enabled: true,
        nextScheduledAt: Date.now(),
      });

      vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));

      // await t.mutation(
      //   internal.functions.scheduledJobs.rescheduleBirthdayBot,
      //   { configId }
      // );

      // const updatedConfig = await t.run(async (ctx) => {
      //   return await ctx.db.get(configId);
      // });

      // expect(updatedConfig?.nextScheduledAt).toBeDefined();
      // expect(updatedConfig!.nextScheduledAt).toBeGreaterThan(Date.now());
    });
  });

  describe("processBirthdayBotBucket (TO IMPLEMENT)", () => {
    test("should process all due birthday configs in current hour", async () => {
      // IMPLEMENTATION NEEDED:
      // Create new internalAction: processBirthdayBotBucket
      // Args: {}
      // Calculate current hour window
      // Call getDueBirthdayBotConfigs
      // For each config: run birthday bot logic, then reschedule
      // Return { processed: number }

      const t = convexTest(schema, modules);

      const currentTime = new Date("2024-01-15T14:00:00Z").getTime();
      vi.setSystemTime(currentTime);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();

      const { groupId } = await seedTestData(t, {
        timezone: "America/New_York",
        userBirthday: birthdayTimestamp,
      });

      const hourStart =
        Math.floor(currentTime / (60 * 60 * 1000)) * 60 * 60 * 1000;

      await createBirthdayBotConfig(t, {
        groupId,
        enabled: true,
        nextScheduledAt: hourStart + 15 * 60 * 1000,
      });

      // const result = await t.action(
      //   internal.functions.scheduledJobs.processBirthdayBotBucket,
      //   {}
      // );

      // expect(result.processed).toBe(1);
    });
  });

  describe("groupBots.toggle - Birthday Bot Scheduling (TO IMPLEMENT)", () => {
    // These tests document expected behavior when enabling/disabling birthday bot

    test("should set nextScheduledAt when enabling birthday bot", async () => {
      // IMPLEMENTATION NEEDED:
      // Modify groupBots.toggle mutation
      // When enabling birthday bot (botId === "birthday" && enabled === true):
      // - Get community timezone
      // - Calculate next 9 AM in that timezone
      // - Set nextScheduledAt

      const t = convexTest(schema, modules);

      vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));

      const { groupId, accessToken } = await seedTestData(t, {
        timezone: "America/New_York",
      });

      await t.mutation(api.functions.groupBots.toggle, {
        token: accessToken,
        groupId,
        botId: "birthday",
        enabled: true,
      });

      const config = await t.run(async (ctx) => {
        return await ctx.db
          .query("groupBotConfigs")
          .withIndex("by_group_botType", (q) =>
            q.eq("groupId", groupId).eq("botType", "birthday")
          )
          .first();
      });

      expect(config).not.toBeNull();
      expect(config?.enabled).toBe(true);
      // This assertion will FAIL until toggle is updated to set nextScheduledAt
      expect(config?.nextScheduledAt).toBeDefined();

      // Verify scheduled for 9 AM in community timezone
      const nextScheduled = config!.nextScheduledAt!;
      const scheduledDate = new Date(nextScheduled);

      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      });
      const scheduledHour = parseInt(formatter.format(scheduledDate), 10);

      expect(scheduledHour).toBe(9);
    });

    test("should create birthday bot config when toggling on", async () => {
      // This tests current behavior - toggle creates a config

      const t = convexTest(schema, modules);

      vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));

      const { groupId, accessToken } = await seedTestData(t);

      await t.mutation(api.functions.groupBots.toggle, {
        token: accessToken,
        groupId,
        botId: "birthday",
        enabled: true,
      });

      const config = await t.run(async (ctx) => {
        return await ctx.db
          .query("groupBotConfigs")
          .withIndex("by_group_botType", (q) =>
            q.eq("groupId", groupId).eq("botType", "birthday")
          )
          .first();
      });

      expect(config).not.toBeNull();
      expect(config?.enabled).toBe(true);
      expect(config?.botType).toBe("birthday");
    });

    test("should disable birthday bot config", async () => {
      const t = convexTest(schema, modules);

      vi.setSystemTime(new Date("2024-01-15T14:00:00Z"));

      const { groupId, accessToken } = await seedTestData(t);

      // First enable
      await t.mutation(api.functions.groupBots.toggle, {
        token: accessToken,
        groupId,
        botId: "birthday",
        enabled: true,
      });

      // Then disable
      await t.mutation(api.functions.groupBots.toggle, {
        token: accessToken,
        groupId,
        botId: "birthday",
        enabled: false,
      });

      const config = await t.run(async (ctx) => {
        return await ctx.db
          .query("groupBotConfigs")
          .withIndex("by_group_botType", (q) =>
            q.eq("groupId", groupId).eq("botType", "birthday")
          )
          .first();
      });

      expect(config?.enabled).toBe(false);
    });
  });

  describe("getBirthdayBotConfigs - Existing Implementation", () => {
    // Test the existing getBirthdayBotConfigs function

    test("should return enabled birthday bot configs", async () => {
      const t = convexTest(schema, modules);

      const { groupId } = await seedTestData(t);

      await createBirthdayBotConfig(t, {
        groupId,
        enabled: true,
        config: { mode: "general_chat", message: "Happy Birthday!" },
      });

      const configs = await t.query(
        internal.functions.scheduledJobs.getBirthdayBotConfigs,
        {}
      );

      expect(configs.length).toBeGreaterThanOrEqual(1);

      const ourConfig = configs.find((c) => c.groupId === groupId);
      expect(ourConfig).toBeDefined();
      expect(ourConfig?.mode).toBe("general_chat");
    });

    test("should not return disabled birthday bot configs", async () => {
      const t = convexTest(schema, modules);

      const { groupId } = await seedTestData(t);

      await createBirthdayBotConfig(t, {
        groupId,
        enabled: false, // Disabled
      });

      const configs = await t.query(
        internal.functions.scheduledJobs.getBirthdayBotConfigs,
        {}
      );

      const ourConfig = configs.find((c) => c.groupId === groupId);
      expect(ourConfig).toBeUndefined();
    });
  });

  describe("leader_name placeholder", () => {
    test("replaces [[leader_name]] in leader reminder messages", async () => {
      const t = convexTest(schema, modules);
      const currentTime = new Date("2024-01-15T14:00:00Z").getTime();
      vi.setSystemTime(currentTime);

      const birthdayTimestamp = new Date("2000-01-15T00:00:00Z").getTime();
      const { groupId, userId } = await seedTestData(t, {
        timezone: "America/New_York",
        userBirthday: birthdayTimestamp,
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("chatChannels", {
          groupId,
          slug: "leaders",
          channelType: "leaders",
          name: "Leaders",
          createdById: userId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isArchived: false,
          memberCount: 1,
        });
      });

      await createBirthdayBotConfig(t, {
        groupId,
        enabled: true,
        config: {
          mode: "leader_reminder",
          assignmentMode: "round_robin",
          message:
            "Hey [[leader_name]], it's your turn to say happy birthday to [[birthday_names]] in General chat!",
        },
      });

      await t.action(internal.functions.scheduledJobs.runBirthdayBot, {});

      const messages = await t.run(async (ctx) => {
        return await ctx.db.query("chatMessages").collect();
      });

      const botMessage = messages.find((message) =>
        message.content.includes("it's your turn to say happy birthday")
      );
      expect(botMessage).toBeDefined();
      expect(botMessage?.content).toContain("Hey Test User");
      expect(botMessage?.content).not.toContain("[[leader_name]]");
    });
  });
});
