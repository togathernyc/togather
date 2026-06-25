/**
 * Tests for per-thread notification control.
 *
 * Covers the pure recipient-routing helper (`decideRecipientBucket`) and the
 * `getThreadSubscription` / `setThreadSubscription` functions.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import { decideRecipientBucket } from "../../functions/messaging/events";
import type { Id } from "../../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// decideRecipientBucket — recipient routing rules
// ============================================================================

describe("decideRecipientBucket", () => {
  test("top-level messages notify everyone (mention vs regular)", () => {
    expect(decideRecipientBucket({ isMentioned: true, isReply: false })).toBe(
      "mention",
    );
    expect(decideRecipientBucket({ isMentioned: false, isReply: false })).toBe(
      "regular",
    );
  });

  test("thread replies default to mentions only", () => {
    // Mentioned member still gets a mention notification.
    expect(decideRecipientBucket({ isMentioned: true, isReply: true })).toBe(
      "mention",
    );
    // Non-mentioned member is skipped by default.
    expect(decideRecipientBucket({ isMentioned: false, isReply: true })).toBe(
      "skip",
    );
  });

  test("'all' subscribers are notified about every reply", () => {
    expect(
      decideRecipientBucket({
        isMentioned: false,
        isReply: true,
        threadState: "all",
      }),
    ).toBe("regular");
    expect(
      decideRecipientBucket({
        isMentioned: true,
        isReply: true,
        threadState: "all",
      }),
    ).toBe("mention");
  });

  test("'none' subscribers are never notified, even when mentioned", () => {
    expect(
      decideRecipientBucket({
        isMentioned: false,
        isReply: true,
        threadState: "none",
      }),
    ).toBe("skip");
    expect(
      decideRecipientBucket({
        isMentioned: true,
        isReply: true,
        threadState: "none",
      }),
    ).toBe("skip");
  });

  test("thread state does not affect top-level messages", () => {
    expect(
      decideRecipientBucket({
        isMentioned: false,
        isReply: false,
        threadState: "none",
      }),
    ).toBe("regular");
  });
});

// ============================================================================
// getThreadSubscription / setThreadSubscription
// ============================================================================

interface ThreadTestData {
  userId: Id<"users">;
  channelId: Id<"chatChannels">;
  threadId: Id<"chatMessages">;
  accessToken: string;
}

async function seedThreadData(
  t: ReturnType<typeof convexTest>,
): Promise<ThreadTestData> {
  const communityId = await t.run(async (ctx) =>
    ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

  const channelId = await t.run(async (ctx) =>
    ctx.db.insert("chatChannels", {
      communityId,
      channelType: "main",
      name: "General",
      slug: "general",
      createdById: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      memberCount: 1,
    }),
  );

  await t.run(async (ctx) => {
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId,
      role: "admin",
      joinedAt: Date.now(),
      isMuted: false,
    });
  });

  const threadId = await t.run(async (ctx) =>
    ctx.db.insert("chatMessages", {
      channelId,
      senderId: userId,
      content: "Parent message",
      contentType: "text",
      createdAt: Date.now(),
      isDeleted: false,
    }),
  );

  const { accessToken } = await generateTokens(userId);
  return { userId, channelId, threadId, accessToken };
}

describe("thread subscription functions", () => {
  test("defaults to 'default' when no preference is stored", async () => {
    const t = convexTest(schema, modules);
    const { threadId, accessToken } = await seedThreadData(t);

    const result = await t.query(
      api.functions.messaging.threadSubscriptions.getThreadSubscription,
      { token: accessToken, threadId },
    );

    expect(result.state).toBe("default");
  });

  test("set and read back an 'all' preference", async () => {
    const t = convexTest(schema, modules);
    const { threadId, accessToken } = await seedThreadData(t);

    await t.mutation(
      api.functions.messaging.threadSubscriptions.setThreadSubscription,
      { token: accessToken, threadId, state: "all" },
    );

    const result = await t.query(
      api.functions.messaging.threadSubscriptions.getThreadSubscription,
      { token: accessToken, threadId },
    );
    expect(result.state).toBe("all");
  });

  test("setting 'default' clears a stored preference", async () => {
    const t = convexTest(schema, modules);
    const { threadId, accessToken } = await seedThreadData(t);

    await t.mutation(
      api.functions.messaging.threadSubscriptions.setThreadSubscription,
      { token: accessToken, threadId, state: "none" },
    );
    await t.mutation(
      api.functions.messaging.threadSubscriptions.setThreadSubscription,
      { token: accessToken, threadId, state: "default" },
    );

    const result = await t.query(
      api.functions.messaging.threadSubscriptions.getThreadSubscription,
      { token: accessToken, threadId },
    );
    expect(result.state).toBe("default");

    // No row should remain in the table.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("chatThreadSubscriptions")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect(),
    );
    expect(rows).toHaveLength(0);
  });

  test("updating an existing preference overwrites it (no duplicate rows)", async () => {
    const t = convexTest(schema, modules);
    const { threadId, accessToken } = await seedThreadData(t);

    await t.mutation(
      api.functions.messaging.threadSubscriptions.setThreadSubscription,
      { token: accessToken, threadId, state: "all" },
    );
    await t.mutation(
      api.functions.messaging.threadSubscriptions.setThreadSubscription,
      { token: accessToken, threadId, state: "none" },
    );

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("chatThreadSubscriptions")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("none");
  });

  test("non-members cannot set a preference", async () => {
    const t = convexTest(schema, modules);
    const { threadId } = await seedThreadData(t);

    const outsiderId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        firstName: "Out",
        lastName: "Sider",
        phone: "+15555550002",
        phoneVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const { accessToken: outsiderToken } = await generateTokens(outsiderId);

    await expect(
      t.mutation(
        api.functions.messaging.threadSubscriptions.setThreadSubscription,
        { token: outsiderToken, threadId, state: "all" },
      ),
    ).rejects.toThrow();
  });
});
