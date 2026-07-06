/**
 * Shared Announcements Channel Tests
 *
 * Covers sharing a group's announcements channel with other groups:
 * - Accepting an invite backfills the accepting group's members (leaders
 *   mirror to channel role "admin") and keeps them in sync on join/leave/role
 *   changes.
 * - Accepting disables the accepting group's own announcements channel and
 *   records its prior enabled state on the sharedGroups entry.
 * - Posting is allowed for leaders of the owning group OR any accepted
 *   secondary group; everyone else is read-only.
 * - Leaving/removal restores the group's own announcements channel (when it
 *   was enabled before the share) and removes exclusive members.
 * - Accepting a new share while already in one switches shares, carrying the
 *   original prior-enabled state forward.
 * - Guards: cannot accept while your own announcements channel is shared;
 *   cannot disable a shared announcements channel; cannot enable your own
 *   while an accepted secondary elsewhere.
 * - Archiving the owning group restores accepted secondaries' own channels.
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

const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
} as const;

// ============================================================================
// Seed Helpers
// ============================================================================

interface SeedData {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  // Owner group (owns the shared announcements channel)
  ownerGroupId: Id<"groups">;
  ownerLeaderId: Id<"users">;
  ownerLeaderToken: string;
  ownerMemberId: Id<"users">;
  ownerMemberToken: string;
  ownerAnnouncementsChannelId: Id<"chatChannels">;
  // Secondary group (accepts the share); has its own announcements channel
  secondaryGroupId: Id<"groups">;
  secondaryLeaderId: Id<"users">;
  secondaryLeaderToken: string;
  secondaryMemberId: Id<"users">;
  secondaryMemberToken: string;
  secondaryAnnouncementsChannelId: Id<"chatChannels">;
  // Community admin (for archive tests)
  adminUserId: Id<"users">;
  adminToken: string;
}

let phoneCounter = 100;

async function createUserInGroup(
  t: ReturnType<typeof convexTest>,
  communityId: Id<"communities">,
  groupId: Id<"groups">,
  role: "leader" | "member",
  name: string
): Promise<{ userId: Id<"users">; token: string }> {
  phoneCounter += 1;
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      firstName: name,
      lastName: role === "leader" ? "Leader" : "Member",
      phone: `+1555666${String(phoneCounter).padStart(4, "0")}`,
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("groupMembers", {
      userId: id,
      groupId,
      role,
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
    return id;
  });
  const { accessToken } = await generateTokens(userId);
  return { userId, token: accessToken };
}

/**
 * Creates an enabled announcements channel for a group with all the group's
 * current active members as channel members (leaders as channel "admin").
 */
