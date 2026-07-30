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
import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
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
  return { userId, otherUserId, groupId, channelId, accessToken };
}

/** A second channel in the same group, for the cross-channel leak tests. */
async function seedSecondChannel(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  userId: Id<"users">,
): Promise<Id<"chatChannels">> {
  const now = Date.now();
  const channelId = await t.run((ctx) =>
    ctx.db.insert("chatChannels", {
      groupId,
      channelType: "custom",
      name: "Logistics",
      slug: "logistics",
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
  return channelId;
}

/** Make `blockerId` block `blockedId`, as the block mutation would. */
async function block(
  t: ReturnType<typeof convexTest>,
  blockerId: Id<"users">,
  blockedId: Id<"users">,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("chatUserBlocks", {
      blockerId,
      blockedId,
      createdAt: Date.now(),
    });
  });
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
    attachments?: Array<{ type: string; url: string; thumbnailUrl?: string }>;
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

describe("getMessages waReplies — a thread never crosses channels", () => {
  test("sendMessage refuses a parent that lives in another channel", async () => {
    const t = convexTest(schema, modules);
    const { channelId, groupId, userId, accessToken } = await seed(t);
    const otherChannelId = await seedSecondChannel(t, groupId, userId);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "secret in #general",
      createdAt: T0,
    });

    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: accessToken,
        channelId: otherChannelId,
        content: "leak me",
        parentMessageId: parentId,
      }),
    ).rejects.toThrow(/another channel/i);
  });

  test("a pre-existing cross-channel reply quotes as deleted, leaking nothing", async () => {
    const t = convexTest(schema, modules);
    const { channelId, groupId, userId, otherUserId, accessToken } = await seed(t);
    const otherChannelId = await seedSecondChannel(t, groupId, userId);

    // Written directly, as a row predating the sendMessage guard would be.
    const parentId = await insertMessage(t, {
      channelId,
      senderId: otherUserId,
      senderName: "Dara Peters",
      content: "confidential from #general",
      createdAt: T0,
    });
    const replyId = await insertMessage(t, {
      channelId: otherChannelId,
      senderId: userId,
      content: "leaked?",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId: otherChannelId,
      waReplies: true,
    });

    const reply = page.messages.find((m: any) => m._id === replyId) as any;
    expect(reply.replyQuote.parentDeleted).toBe(true);
    // The whole point: no author, no text from the other channel.
    expect(reply.replyQuote.parentContent).toBe("");
    expect(reply.replyQuote.parentSenderId).toBeUndefined();
    expect(reply.replyQuote.parentSenderName).toBeUndefined();
  });

  test("a cross-channel reply never counts toward the parent's own thread", async () => {
    const t = convexTest(schema, modules);
    const { channelId, groupId, userId, accessToken } = await seed(t);
    const otherChannelId = await seedSecondChannel(t, groupId, userId);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    const sameChannelReplyId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "I've got them",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });
    // A stray reply from the OTHER channel would otherwise tip this thread to
    // two and collapse the legitimate reply out of #general.
    await insertMessage(t, {
      channelId: otherChannelId,
      senderId: userId,
      content: "stray",
      createdAt: T0 + 2000,
      parentMessageId: parentId,
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });

    expect(page.messages.map((m: any) => m._id)).toEqual([
      parentId,
      sameChannelReplyId,
    ]);
    expect((page.messages[0] as any).threadSummary).toBeUndefined();
  });
});

