/**
 * Admin View Access Tests
 *
 * Community admins can VIEW any group's channels and read their conversations
 * without joining the group (read-only oversight). They never get a
 * `groupMembers` or `chatChannelMembers` row from viewing, so they don't appear
 * in rosters or pick up inbox / notification entries, and write paths
 * (`sendMessage`) still reject them.
 *
 * See `isCommunityAdminForGroup` / `isCommunityAdminForChannel`
 * (functions/messaging/helpers.ts) and the gates in channels.ts / messages.ts.
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

// ============================================================================
// Test fixture
// ============================================================================

interface Fixture {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  leaderUserId: Id<"users">;
  mainChannelId: Id<"chatChannels">;
  customChannelId: Id<"chatChannels">;
  leadersChannelId: Id<"chatChannels">;
}

/**
 * Builds a community with one group, a leader member, and main / custom /
 * leaders channels — each seeded with a message authored by the leader.
 */
async function seedCommunity(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  const now = Date.now();

  const communityId = await t.run(async (ctx) =>
    ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    }),
  );

  const groupTypeId = await t.run(async (ctx) =>
    ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      displayOrder: 1,
      createdAt: now,
    }),
  );

  const groupId = await t.run(async (ctx) =>
    ctx.db.insert("groups", {
      name: "Test Group",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const leaderUserId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      firstName: "Group",
      lastName: "Leader",
      phone: "+15555550010",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("groupMembers", {
      userId: id,
      groupId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });
    return id;
  });

  async function makeChannel(
    channelType: string,
    slug: string,
    name: string,
  ): Promise<Id<"chatChannels">> {
    const channelId = await t.run(async (ctx) =>
      ctx.db.insert("chatChannels", {
        groupId,
        channelType,
        name,
        slug,
        createdById: leaderUserId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
      }),
    );
    // Leader is the channel member so member-gated paths behave normally.
    await t.run(async (ctx) =>
      ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: leaderUserId,
        role: "admin",
        joinedAt: now,
        isMuted: false,
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert("chatMessages", {
        channelId,
        communityId,
        senderId: leaderUserId,
        senderName: "Group Leader",
        content: `Hello from ${name}`,
        contentType: "text",
        createdAt: now,
        lastActivityAt: now,
        isDeleted: false,
      }),
    );
    return channelId;
  }

  const mainChannelId = await makeChannel("main", "general", "General");
  const customChannelId = await makeChannel("custom", "planning", "Planning");
  const leadersChannelId = await makeChannel("leaders", "leaders", "Leaders");

  return {
    communityId,
    groupId,
    leaderUserId,
    mainChannelId,
    customChannelId,
    leadersChannelId,
  };
}

/** Community admin with NO membership in the seeded group. */
async function createAdminViewer(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
): Promise<{ userId: Id<"users">; token: string }> {
  const userId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      firstName: "Community",
      lastName: "Admin",
      phone: "+15555550020",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("userCommunities", {
      userId: id,
      communityId,
      roles: 3, // Admin
      status: 1, // Active
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
  const { accessToken } = await generateTokens(userId);
  return { userId, token: accessToken };
}

/** Plain community member with NO admin role and NO group membership. */
async function createOutsider(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
): Promise<{ userId: Id<"users">; token: string }> {
  const userId = await t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("users", {
      firstName: "Random",
      lastName: "Outsider",
      phone: "+15555550030",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: now,
      updatedAt: now,
    });
  });
  const { accessToken } = await generateTokens(userId);
  return { userId, token: accessToken };
}

// ============================================================================
// Channel listing
// ============================================================================

describe("Admin view access — channel listing", () => {
  test("admin sees all channels (incl. leaders) via listGroupChannels without joining", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const admin = await createAdminViewer(t, f.communityId);

    const channels = await t.query(
      api.functions.messaging.channels.listGroupChannels,
      { token: admin.token, groupId: f.groupId },
    );

    const types = channels.map((c) => c.channelType).sort();
    expect(types).toEqual(["custom", "leaders", "main"]);
    // Admin viewer is never recorded as a member.
    expect(channels.every((c) => c.isMember === false)).toBe(true);
  });

  test("admin sees channels via getChannelsByGroup without joining", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const admin = await createAdminViewer(t, f.communityId);

    const channels = await t.query(
      api.functions.messaging.channels.getChannelsByGroup,
      { token: admin.token, groupId: f.groupId },
    );

    const types = channels.map((c) => c.channelType).sort();
    expect(types).toContain("main");
    expect(types).toContain("custom");
    expect(types).toContain("leaders");
  });

  test("non-admin outsider sees no channels", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const outsider = await createOutsider(t, f.communityId);

    const viaList = await t.query(
      api.functions.messaging.channels.listGroupChannels,
      { token: outsider.token, groupId: f.groupId },
    );
    const viaGroup = await t.query(
      api.functions.messaging.channels.getChannelsByGroup,
      { token: outsider.token, groupId: f.groupId },
    );

    expect(viaList).toEqual([]);
    expect(viaGroup).toEqual([]);
  });
});

