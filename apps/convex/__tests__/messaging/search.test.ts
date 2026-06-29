/**
 * Inbox message search tests.
 *
 * Covers: matching message bodies, community + channel-access scoping,
 * exclusion of soft-deleted / system / blocked-sender messages, and the
 * minimum-query-length guard.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

type Ctx = ReturnType<typeof convexTest>;

async function createCommunity(t: Ctx, subdomain: string): Promise<Id<"communities">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("communities", {
      name: `Community ${subdomain}`,
      subdomain,
      slug: subdomain,
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function createUser(
  t: Ctx,
  communityId: Id<"communities">,
  firstName: string,
): Promise<{ userId: Id<"users">; accessToken: string }> {
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      firstName,
      lastName: "User",
      phone: `+1555${Math.floor(Math.random() * 10_000_000).toString().padStart(7, "0")}`,
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const { accessToken } = await generateTokens(userId);
  return { userId, accessToken };
}

async function createGroupWithChannel(
  t: Ctx,
  communityId: Id<"communities">,
  userId: Id<"users">,
  opts: { role?: string; channelType?: string; channelName?: string } = {},
): Promise<{ groupId: Id<"groups">; channelId: Id<"chatChannels"> }> {
  const groupTypeId = await t.run(async (ctx) =>
    ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: `small-groups-${Math.random().toString(36).slice(2, 8)}`,
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    }),
  );

  const groupId = await t.run(async (ctx) =>
    ctx.db.insert("groups", {
      name: "Test Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );

  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId,
      role: opts.role ?? "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  const channelId = await t.run(async (ctx) =>
    ctx.db.insert("chatChannels", {
      groupId,
      channelType: opts.channelType ?? "main",
      name: opts.channelName ?? "General",
      slug: `general-${Math.random().toString(36).slice(2, 8)}`,
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
      role: opts.role ?? "member",
      joinedAt: Date.now(),
      isMuted: false,
    });
  });

  return { groupId, channelId };
}

async function insertMessage(
  t: Ctx,
  channelId: Id<"chatChannels">,
  content: string,
  opts: {
    senderId?: Id<"users">;
    senderName?: string;
    contentType?: string;
    isDeleted?: boolean;
  } = {},
): Promise<Id<"chatMessages">> {
  return await t.run(async (ctx) => {
    // Derive communityId from the channel exactly like production writes do, so
    // the community-scoped search index can find the message.
    const channel = await ctx.db.get(channelId);
    let communityId = channel?.communityId;
    if (!communityId && channel?.groupId) {
      const group = await ctx.db.get(channel.groupId);
      communityId = group?.communityId ?? undefined;
    }
    return ctx.db.insert("chatMessages", {
      channelId,
      communityId,
      senderId: opts.senderId,
      senderName: opts.senderName ?? "Sender",
      content,
      contentType: opts.contentType ?? "text",
      createdAt: Date.now(),
      isDeleted: opts.isDeleted ?? false,
    });
  });
}

describe("searchMessages", () => {
  test("returns messages matching the query in the user's channel", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "alpha");
    const { userId, accessToken } = await createUser(t, communityId, "Alice");
    const { channelId } = await createGroupWithChannel(t, communityId, userId);

    await insertMessage(t, channelId, "Let's plan the picnic on Saturday");
    await insertMessage(t, channelId, "Unrelated message about parking");

    const { results } = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "picnic",
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("picnic");
    expect(results[0].channelId).toBe(channelId);
  });

  test("does not return messages from channels the user cannot access", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "beta");
    const { accessToken } = await createUser(t, communityId, "Alice");
    // Another user owns a separate group/channel that Alice is NOT a member of.
    const { userId: bobId } = await createUser(t, communityId, "Bob");
    const { channelId: bobChannel } = await createGroupWithChannel(
      t,
      communityId,
      bobId,
    );

    await insertMessage(t, bobChannel, "secret picnic planning");

    const { results } = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "picnic",
    });

    expect(results).toHaveLength(0);
  });

  test("does not return messages from other communities", async () => {
    const t = convexTest(schema, modules);
    const homeCommunity = await createCommunity(t, "home");
    const otherCommunity = await createCommunity(t, "other");
    const { userId, accessToken } = await createUser(t, homeCommunity, "Alice");

    // Channel in a different community that Alice somehow has a membership row in.
    const { channelId: otherChannel } = await createGroupWithChannel(
      t,
      otherCommunity,
      userId,
    );
    await insertMessage(t, otherChannel, "picnic in the other community");

    const { results } = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId: homeCommunity,
      query: "picnic",
    });

    expect(results).toHaveLength(0);
  });

  test("excludes deleted and system messages", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "gamma");
    const { userId, accessToken } = await createUser(t, communityId, "Alice");
    const { channelId } = await createGroupWithChannel(t, communityId, userId);

    await insertMessage(t, channelId, "deleted picnic note", { isDeleted: true });
    await insertMessage(t, channelId, "picnic system notice", {
      contentType: "system",
    });
    await insertMessage(t, channelId, "real picnic message");

    const { results } = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "picnic",
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("real picnic message");
  });

  test("excludes messages from blocked senders", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "delta");
    const { userId, accessToken } = await createUser(t, communityId, "Alice");
    const { userId: bobId } = await createUser(t, communityId, "Bob");
    const { channelId } = await createGroupWithChannel(t, communityId, userId);

    await insertMessage(t, channelId, "picnic from blocked bob", {
      senderId: bobId,
      senderName: "Bob",
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("chatUserBlocks", {
        blockerId: userId,
        blockedId: bobId,
        createdAt: Date.now(),
      });
    });

    const { results } = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "picnic",
    });

    expect(results).toHaveLength(0);
  });

  test("returns a back-compat slug for legacy channels without a slug", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "zeta");
    const { userId, accessToken } = await createUser(t, communityId, "Alice");

    // A "main" group channel with no slug set (legacy data).
    const groupTypeId = await t.run(async (ctx) =>
      ctx.db.insert("groupTypes", {
        communityId,
        name: "Small Groups",
        slug: "small-groups-zeta",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
      }),
    );
    const groupId = await t.run(async (ctx) =>
      ctx.db.insert("groups", {
        name: "Legacy Group",
        communityId,
        groupTypeId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId,
        groupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });
    const channelId = await t.run(async (ctx) =>
      ctx.db.insert("chatChannels", {
        groupId,
        channelType: "main",
        name: "General",
        // no slug
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
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });
    await insertMessage(t, channelId, "picnic in the legacy channel");

    const { results } = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "picnic",
    });

    expect(results).toHaveLength(1);
    // "main" channels fall back to the "general" slug, never null.
    expect(results[0].channelSlug).toBe("general");
  });

  test("hides a shared channel a linked group has hidden from its members", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "eta");
    const groupTypeId = await t.run(async (ctx) =>
      ctx.db.insert("groupTypes", {
        communityId,
        name: "Small Groups",
        slug: "small-groups-eta",
        isActive: true,
        displayOrder: 1,
        createdAt: Date.now(),
      }),
    );

    // Owning group (owned by Bob) and a linked group (Alice is a non-leader member).
    const ownerId = (await createUser(t, communityId, "Bob")).userId;
    const { userId: aliceId, accessToken } = await createUser(t, communityId, "Alice");

    const ownerGroupId = await t.run(async (ctx) =>
      ctx.db.insert("groups", {
        name: "Owner Group",
        communityId,
        groupTypeId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const linkedGroupId = await t.run(async (ctx) =>
      ctx.db.insert("groups", {
        name: "Linked Group",
        communityId,
        groupTypeId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId: aliceId,
        groupId: linkedGroupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    // Shared custom channel owned by ownerGroup, shared (accepted) with the
    // linked group but hidden from that group's navigation.
    const channelId = await t.run(async (ctx) =>
      ctx.db.insert("chatChannels", {
        groupId: ownerGroupId,
        channelType: "custom",
        name: "Shared Hidden",
        slug: "shared-hidden",
        createdById: ownerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        isEnabled: true,
        isShared: true,
        sharedGroups: [
          {
            groupId: linkedGroupId,
            status: "accepted",
            invitedById: ownerId,
            invitedAt: Date.now(),
            hiddenFromNavigation: true,
          },
        ],
        memberCount: 1,
      }),
    );
    // Alice has a membership row on the shared channel.
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: aliceId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });
    await insertMessage(t, channelId, "picnic in a hidden shared channel");

    const { results } = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "picnic",
    });

    expect(results).toHaveLength(0);
  });

  test("backfill populates communityId so legacy messages become searchable", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "theta");
    const { userId, accessToken } = await createUser(t, communityId, "Alice");
    const { channelId } = await createGroupWithChannel(t, communityId, userId);

    // Legacy row written before the field existed: no communityId.
    await t.run(async (ctx) => {
      await ctx.db.insert("chatMessages", {
        channelId,
        content: "legacy picnic message",
        contentType: "text",
        createdAt: Date.now(),
        isDeleted: false,
      });
    });

    // Not yet searchable — the community-scoped index can't match a null
    // communityId.
    const before = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "picnic",
    });
    expect(before.results).toHaveLength(0);

    // Large batch → completes in a single page (no self-reschedule).
    const result = await t.mutation(
      internal.functions.admin.migrations.backfillMessageCommunityId,
      { batchSize: 1000 },
    );
    expect(result.patched).toBe(1);

    const after = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "picnic",
    });
    expect(after.results).toHaveLength(1);
  });

  test("returns nothing for queries below the minimum length", async () => {
    const t = convexTest(schema, modules);
    const communityId = await createCommunity(t, "epsilon");
    const { userId, accessToken } = await createUser(t, communityId, "Alice");
    const { channelId } = await createGroupWithChannel(t, communityId, userId);
    await insertMessage(t, channelId, "picnic");

    const { results } = await t.query(api.functions.messaging.search.searchMessages, {
      token: accessToken,
      communityId,
      query: "a",
    });

    expect(results).toHaveLength(0);
  });
});
