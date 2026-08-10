/**
 * Tests for `requireTeamScheduler` auth (ADR-023 / ADR-025).
 *
 * Scheduler permission = team channel admin/moderator OR campus group leader
 * OR community admin. A plain channel member is rejected. All rejections must
 * be `ConvexError` so the client `AuthErrorBoundary` can recover.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import { buildSchedulingWorld } from "./fixtures";

// `respondToAssignment` enqueues a deferred team-channel reconcile via
// `ctx.scheduler.runAfter(0, ...)`; the `afterEach` below drains it so a
// pending scheduled function does not leak into the next test.
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

describe("requireTeamScheduler (via createRole)", () => {
  it("allows a team channel admin", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.channelAdminId);
    const res = await t.mutation(api.functions.scheduling.roles.createRole, {
      token: accessToken,
      teamId: world.teamId,
      name: "Keys",
    });
    expect(res.roleId).toBeDefined();
  });

  it("allows a team channel moderator", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.channelModeratorId);
    const res = await t.mutation(api.functions.scheduling.roles.createRole, {
      token: accessToken,
      teamId: world.teamId,
      name: "Guitar",
    });
    expect(res.roleId).toBeDefined();
  });

  it("allows a campus group leader", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);
    const res = await t.mutation(api.functions.scheduling.roles.createRole, {
      token: accessToken,
      teamId: world.teamId,
      name: "Bass",
    });
    expect(res.roleId).toBeDefined();
  });

  it("allows a community admin", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.communityAdminId);
    const res = await t.mutation(api.functions.scheduling.roles.createRole, {
      token: accessToken,
      teamId: world.teamId,
      name: "Vocals",
    });
    expect(res.roleId).toBeDefined();
  });

  it("rejects a plain channel member with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.channelMemberId);
    await expect(
      t.mutation(api.functions.scheduling.roles.createRole, {
        token: accessToken,
        teamId: world.teamId,
        name: "Sneaky Role",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects an outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.outsiderId);
    await expect(
      t.mutation(api.functions.scheduling.roles.createRole, {
        token: accessToken,
        teamId: world.teamId,
        name: "Outsider Role",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("respondToAssignment ownership check", () => {
  it("rejects responding to someone else's assignment with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday",
        eventDate: Date.now() + 7 * 86400000,
        times: [{ label: "9 AM", startsAt: Date.now() + 7 * 86400000 }],
      },
    );

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

    // The outsider (not the assignee) tries to respond.
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;
    await expect(
      t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
        token: outsiderToken,
        assignmentId,
        status: "confirmed",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("allows the assignee to respond to their own assignment", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { planId } = await t.mutation(
      api.functions.scheduling.events.createEvent,
      {
        token: leaderToken,
        groupId: world.groupId,
        title: "Sunday",
        eventDate: Date.now() + 7 * 86400000,
        times: [{ label: "9 AM", startsAt: Date.now() + 7 * 86400000 }],
      },
    );
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

    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;
    const res = await t.mutation(
      api.functions.scheduling.assignments.respondToAssignment,
      { token: memberToken, assignmentId, status: "confirmed" },
    );
    expect(res.status).toBe("confirmed");
  });
});
