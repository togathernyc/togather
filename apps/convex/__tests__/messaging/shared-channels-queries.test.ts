/**
 * Shared Channel Query Tests
 *
 * Tests that shared channels appear correctly in queries when accessed from
 * both primary and secondary groups. Covers getChannelBySlug fallback,
 * getInboxChannels grouping, and listGroupChannels inclusion.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

afterEach(() => {
  vi.clearAllTimers();
});

// ============================================================================
// Test Helpers
// ============================================================================

interface SharedChannelTestData {
  userId: Id<"users">;
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupAId: Id<"groups">; // primary group
  groupBId: Id<"groups">; // secondary group
  sharedChannelId: Id<"chatChannels">;
  accessToken: string;
}

/**
 * Seeds two groups, a shared channel owned by Group A, and a user who is a
 * member of both groups and the shared channel. The shared channel has Group B
 * listed in sharedGroups with the given status.
 */
async function seedSharedChannelData(
  t: ReturnType<typeof convexTest>,
  sharedGroupStatus: string = "accepted"
): Promise<SharedChannelTestData> {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test",
      slug: "test",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const groupTypeId = await t.run(async (ctx) => {
    return await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Groups",
      slug: "small-groups",
      isActive: true,
      displayOrder: 1,
      createdAt: Date.now(),
    });
  });

  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Test",
      lastName: "User",
      phone: "+15555550001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Group A (primary - owns the shared channel)
  const groupAId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Group A",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // Group B (secondary - shared channel is shared with this group)
  const groupBId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Group B",
      communityId,
      groupTypeId,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  // User is a member of both groups
  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId,
      groupId: groupAId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      userId,
      groupId: groupBId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });

  // Create shared channel in Group A
  const sharedChannelId = await t.run(async (ctx) => {
    return await ctx.db.insert("chatChannels", {
      groupId: groupAId,
      slug: "shared-events",
      channelType: "custom",
      name: "Shared Events",
      createdById: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      memberCount: 1,
      isShared: true,
      sharedGroups: [
        {
          groupId: groupBId,
          status: sharedGroupStatus,
          invitedById: userId,
          invitedAt: Date.now(),
        },
      ],
    });
  });

  // User is a channel member
  await t.run(async (ctx) => {
    await ctx.db.insert("chatChannelMembers", {
      channelId: sharedChannelId,
      userId,
      role: "member",
      joinedAt: Date.now(),
      isMuted: false,
    });
  });

  const { accessToken } = await generateTokens(userId);

  return {
    userId,
    communityId,
    groupTypeId,
    groupAId,
    groupBId,
    sharedChannelId,
    accessToken,
  };
}

// ============================================================================
// getChannelBySlug — shared channel fallback
// ============================================================================

describe("getChannelBySlug — shared channel fallback", () => {
  test("normal (non-shared) channel lookup works as before", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t);

    // Create a normal channel in Group A
    const normalChannelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId: data.groupAId,
        slug: "normal-channel",
        channelType: "custom",
        name: "Normal Channel",
        createdById: data.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: normalChannelId,
        userId: data.userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    const result = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: data.accessToken,
        groupId: data.groupAId,
        slug: "normal-channel",
      }
    );

    expect(result).not.toBeNull();
    expect(result!._id).toBe(normalChannelId);
    expect(result!.slug).toBe("normal-channel");
  });

  test("shared channel accessed from primary group works via by_group_slug", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t);

    const result = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: data.accessToken,
        groupId: data.groupAId,
        slug: "shared-events",
      }
    );

    expect(result).not.toBeNull();
    expect(result!._id).toBe(data.sharedChannelId);
    expect(result!.slug).toBe("shared-events");
  });

  test("shared channel accessed from SECONDARY group works via fallback", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    // Accessing shared channel using Group B's ID (the secondary group)
    const result = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: data.accessToken,
        groupId: data.groupBId,
        slug: "shared-events",
      }
    );

    expect(result).not.toBeNull();
    expect(result!._id).toBe(data.sharedChannelId);
    expect(result!.slug).toBe("shared-events");
    expect(result!.isMember).toBe(true);
  });

  test("shared channel accessed from secondary group with pending status returns null", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "pending");

    const result = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: data.accessToken,
        groupId: data.groupBId,
        slug: "shared-events",
      }
    );

    expect(result).toBeNull();
  });

  test("user who is not a channel member cannot access shared channel from secondary group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    // Create a second user who is in Group B but NOT in the shared channel
    const otherUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Other",
        lastName: "User",
        phone: "+15555550099",
        phoneVerified: true,
        activeCommunityId: data.communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId: otherUserId,
        groupId: data.groupBId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
    });

    const { accessToken: otherToken } = await generateTokens(otherUserId);

    const result = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: otherToken,
        groupId: data.groupBId,
        slug: "shared-events",
      }
    );

    // Should be null because the user is not a channel member
    expect(result).toBeNull();
  });
});

