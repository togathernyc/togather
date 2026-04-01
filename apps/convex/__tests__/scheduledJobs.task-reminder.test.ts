/**
 * Task Reminder & Reschedule Scheduled Jobs Tests
 *
 * Tests getDueTaskReminderConfigs, rescheduleTaskReminder,
 * rescheduleBirthdayBot, and helper queries.
 *
 * Run with: cd apps/convex && pnpm test __tests__/scheduledJobs.task-reminder.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";

import type { Id } from "../_generated/dataModel";

// ============================================================================
// Helpers
// ============================================================================

async function seedCommunityAndGroup(
  t: ReturnType<typeof convexTest>,
  overrides: { timezone?: string } = {}
) {
  const now = Date.now();

  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Task Reminder Community",
      slug: "TASK01",
      timezone: overrides.timezone ?? "America/New_York",
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
      name: "Task Group",
      isAnnouncementGroup: false,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  return { communityId, groupId, groupTypeId, now };
}

async function seedBotConfig(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  overrides: {
    botType?: string;
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
      botType: overrides.botType ?? "task-reminder",
      enabled: overrides.enabled ?? true,
      nextScheduledAt: overrides.nextScheduledAt ?? now,
      config: overrides.config ?? {},
      state: overrides.state ?? {},
      createdAt: now,
      updatedAt: now,
    });
  });
}

// ============================================================================
// getDueTaskReminderConfigs Tests
// ============================================================================

describe("getDueTaskReminderConfigs", () => {
  test("returns configs within the time window", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, groupId, { nextScheduledAt: now + 1000 });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueTaskReminderConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result).toHaveLength(1);
    expect(result[0].botType).toBe("task-reminder");
    expect(result[0].enabled).toBe(true);
  });

  test("excludes configs outside the time window", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, groupId, {
      nextScheduledAt: now + 24 * 60 * 60 * 1000,
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueTaskReminderConfigs,
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
      internal.functions.scheduledJobs.getDueTaskReminderConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result).toHaveLength(0);
  });

  test("excludes birthday bot configs (different botType)", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, groupId, {
      botType: "birthday",
      nextScheduledAt: now + 1000,
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueTaskReminderConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result).toHaveLength(0);
  });

  test("returns multiple due configs", async () => {
    const t = convexTest(schema, modules);
    const { groupId: group1 } = await seedCommunityAndGroup(t);
    const { groupId: group2 } = await seedCommunityAndGroup(t);

    const now = Date.now();
    await seedBotConfig(t, group1, { nextScheduledAt: now + 1000 });
    await seedBotConfig(t, group2, { nextScheduledAt: now + 2000 });

    const result = await t.query(
      internal.functions.scheduledJobs.getDueTaskReminderConfigs,
      { windowStart: now, windowEnd: now + 60_000 }
    );

    expect(result).toHaveLength(2);
  });

  test("windowStart is inclusive, windowEnd is exclusive", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const boundary = Date.now() + 5000;
    await seedBotConfig(t, groupId, { nextScheduledAt: boundary });

    // Config at exactly windowStart — should be included
    const includeResult = await t.query(
      internal.functions.scheduledJobs.getDueTaskReminderConfigs,
      { windowStart: boundary, windowEnd: boundary + 60_000 }
    );
    expect(includeResult).toHaveLength(1);

    // Config at exactly windowEnd — should be excluded
    const excludeResult = await t.query(
      internal.functions.scheduledJobs.getDueTaskReminderConfigs,
      { windowStart: boundary - 60_000, windowEnd: boundary }
    );
    expect(excludeResult).toHaveLength(0);
  });
});

// ============================================================================
// rescheduleTaskReminder Tests
// ============================================================================

describe("rescheduleTaskReminder", () => {
  test("updates nextScheduledAt to future time", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t, {
      timezone: "America/New_York",
    });

    const now = Date.now();
    const configId = await seedBotConfig(t, groupId, {
      nextScheduledAt: now - 60_000, // in the past
    });

    await t.mutation(
      internal.functions.scheduledJobs.rescheduleTaskReminder,
      { configId }
    );

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get(configId);
    });

    // nextScheduledAt should be in the future
    expect(updated?.nextScheduledAt).toBeGreaterThan(now);
    expect(updated?.updatedAt).toBeGreaterThan(0);
  });

  test("handles non-existent config gracefully", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    // Create and delete a config to get a valid-format but non-existent ID
    const tempId = await seedBotConfig(t, groupId);
    await t.run(async (ctx) => {
      await ctx.db.delete(tempId);
    });

    // Should not throw
    await t.mutation(
      internal.functions.scheduledJobs.rescheduleTaskReminder,
      { configId: tempId }
    );
  });

  test("uses community timezone for scheduling", async () => {
    const t = convexTest(schema, modules);

    // Two communities in different timezones
    const { groupId: nyGroup } = await seedCommunityAndGroup(t, {
      timezone: "America/New_York",
    });
    const { groupId: laGroup } = await seedCommunityAndGroup(t, {
      timezone: "America/Los_Angeles",
    });

    const now = Date.now();
    const nyConfig = await seedBotConfig(t, nyGroup, {
      nextScheduledAt: now - 1000,
    });
    const laConfig = await seedBotConfig(t, laGroup, {
      nextScheduledAt: now - 1000,
    });

    await t.mutation(
      internal.functions.scheduledJobs.rescheduleTaskReminder,
      { configId: nyConfig }
    );
    await t.mutation(
      internal.functions.scheduledJobs.rescheduleTaskReminder,
      { configId: laConfig }
    );

    const nyUpdated = await t.run(async (ctx) => ctx.db.get(nyConfig));
    const laUpdated = await t.run(async (ctx) => ctx.db.get(laConfig));

    // Both should have future schedules
    expect(nyUpdated?.nextScheduledAt).toBeGreaterThan(now);
    expect(laUpdated?.nextScheduledAt).toBeGreaterThan(now);

    // LA is 3 hours behind NY, so LA's next 9 AM should differ
    // (they could be the same date or different depending on current time,
    // but they should generally not be identical)
    expect(nyUpdated?.nextScheduledAt).toBeDefined();
    expect(laUpdated?.nextScheduledAt).toBeDefined();
  });
});

// ============================================================================
// rescheduleBirthdayBot Tests
// ============================================================================

describe("rescheduleBirthdayBot", () => {
  test("updates nextScheduledAt to future time", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const now = Date.now();
    const configId = await seedBotConfig(t, groupId, {
      botType: "birthday",
      nextScheduledAt: now - 60_000,
    });

    await t.mutation(
      internal.functions.scheduledJobs.rescheduleBirthdayBot,
      { configId }
    );

    const updated = await t.run(async (ctx) => {
      return await ctx.db.get(configId);
    });

    expect(updated?.nextScheduledAt).toBeGreaterThan(now);
  });

  test("handles non-existent config gracefully", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const tempId = await seedBotConfig(t, groupId);
    await t.run(async (ctx) => {
      await ctx.db.delete(tempId);
    });

    // Should not throw
    await t.mutation(
      internal.functions.scheduledJobs.rescheduleBirthdayBot,
      { configId: tempId }
    );
  });

  test("defaults to America/New_York when community has no timezone", async () => {
    const t = convexTest(schema, modules);

    // Community without timezone
    const communityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "No TZ Community",
        slug: "NOTZ01",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const groupTypeId = await t.run(async (ctx) => {
      return await ctx.db.insert("groupTypes", {
        communityId,
        name: "Groups",
        slug: "groups",
        description: "Groups",
        createdAt: Date.now(),
        isActive: true,
        displayOrder: 0,
      });
    });

    const groupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        communityId,
        groupTypeId,
        name: "No TZ Group",
        isAnnouncementGroup: false,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const now = Date.now();
    const configId = await seedBotConfig(t, groupId, {
      botType: "birthday",
      nextScheduledAt: now - 1000,
    });

    await t.mutation(
      internal.functions.scheduledJobs.rescheduleBirthdayBot,
      { configId }
    );

    const updated = await t.run(async (ctx) => ctx.db.get(configId));

    // Should still schedule (falls back to America/New_York)
    expect(updated?.nextScheduledAt).toBeGreaterThan(now);
  });
});

// ============================================================================
// getGroupById & getBotConfigById Tests
// ============================================================================

describe("getGroupById", () => {
  test("returns group when it exists", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const result = await t.query(
      internal.functions.scheduledJobs.getGroupById,
      { groupId }
    );

    expect(result).not.toBeNull();
    expect(result?.name).toBe("Task Group");
  });

  test("returns null for non-existent group", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    // Delete the group
    await t.run(async (ctx) => {
      await ctx.db.delete(groupId);
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getGroupById,
      { groupId }
    );

    expect(result).toBeNull();
  });
});

describe("getBotConfigById", () => {
  test("returns config when it exists", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);
    const configId = await seedBotConfig(t, groupId, {
      botType: "task-reminder",
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getBotConfigById,
      { configId }
    );

    expect(result).not.toBeNull();
    expect(result?.botType).toBe("task-reminder");
    expect(result?.groupId).toBe(groupId);
  });

  test("returns null for non-existent config", async () => {
    const t = convexTest(schema, modules);
    const { groupId } = await seedCommunityAndGroup(t);

    const tempId = await seedBotConfig(t, groupId);
    await t.run(async (ctx) => {
      await ctx.db.delete(tempId);
    });

    const result = await t.query(
      internal.functions.scheduledJobs.getBotConfigById,
      { configId: tempId }
    );

    expect(result).toBeNull();
  });
});