async function createAnnouncementsChannel(
  t: ReturnType<typeof convexTest>,
  groupId: Id<"groups">,
  createdById: Id<"users">
): Promise<Id<"chatChannels">> {
  return await t.run(async (ctx) => {
    const channelId = await ctx.db.insert("chatChannels", {
      groupId,
      slug: "announcements",
      channelType: "announcements",
      name: "Announcements",
      createdById,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isArchived: false,
      isEnabled: true,
      memberCount: 0,
    });
    const members = await ctx.db
      .query("groupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.eq(q.field("leftAt"), undefined))
      .collect();
    for (const member of members) {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId: member.userId,
        role: member.role === "leader" ? "admin" : "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    }
    await ctx.db.patch(channelId, { memberCount: members.length });
    return channelId;
  });
}

async function seedData(t: ReturnType<typeof convexTest>): Promise<SeedData> {
  const communityId = await t.run(async (ctx) => {
    return await ctx.db.insert("communities", {
      name: "Test Community",
      subdomain: "test-shared-ann",
      slug: "test-shared-ann",
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

  const ownerGroupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Owner Group",
      communityId,
      groupTypeId,
      isPublic: true,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const secondaryGroupId = await t.run(async (ctx) => {
    return await ctx.db.insert("groups", {
      name: "Secondary Group",
      communityId,
      groupTypeId,
      isPublic: true,
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  const ownerLeader = await createUserInGroup(t, communityId, ownerGroupId, "leader", "OwnerL");
  const ownerMember = await createUserInGroup(t, communityId, ownerGroupId, "member", "OwnerM");
  const secondaryLeader = await createUserInGroup(t, communityId, secondaryGroupId, "leader", "SecL");
  const secondaryMember = await createUserInGroup(t, communityId, secondaryGroupId, "member", "SecM");

  const ownerAnnouncementsChannelId = await createAnnouncementsChannel(
    t,
    ownerGroupId,
    ownerLeader.userId
  );
  const secondaryAnnouncementsChannelId = await createAnnouncementsChannel(
    t,
    secondaryGroupId,
    secondaryLeader.userId
  );

  // Community admin (not in any group)
  phoneCounter += 1;
  const adminUserId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      firstName: "Community",
      lastName: "Admin",
      phone: `+1555666${String(phoneCounter).padStart(4, "0")}`,
      phoneVerified: true,
      activeCommunityId: communityId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("userCommunities", {
      userId: id,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  });
  const { accessToken: adminToken } = await generateTokens(adminUserId);

  return {
    communityId,
    groupTypeId,
    ownerGroupId,
    ownerLeaderId: ownerLeader.userId,
    ownerLeaderToken: ownerLeader.token,
    ownerMemberId: ownerMember.userId,
    ownerMemberToken: ownerMember.token,
    ownerAnnouncementsChannelId,
    secondaryGroupId,
    secondaryLeaderId: secondaryLeader.userId,
    secondaryLeaderToken: secondaryLeader.token,
    secondaryMemberId: secondaryMember.userId,
    secondaryMemberToken: secondaryMember.token,
    secondaryAnnouncementsChannelId,
    adminUserId,
    adminToken,
  };
}

async function inviteSecondary(t: ReturnType<typeof convexTest>, data: SeedData) {
  await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
    token: data.ownerLeaderToken,
    channelId: data.ownerAnnouncementsChannelId,
    groupId: data.secondaryGroupId,
  });
}

async function acceptShare(t: ReturnType<typeof convexTest>, data: SeedData) {
  await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
    token: data.secondaryLeaderToken,
    channelId: data.ownerAnnouncementsChannelId,
    groupId: data.secondaryGroupId,
    response: "accepted",
  });
}

async function getChannelMember(
  t: ReturnType<typeof convexTest>,
  channelId: Id<"chatChannels">,
  userId: Id<"users">
) {
  return await t.run(async (ctx) => {
    return await ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", channelId).eq("userId", userId)
      )
      .first();
  });
}

// ============================================================================
// Accept → membership backfill
// ============================================================================

describe("accepting an announcements share backfills membership", () => {
  test("all active members of the accepting group are added; leaders mirror to admin", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const leaderRow = await getChannelMember(
      t,
      data.ownerAnnouncementsChannelId,
      data.secondaryLeaderId
    );
    expect(leaderRow).not.toBeNull();
    expect(leaderRow!.leftAt).toBeUndefined();
    expect(leaderRow!.role).toBe("admin");

    const memberRow = await getChannelMember(
      t,
      data.ownerAnnouncementsChannelId,
      data.secondaryMemberId
    );
    expect(memberRow).not.toBeNull();
    expect(memberRow!.leftAt).toBeUndefined();
    expect(memberRow!.role).toBe("member");

    // Member count covers owner (2) + secondary (2), not just the backfilled roster.
    const channel = await t.run((ctx) => ctx.db.get(data.ownerAnnouncementsChannelId));
    expect(channel!.memberCount).toBe(4);
  });

  test("user joining the accepting group later is synced into the shared channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // A brand-new user joins the secondary group after the share is accepted.
    const newUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Late",
        lastName: "Joiner",
        phone: "+15556669999",
        phoneVerified: true,
        activeCommunityId: data.communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const { accessToken: newUserToken } = await generateTokens(newUserId);

    await t.mutation(api.functions.groups.index.join, {
      token: newUserToken,
      groupId: data.secondaryGroupId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await getChannelMember(t, data.ownerAnnouncementsChannelId, newUserId);
    expect(row).not.toBeNull();
    expect(row!.leftAt).toBeUndefined();
    expect(row!.role).toBe("member");
  });

  test("user leaving the accepting group is removed from the shared channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(api.functions.groups.index.leave, {
      token: data.secondaryMemberToken,
      groupId: data.secondaryGroupId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await getChannelMember(
      t,
      data.ownerAnnouncementsChannelId,
      data.secondaryMemberId
    );
    expect(row).not.toBeNull();
    expect(row!.leftAt).toBeDefined();
  });

  test("user leaving the owning group stays if active member of an accepted secondary", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    // A user who is a member of BOTH the owner group and the secondary group.
    const dual = await createUserInGroup(
      t,
      data.communityId,
      data.ownerGroupId,
      "member",
      "Dual"
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        userId: dual.userId,
        groupId: data.secondaryGroupId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      // Also give them a channel membership row like other owner-group members.
      await ctx.db.insert("chatChannelMembers", {
        channelId: data.ownerAnnouncementsChannelId,
        userId: dual.userId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Leaving the OWNER group must not remove them: they're still an active
    // member of the accepted secondary group.
    await t.mutation(api.functions.groups.index.leave, {
      token: dual.token,
      groupId: data.ownerGroupId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await getChannelMember(t, data.ownerAnnouncementsChannelId, dual.userId);
    expect(row).not.toBeNull();
    expect(row!.leftAt).toBeUndefined();
  });

  test("promoting a secondary-group member to leader mirrors channel role to admin", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(api.functions.groups.index.updateMemberRole, {
      token: data.secondaryLeaderToken,
      groupId: data.secondaryGroupId,
      targetUserId: data.secondaryMemberId,
      role: "leader",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const row = await getChannelMember(
      t,
      data.ownerAnnouncementsChannelId,
      data.secondaryMemberId
    );
    expect(row).not.toBeNull();
    expect(row!.leftAt).toBeUndefined();
    expect(row!.role).toBe("admin");
  });
});

// ============================================================================
// Accept → own channel disabled, prior state recorded
// ============================================================================

describe("accepting disables the accepting group's own announcements channel", () => {
  test("own channel is disabled and prior enabled state recorded on the entry", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);

    const ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(false);
    expect(ownChannel!.disabledByUserId).toBe(data.secondaryLeaderId);

    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    const entry = sharedChannel!.sharedGroups!.find(
      (sg) => sg.groupId === data.secondaryGroupId
    );
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("accepted");
    expect(entry!.previousAnnouncementsChannelEnabled).toBe(true);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("group without its own announcements channel records a falsy prior state", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    // Third group with NO announcements channel of its own.
    const thirdGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Third Group",
        communityId: data.communityId,
        groupTypeId: data.groupTypeId,
        isPublic: true,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const thirdLeader = await createUserInGroup(
      t,
      data.communityId,
      thirdGroupId,
      "leader",
      "ThirdL"
    );

    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.ownerLeaderToken,
      channelId: data.ownerAnnouncementsChannelId,
      groupId: thirdGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: thirdLeader.token,
      channelId: data.ownerAnnouncementsChannelId,
      groupId: thirdGroupId,
      response: "accepted",
    });

    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    const entry = sharedChannel!.sharedGroups!.find(
      (sg) => sg.groupId === thirdGroupId
    );
    expect(entry).toBeDefined();
    expect(entry!.previousAnnouncementsChannelEnabled).not.toBe(true);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

// ============================================================================
// Posting rights
// ============================================================================

describe("posting rights on a shared announcements channel", () => {
  test("leader of an accepted secondary group can post", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: data.secondaryLeaderToken,
      channelId: data.ownerAnnouncementsChannelId,
      content: "Hello from the secondary group's leader",
    });
    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message?.channelId).toBe(data.ownerAnnouncementsChannelId);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("non-leader member of an accepted secondary group cannot post", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: data.secondaryMemberToken,
        channelId: data.ownerAnnouncementsChannelId,
        content: "I should not be able to post",
      })
    ).rejects.toThrow(/Only group leaders can post in Announcements/);
  });

  test("leader of a pending (not accepted) invited group cannot post", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    // No accept — invite stays pending; no membership row exists.

    await expect(
      t.mutation(api.functions.messaging.messages.sendMessage, {
        token: data.secondaryLeaderToken,
        channelId: data.ownerAnnouncementsChannelId,
        content: "Pending invitees get nothing",
      })
    ).rejects.toThrow(/Not a member of this channel/);
  });

  test("owning group leader can still post", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const messageId = await t.mutation(api.functions.messaging.messages.sendMessage, {
      token: data.ownerLeaderToken,
      channelId: data.ownerAnnouncementsChannelId,
      content: "Owner leader announcement",
    });
    expect(messageId).toBeDefined();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

// ============================================================================
// Leaving / removal restores the group's own channel
// ============================================================================

describe("removeGroupFromChannel on an announcements share", () => {
  test("removes exclusive members and restores the group's own announcements channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // A user joins the secondary group DURING the share.
    const midShareUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        firstName: "Mid",
        lastName: "Share",
        phone: "+15556668888",
        phoneVerified: true,
        activeCommunityId: data.communityId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const { accessToken: midShareToken } = await generateTokens(midShareUserId);
    await t.mutation(api.functions.groups.index.join, {
      token: midShareToken,
      groupId: data.secondaryGroupId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Secondary leader opts the group out of the share.
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.ownerAnnouncementsChannelId,
      groupId: data.secondaryGroupId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Exclusive secondary-group members are gone from the shared channel.
    for (const userId of [
      data.secondaryLeaderId,
      data.secondaryMemberId,
      midShareUserId,
    ]) {
      const row = await getChannelMember(t, data.ownerAnnouncementsChannelId, userId);
      expect(row).not.toBeNull();
      expect(row!.leftAt).toBeDefined();
    }

    // Owner members stay.
    const ownerRow = await getChannelMember(
      t,
      data.ownerAnnouncementsChannelId,
      data.ownerMemberId
    );
    expect(ownerRow!.leftAt).toBeUndefined();

    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    expect(sharedChannel!.sharedGroups).toHaveLength(0);
    expect(sharedChannel!.isShared).toBe(false);
    expect(sharedChannel!.memberCount).toBe(2);

    // Own announcements channel is restored...
    const ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(true);
    expect(ownChannel!.disabledByUserId).toBeUndefined();

    // ...and repopulated, including the member who joined during the share.
    const midShareOwnRow = await getChannelMember(
      t,
      data.secondaryAnnouncementsChannelId,
      midShareUserId
    );
    expect(midShareOwnRow).not.toBeNull();
    expect(midShareOwnRow!.leftAt).toBeUndefined();
    expect(ownChannel!.memberCount).toBe(3);
  });

  test("removal does NOT re-enable an own channel that was disabled before the share", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    // Secondary group's own channel was already disabled before the share.
    await t.run(async (ctx) => {
      await ctx.db.patch(data.secondaryAnnouncementsChannelId, {
        isEnabled: false,
        disabledByUserId: data.secondaryLeaderId,
      });
    });

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.ownerAnnouncementsChannelId,
      groupId: data.secondaryGroupId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(false);
  });
});

// ============================================================================
// Accept = switch
// ============================================================================

describe("accepting a new share while already in one (switch)", () => {
  async function seedThirdOwnerGroup(
    t: ReturnType<typeof convexTest>,
    data: SeedData
  ) {
    const thirdGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Third Owner Group",
        communityId: data.communityId,
        groupTypeId: data.groupTypeId,
        isPublic: true,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const thirdLeader = await createUserInGroup(
      t,
      data.communityId,
      thirdGroupId,
      "leader",
      "ThirdOwnerL"
    );
    const thirdChannelId = await createAnnouncementsChannel(
      t,
      thirdGroupId,
      thirdLeader.userId
    );
    return { thirdGroupId, thirdLeader, thirdChannelId };
  }

  test("switch leaves the old share, carries prior state, and restores only on final leave", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);
    const { thirdGroupId, thirdLeader, thirdChannelId } = await seedThirdOwnerGroup(
      t,
      data
    );

    // Secondary accepts owner's share first (own channel enabled → disabled, prev=true).
    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Third group invites the secondary group; accepting switches shares.
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: thirdLeader.token,
      channelId: thirdChannelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: thirdChannelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Old share: entry removed, exclusive members soft-deleted.
    const oldChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    expect(
      oldChannel!.sharedGroups!.some((sg) => sg.groupId === data.secondaryGroupId)
    ).toBe(false);
    const oldRow = await getChannelMember(
      t,
      data.ownerAnnouncementsChannelId,
      data.secondaryMemberId
    );
    expect(oldRow!.leftAt).toBeDefined();

    // New share: accepted entry carries over the ORIGINAL prior-enabled state.
    const newChannel = await t.run((ctx) => ctx.db.get(thirdChannelId));
    const newEntry = newChannel!.sharedGroups!.find(
      (sg) => sg.groupId === data.secondaryGroupId
    );
    expect(newEntry).toBeDefined();
    expect(newEntry!.status).toBe("accepted");
    expect(newEntry!.previousAnnouncementsChannelEnabled).toBe(true);

    // Members were backfilled into the new share.
    const newRow = await getChannelMember(t, thirdChannelId, data.secondaryMemberId);
    expect(newRow).not.toBeNull();
    expect(newRow!.leftAt).toBeUndefined();

    // Own channel stays disabled during the switch — no restore mid-switch.
    let ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(false);

    // Leaving the (new, last) share finally restores the own channel.
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: thirdChannelId,
      groupId: data.secondaryGroupId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(true);
    expect(ownChannel!.disabledByUserId).toBeUndefined();
  });
});

// ============================================================================
// Guards
// ============================================================================

describe("guards", () => {
  test("cannot accept while the group's OWN announcements channel is shared", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    // The secondary group's own announcements channel is itself shared
    // (a pending invite to another group is enough).
    const fourthGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Fourth Group",
        communityId: data.communityId,
        groupTypeId: data.groupTypeId,
        isPublic: true,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.secondaryAnnouncementsChannelId,
      groupId: fourthGroupId,
    });

    await inviteSecondary(t, data);

    await expect(acceptShare(t, data)).rejects.toThrow(/OWN_CHANNEL_SHARED/);
  });

  test("cannot disable an announcements channel that is currently shared", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data); // pending entry is enough

    await expect(
      t.mutation(api.functions.messaging.channels.toggleAnnouncementsChannel, {
        token: data.ownerLeaderToken,
        groupId: data.ownerGroupId,
        enabled: false,
      })
    ).rejects.toThrow(/CHANNEL_SHARED/);
  });

  test("cannot enable own announcements channel while an accepted secondary elsewhere", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expect(
      t.mutation(api.functions.messaging.channels.toggleAnnouncementsChannel, {
        token: data.secondaryLeaderToken,
        groupId: data.secondaryGroupId,
        enabled: true,
      })
    ).rejects.toThrow(/IN_SHARED_ANNOUNCEMENTS/);
  });
});

