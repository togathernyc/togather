/**
 * Test fixtures for the native event-scheduling module (ADR-023).
 *
 * Builds a minimal but complete world: a community, a campus group, a
 * serving-team channel, a role, and a set of users with different
 * permission levels (channel admin, channel member, group leader,
 * community admin, plain volunteer).
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

    const channelAdminId = await insertUser(ctx, "Adminda", "2025550001");
    const channelModeratorId = await insertUser(ctx, "Modesto", "2025550002");
    const channelMemberId = await insertUser(ctx, "Memberly", "2025550003");
    const groupLeaderId = await insertUser(ctx, "Leandra", "2025550004");
    const communityAdminId = await insertUser(ctx, "Comadmin", "2025550005");
    const outsiderId = await insertUser(ctx, "Outsider", "2025550006");

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

    // Group memberships.
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: groupLeaderId,
      role: "leader",
      joinedAt: ts(),
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: channelMemberId,
      role: "member",
      joinedAt: ts(),
      notificationsEnabled: true,
    });

    // Community admin membership.
    await ctx.db.insert("userCommunities", {
      communityId,
      userId: communityAdminId,
      roles: 3, // COMMUNITY_ROLES.ADMIN
      status: 1,
      createdAt: ts(),
      updatedAt: ts(),
    });

    const roleId = await ctx.db.insert("teamRoles", {
      channelId,
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
      channelId,
      roleId,
      channelAdminId,
      channelModeratorId,
      channelMemberId,
      groupLeaderId,
      communityAdminId,
      outsiderId,
    };
  });

  return world;
}
