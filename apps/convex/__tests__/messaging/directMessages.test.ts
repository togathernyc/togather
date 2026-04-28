/**
 * Direct Message Tests
 *
 * Covers the new 1:1 DM and ad-hoc group-chat backend in
 * `functions/messaging/directMessages.ts`, plus the `sendMessage` gating that
 * applies while a recipient is still in `requestState: "pending"`, and the
 * `blockUser` auto-decline branch in `functions/messaging/blocking.ts`.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

// Set up environment variables
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// ============================================================================
// Test Helpers
// ============================================================================

function uniquePhone(): string {
  // Avoid collisions with other tests that use 555-555-XXXX style numbers.
  const suffix = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0");
  return `+1444555${suffix}`;
}

async function createCommunity(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<"communities">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name,
      subdomain: name.toLowerCase().replace(/\s+/g, "-"),
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function createUserInCommunity(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  opts: {
    firstName: string;
    lastName?: string;
    /**
     * Override the default test profile photo. Pass `null` to omit the photo
     * entirely (used by the profile-photo gate tests). When omitted, a
     * non-empty placeholder photo is set so the photo gate is satisfied.
     */
    profilePhoto?: string | null;
  },
): Promise<{ userId: Id<"users">; accessToken: string }> {
  const userId = await t.run(async (ctx) => {
    const uId = await ctx.db.insert("users", {
      firstName: opts.firstName,
      lastName: opts.lastName ?? "Tester",
      phone: uniquePhone(),
      phoneVerified: true,
      activeCommunityId: communityId,
      profilePhoto:
        opts.profilePhoto === null
          ? undefined
          : (opts.profilePhoto ?? "https://example.com/avatar.png"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("userCommunities", {
      userId: uId,
      communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return uId;
  });

  const { accessToken } = await generateTokens(userId);
  return { userId, accessToken };
}

async function createUserInOtherCommunity(
  t: ReturnType<typeof convexTest>,
  opts: { firstName: string; lastName?: string; profilePhoto?: string | null },
): Promise<{
  userId: Id<"users">;
  accessToken: string;
  communityId: Id<"communities">;
}> {
  const communityId = await createCommunity(
    t,
    `Other-${Math.floor(Math.random() * 1_000_000)}`,
  );
  const { userId, accessToken } = await createUserInCommunity(t, communityId, opts);
  return { userId, accessToken, communityId };
}

async function getMember(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"chatChannels">,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId),
      )
      .first();
  });
}

// ============================================================================
// createOrGetDirectChannel
// ============================================================================

describe("createOrGetDirectChannel", () => {
  test("creates a DM between two users in the same community", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Shared Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice" },
    );
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    const result = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    expect(result.isNew).toBe(true);
    expect(result.channelId).toBeDefined();

    const channel = await t.run(async (ctx) => ctx.db.get(result.channelId));
    expect(channel?.channelType).toBe("dm");
    expect(channel?.isAdHoc).toBe(true);
    expect(channel?.communityId).toBe(communityId);
    expect(channel?.dmPairKey).toBeDefined();
    expect(typeof channel?.dmPairKey).toBe("string");
    expect(channel?.dmPairKey!.length).toBeGreaterThan(0);

    const aMember = await getMember(t, result.channelId, aId);
    expect(aMember?.requestState).toBe("accepted");
    expect(aMember?.role).toBe("admin");

    const bMember = await getMember(t, result.channelId, bId);
    expect(bMember?.requestState).toBe("pending");
    expect(bMember?.invitedById).toBe(aId);
  });

  test("returns the existing channel on a second call (dedup)", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Dedup Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    const first = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );
    const second = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(second.channelId).toBe(first.channelId);
  });

  test("throws when the two users share no community", async () => {
    const t = convexTest(schema, modules);
    const community1 = await createCommunity(t, "Community One");
    const { accessToken: aToken } = await createUserInCommunity(t, community1, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInOtherCommunity(t, {
      firstName: "Bob",
    });

    // Bob is not a member of community1, so messaging him scoped to
    // community1 must be rejected.
    await expect(
      t.mutation(
        api.functions.messaging.directMessages.createOrGetDirectChannel,
        { token: aToken, communityId: community1, recipientUserId: bId },
      ),
    ).rejects.toThrow(/community/i);
  });

  test("strictly scopes the channel to the requested community even when users share multiple", async () => {
    const t = convexTest(schema, modules);
    const comm1 = await createCommunity(t, "Comm One");
    const comm2 = await createCommunity(t, "Comm Two");

    // Create A and B as members of comm1 (createUserInCommunity inserts the
    // user + a userCommunities row for comm1).
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      comm1,
      { firstName: "Alice" },
    );
    const { userId: bId } = await createUserInCommunity(t, comm1, {
      firstName: "Bob",
    });

    // Add a SECOND userCommunities row for each user, joining them to comm2
    // as well — both users now share both communities.
    await t.run(async (ctx) => {
      await ctx.db.insert("userCommunities", {
        userId: aId,
        communityId: comm2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("userCommunities", {
        userId: bId,
        communityId: comm2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // First call: scope to comm1.
    const first = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId: comm1, recipientUserId: bId },
    );
    expect(first.isNew).toBe(true);
    const firstChannel = await t.run(async (ctx) => ctx.db.get(first.channelId));
    expect(firstChannel?.communityId).toBe(comm1);

    // Repeat call with the same comm1 → should dedup, NOT create a new one.
    const firstAgain = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId: comm1, recipientUserId: bId },
    );
    expect(firstAgain.isNew).toBe(false);
    expect(firstAgain.channelId).toBe(first.channelId);

    // Now scope to comm2 — must create a SEPARATE channel even though A and
    // B are also both members of comm2. This is the regression test for the
    // cross-community leak.
    const second = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId: comm2, recipientUserId: bId },
    );
    expect(second.isNew).toBe(true);
    expect(second.channelId).not.toBe(first.channelId);
    const secondChannel = await t.run(async (ctx) =>
      ctx.db.get(second.channelId),
    );
    expect(secondChannel?.communityId).toBe(comm2);
  });
});

