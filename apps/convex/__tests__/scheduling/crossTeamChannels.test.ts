/**
 * Tests for cross-team channels (crossTeamChannels.ts + the cross-team paths
 * of teamChannelSync.ts).
 *
 * A cross-team channel's membership is derived from `roleAssignments` across
 * MULTIPLE source serving teams (ADR-025 — a team is a first-class `teams`
 * row), optionally filtered per-selector to a single role. It uses the SAME
 * rotation window (added ~5 days before the event, removed ~1 day after) and
 * `event_plan` syncSource as a serving-team channel. These tests drive
 * `reconcileCrossTeamChannel` directly so the window is exercised
 * deterministically, plus the `reconcileCrossTeamChannelsForSource` fan-out
 * trigger.
 */

import { describe, it, expect, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { generateTokens } from "../../lib/auth";
import { resolveServingChannelIds } from "../../functions/scheduling/serving";
import { buildSchedulingWorld, ts, type SchedulingWorld } from "./fixtures";

process.env.JWT_SECRET = "test-jwt-secret-for-unit-tests-minimum-32-chars";

let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});

const DAY = 86400000;

/**
 * A cross-team test world: the base scheduling world (one serving team — the
 * "worship" team), plus a second serving team (the "tech" team) with its own
 * channel and role, plus a cross-team channel selecting from both.
 */
interface CrossTeamWorld extends SchedulingWorld {
  /** Second serving team — the "tech" team. */
  techTeamId: Id<"teams">;
  /** The tech team's chat channel. */
  techChannelId: Id<"chatChannels">;
  /** A role on the tech team. */
  techRoleId: Id<"teamRoles">;
  /** A second role on the worship team (world.roleId is the first). */
  worshipRoleId: Id<"teamRoles">;
  /** The cross-team channel under test. */
  crossChannelId: Id<"chatChannels">;
  /** Extra users for assignment scenarios. */
  worshipUserId: Id<"users">;
  techUserId: Id<"users">;
  techUserBId: Id<"users">;
}

async function setupCrossTeamWorld(opts?: {
  /** When set, the worship selector is filtered to this role. */
  worshipRoleFilter?: "first" | "second";
}): Promise<{ t: ReturnType<typeof convexTest>; world: CrossTeamWorld }> {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const base = await buildSchedulingWorld(t);

  const extra = await t.run(async (ctx): Promise<{
    techTeamId: Id<"teams">;
    techChannelId: Id<"chatChannels">;
    techRoleId: Id<"teamRoles">;
    worshipRoleId: Id<"teamRoles">;
    worshipUserId: Id<"users">;
    techUserId: Id<"users">;
    techUserBId: Id<"users">;
  }> => {
    const techChannelId = await ctx.db.insert("chatChannels", {
      groupId: base.groupId,
      communityId: base.communityId,
      name: "Tech Team",
      channelType: "custom",
      memberCount: 0,
      isArchived: false,
      isServingTeam: true,
      createdById: base.channelAdminId,
      createdAt: ts(),
      updatedAt: ts(),
    });

    const techTeamId = await ctx.db.insert("teams", {
      groupId: base.groupId,
      communityId: base.communityId,
      name: "Tech Team",
      channelId: techChannelId,
      isArchived: false,
      createdAt: ts(),
      createdById: base.channelAdminId,
      updatedAt: ts(),
    });

    const techRoleId = await ctx.db.insert("teamRoles", {
      teamId: techTeamId,
      communityId: base.communityId,
      name: "Technical Director",
      sortOrder: 0,
      defaultNeeded: 1,
      isArchived: false,
      createdAt: ts(),
      createdById: base.channelAdminId,
    });

    // A second role on the worship team for the roleId-filter test.
    const worshipRoleId = await ctx.db.insert("teamRoles", {
      teamId: base.teamId,
      communityId: base.communityId,
      name: "Worship Leader",
      sortOrder: 1,
      defaultNeeded: 1,
      isArchived: false,
      createdAt: ts(),
      createdById: base.channelAdminId,
    });

    const mkUser = (firstName: string) =>
      ctx.db.insert("users", {
        firstName,
        lastName: "Test",
        email: `${firstName.toLowerCase()}@example.com`,
        isActive: true,
        roles: 1,
        createdAt: ts(),
        updatedAt: ts(),
      });
    const worshipUserId = await mkUser("Worshipper");
    const techUserId = await mkUser("Techie");
    const techUserBId = await mkUser("Techbee");

    return {
      techTeamId,
      techChannelId,
      techRoleId,
      worshipRoleId,
      worshipUserId,
      techUserId,
      techUserBId,
    };
  });

  // The cross-team channel: worship-team selector (optionally role-filtered)
  // plus a tech-team selector (no role filter).
  const worshipSelectorRoleId =
    opts?.worshipRoleFilter === "first"
      ? base.roleId
      : opts?.worshipRoleFilter === "second"
        ? extra.worshipRoleId
        : undefined;

  const crossChannelId = await t.run((ctx) =>
    ctx.db.insert("chatChannels", {
      groupId: base.groupId,
      communityId: base.communityId,
      name: "Service Leads",
      channelType: "cross_team",
      memberCount: 0,
      isArchived: false,
      createdById: base.channelAdminId,
      createdAt: ts(),
      updatedAt: ts(),
      crossTeamSync: {
        selectors: [
          {
            sourceTeamId: base.teamId,
            ...(worshipSelectorRoleId
              ? { roleId: worshipSelectorRoleId }
              : {}),
          },
          { sourceTeamId: extra.techTeamId },
        ],
      },
    }),
  );

  return { t, world: { ...base, ...extra, crossChannelId } };
}

