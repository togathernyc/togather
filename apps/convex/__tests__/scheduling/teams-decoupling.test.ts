/**
 * Tests for ADR-025 — teams as a first-class entity.
 *
 * Covers the M2 backfill migration (`migrateChannelsToTeams`) and the
 * first-class `teams` readers (`listTeams`, `getTeam`).
 */

import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api, internal } from "../../_generated/api";
import { buildSchedulingWorld, ts } from "./fixtures";
import type { Id } from "../../_generated/dataModel";

/** Spin up a convex-test handle and seed the scheduling world into it. */
async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

/** Run the backfill migration once with the default batch size. */
async function runMigration(t: Awaited<ReturnType<typeof setupSchedulingWorld>>["t"]) {
  return t.mutation(
    internal.functions.migrations.migrateChannelsToTeams
      .migrateChannelsToTeams,
    {},
  );
}

describe("migrateChannelsToTeams", () => {
  it("creates a team for each serving-team channel and links its roles", async () => {
    const { t, world } = await setupSchedulingWorld();

    const result = await runMigration(t);
    expect(result.teamsCreated).toBe(1);
    expect(result.teamRolesLinked).toBe(1);
    expect(result.done).toBe(true);

    await t.run(async (ctx) => {
      const team = await ctx.db
        .query("teams")
        .withIndex("by_channel", (q) => q.eq("channelId", world.channelId))
        .first();
      expect(team).not.toBeNull();
      expect(team?.name).toBe("Worship Team");
      expect(team?.groupId).toBe(world.groupId);
      expect(team?.communityId).toBe(world.communityId);

      // The fixture's role is now linked to that team.
      const role = await ctx.db.get(world.roleId);
      expect(role?.teamId).toBe(team?._id);
    });
  });

  it("is idempotent — a second run creates and links nothing", async () => {
    const { t } = await setupSchedulingWorld();

    await runMigration(t);
    const second = await runMigration(t);
    expect(second.teamsCreated).toBe(0);
    expect(second.teamRolesLinked).toBe(0);
    expect(second.neededRolesLinked).toBe(0);
    expect(second.roleAssignmentsLinked).toBe(0);
    expect(second.done).toBe(true);
  });

  it("backfills teamId on neededRoles and roleAssignments", async () => {
    const { t, world } = await setupSchedulingWorld();

    const { planId, neededId, assignmentId } = await t.run(async (ctx) => {
      const planId = await ctx.db.insert("eventPlans", {
        groupId: world.groupId,
        communityId: world.communityId,
        title: "Sunday Service",
        eventDate: ts(7),
        times: [{ label: "9:00 AM", startsAt: ts(7) }],
        status: "draft",
        createdAt: ts(),
        createdById: world.groupLeaderId,
        updatedAt: ts(),
      });
      const neededId = await ctx.db.insert("neededRoles", {
        planId,
        channelId: world.channelId,
        roleId: world.roleId,
        count: 2,
      });
      const assignmentId = await ctx.db.insert("roleAssignments", {
        planId,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
        eventDate: ts(7),
        status: "unconfirmed",
        assignedById: world.groupLeaderId,
        assignedAt: ts(),
      });
      return { planId, neededId, assignmentId };
    });

    const result = await runMigration(t);
    expect(result.neededRolesLinked).toBe(1);
    expect(result.roleAssignmentsLinked).toBe(1);

    await t.run(async (ctx) => {
      const team = await ctx.db
        .query("teams")
        .withIndex("by_channel", (q) => q.eq("channelId", world.channelId))
        .first();
      const needed = await ctx.db.get(neededId);
      const assignment = await ctx.db.get(assignmentId);
      expect(needed?.teamId).toBe(team?._id);
      expect(assignment?.teamId).toBe(team?._id);
      // The legacy plan link is untouched.
      expect(needed?.planId).toBe(planId);
    });
  });

  it("maps cross-team selectors from sourceChannelId to sourceTeamId", async () => {
    const { t, world } = await setupSchedulingWorld();

    const crossChannelId = await t.run(async (ctx) =>
      ctx.db.insert("chatChannels", {
        groupId: world.groupId,
        communityId: world.communityId,
        name: "All Worship + Tech",
        channelType: "cross_team",
        memberCount: 0,
        isArchived: false,
        createdById: world.groupLeaderId,
        createdAt: ts(),
        updatedAt: ts(),
        crossTeamSync: {
          selectors: [{ sourceChannelId: world.channelId }],
        },
      }),
    );

    const result = await runMigration(t);
    expect(result.crossTeamChannelsLinked).toBe(1);

    await t.run(async (ctx) => {
      const team = await ctx.db
        .query("teams")
        .withIndex("by_channel", (q) => q.eq("channelId", world.channelId))
        .first();
      const cross = await ctx.db.get(crossChannelId);
      const selector = cross?.crossTeamSync?.selectors[0];
      expect(selector?.sourceTeamId).toBe(team?._id);
      // The legacy field is left in place until migration phase M3.
      expect(selector?.sourceChannelId).toBe(world.channelId);
    });
  });

  it("processes only batchSize rows per call and re-runs until done", async () => {
    const { t, world } = await setupSchedulingWorld();

    // The fixture has 1 role; add a second so batchSize: 1 leaves work behind.
    await t.run(async (ctx) => {
      await ctx.db.insert("teamRoles", {
        channelId: world.channelId,
        communityId: world.communityId,
        name: "Keys",
        sortOrder: 1,
        isArchived: false,
        createdAt: ts(),
        createdById: world.channelAdminId,
      });
    });

    const first = await t.mutation(
      internal.functions.migrations.migrateChannelsToTeams
        .migrateChannelsToTeams,
      { batchSize: 1 },
    );
    expect(first.teamRolesLinked).toBe(1);
    expect(first.done).toBe(false);

    // The second call links the last role. `done` stays conservatively false
    // because the run filled the whole batch — there *might* be more.
    const second = await t.mutation(
      internal.functions.migrations.migrateChannelsToTeams
        .migrateChannelsToTeams,
      { batchSize: 1 },
    );
    expect(second.teamRolesLinked).toBe(1);
    expect(second.done).toBe(false);

    // A final no-op run confirms there is nothing left.
    const third = await t.mutation(
      internal.functions.migrations.migrateChannelsToTeams
        .migrateChannelsToTeams,
      { batchSize: 1 },
    );
    expect(third.teamRolesLinked).toBe(0);
    expect(third.done).toBe(true);
  });
});

