/**
 * Tests for team managers and team-scoped publishing (ADR-025).
 *
 * The bug these exist to prevent: an `eventPlans` row is a date column shared
 * by every serving team at a campus, and `publishEvent` fanned requests out to
 * every `unconfirmed` assignment on it. So a crew lead sending their own
 * team's requests also texted the entire production roster.
 *
 * Two things fix that, and both are covered here:
 *   1. `teamManagers` — roster authority scoped to one team, held by someone
 *      who is *not* a campus group leader.
 *   2. `publishEvent({ teamIds })` — a fan-out narrowed to chosen teams, with
 *      the 4-day / 1-day reminders inheriting the same narrowing via the
 *      append-only request log.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld, type SchedulingWorld } from "./fixtures";

let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
  vi.restoreAllMocks();
});

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

const DAY = 86400000;

async function makeEvent(
  t: ReturnType<typeof convexTest>,
  world: SchedulingWorld,
  leaderToken: string,
): Promise<Id<"eventPlans">> {
  const eventDate = Date.now() + 7 * DAY;
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token: leaderToken,
      groupId: world.groupId,
      title: "Sunday",
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
    },
  );
  return planId;
}

/**
 * A second serving team in the same group, with one role — the "other team"
 * whose volunteers must never be notified by a scoped publish.
 */
async function makeSecondTeam(
  t: ReturnType<typeof convexTest>,
  world: SchedulingWorld,
  leaderToken: string,
  name = "Production",
): Promise<{ teamId: Id<"teams">; roleId: Id<"teamRoles"> }> {
  const { teamId } = await t.mutation(
    api.functions.scheduling.teams.createServingTeam,
    { token: leaderToken, groupId: world.groupId, name, withChannel: false },
  );
  const { roleId } = await t.mutation(
    api.functions.scheduling.roles.createRole,
    { token: leaderToken, teamId, name: `${name} Lead` },
  );
  return { teamId, roleId };
}

