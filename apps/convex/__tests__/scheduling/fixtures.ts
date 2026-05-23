/**
 * Test fixtures for the native event-scheduling module (ADR-023 / ADR-025).
 *
 * Builds a minimal but complete world: a community, a campus group, a
 * first-class serving `teams` row with its chat channel, a role, and a set of
 * users with different permission levels (channel admin, channel member,
 * group leader, community admin, plain volunteer).
 */

import type { Id } from "../../_generated/dataModel";

/**
 * The convex-test handle. Typed via a type-only dynamic import so this file
 * imports no runtime code from `convex-test`/`test.setup` — keeping it safe
 * for Convex's module analyzer, which bundles every non-`.test.ts` file.
 * The handle is created in each `.test.ts` file and passed to
 * `buildSchedulingWorld`.
 */
type ConvexTestHandle = ReturnType<typeof import("convex-test").convexTest>;

export function ts(offsetDays = 0): number {
  return Date.now() + offsetDays * 24 * 60 * 60 * 1000;
}

export interface SchedulingWorld {
  communityId: Id<"communities">;
  groupId: Id<"groups">;
  /** The first-class serving team (ADR-025). */
  teamId: Id<"teams">;
  /** The serving team's chat channel. */
  channelId: Id<"chatChannels">;
  roleId: Id<"teamRoles">;
  /** chatChannelMembers.role === "admin" */
  channelAdminId: Id<"users">;
  /** chatChannelMembers.role === "moderator" */
  channelModeratorId: Id<"users">;
  /** chatChannelMembers.role === "member" — plain volunteer */
  channelMemberId: Id<"users">;
  /** groupMembers.role === "leader", not in the channel */
  groupLeaderId: Id<"users">;
  /** userCommunities.roles === ADMIN, not in the group or channel */
  communityAdminId: Id<"users">;
  /** No memberships anywhere */
  outsiderId: Id<"users">;
  /**
   * Active community member ("Comonly") who is NOT in the group. Used by the
   * AssignSheet community-search / `assignFromCommunity` tests.
   */
  communityOnlyAId: Id<"users">;
  /** A second community-only member ("Casey") to test name sort/filter. */
  communityOnlyBId: Id<"users">;
  /**
   * Placeholder user inserted by a previous `inviteAndAssign` call. Has an
   * active community + group membership but `isPlaceholder: true` and
   * `isActive: false`. Used by people-search / claim tests.
   */
  placeholderUserId: Id<"users">;
}

async function insertUser(
  ctx: any,
  firstName: string,
  phone?: string,
): Promise<Id<"users">> {
  return ctx.db.insert("users", {
    firstName,
    lastName: "Test",
    email: `${firstName.toLowerCase()}@example.com`,
    phone,
    isActive: true,
    roles: 1,
    createdAt: ts(),
    updatedAt: ts(),
  });
}

/**
 * Seed the full scheduling test world into the given convex-test handle.
 * The handle (`convexTest(schema, modules)`) is created by the calling
 * `.test.ts` file — see the `setupSchedulingWorld` wrapper in each.
 */