// ============================================================================
// Owner group archive cascade
// ============================================================================

describe("archiving the owning group of a shared announcements channel", () => {
  test("restores each accepted secondary's own announcements channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Sanity: own channel disabled while the share is active.
    let ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(false);

    // Community admin archives the OWNER group.
    await t.mutation(api.functions.groups.mutations.update, {
      token: data.adminToken,
      groupId: data.ownerGroupId,
      isArchived: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Owner's channels are archived (existing cascade).
    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    expect(sharedChannel!.isArchived).toBe(true);

    // The secondary group's own channel is re-enabled and repopulated.
    ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(true);
    expect(ownChannel!.disabledByUserId).toBeUndefined();
    expect(ownChannel!.memberCount).toBe(2);

    const leaderRow = await getChannelMember(
      t,
      data.secondaryAnnouncementsChannelId,
      data.secondaryLeaderId
    );
    expect(leaderRow!.leftAt).toBeUndefined();
  });

  test("archiving a secondary group does not restore its own channel (it's archived)", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(api.functions.groups.mutations.update, {
      token: data.adminToken,
      groupId: data.secondaryGroupId,
      isArchived: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Entry pulled from the shared channel (existing cascade)...
    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    expect(sharedChannel!.sharedGroups).toHaveLength(0);

    // ...but the archived group's own channel is NOT re-enabled — the group
    // archive cascade already archived it.
    const ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isArchived).toBe(true);
    expect(ownChannel!.isEnabled).not.toBe(true);
  });
});

// ============================================================================
// Decline / cancel — no side effects
// ============================================================================

describe("decline and cancel have no announcements side effects", () => {
  test("declining an announcements share leaves the own channel untouched", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: data.ownerAnnouncementsChannelId,
      groupId: data.secondaryGroupId,
      response: "declined",
    });

    const ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(true);

    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    expect(sharedChannel!.sharedGroups).toHaveLength(0);
    expect(sharedChannel!.isShared).toBe(false);

    // No membership was created for the declining group.
    const row = await getChannelMember(
      t,
      data.ownerAnnouncementsChannelId,
      data.secondaryLeaderId
    );
    expect(row).toBeNull();

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("cancelling a pending announcements invite leaves everything untouched", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await t.mutation(api.functions.messaging.sharedChannels.cancelChannelInvite, {
      token: data.ownerLeaderToken,
      channelId: data.ownerAnnouncementsChannelId,
      groupId: data.secondaryGroupId,
    });

    const ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(true);

    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    expect(sharedChannel!.sharedGroups).toHaveLength(0);
    expect(sharedChannel!.isShared).toBe(false);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

// ============================================================================
// Owner archive clears the share itself
// ============================================================================

describe("archiving the owner clears the share from the archived channel", () => {
  test("sharedGroups is emptied and isShared cleared so unarchiving can't resurrect the share", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(api.functions.groups.mutations.update, {
      token: data.adminToken,
      groupId: data.ownerGroupId,
      isArchived: true,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    expect(sharedChannel!.isArchived).toBe(true);
    expect(sharedChannel!.sharedGroups).toHaveLength(0);
    expect(sharedChannel!.isShared).toBe(false);
  });
});

// ============================================================================
// archiveChannel guard
// ============================================================================

describe("archiveChannel on a shared channel", () => {
  test("cannot archive a channel with shared groups (pending entry is enough)", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);

    await expect(
      t.mutation(api.functions.messaging.channels.archiveChannel, {
        token: data.ownerLeaderToken,
        channelId: data.ownerAnnouncementsChannelId,
      })
    ).rejects.toThrow(/CHANNEL_SHARED/);
  });
});

// ============================================================================
// Disabled/archived channel guards on invite + accept
// ============================================================================

describe("disabled/archived shared channel guards", () => {
  test("cannot accept an invite to a disabled channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await t.run(async (ctx) => {
      await ctx.db.patch(data.ownerAnnouncementsChannelId, { isEnabled: false });
    });

    await expect(acceptShare(t, data)).rejects.toThrow(/CHANNEL_DISABLED/);

    // No side effects: the accepting group's own channel stays enabled.
    const ownChannel = await t.run((ctx) =>
      ctx.db.get(data.secondaryAnnouncementsChannelId)
    );
    expect(ownChannel!.isEnabled).toBe(true);
  });

  test("cannot accept an invite to an archived channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await t.run(async (ctx) => {
      await ctx.db.patch(data.ownerAnnouncementsChannelId, {
        isArchived: true,
        archivedAt: Date.now(),
      });
    });

    await expect(acceptShare(t, data)).rejects.toThrow(/CHANNEL_DISABLED/);
  });

  test("cannot invite a group to a disabled announcements channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await t.run(async (ctx) => {
      await ctx.db.patch(data.ownerAnnouncementsChannelId, { isEnabled: false });
    });

    await expect(inviteSecondary(t, data)).rejects.toThrow(/CHANNEL_DISABLED/);
  });

  test("a group that receives announcements through a share cannot share its own channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Force the secondary's own channel back to enabled directly (bypassing
    // the IN_SHARED_ANNOUNCEMENTS toggle guard) so the disabled-channel
    // invite guard doesn't fire first.
    await t.run(async (ctx) => {
      await ctx.db.patch(data.secondaryAnnouncementsChannelId, {
        isEnabled: true,
        disabledByUserId: undefined,
      });
    });

    const fourthGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Fourth Group",
        communityId: data.communityId,
        groupTypeId: data.groupTypeId,
        isPublic: true,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
        token: data.secondaryLeaderToken,
        channelId: data.secondaryAnnouncementsChannelId,
        groupId: fourthGroupId,
      })
    ).rejects.toThrow(/OWNER_IS_SECONDARY/);
  });
});