/** Insert an event plan row directly for a given day offset. */
async function insertPlan(
  t: ReturnType<typeof convexTest>,
  world: CrossTeamWorld,
  dayOffset: number,
): Promise<Id<"eventPlans">> {
  const eventDate = Date.now() + dayOffset * DAY;
  return t.run((ctx) =>
    ctx.db.insert("eventPlans", {
      groupId: world.groupId,
      communityId: world.communityId,
      title: "Sunday Service",
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
      status: "draft",
      createdById: world.groupLeaderId,
      createdAt: ts(),
      updatedAt: ts(),
    }),
  );
}

/** Insert a roleAssignments row on a given source team/role. */
async function insertAssignment(
  t: ReturnType<typeof convexTest>,
  world: CrossTeamWorld,
  opts: {
    planId: Id<"eventPlans">;
    teamId: Id<"teams">;
    roleId: Id<"teamRoles">;
    userId: Id<"users">;
    eventDate: number;
    status?: "unconfirmed" | "confirmed" | "declined";
  },
): Promise<Id<"roleAssignments">> {
  return t.run((ctx) =>
    ctx.db.insert("roleAssignments", {
      planId: opts.planId,
      teamId: opts.teamId,
      roleId: opts.roleId,
      userId: opts.userId,
      eventDate: opts.eventDate,
      status: opts.status ?? "unconfirmed",
      assignedById: world.groupLeaderId,
      assignedAt: Date.now(),
    }),
  );
}

/** Active (non-left) auto-synced member userIds for the cross-team channel. */
async function crossMemberIds(
  t: ReturnType<typeof convexTest>,
  world: CrossTeamWorld,
): Promise<Set<string>> {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_syncSource", (q) =>
        q.eq("channelId", world.crossChannelId).eq("syncSource", "event_plan"),
      )
      .collect(),
  );
  return new Set(
    rows.filter((r) => r.leftAt === undefined).map((r) => r.userId as string),
  );
}

/** Reconcile the cross-team channel directly. */
async function reconcileCross(
  t: ReturnType<typeof convexTest>,
  world: CrossTeamWorld,
) {
  return t.mutation(
    internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
    { channelId: world.crossChannelId },
  );
}