describe("getMessages waReplies — blocked authors are invisible in threads too", () => {
  test("a blocked author is excluded from the summary count and avatars", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, otherUserId, accessToken } = await seed(t);

    const blockedId = await t.run((ctx) =>
      ctx.db.insert("users", {
        firstName: "Blocked",
        lastName: "Person",
        phone: "+15555559999",
        phoneVerified: true,
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    await block(t, userId, blockedId);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    for (const [i, sender] of [otherUserId, otherUserId, blockedId].entries()) {
      await insertMessage(t, {
        channelId,
        senderId: sender,
        senderName: sender === blockedId ? "Blocked Person" : "Dara Peters",
        content: `r${i}`,
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

    // 3 replies were sent; you can see 2 of them.
    expect(summary.replyCount).toBe(2);
    expect(summary.repliers.map((r: any) => r.userId)).toEqual([otherUserId]);
    // The blocked reply was the newest — the last-reply time must not be theirs.
    expect(summary.lastReplyAt).toBe(T0 + 2000);
  });

  test("a lone reply from a blocked author renders neither a row nor a pill", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const blockedId = await t.run((ctx) =>
      ctx.db.insert("users", {
        firstName: "Blocked",
        lastName: "Person",
        phone: "+15555559999",
        phoneVerified: true,
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    await block(t, userId, blockedId);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    await insertMessage(t, {
      channelId,
      senderId: blockedId,
      senderName: "Blocked Person",
      content: "you can't see this",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });

    // Exactly the disappearance their ordinary messages get.
    expect(page.messages.map((m: any) => m._id)).toEqual([parentId]);
    expect((page.messages[0] as any).threadSummary).toBeUndefined();
  });

  test("blocking one of two repliers drops the thread back to an inline reply", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, otherUserId, accessToken } = await seed(t);

    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "Who is bringing the chairs?",
      createdAt: T0,
    });
    const visibleReplyId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "I've got them",
      createdAt: T0 + 1000,
      parentMessageId: parentId,
    });
    await insertMessage(t, {
      channelId,
      senderId: otherUserId,
      senderName: "Dara Peters",
      content: "me too",
      createdAt: T0 + 2000,
      parentMessageId: parentId,
    });

    // Before blocking: a collapsed thread.
    let page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect((page.messages[0] as any).threadSummary.replyCount).toBe(2);

    await block(t, userId, otherUserId);

    // After: one visible reply, so it comes back inline and the pill goes away.
    page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect(page.messages.map((m: any) => m._id)).toEqual([
      parentId,
      visibleReplyId,
    ]);
    expect((page.messages[0] as any).threadSummary).toBeUndefined();
  });
});

describe("getMessages waReplies — quoted media thumbnails", () => {
  async function quoteFor(
    attachments: Array<{ type: string; url: string; thumbnailUrl?: string }>,
  ) {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "",
      createdAt: T0,
      attachments,
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
    return (page.messages.find((m: any) => m.parentMessageId) as any).replyQuote;
  }

  test("an image parent carries a resolved thumbnail URL", async () => {
    const quote = await quoteFor([
      { type: "image", url: "https://cdn.test/chairs.jpg" },
    ]);
    expect(quote.parentAttachmentType).toBe("image");
    expect(quote.parentThumbnailUrl).toBe("https://cdn.test/chairs.jpg");
  });

  test("a video parent carries its capture thumbnail when it has one", async () => {
    const quote = await quoteFor([
      {
        type: "video",
        url: "https://cdn.test/setup.mp4",
        thumbnailUrl: "https://cdn.test/setup-poster.jpg",
      },
    ]);
    expect(quote.parentAttachmentType).toBe("video");
    // Never the video file itself — that would try to paint an mp4 into a 28pt box.
    expect(quote.parentThumbnailUrl).toBe("https://cdn.test/setup-poster.jpg");
  });

  test("a video parent with no capture thumbnail carries none (glyph-only quote)", async () => {
    const quote = await quoteFor([
      { type: "video", url: "https://cdn.test/setup.mp4" },
    ]);
    expect(quote.parentAttachmentType).toBe("video");
    expect(quote.parentThumbnailUrl).toBeUndefined();
  });

  test("audio and document parents carry no thumbnail", async () => {
    expect(
      (await quoteFor([{ type: "audio", url: "https://cdn.test/vm.m4a" }]))
        .parentThumbnailUrl,
    ).toBeUndefined();
    expect(
      (await quoteFor([{ type: "document", url: "https://cdn.test/plan.pdf" }]))
        .parentThumbnailUrl,
    ).toBeUndefined();
  });
});