// ============================================================================
// respondToChatRequest
// ============================================================================

describe("respondToChatRequest", () => {
  test("accept flips state to accepted", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Accept Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      { token: bToken, channelId, response: "accept" },
    );

    const bMember = await getMember(t, channelId, bId);
    expect(bMember?.requestState).toBe("accepted");
    expect(bMember?.requestRespondedAt).toBeDefined();
    expect(typeof bMember?.requestRespondedAt).toBe("number");
  });

  test("decline marks declined and leftAt; sender unchanged", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Decline Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice" },
    );
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      { token: bToken, channelId, response: "decline" },
    );

    const bMember = await getMember(t, channelId, bId);
    expect(bMember?.requestState).toBe("declined");
    expect(bMember?.leftAt).toBeDefined();

    const aMember = await getMember(t, channelId, aId);
    expect(aMember?.requestState).toBe("accepted");
    expect(aMember?.leftAt).toBeUndefined();
  });

  test("block writes a chatUserBlocks row and a chatUserFlags row", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Block Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice" },
    );
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      {
        token: bToken,
        channelId,
        response: "block",
        reportReason: "spam",
      },
    );

    const bMember = await getMember(t, channelId, bId);
    expect(bMember?.requestState).toBe("declined");

    const block = await t.run(async (ctx) =>
      ctx.db
        .query("chatUserBlocks")
        .withIndex("by_blocker_blocked", (q) =>
          q.eq("blockerId", bId).eq("blockedId", aId),
        )
        .first(),
    );
    expect(block).not.toBeNull();
    expect(block?.blockerId).toBe(bId);
    expect(block?.blockedId).toBe(aId);

    const flag = await t.run(async (ctx) =>
      ctx.db
        .query("chatUserFlags")
        .withIndex("by_user", (q) => q.eq("userId", aId))
        .first(),
    );
    expect(flag).not.toBeNull();
    expect(flag?.userId).toBe(aId);
    expect(flag?.reportedById).toBe(bId);
    expect(flag?.reason).toBe("spam");
    expect(flag?.status).toBe("pending");
  });
});

