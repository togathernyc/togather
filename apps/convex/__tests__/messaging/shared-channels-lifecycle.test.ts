/**
 * Shared Channels Lifecycle Tests
 *
 * Tests archive cascade behavior for shared channels and reorder functionality.
 *
 * Archive cascade — primary group archived:
 * - All channels owned by the archived group are archived (isArchived, archivedAt)
 * - Channel members get soft-deleted (leftAt set)
 * - memberCount set to 0
 *
 * Archive cascade — secondary group archived:
 * - Its entry is removed from all shared channels' sharedGroups
 * - Members exclusive to that secondary group get soft-deleted
 * - Members in primary group or other accepted groups stay
 * - If sharedGroups becomes empty, isShared is set to false
 *
 * reorderSharedChannel:
 * - Leader of a secondary group can set sortOrder for a shared channel
 * - Non-leader cannot reorder (permission error)
 * - Cannot reorder for the primary group
 * - Can only reorder accepted shared channels
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
// Seed Helpers
// ============================================================================

const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
} as const;

interface SharedChannelSeedData {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  // Primary group that owns the shared channel
  primaryGroupId: Id<"groups">;
  // Two secondary groups sharing the channel
  secondaryGroupAId: Id<"groups">;
  secondaryGroupBId: Id<"groups">;
  // Users
  adminUserId: Id<"users">;
  primaryLeaderId: Id<"users">;
  secondaryLeaderAId: Id<"users">;
  secondaryLeaderBId: Id<"users">;
  // A member in the primary group only
  primaryOnlyMemberId: Id<"users">;
  // A member in secondary group A only
  secondaryAOnlyMemberId: Id<"users">;
  // A member in both primary and secondary group A
  sharedMemberId: Id<"users">;
  // Channel IDs
  sharedChannelId: Id<"chatChannels">;
  primaryOwnedChannelId: Id<"chatChannels">; // Non-shared channel owned by primary group
  // Channel member IDs
  primaryLeaderChannelMemberId: Id<"chatChannelMembers">;
  secondaryLeaderAChannelMemberId: Id<"chatChannelMembers">;
  primaryOnlyChannelMemberId: Id<"chatChannelMembers">;
  secondaryAOnlyChannelMemberId: Id<"chatChannelMembers">;
  sharedMemberChannelMemberId: Id<"chatChannelMembers">;
}

async function seedSharedChannelData(
  t: ReturnType<typeof convexTest>
): Promise<SharedChannelSeedData> {
  return await t.run(async (ctx) => {
    const now = Date.now();

    // Community
    const communityId = await ctx.db.insert("communities", {
      name: "Shared Channel Test Community",
      slug: "shared-channel-test",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    // Group type
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    // ---- Users ----
    const adminUserId = await ctx.db.insert("users", {
      firstName: "Community",
      lastName: "Admin",
      email: "admin@test.com",
      createdAt: now,
      updatedAt: now,
    });

    const primaryLeaderId = await ctx.db.insert("users", {
      firstName: "Primary",
      lastName: "Leader",
      email: "primary-leader@test.com",
      createdAt: now,
      updatedAt: now,
    });

    const secondaryLeaderAId = await ctx.db.insert("users", {
      firstName: "SecondaryA",
      lastName: "Leader",
      email: "secondary-leader-a@test.com",
      createdAt: now,
      updatedAt: now,
    });

    const secondaryLeaderBId = await ctx.db.insert("users", {
      firstName: "SecondaryB",
      lastName: "Leader",
      email: "secondary-leader-b@test.com",
      createdAt: now,
      updatedAt: now,
    });

    const primaryOnlyMemberId = await ctx.db.insert("users", {
      firstName: "PrimaryOnly",
      lastName: "Member",
      email: "primary-only@test.com",
      createdAt: now,
      updatedAt: now,
    });

    const secondaryAOnlyMemberId = await ctx.db.insert("users", {
      firstName: "SecondaryAOnly",
      lastName: "Member",
      email: "secondary-a-only@test.com",
      createdAt: now,
      updatedAt: now,
    });

    const sharedMemberId = await ctx.db.insert("users", {
      firstName: "Shared",
      lastName: "Member",
      email: "shared-member@test.com",
      createdAt: now,
      updatedAt: now,
    });

    // ---- Community memberships ----
    await ctx.db.insert("userCommunities", {
      userId: adminUserId,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: now,
      updatedAt: now,
    });

    for (const uid of [
      primaryLeaderId,
      secondaryLeaderAId,
      secondaryLeaderBId,
      primaryOnlyMemberId,
      secondaryAOnlyMemberId,
      sharedMemberId,
    ]) {
      await ctx.db.insert("userCommunities", {
        userId: uid,
        communityId,
        roles: COMMUNITY_ROLES.MEMBER,
        status: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    // ---- Groups ----
    const primaryGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Primary Group",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const secondaryGroupAId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Secondary Group A",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const secondaryGroupBId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Secondary Group B",
      isArchived: false,
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    // ---- Group memberships ----
    // Primary group: primaryLeader (leader), primaryOnlyMember (member), sharedMember (member)
    await ctx.db.insert("groupMembers", {
      groupId: primaryGroupId,
      userId: primaryLeaderId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: primaryGroupId,
      userId: primaryOnlyMemberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: primaryGroupId,
      userId: sharedMemberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // Secondary group A: secondaryLeaderA (leader), secondaryAOnlyMember (member), sharedMember (member)
    await ctx.db.insert("groupMembers", {
      groupId: secondaryGroupAId,
      userId: secondaryLeaderAId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: secondaryGroupAId,
      userId: secondaryAOnlyMemberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: secondaryGroupAId,
      userId: sharedMemberId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // Secondary group B: secondaryLeaderB (leader)
    await ctx.db.insert("groupMembers", {
      groupId: secondaryGroupBId,
      userId: secondaryLeaderBId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // ---- Shared channel (owned by primary group) ----
    const sharedChannelId = await ctx.db.insert("chatChannels", {
      groupId: primaryGroupId,
      channelType: "custom",
      name: "Shared Channel",
      slug: "shared-channel",
      createdById: primaryLeaderId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 5,
      isShared: true,
      sharedGroups: [
        {
          groupId: secondaryGroupAId,
          status: "accepted",
          invitedById: primaryLeaderId,
          invitedAt: now,
          respondedById: secondaryLeaderAId,
          respondedAt: now,
        },
        {
          groupId: secondaryGroupBId,
          status: "accepted",
          invitedById: primaryLeaderId,
          invitedAt: now,
          respondedById: secondaryLeaderBId,
          respondedAt: now,
        },
      ],
    });

    // Non-shared channel owned by primary group
    const primaryOwnedChannelId = await ctx.db.insert("chatChannels", {
      groupId: primaryGroupId,
      channelType: "main",
      name: "Primary Main",
      slug: "main",
      createdById: primaryLeaderId,
      createdAt: now,
      updatedAt: now,
      isArchived: false,
      memberCount: 3,
    });

    // ---- Channel members for the shared channel ----
    const primaryLeaderChannelMemberId = await ctx.db.insert(
      "chatChannelMembers",
      {
        channelId: sharedChannelId,
        userId: primaryLeaderId,
        role: "admin",
        joinedAt: now,
        isMuted: false,
      }
    );

    const secondaryLeaderAChannelMemberId = await ctx.db.insert(
      "chatChannelMembers",
      {
        channelId: sharedChannelId,
        userId: secondaryLeaderAId,
        role: "member",
        joinedAt: now,
        isMuted: false,
      }
    );

    const primaryOnlyChannelMemberId = await ctx.db.insert(
      "chatChannelMembers",
      {
        channelId: sharedChannelId,
        userId: primaryOnlyMemberId,
        role: "member",
        joinedAt: now,
        isMuted: false,
      }
    );

    const secondaryAOnlyChannelMemberId = await ctx.db.insert(
      "chatChannelMembers",
      {
        channelId: sharedChannelId,
        userId: secondaryAOnlyMemberId,
        role: "member",
        joinedAt: now,
        isMuted: false,
      }
    );

    const sharedMemberChannelMemberId = await ctx.db.insert(
      "chatChannelMembers",
      {
        channelId: sharedChannelId,
        userId: sharedMemberId,
        role: "member",
        joinedAt: now,
        isMuted: false,
      }
    );

    return {
      communityId,
      groupTypeId,
      primaryGroupId,
      secondaryGroupAId,
      secondaryGroupBId,
      adminUserId,
      primaryLeaderId,
      secondaryLeaderAId,
      secondaryLeaderBId,
      primaryOnlyMemberId,
      secondaryAOnlyMemberId,
      sharedMemberId,
      sharedChannelId,
      primaryOwnedChannelId,
      primaryLeaderChannelMemberId,
      secondaryLeaderAChannelMemberId,
      primaryOnlyChannelMemberId,
      secondaryAOnlyChannelMemberId,
      sharedMemberChannelMemberId,
    };
  });
}

// ============================================================================
// Archive Cascade — Primary Group Archived
// ============================================================================

describe("Archive cascade — primary group archived", () => {
  test("archiving primary group archives all its owned channels", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    // Archive flips are community-admin-only (`groups.mutations.update`).
    const { accessToken } = await generateTokens(ids.adminUserId);

    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.primaryGroupId,
      isArchived: true,
    });

    // Both channels owned by primary group should be archived
    const sharedChannel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedChannelId);
    });
    expect(sharedChannel!.isArchived).toBe(true);
    expect(sharedChannel!.archivedAt).toBeDefined();
    expect(sharedChannel!.memberCount).toBe(0);

    const mainChannel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.primaryOwnedChannelId);
    });
    expect(mainChannel!.isArchived).toBe(true);
    expect(mainChannel!.archivedAt).toBeDefined();
    expect(mainChannel!.memberCount).toBe(0);
  });

  test("archiving primary group preserves archivedAt for already archived channels", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const existingArchivedAt = Date.now() - 60_000;

    const { alreadyArchivedChannelId, alreadyArchivedMembershipId } = await t.run(
      async (ctx) => {
        const channelId = await ctx.db.insert("chatChannels", {
          groupId: ids.primaryGroupId,
          channelType: "custom",
          name: "Already Archived",
          slug: "already-archived",
          createdById: ids.primaryLeaderId,
          createdAt: Date.now() - 120_000,
          updatedAt: Date.now() - 120_000,
          isArchived: true,
          archivedAt: existingArchivedAt,
          memberCount: 0,
        });

        const membershipId = await ctx.db.insert("chatChannelMembers", {
          channelId,
          userId: ids.primaryOnlyMemberId,
          role: "member",
          joinedAt: Date.now() - 120_000,
          isMuted: false,
        });

        return {
          alreadyArchivedChannelId: channelId,
          alreadyArchivedMembershipId: membershipId,
        };
      }
    );

    const { accessToken } = await generateTokens(ids.adminUserId);
    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.primaryGroupId,
      isArchived: true,
    });

    const alreadyArchivedChannel = await t.run(async (ctx) => {
      return await ctx.db.get(alreadyArchivedChannelId);
    });
    expect(alreadyArchivedChannel!.isArchived).toBe(true);
    expect(alreadyArchivedChannel!.archivedAt).toBe(existingArchivedAt);

    // Existing archived channels are skipped in the cascade, so their memberships are untouched.
    const alreadyArchivedMembership = await t.run(async (ctx) => {
      return await ctx.db.get(alreadyArchivedMembershipId);
    });
    expect(alreadyArchivedMembership!.leftAt).toBeUndefined();
  });

  test("archiving primary group soft-deletes all channel members", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const { accessToken } = await generateTokens(ids.adminUserId);

    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.primaryGroupId,
      isArchived: true,
    });

    // All channel members of the shared channel should have leftAt set
    const members = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) =>
          q.eq("channelId", ids.sharedChannelId)
        )
        .collect();
    });

    for (const member of members) {
      expect(member.leftAt).toBeDefined();
    }
  });

  test("archiving primary group sets archivedAt on the group itself", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const { accessToken } = await generateTokens(ids.adminUserId);

    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.primaryGroupId,
      isArchived: true,
    });

    const group = await t.run(async (ctx) => {
      return await ctx.db.get(ids.primaryGroupId);
    });
    expect(group!.isArchived).toBe(true);
    expect(group!.archivedAt).toBeDefined();
  });
});

// ============================================================================
// Archive Cascade — Secondary Group Archived
// ============================================================================

describe("Archive cascade — secondary group archived", () => {
  test("archiving secondary group A removes its entry from sharedGroups", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const { accessToken } = await generateTokens(ids.adminUserId);

    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.secondaryGroupAId,
      isArchived: true,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedChannelId);
    });

    // Secondary group A should be removed from sharedGroups
    const groupIds = (channel!.sharedGroups ?? []).map((sg) => sg.groupId);
    expect(groupIds).not.toContain(ids.secondaryGroupAId);
    // Secondary group B should still be there
    expect(groupIds).toContain(ids.secondaryGroupBId);
    // Channel should still be shared (group B remains)
    expect(channel!.isShared).toBe(true);
  });

  test("archiving secondary group soft-deletes members exclusive to that group", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const { accessToken } = await generateTokens(ids.adminUserId);

    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.secondaryGroupAId,
      isArchived: true,
    });

    // secondaryAOnlyMember should be soft-deleted (only in secondary group A)
    const secondaryAOnlyMember = await t.run(async (ctx) => {
      return await ctx.db.get(ids.secondaryAOnlyChannelMemberId);
    });
    expect(secondaryAOnlyMember!.leftAt).toBeDefined();

    // secondaryLeaderA should be soft-deleted (only a leader of secondary A, not in primary)
    const secondaryLeaderAMember = await t.run(async (ctx) => {
      return await ctx.db.get(ids.secondaryLeaderAChannelMemberId);
    });
    expect(secondaryLeaderAMember!.leftAt).toBeDefined();
  });

  test("archiving secondary group scopes shared-channel cleanup to same community", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);

    const { crossCommunityChannelId, crossCommunityMembershipId } = await t.run(
      async (ctx) => {
        const now = Date.now();
        const otherCommunityId = await ctx.db.insert("communities", {
          name: "Other Community",
          slug: "other-community",
          isPublic: true,
          timezone: "America/New_York",
          createdAt: now,
          updatedAt: now,
        });

        const otherGroupTypeId = await ctx.db.insert("groupTypes", {
          communityId: otherCommunityId,
          name: "Other Group Type",
          slug: "other-group-type",
          isActive: true,
          createdAt: now,
          displayOrder: 1,
        });

        const otherPrimaryGroupId = await ctx.db.insert("groups", {
          communityId: otherCommunityId,
          groupTypeId: otherGroupTypeId,
          name: "Other Primary Group",
          isArchived: false,
          isPublic: true,
          createdAt: now,
          updatedAt: now,
        });

        // Intentionally inconsistent legacy data: cross-community sharedGroups entry.
        const channelId = await ctx.db.insert("chatChannels", {
          groupId: otherPrimaryGroupId,
          channelType: "custom",
          name: "Cross Community Shared",
          slug: "cross-community-shared",
          createdById: ids.primaryLeaderId,
          createdAt: now,
          updatedAt: now,
          isArchived: false,
          memberCount: 1,
          isShared: true,
          sharedGroups: [
            {
              groupId: ids.secondaryGroupAId,
              status: "accepted",
              invitedById: ids.primaryLeaderId,
              invitedAt: now,
            },
          ],
        });

        const membershipId = await ctx.db.insert("chatChannelMembers", {
          channelId,
          userId: ids.secondaryAOnlyMemberId,
          role: "member",
          joinedAt: now,
          isMuted: false,
        });

        return {
          crossCommunityChannelId: channelId,
          crossCommunityMembershipId: membershipId,
        };
      }
    );

    const { accessToken } = await generateTokens(ids.adminUserId);
    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.secondaryGroupAId,
      isArchived: true,
    });

    // Sanity check: same-community shared channel is updated.
    const sameCommunityChannel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedChannelId);
    });
    const sameCommunityGroupIds = (sameCommunityChannel!.sharedGroups ?? []).map(
      (sg) => sg.groupId
    );
    expect(sameCommunityGroupIds).not.toContain(ids.secondaryGroupAId);

    // Cross-community inconsistent data is not part of the bounded community scan.
    const crossCommunityChannel = await t.run(async (ctx) => {
      return await ctx.db.get(crossCommunityChannelId);
    });
    const crossCommunityMember = await t.run(async (ctx) => {
      return await ctx.db.get(crossCommunityMembershipId);
    });

    expect(
      crossCommunityChannel!.sharedGroups?.some(
        (sg) => sg.groupId === ids.secondaryGroupAId
      )
    ).toBe(true);
    expect(crossCommunityMember!.leftAt).toBeUndefined();
  });

  test("archiving secondary group keeps members who are also in primary group", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const { accessToken } = await generateTokens(ids.adminUserId);

    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.secondaryGroupAId,
      isArchived: true,
    });

    // sharedMember is in both primary group and secondary group A
    // They should NOT be soft-deleted because they're still in the primary group
    const sharedMember = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedMemberChannelMemberId);
    });
    expect(sharedMember!.leftAt).toBeUndefined();

    // primaryOnlyMember should also remain
    const primaryOnlyMember = await t.run(async (ctx) => {
      return await ctx.db.get(ids.primaryOnlyChannelMemberId);
    });
    expect(primaryOnlyMember!.leftAt).toBeUndefined();

    // primaryLeader should remain
    const primaryLeader = await t.run(async (ctx) => {
      return await ctx.db.get(ids.primaryLeaderChannelMemberId);
    });
    expect(primaryLeader!.leftAt).toBeUndefined();
  });

  test("archiving secondary group recomputes memberCount on shared channel", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    // Archive flips are gated to community admins (see
    // `groups.mutations.update`) — use the seeded admin token, not the
    // group leader's, to drive the cascade.
    const { accessToken } = await generateTokens(ids.adminUserId);

    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.secondaryGroupAId,
      isArchived: true,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedChannelId);
    });
    const activeMembers = await t.run(async (ctx) => {
      return await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel", (q) => q.eq("channelId", ids.sharedChannelId))
        .filter((q) => q.eq(q.field("leftAt"), undefined))
        .collect();
    });

    // Secondary-group-exclusive members are removed, so count drops from 5 -> 3.
    expect(channel!.memberCount).toBe(3);
    expect(channel!.memberCount).toBe(activeMembers.length);
  });

  test("archiving the last secondary group sets isShared to false", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    // Archive is community-admin-only — same admin token drives both
    // archive calls.
    const { accessToken: adminToken } = await generateTokens(ids.adminUserId);

    // Archive secondary group A first
    await t.mutation(api.functions.groups.mutations.update, {
      token: adminToken,
      groupId: ids.secondaryGroupAId,
      isArchived: true,
    });

    // Now archive secondary group B
    await t.mutation(api.functions.groups.mutations.update, {
      token: adminToken,
      groupId: ids.secondaryGroupBId,
      isArchived: true,
    });

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedChannelId);
    });

    expect(channel!.sharedGroups).toHaveLength(0);
    expect(channel!.isShared).toBe(false);
  });

  test("shared channel stays alive when secondary group is archived", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    // Community-admin-only — see comment on the previous archive test.
    const { accessToken } = await generateTokens(ids.adminUserId);

    await t.mutation(api.functions.groups.mutations.update, {
      token: accessToken,
      groupId: ids.secondaryGroupAId,
      isArchived: true,
    });

    // The shared channel should NOT be archived — it's owned by the primary group
    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedChannelId);
    });
    expect(channel!.isArchived).toBe(false);
    expect(channel!.archivedAt).toBeUndefined();
  });
});

// ============================================================================
// reorderSharedChannel
// ============================================================================

describe("reorderSharedChannel", () => {
  test("leader of secondary group can set sortOrder for a shared channel", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const { accessToken } = await generateTokens(ids.secondaryLeaderAId);

    await t.mutation(
      api.functions.messaging.sharedChannels.reorderSharedChannel,
      {
        token: accessToken,
        channelId: ids.sharedChannelId,
        groupId: ids.secondaryGroupAId,
        sortOrder: 5,
      }
    );

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedChannelId);
    });

    const entry = channel!.sharedGroups!.find(
      (sg) => sg.groupId === ids.secondaryGroupAId
    );
    expect(entry).toBeDefined();
    expect(entry!.sortOrder).toBe(5);
  });

  test("non-leader cannot reorder shared channel", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    // secondaryAOnlyMember is a regular member, not a leader
    const { accessToken } = await generateTokens(ids.secondaryAOnlyMemberId);

    await expect(
      t.mutation(
        api.functions.messaging.sharedChannels.reorderSharedChannel,
        {
          token: accessToken,
          channelId: ids.sharedChannelId,
          groupId: ids.secondaryGroupAId,
          sortOrder: 3,
        }
      )
    ).rejects.toThrow();
  });

  test("cannot reorder for the primary group (use pinnedChannelSlugs instead)", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const { accessToken } = await generateTokens(ids.primaryLeaderId);

    await expect(
      t.mutation(
        api.functions.messaging.sharedChannels.reorderSharedChannel,
        {
          token: accessToken,
          channelId: ids.sharedChannelId,
          groupId: ids.primaryGroupId,
          sortOrder: 1,
        }
      )
    ).rejects.toThrow();
  });

  test("cannot reorder a pending shared channel", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);

    // Add a pending group to the shared channel
    const pendingGroupId = await t.run(async (ctx) => {
      const gId = await ctx.db.insert("groups", {
        communityId: ids.communityId,
        groupTypeId: ids.groupTypeId,
        name: "Pending Group",
        isArchived: false,
        isPublic: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Make secondaryLeaderB leader of this pending group too for the test
      await ctx.db.insert("groupMembers", {
        groupId: gId,
        userId: ids.secondaryLeaderBId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });

      // Add as pending in sharedGroups
      const channel = await ctx.db.get(ids.sharedChannelId);
      const updatedSharedGroups = [
        ...(channel!.sharedGroups ?? []),
        {
          groupId: gId,
          status: "pending" as const,
          invitedById: ids.primaryLeaderId,
          invitedAt: Date.now(),
        },
      ];
      await ctx.db.patch(ids.sharedChannelId, {
        sharedGroups: updatedSharedGroups,
      });
      return gId;
    });

    const { accessToken } = await generateTokens(ids.secondaryLeaderBId);

    await expect(
      t.mutation(
        api.functions.messaging.sharedChannels.reorderSharedChannel,
        {
          token: accessToken,
          channelId: ids.sharedChannelId,
          groupId: pendingGroupId,
          sortOrder: 2,
        }
      )
    ).rejects.toThrow();
  });

  test("sortOrder value is updated in the matching sharedGroups entry", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSharedChannelData(t);
    const { accessToken } = await generateTokens(ids.secondaryLeaderAId);

    // Set initial order
    await t.mutation(
      api.functions.messaging.sharedChannels.reorderSharedChannel,
      {
        token: accessToken,
        channelId: ids.sharedChannelId,
        groupId: ids.secondaryGroupAId,
        sortOrder: 10,
      }
    );

    // Update to new order
    await t.mutation(
      api.functions.messaging.sharedChannels.reorderSharedChannel,
      {
        token: accessToken,
        channelId: ids.sharedChannelId,
        groupId: ids.secondaryGroupAId,
        sortOrder: 3,
      }
    );

    const channel = await t.run(async (ctx) => {
      return await ctx.db.get(ids.sharedChannelId);
    });

    const entry = channel!.sharedGroups!.find(
      (sg) => sg.groupId === ids.secondaryGroupAId
    );
    expect(entry!.sortOrder).toBe(3);

    // Other group's entry should be unchanged
    const otherEntry = channel!.sharedGroups!.find(
      (sg) => sg.groupId === ids.secondaryGroupBId
    );
    expect(otherEntry!.sortOrder).toBeUndefined();
  });
});