describe("getMessages waReplies — the pill count stays bounded and honest", () => {
  /** Add `count` live replies to `parentId`, then optionally delete some. */
  async function addReplies(
    t: ReturnType<typeof convexTest>,
    channelId: Id<"chatChannels">,
    senderId: Id<"users">,
    parentId: Id<"chatMessages">,
    count: number,
  ) {
    const ids: Id<"chatMessages">[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await insertMessage(t, {
          channelId,
          senderId,
          content: `r${i}`,
          createdAt: T0 + 1000 * (i + 1),
          parentMessageId: parentId,
        }),
      );
    }
    return ids;
  }

  test("a thread deeper than the probe still counts exactly, up to the cap", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "long one",
      createdAt: T0,
    });
    await addReplies(t, channelId, userId, parentId, 23);

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    const summary = (page.messages[0] as any).threadSummary;
    expect(summary.replyCount).toBe(23);
    expect(summary.replyCountCapped).toBe(false);
  });

  test("past the cap the pill reports the cap and flags it", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "very long one",
      createdAt: T0,
    });
    await addReplies(t, channelId, userId, parentId, 55);

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    const summary = (page.messages[0] as any).threadSummary;
    expect(summary.replyCount).toBe(50);
    expect(summary.replyCountCapped).toBe(true);
  });

  test("deleted replies never inflate a deep thread's count", async () => {
    // The regression this fix exists for: past the probe the count used to fall
    // back to the monotonic `threadReplyCount`, which counts deleted sends.
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "long one",
      createdAt: T0,
    });
    const ids = await addReplies(t, channelId, userId, parentId, 20);
    await t.run(async (ctx) => {
      for (const id of ids.slice(0, 8)) {
        await ctx.db.patch(id, { isDeleted: true });
      }
    });

    const parentDoc = await t.run((ctx) => ctx.db.get(parentId));
    expect(parentDoc?.threadReplyCount).toBe(20); // never decremented

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    const summary = (page.messages[0] as any).threadSummary;
    expect(summary.replyCount).toBe(12);
    expect(summary.replyCountCapped).toBe(false);
  });

  test("the activation rule is unaffected by the counting change", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const parentId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "one only",
      createdAt: T0,
    });
    const [replyId] = await addReplies(t, channelId, userId, parentId, 1);

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect(page.messages.map((m: any) => m._id)).toEqual([parentId, replyId]);
    expect((page.messages[0] as any).threadSummary).toBeUndefined();
  });
});

