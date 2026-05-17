/**
 * Tests for the assignment state machine, double-booking detection, and the
 * `previousFillers` quicklink query (ADR-023).
 */

import { describe, it, expect, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld, type SchedulingWorld } from "./fixtures";

/**
 * Most-recently-created test handle. `assignRole` / `unassign` /
 * `respondToAssignment` now enqueue a deferred team-channel reconcile via
 * `ctx.scheduler.runAfter(0, ...)`; the `afterEach` below drains it so a
 * pending scheduled function does not leak into the next test.
 */
let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    await activeHandle.finishInProgressScheduledFunctions();
    activeHandle = null;
  }
});

/** Spin up a convex-test handle and seed the scheduling world into it. */
async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

const DAY = 86400000;

/** Create a draft event for a given day offset and return its planId. */
async function makeEvent(
  t: ReturnType<typeof import("convex-test").convexTest>,
  world: SchedulingWorld,
  leaderToken: string,
  dayOffset: number,
  title = "Event",
): Promise<Id<"eventPlans">> {
  const eventDate = Date.now() + dayOffset * DAY;
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token: leaderToken,
      groupId: world.groupId,
      title,
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
    },
  );
  return planId;
}

describe("assignment state machine", () => {
  it("new assignments start as unconfirmed", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );

    const assignment = await t.run((ctx) => ctx.db.get(assignmentId));
    expect(assignment?.status).toBe("unconfirmed");
    expect(assignment?.respondedAt).toBeUndefined();
  });

  it("unconfirmed -> confirmed stamps respondedAt", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );

    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: memberToken,
      assignmentId,
      status: "confirmed",
    });

    const assignment = await t.run((ctx) => ctx.db.get(assignmentId));
    expect(assignment?.status).toBe("confirmed");
    expect(assignment?.respondedAt).toBeTypeOf("number");
  });

  it("unconfirmed -> declined keeps the row but records the note", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );

    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: memberToken,
      assignmentId,
      status: "declined",
      declineNote: "Out of town",
    });

    const assignment = await t.run((ctx) => ctx.db.get(assignmentId));
    expect(assignment?.status).toBe("declined");
    expect(assignment?.declineNote).toBe("Out of town");
  });

  it("supports reassignment: unassign then assign again", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    const first = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );

    await t.mutation(api.functions.scheduling.assignments.unassign, {
      token: leaderToken,
      assignmentId: first.assignmentId,
    });
    expect(await t.run((ctx) => ctx.db.get(first.assignmentId))).toBeNull();

    // Re-assign a different person to the now-open slot.
    const second = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelModeratorId,
      },
    );
    const reassigned = await t.run((ctx) => ctx.db.get(second.assignmentId));
    expect(reassigned?.userId).toBe(world.channelModeratorId);
    expect(reassigned?.status).toBe("unconfirmed");
  });
});