// ============================================================================
// sendMessage gating on pending channels
// ============================================================================

describe("sendMessage gating on pending channels", () => {
  test("rate limit: sender can only send 1 message to a pending recipient per 24h", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Rate Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    // First message succeeds.
    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: aToken,
      channelId,
      content: "hello",
    });
    await t.finishInProgressScheduledFunctions();

    // Second send should be rate-limited.
    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: aToken,
        channelId,
        content: "hello again",
      }),
    ).rejects.toThrow(/1 message|accept/i);

    // Drain again at end-of-test — `finishInProgressScheduledFunctions` only
    // runs ONE round, but the notification chain (onMessageSent →
    // sendMessageNotifications) schedules transitively. Without this, the
    // tail-end of the chain leaks into the next test as a "test began while
    // previous transaction was still open" error.
    await t.finishInProgressScheduledFunctions();
  });

  test("attachments are rejected while a recipient is pending", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Attach Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: aToken,
        channelId,
        content: "Picture for you",
        attachments: [
          {
            type: "image",
            url: "https://example.com/image.jpg",
            name: "photo.jpg",
            mimeType: "image/jpeg",
          },
        ],
      }),
    ).rejects.toThrow(/attachment/i);
  });
});

// ============================================================================
// listChatRequests
// ============================================================================

describe("listChatRequests", () => {
  test("returns recipient's pending requests with metadata", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Inbox Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice", lastName: "Anderson" },
    );
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: aToken,
      channelId,
      content: "hi",
    });
    await t.finishInProgressScheduledFunctions();

    const requests = await t.query(
      api.functions.messaging.directMessages.listChatRequests,
      { token: bToken, communityId },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].channelId).toBe(channelId);
    expect(requests[0].channelType).toBe("dm");
    expect(requests[0].inviterUserId).toBe(aId);
    expect(requests[0].firstMessagePreview).toBe("hi");
    expect(requests[0].inviterDisplayName.toLowerCase()).toContain("alice");

    await t.finishInProgressScheduledFunctions();
  });
});

// ============================================================================
// blockUser auto-declines pending requests
// ============================================================================

describe("blockUser auto-declines pending requests", () => {
  test("blocking the inviter silently declines a pending request", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "AutoDecline Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice" },
    );
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    await t.mutation(api.functions.messaging.blocking.blockUser, {
      token: bToken,
      blockedId: aId,
    });

    const bMember = await getMember(t, channelId, bId);
    expect(bMember?.requestState).toBe("declined");
    expect(bMember?.leftAt).toBeDefined();

    const aMember = await getMember(t, channelId, aId);
    expect(aMember?.requestState).toBe("accepted");
    expect(aMember?.leftAt).toBeUndefined();
  });
});

// ============================================================================
// createGroupChat
// ============================================================================