export async function buildSchedulingWorld(
  t: ConvexTestHandle,
): Promise<SchedulingWorld> {
  const world = await t.run(async (ctx): Promise<SchedulingWorld> => {
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test",
      isPublic: true,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Campus",
      slug: "campus",
      isActive: true,
      createdAt: ts(),
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Brooklyn Campus",
      isArchived: false,
      createdAt: ts(),
      updatedAt: ts(),
    });

    // Phones are stored normalized (E.164) to mirror production — the auth
    // pipeline normalizes before insert. Tests that look up by phone via
    // `by_phone` rely on this.
    const channelAdminId = await insertUser(ctx, "Adminda", "+12025550001");
    const channelModeratorId = await insertUser(ctx, "Modesto", "+12025550002");
    const channelMemberId = await insertUser(ctx, "Memberly", "+12025550003");
    const groupLeaderId = await insertUser(ctx, "Leandra", "+12025550004");
    const communityAdminId = await insertUser(ctx, "Comadmin", "+12025550005");
    const outsiderId = await insertUser(ctx, "Outsider", "+12025550006");
    // Community-only members (not in the group). Names chosen for alphabetic
    // sort: "Casey" < "Comonly", so the search ordering is predictable.
    const communityOnlyAId = await insertUser(ctx, "Casey", "+12025550007");
    const communityOnlyBId = await insertUser(ctx, "Comonly", "+12025550008");
    // Placeholder user — inserted as if `inviteAndAssign` had created them.
    // Active in community + group, but flagged so the UI / claim path can
    // recognise them.
    const placeholderUserId = await ctx.db.insert("users", {
      firstName: "Phoebe",
      lastName: "Placeholder",
      phone: "+12025550009",
      isActive: false,
      isPlaceholder: true,
      phoneVerified: false,
      createdAt: ts(),
      updatedAt: ts(),
    });

    const channelId = await ctx.db.insert("chatChannels", {
      groupId,
      communityId,
      name: "Worship Team",
      channelType: "custom",
      memberCount: 3,
      isArchived: false,
      isServingTeam: true,
      createdById: channelAdminId,
      createdAt: ts(),
      updatedAt: ts(),
    });

    // Channel memberships.
    for (const [userId, role] of [
      [channelAdminId, "admin"],
      [channelModeratorId, "moderator"],
      [channelMemberId, "member"],
    ] as const) {
      await ctx.db.insert("chatChannelMembers", {
        channelId,
        userId,
        role,
        joinedAt: ts(),
        isMuted: false,
      });
    }

    // Group memberships. The serving-team channel lives inside this group,
    // so every channel member is also a group member (assignees must be).
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: groupLeaderId,
      role: "leader",
      joinedAt: ts(),
      notificationsEnabled: true,
    });
    for (const userId of [
      channelAdminId,
      channelModeratorId,
      channelMemberId,
    ]) {
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: ts(),
        notificationsEnabled: true,
      });
    }

    // Community admin membership.
    await ctx.db.insert("userCommunities", {
      communityId,
      userId: communityAdminId,
      roles: 3, // COMMUNITY_ROLES.ADMIN
      status: 1,
      createdAt: ts(),
      updatedAt: ts(),
    });

    // Active community memberships for the in-group users (so the people
    // search has a complete view). Channel/group users above don't otherwise
    // exist in `userCommunities`.
    for (const userId of [
      channelAdminId,
      channelModeratorId,
      channelMemberId,
      groupLeaderId,
    ]) {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId,
        roles: 1,
        status: 1,
        createdAt: ts(),
        updatedAt: ts(),
      });
    }

    // Community-only members and the placeholder all live in the community.
    for (const userId of [communityOnlyAId, communityOnlyBId, placeholderUserId]) {
      await ctx.db.insert("userCommunities", {
        communityId,
        userId,
        roles: 1,
        status: 1,
        createdAt: ts(),
        updatedAt: ts(),
      });
    }

    // The placeholder is "already in the group" (the leader added them when
    // they were invited), but the community-only members are NOT.
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: placeholderUserId,
      role: "member",
      joinedAt: ts(),
      notificationsEnabled: true,
    });

    // The first-class serving team (ADR-025). It owns the chat channel above
    // and the roles below; assignments and needed-roles key off `teamId`.
    const teamId = await ctx.db.insert("teams", {
      groupId,
      communityId,
      name: "Worship Team",
      channelId,
      isArchived: false,
      createdAt: ts(),
      createdById: channelAdminId,
      updatedAt: ts(),
    });

    const roleId = await ctx.db.insert("teamRoles", {
      teamId,
      communityId,
      name: "Drums",
      sortOrder: 0,
      defaultNeeded: 1,
      isArchived: false,
      createdAt: ts(),
      createdById: channelAdminId,
    });

    return {
      communityId,
      groupId,
      teamId,
      channelId,
      roleId,
      channelAdminId,
      channelModeratorId,
      channelMemberId,
      groupLeaderId,
      communityAdminId,
      outsiderId,
      communityOnlyAId,
      communityOnlyBId,
      placeholderUserId,
    };
  });

  return world;
}