describe("team managers", () => {
  it("a group leader can add and remove a manager", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    let managers = await t.query(
      api.functions.scheduling.teams.listTeamManagers,
      { token: leaderToken, teamId: world.teamId },
    );
    expect(managers.map((m) => m.userId)).toEqual([world.channelMemberId]);

    await t.mutation(api.functions.scheduling.teams.removeTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    managers = await t.query(api.functions.scheduling.teams.listTeamManagers, {
      token: leaderToken,
      teamId: world.teamId,
    });
    expect(managers).toEqual([]);
  });

  it("adding the same manager twice is idempotent", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    for (let i = 0; i < 2; i++) {
      await t.mutation(api.functions.scheduling.teams.addTeamManager, {
        token: leaderToken,
        teamId: world.teamId,
        userId: world.channelMemberId,
      });
    }

    const managers = await t.query(
      api.functions.scheduling.teams.listTeamManagers,
      { token: leaderToken, teamId: world.teamId },
    );
    expect(managers).toHaveLength(1);
  });

  it("rejects a manager who is not in the campus group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await expect(
      t.mutation(api.functions.scheduling.teams.addTeamManager, {
        token: leaderToken,
        teamId: world.teamId,
        userId: world.outsiderId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  // Managing a roster and deciding who else may manage it are different levels
  // of trust — the leader stays the one who delegates.
  it("a team manager cannot appoint another manager", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    await expect(
      t.mutation(api.functions.scheduling.teams.addTeamManager, {
        token: managerToken,
        teamId: world.teamId,
        userId: world.staleGroupMemberId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("createServingTeam seeds the managers it is given", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { teamId } = await t.mutation(
      api.functions.scheduling.teams.createServingTeam,
      {
        token: leaderToken,
        groupId: world.groupId,
        name: "Crew",
        withChannel: false,
        // The outsider is silently skipped rather than failing creation.
        managerUserIds: [world.channelMemberId, world.outsiderId],
      },
    );

    const managers = await t.query(
      api.functions.scheduling.teams.listTeamManagers,
      { token: leaderToken, teamId },
    );
    expect(managers.map((m) => m.userId)).toEqual([world.channelMemberId]);
  });

  // The creator is deliberately NOT auto-added: a leader who creates all seven
  // of a campus's teams would "manage" all seven, defeating the grid's
  // default-to-my-teams scoping for the person it most needs to help.
  it("does not make the creator a manager implicitly", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { teamId } = await t.mutation(
      api.functions.scheduling.teams.createServingTeam,
      {
        token: leaderToken,
        groupId: world.groupId,
        name: "Crew",
        withChannel: false,
      },
    );

    const managers = await t.query(
      api.functions.scheduling.teams.listTeamManagers,
      { token: leaderToken, teamId },
    );
    expect(managers).toEqual([]);
  });
});

describe("team manager permissions", () => {
  it("a manager can assign and unassign on their own team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: managerToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.staleGroupMemberId,
      },
    );
    expect(assignmentId).toBeDefined();

    await t.mutation(api.functions.scheduling.assignments.unassign, {
      token: managerToken,
      assignmentId,
    });
    expect(await t.run((ctx) => ctx.db.get(assignmentId))).toBeNull();
  });

  it("a manager cannot assign on a team they do not manage", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken);
    const other = await makeSecondTeam(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignRole, {
        token: managerToken,
        planId,
        teamId: other.teamId,
        roleId: other.roleId,
        userId: world.staleGroupMemberId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("a plain group member still cannot assign", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken);

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignRole, {
        token: memberToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.staleGroupMemberId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("a manager can edit their team's roles", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    const { roleId } = await t.mutation(
      api.functions.scheduling.roles.createRole,
      { token: managerToken, teamId: world.teamId, name: "Sound" },
    );
    expect(roleId).toBeDefined();
  });

  // The grid is the only surface for assigning and publishing, so a manager
  // who is not a group leader must be able to load it — otherwise the whole
  // feature is unreachable for the people it exists for.
  it("a manager who is not a group leader can load the roster grid", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    // A plain group member cannot.
    await expect(
      t.query(api.functions.scheduling.roster.rosterMatrix, {
        token: managerToken,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    const matrix = await t.query(
      api.functions.scheduling.roster.rosterMatrix,
      { token: managerToken, groupId: world.groupId },
    );
    expect(
      matrix.teams.find((tm) => tm.teamId === world.teamId)?.isManagedByMe,
    ).toBe(true);
  });

  // `groupMembers.remove` only stamps `leftAt`; it doesn't delete manager rows.
  // Authority must lapse anyway, or a removed member keeps publishing.
  it("manager authority lapses when the person leaves the group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    // They leave the campus group — the `teamManagers` row survives.
    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", world.channelMemberId),
        )
        .first();
      if (membership) {
        await ctx.db.patch(membership._id, { leftAt: Date.now() });
      }
    });

    const rowStillThere = await t.run((ctx) =>
      ctx.db
        .query("teamManagers")
        .withIndex("by_team_user", (q) =>
          q.eq("teamId", world.teamId).eq("userId", world.channelMemberId),
        )
        .first(),
    );
    expect(rowStillThere).not.toBeNull();

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignRole, {
        token: managerToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.staleGroupMemberId,
      }),
    ).rejects.toThrow(ConvexError);

    await expect(
      t.action(api.functions.scheduling.assignments.publishEvent, {
        token: managerToken,
        planId,
        teamIds: [world.teamId],
      }),
    ).rejects.toThrow(ConvexError);
  });

  // A manager who can publish their team in bulk must also be able to nudge one
  // of their own volunteers — same team scope for both.
  it("a manager can re-send a request to their own volunteer", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });
    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.staleGroupMemberId,
      },
    );

    const result = await t.action(
      api.functions.scheduling.assignments.resendAssignmentRequest,
      { token: managerToken, assignmentId },
    );
    expect(result.scheduled).toBe(true);
  });

  it("a manager cannot re-send for a team they do not manage", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken);
    const other = await makeSecondTeam(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });
    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        teamId: other.teamId,
        roleId: other.roleId,
        userId: world.staleGroupMemberId,
      },
    );

    await expect(
      t.action(api.functions.scheduling.assignments.resendAssignmentRequest, {
        token: managerToken,
        assignmentId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rosterMatrix reports which teams the caller manages", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    await makeSecondTeam(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.groupLeaderId,
    });

    const matrix = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leaderToken,
      groupId: world.groupId,
    });

    const managed = matrix.teams.filter((tm) => tm.isManagedByMe);
    expect(managed.map((tm) => tm.teamId)).toEqual([world.teamId]);
    // The other team is still visible — managing narrows the default view, it
    // never hides data from a leader.
    expect(matrix.teams.length).toBeGreaterThan(1);
  });
});