// ============================================================================
// getInboxChannels — shared channels appear under secondary groups
// ============================================================================

describe("getInboxChannels — shared channels in secondary groups", () => {
  test("shared channel appears under the primary group section", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    );

    // Find Group A in the results
    const groupAEntry = result.find(
      (entry: { group: { _id: Id<"groups"> } }) =>
        entry.group._id === data.groupAId
    );
    expect(groupAEntry).toBeDefined();

    // The shared channel should appear under Group A
    const sharedInA = groupAEntry!.channels.find(
      (ch: { _id: Id<"chatChannels"> }) => ch._id === data.sharedChannelId
    );
    expect(sharedInA).toBeDefined();
  });

  test("shared channel ALSO appears under secondary group section", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    );

    // Find Group B in the results
    const groupBEntry = result.find(
      (entry: { group: { _id: Id<"groups"> } }) =>
        entry.group._id === data.groupBId
    );
    expect(groupBEntry).toBeDefined();

    // The shared channel should also appear under Group B
    const sharedInB = groupBEntry!.channels.find(
      (ch: { _id: Id<"chatChannels"> }) => ch._id === data.sharedChannelId
    );
    expect(sharedInB).toBeDefined();
  });

  test("shared channel does NOT appear under group with pending status", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "pending");

    const result = await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    );

    // Group B should either not appear or should not contain the shared channel
    const groupBEntry = result.find(
      (entry: { group: { _id: Id<"groups"> } }) =>
        entry.group._id === data.groupBId
    );

    if (groupBEntry) {
      const sharedInB = groupBEntry.channels.find(
        (ch: { _id: Id<"chatChannels"> }) => ch._id === data.sharedChannelId
      );
      expect(sharedInB).toBeUndefined();
    }
  });

  test("isShared flag is included in channel response", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    );

    // Check that the shared channel in Group B has isShared flag
    const groupBEntry = result.find(
      (entry: { group: { _id: Id<"groups"> } }) =>
        entry.group._id === data.groupBId
    );
    expect(groupBEntry).toBeDefined();

    const sharedInB = groupBEntry!.channels.find(
      (ch: { _id: Id<"chatChannels"> }) => ch._id === data.sharedChannelId
    );
    expect(sharedInB).toBeDefined();
    expect((sharedInB as Record<string, unknown>).isShared).toBe(true);
  });
});

// ============================================================================
// listGroupChannels — includes shared channels
// ============================================================================

describe("listGroupChannels — includes shared channels", () => {
  test("lists channels owned by the group (existing behavior unchanged)", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    // Create a normal channel in Group B
    const normalChannelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId: data.groupBId,
        slug: "group-b-chat",
        channelType: "main",
        name: "General",
        createdById: data.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: normalChannelId,
        userId: data.userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    const result = await t.query(
      api.functions.messaging.channels.listGroupChannels,
      {
        token: data.accessToken,
        groupId: data.groupBId,
      }
    );

    // Should contain the normal channel
    const normalCh = result.find(
      (ch: { _id: Id<"chatChannels"> }) => ch._id === normalChannelId
    );
    expect(normalCh).toBeDefined();
  });

  test("ALSO lists shared channels where this group is in sharedGroups with accepted status", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = await t.query(
      api.functions.messaging.channels.listGroupChannels,
      {
        token: data.accessToken,
        groupId: data.groupBId,
      }
    );

    // Should include the shared channel from Group A
    const sharedCh = result.find(
      (ch: { _id: Id<"chatChannels"> }) => ch._id === data.sharedChannelId
    );
    expect(sharedCh).toBeDefined();
    expect(sharedCh!.isShared).toBe(true);
  });

  test("shared channels include isShared: true in response", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = await t.query(
      api.functions.messaging.channels.listGroupChannels,
      {
        token: data.accessToken,
        groupId: data.groupAId, // primary group
      }
    );

    const sharedCh = result.find(
      (ch: { _id: Id<"chatChannels"> }) => ch._id === data.sharedChannelId
    );
    expect(sharedCh).toBeDefined();
    // On the primary group, isShared should also be true
    expect(sharedCh!.isShared).toBe(true);
  });

  test("shared channels from pending groups are NOT included", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "pending");

    const result = await t.query(
      api.functions.messaging.channels.listGroupChannels,
      {
        token: data.accessToken,
        groupId: data.groupBId,
      }
    );

    // Should NOT include the shared channel since status is pending
    const sharedCh = result.find(
      (ch: { _id: Id<"chatChannels"> }) => ch._id === data.sharedChannelId
    );
    expect(sharedCh).toBeUndefined();
  });
});
