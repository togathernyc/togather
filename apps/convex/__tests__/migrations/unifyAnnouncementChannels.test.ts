/**
 * Tests for the announcement-channel unification backfill.
 *
 * Verifies that an announcement group's legacy "general" (main) channel is
 * converted IN PLACE into a leaders-only "announcements" channel (preserving
 * messages + members), and a fresh, empty, everyone-can-post "general" channel
 * is created in its place.
 */

import { convexTest } from "convex-test";
import { expect, test, describe, afterEach, vi } from "vitest";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import { generateTokens } from "../../lib/auth";
import type { Id } from "../../_generated/dataModel";

// sendMessage end-to-end coverage needs a JWT secret for token generation.
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

// The migration and toggles populate channel members via `ctx.scheduler`
// batches, and `sendMessage` enqueues deferred jobs. Fake timers let us drain
// those chains deterministically with `finishAllScheduledFunctions`.
vi.useFakeTimers();

let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishAllScheduledFunctions(vi.runAllTimers);
    activeHandle = null;
  }
  vi.clearAllTimers();
});

interface Seeded {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  leaderId: Id<"users">;
  memberId: Id<"users">;
  oldGeneralId: Id<"chatChannels">;
  messageIds: Id<"chatMessages">[];
}

async function seedAnnouncementGroup(
  t: ReturnType<typeof convexTest>
): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Fount",
      subdomain: "fount",
      slug: "fount",
      timezone: "America/New_York",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Announcements",
      slug: "announcements",
      isActive: true,
      displayOrder: 0,
      createdAt: Date.now(),
    });

    const leaderId = await ctx.db.insert("users", {
      firstName: "Lead",
      lastName: "Er",
      phone: "+15555551000",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const memberId = await ctx.db.insert("users", {
      firstName: "Mem",
      lastName: "Ber",
      phone: "+15555551001",
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const groupId = await ctx.db.insert("groups", {
      name: "Fount",
      communityId,
      groupTypeId,
      isAnnouncementGroup: true,
      isPublic: true,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await ctx.db.insert("groupMembers", {
      userId: leaderId,
      groupId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      userId: memberId,
      groupId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });

    // Legacy general channel (leaders-only via old frontend gate) with both
    // community members as channel members and a couple of leader posts.
    const oldGeneralId = await ctx.db.insert("chatChannels", {
      groupId,
      channelType: "main",
      name: "Fount - General",
      slug: "general",
      createdById: leaderId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      memberCount: 2,
    });

    for (const userId of [leaderId, memberId]) {
      await ctx.db.insert("chatChannelMembers", {
        channelId: oldGeneralId,
        userId,
        role: userId === leaderId ? "admin" : "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    }

    const messageIds: Id<"chatMessages">[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await ctx.db.insert("chatMessages", {
        channelId: oldGeneralId,
        senderId: leaderId,
        content: `Announcement ${i}`,
        contentType: "text",
        createdAt: Date.now() + i,
        isDeleted: false,
      });
      messageIds.push(id);
    }

    return { communityId, groupId, leaderId, memberId, oldGeneralId, messageIds };
  });
}

async function channelsForGroup(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("chatChannels")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
  });
}

describe("migrateAnnouncementGroupChannels", () => {
  test("converts general -> announcements in place and creates a fresh general", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const seeded = await seedAnnouncementGroup(t);

    const result = await t.mutation(
      internal.functions.migrations.unifyAnnouncementChannels
        .migrateAnnouncementGroupChannels,
      { communityId: seeded.communityId }
    );

    expect(result.groupsProcessed).toBe(1);
    expect(result.results[0].status).toBe("migrated");

    // The original channel is now the announcements channel, with messages intact.
    const converted = await t.run((ctx) => ctx.db.get(seeded.oldGeneralId));
    expect(converted?.channelType).toBe("announcements");
    expect(converted?.slug).toBe("announcements");

    const keptMessages = await t.run(async (ctx) =>
      ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", seeded.oldGeneralId))
        .collect()
    );
    expect(keptMessages.map((m) => m._id).sort()).toEqual(
      seeded.messageIds.sort()
    );

    // The old channel members are still attached.
    const announcementMembers = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", seeded.oldGeneralId))
        .collect()
    );
    expect(announcementMembers).toHaveLength(2);

    // Exactly one fresh general (main) channel exists, empty of messages.
    const channels = await channelsForGroup(t, seeded.groupId);
    const mains = channels.filter((c) => c.channelType === "main");
    const announcements = channels.filter(
      (c) => c.channelType === "announcements"
    );
    expect(announcements).toHaveLength(1);
    expect(mains).toHaveLength(1);
    expect(mains[0]._id).not.toBe(seeded.oldGeneralId);
    expect(mains[0].slug).toBe("general");

    const newGeneralMessages = await t.run(async (ctx) =>
      ctx.db
        .query("chatMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", mains[0]._id))
        .collect()
    );
    expect(newGeneralMessages).toHaveLength(0);

    // Membership population for the new general channel runs in scheduled
    // batches (whole-community groups can't be populated inline) — drain them.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Both active members were added to the new general channel.
    const newGeneralMembers = await t.run(async (ctx) =>
      ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", mains[0]._id))
        .collect()
    );
    expect(newGeneralMembers).toHaveLength(2);

    const refreshedGeneral = await t.run((ctx) => ctx.db.get(mains[0]._id));
    expect(refreshedGeneral?.memberCount).toBe(2);
  });

  test("is idempotent — a second run is a no-op", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const seeded = await seedAnnouncementGroup(t);

    await t.mutation(
      internal.functions.migrations.unifyAnnouncementChannels
        .migrateAnnouncementGroupChannels,
      { communityId: seeded.communityId }
    );
    const second = await t.mutation(
      internal.functions.migrations.unifyAnnouncementChannels
        .migrateAnnouncementGroupChannels,
      { communityId: seeded.communityId }
    );

    expect(second.results[0].status).toBe("already_migrated");

    const channels = await channelsForGroup(t, seeded.groupId);
    expect(channels.filter((c) => c.channelType === "main")).toHaveLength(1);
    expect(
      channels.filter((c) => c.channelType === "announcements")
    ).toHaveLength(1);
  });

  test("after migration: leaders-only posts in announcements, everyone in general", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const seeded = await seedAnnouncementGroup(t);

    await t.mutation(
      internal.functions.migrations.unifyAnnouncementChannels
        .migrateAnnouncementGroupChannels,
      { communityId: seeded.communityId }
    );

    // Drain the scheduled batch that adds members to the new general channel,
    // so the member is a channel member before posting there.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const channels = await channelsForGroup(t, seeded.groupId);
    const announcementsId = channels.find(
      (c) => c.channelType === "announcements"
    )!._id;
    const generalId = channels.find((c) => c.channelType === "main")!._id;

    const { accessToken: leaderToken } = await generateTokens(seeded.leaderId);
    const { accessToken: memberToken } = await generateTokens(seeded.memberId);

    // Leader can post in the announcements channel.
    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: leaderToken,
        channelId: announcementsId,
        content: "Leader announcement",
      })
    ).resolves.toBeDefined();

    // Member is blocked from the announcements channel.
    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: memberToken,
        channelId: announcementsId,
        content: "Member trying to announce",
      })
    ).rejects.toThrow(/Only group leaders can post/i);

    // Member CAN post in the new, open general channel.
    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: memberToken,
        channelId: generalId,
        content: "Hello everyone",
      })
    ).resolves.toBeDefined();
  });

  test("dryRun reports changes without writing", async () => {
    const t = convexTest(schema, modules);
    activeHandle = t;
    const seeded = await seedAnnouncementGroup(t);

    const result = await t.mutation(
      internal.functions.migrations.unifyAnnouncementChannels
        .migrateAnnouncementGroupChannels,
      { communityId: seeded.communityId, dryRun: true }
    );

    expect(result.dryRun).toBe(true);
    expect(result.results[0].status).toBe("would_migrate");
    expect(result.results[0].convertChannelId).toBe(seeded.oldGeneralId);

    // Nothing changed: still a single main channel, no announcements channel.
    const channels = await channelsForGroup(t, seeded.groupId);
    expect(channels.filter((c) => c.channelType === "main")).toHaveLength(1);
    expect(
      channels.filter((c) => c.channelType === "announcements")
    ).toHaveLength(0);
  });
});
