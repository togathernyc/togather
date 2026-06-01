/**
 * Tests for scheduledJobs.sendBotMessage suppression when General is disabled.
 *
 * General (the `main`/"general" channel) is now optional. When a bot/scheduled
 * message targets a channel that is missing or inactive (archived or
 * leader-disabled), sendBotMessage SUPPRESSES it silently — returning
 * `{ success: false, skipped: true, reason: "target channel inactive" }`
 * and inserting NO message — instead of erroring (which callers would log as a
 * failure).
 *
 * The happy path enqueues `ctx.scheduler.runAfter(0, onMessageSent)`, so the
 * scheduled-function drain pattern is required.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

// The happy path enqueues `ctx.scheduler.runAfter(0, onMessageSent)`.
// `finishInProgressScheduledFunctions()` only awaits jobs already running, so
// it leaves that pending runAfter(0) chain to fire after the test's transaction
// closes ("Write outside of transaction") once the fork is reused — drain it
// fully with `finishAllScheduledFunctions(vi.runAllTimers)` instead.
let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishAllScheduledFunctions(vi.runAllTimers);
    activeHandle = null;
  }
  vi.clearAllTimers();
});

async function seedGroup(t: ReturnType<typeof convexTest>): Promise<{
  groupId: Id<"groups">;
  userId: Id<"users">;
}> {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-bot-suppression",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "General",
      slug: "general",
      isActive: true,
      displayOrder: 0,
      createdAt: now,
    });
    const groupId = await ctx.db.insert("groups", {
      communityId,
      name: "Test Group",
      groupTypeId,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });
    const userId = await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555550001",
      createdAt: now,
      updatedAt: now,
    });
    return { groupId, userId };
  });
}

async function addGeneral(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  userId: Id<"users">,
  opts: { isArchived?: boolean; isEnabled?: boolean } = {},
): Promise<Id<"chatChannels">> {
  const now = Date.now();
  return await t.run((ctx) =>
    ctx.db.insert("chatChannels", {
      groupId,
      slug: "general",
      channelType: "main",
      name: "General",
      createdById: userId,
      createdAt: now,
      updatedAt: now,
      isArchived: opts.isArchived ?? false,
      isEnabled: opts.isEnabled,
      memberCount: 1,
    }),
  );
}

describe("sendBotMessage suppression", () => {
  test("skips (no error, no message) when General is archived", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { groupId, userId } = await seedGroup(t);
    const channelId = await addGeneral(t, groupId, userId, { isArchived: true });

    const result = await t.action(internal.functions.scheduledJobs.sendBotMessage, {
      groupId,
      message: "Happy birthday!",
      targetChannelSlug: "general",
      botType: "birthday",
    });

    expect(result).toEqual({
      success: false,
      skipped: true,
      reason: "target channel inactive",
    });

    // No message inserted into the archived channel.
    const messages = await t.run((ctx) =>
      ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(messages).toHaveLength(0);
  });

  test("skips when General is leader-disabled (isEnabled false)", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { groupId, userId } = await seedGroup(t);
    const channelId = await addGeneral(t, groupId, userId, { isEnabled: false });

    const result = await t.action(internal.functions.scheduledJobs.sendBotMessage, {
      groupId,
      message: "Reminder",
      targetChannelSlug: "general",
      botType: "task_reminder",
    });

    expect(result).toMatchObject({ success: false, skipped: true });
    const messages = await t.run((ctx) =>
      ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(messages).toHaveLength(0);
  });

  test("happy path still posts when General is active", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { groupId, userId } = await seedGroup(t);
    const channelId = await addGeneral(t, groupId, userId);

    const result = await t.action(internal.functions.scheduledJobs.sendBotMessage, {
      groupId,
      message: "Welcome!",
      targetChannelSlug: "general",
      botType: "welcome",
    });

    expect(result.success).toBe(true);
    const messages = await t.run((ctx) =>
      ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    );
    expect(messages).toHaveLength(1);
  });
});