describe("createGroupChat", () => {
  test("creates a group chat with multiple recipients in the same community", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Group Chat Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice" },
    );
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });
    const { userId: cId } = await createUserInCommunity(t, communityId, {
      firstName: "Carol",
    });
    const { userId: dId } = await createUserInCommunity(t, communityId, {
      firstName: "Dan",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId, cId, dId],
        name: "Friends",
      },
    );

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.channelType).toBe("group_dm");
    expect(channel?.isAdHoc).toBe(true);
    expect(channel?.name).toBe("Friends");
    expect(channel?.memberCount).toBe(4);
    expect(channel?.dmPairKey).toBeUndefined();

    const aMember = await getMember(t, channelId, aId);
    expect(aMember?.requestState).toBe("accepted");
    expect(aMember?.role).toBe("admin");

    for (const rid of [bId, cId, dId]) {
      const m = await getMember(t, channelId, rid);
      expect(m?.requestState).toBe("pending");
      expect(m?.role).toBe("member");
      expect(m?.invitedById).toBe(aId);
    }
  });

  test("rejects more than 19 recipients", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Big Group Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });

    const recipientIds: Id<"users">[] = [];
    for (let i = 0; i < 20; i++) {
      const { userId } = await createUserInCommunity(t, communityId, {
        firstName: `User${i}`,
      });
      recipientIds.push(userId);
    }

    await expect(
      t.mutation(api.functions.messaging.directMessages.createGroupChat, {
        token: aToken,
        communityId,
        recipientUserIds: recipientIds,
      }),
    ).rejects.toThrow(/at most 19|too many/i);
  });
});

// ============================================================================
// searchUsersInSharedCommunities
// ============================================================================

describe("searchUsersInSharedCommunities", () => {
  test("returns shared-community members and excludes blocked users", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Search Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice" },
    );
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
      lastName: "Brown",
    });
    const { userId: cId } = await createUserInCommunity(t, communityId, {
      firstName: "Carol",
      lastName: "Coleman",
    });
    const { userId: dId } = await createUserInOtherCommunity(t, {
      firstName: "Daniel",
      lastName: "Dawson",
    });

    // A blocks B.
    await t.run(async (ctx) => {
      await ctx.db.insert("chatUserBlocks", {
        blockerId: aId,
        blockedId: bId,
        createdAt: Date.now(),
      });
    });

    const results = await t.query(
      api.functions.messaging.directMessages.searchUsersInSharedCommunities,
      { token: aToken, communityId, query: "" },
    );

    const ids = results.map((r) => r.userId);
    expect(ids).toContain(cId);
    expect(ids).not.toContain(bId);
    expect(ids).not.toContain(dId);
    expect(ids).not.toContain(aId);

    const carolRow = results.find((r) => r.userId === cId);
    expect(carolRow).toBeDefined();
    expect(carolRow?.displayName).toBeDefined();
    expect(carolRow?.displayName.length).toBeGreaterThan(0);
    expect(Array.isArray(carolRow?.sharedCommunityNames)).toBe(true);
    expect(carolRow?.sharedCommunityNames.length).toBeGreaterThan(0);
    expect(carolRow?.sharedCommunityNames).toContain("Search Community");
  });
});

// ============================================================================
// getDirectInbox
// ============================================================================

describe("getDirectInbox", () => {
  test("returns accepted ad-hoc channels with last-message metadata", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Inbox Direct Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice", lastName: "Anderson" },
    );
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob", lastName: "Brown" },
    );
    const { userId: cId, accessToken: cToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Carol" },
    );

    // A creates DM with B, sends "hello", B accepts.
    const { channelId: abChannelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );
    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: aToken,
      channelId: abChannelId,
      content: "hello",
    });
    await t.finishInProgressScheduledFunctions();
    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      { token: bToken, channelId: abChannelId, response: "accept" },
    );

    const inbox = await t.query(
      api.functions.messaging.directMessages.getDirectInbox,
      { token: aToken, communityId },
    );

    expect(inbox).toHaveLength(1);
    expect(inbox[0].channelId).toBe(abChannelId);
    expect(inbox[0].channelType).toBe("dm");
    expect(inbox[0].lastMessagePreview).toBe("hello");
    const aDoc = await t.run(async (ctx) => ctx.db.get(aId));
    const expectedAName = `${aDoc?.firstName ?? ""} ${aDoc?.lastName ?? ""}`.trim();
    expect(inbox[0].lastMessageSenderName).toBe(expectedAName);

    const otherIds = inbox[0].otherMembers.map((m) => m.userId);
    expect(otherIds).toEqual([bId]);
    const bDoc = await t.run(async (ctx) => ctx.db.get(bId));
    const expectedBName = `${bDoc?.firstName ?? ""} ${bDoc?.lastName ?? ""}`.trim();
    expect(inbox[0].otherMembers[0].displayName).toBe(expectedBName);

    // Now create a SECOND DM from A to C — C is still pending. Pending DMs
    // should NOT appear in C's inbox (C is the pending recipient). Querying
    // C's inbox should return zero accepted channels.
    await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: cId },
    );

    const cInbox = await t.query(
      api.functions.messaging.directMessages.getDirectInbox,
      { token: cToken, communityId },
    );
    expect(cInbox).toHaveLength(0);

    await t.finishInProgressScheduledFunctions();
  });
});