describe("assignRole channel/role ownership validation", () => {
  it("rejects a roleId that does not belong to the supplied channel", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // A second serving channel in the SAME group, with its own role. The
    // role belongs to `otherChannelId`, not `world.channelId`.
    const { otherChannelId, otherRoleId } = await t.run(async (ctx) => {
      const otherChannelId = await ctx.db.insert("chatChannels", {
        groupId: world.groupId,
        communityId: world.communityId,
        name: "Tech Team",
        channelType: "custom",
        memberCount: 0,
        isArchived: false,
        isServingTeam: true,
        createdById: world.channelAdminId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const otherRoleId = await ctx.db.insert("teamRoles", {
        channelId: otherChannelId,
        communityId: world.communityId,
        name: "Sound",
        sortOrder: 0,
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.channelAdminId,
      });
      return { otherChannelId, otherRoleId };
    });

    // channelId from one team, roleId from another → mismatch.
    await expect(
      t.mutation(api.functions.scheduling.assignments.assignRole, {
        token: leaderToken,
        planId,
        channelId: world.channelId,
        roleId: otherRoleId,
        userId: world.channelMemberId,
      }),
    ).rejects.toThrow(/does not belong to the specified team channel/);

    // Using a fully consistent foreign pair is fine (same group).
    const ok = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        channelId: otherChannelId,
        roleId: otherRoleId,
        userId: world.channelMemberId,
      },
    );
    expect(ok.assignmentId).toBeTruthy();
  });

  it("rejects a channel/role pair belonging to a different group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // A consistent channel+role pair, but owned by an unrelated group B.
    const { foreignChannelId, foreignRoleId } = await t.run(async (ctx) => {
      const groupTypeId = await ctx.db.insert("groupTypes", {
        communityId: world.communityId,
        name: "Campus",
        slug: "campus-b",
        isActive: true,
        createdAt: Date.now(),
        displayOrder: 2,
      });
      const foreignGroupId = await ctx.db.insert("groups", {
        communityId: world.communityId,
        groupTypeId,
        name: "Queens Campus",
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const foreignChannelId = await ctx.db.insert("chatChannels", {
        groupId: foreignGroupId,
        communityId: world.communityId,
        name: "Other Worship Team",
        channelType: "custom",
        memberCount: 0,
        isArchived: false,
        isServingTeam: true,
        createdById: world.channelAdminId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const foreignRoleId = await ctx.db.insert("teamRoles", {
        channelId: foreignChannelId,
        communityId: world.communityId,
        name: "Bass",
        sortOrder: 0,
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.channelAdminId,
      });
      return { foreignChannelId, foreignRoleId };
    });

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignRole, {
        token: leaderToken,
        planId,
        channelId: foreignChannelId,
        roleId: foreignRoleId,
        userId: world.channelMemberId,
      }),
    ).rejects.toThrow(/does not belong to this event's group/);
  });
});

describe("double-booking detection", () => {
  it("flags a user already assigned on the same day", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Two distinct events, same calendar day.
    const eventDate = Date.now() + 7 * DAY;
    const planA = (
      await t.mutation(api.functions.scheduling.events.createEvent, {
        token: leaderToken,
        groupId: world.groupId,
        title: "9 AM Service",
        eventDate,
        times: [{ label: "9 AM", startsAt: eventDate }],
      })
    ).planId;
    const planB = (
      await t.mutation(api.functions.scheduling.events.createEvent, {
        token: leaderToken,
        groupId: world.groupId,
        title: "11 AM Service",
        eventDate,
        times: [{ label: "11 AM", startsAt: eventDate }],
      })
    ).planId;

    const firstAssign = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId: planA,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );
    expect(firstAssign.doubleBooked).toBe(false);

    const secondAssign = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId: planB,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );
    expect(secondAssign.doubleBooked).toBe(true);
  });

  it("flags same calendar day even when eventDate timestamps differ", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Two plans on the same UTC calendar day but at different times of day
    // (9 AM vs 11 AM) → distinct eventDate millisecond values.
    const dayStart =
      Math.floor((Date.now() + 7 * DAY) / DAY) * DAY;
    const morning = dayStart + 9 * 60 * 60 * 1000;
    const midday = dayStart + 11 * 60 * 60 * 1000;

    const planA = (
      await t.mutation(api.functions.scheduling.events.createEvent, {
        token: leaderToken,
        groupId: world.groupId,
        title: "9 AM Service",
        eventDate: morning,
        times: [{ label: "9 AM", startsAt: morning }],
      })
    ).planId;
    const planB = (
      await t.mutation(api.functions.scheduling.events.createEvent, {
        token: leaderToken,
        groupId: world.groupId,
        title: "11 AM Service",
        eventDate: midday,
        times: [{ label: "11 AM", startsAt: midday }],
      })
    ).planId;

    const first = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId: planA,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );
    expect(first.doubleBooked).toBe(false);

    const second = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId: planB,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );
    // Exact-equality would miss this — calendar-day bucketing catches it.
    expect(second.doubleBooked).toBe(true);
  });

  it("does not flag a user assigned on a different day", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planA = await makeEvent(t, world, leaderToken, 7);
    const planB = await makeEvent(t, world, leaderToken, 14);

    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId: planA,
      channelId: world.channelId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });
    const second = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId: planB,
        channelId: world.channelId,
        roleId: world.roleId,
        userId: world.channelMemberId,
      },
    );
    expect(second.doubleBooked).toBe(false);
  });
});

describe("previousFillers", () => {
  it("returns only confirmed fillers, newest event first, de-duplicated", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Three past events on distinct days.
    const planOld = await makeEvent(t, world, leaderToken, -21, "Old");
    const planMid = await makeEvent(t, world, leaderToken, -14, "Mid");
    const planRecent = await makeEvent(t, world, leaderToken, -7, "Recent");

    // memberId confirmed on old + recent; moderatorId confirmed on mid;
    // adminId only ever declined.
    const confirm = async (
      planId: Id<"eventPlans">,
      userId: Id<"users">,
      status: "confirmed" | "declined",
    ) => {
      const { assignmentId } = await t.mutation(
        api.functions.scheduling.assignments.assignRole,
        {
          token: leaderToken,
          planId,
          channelId: world.channelId,
          roleId: world.roleId,
          userId,
        },
      );
      const userToken = (await generateTokens(userId)).accessToken;
      await t.mutation(
        api.functions.scheduling.assignments.respondToAssignment,
        { token: userToken, assignmentId, status },
      );
    };

    await confirm(planOld, world.channelMemberId, "confirmed");
    await confirm(planMid, world.channelModeratorId, "confirmed");
    await confirm(planRecent, world.channelMemberId, "confirmed");
    await confirm(planRecent, world.channelAdminId, "declined");

    const fillers = await t.query(
      api.functions.scheduling.assignments.previousFillers,
      { token: leaderToken, roleId: world.roleId },
    );

    // adminId excluded (declined). memberId + moderatorId only.
    expect(fillers.map((f) => f.userId).sort()).toEqual(
      [world.channelMemberId, world.channelModeratorId].sort(),
    );

    // De-duplicated: memberId appears once.
    expect(
      fillers.filter((f) => f.userId === world.channelMemberId),
    ).toHaveLength(1);

    // Ordered by lastServedDate desc — memberId's recent event is newest.
    expect(fillers[0].userId).toBe(world.channelMemberId);
    for (let i = 1; i < fillers.length; i++) {
      expect(fillers[i - 1].lastServedDate).toBeGreaterThanOrEqual(
        fillers[i].lastServedDate,
      );
    }
  });

  it("excludes unconfirmed assignments", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // Assigned but never responded → unconfirmed.
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      channelId: world.channelId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });

    const fillers = await t.query(
      api.functions.scheduling.assignments.previousFillers,
      { token: leaderToken, roleId: world.roleId },
    );
    expect(fillers).toHaveLength(0);
  });
});
