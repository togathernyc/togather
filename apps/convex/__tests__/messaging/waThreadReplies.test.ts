/**
 * `getMessages({ waReplies: true })` — the WhatsApp-shell reply/thread
 * activation rule, server side.
 *
 * The rule under test:
 *   - a reply is ADMITTED to the timeline while it is its parent's only live
 *     reply, carrying `replyQuote` (the in-bubble quoted-parent context);
 *   - once a parent has TWO or more live replies, every one of them drops out
 *     and the parent carries a single `threadSummary`;
 *   - omitting `waReplies` (flag-off) keeps the old behaviour exactly: no
 *     replies in the timeline, no decoration on any row.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

afterEach(() => {
  vi.useRealTimers();
});

interface TestData {
  userId: Id<"users">;
  otherUserId: Id<"users">;
  channelId: Id<"chatChannels">;
  accessToken: string;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<TestData> {
  const now = Date.now();

  const communityId = await t.run((ctx) =>
    ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    }),
  );

  const groupTypeId = await t.run((ctx) =>
    ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      displayOrder: 1,
      createdAt: now,
    }),
  );

  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      firstName: "Ada",
      lastName: "Nwosu",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const otherUserId = await t.run((ctx) =>
    ctx.db.insert("users", {
      firstName: "Dara",
      lastName: "Peters",
      phone: "+15555550002",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const groupId = await t.run((ctx) =>
    ctx.db.insert("groups", {
      name: "Test Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }),
  );

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });
  });

  const channelId = await t.run((ctx) =>
    ctx.db.insert("chatChannels", {
      groupId,
      channelType: "main",
      name: "General",
      slug: "general",
      createdById: userId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 1,
    }),
  );

  await t.run(async (ctx) => {
    await ctx.db.insert("chatChannelMembers", {
      channelId,
      userId,
      role: "admin",
      joinedAt: now,
      isMuted: false,
    });
  });

  const { accessToken } = await generateTokens(userId);
  return { userId, otherUserId, channelId, accessToken };
}

/** Insert a message directly so tests control `createdAt` ordering exactly. */
async function insertMessage(
  t: ReturnType<typeof convexTest>,
  opts: {
    channelId: Id<"chatChannels">;
    senderId: Id<"users">;
    content: string;
    createdAt: number;
    parentMessageId?: Id<"chatMessages">;
    isDeleted?: boolean;
    senderName?: string;
    attachments?: Array<{ type: string; url: string }>;
  },
): Promise<Id<"chatMessages">> {
  const id = await t.run((ctx) =>
    ctx.db.insert("chatMessages", {
      channelId: opts.channelId,
      senderId: opts.senderId,
      content: opts.content,
      contentType: "text",
      createdAt: opts.createdAt,
      isDeleted: opts.isDeleted ?? false,
      senderName: opts.senderName ?? "Ada Nwosu",
      parentMessageId: opts.parentMessageId,
      attachments: opts.attachments,
      ...(opts.parentMessageId ? {} : { lastActivityAt: opts.createdAt }),
    }),
  );
  // Mirror `sendMessage`'s parent bookkeeping.
  if (opts.parentMessageId && !opts.isDeleted) {
    const parentId = opts.parentMessageId;
    await t.run(async (ctx) => {
      const parent = await ctx.db.get(parentId);
      if (parent) {
        await ctx.db.patch(parentId, {
          threadReplyCount: (parent.threadReplyCount ?? 0) + 1,
          lastActivityAt: opts.createdAt,
        });
      }
    });
  }
  return id;
}

const T0 = 1_700_000_000_000;