describe("team-scoped publishing", () => {
  /**
   * Roster one volunteer on each of two teams, then return the plan and the
   * two assignment ids. This is the exact shape of David's report: one date,
   * two teams, one person publishing.
   */
  async function twoTeamPlan(
    t: ReturnType<typeof convexTest>,
    world: SchedulingWorld,
    leaderToken: string,
  ) {
    const planId = await makeEvent(t, world, leaderToken);
    const other = await makeSecondTeam(t, world, leaderToken);

    const mine = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );
    const theirs = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        teamId: other.teamId,
        roleId: other.roleId,
        userId: world.staleGroupMemberId,
      },
    );

    return {
      planId,
      otherTeamId: other.teamId,
      myAssignmentId: mine.assignmentId,
      theirAssignmentId: theirs.assignmentId,
    };
  }

  it("counts only the selected teams' pending requests", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { planId } = await twoTeamPlan(t, world, leaderToken);

    const scoped = await t.action(
      api.functions.scheduling.assignments.publishEvent,
      { token: leaderToken, planId, teamIds: [world.teamId] },
    );
    expect(scoped.requestCount).toBe(1);
  });

  it("an unscoped publish still notifies every team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { planId } = await twoTeamPlan(t, world, leaderToken);

    const all = await t.action(
      api.functions.scheduling.assignments.publishEvent,
      { token: leaderToken, planId },
    );
    expect(all.requestCount).toBe(2);
  });

  // The heart of the report: publishing one team must not log a request
  // against the other team's volunteer.
  it("logs requests only for the published team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { planId, myAssignmentId } = await twoTeamPlan(
      t,
      world,
      leaderToken,
    );

    // Invoke the fan-out directly with the scope `publishEvent` hands it.
    // Going through the action would enqueue a `scheduler.runAfter` job whose
    // drain timing convex-test doesn't make deterministic, double-sending and
    // muddying the assertion. Mirrors requestHistory.test.ts / reminders.test.ts.
    await t.action(
      internal.functions.scheduling.assignments.sendAssignmentRequests,
      { planId, publisherId: world.groupLeaderId, teamIds: [world.teamId] },
    );

    const log = await t.run((ctx) =>
      ctx.db
        .query("assignmentRequestLog")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .collect(),
    );
    // The other team's volunteer was never asked — that is the whole bug.
    expect([...new Set(log.map((row) => row.assignmentId))]).toEqual([
      myAssignmentId,
    ]);
    expect([...new Set(log.map((row) => row.teamId))]).toEqual([world.teamId]);
  });

  it("a manager can publish their own team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const { planId } = await twoTeamPlan(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    const result = await t.action(
      api.functions.scheduling.assignments.publishEvent,
      { token: managerToken, planId, teamIds: [world.teamId] },
    );
    expect(result.requestCount).toBe(1);
  });

  it("a manager cannot publish a team they do not manage", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const { planId, otherTeamId } = await twoTeamPlan(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    await expect(
      t.action(api.functions.scheduling.assignments.publishEvent, {
        token: managerToken,
        planId,
        teamIds: [otherTeamId],
      }),
    ).rejects.toThrow(ConvexError);
  });

  // Each team in the list is authorized on its own, so a manager can't
  // smuggle a team they don't manage in alongside one they do.
  it("a manager cannot smuggle an unmanaged team into a multi-team publish", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const { planId, otherTeamId } = await twoTeamPlan(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    await expect(
      t.action(api.functions.scheduling.assignments.publishEvent, {
        token: managerToken,
        planId,
        teamIds: [world.teamId, otherTeamId],
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("a manager cannot publish the whole plan by omitting teamIds", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const managerToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const { planId } = await twoTeamPlan(t, world, leaderToken);

    await t.mutation(api.functions.scheduling.teams.addTeamManager, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelMemberId,
    });

    await expect(
      t.action(api.functions.scheduling.assignments.publishEvent, {
        token: managerToken,
        planId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rosterMatrix breaks the pending count out per team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { planId, otherTeamId } = await twoTeamPlan(t, world, leaderToken);

    const matrix = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token: leaderToken,
      groupId: world.groupId,
    });
    const event = matrix.events.find((e) => e._id === planId);

    expect(event?.pendingCount).toBe(2);
    expect(event?.pendingByTeam[world.teamId as string]).toBe(1);
    expect(event?.pendingByTeam[otherTeamId as string]).toBe(1);
  });
});

describe("reminders inherit the publish scope", () => {
  // Without this, the cross-team leak simply reappears on a four-day delay:
  // the plan is `published`, so the 4-day nudge would sweep every unconfirmed
  // assignment on it — including the team that was never asked.
  it("nudges only volunteers who were actually asked", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const planId = await makeEvent(t, world, leaderToken);
    const other = await makeSecondTeam(t, world, leaderToken);
    const mine = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      teamId: other.teamId,
      roleId: other.roleId,
      userId: world.staleGroupMemberId,
    });

    // Publish only the first team — the fan-out is invoked directly so the
    // request log lands deterministically (see the note in the publish suite).
    await t.run(async (ctx) => {
      await ctx.db.patch(planId, {
        status: "published",
        updatedAt: Date.now(),
      });
    });
    await t.action(
      internal.functions.scheduling.assignments.sendAssignmentRequests,
      { planId, publisherId: world.groupLeaderId, teamIds: [world.teamId] },
    );

    const targets = await t.query(
      internal.functions.scheduling.assignments.getAssignmentRequestTargets,
      {
        planId,
        publisherId: world.groupLeaderId,
        onlyAlreadyRequested: true,
      },
    );

    expect(targets?.recipients.map((r) => r.assignmentId)).toEqual([
      mine.assignmentId,
    ]);
  });

  // A plan published before request logging existed has no log rows. Treating
  // that as "nobody was asked" would silently drop its in-flight reminders.
  it("falls back to the whole plan when no request log exists", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const planId = await makeEvent(t, world, leaderToken);
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });
    // Publish by hand, leaving the request log empty (the legacy shape).
    await t.run(async (ctx) => {
      await ctx.db.patch(planId, {
        status: "published",
        updatedAt: Date.now(),
      });
    });

    const targets = await t.query(
      internal.functions.scheduling.assignments.getAssignmentRequestTargets,
      {
        planId,
        publisherId: world.groupLeaderId,
        onlyAlreadyRequested: true,
      },
    );

    expect(targets?.recipients).toHaveLength(1);
  });
});