// ============================================================================
// Backfill race guard
// ============================================================================

describe("populateChannelMembersBatch race guard", () => {
  test("in-flight backfill bails when the group is removed from the share before it runs", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);

    // Remove the group from the share BEFORE the scheduled backfill runs.
    await t.mutation(api.functions.messaging.sharedChannels.removeGroupFromChannel, {
      token: data.secondaryLeaderToken,
      channelId: data.ownerAnnouncementsChannelId,
      groupId: data.secondaryGroupId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The stale backfill must NOT have re-added the removed group's members.
    for (const userId of [data.secondaryLeaderId, data.secondaryMemberId]) {
      const row = await getChannelMember(t, data.ownerAnnouncementsChannelId, userId);
      if (row) {
        expect(row.leftAt).toBeDefined();
      }
    }

    const sharedChannel = await t.run((ctx) =>
      ctx.db.get(data.ownerAnnouncementsChannelId)
    );
    expect(sharedChannel!.memberCount).toBe(2);
  });
});

// ============================================================================
// Accepting leader gets immediate membership
// ============================================================================

describe("accepting leader membership", () => {
  test("the responding leader is an active channel admin before the batch runs", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);

    // BEFORE running scheduled functions — the synchronous ensure must
    // already have added the leader so an immediate post can't fail with
    // "Not a member of this channel".
    const leaderRow = await getChannelMember(
      t,
      data.ownerAnnouncementsChannelId,
      data.secondaryLeaderId
    );
    expect(leaderRow).not.toBeNull();
    expect(leaderRow!.leftAt).toBeUndefined();
    expect(leaderRow!.role).toBe("admin");

    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});