describe("cross-team channel — membership across multiple source teams", () => {
  it("pulls members from two different source teams' assignments", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);

    await insertAssignment(t, world, {
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.worshipUserId,
      eventDate: Date.now() + 3 * DAY,
    });
    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
    });

    const result = await reconcileCross(t, world);
    expect(result.added).toBe(2);

    const members = await crossMemberIds(t, world);
    expect(members.has(world.worshipUserId)).toBe(true);
    expect(members.has(world.techUserId)).toBe(true);
  });

  it("a roleId-filtered selector includes only matching-role assignments", async () => {
    // Worship selector filtered to the FIRST worship role (world.roleId).
    const { t, world } = await setupCrossTeamWorld({
      worshipRoleFilter: "first",
    });
    const planId = await insertPlan(t, world, 3);

    // Matching role — included.
    await insertAssignment(t, world, {
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.worshipUserId,
      eventDate: Date.now() + 3 * DAY,
    });
    // Non-matching role on the same source team — excluded.
    await insertAssignment(t, world, {
      planId,
      teamId: world.teamId,
      roleId: world.worshipRoleId,
      userId: world.outsiderId,
      eventDate: Date.now() + 3 * DAY,
    });

    await reconcileCross(t, world);

    const members = await crossMemberIds(t, world);
    expect(members.has(world.worshipUserId)).toBe(true);
    expect(members.has(world.outsiderId)).toBe(false);
  });

  it("a selector with no roleId includes assignments for any role on that team", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);

    // The tech selector has no roleId filter — both tech-team assignments
    // (here both happen to be the same role) should be included.
    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
    });
    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserBId,
      eventDate: Date.now() + 3 * DAY,
    });

    await reconcileCross(t, world);

    const members = await crossMemberIds(t, world);
    expect(members.has(world.techUserId)).toBe(true);
    expect(members.has(world.techUserBId)).toBe(true);
  });

  it("declined assignments never put a user in the cross-team channel", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);

    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
      status: "declined",
    });

    const result = await reconcileCross(t, world);
    expect(result.added).toBe(0);
    expect((await crossMemberIds(t, world)).has(world.techUserId)).toBe(false);
  });

  it("does not add a user whose event is beyond the rotation window", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 30);

    await insertAssignment(t, world, {
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.worshipUserId,
      eventDate: Date.now() + 30 * DAY,
    });

    await reconcileCross(t, world);
    expect((await crossMemberIds(t, world)).has(world.worshipUserId)).toBe(
      false,
    );
  });

  it("soft-removes a user once the rotation window has passed", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);
    const assignmentId = await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
    });

    await reconcileCross(t, world);
    expect((await crossMemberIds(t, world)).has(world.techUserId)).toBe(true);

    // Move the event well into the past — past the 1-day remove window.
    await t.run((ctx) =>
      ctx.db.patch(assignmentId, { eventDate: Date.now() - 5 * DAY }),
    );

    const result = await reconcileCross(t, world);
    expect(result.removed).toBe(1);
    expect((await crossMemberIds(t, world)).has(world.techUserId)).toBe(false);
  });
});

/**
 * A cross-GROUP test world: the base scheduling world (Brooklyn group + its
 * "worship" serving team), plus a SECOND group in the same community with its
 * own serving team and roster. Used to exercise cross-team channels that draw
 * from teams across more than one group.
 */
interface CrossGroupWorld {
  t: ReturnType<typeof convexTest>;
  base: SchedulingWorld;
  /** Second group in the same community. */
  groupBId: Id<"groups">;
  /** Serving team on the second group. */
  teamBId: Id<"teams">;
  /** A role on the second group's team. */
  roleBId: Id<"teamRoles">;
  /** Member of group B, rostered on team B. */
  groupBRosteredId: Id<"users">;
  /** Member of group B, NOT rostered on any team. */
  groupBBystanderId: Id<"users">;
}

async function setupCrossGroupWorld(): Promise<CrossGroupWorld> {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const base = await buildSchedulingWorld(t);

  const extra = await t.run(async (ctx) => {
    const baseGroup = (await ctx.db.get(base.groupId))!;

    const groupBId = await ctx.db.insert("groups", {
      communityId: base.communityId,
      groupTypeId: baseGroup.groupTypeId,
      name: "Manhattan Campus",
      isArchived: false,
      createdAt: ts(),
      updatedAt: ts(),
    });

    const teamBChannelId = await ctx.db.insert("chatChannels", {
      groupId: groupBId,
      communityId: base.communityId,
      name: "MH Worship Team",
      channelType: "custom",
      memberCount: 0,
      isArchived: false,
      isServingTeam: true,
      createdById: base.channelAdminId,
      createdAt: ts(),
      updatedAt: ts(),
    });

    const teamBId = await ctx.db.insert("teams", {
      groupId: groupBId,
      communityId: base.communityId,
      name: "MH Worship Team",
      channelId: teamBChannelId,
      isArchived: false,
      createdAt: ts(),
      createdById: base.channelAdminId,
      updatedAt: ts(),
    });

    const roleBId = await ctx.db.insert("teamRoles", {
      teamId: teamBId,
      communityId: base.communityId,
      name: "Worship Leader",
      sortOrder: 0,
      defaultNeeded: 1,
      isArchived: false,
      createdAt: ts(),
      createdById: base.channelAdminId,
    });

    const mkGroupBUser = async (firstName: string): Promise<Id<"users">> => {
      const userId = await ctx.db.insert("users", {
        firstName,
        lastName: "Test",
        email: `${firstName.toLowerCase()}@example.com`,
        isActive: true,
        roles: 1,
        createdAt: ts(),
        updatedAt: ts(),
      });
      await ctx.db.insert("groupMembers", {
        groupId: groupBId,
        userId,
        role: "member",
        joinedAt: ts(),
        notificationsEnabled: true,
      });
      return userId;
    };
    const groupBRosteredId = await mkGroupBUser("Rostered");
    const groupBBystanderId = await mkGroupBUser("Bystander");

    return {
      groupBId,
      teamBId,
      roleBId,
      groupBRosteredId,
      groupBBystanderId,
    };
  });

  return { t, base, ...extra };
}

