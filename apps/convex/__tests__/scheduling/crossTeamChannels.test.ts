/**
 * Tests for cross-team channels (crossTeamChannels.ts + the cross-team paths
 * of teamChannelSync.ts).
 *
 * A cross-team channel's membership is derived from `roleAssignments` across
 * MULTIPLE source serving-team channels, optionally filtered per-selector to a
 * single role. It uses the SAME rotation window (added ~5 days before the
 * event, removed ~1 day after) and `event_plan` syncSource as a serving-team
 * channel. These tests drive `reconcileTeamChannel` directly so the window is
 * exercised deterministically, plus the `reconcileCrossTeamChannelsForSource`
 * fan-out trigger.
 */

import { describe, it, expect, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { generateTokens } from "../../lib/auth";
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
 * "worship" team), plus a second serving-team channel (the "tech" team) with
 * its own role, plus a cross-team channel selecting from both.
 */
interface CrossTeamWorld extends SchedulingWorld {
  /** Second serving-team channel — the "tech" team. */
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

    const techRoleId = await ctx.db.insert("teamRoles", {
      channelId: techChannelId,
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
      channelId: base.channelId,
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
            sourceChannelId: base.channelId,
            ...(worshipSelectorRoleId
              ? { roleId: worshipSelectorRoleId }
              : {}),
          },
          { sourceChannelId: extra.techChannelId },
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

/** Insert a roleAssignments row on a given source channel/role. */
async function insertAssignment(
  t: ReturnType<typeof convexTest>,
  world: CrossTeamWorld,
  opts: {
    planId: Id<"eventPlans">;
    channelId: Id<"chatChannels">;
    roleId: Id<"teamRoles">;
    userId: Id<"users">;
    eventDate: number;
    status?: "unconfirmed" | "confirmed" | "declined";
  },
): Promise<Id<"roleAssignments">> {
  return t.run((ctx) =>
    ctx.db.insert("roleAssignments", {
      planId: opts.planId,
      channelId: opts.channelId,
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
    internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
    { channelId: world.crossChannelId },
  );
}

describe("cross-team channel — membership across multiple source teams", () => {
  it("pulls members from two different source teams' assignments", async () => {
    const { t, world } = await setupCrossTeamWorld();
    const planId = await insertPlan(t, world, 3);

    await insertAssignment(t, world, {
      planId,
      channelId: world.channelId,
      roleId: world.roleId,
      userId: world.worshipUserId,
      eventDate: Date.now() + 3 * DAY,
    });
    await insertAssignment(t, world, {
      planId,
      channelId: world.techChannelId,
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
      channelId: world.channelId,
      roleId: world.roleId,
      userId: world.worshipUserId,
      eventDate: Date.now() + 3 * DAY,
    });
    // Non-matching role on the same source team — excluded.
    await insertAssignment(t, world, {
      planId,
      channelId: world.channelId,
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
      channelId: world.techChannelId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
    });
    await insertAssignment(t, world, {
      planId,
      channelId: world.techChannelId,
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
      channelId: world.techChannelId,
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
      channelId: world.channelId,
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
      channelId: world.techChannelId,
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
  /** Serving-team channel on the second group. */
  teamBId: Id<"chatChannels">;
  /** A role on the second group's team. */
  roleBId: Id<"teamRoles">;
  /** Member of group B, rostered on team B. */
  groupBRosteredId: Id<"users">;
  /** Member of group B, NOT rostered on any team. */
  groupBBystanderId: Id<"users">;
  /** A non-serving channel in the base group — invalid as a selector source. */
  plainChannelId: Id<"chatChannels">;
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

    const teamBId = await ctx.db.insert("chatChannels", {
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

    const roleBId = await ctx.db.insert("teamRoles", {
      channelId: teamBId,
      communityId: base.communityId,
      name: "Worship Leader",
      sortOrder: 0,
      defaultNeeded: 1,
      isArchived: false,
      createdAt: ts(),
      createdById: base.channelAdminId,
    });

    const plainChannelId = await ctx.db.insert("chatChannels", {
      groupId: base.groupId,
      communityId: base.communityId,
      name: "Just A Channel",
      channelType: "custom",
      memberCount: 0,
      isArchived: false,
      createdById: base.channelAdminId,
      createdAt: ts(),
      updatedAt: ts(),
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
      plainChannelId,
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
          { sourceChannelId: base.channelId },
          { sourceChannelId: teamBId, roleId: roleBId },
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
        selectors: [{ sourceChannelId: base.channelId }],
      },
    );

    const channel = await t.run((ctx) => ctx.db.get(channelId));
    expect(channel?.isShared).toBeFalsy();
    expect(channel?.sharedGroups).toBeUndefined();
  });

  it("rejects a source channel that is not a serving team", async () => {
    const { t, base, plainChannelId } = await setupCrossGroupWorld();
    const { accessToken } = await generateTokens(base.groupLeaderId);

    await expect(
      t.mutation(
        api.functions.scheduling.crossTeamChannels.createCrossTeamChannel,
        {
          token: accessToken,
          groupId: base.groupId,
          name: "Bad Source",
          selectors: [{ sourceChannelId: plainChannelId }],
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
        selectors: [{ sourceChannelId: teamBId, roleId: roleBId }],
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
        channelId: teamBId,
        roleId: roleBId,
        userId: groupBRosteredId,
        eventDate,
        status: "unconfirmed",
        assignedById: base.groupLeaderId,
        assignedAt: Date.now(),
      });
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
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
        selectors: [{ sourceChannelId: teamBId, roleId: roleBId }],
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
      channelId: world.techChannelId,
      roleId: world.techRoleId,
      userId: world.techUserId,
      eventDate: Date.now() + 3 * DAY,
    });

    // The fan-out trigger keyed by the SOURCE serving-team channel id should
    // pick up the cross-team channel that selects from it.
    const result = await t.mutation(
      internal.functions.scheduling.teamChannelSync
        .reconcileCrossTeamChannelsForSource,
      { sourceChannelId: world.techChannelId },
    );
    expect(result.processed).toBe(1);
    expect(result.totalAdded).toBe(1);

    expect((await crossMemberIds(t, world)).has(world.techUserId)).toBe(true);
  });

  it("ignores cross-team channels that do not select the given source", async () => {
    const { t, world } = await setupCrossTeamWorld();

    // A serving-team channel id that no cross-team channel selects from.
    const unrelatedChannelId = await t.run((ctx) =>
      ctx.db.insert("chatChannels", {
        groupId: world.groupId,
        communityId: world.communityId,
        name: "Hospitality Team",
        channelType: "custom",
        memberCount: 0,
        isArchived: false,
        isServingTeam: true,
        createdById: world.channelAdminId,
        createdAt: ts(),
        updatedAt: ts(),
      }),
    );

    const result = await t.mutation(
      internal.functions.scheduling.teamChannelSync
        .reconcileCrossTeamChannelsForSource,
      { sourceChannelId: unrelatedChannelId },
    );
    expect(result.processed).toBe(0);
  });
});