// ============================================================================
// Opening a channel
// ============================================================================

describe("Admin view access — opening channels", () => {
  test("admin can open main, custom and leaders channels via getChannel", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const admin = await createAdminViewer(t, f.communityId);

    for (const channelId of [
      f.mainChannelId,
      f.customChannelId,
      f.leadersChannelId,
    ]) {
      const channel = await t.query(api.functions.messaging.channels.getChannel, {
        token: admin.token,
        channelId,
      });
      expect(channel).not.toBeNull();
    }
  });

  test("admin can resolve a channel via getChannelBySlug without joining", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const admin = await createAdminViewer(t, f.communityId);

    const channel = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      { token: admin.token, groupId: f.groupId, slug: "general" },
    );

    expect(channel).not.toBeNull();
    expect(channel?.isMember).toBe(false);
  });

  test("non-admin outsider cannot open channels", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const outsider = await createOutsider(t, f.communityId);

    const byId = await t.query(api.functions.messaging.channels.getChannel, {
      token: outsider.token,
      channelId: f.mainChannelId,
    });
    const bySlug = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      { token: outsider.token, groupId: f.groupId, slug: "general" },
    );

    expect(byId).toBeNull();
    expect(bySlug).toBeNull();
  });
});

// ============================================================================
// Reading conversations
// ============================================================================

describe("Admin view access — reading messages", () => {
  test("admin can read messages in main and custom channels without joining", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const admin = await createAdminViewer(t, f.communityId);

    for (const channelId of [f.mainChannelId, f.customChannelId]) {
      const result = await t.query(
        api.functions.messaging.messages.getMessages,
        { token: admin.token, channelId },
      );
      expect(result.messages.length).toBeGreaterThan(0);
    }
  });

  test("non-admin outsider gets no messages", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const outsider = await createOutsider(t, f.communityId);

    const result = await t.query(
      api.functions.messaging.messages.getMessages,
      { token: outsider.token, channelId: f.mainChannelId },
    );
    expect(result.messages).toEqual([]);
  });

  test("admin from a DIFFERENT community cannot read messages", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);

    // Spin up a second community and make this user its admin only.
    const otherCommunityId = await t.run(async (ctx) =>
      ctx.db.insert("communities", {
        name: "Other Community",
        subdomain: "other",
        slug: "other",
        timezone: "America/New_York",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const foreignAdmin = await createAdminViewer(t, otherCommunityId);

    const result = await t.query(
      api.functions.messaging.messages.getMessages,
      { token: foreignAdmin.token, channelId: f.mainChannelId },
    );
    expect(result.messages).toEqual([]);
  });
});

// ============================================================================
// Read-only guarantees
// ============================================================================

describe("Admin view access — read-only, no side effects", () => {
  test("viewing does not create membership rows for the admin", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const admin = await createAdminViewer(t, f.communityId);

    // Exercise the full read surface.
    await t.query(api.functions.messaging.channels.listGroupChannels, {
      token: admin.token,
      groupId: f.groupId,
    });
    await t.query(api.functions.messaging.channels.getChannel, {
      token: admin.token,
      channelId: f.customChannelId,
    });
    await t.query(api.functions.messaging.messages.getMessages, {
      token: admin.token,
      channelId: f.customChannelId,
    });

    const groupRows = await t.run(async (ctx) =>
      ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", f.groupId).eq("userId", admin.userId),
        )
        .collect(),
    );
    const channelRows = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q.eq("channelId", f.customChannelId).eq("userId", admin.userId),
        )
        .collect(),
    );

    expect(groupRows).toEqual([]);
    expect(channelRows).toEqual([]);
  });

  test("admin viewer still cannot post (sendMessage rejects)", async () => {
    const t = convexTest(schema, modules);
    const f = await seedCommunity(t);
    const admin = await createAdminViewer(t, f.communityId);

    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: admin.token,
        channelId: f.mainChannelId,
        content: "admins should not be able to post without joining",
      }),
    ).rejects.toThrow();
  });
});
