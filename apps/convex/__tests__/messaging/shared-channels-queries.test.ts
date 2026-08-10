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
// getInboxChannels — shared channels are de-duplicated across groups
// ============================================================================

type InboxEntry = {
  group: { _id: Id<"groups"> };
  channels: Array<{ _id: Id<"chatChannels">; isShared?: boolean }>;
};

/** Every (group, channel) pairing where the given channel appears. */
function findChannelAppearances(
  result: InboxEntry[],
  channelId: Id<"chatChannels">
): InboxEntry[] {
  return result.filter((entry) =>
    entry.channels.some((ch) => ch._id === channelId)
  );
}

describe("getInboxChannels — shared channels are de-duplicated", () => {
  test("a shared channel appears exactly once even when the user is in both groups", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = (await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    )) as InboxEntry[];

    // Previously the channel showed up under BOTH Group A and Group B. It must
    // now render under a single group only.
    const appearances = findChannelAppearances(result, data.sharedChannelId);
    expect(appearances).toHaveLength(1);
  });

  test("with no other activity the shared channel stays under its primary group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = (await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    )) as InboxEntry[];

    const appearances = findChannelAppearances(result, data.sharedChannelId);
    expect(appearances).toHaveLength(1);
    // Group A owns the channel and has no competing activity, so it wins the tie.
    expect(appearances[0].group._id).toBe(data.groupAId);
  });

  test("the most-recently-active group keeps the shared channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    // Give Group B a recently-active General channel so Group B sorts ahead of
    // Group A in the inbox. The shared channel should follow the user's most
    // active group.
    const groupBMainId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("chatChannels", {
        groupId: data.groupBId,
        slug: "group-b-general",
        channelType: "main",
        name: "General",
        createdById: data.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
        lastMessageAt: Date.now(),
        lastMessagePreview: "Recent message in B",
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: id,
        userId: data.userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
      return id;
    });

    const result = (await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    )) as InboxEntry[];

    const appearances = findChannelAppearances(result, data.sharedChannelId);
    expect(appearances).toHaveLength(1);
    expect(appearances[0].group._id).toBe(data.groupBId);
    // Sanity check: Group B's own General channel is unaffected by the dedup.
    expect(
      result
        .find((e) => e.group._id === data.groupBId)
        ?.channels.some((ch) => ch._id === groupBMainId)
    ).toBe(true);
  });

  test("groups are re-ordered by remaining visible activity after dedup", async () => {
    // Regression: the shared channel's recency must not leave a group that
    // *lost* the duplicate pinned above groups whose visible channels are newer.
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");
    const now = Date.now();

    // The shared channel (owned by Group A) is the most recent thing anywhere.
    await t.run(async (ctx) => {
      await ctx.db.patch(data.sharedChannelId, { lastMessageAt: now });
    });

    // Group B shares the channel but its own General is the OLDEST activity.
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("chatChannels", {
        groupId: data.groupBId,
        slug: "group-b-general",
        channelType: "main",
        name: "General",
        createdById: data.userId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
        lastMessageAt: now - 60 * 60_000, // 1h ago
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: id,
        userId: data.userId,
        role: "member",
        joinedAt: now,
        isMuted: false,
      });
    });

    // Group C does NOT share the channel; its General is newer than Group B's
    // but older than the shared channel.
    const groupCId = await t.run(async (ctx) => {
      const gid = await ctx.db.insert("groups", {
        name: "Group C",
        communityId: data.communityId,
        groupTypeId: data.groupTypeId,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("groupMembers", {
        userId: data.userId,
        groupId: gid,
        role: "member",
        joinedAt: now,
        notificationsEnabled: true,
      });
      const id = await ctx.db.insert("chatChannels", {
        groupId: gid,
        slug: "group-c-general",
        channelType: "main",
        name: "General",
        createdById: data.userId,
        createdAt: now,
        updatedAt: now,
        isArchived: false,
        memberCount: 1,
        lastMessageAt: now - 10 * 60_000, // 10m ago
      });
      await ctx.db.insert("chatChannelMembers", {
        channelId: id,
        userId: data.userId,
        role: "member",
        joinedAt: now,
        isMuted: false,
      });
      return gid;
    });

    const result = (await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    )) as InboxEntry[];

    // Shared channel still appears once, under Group A (its most-recent home).
    const appearances = findChannelAppearances(result, data.sharedChannelId);
    expect(appearances).toHaveLength(1);
    expect(appearances[0].group._id).toBe(data.groupAId);

    // Final order must reflect visible channels: A (shared, now) > C (10m) > B
    // (1h). Without the post-dedup re-sort, B would stay ahead of C.
    const order = result.map((e) => e.group._id);
    expect(order.indexOf(data.groupAId)).toBeLessThan(order.indexOf(groupCId));
    expect(order.indexOf(groupCId)).toBeLessThan(order.indexOf(data.groupBId));
  });

  test("a pending secondary group never receives the shared channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "pending");

    const result = (await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    )) as InboxEntry[];

    // The owner group (A) still shows the channel — the user is a member there.
    // The pending secondary group (B) must not, so it still appears only once.
    const appearances = findChannelAppearances(result, data.sharedChannelId);
    expect(appearances).toHaveLength(1);
    expect(appearances[0].group._id).toBe(data.groupAId);
    const groupBEntry = result.find((e) => e.group._id === data.groupBId);
    expect(
      groupBEntry?.channels.some((ch) => ch._id === data.sharedChannelId) ??
        false
    ).toBe(false);
  });

  test("isShared flag is included on the single channel response", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = (await t.query(
      api.functions.messaging.channels.getInboxChannels,
      {
        token: data.accessToken,
        communityId: data.communityId,
      }
    )) as InboxEntry[];

    const appearances = findChannelAppearances(result, data.sharedChannelId);
    expect(appearances).toHaveLength(1);
    const shared = appearances[0].channels.find(
      (ch) => ch._id === data.sharedChannelId
    );
    expect(shared?.isShared).toBe(true);
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

// ============================================================================
// getChannelBySlug — pending shared-invite fallback (leaders only)
// ============================================================================

/**
 * Adds a leader of the secondary group (Group B) who is NOT a channel member.
 * Used to exercise the pending-invite fallback, which is gated to leaders.
 */
async function addSecondaryGroupLeader(
  t: ReturnType<typeof convexTest>,
  data: SharedChannelTestData
): Promise<string> {
  const leaderId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      firstName: "Leader",
      lastName: "B",
      phone: "+15555550042",
      phoneVerified: true,
      activeCommunityId: data.communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("groupMembers", {
      userId: leaderId,
      groupId: data.groupBId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
  });
  const { accessToken } = await generateTokens(leaderId);
  return accessToken;
}

describe("getChannelBySlug — pending shared-invite fallback", () => {
  test("leader of invited group resolves a PENDING shared channel with the flag", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "pending");
    const leaderToken = await addSecondaryGroupLeader(t, data);

    const result = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: leaderToken,
        groupId: data.groupBId,
        slug: "shared-events",
      }
    );

    expect(result).not.toBeNull();
    expect(result!._id).toBe(data.sharedChannelId);
    expect((result as Record<string, unknown>).pendingShareForGroup).toBe(true);
    // The owning group's name is surfaced for the invitation prompt.
    expect((result as Record<string, unknown>).primaryGroupName).toBe("Group A");
    // Leader isn't a channel member yet — they accept first.
    expect(result!.isMember).toBe(false);
  });

  test("non-leader member of invited group still cannot resolve a pending channel", async () => {
    const t = convexTest(schema, modules);
    // The seeded user is a plain member of both groups.
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

  test("accepted shared channel is not flagged as a pending invite", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");

    const result = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: data.accessToken,
        groupId: data.groupBId,
        slug: "shared-events",
      }
    );

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).pendingShareForGroup).toBe(false);
  });

  test("leader of an ACCEPTED secondary group resolves the channel without channel membership", async () => {
    // Regression for the accept-from-info flow: respondToChannelInvite only
    // flips the sharedGroups status, it doesn't add the leader as a channel
    // member. A leader who accepts must still be able to load the channel info
    // screen afterwards rather than getting "channel no longer available".
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "accepted");
    const leaderToken = await addSecondaryGroupLeader(t, data);

    const result = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: leaderToken,
        groupId: data.groupBId,
        slug: "shared-events",
      }
    );

    expect(result).not.toBeNull();
    expect(result!._id).toBe(data.sharedChannelId);
    // Resolved via the leader fallback, not as a pending invite.
    expect((result as Record<string, unknown>).pendingShareForGroup).toBe(false);
    expect(result!.isMember).toBe(false);
  });
});

