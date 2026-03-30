/**
 * Permissions for memberFollowups.updateAttendance and communityPeople.history canEdit.
 *
 * Community admins must be able to edit attendance for any member in their community,
 * including groups where they are not a leader.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const COMMUNITY_ROLES = {
  MEMBER: 1,
  ADMIN: 3,
  PRIMARY_ADMIN: 4,
} as const;

async function seedAttendancePermFixture(t: ReturnType<typeof convexTest>) {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const ids = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Attendance Perm Community",
      slug: "attendance-perm-community",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Test Group",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    const adminUserId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "User",
      email: "admin-att@test.com",
      phone: "+15555552001",
      createdAt: now,
      updatedAt: now,
    });

    const memberUserId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "User",
      email: "member-att@test.com",
      phone: "+15555552002",
      createdAt: now,
      updatedAt: now,
    });

    const regularUserId = await ctx.db.insert("users", {
      firstName: "Regular",
      lastName: "User",
      email: "regular-att@test.com",
      phone: "+15555552003",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: adminUserId,
      communityId,
      roles: COMMUNITY_ROLES.ADMIN,
      status: 1,
      createdAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: memberUserId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: now,
    });

    await ctx.db.insert("userCommunities", {
      userId: regularUserId,
      communityId,
      roles: COMMUNITY_ROLES.MEMBER,
      status: 1,
      createdAt: now,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberUserId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });

    await ctx.db.insert("groupMembers", {
      groupId,
      userId: regularUserId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    const meetingId = await ctx.db.insert("meetings", {
      groupId,
      title: "Past Meeting",
      scheduledAt: now - 2 * DAY_MS,
      status: "scheduled",
      meetingType: 1,
      createdAt: now,
    });

    const communityPeopleId = await ctx.db.insert("communityPeople", {
      communityId,
      groupId,
      userId: regularUserId,
      firstName: "Regular",
      lastName: "User",
      createdAt: now,
      updatedAt: now,
    });

    return {
      communityId,
      groupId,
      adminUserId,
      regularUserId,
      meetingId,
      communityPeopleId,
    };
  });

  const adminTok = await generateTokens(ids.adminUserId.toString(), ids.communityId.toString());
  const regTok = await generateTokens(ids.regularUserId.toString(), ids.communityId.toString());

  return {
    ...ids,
    adminToken: adminTok.accessToken,
    regularToken: regTok.accessToken,
  };
}

describe("updateAttendance permissions", () => {
  test("community admin can update attendance without being a group leader", async () => {
    const t = convexTest(schema, modules);
    const { adminToken, groupId, meetingId, regularUserId } = await seedAttendancePermFixture(t);

    const result = await t.mutation(api.functions.memberFollowups.updateAttendance, {
      token: adminToken,
      groupId,
      meetingId,
      targetUserId: regularUserId,
      status: 1,
    });

    expect(result.status).toBe(1);
    expect(result.odUserId).toEqual(regularUserId);
  });

  test("regular member cannot update another member's attendance", async () => {
    const t = convexTest(schema, modules);
    const { regularToken, groupId, meetingId, regularUserId } = await seedAttendancePermFixture(t);

    await expect(
      t.mutation(api.functions.memberFollowups.updateAttendance, {
        token: regularToken,
        groupId,
        meetingId,
        targetUserId: regularUserId,
        status: 1,
      })
    ).rejects.toThrow();
  });

  test("communityPeople.history sets canEdit for community admin on all member groups", async () => {
    const t = convexTest(schema, modules);
    const { adminToken, communityPeopleId, groupId } = await seedAttendancePermFixture(t);

    const history = await t.query(api.functions.communityPeople.history, {
      token: adminToken,
      communityPeopleId,
    });

    const groupBlock = history.crossGroupAttendance.find(
      (g: { groupId: string; canEdit: boolean }) => g.groupId === groupId.toString()
    );
    expect(groupBlock).toBeDefined();
    expect(groupBlock!.canEdit).toBe(true);
  });
});
