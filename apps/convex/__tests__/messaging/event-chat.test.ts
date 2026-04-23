/**
 * Event Chat Tests (TDD spec)
 *
 * Codifies the spec for the new "event chat" feature: channels scoped to
 * individual meetings, auto-seeded with the host and RSVPers, toggleable by
 * the event creator / group leaders, and mirrored from text blasts.
 *
 * NOTE: These tests are written in TDD-first style. Several of the functions
 * under test (addEventChannelMember/removeEventChannelMember wiring into
 * meetingRsvps:submit, text blast chat mirror) may not yet be implemented.
 * Failures here describe the spec — do not "fix" them by mocking.
 *
 * Run with: cd apps/convex && pnpm test __tests__/messaging/event-chat.test.ts
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
import { internal } from "../../_generated/api";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Helpers
// ============================================================================

interface TestData {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  meetingId: Id<"meetings">;
  hostId: Id<"users">;
  leaderId: Id<"users">;
  goingId: Id<"users">;
  notGoingId: Id<"users">;
  maybeDisabledId: Id<"users">;
  outsiderId: Id<"users">;
  hostToken: string;
  leaderToken: string;
  goingToken: string;
  outsiderToken: string;
}

async function setupTestData(t: ReturnType<typeof convexTest>): Promise<TestData> {
  return await t.run(async (ctx) => {
    const ts = Date.now();
    const future = ts + 86_400_000;

    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test-event-chat",
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

    const hostId = await ctx.db.insert("users", {
      firstName: "Host",
      lastName: "Creator",
      phone: "+15551110001",
      createdAt: ts,
      updatedAt: ts,
    });
    const leaderId = await ctx.db.insert("users", {
      firstName: "Other",
      lastName: "Leader",
      phone: "+15551110002",
      createdAt: ts,
      updatedAt: ts,
    });
    const goingId = await ctx.db.insert("users", {
      firstName: "Going",
      lastName: "Attendee",
      phone: "+15551110003",
      createdAt: ts,
      updatedAt: ts,
    });
    const notGoingId = await ctx.db.insert("users", {
      firstName: "NotGoing",
      lastName: "Attendee",
      phone: "+15551110004",
      createdAt: ts,
      updatedAt: ts,
    });
    const maybeDisabledId = await ctx.db.insert("users", {
      firstName: "MaybeDisabled",
      lastName: "Attendee",
      phone: "+15551110005",
      createdAt: ts,
      updatedAt: ts,
    });
    const outsiderId = await ctx.db.insert("users", {
      firstName: "Outsider",
      lastName: "Person",
      phone: "+15551110006",
      createdAt: ts,
      updatedAt: ts,
    });

    // Community memberships (everyone except outsiderId).
    for (const uid of [hostId, leaderId, goingId, notGoingId, maybeDisabledId]) {
      await ctx.db.insert("userCommunities", {
        userId: uid,
        communityId,
        roles: 1,
        status: 1,
        createdAt: ts,
        updatedAt: ts,
      });
    }

    // Group memberships — host + leader as leaders, going/notGoing as members.
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: hostId,
      role: "leader",
      joinedAt: ts,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: ts,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: goingId,
      role: "member",
      joinedAt: ts,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: notGoingId,
      role: "member",
      joinedAt: ts,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: maybeDisabledId,
      role: "member",
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
      createdById: hostId,
      rsvpOptions: [
        { id: 1, label: "Going", enabled: true },
        { id: 2, label: "Not Going", enabled: true },
        { id: 3, label: "Maybe", enabled: false },
      ],
      communityId,
    });

    // RSVPs
    await ctx.db.insert("meetingRsvps", {
      meetingId,
      userId: goingId,
      rsvpOptionId: 1,
      createdAt: ts,
      updatedAt: ts,
    });
    await ctx.db.insert("meetingRsvps", {
      meetingId,
      userId: notGoingId,
      rsvpOptionId: 2,
      createdAt: ts,
      updatedAt: ts,
    });
    await ctx.db.insert("meetingRsvps", {
      meetingId,
      userId: maybeDisabledId,
      rsvpOptionId: 3,
      createdAt: ts,
      updatedAt: ts,
    });

    return {
      communityId,
      groupId,
      meetingId,
      hostId,
      leaderId,
      goingId,
      notGoingId,
      maybeDisabledId,
      outsiderId,
      hostToken: `test-token-${hostId}`,
      leaderToken: `test-token-${leaderId}`,
      goingToken: `test-token-${goingId}`,
      outsiderToken: `test-token-${outsiderId}`,
    };
  });
}

// ============================================================================
// ensureEventChannel
// ============================================================================

describe("ensureEventChannel", () => {
  test("creates a chatChannels row with channelType 'event', meetingId, and slug 'event-{shortId}'", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const channel = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannels")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", data.meetingId))
        .unique();
    });

    expect(channel).not.toBeNull();
    expect(channel?.channelType).toBe("event");
    expect(channel?.meetingId).toBe(data.meetingId);
    expect(channel?.slug).toBe("event-dinner123");
    expect(channel?.groupId).toBe(data.groupId);
  });

  test("is idempotent — second call returns same channel _id", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const firstId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );
    const secondId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    expect(firstId).toBe(secondId);

    const channels = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannels")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", data.meetingId))
        .collect();
    });
    expect(channels).toHaveLength(1);
  });

  test("seeds host as admin with syncSource 'event_rsvp'", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const hostMembership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", data.hostId),
        )
        .unique();
    });

    expect(hostMembership).not.toBeNull();
    expect(hostMembership?.role).toBe("admin");
    expect(hostMembership?.syncSource).toBe("event_rsvp");
  });

  test("does NOT bulk-seed RSVPers — only the host is seated initially", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect();
    });

    const userIds = rows.map((r) => r.userId);
    // Lazy-seed model: only the host is seated by ensureEventChannel.
    // Non-host RSVPers become members when they call openEventChat.
    expect(userIds).toEqual([data.hostId]);
    expect(userIds).not.toContain(data.goingId);
    expect(userIds).not.toContain(data.notGoingId);
    expect(userIds).not.toContain(data.maybeDisabledId);
  });

  test("memberCount starts at 1 (just the host)", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.memberCount).toBe(1);
  });

  test("throws when meeting has no shortId", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    // Create a bare meeting with no shortId.
    const bareMeetingId = await t.run(async (ctx) => {
      return await ctx.db.insert("meetings", {
        groupId: data.groupId,
        title: "No ShortId",
        scheduledAt: Date.now() + 86_400_000,
        status: "scheduled",
        meetingType: 1,
        createdAt: Date.now(),
        createdById: data.hostId,
        communityId: data.communityId,
      });
    });

    await expect(
      t.mutation(
        (internal as any).functions.messaging.eventChat.ensureEventChannel,
        { meetingId: bareMeetingId },
      ),
    ).rejects.toThrow(/shortId/i);
  });
});

// ============================================================================
// getChannelByMeetingId
// ============================================================================

describe("getChannelByMeetingId", () => {
  test("returns null when no channel exists", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const result = await t.query(
      "functions/messaging/eventChat:getChannelByMeetingId" as any,
      { token: data.hostToken, meetingId: data.meetingId },
    );

    expect(result).toBeNull();
  });

  test("returns the channel for the host", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const result = await t.query(
      "functions/messaging/eventChat:getChannelByMeetingId" as any,
      { token: data.hostToken, meetingId: data.meetingId },
    );

    expect(result).not.toBeNull();
    expect(result.meetingId).toBe(data.meetingId);
    expect(result.channelType).toBe("event");
  });

  test("returns the channel for a user with enabled RSVP (going)", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const result = await t.query(
      "functions/messaging/eventChat:getChannelByMeetingId" as any,
      { token: data.goingToken, meetingId: data.meetingId },
    );

    expect(result).not.toBeNull();
    expect(result.meetingId).toBe(data.meetingId);
  });

  test("returns null for outsider (no RSVP, not host)", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const result = await t.query(
      "functions/messaging/eventChat:getChannelByMeetingId" as any,
      { token: data.outsiderToken, meetingId: data.meetingId },
    );

    expect(result).toBeNull();
  });

  test("returns null for user whose RSVP option is disabled", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const maybeToken = `test-token-${data.maybeDisabledId}`;
    const result = await t.query(
      "functions/messaging/eventChat:getChannelByMeetingId" as any,
      { token: maybeToken, meetingId: data.meetingId },
    );

    expect(result).toBeNull();
  });
});

// ============================================================================
// setEventChannelEnabled
// ============================================================================

describe("setEventChannelEnabled", () => {
  test("event creator can disable the channel", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const result = await t.mutation(
      "functions/messaging/eventChat:setEventChannelEnabled" as any,
      { token: data.hostToken, meetingId: data.meetingId, enabled: false },
    );

    expect(result.channelId).toBe(channelId);
    expect(result.enabled).toBe(false);

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.isEnabled).toBe(false);
    expect(channel?.disabledByUserId).toBe(data.hostId);
  });

  test("group leader (non-creator) can disable the channel", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const result = await t.mutation(
      "functions/messaging/eventChat:setEventChannelEnabled" as any,
      { token: data.leaderToken, meetingId: data.meetingId, enabled: false },
    );

    expect(result.enabled).toBe(false);
    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.isEnabled).toBe(false);
    expect(channel?.disabledByUserId).toBe(data.leaderId);
  });

  test("regular member (goingId) cannot disable", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    await expect(
      t.mutation(
        "functions/messaging/eventChat:setEventChannelEnabled" as any,
        { token: data.goingToken, meetingId: data.meetingId, enabled: false },
      ),
    ).rejects.toThrow(/creator|leader|admin/i);
  });

  test("re-enabling clears disabledByUserId", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    // Disable first.
    await t.mutation(
      "functions/messaging/eventChat:setEventChannelEnabled" as any,
      { token: data.hostToken, meetingId: data.meetingId, enabled: false },
    );

    // Re-enable.
    await t.mutation(
      "functions/messaging/eventChat:setEventChannelEnabled" as any,
      { token: data.hostToken, meetingId: data.meetingId, enabled: true },
    );

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.isEnabled).toBe(true);
    expect(channel?.disabledByUserId).toBeUndefined();
  });

  test("returns { channelId: null, enabled } when no channel exists yet", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const result = await t.mutation(
      "functions/messaging/eventChat:setEventChannelEnabled" as any,
      { token: data.hostToken, meetingId: data.meetingId, enabled: false },
    );

    expect(result.channelId).toBeNull();
    expect(result.enabled).toBe(false);
  });
});

// ============================================================================
// addEventChannelMember / removeEventChannelMember
// ============================================================================

describe("addEventChannelMember / removeEventChannelMember", () => {
  test("addEventChannelMember is a no-op when no channel exists", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation(
      (internal as any).functions.messaging.eventChat.addEventChannelMember,
      { meetingId: data.meetingId, userId: data.goingId },
    );

    const rows = await t.run(async (ctx) => {
      return await ctx.db.query("chatChannelMembers").collect();
    });
    expect(rows).toHaveLength(0);

    const channels = await t.run(async (ctx) => {
      return await ctx.db.query("chatChannels").collect();
    });
    expect(channels).toHaveLength(0);
  });

  test("addEventChannelMember adds row and increments memberCount", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const before = await t.run(async (ctx) => ctx.db.get(channelId));
    const beforeCount = before?.memberCount ?? 0;

    // Add a brand new user not previously seated.
    const newUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Late",
        lastName: "Joiner",
        phone: "+15552220099",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(
      (internal as any).functions.messaging.eventChat.addEventChannelMember,
      { meetingId: data.meetingId, userId: newUserId },
    );

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", newUserId),
        )
        .unique();
    });
    expect(membership).not.toBeNull();

    const after = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(after?.memberCount).toBe(beforeCount + 1);
  });

  test("addEventChannelMember is idempotent", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    const newUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Twice",
        lastName: "Added",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.mutation(
      (internal as any).functions.messaging.eventChat.addEventChannelMember,
      { meetingId: data.meetingId, userId: newUserId },
    );
    await t.mutation(
      (internal as any).functions.messaging.eventChat.addEventChannelMember,
      { meetingId: data.meetingId, userId: newUserId },
    );

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", newUserId),
        )
        .collect();
    });
    expect(rows).toHaveLength(1);
  });

  test("removeEventChannelMember removes row and decrements memberCount", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    // Lazy-seed model: seat goingId first (simulating an openEventChat
    // or RSVP-sync add) before testing the removal path.
    await t.mutation(
      (internal as any).functions.messaging.eventChat.addEventChannelMember,
      { meetingId: data.meetingId, userId: data.goingId },
    );

    const before = await t.run(async (ctx) => ctx.db.get(channelId));
    const beforeCount = before?.memberCount ?? 0;

    await t.mutation(
      (internal as any).functions.messaging.eventChat.removeEventChannelMember,
      { meetingId: data.meetingId, userId: data.goingId },
    );

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", data.goingId),
        )
        .unique();
    });
    expect(membership).toBeNull();

    const after = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(after?.memberCount).toBe(Math.max(0, beforeCount - 1));
  });

  test("removeEventChannelMember does NOT remove the host", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    await t.mutation(
      (internal as any).functions.messaging.eventChat.removeEventChannelMember,
      { meetingId: data.meetingId, userId: data.hostId },
    );

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", data.hostId),
        )
        .unique();
    });
    expect(membership).not.toBeNull();
  });
});

// ============================================================================
// RSVP sync via meetingRsvps.submit
// ============================================================================

describe("RSVP sync via meetingRsvps.submit", () => {
  test("submitting an RSVP to an existing event channel adds the user as a channel member", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    // Create a brand new user with community + group membership but no RSVP yet.
    const newUserId = await t.run(async (ctx) => {
      const ts = Date.now();
      const uid = await ctx.db.insert("users", {
        firstName: "New",
        lastName: "RSVPer",
        phone: "+15553330042",
        createdAt: ts,
        updatedAt: ts,
      });
      await ctx.db.insert("userCommunities", {
        userId: uid,
        communityId: data.communityId,
        roles: 1,
        status: 1,
        createdAt: ts,
        updatedAt: ts,
      });
      await ctx.db.insert("groupMembers", {
        groupId: data.groupId,
        userId: uid,
        role: "member",
        joinedAt: ts,
        notificationsEnabled: true,
      });
      return uid;
    });

    // Submit an RSVP to option 1 (Going — enabled).
    await t.mutation("functions/meetingRsvps:submit" as any, {
      token: `test-token-${newUserId}`,
      meetingId: data.meetingId,
      optionId: 1,
    });

    // meetingRsvps.submit schedules addEventChannelMember via scheduler.runAfter(0, ...)
    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", newUserId),
        )
        .unique();
    });
    expect(membership).not.toBeNull();
    expect(membership?.syncSource).toBe("event_rsvp");
  });

  test("removing an RSVP (via meetingRsvps.remove) removes the user from the channel", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const channelId = await t.mutation(
      (internal as any).functions.messaging.eventChat.ensureEventChannel,
      { meetingId: data.meetingId },
    );

    // Lazy-seed model: seat goingId as a channel member before testing
    // removal on un-RSVP. (Simulates the user having opened the chat or
    // been added via a previous RSVP sync.)
    await t.mutation(
      (internal as any).functions.messaging.eventChat.addEventChannelMember,
      { meetingId: data.meetingId, userId: data.goingId },
    );

    // Calling meetingRsvps.remove should remove them from the channel.
    // Note: submit rejects disabled options upstream, so "change to disabled
    // to drop from chat" isn't a reachable path — remove is.
    await t.mutation("functions/meetingRsvps:remove" as any, {
      token: data.goingToken,
      meetingId: data.meetingId,
    });

    // Inline sync — no scheduled functions to flush.

    const membership = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", channelId).eq("userId", data.goingId),
        )
        .unique();
    });
    expect(membership).toBeNull();
  });

  test("submitting an RSVP when no event channel exists is a silent no-op (no channel created)", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    // Existing goingId updates their RSVP — but ensureEventChannel was never
    // called. The chat module should stay quiet; no channel should spring up.
    await t.mutation("functions/meetingRsvps:submit" as any, {
      token: data.goingToken,
      meetingId: data.meetingId,
      optionId: 2,
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const channels = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannels")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", data.meetingId))
        .collect();
    });
    expect(channels).toHaveLength(0);
  });
});

// ============================================================================
// openEventChat (public mutation)
// ============================================================================

describe("openEventChat", () => {
  test("host can open the chat — creates channel and returns channelId + slug", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const result = await t.mutation(
      "functions/messaging/eventChat:openEventChat" as any,
      { token: data.hostToken, meetingId: data.meetingId },
    );

    expect(result.channelId).toBeDefined();
    expect(result.slug).toBe("event-dinner123");

    const channel = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannels")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", data.meetingId))
        .unique();
    });
    expect(channel?._id).toBe(result.channelId);
  });

  test("RSVPer with enabled option can open the chat", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const result = await t.mutation(
      "functions/messaging/eventChat:openEventChat" as any,
      { token: data.goingToken, meetingId: data.meetingId },
    );

    expect(result.channelId).toBeDefined();
    expect(result.slug).toBe("event-dinner123");
  });

  test("outsider (no RSVP, not host) cannot open the chat", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await expect(
      t.mutation("functions/messaging/eventChat:openEventChat" as any, {
        token: data.outsiderToken,
        meetingId: data.meetingId,
      }),
    ).rejects.toThrow(/access/i);
  });

  test("user whose RSVP option is disabled cannot open the chat", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await expect(
      t.mutation("functions/messaging/eventChat:openEventChat" as any, {
        token: `test-token-${data.maybeDisabledId}`,
        meetingId: data.meetingId,
      }),
    ).rejects.toThrow(/access/i);
  });

  test("is idempotent — second call returns same channelId without duplicating", async () => {
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    const first = await t.mutation(
      "functions/messaging/eventChat:openEventChat" as any,
      { token: data.hostToken, meetingId: data.meetingId },
    );
    const second = await t.mutation(
      "functions/messaging/eventChat:openEventChat" as any,
      { token: data.goingToken, meetingId: data.meetingId },
    );

    expect(second.channelId).toBe(first.channelId);

    const channels = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannels")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", data.meetingId))
        .collect();
    });
    expect(channels).toHaveLength(1);
  });
});

// ============================================================================
// Text blast mirror
// ============================================================================

describe("text blast mirror", () => {
  test("eventBlasts.initiate with no existing channel creates one and inserts a chatMessages row", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation("functions/eventBlasts:initiate" as any, {
      token: data.hostToken,
      meetingId: data.meetingId,
      message: "Dinner is still on!",
      channels: ["push"],
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const channel = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannels")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", data.meetingId))
        .unique();
    });
    expect(channel).not.toBeNull();

    const messages = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", channel!._id))
        .collect();
    });

    expect(messages.length).toBeGreaterThanOrEqual(1);
    const mirrored = messages.find((m) => m.blastId != null);
    expect(mirrored).toBeDefined();
    expect(mirrored?.senderId).toBe(data.hostId);
    expect(mirrored?.content).toBe("Dinner is still on!");
    expect(mirrored?.contentType).toBe("text");
    expect(mirrored?.blastId).toBeTruthy();
  });

  test("mirrored message updates channel.lastMessageAt and lastMessagePreview", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const data = await setupTestData(t);

    await t.mutation("functions/eventBlasts:initiate" as any, {
      token: data.hostToken,
      meetingId: data.meetingId,
      message: "See you at 7pm!",
      channels: ["push"],
    });

    vi.runAllTimers();
    await t.finishInProgressScheduledFunctions();

    const channel = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannels")
        .withIndex("by_meetingId", (q) => q.eq("meetingId", data.meetingId))
        .unique();
    });

    expect(channel).not.toBeNull();
    expect(channel?.lastMessageAt).toBeGreaterThan(0);
    expect(channel?.lastMessagePreview).toContain("See you at 7pm");
  });
});