// ============================================================================
// getChannelBySlug — channelId disambiguates same-slug shared invites
// ============================================================================

describe("getChannelBySlug — channelId disambiguator", () => {
  test("resolves the channel matching channelId when two pending invites share a slug", async () => {
    const t = convexTest(schema, modules);
    // Group A → "shared-events" pending to Group B.
    const data = await seedSharedChannelData(t, "pending");
    const leaderToken = await addSecondaryGroupLeader(t, data);

    // A second primary group (Group C) owns a DIFFERENT channel that happens to
    // use the same slug, also invited to Group B.
    const groupCId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Group C",
        communityId: data.communityId,
        groupTypeId: data.groupTypeId,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const secondChannelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId: groupCId,
        slug: "shared-events",
        channelType: "custom",
        name: "Other Events",
        createdById: data.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 1,
        isShared: true,
        sharedGroups: [
          {
            groupId: data.groupBId,
            status: "pending",
            invitedById: data.userId,
            invitedAt: Date.now(),
          },
        ],
      });
    });

    // channelId picks the exact channel, not just the first slug match.
    const second = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: leaderToken,
        groupId: data.groupBId,
        slug: "shared-events",
        channelId: secondChannelId,
      }
    );
    expect(second!._id).toBe(secondChannelId);

    const first = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: leaderToken,
        groupId: data.groupBId,
        slug: "shared-events",
        channelId: data.sharedChannelId,
      }
    );
    expect(first!._id).toBe(data.sharedChannelId);
  });

  test("channelId resolves the shared invite even when the invited group owns a same-slug local channel", async () => {
    const t = convexTest(schema, modules);
    // Group A owns "shared-events", pending to Group B.
    const data = await seedSharedChannelData(t, "pending");
    const leaderToken = await addSecondaryGroupLeader(t, data);

    // Group B ALSO owns a local channel with the SAME slug.
    const localChannelId = await t.run(async (ctx) => {
      return await ctx.db.insert("chatChannels", {
        groupId: data.groupBId,
        slug: "shared-events",
        channelType: "custom",
        name: "Group B Local",
        createdById: data.userId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isArchived: false,
        memberCount: 0,
      });
    });

    // Without a channelId hint, the local same-slug channel wins (by_group_slug).
    const local = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: leaderToken,
        groupId: data.groupBId,
        slug: "shared-events",
      }
    );
    expect(local!._id).toBe(localChannelId);

    // With the invite's channelId, the local match must not shadow it — the
    // shared (Group A) channel resolves and is flagged as a pending invite.
    const shared = await t.query(
      api.functions.messaging.channels.getChannelBySlug,
      {
        token: leaderToken,
        groupId: data.groupBId,
        slug: "shared-events",
        channelId: data.sharedChannelId,
      }
    );
    expect(shared!._id).toBe(data.sharedChannelId);
    expect((shared as Record<string, unknown>).pendingShareForGroup).toBe(true);
  });
});

// ============================================================================
// listPendingInvitesForGroup — payload includes channelSlug for deep-linking
// ============================================================================

describe("listPendingInvitesForGroup — channelSlug", () => {
  test("includes channelSlug so the row can route to the channel info screen", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSharedChannelData(t, "pending");
    const leaderToken = await addSecondaryGroupLeader(t, data);

    const result = await t.query(
      api.functions.messaging.sharedChannels.listPendingInvitesForGroup,
      {
        token: leaderToken,
        groupId: data.groupBId,
      }
    );

    expect(result).toHaveLength(1);
    expect(result[0].channelId).toBe(data.sharedChannelId);
    expect(result[0].channelSlug).toBe("shared-events");
  });
});
