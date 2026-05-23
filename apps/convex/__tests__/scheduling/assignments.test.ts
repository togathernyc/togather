/**
 * Tests for the assignment state machine, double-booking detection, and the
 * `previousFillers` quicklink query (ADR-023).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { ConvexError } from "convex/values";
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

/**
 * Flip a plan to `status: "published"` directly via the DB — bypasses the
 * `publishEvent` action's fan-out side effects so tests of other paths
 * (e.g. immediate-SMS in `inviteAndAssign`) aren't entangled with the
 * publish notification machinery.
 */
async function markPlanPublished(
  t: ReturnType<typeof import("convex-test").convexTest>,
  planId: Id<"eventPlans">,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch(planId, { status: "published", updatedAt: Date.now() });
  });
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
        teamId: world.teamId,
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
        teamId: world.teamId,
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
        teamId: world.teamId,
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
        teamId: world.teamId,
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
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.channelModeratorId,
      },
    );
    const reassigned = await t.run((ctx) => ctx.db.get(second.assignmentId));
    expect(reassigned?.userId).toBe(world.channelModeratorId);
    expect(reassigned?.status).toBe("unconfirmed");
  });
});

describe("assignRole team/role ownership validation", () => {
  it("rejects a roleId that does not belong to the supplied team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // A second serving team in the SAME group, with its own role. The role
    // belongs to `otherTeamId`, not `world.teamId`.
    const { otherTeamId, otherRoleId } = await t.run(async (ctx) => {
      const otherTeamId = await ctx.db.insert("teams", {
        groupId: world.groupId,
        communityId: world.communityId,
        name: "Tech Team",
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.channelAdminId,
        updatedAt: Date.now(),
      });
      const otherRoleId = await ctx.db.insert("teamRoles", {
        teamId: otherTeamId,
        communityId: world.communityId,
        name: "Sound",
        sortOrder: 0,
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.channelAdminId,
      });
      return { otherTeamId, otherRoleId };
    });

    // teamId from one team, roleId from another → mismatch.
    await expect(
      t.mutation(api.functions.scheduling.assignments.assignRole, {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: otherRoleId,
        userId: world.channelMemberId,
      }),
    ).rejects.toThrow(/does not belong to the specified team/);

    // Using a fully consistent foreign pair is fine (same group).
    const ok = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId,
        teamId: otherTeamId,
        roleId: otherRoleId,
        userId: world.channelMemberId,
      },
    );
    expect(ok.assignmentId).toBeTruthy();
  });

  it("rejects a team/role pair belonging to a different group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // A consistent team+role pair, but owned by an unrelated group B.
    const { foreignTeamId, foreignRoleId } = await t.run(async (ctx) => {
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
      const foreignTeamId = await ctx.db.insert("teams", {
        groupId: foreignGroupId,
        communityId: world.communityId,
        name: "Other Worship Team",
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.channelAdminId,
        updatedAt: Date.now(),
      });
      const foreignRoleId = await ctx.db.insert("teamRoles", {
        teamId: foreignTeamId,
        communityId: world.communityId,
        name: "Bass",
        sortOrder: 0,
        isArchived: false,
        createdAt: Date.now(),
        createdById: world.channelAdminId,
      });
      return { foreignTeamId, foreignRoleId };
    });

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignRole, {
        token: leaderToken,
        planId,
        teamId: foreignTeamId,
        roleId: foreignRoleId,
        userId: world.channelMemberId,
      }),
    ).rejects.toThrow(/does not belong to this event's group/);
  });

  it("rejects an assignee who is not a member of the event's group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // `outsiderId` has no group/channel memberships anywhere.
    await expect(
      t.mutation(api.functions.scheduling.assignments.assignRole, {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.outsiderId,
      }),
    ).rejects.toThrow(/not a member of the event's group/);
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
        teamId: world.teamId,
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
        teamId: world.teamId,
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
        teamId: world.teamId,
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
        teamId: world.teamId,
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
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.channelMemberId,
    });
    const second = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      {
        token: leaderToken,
        planId: planB,
        teamId: world.teamId,
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
          teamId: world.teamId,
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

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.assignments.previousFillers, {
        token: outsiderToken,
        roleId: world.roleId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("excludes unconfirmed assignments", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // Assigned but never responded → unconfirmed.
    await t.mutation(api.functions.scheduling.assignments.assignRole, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
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

describe("assignFromCommunity", () => {
  it("auto-adds a community member to the group and creates the assignment", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // Sanity: communityOnlyA is not yet in the group.
    const before = await t.run((ctx) =>
      ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", world.communityOnlyAId),
        )
        .first(),
    );
    expect(before).toBeNull();

    const { assignmentId, addedToGroup } = await t.mutation(
      api.functions.scheduling.assignments.assignFromCommunity,
      {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.communityOnlyAId,
      },
    );
    expect(addedToGroup).toBe(true);

    // Group membership now exists, role:"member", and is active.
    const after = await t.run((ctx) =>
      ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", world.communityOnlyAId),
        )
        .first(),
    );
    expect(after).not.toBeNull();
    expect(after?.role).toBe("member");
    expect(after?.leftAt).toBeUndefined();
    expect(after?.requestStatus === undefined || after?.requestStatus === "accepted").toBe(
      true,
    );

    // The assignment row exists and points at the right user.
    const assignment = await t.run((ctx) => ctx.db.get(assignmentId));
    expect(assignment?.userId).toBe(world.communityOnlyAId);
    expect(assignment?.status).toBe("unconfirmed");
  });

  it("reactivates a leftAt / pending group-member row instead of inserting a duplicate", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // Seed a stale "left" group membership for communityOnlyA.
    const existingMemberId = await t.run(async (ctx) =>
      ctx.db.insert("groupMembers", {
        groupId: world.groupId,
        userId: world.communityOnlyAId,
        role: "member",
        joinedAt: Date.now() - 30 * 86400000,
        leftAt: Date.now() - 86400000,
        notificationsEnabled: true,
      }),
    );

    const { addedToGroup } = await t.mutation(
      api.functions.scheduling.assignments.assignFromCommunity,
      {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.communityOnlyAId,
      },
    );
    expect(addedToGroup).toBe(true);

    // Same row, now reactivated.
    const memberships = await t.run((ctx) =>
      ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", world.communityOnlyAId),
        )
        .collect(),
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]._id).toBe(existingMemberId);
    expect(memberships[0].leftAt).toBeUndefined();
    expect(memberships[0].requestStatus).toBe("accepted");
  });

  it("rejects a user from a different community", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // Insert a user belonging to an unrelated community — the same id will
    // be passed to assignFromCommunity. The scheduler is authorized for
    // their own community/plan, so this validates the cross-community guard.
    const foreignUserId = await t.run(async (ctx) => {
      const otherCommunityId = await ctx.db.insert("communities", {
        name: "Other Community",
        slug: "other",
        isPublic: true,
      });
      const userId = await ctx.db.insert("users", {
        firstName: "Foreign",
        lastName: "User",
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("userCommunities", {
        userId,
        communityId: otherCommunityId,
        roles: 1,
        status: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return userId;
    });

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignFromCommunity, {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: foreignUserId,
      }),
    ).rejects.toThrow(/not a member of the event's community/);
  });

  it("rejects a non-scheduler caller (requirePlanScheduler guard)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // channelMember is in the group but not a leader / community admin —
    // they cannot schedule.
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    await expect(
      t.mutation(api.functions.scheduling.assignments.assignFromCommunity, {
        token: memberToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.communityOnlyAId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects assigning to a role on an archived team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // Archive the team directly.
    await t.run(async (ctx) => {
      await ctx.db.patch(world.teamId, { isArchived: true });
    });

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignFromCommunity, {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.communityOnlyAId,
      }),
    ).rejects.toThrow(/archived team/);
  });

  it("rejects assigning the same user twice (already-assigned guard)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    await t.mutation(api.functions.scheduling.assignments.assignFromCommunity, {
      token: leaderToken,
      planId,
      teamId: world.teamId,
      roleId: world.roleId,
      userId: world.communityOnlyAId,
    });

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignFromCommunity, {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.communityOnlyAId,
      }),
    ).rejects.toThrow(/already assigned/);
  });

  it("permits a placeholder user (isActive: false + isPlaceholder: true)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // The fixture's `placeholderUserId` is `isActive: false, isPlaceholder: true`
    // with active community + group memberships — exactly what a placeholder
    // looks like after `inviteAndAssign` creates it. They must remain
    // schedulable so a leader can put them on multiple roles, just like a
    // real volunteer.
    const result = await t.mutation(
      api.functions.scheduling.assignments.assignFromCommunity,
      {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.placeholderUserId,
      },
    );
    expect(result.addedToGroup).toBe(false); // already an active group member
    const assignment = await t.run((ctx) => ctx.db.get(result.assignmentId));
    expect(assignment?.userId).toBe(world.placeholderUserId);
    expect(assignment?.status).toBe("unconfirmed");
  });

  it("still rejects a deactivated non-placeholder user", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // Deactivate a real community member.
    await t.run(async (ctx) => {
      await ctx.db.patch(world.communityOnlyAId, { isActive: false });
    });

    await expect(
      t.mutation(api.functions.scheduling.assignments.assignFromCommunity, {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        userId: world.communityOnlyAId,
      }),
    ).rejects.toThrow(/deactivated/);
  });
});

