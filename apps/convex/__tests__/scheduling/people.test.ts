/**
 * Tests for `searchCommunityPeople` — the AssignSheet "search by name" leg
 * of the assign-from-community flow. Covers sort order (in-group first,
 * alpha within bucket), case-insensitive substring matching, caller
 * exclusion, placeholder visibility, the limit cap, and auth gating.
 */

import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import { buildSchedulingWorld } from "./fixtures";
import { buildSearchText } from "../../lib/utils";

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

describe("searchCommunityPeople", () => {
  it("returns in-group members first, then community-only, alpha within each bucket", async () => {
    const { t, world } = await setupSchedulingWorld();
    // Leader is a group member — passes the requireGroupMember gate.
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const results = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "" },
    );

    // In-group bucket: channel admin/moderator/member + placeholder (added
    // by `inviteAndAssign` in fixtures). Group leader excluded as caller.
    const inGroup = results.filter((r) => r.inGroup);
    const outOfGroup = results.filter((r) => !r.inGroup);

    // Every in-group result precedes every out-of-group result.
    if (results.length > 0 && inGroup.length > 0 && outOfGroup.length > 0) {
      const firstOutOfGroupIndex = results.findIndex((r) => !r.inGroup);
      const lastInGroupIndex = results.length -
        1 -
        [...results].reverse().findIndex((r) => r.inGroup);
      expect(lastInGroupIndex).toBeLessThan(firstOutOfGroupIndex);
    }

    // Alpha sort within each bucket.
    const inGroupNames = inGroup.map((r) => r.displayName);
    expect(inGroupNames).toEqual([...inGroupNames].sort((a, b) => a.localeCompare(b)));
    const outOfGroupNames = outOfGroup.map((r) => r.displayName);
    expect(outOfGroupNames).toEqual([...outOfGroupNames].sort((a, b) => a.localeCompare(b)));

    // Community-only members are present in the out-of-group bucket.
    const outIds = new Set(outOfGroup.map((r) => r.userId));
    expect(outIds.has(world.communityOnlyAId)).toBe(true);
    expect(outIds.has(world.communityOnlyBId)).toBe(true);
  });

  it("is case-insensitive across firstName, lastName, and combined display name", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Community-only "Casey Test" matches each of these queries.
    for (const needle of ["casey", "CASEY", "Cas", "test", "casey test"]) {
      const results = await t.query(
        api.functions.scheduling.people.searchCommunityPeople,
        { token: leaderToken, groupId: world.groupId, search: needle },
      );
      const userIds = results.map((r) => r.userId);
      expect(userIds, `expected Casey in results for "${needle}"`).toContain(
        world.communityOnlyAId,
      );
    }
  });

  it("excludes the caller from results", async () => {
    const { t, world } = await setupSchedulingWorld();
    // Use channelAdmin as the caller — they're a community member, so they
    // would otherwise appear in results.
    const callerToken = (await generateTokens(world.channelAdminId)).accessToken;

    const results = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: callerToken, groupId: world.groupId, search: "" },
    );
    expect(results.find((r) => r.userId === world.channelAdminId)).toBeUndefined();
  });

  it("includes placeholders with isPlaceholder: true and correct inGroup", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const results = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "phoebe" },
    );
    const placeholder = results.find((r) => r.userId === world.placeholderUserId);
    expect(placeholder).toBeDefined();
    expect(placeholder!.isPlaceholder).toBe(true);
    // The fixture placeholder is in-group (added when "invited").
    expect(placeholder!.inGroup).toBe(true);

    // Non-placeholders should not be flagged.
    const casey = results.find((r) => r.userId === world.channelMemberId);
    if (casey) expect(casey.isPlaceholder).toBe(false);
  });

  it("empty search returns the FULL group list regardless of `limit` (FR-1)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // On empty search, completeness takes precedence over the recency cap
    // (roster #477 FR-1.1) — passing a tiny `limit` must NOT truncate group
    // members away. This is the inverse of the pre-#477 behavior.
    const full = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "" },
    );
    const tinyLimit = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "", limit: 2 },
    );

    // Both must contain every active group member (caller excluded).
    const inGroupFull = full.filter((r) => r.inGroup).map((r) => r.userId);
    const inGroupTiny = tinyLimit.filter((r) => r.inGroup).map((r) => r.userId);
    expect(new Set(inGroupTiny)).toEqual(new Set(inGroupFull));
    expect(inGroupFull).toContain(world.channelAdminId);
    expect(inGroupFull).toContain(world.channelMemberId);
    expect(inGroupFull).toContain(world.staleGroupMemberId);
  });

  it("surfaces a group member with the OLDEST lastLogin on empty search (FR-1.1)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // "Zeb" is an active group member whose lastLogin is the least-recent in
    // the world — the pre-#477 recency-capped fallback dropped exactly this
    // person until you typed their name. They MUST appear without typing.
    const results = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "" },
    );
    const stale = results.find((r) => r.userId === world.staleGroupMemberId);
    expect(stale, "stale group member must appear on empty search").toBeDefined();
    expect(stale!.inGroup).toBe(true);
  });

  it("typing NARROWS the empty-search set — no new names appear (FR-1.3)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const onOpen = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "" },
    );
    const onOpenIds = new Set(onOpen.map((r) => r.userId));

    // "z" matches only "Zeb" (display name "Zeb Test"). The typed result must
    // be a strict SUBSET of what was shown on open — never an expansion.
    const typed = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "z" },
    );
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.length).toBeLessThan(onOpen.length);
    for (const r of typed) {
      expect(
        onOpenIds.has(r.userId),
        `"${r.displayName}" appeared after typing but was absent on open`,
      ).toBe(true);
    }
    expect(typed.map((r) => r.userId)).toContain(world.staleGroupMemberId);
  });

  it("bounds reads on empty search: full group + only a small community tail (no 3000-row over-fetch)", async () => {
    // Regression for the roster-grid infinite spinner. The empty-search path
    // must return EVERY group member (FR-1) while keeping the wider-community
    // "extras" tail a small constant — not a slice that scales with the 1000
    // group ceiling (which over-fetched up to ~3000 userCommunities rows on a
    // real ~85+ member community and threw past Convex's read cap).
    const t = convexTest(schema, modules);

    const GROUP_SIZE = 40; // a sizeable serving group
    const COMMUNITY_EXTRAS = 300; // many more community-only people around it

    const { communityId, groupId, leaderId, groupMemberIds } = await t.run(
      async (ctx) => {
        const communityId = await ctx.db.insert("communities", {
          name: "Big Community",
          slug: "big",
          isPublic: true,
        });
        const groupTypeId = await ctx.db.insert("groupTypes", {
          communityId,
          name: "Campus",
          slug: "campus",
          isActive: true,
          createdAt: Date.now(),
          displayOrder: 1,
        });
        const groupId = await ctx.db.insert("groups", {
          communityId,
          groupTypeId,
          name: "Big Campus",
          isArchived: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });

        async function newUser(first: string) {
          const userId = await ctx.db.insert("users", {
            firstName: first,
            lastName: "Test",
            email: `${first.toLowerCase()}@example.com`,
            isActive: true,
            roles: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            searchText: buildSearchText({
              firstName: first,
              lastName: "Test",
              email: `${first.toLowerCase()}@example.com`,
            }),
          });
          await ctx.db.insert("userCommunities", {
            communityId,
            userId,
            roles: 1,
            status: 1,
            // Distinct lastLogin so recency ordering is deterministic; group
            // members get the OLDEST stamps so a recency-bounded tail would
            // never surface them — proving completeness comes from the union.
            lastLogin: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          return userId;
        }

        // Leader (caller) — in the group so requireGroupMember passes.
        const leaderId = await newUser("Leader");
        await ctx.db.insert("groupMembers", {
          groupId,
          userId: leaderId,
          role: "leader",
          joinedAt: Date.now(),
          notificationsEnabled: true,
        });

        // The group's full membership (the completeness set).
        const groupMemberIds: string[] = [];
        for (let i = 0; i < GROUP_SIZE; i++) {
          const userId = await newUser(`Grp${String(i).padStart(3, "0")}`);
          await ctx.db.insert("groupMembers", {
            groupId,
            userId,
            role: "member",
            joinedAt: Date.now(),
            notificationsEnabled: true,
          });
          groupMemberIds.push(userId);
        }

        // Many community-only people NOT in the group. Give them the MOST
        // recent lastLogin so they dominate the recency index — the empty
        // search must still cap them to the small constant tail.
        for (let i = 0; i < COMMUNITY_EXTRAS; i++) {
          const userId = await ctx.db.insert("users", {
            firstName: `Ext${String(i).padStart(3, "0")}`,
            lastName: "Test",
            email: `ext${i}@example.com`,
            isActive: true,
            roles: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            searchText: buildSearchText({
              firstName: `Ext${i}`,
              lastName: "Test",
            }),
          });
          await ctx.db.insert("userCommunities", {
            communityId,
            userId,
            roles: 1,
            status: 1,
            lastLogin: Date.now() + i, // most recent
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }

        return { communityId, groupId, leaderId, groupMemberIds };
      },
    );

    expect(communityId).toBeDefined();

    const leaderToken = (await generateTokens(leaderId)).accessToken;
    const results = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId, search: "" },
    );

    // 1) Completeness: EVERY group member appears (caller excluded), each
    //    flagged inGroup. Recency-bounded fallbacks would have dropped these
    //    (oldest lastLogin), so their presence proves the group union.
    const inGroupIds = new Set(
      results.filter((r) => r.inGroup).map((r) => r.userId),
    );
    for (const id of groupMemberIds) {
      expect(inGroupIds.has(id as never)).toBe(true);
    }

    // 2) Bounded tail: community-only ("extras") rows are capped to a small
    //    constant — NOT all 300. Before the fix this tier scaled toward the
    //    1000 ceiling (×3 over-fetch). Assert far fewer than the population.
    const extras = results.filter((r) => !r.inGroup);
    expect(extras.length).toBeLessThanOrEqual(50);
    expect(extras.length).toBeLessThan(COMMUNITY_EXTRAS);
  });

  it("rejects a non-group, non-community-admin caller with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.people.searchCommunityPeople, {
        token: outsiderToken,
        groupId: world.groupId,
        search: "",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("a community admin (not in the group) may search", async () => {
    const { t, world } = await setupSchedulingWorld();
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;

    const results = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: adminToken, groupId: world.groupId, search: "" },
    );
    // No throw, and the caller (community admin) is excluded.
    expect(results.find((r) => r.userId === world.communityAdminId)).toBeUndefined();
  });
});