describe("cross-team channel — cross-group sharing", () => {
  it("creating a channel with a foreign source team shares it into that group", async () => {
    const { t, base, groupBId, teamBId, roleBId } =
      await setupCrossGroupWorld();
    const { accessToken } = await generateTokens(base.groupLeaderId);

    const { channelId } = await t.mutation(
      api.functions.scheduling.crossTeamChannels.createCrossTeamChannel,
      {
        token: accessToken,
        groupId: base.groupId,
        name: "Broadcast",
        selectors: [
          { sourceTeamId: base.teamId },
          { sourceTeamId: teamBId, roleId: roleBId },
        ],
      },
    );

    const channel = await t.run((ctx) => ctx.db.get(channelId));
    expect(channel?.isShared).toBe(true);
    expect(channel?.sharedGroups?.map((s) => s.groupId)).toEqual([groupBId]);
    expect(channel?.sharedGroups?.[0].status).toBe("accepted");
  });

  it("a same-group-only channel is not marked as shared", async () => {
    const { t, base } = await setupCrossGroupWorld();
    const { accessToken } = await generateTokens(base.groupLeaderId);

    const { channelId } = await t.mutation(
      api.functions.scheduling.crossTeamChannels.createCrossTeamChannel,
      {
        token: accessToken,
        groupId: base.groupId,
        name: "Local Only",
        selectors: [{ sourceTeamId: base.teamId }],
      },
    );

    const channel = await t.run((ctx) => ctx.db.get(channelId));
    expect(channel?.isShared).toBeFalsy();
    expect(channel?.sharedGroups).toBeUndefined();
  });

  it("rejects a source team that no longer exists", async () => {
    const { t, base } = await setupCrossGroupWorld();
    const { accessToken } = await generateTokens(base.groupLeaderId);

    // A team id that points at a since-deleted team.
    const deletedTeamId = await t.run(async (ctx) => {
      const teamId = await ctx.db.insert("teams", {
        groupId: base.groupId,
        communityId: base.communityId,
        name: "Doomed Team",
        isArchived: false,
        createdAt: ts(),
        createdById: base.channelAdminId,
        updatedAt: ts(),
      });
      await ctx.db.delete(teamId);
      return teamId;
    });

    await expect(
      t.mutation(
        api.functions.scheduling.crossTeamChannels.createCrossTeamChannel,
        {
          token: accessToken,
          groupId: base.groupId,
          name: "Bad Source",
          selectors: [{ sourceTeamId: deletedTeamId }],
        },
      ),
    ).rejects.toThrow();
  });

  it("a cross-group rostered member sees the channel under their own group", async () => {
    const { t, base, groupBId, teamBId, roleBId, groupBRosteredId } =
      await setupCrossGroupWorld();
    const { accessToken } = await generateTokens(base.groupLeaderId);

    const { channelId } = await t.mutation(
      api.functions.scheduling.crossTeamChannels.createCrossTeamChannel,
      {
        token: accessToken,
        groupId: base.groupId,
        name: "Broadcast",
        selectors: [{ sourceTeamId: teamBId, roleId: roleBId }],
      },
    );

    // Roster the group-B user onto team B inside the rotation window.
    const eventDate = Date.now() + 3 * DAY;
    await t.run(async (ctx) => {
      const planId = await ctx.db.insert("eventPlans", {
        groupId: groupBId,
        communityId: base.communityId,
        title: "Sunday Service",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
        status: "draft",
        createdById: base.groupLeaderId,
        createdAt: ts(),
        updatedAt: ts(),
      });
      await ctx.db.insert("roleAssignments", {
        planId,
        teamId: teamBId,
        roleId: roleBId,
        userId: groupBRosteredId,
        eventDate,
        status: "unconfirmed",
        assignedById: base.groupLeaderId,
        assignedAt: Date.now(),
      });
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId },
    );

    const rosteredToken = (await generateTokens(groupBRosteredId)).accessToken;
    const inbox = await t.query(
      api.functions.messaging.channels.getInboxChannels,
      { token: rosteredToken },
    );
    const groupBSection = inbox.find((s) => s.group._id === groupBId);
    expect(
      groupBSection?.channels.some((c) => c._id === channelId),
    ).toBe(true);
  });

  it("a non-rostered member of the shared group does not see the channel", async () => {
    const { t, base, teamBId, roleBId, groupBBystanderId } =
      await setupCrossGroupWorld();
    const { accessToken } = await generateTokens(base.groupLeaderId);

    const { channelId } = await t.mutation(
      api.functions.scheduling.crossTeamChannels.createCrossTeamChannel,
      {
        token: accessToken,
        groupId: base.groupId,
        name: "Broadcast",
        selectors: [{ sourceTeamId: teamBId, roleId: roleBId }],
      },
    );

    const bystanderToken = (await generateTokens(groupBBystanderId)).accessToken;
    const inbox = await t.query(
      api.functions.messaging.channels.getInboxChannels,
      { token: bystanderToken },
    );
    const hasChannel = inbox.some((s) =>
      s.channels.some((c) => c._id === channelId),
    );
    expect(hasChannel).toBe(false);
  });
});