describe("inviteAndAssign", () => {
  /**
   * `sendSMS` is wired through `ctx.runAction(internal...sendSMS, ...)`.
   * Without Twilio creds (default test env), `sendSMS` returns
   * `{ success: false }` → `sentInvite: false`. To exercise the happy
   * `sentInvite: true` path we set `OTP_TEST_PHONE_NUMBERS` so the invitee
   * phone is treated as a test phone and `sendSMS` short-circuits to
   * `{ success: true }` without hitting Twilio.
   */

  it("creates a placeholder user, memberships, and assignment; sentInvite reflects SMS outcome", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);
    // Immediate-SMS path only fires when the plan is already published —
    // draft plans defer the invite until `publishEvent`'s fan-out runs.
    await markPlanPublished(t, planId);

    const inviteePhone = "2025550100";
    vi.stubEnv("OTP_TEST_PHONE_NUMBERS", inviteePhone);

    let result: {
      assignmentId: Id<"roleAssignments">;
      invitedUserId: Id<"users">;
      sentInvite: boolean;
      deferred: boolean;
    };
    try {
      result = await t.action(
        api.functions.scheduling.assignments.inviteAndAssign,
        {
          token: leaderToken,
          planId,
          teamId: world.teamId,
          roleId: world.roleId,
          firstName: "Nora",
          phone: inviteePhone,
        },
      );
    } finally {
      vi.unstubAllEnvs();
    }

    expect(result.sentInvite).toBe(true);
    expect(result.deferred).toBe(false);

    // The placeholder user row was created with isPlaceholder/isActive
    // flags and the normalized phone.
    const newUser = await t.run((ctx) => ctx.db.get(result.invitedUserId));
    expect(newUser?.firstName).toBe("Nora");
    expect(newUser?.isPlaceholder).toBe(true);
    expect(newUser?.isActive).toBe(false);
    expect(newUser?.phone).toBe("+12025550100");

    // userCommunities (active) for the invitee.
    const comMembership = await t.run((ctx) =>
      ctx.db
        .query("userCommunities")
        .withIndex("by_user_community", (q) =>
          q
            .eq("userId", result.invitedUserId)
            .eq("communityId", world.communityId),
        )
        .first(),
    );
    expect(comMembership?.status).toBe(1);

    // groupMembers (active) for the invitee.
    const groupMembership = await t.run((ctx) =>
      ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", result.invitedUserId),
        )
        .first(),
    );
    expect(groupMembership?.role).toBe("member");
    expect(groupMembership?.leftAt).toBeUndefined();

    // roleAssignments points at the new user.
    const assignment = await t.run((ctx) => ctx.db.get(result.assignmentId));
    expect(assignment?.userId).toBe(result.invitedUserId);
    expect(assignment?.status).toBe("unconfirmed");

    await t.finishInProgressScheduledFunctions();
  });

  it("returns sentInvite: false when SMS isn't configured but still lands the DB writes", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);
    await markPlanPublished(t, planId);

    // No OTP_TEST_PHONE_NUMBERS, no Twilio creds → sendSMS returns
    // { success: false } and inviteAndAssign reports it accordingly.
    const result = await t.action(
      api.functions.scheduling.assignments.inviteAndAssign,
      {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        firstName: "Mara",
        phone: "2025550101",
      },
    );

    expect(result.sentInvite).toBe(false);
    expect(result.deferred).toBe(false);

    // The DB writes still happened — the leader still gets the role filled.
    const user = await t.run((ctx) => ctx.db.get(result.invitedUserId));
    expect(user?.isPlaceholder).toBe(true);
    const assignment = await t.run((ctx) => ctx.db.get(result.assignmentId));
    expect(assignment?.userId).toBe(result.invitedUserId);

    await t.finishInProgressScheduledFunctions();
  });

  it("defers the SMS when the plan is still a draft, but still lands the DB writes", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    // Default plan status is "draft" — no `markPlanPublished` here.
    const planId = await makeEvent(t, world, leaderToken, 7);

    // Even with a test phone configured, the SMS path is skipped because
    // the plan isn't published yet — `publishEvent`'s fan-out will send
    // the placeholder-specific invite at publish time instead.
    const inviteePhone = "2025550102";
    vi.stubEnv("OTP_TEST_PHONE_NUMBERS", inviteePhone);

    let result: {
      assignmentId: Id<"roleAssignments">;
      invitedUserId: Id<"users">;
      sentInvite: boolean;
      deferred: boolean;
    };
    try {
      result = await t.action(
        api.functions.scheduling.assignments.inviteAndAssign,
        {
          token: leaderToken,
          planId,
          teamId: world.teamId,
          roleId: world.roleId,
          firstName: "Della",
          phone: inviteePhone,
        },
      );
    } finally {
      vi.unstubAllEnvs();
    }

    expect(result.deferred).toBe(true);
    expect(result.sentInvite).toBe(false);

    // The placeholder, memberships, and assignment all landed.
    const user = await t.run((ctx) => ctx.db.get(result.invitedUserId));
    expect(user?.isPlaceholder).toBe(true);
    expect(user?.firstName).toBe("Della");
    const assignment = await t.run((ctx) => ctx.db.get(result.assignmentId));
    expect(assignment?.userId).toBe(result.invitedUserId);
    expect(assignment?.status).toBe("unconfirmed");

    await t.finishInProgressScheduledFunctions();
  });

  it("rejects when a non-placeholder user already owns the phone", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    // The fixture channelAdmin has phone +12025550001 — a real user already
    // owns it, so inviteAndAssign should refuse to create a duplicate.
    await expect(
      t.action(api.functions.scheduling.assignments.inviteAndAssign, {
        token: leaderToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        firstName: "Dup",
        phone: "+12025550001",
      }),
    ).rejects.toThrow(/already in Togather/);
  });

  it("rejects an unauthorized caller with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await makeEvent(t, world, leaderToken, 7);

    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    await expect(
      t.action(api.functions.scheduling.assignments.inviteAndAssign, {
        token: memberToken,
        planId,
        teamId: world.teamId,
        roleId: world.roleId,
        firstName: "Nope",
        phone: "2025550199",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