// ============================================================================
// expireOldChatRequests cron
// ============================================================================

describe("expireOldChatRequests cron", () => {
  test("marks pending requests older than 30 days as declined", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Expire Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });
    const { userId: cId, accessToken: cToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Carol" },
    );

    // A creates DM with B → B is pending.
    const { channelId: abChannelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    const bMemberRowBefore = await getMember(t, abChannelId, bId);
    expect(bMemberRowBefore?.requestState).toBe("pending");
    const bMemberRowId = bMemberRowBefore!._id;

    // Backdate B's pending row to 31 days old.
    const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.patch(bMemberRowId, {
        joinedAt: Date.now() - thirtyOneDaysMs,
      });
    });

    // C creates a SECOND DM with B (recent — should NOT be expired). Note: we
    // need a different inviter so the dmPairKey is different. C invites B.
    const { channelId: cbChannelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: cToken, communityId, recipientUserId: bId },
    );
    const cbBMemberBefore = await getMember(t, cbChannelId, bId);
    expect(cbBMemberBefore?.requestState).toBe("pending");

    // Run the cron.
    const beforeRun = Date.now();
    await t.mutation(
      internal.functions.messaging.directMessages.expireOldChatRequests,
      {},
    );
    const afterRun = Date.now();

    // Old pending row was expired.
    const bMemberAfter = await getMember(t, abChannelId, bId);
    expect(bMemberAfter?.requestState).toBe("declined");
    expect(bMemberAfter?.leftAt).toBeDefined();
    expect(bMemberAfter?.leftAt!).toBeGreaterThanOrEqual(beforeRun);
    expect(bMemberAfter?.leftAt!).toBeLessThanOrEqual(afterRun);

    // Recent pending row was NOT expired.
    const cbBMemberAfter = await getMember(t, cbChannelId, bId);
    expect(cbBMemberAfter?.requestState).toBe("pending");
    expect(cbBMemberAfter?.leftAt).toBeUndefined();
  });
});

// ============================================================================
// Profile photo gate
// ============================================================================

describe("profile photo gate", () => {
  test("createOrGetDirectChannel rejects when caller lacks profilePhoto", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Photo Caller Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
      profilePhoto: null,
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    await expect(
      t.mutation(
        api.functions.messaging.directMessages.createOrGetDirectChannel,
        { token: aToken, communityId, recipientUserId: bId },
      ),
    ).rejects.toThrow(/PROFILE_PHOTO_REQUIRED/);
  });

  test("createOrGetDirectChannel rejects when recipient lacks profilePhoto", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Photo Recipient Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
      profilePhoto: null,
    });

    await expect(
      t.mutation(
        api.functions.messaging.directMessages.createOrGetDirectChannel,
        { token: aToken, communityId, recipientUserId: bId },
      ),
    ).rejects.toThrow(/RECIPIENT_PROFILE_PHOTO_REQUIRED:/);
  });

  test("createOrGetDirectChannel succeeds when both have profilePhoto", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Photo OK Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    const result = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );
    expect(result.isNew).toBe(true);
  });

  test("respondToChatRequest accept rejects when caller lacks profilePhoto", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Accept Photo Community");
    // Sender has a photo (so the request can be created), responder will get
    // their photo cleared before accepting.
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    // Clear B's profile photo so the accept-path gate fires.
    await t.run(async (ctx) => {
      await ctx.db.patch(bId, { profilePhoto: undefined });
    });

    await expect(
      t.mutation(
        api.functions.messaging.directMessages.respondToChatRequest,
        { token: bToken, channelId, response: "accept" },
      ),
    ).rejects.toThrow(/PROFILE_PHOTO_REQUIRED/);
  });
});