describe("sendMessage — a reply joins its thread, it does not fork one", () => {
  // `sendMessage` schedules `onMessageSent`. Left running, it leaks into the
  // next test as "test began while previous transaction was still open", so
  // every send here is drained before the assertions.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  async function send(
    t: ReturnType<typeof convexTest>,
    channelId: Id<"chatChannels">,
    accessToken: string,
    content: string,
    parentMessageId?: Id<"chatMessages">,
  ): Promise<Id<"chatMessages">> {
    const id = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: accessToken,
      channelId,
      content,
      ...(parentMessageId ? { parentMessageId } : {}),
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return id;
  }

  /** Send through the real mutation, so rooting is exercised end to end. */
  function sender(
    t: ReturnType<typeof convexTest>,
    channelId: Id<"chatChannels">,
    accessToken: string,
  ) {
    return (content: string, parentMessageId?: Id<"chatMessages">) =>
      send(t, channelId, accessToken, content, parentMessageId);
  }

  test("replying to a reply files under the root and quotes the tapped message", async () => {
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seed(t);
    const send = sender(t, channelId, accessToken);

    const rootId = await send("Who is bringing the chairs?");
    const firstId = await send("I've got them", rootId);
    // The tap that used to fork: reply to the reply, not to the root.
    const secondId = await send("How many?", firstId);

    const second = await t.run((ctx) => ctx.db.get(secondId));
    expect(second?.parentMessageId).toBe(rootId);
    expect(second?.quotedMessageId).toBe(firstId);

    // The thread's bookkeeping lands on the root, never on the middle reply.
    const root = await t.run((ctx) => ctx.db.get(rootId));
    const first = await t.run((ctx) => ctx.db.get(firstId));
    expect(root?.threadReplyCount).toBe(2);
    expect(first?.threadReplyCount).toBeUndefined();

    // Owner's scenario: reply, then someone replies to THAT — both collapse
    // under the root behind one "2 replies" pill.
    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect(page.messages.map((m: any) => m._id)).toEqual([rootId]);
    expect((page.messages[0] as any).threadSummary.replyCount).toBe(2);
  });

  test("the quote still shows the tapped message, not the root", async () => {
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seed(t);
    const send = sender(t, channelId, accessToken);

    const rootId = await send("Who is bringing the chairs?");
    const firstId = await send("I've got them", rootId);
    await send("How many?", firstId);
    // Delete one so the survivor is re-admitted to the timeline and we can
    // read the quote it renders.
    await t.run(async (ctx) => {
      await ctx.db.patch(firstId, { isDeleted: true });
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    const reply = page.messages.find((m: any) => m.content === "How many?") as any;
    // Filed under the root, but quoting the reply the sender tapped — which,
    // now deleted, reads as WhatsApp's deleted-quote rather than the root's text.
    expect(reply.parentMessageId).toBe(rootId);
    expect(reply.replyQuote).toMatchObject({
      parentMessageId: firstId,
      parentDeleted: true,
    });
  });

  test("a first reply is unchanged — no quote target, parent is the root", async () => {
    const t = convexTest(schema, modules);
    const { channelId, accessToken } = await seed(t);
    const send = sender(t, channelId, accessToken);

    const rootId = await send("Who is bringing the chairs?");
    const replyId = await send("I've got them", rootId);

    const reply = await t.run((ctx) => ctx.db.get(replyId));
    expect(reply?.parentMessageId).toBe(rootId);
    expect(reply?.quotedMessageId).toBeUndefined();
  });

  test("rooting never crosses into another channel", async () => {
    const t = convexTest(schema, modules);
    const { channelId, groupId, userId, accessToken } = await seed(t);
    const otherChannelId = await seedSecondChannel(t, groupId, userId);

    // A chained row from before the same-channel check: the middle reply lives
    // in this channel but points at a parent in another one.
    const foreignRootId = await insertMessage(t, {
      channelId: otherChannelId,
      senderId: userId,
      content: "elsewhere",
      createdAt: T0,
    });
    const strandedId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "stranded",
      createdAt: T0 + 1000,
      parentMessageId: foreignRootId,
    });

    const replyId = await send(
      t,
      channelId,
      accessToken,
      "replying to the stranded one",
      strandedId,
    );

    // The walk stops at the stranded reply rather than rooting the thread on a
    // message in a channel this reply's readers may not be able to see.
    const reply = await t.run((ctx) => ctx.db.get(replyId));
    expect(reply?.parentMessageId).toBe(strandedId);
    expect(reply?.quotedMessageId).toBeUndefined();
  });
});