describe("cross-team channel — reconcileCrossTeamChannelsForSource", () => {
  it("reconciles a cross-team channel when a source team's assignment changes", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);

    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
    });

    // The fan-out trigger keyed by the SOURCE serving team id should pick up
    // the cross-team channel that selects from it.
    const result = await t.mutation(
      internal.functions.scheduling.teamChannelSync
        .reconcileCrossTeamChannelsForSource,
      { sourceTeamId: world.techTeamId },
    );
    expect(result.processed).toBe(1);
    expect(result.totalAdded).toBe(1);

    expect((await crossMemberIds(t, world)).has(world.techUserId)).toBe(true);
  });

  it("ignores cross-team channels that do not select the given source", async () => {
    const { t, world } = await setupCrossTeamWorld();

    // A serving team that no cross-team channel selects from.
    const unrelatedTeamId = await t.run((ctx) =>
      ctx.db.insert("teams", {
        groupId: world.groupId,
        communityId: world.communityId,
        name: "Hospitality Team",
        isArchived: false,
        createdAt: ts(),
        createdById: world.channelAdminId,
        updatedAt: ts(),
      }),
    );

    const result = await t.mutation(
      internal.functions.scheduling.teamChannelSync
        .reconcileCrossTeamChannelsForSource,
      { sourceTeamId: unrelatedTeamId },
    );
    expect(result.processed).toBe(0);
  });
});

describe("cross-team channel — serving-mode inbox resolution", () => {
  it("includes a cross-team channel whose selector references a team on the plan", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);
    // An assignment on the tech team ties that team to the plan; the
    // cross-team channel selects from the tech team, so it must resolve into
    // the serving-channel set (the event-mode inbox intersects against this).
    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
    });

    // t.run can't serialize a Set return value, so flatten to an array.
    const ids = await t.run(async (ctx) => [
      ...(await resolveServingChannelIds(ctx, planId)),
    ]);
    expect(ids).toContain(world.crossChannelId);
  });

  it("omits the cross-team channel when no selected team is on the plan", async () => {
    const { t, world } = await setupCrossTeamWorld();
    // Plan with no needed roles or assignments → no teams tied to it.
    const planId = await insertPlan(t, world, 3);

    const ids = await t.run(async (ctx) => [
      ...(await resolveServingChannelIds(ctx, planId)),
    ]);
    expect(ids).not.toContain(world.crossChannelId);
  });

  it("omits an archived cross-team channel even when a team matches", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);
    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
    });
    await t.run((ctx) =>
      ctx.db.patch(world.crossChannelId, { isArchived: true }),
    );

    const ids = await t.run(async (ctx) => [
      ...(await resolveServingChannelIds(ctx, planId)),
    ]);
    expect(ids).not.toContain(world.crossChannelId);
  });
});

