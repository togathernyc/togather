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
import { api } from "../../_generated/api";
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
  opts: { firstName: string; lastName?: string },
): Promise<{ userId: Id<"users">; accessToken: string }> {
  const userId = await t.run(async (ctx) => {
    const uId = await ctx.db.insert("users", {
      firstName: opts.firstName,
      lastName: opts.lastName ?? "Tester",
      phone: uniquePhone(),
      phoneVerified: true,
      activeCommunityId: communityId,
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
  opts: { firstName: string; lastName?: string },
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
      { token: aToken, recipientUserId: bId },
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
      { token: aToken, recipientUserId: bId },
    );
    const second = await t.mutation(
      api.functions.messaging.directMessages.createOrGetDirectChannel,
      { token: aToken, recipientUserId: bId },
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

    await expect(
      t.mutation(
        api.functions.messaging.directMessages.createOrGetDirectChannel,
        { token: aToken, recipientUserId: bId },
      ),
    ).rejects.toThrow(/communities/i);
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
      { token: aToken, recipientUserId: bId },
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
      { token: aToken, recipientUserId: bId },
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
      { token: aToken, recipientUserId: bId },
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
      { token: aToken, recipientUserId: bId },
    );

    // First message succeeds.
    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: aToken,
      channelId,
      content: "hello",
    });
    await t.finishAllScheduledFunctions(() => {});

    // Second send should be rate-limited.
    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: aToken,
        channelId,
        content: "hello again",
      }),
    ).rejects.toThrow(/1 message|accept/i);
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
      { token: aToken, recipientUserId: bId },
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
      { token: aToken, recipientUserId: bId },
    );

    await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: aToken,
      channelId,
      content: "hi",
    });
    await t.finishAllScheduledFunctions(() => {});

    const requests = await t.query(
      api.functions.messaging.directMessages.listChatRequests,
      { token: bToken },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].channelId).toBe(channelId);
    expect(requests[0].channelType).toBe("dm");
    expect(requests[0].inviterUserId).toBe(aId);
    expect(requests[0].firstMessagePreview).toBe("hi");
    expect(requests[0].inviterDisplayName.toLowerCase()).toContain("alice");
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
      { token: aToken, recipientUserId: bId },
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