describe("getMessages waReplies — activation rule", () => {
  test("a lone reply renders in the timeline with its parent quoted", async () => {
    const t = convexTest(schema, modules);
    const { channelId, otherUserId, userId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: otherUserId,
      senderName: "Dara Peters",
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    const replyId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "I've got them",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });

    expect(page.messages.map((m: any) => m._id)).toEqual([parentId, replyId]);

    const reply = page.messages.find((m: any) => m._id === replyId) as any;
    expect(reply.replyQuote).toMatchObject({
      parentMessageId: parentId,
      parentDeleted: false,
      parentSenderId: otherUserId,
      parentContent: "Who is bringing the chairs?",
    });
    // Live-resolved from `users`, not the message's snapshot.
    expect(reply.replyQuote.parentSenderName).toBe("Dara Peters");

    // One reply is NOT "more in the conversation" — no pill on the parent.
    const parent = page.messages.find((m: any) => m._id === parentId) as any;
    expect(parent.threadSummary).toBeUndefined();
  });

  test("a second reply collapses BOTH replies out and summarises the parent", async () => {
    const t = convexTest(schema, modules);
    const { channelId, otherUserId, userId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    await insertMessage(t, {
      channelId,
      senderId: otherUserId,
      senderName: "Dara Peters",
      content: "I've got them",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });
    await insertMessage(t, {
      channelId,
      senderId: otherUserId,
      senderName: "Dara Peters",
      content: "Actually, six of them",
      createdAt: T0 + 2000,
      parentMessageId: parentId,
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });

    expect(page.messages.map((m: any) => m._id)).toEqual([parentId]);
    const parent = page.messages[0] as any;
    expect(parent.threadSummary.replyCount).toBe(2);
    expect(parent.threadSummary.lastReplyAt).toBe(T0 + 2000);
    // Repliers are deduplicated — one person replying twice is one avatar.
    expect(parent.threadSummary.repliers).toHaveLength(1);
    expect(parent.threadSummary.repliers[0]).toMatchObject({
      userId: otherUserId,
      name: "Dara Peters",
    });
  });

  test("repliers are capped at three, newest first", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Roll call",
      createdAt: T0,
    });

    const replierIds: Id<"users">[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await t.run((ctx) =>
        ctx.db.insert("users", {
          firstName: `Replier${i}`,
          lastName: "X",
          phone: `+1555666000${i}`,
          phoneVerified: true,
          createdAt: T0,
          updatedAt: T0,
        }),
      );
      replierIds.push(id);
      await insertMessage(t, {
        channelId,
        senderId: id,
        content: `me ${i}`,
        createdAt: T0 + 1000 * (i + 1),
        parentMessageId: parentId,
      });
    }

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    const summary = (page.messages[0] as any).threadSummary;
    expect(summary.replyCount).toBe(5);
    expect(summary.repliers.map((r: any) => r.userId)).toEqual([
      replierIds[4],
      replierIds[3],
      replierIds[2],
    ]);
  });

  test("deleting one of two replies re-admits the survivor to the timeline", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    const firstReplyId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "I've got them",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });
    const secondReplyId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "no wait",
      createdAt: T0 + 2000,
      parentMessageId: parentId,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(secondReplyId, { isDeleted: true });
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });

    // `threadReplyCount` still says 2 (it is never decremented), but the live
    // probe says 1, so the survivor renders inline and the pill is gone.
    expect(page.messages.map((m: any) => m._id)).toEqual([parentId, firstReplyId]);
    expect((page.messages[0] as any).threadSummary).toBeUndefined();
  });

  test("all replies deleted → no pill and no reply rows", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Anyone?",
      createdAt: T0,
    });
    const replyId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "nope",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(replyId, { isDeleted: true });
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect(page.messages.map((m: any) => m._id)).toEqual([parentId]);
    expect((page.messages[0] as any).threadSummary).toBeUndefined();
  });

  test("a lone reply to a DELETED parent still renders, quoted as deleted", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    const replyId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "I've got them",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(parentId, { isDeleted: true });
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });

    // The parent is gone from the timeline (deleted), but the orphaned reply is
    // not silently swallowed the way the old ghost-only model swallowed it.
    expect(page.messages.map((m: any) => m._id)).toEqual([replyId]);
    expect((page.messages[0] as any).replyQuote).toMatchObject({
      parentDeleted: true,
      parentContent: "",
    });
  });

  test("a media parent's quote carries its first attachment type", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "",
      createdAt: T0,
      attachments: [{ type: "image", url: "uploads/chairs.jpg" }],
    });
    await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "nice",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    const reply = page.messages.find((m: any) => m.parentMessageId) as any;
    expect(reply.replyQuote.parentAttachmentType).toBe("image");
  });

  test("unread hint ignores your own replies", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, otherUserId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "mine one",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });
    await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "mine two",
      createdAt: T0 + 2000,
      parentMessageId: parentId,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("chatReadState", {
        channelId,
        userId,
        lastReadAt: T0 + 500,
        unreadCount: 0,
      });
    });

    let page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect((page.messages[0] as any).threadSummary.hasUnread).toBe(false);

    // Someone else replies after your last read → unread.
    await insertMessage(t, {
      channelId,
      senderId: otherUserId,
      senderName: "Dara Peters",
      content: "theirs",
      createdAt: T0 + 3000,
      parentMessageId: parentId,
    });
    page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect((page.messages[0] as any).threadSummary.hasUnread).toBe(true);
  });
});

describe("getMessages waReplies — flag-off is unchanged", () => {
  test("omitting waReplies keeps replies out and adds no decoration", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "I've got them",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
    });

    expect(page.messages.map((m: any) => m._id)).toEqual([parentId]);
    const parent = page.messages[0] as any;
    expect(parent.threadSummary).toBeUndefined();
    expect(parent.replyQuote).toBeUndefined();
    // The old model's own signals are untouched for the flag-off ghost.
    expect(parent.threadReplyCount).toBe(1);
    expect(parent.lastActivityAt).toBe(T0 + 1000);
  });
});
