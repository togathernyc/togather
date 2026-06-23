/**
 * Tests for `quickStartRostering` — the one-tap rostering bootstrap.
 *
 * A leader on a brand-new group taps "Set up rostering" and the mutation
 * creates, in one transaction: a starter serving team (with its chat
 * channel), suggested starter roles on it, a draft event plan dated at the
 * SAME neutral default the manual "New event plan" flow uses (next Sunday at
 * 9 AM — leader-owned, edited in the editor; cadence is deliberately NOT
 * read), and that plan's needed roles seeded from the team's role defaults.
 *
 * It is strictly additive and idempotent: if the group already has any
 * rostering data (a team OR an event plan), it is a non-destructive no-op.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import { buildSchedulingWorld } from "./fixtures";

/**
 * Most-recently-created test handle — drained after each test so a pending
 * scheduled reconcile does not leak into the next test.
 */
let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

/**
 * `buildSchedulingWorld` seeds a group that already has a team + roles, which
 * is the wrong starting point for the happy-path quick-start (it would no-op).
 * This builds a SECOND, bare group in the same community — a real leader, a
 * real campus group, and no teams / no event plans — so we can exercise the
 * fresh-group bootstrap.
 */
async function buildBareGroup(
  t: ReturnType<typeof convexTest>,
  communityId: any,
) {
  return t.run(async (ctx) => {
    const groupTypeId = await ctx.db.insert("groupTypes", {
      communityId,
      name: "Campus",
      slug: "campus-bare",
      isActive: true,
      createdAt: Date.now(),
      displayOrder: 2,
    });
    const groupId = await ctx.db.insert("groups", {
      communityId,
      groupTypeId,
      name: "Fresh Campus",
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const leaderId = await ctx.db.insert("users", {
      firstName: "Fresh",
      lastName: "Leader",
      email: "fresh.leader@example.com",
      phone: "+12025559001",
      isActive: true,
      roles: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: leaderId,
      role: "leader",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
    const memberId = await ctx.db.insert("users", {
      firstName: "Fresh",
      lastName: "Member",
      email: "fresh.member@example.com",
      phone: "+12025559002",
      isActive: true,
      roles: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("groupMembers", {
      groupId,
      userId: memberId,
      role: "member",
      joinedAt: Date.now(),
      notificationsEnabled: true,
    });
    return { groupId, leaderId, memberId };
  });
}

describe("quickStartRostering", () => {
  it("bootstraps a team, starter roles, a draft plan, and needed roles", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { groupId, leaderId } = await buildBareGroup(t, world.communityId);
    const leaderToken = (await generateTokens(leaderId)).accessToken;

    const result = await t.mutation(
      api.functions.scheduling.quickStart.quickStartRostering,
      { token: leaderToken, groupId },
    );

    expect(result.alreadySetUp).toBe(false);
    expect(result.teamId).not.toBeNull();
    expect(result.planId).not.toBeNull();

    await t.run(async (ctx) => {
      // One starter team, with a chat channel, in this group.
      const teams = await ctx.db
        .query("teams")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      expect(teams).toHaveLength(1);
      const team = teams[0];
      expect(team._id).toBe(result.teamId);
      expect(team.channelId).toBeDefined();
      const channel = await ctx.db.get(team.channelId!);
      expect(channel?.isServingTeam).toBe(true);

      // Generic team name → DEFAULT_STARTER_ROLES = Team Lead + Volunteer.
      const roles = await ctx.db
        .query("teamRoles")
        .withIndex("by_team", (q) => q.eq("teamId", team._id))
        .collect();
      const roleNames = roles.map((r) => r.name).sort();
      expect(roleNames).toEqual(["Team Lead", "Volunteer"]);

      // Draft plan in this group.
      const plan = await ctx.db.get(result.planId!);
      expect(plan).not.toBeNull();
      expect(plan!.groupId).toBe(groupId);
      expect(plan!.status).toBe("draft");
      expect(plan!.times.length).toBeGreaterThan(0);

      // Needed roles seeded from the team's role defaults: Team Lead (1) +
      // Volunteer (2) both have a positive defaultNeeded.
      const needed = await ctx.db
        .query("neededRoles")
        .withIndex("by_plan", (q) => q.eq("planId", result.planId!))
        .collect();
      expect(needed).toHaveLength(2);
      const totalNeeded = needed.reduce((sum, n) => sum + n.count, 0);
      expect(totalNeeded).toBe(3); // 1 + 2
      for (const n of needed) {
        expect(n.teamId).toBe(team._id);
      }
    });
  });

  it("dates the plan with the neutral default (next Sunday at 9 AM, no cadence)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { groupId, leaderId } = await buildBareGroup(t, world.communityId);
    const leaderToken = (await generateTokens(leaderId)).accessToken;

    const before = Date.now();
    const result = await t.mutation(
      api.functions.scheduling.quickStart.quickStartRostering,
      { token: leaderToken, groupId },
    );

    await t.run(async (ctx) => {
      const plan = await ctx.db.get(result.planId!);
      const date = new Date(plan!.eventDate);
      // Mirrors the manual "New event plan" default: next Sunday at 9:00 AM
      // local — a neutral placeholder the leader edits in the editor.
      expect(date.getDay()).toBe(0); // Sunday
      expect(date.getHours()).toBe(9);
      expect(date.getMinutes()).toBe(0);
      // Strictly future, within the next 8 days.
      expect(plan!.eventDate).toBeGreaterThan(before);
      expect(plan!.eventDate).toBeLessThan(before + 8 * 86400000);
    });
  });

  it("is a non-destructive no-op when the group already has rostering data", async () => {
    const { t, world } = await setupSchedulingWorld();
    // `world.groupId` already has a team + role from the fixture.
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const teamsBefore = await t.run((ctx) =>
      ctx.db
        .query("teams")
        .withIndex("by_group", (q) => q.eq("groupId", world.groupId))
        .collect(),
    );
    expect(teamsBefore).toHaveLength(1);

    const result = await t.mutation(
      api.functions.scheduling.quickStart.quickStartRostering,
      { token: leaderToken, groupId: world.groupId },
    );

    expect(result.alreadySetUp).toBe(true);
    expect(result.teamId).toBeNull();
    expect(result.planId).toBeNull();

    // Nothing new was created.
    await t.run(async (ctx) => {
      const teamsAfter = await ctx.db
        .query("teams")
        .withIndex("by_group", (q) => q.eq("groupId", world.groupId))
        .collect();
      expect(teamsAfter).toHaveLength(1);
      const plans = await ctx.db
        .query("eventPlans")
        .withIndex("by_group", (q) => q.eq("groupId", world.groupId))
        .collect();
      expect(plans).toHaveLength(0);
    });
  });

  it("no-ops when the group has a plan but no team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { groupId, leaderId } = await buildBareGroup(t, world.communityId);
    const leaderToken = (await generateTokens(leaderId)).accessToken;

    // Seed an event plan only (no team) directly.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("eventPlans", {
        groupId,
        communityId: world.communityId,
        title: "Pre-existing",
        eventDate: now + 7 * 86400000,
        times: [{ label: "9 AM", startsAt: now + 7 * 86400000 }],
        status: "draft",
        createdAt: now,
        createdById: leaderId,
        updatedAt: now,
      });
    });

    const result = await t.mutation(
      api.functions.scheduling.quickStart.quickStartRostering,
      { token: leaderToken, groupId },
    );
    expect(result.alreadySetUp).toBe(true);

    await t.run(async (ctx) => {
      const teams = await ctx.db
        .query("teams")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      expect(teams).toHaveLength(0);
    });
  });

  it("rejects a plain group member who is not a scheduler", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { groupId, memberId } = await buildBareGroup(t, world.communityId);
    const memberToken = (await generateTokens(memberId)).accessToken;

    await expect(
      t.mutation(api.functions.scheduling.quickStart.quickStartRostering, {
        token: memberToken,
        groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects an authenticated outsider", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { groupId } = await buildBareGroup(t, world.communityId);
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.mutation(api.functions.scheduling.quickStart.quickStartRostering, {
        token: outsiderToken,
        groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
