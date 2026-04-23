/**
 * Tests for `functions/userProfiles.ts` — specifically the privacy-filter
 * logic that drives what events a viewer sees on another user's profile.
 *
 * Coverage:
 *   - `getVisibleUpcomingEvents`: public vs community vs group visibility
 *     gating for a viewer.
 *   - `getMutualGroups`: scope to `communityId`, exclude archived and
 *     left-groups.
 *
 * Run with: cd apps/convex && pnpm test __tests__/userProfiles.test.ts
 */

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import { generateTokens } from "../lib/auth";
import type { Id } from "../_generated/dataModel";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();

const MEMBERSHIP_ACTIVE = 1;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

interface SeedWorld {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupA: Id<"groups">;
  groupB: Id<"groups">;
  archivedGroup: Id<"groups">;
  profileUserId: Id<"users">;
  viewerInCommunityInGroupAId: Id<"users">;
  viewerInCommunityNoGroupsId: Id<"users">;
  viewerOutsideCommunityId: Id<"users">;
}

async function seed(t: ReturnType<typeof convexTest>): Promise<SeedWorld> {
  const now = Date.now();

  const ids = await t.run(async (ctx) => {
    const communityId = await ctx.db.insert("communities", {
      name: "Test Community",
      slug: "test",
      isPublic: true,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Small Group",
      slug: "small-group",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    const groupA = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group A",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });
    const groupB = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Group B",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });
    const archivedGroup = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Old Archived",
      isArchived: true,
      archivedAt: now - 1000,
      createdAt: now,
      updatedAt: now,
    });

    // Profile user — a member of groupA, groupB, and the archived group
    const profileUserId = await ctx.db.insert("users", {
      firstName: "Profile",
      lastName: "User",
      isActive: true,
    });
    await ctx.db.insert("userCommunities", {
      userId: profileUserId,
      communityId,
      roles: 1,
      status: MEMBERSHIP_ACTIVE,
      createdAt: now,
    });
    await ctx.db.insert("groupMembers", {
      groupId: groupA,
      userId: profileUserId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: groupB,
      userId: profileUserId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: archivedGroup,
      userId: profileUserId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // Viewer #1: in the community, member of groupA (shares groupA only)
    const viewerInCommunityInGroupAId = await ctx.db.insert("users", {
      firstName: "Viewer",
      lastName: "InA",
      isActive: true,
    });
    await ctx.db.insert("userCommunities", {
      userId: viewerInCommunityInGroupAId,
      communityId,
      roles: 1,
      status: MEMBERSHIP_ACTIVE,
      createdAt: now,
    });
    await ctx.db.insert("groupMembers", {
      groupId: groupA,
      userId: viewerInCommunityInGroupAId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId: archivedGroup,
      userId: viewerInCommunityInGroupAId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // Viewer #2: in the community, no groups
    const viewerInCommunityNoGroupsId = await ctx.db.insert("users", {
      firstName: "Viewer",
      lastName: "NoGroups",
      isActive: true,
    });
    await ctx.db.insert("userCommunities", {
      userId: viewerInCommunityNoGroupsId,
      communityId,
      roles: 1,
      status: MEMBERSHIP_ACTIVE,
      createdAt: now,
    });

    // Viewer #3: NOT in the community
    const viewerOutsideCommunityId = await ctx.db.insert("users", {
      firstName: "Viewer",
      lastName: "Outsider",
      isActive: true,
    });

    return {
      communityId,
      groupTypeId,
      groupA,
      groupB,
      archivedGroup,
      profileUserId,
      viewerInCommunityInGroupAId,
      viewerInCommunityNoGroupsId,
      viewerOutsideCommunityId,
    };
  });

  return ids as SeedWorld;
}

// ---------------------------------------------------------------------------
// getVisibleUpcomingEvents
// ---------------------------------------------------------------------------

describe("userProfiles.getVisibleUpcomingEvents", () => {
  test("public event is visible to anyone who can query", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("meetings", {
        groupId: w.groupA,
        communityId: w.communityId,
        createdById: w.profileUserId,
        scheduledAt: now + 60_000,
        status: "scheduled",
        meetingType: 1,
        createdAt: now,
        visibility: "public",
        title: "Public Hosted",
      });
    });

    const { accessToken } = await generateTokens(w.viewerOutsideCommunityId);
    const events = (await t.query(
      api.functions.userProfiles.getVisibleUpcomingEvents,
      {
        token: accessToken,
        profileUserId: w.profileUserId,
        communityId: w.communityId,
        now,
      },
    )) as any[];

    expect(events).toHaveLength(1);
    expect(events[0].role).toBe("hosting");
  });

  test("community event is only visible to community members", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("meetings", {
        groupId: w.groupA,
        communityId: w.communityId,
        createdById: w.profileUserId,
        scheduledAt: now + 60_000,
        status: "scheduled",
        meetingType: 1,
        createdAt: now,
        visibility: "community",
        title: "Community Hosted",
      });
    });

    // Community member → sees it.
    const { accessToken: memberToken } = await generateTokens(
      w.viewerInCommunityNoGroupsId,
    );
    const forMember = (await t.query(
      api.functions.userProfiles.getVisibleUpcomingEvents,
      {
        token: memberToken,
        profileUserId: w.profileUserId,
        communityId: w.communityId,
        now,
      },
    )) as any[];
    expect(forMember).toHaveLength(1);

    // Non-member → filtered out.
    const { accessToken: outsiderToken } = await generateTokens(
      w.viewerOutsideCommunityId,
    );
    const forOutsider = (await t.query(
      api.functions.userProfiles.getVisibleUpcomingEvents,
      {
        token: outsiderToken,
        profileUserId: w.profileUserId,
        communityId: w.communityId,
        now,
      },
    )) as any[];
    expect(forOutsider).toHaveLength(0);
  });

  test("group event is only visible to group members", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("meetings", {
        groupId: w.groupB,
        communityId: w.communityId,
        createdById: w.profileUserId,
        scheduledAt: now + 60_000,
        status: "scheduled",
        meetingType: 1,
        createdAt: now,
        visibility: "group",
        title: "Group B event",
      });
    });

    // Viewer in Group A (NOT B) — filtered out.
    const { accessToken: groupAToken } = await generateTokens(
      w.viewerInCommunityInGroupAId,
    );
    const forGroupA = (await t.query(
      api.functions.userProfiles.getVisibleUpcomingEvents,
      {
        token: groupAToken,
        profileUserId: w.profileUserId,
        communityId: w.communityId,
        now,
      },
    )) as any[];
    expect(forGroupA).toHaveLength(0);

    // Community-only member (no groups) — also filtered out.
    const { accessToken: noGroupsToken } = await generateTokens(
      w.viewerInCommunityNoGroupsId,
    );
    const forNoGroups = (await t.query(
      api.functions.userProfiles.getVisibleUpcomingEvents,
      {
        token: noGroupsToken,
        profileUserId: w.profileUserId,
        communityId: w.communityId,
        now,
      },
    )) as any[];
    expect(forNoGroups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getMutualGroups
// ---------------------------------------------------------------------------

describe("userProfiles.getMutualGroups", () => {
  test("returns only groups in the specified community, excluding archived & left", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const now = Date.now();

    // Add a second community + shared group in it, to prove community scoping.
    await t.run(async (ctx) => {
      const otherCommunityId = await ctx.db.insert("communities", {
        name: "Other Community",
        slug: "other",
      });
      const otherGroupTypeId = await ctx.db.insert("groupTypes", {
        communityId: otherCommunityId,
        name: "type",
        slug: "type",
        isActive: true,
        createdAt: now,
        displayOrder: 1,
      });
      const otherGroupId = await ctx.db.insert("groups", {
        communityId: otherCommunityId,
        groupTypeId: otherGroupTypeId,
        name: "Cross-community group",
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });
      // Both the profile user and the viewer are in this other-community group
      // too — but since we query by `w.communityId`, it must NOT appear.
      await ctx.db.insert("groupMembers", {
        groupId: otherGroupId,
        userId: w.profileUserId,
        role: "member",
        joinedAt: now,
        notificationsEnabled: true,
      });
      await ctx.db.insert("groupMembers", {
        groupId: otherGroupId,
        userId: w.viewerInCommunityInGroupAId,
        role: "member",
        joinedAt: now,
        notificationsEnabled: true,
      });

      // Mark the viewer as "left" the archived group — mutual-check must
      // skip left memberships. (It was only set up as an edge case; also
      // excluded because the group is archived.)
      const viewerArchivedMembership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", w.archivedGroup).eq("userId", w.viewerInCommunityInGroupAId),
        )
        .first();
      if (viewerArchivedMembership) {
        await ctx.db.patch(viewerArchivedMembership._id, { leftAt: now });
      }
    });

    const { accessToken: viewerToken } = await generateTokens(
      w.viewerInCommunityInGroupAId,
    );

    const mutual = (await t.query(api.functions.userProfiles.getMutualGroups, {
      token: viewerToken,
      profileUserId: w.profileUserId,
      communityId: w.communityId,
    })) as Array<{ _id: Id<"groups">; name: string }>;

    // Only Group A should come back:
    // - Group B: profile user is in it, viewer is not → not mutual
    // - archivedGroup: archived → excluded
    // - cross-community group: wrong community → excluded
    expect(mutual.map((g) => g.name)).toEqual(["Group A"]);
  });

  test("returns empty when the viewer is looking at their own profile", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);

    const { accessToken: selfToken } = await generateTokens(w.profileUserId);
    const mutual = (await t.query(api.functions.userProfiles.getMutualGroups, {
      token: selfToken,
      profileUserId: w.profileUserId,
      communityId: w.communityId,
    })) as any[];

    expect(mutual).toEqual([]);
  });
});
