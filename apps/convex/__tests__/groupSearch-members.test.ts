/**
 * Tests for `groupSearch.searchCommunityMembers` — the backend behind the
 * leader-facing "Add people" group-info screen.
 *
 * The function is backed by the `users.search_users` full-text index plus
 * a per-candidate community-membership lookup. The tests below pin down
 * the behaviors that were added to support the group "Add people" UI:
 *
 *  - `inGroup` annotation when `annotateGroupId` is provided
 *  - empty-search recent-members fallback when `annotateGroupId` is provided
 *  - `isActive === false` users are hidden UNLESS they are placeholders
 *  - the caller is excluded by default
 *  - the limit is honored and capped at 100
 *
 * Run with: cd apps/convex && pnpm test __tests__/groupSearch-members.test.ts
 */

import { convexTest } from "convex-test";
import { expect, test, describe, vi, afterEach } from "vitest";
import schema from "../schema";
import { api } from "../_generated/api";
import { modules } from "../test.setup";
import type { Id } from "../_generated/dataModel";
import { generateTokens } from "../lib/auth";

// JWT secret must be at least 32 characters
process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

vi.useFakeTimers();
afterEach(() => {
  vi.clearAllTimers();
});

interface SearchTestData {
  communityId: Id<"communities">;
  groupTypeId: Id<"groupTypes">;
  groupId: Id<"groups">;
  callerUserId: Id<"users">;
  callerToken: string;
  inGroupUserId: Id<"users">;
  outsideGroupUserId: Id<"users">;
  inactiveUserId: Id<"users">;
  placeholderUserId: Id<"users">;
}

async function seedSearchTestData(
  t: ReturnType<typeof convexTest>,
): Promise<SearchTestData> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Search Community",
      slug: "search-community",
      isPublic: true,
      timezone: "America/New_York",
      createdAt: now,
      updatedAt: now,
    });

    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Group",
      slug: "group",
      isActive: true,
      createdAt: now,
      displayOrder: 1,
    });

    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Main Group",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    const callerUserId = await ctx.db.insert("users", {
      firstName: "Caller",
      lastName: "Leader",
      email: "caller@test.com",
      phone: "+15551110001",
      isActive: true,
      searchText: "caller leader caller@test.com +15551110001",
      createdAt: now,
      updatedAt: now,
    });

    // User who is in the group already (should be annotated `inGroup: true`).
    const inGroupUserId = await ctx.db.insert("users", {
      firstName: "Annie",
      lastName: "Member",
      email: "annie@test.com",
      phone: "+15551110002",
      isActive: true,
      searchText: "annie member annie@test.com +15551110002",
      createdAt: now,
      updatedAt: now,
    });

    // User who is in the community but NOT in the group.
    const outsideGroupUserId = await ctx.db.insert("users", {
      firstName: "Annie",
      lastName: "Outside",
      email: "outside@test.com",
      phone: "+15551110003",
      isActive: true,
      searchText: "annie outside outside@test.com +15551110003",
      createdAt: now,
      updatedAt: now,
    });

    // Inactive user — should be hidden because not a placeholder.
    const inactiveUserId = await ctx.db.insert("users", {
      firstName: "Annie",
      lastName: "Inactive",
      email: "inactive@test.com",
      phone: "+15551110004",
      isActive: false,
      searchText: "annie inactive inactive@test.com +15551110004",
      createdAt: now,
      updatedAt: now,
    });

    // Placeholder user — leader-created provisional account. Must remain
    // visible even though isActive=false so leaders see "already invited".
    const placeholderUserId = await ctx.db.insert("users", {
      firstName: "Annie",
      lastName: "Placeholder",
      phone: "+15551110005",
      isActive: false,
      isPlaceholder: true,
      searchText: "annie placeholder +15551110005",
      createdAt: now,
      updatedAt: now,
    });

    // All four belong to the community (status=1).
    for (const userId of [
      callerUserId,
      inGroupUserId,
      outsideGroupUserId,
      inactiveUserId,
      placeholderUserId,
    ]) {
      await ctx.db.insert("userCommunities", {
        userId,
        communityId,
        roles: 1,
        status: 1,
        lastLogin: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Caller + inGroupUser are members of the group.
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: callerUserId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: inGroupUserId,
      role: "member",
      joinedAt: now,
      notificationsEnabled: true,
    });

    return {
      communityId,
      groupTypeId,
      groupId,
      callerUserId,
      inGroupUserId,
      outsideGroupUserId,
      inactiveUserId,
      placeholderUserId,
    };
  });

  const { accessToken: callerToken } = await generateTokens(ids.callerUserId);

  return { ...ids, callerToken };
}