describe("getMessages waReplies — chains written before rooting", () => {
  /** Build `V ← r1 ← r2 ← …` the way the pre-rooting client wrote it. */
  async function chain(
    t: ReturnType<typeof convexTest>,
    channelId: Id<"chatChannels">,
    senderId: Id<"users">,
    depth: number,
  ) {
    const rootId = await insertMessage(t, {
      channelId,
      senderId,
      content: "root",
      createdAt: T0,
    });
    const links: Id<"chatMessages">[] = [];
    let parentMessageId = rootId;
    for (let i = 0; i < depth; i++) {
      parentMessageId = await insertMessage(t, {
        channelId,
        senderId,
        content: `reply ${i + 1}`,
        createdAt: T0 + 1000 * (i + 1),
        parentMessageId,
      });
      links.push(parentMessageId);
    }
    return { rootId, links };
  }

  test("a two-deep chain collapses under the root with a 2-reply pill", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const { rootId } = await chain(t, channelId, userId, 2);

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });

    expect(page.messages.map((m: any) => m._id)).toEqual([rootId]);
    const summary = (page.messages[0] as any).threadSummary;
    expect(summary.replyCount).toBe(2);
    expect(summary.lastReplyAt).toBe(T0 + 2000);
  });

  test("a one-deep chain is still a lone inline reply", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const { rootId, links } = await chain(t, channelId, userId, 1);

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect(page.messages.map((m: any) => m._id)).toEqual([rootId, links[0]]);
    expect((page.messages[0] as any).threadSummary).toBeUndefined();
  });

  test("the bounded walk folds a chain deeper than the model ever allows", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const { rootId } = await chain(t, channelId, userId, 5);

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect(page.messages.map((m: any) => m._id)).toEqual([rootId]);
    expect((page.messages[0] as any).threadSummary.replyCount).toBe(5);
  });

  test("two replies under an inline reply collapse under the root, not into thin air", async () => {
    // The defect this pins: the summary is only ever computed for rows without
    // a `parentMessageId`, so a chained reply that accumulated two replies of
    // its own had them vanish from the timeline with no pill anywhere to open.
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const rootId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "root",
      createdAt: T0,
    });
    const inlineId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "reply 1",
      createdAt: T0 + 1000,
      parentMessageId: rootId,
    });
    for (const [i, content] of ["reply 2", "reply 3"].entries()) {
      await insertMessage(t, {
        channelId,
        senderId: userId,
        content,
        createdAt: T0 + 2000 + i * 1000,
        parentMessageId: inlineId,
      });
    }

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
      waReplies: true,
    });
    expect(page.messages.map((m: any) => m._id)).toEqual([rootId]);
    expect((page.messages[0] as any).threadSummary.replyCount).toBe(3);
  });

  test("the thread a chained pill opens holds everything the pill counted", async () => {
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);
    const { rootId, links } = await chain(t, channelId, userId, 3);

    const thread = await t.query(api.functions.messaging.messages.getThreadReplies, {
      token: accessToken,
      parentMessageId: rootId,
    });
    expect(thread.messages.map((m: any) => m._id)).toEqual(links);

    // Opening the thread from a link in the middle of the chain lands on the
    // same conversation, not a fragment of it.
    const fromMiddle = await t.query(api.functions.messaging.messages.getThreadReplies, {
      token: accessToken,
      parentMessageId: links[1],
    });
    expect(fromMiddle.messages.map((m: any) => m._id)).toEqual(links);
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

  test("a chained reply is still just a hidden reply — no rooting, no decoration", async () => {
    // Rooting is a flag-ON read rule. Flag-off filters every reply out before
    // it can matter, so a chain leaves the ghost timeline byte-identical.
    const t = convexTest(schema, modules);
    const { channelId, userId, accessToken } = await seed(t);

    const rootId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "root",
      createdAt: T0,
    });
    const firstId = await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "reply 1",
      createdAt: T0 + 1000,
      parentMessageId: rootId,
    });
    await insertMessage(t, {
      channelId,
      senderId: userId,
      content: "reply 2",
      createdAt: T0 + 2000,
      parentMessageId: firstId,
    });

    const page = await t.query(api.functions.messaging.messages.getMessages, {
      token: accessToken,
      channelId,
    });

    expect(page.messages.map((m: any) => m._id)).toEqual([rootId]);
    const parent = page.messages[0] as any;
    expect(parent.threadSummary).toBeUndefined();
    expect(parent.replyQuote).toBeUndefined();
    // The ghost pointer still reads the chain exactly as it did before: the
    // root's own send counter and last-activity bump, untouched by rooting.
    expect(parent.threadReplyCount).toBe(1);
    expect(parent.lastActivityAt).toBe(T0 + 1000);
  });
});