/** Does the serving-mode inbox contain the given channel for this user? */
async function servingInboxHasChannel(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  planId: Id<"eventPlans">,
  channelId: Id<"chatChannels">,
): Promise<boolean> {
  const token = (await generateTokens(userId)).accessToken;
  const inbox = await t.query(
    api.functions.messaging.channels.getInboxChannels,
    { token, servingPlanIds: [planId] },
  );
  return inbox.some((s) => s.channels.some((c) => c._id === channelId));
}

/**
 * End-to-end serving-inbox coverage: `getInboxChannels` in serving mode must
 * surface a cross-team group the volunteer belongs to, for BOTH topologies —
 * a same-group channel whose owning group the volunteer isn't a member of, and
 * a cross-GROUP channel that lives in another group entirely. These exercise
 * the two independent backend gaps together: the `cross_team` supplement branch
 * in `getInboxChannels` and the community-wide resolution in
 * `resolveServingChannelIds`.
 */
describe("cross-team channel — serving-mode inbox (getInboxChannels)", () => {
  it("surfaces a same-group cross-team channel to a serving volunteer who is not in the owning group", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);
    // techUserId is rostered on the tech team (tying it to the plan) but is not
    // a groupMembers member of the channel's owning group — membership on the
    // cross-team channel arrives purely via the auto-sync below.
    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
      status: "confirmed",
    });
    await reconcileCross(t, world);

    // Precondition: the volunteer really isn't a member of the owning group, so
    // the channel can only reach the inbox via the cross-team supplement path.
    const groupMembership = await t.run((ctx) =>
      ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", world.techUserId),
        )
        .first(),
    );
    expect(groupMembership).toBeNull();
    expect(
      (await crossMemberIds(t, world)).has(world.techUserId),
    ).toBe(true);

    expect(
      await servingInboxHasChannel(
        t,
        world.techUserId,
        planId,
        world.crossChannelId,
      ),
    ).toBe(true);
  });

  it("does not surface the cross-team channel to a volunteer who is not a synced member", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);
    // techUserId is rostered (so the channel resolves into the plan's serving
    // set), but the outsider has no synced membership row for it.
    await insertAssignment(t, world, {
      planId,
      teamId: world.techTeamId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
      status: "confirmed",
    });
    await reconcileCross(t, world);

    expect(
      await servingInboxHasChannel(
        t,
        world.outsiderId,
        planId,
        world.crossChannelId,
      ),
    ).toBe(false);
  });

  it("surfaces a cross-GROUP cross-team channel (channel lives in another group) in serving mode", async () => {
    const { t, base, groupBId, teamBId, roleBId, groupBRosteredId } =
      await setupCrossGroupWorld();
    const { accessToken } = await generateTokens(base.groupLeaderId);

    // A cross-team channel created in the BASE group but sourcing team B, which
    // lives in group B. It's shared into group B; the plan below is in group B.
    const { channelId } = await t.mutation(
      api.functions.scheduling.crossTeamChannels.createCrossTeamChannel,
      {
        token: accessToken,
        groupId: base.groupId,
        name: "Broadcast",
        selectors: [{ sourceTeamId: teamBId, roleId: roleBId }],
      },
    );

    const eventDate = Date.now() + 3 * DAY;
    const planBId = await t.run(async (ctx) => {
      const planId = await ctx.db.insert("eventPlans", {
        groupId: groupBId,
        communityId: base.communityId,
        title: "Sunday Service",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
        status: "draft",
        createdById: base.groupLeaderId,
        createdAt: ts(),
        updatedAt: ts(),
      });
      await ctx.db.insert("roleAssignments", {
        planId,
        teamId: teamBId,
        roleId: roleBId,
        userId: groupBRosteredId,
        eventDate,
        status: "confirmed",
        assignedById: base.groupLeaderId,
        assignedAt: Date.now(),
      });
      return planId;
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId },
    );

    // The plan is in group B but the channel is owned by the base group — only
    // the community-wide resolution in resolveServingChannelIds lets it into the
    // plan's serving set, so the serving flatten can keep it.
    expect(
      await servingInboxHasChannel(t, groupBRosteredId, planBId, channelId),
    ).toBe(true);
  });
});