// ============================================================================
// renameAdHocChannel
// ============================================================================

describe("renameAdHocChannel", () => {
  test("works for an accepted member of a group_dm", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Rename Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });
    const { userId: cId } = await createUserInCommunity(t, communityId, {
      firstName: "Carol",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId, cId],
        name: "Old name",
      },
    );

    await t.mutation(
      api.functions.messaging.directMessages.renameAdHocChannel,
      { token: aToken, channelId, name: "New name" },
    );

    const channel = await t.run(async (ctx) => ctx.db.get(channelId));
    expect(channel?.name).toBe("New name");
  });

  test("rejects rename for 1:1 dm channels", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Rename DM Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, communityId, recipientUserId: bId },
    );

    await expect(
      t.mutation(
        api.functions.messaging.directMessages.renameAdHocChannel,
        { token: aToken, channelId, name: "Nope" },
      ),
    ).rejects.toThrow(/1:1|cannot be renamed/i);
  });

  test("rejects rename by a non-member", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Rename Outsider Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });
    const { accessToken: outsiderToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Outsider" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId],
        name: "Original",
      },
    );

    await expect(
      t.mutation(
        api.functions.messaging.directMessages.renameAdHocChannel,
        { token: outsiderToken, channelId, name: "Hijacked" },
      ),
    ).rejects.toThrow(/not a member/i);
  });

  test("rejects blank rename for group_dm", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Rename Blank Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId],
        name: "Original",
      },
    );

    await expect(
      t.mutation(
        api.functions.messaging.directMessages.renameAdHocChannel,
        { token: aToken, channelId, name: "   " },
      ),
    ).rejects.toThrow(/blank/i);
  });
});

// ============================================================================
// addAdHocMembers
// ============================================================================

describe("addAdHocMembers", () => {
  test("marks new members pending and respects the 20-member cap", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Add Members Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice" },
    );

    // Create initial group with 1 recipient (2 total members).
    const { userId: b0Id } = await createUserInCommunity(t, communityId, {
      firstName: "Bob0",
    });
    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [b0Id],
        name: "Cap test",
      },
    );

    // Add 18 more — total becomes 20 (at cap).
    const cappedIds: Id<"users">[] = [];
    for (let i = 1; i <= 18; i++) {
      const { userId } = await createUserInCommunity(t, communityId, {
        firstName: `Bob${i}`,
      });
      cappedIds.push(userId);
    }
    const result = await t.mutation(
      api.functions.messaging.directMessages.addAdHocMembers,
      { token: aToken, channelId, userIds: cappedIds },
    );
    expect(result.added).toBe(18);
    expect(result.skipped).toBe(0);

    // Each new member should be pending and invitedById == aId.
    for (const uId of cappedIds) {
      const m = await getMember(t, channelId, uId);
      expect(m?.requestState).toBe("pending");
      expect(m?.invitedById).toBe(aId);
    }

    // Adding a 21st member must throw at the cap.
    const { userId: extraId } = await createUserInCommunity(t, communityId, {
      firstName: "Extra",
    });
    await expect(
      t.mutation(api.functions.messaging.directMessages.addAdHocMembers, {
        token: aToken,
        channelId,
        userIds: [extraId],
      }),
    ).rejects.toThrow(/at most 20|too many/i);
  });

  test("rejects adding a non-community-member", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Add Outsider Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });
    const { userId: outsiderId } = await createUserInOtherCommunity(t, {
      firstName: "Outsider",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId],
        name: "Outsider test",
      },
    );

    await expect(
      t.mutation(api.functions.messaging.directMessages.addAdHocMembers, {
        token: aToken,
        channelId,
        userIds: [outsiderId],
      }),
    ).rejects.toThrow(/community/i);
  });

  test("idempotent for users already in the channel", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Add Idempotent Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId } = await createUserInCommunity(t, communityId, {
      firstName: "Bob",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId],
        name: "Idem test",
      },
    );

    const result = await t.mutation(
      api.functions.messaging.directMessages.addAdHocMembers,
      { token: aToken, channelId, userIds: [bId] },
    );
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

