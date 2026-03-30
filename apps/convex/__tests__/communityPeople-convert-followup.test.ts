/**
 * communityPeople.convertFollowupType — reclassify history rows for scoring.
 */

import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

const COMMUNITY_ROLES = { ADMIN: 3, MEMBER: 1 } as const;

async function seedConvertFixture(t: ReturnType<typeof convexTest>) {
  const now = Date.now();

  const ids = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Convert Followup Community",
      slug: "convert-followup-community",
      isPublic: true,
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Announcements",
      slug: "announcements",
      isActive: true,
      createdAt: now,
      displayOrder: 0,
    });

    const announcementGroupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Announcements",
      isAnnouncementGroup: true,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    const adminUserId = await ctx.db.insert("users", {
      firstName: "Admin",
      lastName: "Leader",
      email: "admin-convert@test.com",
      phone: "+15555553001",
      createdAt: now,
      updatedAt: now,
    });

    const memberUserId = await ctx.db.insert("users", {
      firstName: "Member",
      lastName: "Person",
      email: "member-convert@test.com",
      phone: "+15555553002",
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

    const groupMemberId = await ctx.db.insert("groupMembers", {
      groupId: announcementGroupId,
      userId: memberUserId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    const followupId = await ctx.db.insert("memberFollowups", {
      groupMemberId,
      createdById: adminUserId,
      type: "note",
      content: "Landing Page Submission (Mar 30, 2026)\nZIP: 10039",
      createdAt: now - 60_000,
    });

    const communityPeopleId = await ctx.db.insert("communityPeople", {
      communityId,
      groupId: announcementGroupId,
      userId: memberUserId,
      firstName: "Member",
      lastName: "Person",
      createdAt: now,
      updatedAt: now,
    });

    return {
      communityId,
      announcementGroupId,
      adminUserId,
      memberUserId,
      groupMemberId,
      followupId,
      communityPeopleId,
    };
  });

  const { accessToken: adminToken } = await generateTokens(
    ids.adminUserId.toString(),
    ids.communityId.toString(),
  );

  return { ...ids, adminToken };
}

describe("communityPeople.convertFollowupType", () => {
  test("community admin can convert a note to call and preserve content", async () => {
    const t = convexTest(schema, modules);
    const { adminToken, communityPeopleId, followupId } = await seedConvertFixture(t);

    await t.mutation(api.functions.communityPeople.convertFollowupType, {
      token: adminToken,
      communityPeopleId,
      followupId,
      newType: "call",
    });

    const row = await t.run(async (ctx) => ctx.db.get(followupId));
    expect(row?.type).toBe("call");
    expect(row?.content).toContain("Landing Page Submission");
  });

  test("rejects when followup belongs to a different person", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedConvertFixture(t);

    const other = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        firstName: "Other",
        lastName: "User",
        email: "other-convert@test.com",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const gm = await ctx.db.insert("groupMembers", {
        groupId: fixture.announcementGroupId,
        userId: uid,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      const fid = await ctx.db.insert("memberFollowups", {
        groupMemberId: gm,
        createdById: fixture.adminUserId,
        type: "note",
        content: "Wrong member note",
        createdAt: Date.now(),
      });
      return { fid };
    });

    await expect(
      t.mutation(api.functions.communityPeople.convertFollowupType, {
        token: fixture.adminToken,
        communityPeopleId: fixture.communityPeopleId,
        followupId: other.fid,
        newType: "text",
      }),
    ).rejects.toThrow(/does not belong/);
  });
});
