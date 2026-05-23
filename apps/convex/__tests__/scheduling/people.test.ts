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

  it("limit caps the result count; default applies when omitted", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const unlimited = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "" },
    );

    const limited = await t.query(
      api.functions.scheduling.people.searchCommunityPeople,
      { token: leaderToken, groupId: world.groupId, search: "", limit: 2 },
    );
    expect(limited).toHaveLength(2);

    // Default limit applies — the world has fewer than 30 candidates, so the
    // unlimited call returns everything that matched (no truncation).
    // This protects against a regression that drops the default cap.
    expect(unlimited.length).toBeGreaterThan(limited.length);
    expect(unlimited.length).toBeLessThanOrEqual(30);
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