// ============================================================================
// removeAdHocMember
// ============================================================================

describe("removeAdHocMember", () => {
  test("self-remove always works", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Self Remove Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );
    const { userId: cId } = await createUserInCommunity(t, communityId, {
      firstName: "Carol",
    });

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId, cId],
        name: "Self remove",
      },
    );

    // B accepts so they're a real accepted member, then self-removes.
    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      { token: bToken, channelId, response: "accept" },
    );

    await t.mutation(
      api.functions.messaging.directMessages.removeAdHocMember,
      { token: bToken, channelId, userId: bId },
    );

    const bMember = await getMember(t, channelId, bId);
    expect(bMember?.leftAt).toBeDefined();
  });

  test("non-creator cannot remove other members; creator can", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Remove Creator Community");
    const { userId: aId, accessToken: aToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Alice" },
    );
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );
    const { userId: cId, accessToken: cToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Carol" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId, cId],
        name: "Creator privilege",
      },
    );

    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      { token: bToken, channelId, response: "accept" },
    );
    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      { token: cToken, channelId, response: "accept" },
    );

    // B (non-creator) tries to remove C.
    await expect(
      t.mutation(api.functions.messaging.directMessages.removeAdHocMember, {
        token: bToken,
        channelId,
        userId: cId,
      }),
    ).rejects.toThrow(/creator|only/i);

    // A (creator) removes C — succeeds.
    await t.mutation(
      api.functions.messaging.directMessages.removeAdHocMember,
      { token: aToken, channelId, userId: cId },
    );
    const cMember = await getMember(t, channelId, cId);
    expect(cMember?.leftAt).toBeDefined();
    // Sanity: aId is the creator we asserted privileges for.
    expect(aId).toBeDefined();
  });

  test("creator who has left cannot remove other members (stale-privilege guard)", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "Stale Privilege Community");
    const { accessToken: aToken } = await createUserInCommunity(t, communityId, {
      firstName: "Alice",
    });
    const { userId: bId, accessToken: bToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Bob" },
    );
    const { userId: cId, accessToken: cToken } = await createUserInCommunity(
      t,
      communityId,
      { firstName: "Carol" },
    );

    const { channelId } = await t.mutation(
      api.functions.messaging.directMessages.createGroupChat,
      {
        token: aToken,
        communityId,
        recipientUserIds: [bId, cId],
        name: "Stale privilege",
      },
    );
    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      { token: bToken, channelId, response: "accept" },
    );
    await t.mutation(
      api.functions.messaging.directMessages.respondToChatRequest,
      { token: cToken, channelId, response: "accept" },
    );

    // Creator A leaves the channel.
    await t.mutation(
      api.functions.messaging.directMessages.leaveAdHocChannel,
      { token: aToken, channelId },
    );

    // After leaving, A still holds the channelId but should not be able to
    // remove other members from outside the chat.
    await expect(
      t.mutation(api.functions.messaging.directMessages.removeAdHocMember, {
        token: aToken,
        channelId,
        userId: bId,
      }),
    ).rejects.toThrow(/active member/i);

    // B is still active — sanity: their membership is intact.
    const bMember = await getMember(t, channelId, bId);
    expect(bMember?.leftAt).toBeUndefined();
  });
});
