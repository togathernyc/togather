/**
 * Tests for the server-side `search` argument on `groupMembers.list` — the
 * backend behind the mobile Hosts picker's "Search members" field.
 *
 * Before this argument existed the picker fetched a single capped page and
 * filtered it client-side, so in large groups any member beyond the first page
 * was unsearchable. These tests pin down that:
 *
 *  - a member who sorts beyond the first page is NOT in the un-searched page,
 *    but IS found when `search` is provided (search spans the whole group)
 *  - search matches first name, last name, full name, and email
 *  - the member-list security check still applies to searched requests
 *
 * Run with: cd apps/convex && pnpm test __tests__/groupMembers-list-search.test.ts
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

interface ListSearchTestData {
  groupId: Id<"groups">;
  callerUserId: Id<"users">;
  callerToken: string;
  outsiderToken: string;
  // A member who joins last, so they sort to the end of a large group and fall
  // beyond the first page when listing without a search term.
  farawayUserId: Id<"users">;
}

const PAGE_SIZE = 100;
const MEMBER_COUNT = 120;

async function seedLargeGroup(
  t: ReturnType<typeof convexTest>,
): Promise<ListSearchTestData> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const communityId = await ctx.db.insert("communities", {
      name: "Big Community",
      slug: "big-community",
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
      name: "Big Group",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    });

    // Caller is a leader so they pass the member-list security check.
    const callerUserId = await ctx.db.insert("users", {
      firstName: "Caller",
      lastName: "Leader",
      email: "caller@test.com",
      phone: "+15551110000",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: callerUserId,
      role: "leader",
      joinedAt: now,
      notificationsEnabled: true,
    });

    // A pile of ordinary members, joined in sequence so they sort by joinedAt.
    for (let i = 0; i < MEMBER_COUNT; i++) {
      const userId = await ctx.db.insert("users", {
        firstName: `Member${i}`,
        lastName: "Test",
        email: `member${i}@test.com`,
        phone: `+1555200${String(i).padStart(4, "0")}`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId,
        role: "member",
        joinedAt: now + i + 1,
        notificationsEnabled: true,
      });
    }

    // The faraway member joins last, so they land beyond the first page.
    const farawayUserId = await ctx.db.insert("users", {
      firstName: "Zelda",
      lastName: "Faraway",
      email: "zelda@test.com",
      phone: "+15559990000",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: farawayUserId,
      role: "member",
      joinedAt: now + MEMBER_COUNT + 1000,
      notificationsEnabled: true,
    });

    // A user who is NOT in the group — used to assert the security check.
    const outsiderUserId = await ctx.db.insert("users", {
      firstName: "Olivia",
      lastName: "Outsider",
      email: "olivia@test.com",
      phone: "+15558880000",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return { groupId, callerUserId, farawayUserId, outsiderUserId };
  });

  const { accessToken: callerToken } = await generateTokens(ids.callerUserId);
  const { accessToken: outsiderToken } = await generateTokens(
    ids.outsiderUserId,
  );

  return {
    groupId: ids.groupId,
    callerUserId: ids.callerUserId,
    farawayUserId: ids.farawayUserId,
    callerToken,
    outsiderToken,
  };
}

describe("groupMembers.list server-side search", () => {
  test("a member beyond the first page is absent without search but found with it", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroup(t);

    // Without a search term, the first page does not include the faraway member.
    const page = await t.query(api.functions.groupMembers.list, {
      groupId: data.groupId,
      token: data.callerToken,
      limit: PAGE_SIZE,
    });
    const pageIds = page.items.map((i) => i.user?.id);
    expect(page.items.length).toBe(PAGE_SIZE);
    expect(pageIds).not.toContain(data.farawayUserId);

    // Searching finds them even though they are beyond the first page.
    const searched = await t.query(api.functions.groupMembers.list, {
      groupId: data.groupId,
      token: data.callerToken,
      search: "zelda",
      limit: PAGE_SIZE,
    });
    const searchedIds = searched.items.map((i) => i.user?.id);
    expect(searchedIds).toContain(data.farawayUserId);
  });

  test("search matches last name, full name, and email", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroup(t);

    for (const term of ["faraway", "zelda faraway", "zelda@test.com"]) {
      const res = await t.query(api.functions.groupMembers.list, {
        groupId: data.groupId,
        token: data.callerToken,
        search: term,
        limit: PAGE_SIZE,
      });
      const ids = res.items.map((i) => i.user?.id);
      expect(ids, `term "${term}"`).toContain(data.farawayUserId);
    }
  });

  test("non-members get an empty result even when searching", async () => {
    const t = convexTest(schema, modules);
    const data = await seedLargeGroup(t);

    const res = await t.query(api.functions.groupMembers.list, {
      groupId: data.groupId,
      token: data.outsiderToken,
      search: "zelda",
      limit: PAGE_SIZE,
    });

    expect(res.items).toEqual([]);
  });
});