// ============================================================================
// Legacy entries without recorded prior state
// ============================================================================

describe("switching from a legacy entry without previousAnnouncementsChannelEnabled", () => {
  test("falls back to the current own-channel state instead of storing undefined", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    // Third owner group with its own announcements channel.
    const thirdGroupId = await t.run(async (ctx) => {
      return await ctx.db.insert("groups", {
        name: "Third Owner Group",
        communityId: data.communityId,
        groupTypeId: data.groupTypeId,
        isPublic: true,
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const thirdLeader = await createUserInGroup(
      t,
      data.communityId,
      thirdGroupId,
      "leader",
      "ThirdOwnerL"
    );
    const thirdChannelId = await createAnnouncementsChannel(
      t,
      thirdGroupId,
      thirdLeader.userId
    );

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Simulate a legacy entry created before prior-state tracking: strip the
    // recorded previousAnnouncementsChannelEnabled off the accepted entry.
    await t.run(async (ctx) => {
      const channel = await ctx.db.get(data.ownerAnnouncementsChannelId);
      const stripped = (channel!.sharedGroups ?? []).map((sg) => {
        const { previousAnnouncementsChannelEnabled: _omit, ...rest } = sg;
        return rest;
      });
      await ctx.db.patch(data.ownerAnnouncementsChannelId, {
        sharedGroups: stripped,
      });
    });

    // Switch to the third group's share.
    await t.mutation(api.functions.messaging.sharedChannels.inviteGroupToChannel, {
      token: thirdLeader.token,
      channelId: thirdChannelId,
      groupId: data.secondaryGroupId,
    });
    await t.mutation(api.functions.messaging.sharedChannels.respondToChannelInvite, {
      token: data.secondaryLeaderToken,
      channelId: thirdChannelId,
      groupId: data.secondaryGroupId,
      response: "accepted",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The new entry stores the CURRENT own-channel state (disabled by the
    // first accept → false), not undefined.
    const newChannel = await t.run((ctx) => ctx.db.get(thirdChannelId));
    const newEntry = newChannel!.sharedGroups!.find(
      (sg) => sg.groupId === data.secondaryGroupId
    );
    expect(newEntry!.previousAnnouncementsChannelEnabled).toBe(false);
  });
});

// ============================================================================
// Community-scoped share metadata
// ============================================================================

describe("community scoping of shared channels", () => {
  test("inviting stamps communityId on the shared channel", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    // Seeded without communityId (legacy shape).
    let channel = await t.run((ctx) => ctx.db.get(data.ownerAnnouncementsChannelId));
    expect(channel!.communityId).toBeUndefined();

    await inviteSecondary(t, data);

    channel = await t.run((ctx) => ctx.db.get(data.ownerAnnouncementsChannelId));
    expect(channel!.communityId).toBe(data.communityId);
  });
});

// ============================================================================
// listGroupChannels — shared-in announcements shape
// ============================================================================

describe("listGroupChannels with a shared announcements channel", () => {
  test("secondary side gets sharedFromGroupName (no sharedGroupCount); owner side gets sharedGroupCount", async () => {
    const t = convexTest(schema, modules);
    const data = await seedData(t);

    await inviteSecondary(t, data);
    await acceptShare(t, data);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // Secondary group's view: the shared-in channel carries the owning
    // group's name; its own (disabled) channel does not.
    const secondaryChannels = await t.query(
      api.functions.messaging.channels.listGroupChannels,
      {
        token: data.secondaryLeaderToken,
        groupId: data.secondaryGroupId,
        includeArchived: true,
      }
    );
    const sharedIn = secondaryChannels.find(
      (c) => c._id === data.ownerAnnouncementsChannelId
    );
    expect(sharedIn).toBeDefined();
    expect(sharedIn!.sharedFromGroupId).toBe(data.ownerGroupId);
    expect(sharedIn!.sharedFromGroupName).toBe("Owner Group");
    expect(sharedIn!.sharedGroupCount).toBeUndefined();

    const ownDisabled = secondaryChannels.find(
      (c) => c._id === data.secondaryAnnouncementsChannelId
    );
    expect(ownDisabled).toBeDefined();
    expect(ownDisabled!.sharedFromGroupName).toBeUndefined();

    // Owner group's view: its channel is owner-side shared.
    const ownerChannels = await t.query(
      api.functions.messaging.channels.listGroupChannels,
      {
        token: data.ownerLeaderToken,
        groupId: data.ownerGroupId,
        includeArchived: true,
      }
    );
    const owned = ownerChannels.find(
      (c) => c._id === data.ownerAnnouncementsChannelId
    );
    expect(owned).toBeDefined();
    expect(owned!.sharedGroupCount).toBe(1);
    expect(owned!.sharedFromGroupName).toBeUndefined();
  });
});