describe("listTeams", () => {
  it("returns nothing before the migration has run", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const teams = await t.query(api.functions.scheduling.teams.listTeams, {
      token: memberToken,
      groupId: world.groupId,
    });
    expect(teams).toHaveLength(0);
  });

  it("returns the group's teams once migrated", async () => {
    const { t, world } = await setupSchedulingWorld();
    await runMigration(t);
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const teams = await t.query(api.functions.scheduling.teams.listTeams, {
      token: memberToken,
      groupId: world.groupId,
    });
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe("Worship Team");
    expect(teams[0].hasChannel).toBe(true);
    expect(teams[0].channelId).toBe(world.channelId);
    expect(teams[0].memberCount).toBe(3);
  });

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    await runMigration(t);
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.teams.listTeams, {
        token: outsiderToken,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("getTeam", () => {
  it("returns a team for a group member", async () => {
    const { t, world } = await setupSchedulingWorld();
    await runMigration(t);
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const teamId = await t.run(async (ctx) => {
      const team = await ctx.db
        .query("teams")
        .withIndex("by_channel", (q) => q.eq("channelId", world.channelId))
        .first();
      return team!._id as Id<"teams">;
    });

    const team = await t.query(api.functions.scheduling.teams.getTeam, {
      token: memberToken,
      teamId,
    });
    expect(team._id).toBe(teamId);
    expect(team.name).toBe("Worship Team");
    expect(team.hasChannel).toBe(true);
    expect(team.isArchived).toBe(false);
  });

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    await runMigration(t);
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    const teamId = await t.run(async (ctx) => {
      const team = await ctx.db
        .query("teams")
        .withIndex("by_channel", (q) => q.eq("channelId", world.channelId))
        .first();
      return team!._id as Id<"teams">;
    });

    await expect(
      t.query(api.functions.scheduling.teams.getTeam, {
        token: outsiderToken,
        teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
