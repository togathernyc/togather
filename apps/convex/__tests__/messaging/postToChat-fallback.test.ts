/**
 * Tests for meetings.postToChat with the optional General channel.
 *
 * postToChat used to require the group's `main` channel and throw if it was
 * missing. With General optional, it now resolves the group's best active
 * channel the SENDER can post to (resolveGroupDefaultChannelForUser) — posting
 * to announcements when General is disabled, falling through past channels the
 * sender isn't in (so the membership gate doesn't reject them) to e.g. Leaders,
 * and throwing only when nothing active+accessible remains.
 *
 * postToChat enqueues `ctx.scheduler.runAfter(0, onMessageSent)`, so the
 * scheduled-function drain pattern is required.
 */

import { vi, expect, test, describe, afterEach } from "vitest";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) throw new Error("Invalid token");
    return { payload: { userId: match[1], type: "access" } };
  }),
  SignJWT: vi.fn(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock-signed-token"),
  })),
  decodeJwt: vi.fn((token: string) => {
    const match = token.match(/^test-token-(.+)$/);
    if (!match) return null;
    return { userId: match[1], type: "access" };
  }),
}));

import { convexTest } from "convex-test";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// postToChat enqueues `ctx.scheduler.runAfter(0, onMessageSent)`. Fake timers
// keep those jobs from auto-firing on the real event loop so we can drain them
// deterministically — `finishInProgressScheduledFunctions()` only awaits jobs
// already running, leaving the pending runAfter(0) notification chain to fire
// after the test's transaction closes ("Write outside of transaction") once the
// fork is reused by a later test file.
vi.useFakeTimers();

// Drain scheduled functions enqueued by postToChat (onMessageSent).
let activeHandle: ReturnType<typeof convexTest> | null = null;
afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishAllScheduledFunctions(vi.runAllTimers);
    activeHandle = null;
  }
  vi.clearAllTimers();
});

interface Seed {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  meetingId: Id<"meetings">;
  leaderId: Id<"users">;
  leaderToken: string;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<Seed> {
  return await t.run(async (ctx) => {
    const ts = Date.now();
    const future = ts + 86_400_000;

    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-post-to-chat",
      isPublic: true,
      createdAt: ts,
      updatedAt: ts,
    });
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "General",
      slug: "general",
      isActive: true,
      displayOrder: 0,
      createdAt: ts,
    });
    const groupId = await ctx.db.insert("groups", {
      communityId,
      name: "Dinner Club",
      groupTypeId,
      isArchived: false,
      createdAt: ts,
      updatedAt: ts,
    });
    const leaderId = await ctx.db.insert("users", {
      firstName: "Lead",
      lastName: "Er",
      phone: "+15551110002",
      createdAt: ts,
      updatedAt: ts,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: ts,
      notificationsEnabled: true,
    });
    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Dinner Party",
      scheduledAt: future,
      status: "scheduled",
      meetingType: 1,
      createdAt: ts,
      rsvpEnabled: true,
      visibility: "public",
      shortId: "dinner123",
      createdById: leaderId,
      hostUserIds: [leaderId],
      communityId,
    });

    return {
      communityId,
      groupId,
      meetingId,
      leaderId,
      leaderToken: `test-token-${leaderId}`,
    };
  });
}

async function addChannel(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  leaderId: Id<"users">,
  channelType: string,
  opts: { slug?: string; name?: string; isArchived?: boolean } = {},
): Promise<Id<"chatChannels">> {
  const ts = Date.now();
  return await t.run((ctx) =>
    ctx.db.insert("chatChannels", {
      groupId,
      slug: opts.slug ?? channelType,
      channelType,
      name: opts.name ?? channelType,
      createdById: leaderId,
      createdAt: ts,
      updatedAt: ts,
      isArchived: opts.isArchived ?? false,
      memberCount: 1,
    }),
  );
}

async function addChannelMember(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
) {
  const ts = Date.now();
  await t.run((ctx) =>
    ctx.db.insert("chatChannelMembers", {
      channelId,
      userId,
      role: "member",
      joinedAt: ts,
      isMuted: false,
    }),
  );
}

describe("meetings.postToChat fallback", () => {
  test("posts to announcements when General is disabled", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { groupId, meetingId, leaderId, leaderToken } = await seed(t);

    // General disabled (archived); announcements active.
    await addChannel(t, groupId, leaderId, "main", {
      slug: "general",
      name: "General",
      isArchived: true,
    });
    const annId = await addChannel(t, groupId, leaderId, "announcements", {
      name: "Announcements",
    });
    await addChannelMember(t, annId, leaderId);

    const messageId = await t.mutation(api.functions.meetings.index.postToChat, {
      token: leaderToken,
      meetingId,
      message: "Join us!",
    });

    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message?.channelId).toBe(annId);
  });

  test("falls through to a postable channel (Leaders), skipping a custom channel the sender isn't in", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { groupId, meetingId, leaderId, leaderToken } = await seed(t);

    // General disabled; an active custom channel the leader is NOT a member of;
    // a Leaders channel the leader IS in. The resolver must skip the custom
    // channel (membership gate would reject it) and post to Leaders.
    await addChannel(t, groupId, leaderId, "main", {
      slug: "general",
      name: "General",
      isArchived: true,
    });
    await addChannel(t, groupId, leaderId, "custom", {
      slug: "secret",
      name: "Secret",
    });
    const leadersId = await addChannel(t, groupId, leaderId, "leaders", {
      name: "Leaders",
    });
    await addChannelMember(t, leadersId, leaderId);

    const messageId = await t.mutation(api.functions.meetings.index.postToChat, {
      token: leaderToken,
      meetingId,
      message: "Join us!",
    });

    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message?.channelId).toBe(leadersId);
  });

  test("throws when the group has no active channel to share to", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const { groupId, meetingId, leaderId, leaderToken } = await seed(t);

    // Only an archived General — nothing active.
    await addChannel(t, groupId, leaderId, "main", {
      slug: "general",
      name: "General",
      isArchived: true,
    });

    await expect(
      t.mutation(api.functions.meetings.index.postToChat, {
        token: leaderToken,
        meetingId,
        message: "Join us!",
      }),
    ).rejects.toThrow("This group has no active channel to share to");
  });
});