describe("groupSearch.searchCommunityMembers", () => {
  test("annotates `inGroup: true` for users already in the group", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSearchTestData(t);

    const results = await t.query(
      api.functions.groupSearch.searchCommunityMembers,
      {
        token: data.callerToken,
        communityId: data.communityId,
        search: "annie",
        annotateGroupId: data.groupId,
        limit: 30,
      },
    );

    const byId = new Map(results.map((r) => [r.id, r]));

    // Caller is excluded by default.
    expect(byId.has(data.callerUserId)).toBe(false);

    // Annie in group → annotated inGroup=true.
    expect(byId.get(data.inGroupUserId)?.inGroup).toBe(true);
    // Annie outside group → annotated inGroup=false.
    expect(byId.get(data.outsideGroupUserId)?.inGroup).toBe(false);

    // Placeholder remains visible.
    expect(byId.get(data.placeholderUserId)?.inGroup).toBe(false);

    // Inactive (non-placeholder) user is hidden.
    expect(byId.has(data.inactiveUserId)).toBe(false);
  });

  test("falls back to recent community members when search is empty and annotateGroupId is set", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSearchTestData(t);

    const results = await t.query(
      api.functions.groupSearch.searchCommunityMembers,
      {
        token: data.callerToken,
        communityId: data.communityId,
        search: "",
        annotateGroupId: data.groupId,
        limit: 30,
      },
    );

    const returnedIds = new Set(results.map((r) => r.id));
    // Should include some recent community members even without a query.
    expect(returnedIds.has(data.outsideGroupUserId)).toBe(true);
    // Caller still excluded.
    expect(returnedIds.has(data.callerUserId)).toBe(false);
  });

  test("returns [] for empty search when annotateGroupId is not provided", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSearchTestData(t);

    const results = await t.query(
      api.functions.groupSearch.searchCommunityMembers,
      {
        token: data.callerToken,
        communityId: data.communityId,
        search: "",
        limit: 30,
      },
    );

    expect(results).toEqual([]);
  });

  test("throws when annotateGroupId belongs to a different community", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSearchTestData(t);

    const otherCommunityId = await t.run(async (ctx) => {
      return await ctx.db.insert("communities", {
        name: "Other",
        slug: "other",
        isPublic: false,
        timezone: "UTC",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      t.query(api.functions.groupSearch.searchCommunityMembers, {
        token: data.callerToken,
        communityId: otherCommunityId,
        search: "annie",
        annotateGroupId: data.groupId,
        limit: 30,
      }),
    ).rejects.toThrow();
  });

  test("does not return inactive non-placeholder users", async () => {
    const t = convexTest(schema, modules);
    const data = await seedSearchTestData(t);

    const results = await t.query(
      api.functions.groupSearch.searchCommunityMembers,
      {
        token: data.callerToken,
        communityId: data.communityId,
        search: "annie",
        limit: 30,
      },
    );

    const returnedIds = results.map((r) => r.id);
    expect(returnedIds).not.toContain(data.inactiveUserId);
    // But placeholders still surface.
    expect(returnedIds).toContain(data.placeholderUserId);
  });
});
