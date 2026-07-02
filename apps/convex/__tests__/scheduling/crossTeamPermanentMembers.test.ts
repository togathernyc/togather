/**
 * Tests for PERMANENT members of a cross-team channel + the two-section
 * Channel Info membership query (`crossTeamChannels.ts`).
 *
 * A cross-team channel's roster is otherwise entirely auto-synced from event-
 * plan role assignments. A "permanent" member is a `chatChannelMembers` row a
 * leader pinned by hand (`isPermanent === true`); the reconcile engine never
 * removes it. These are keyed by the cross-team `channelId` (which owns no
 * `teams` row).
 *
 *   - `addPermanentMemberToChannel` pins a member (idempotent; converting an
 *     existing synced member just flags it, no duplicate row),
 *   - `removePermanentMemberFromChannel` soft-removes a purely-permanent
 *     member but only unpins one who is also role-synced,
 *   - `reconcileCrossTeamChannel` never soft-removes a permanent row,
 *   - `getCrossTeamChannelMembership` returns the permanent list plus one
 *     "synced by role" card per (user, role), with both-members in both lists.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
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
 * A cross-team world: the base scheduling world (the "worship" team, with a
 * second "Worship Leader" role added), plus a cross-team channel that selects
 * everyone from the worship team. The channel lives in `base.groupId`, which
 * `groupLeaderId` leads — so leader-gated mutations and the member-gated query
 * both authorize for `groupLeaderId`.
 */
interface CrossTeamWorld extends SchedulingWorld {
  worshipRoleId: Id<"teamRoles">;
  crossChannelId: Id<"chatChannels">;
  worshipUserId: Id<"users">;
}

async function setupWorld(): Promise<{
  t: ReturnType<typeof convexTest>;
  world: CrossTeamWorld;
}> {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const base = await buildSchedulingWorld(t);

  const extra = await t.run(
    async (
      ctx,
    ): Promise<{
      worshipRoleId: Id<"teamRoles">;
      worshipUserId: Id<"users">;
    }> => {
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
      const worshipUserId = await ctx.db.insert("users", {
        firstName: "Worshipper",
        lastName: "Test",
        email: "worshipper@example.com",
        isActive: true,
        roles: 1,
        createdAt: ts(),
        updatedAt: ts(),
      });
      return { worshipRoleId, worshipUserId };
    },
  );

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
        selectors: [{ sourceTeamId: base.teamId }],
      },
    }),
  );

  return { t, world: { ...base, ...extra, crossChannelId } };
}

/** Insert a plan + a roleAssignment on the worship team, inside the window. */
async function roster(
  t: ReturnType<typeof convexTest>,
  world: CrossTeamWorld,
  opts: { userId: Id<"users">; roleId: Id<"teamRoles">; dayOffset?: number },
): Promise<Id<"roleAssignments">> {
  const eventDate = Date.now() + (opts.dayOffset ?? 3) * DAY;
  return t.run(async (ctx) => {
    const planId = await ctx.db.insert("eventPlans", {
      groupId: world.groupId,
      communityId: world.communityId,
      title: "Sunday Service",
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
      status: "draft",
      createdById: world.groupLeaderId,
      createdAt: ts(),
      updatedAt: ts(),
    });
    return ctx.db.insert("roleAssignments", {
      planId,
      teamId: world.teamId,
      roleId: opts.roleId,
      userId: opts.userId,
      eventDate,
      status: "unconfirmed",
      assignedById: world.groupLeaderId,
      assignedAt: Date.now(),
    });
  });
}

/** All rows (active + soft-left) for a user on the cross-team channel. */
async function rowsFor(
  t: ReturnType<typeof convexTest>,
  world: CrossTeamWorld,
  userId: Id<"users">,
) {
  const rows = await t.run((ctx) =>
    ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel_user", (q) =>
        q.eq("channelId", world.crossChannelId).eq("userId", userId),
      )
      .collect(),
  );
  return rows;
}

describe("cross-team permanent members — addPermanentMemberToChannel", () => {
  it("inserts an active manual row flagged isPermanent, no syncSource", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    const res = await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.outsiderId,
      },
    );
    expect(res.added).toBe(true);

    const rows = await rowsFor(t, world, world.outsiderId);
    expect(rows.length).toBe(1);
    expect(rows[0].isPermanent).toBe(true);
    expect(rows[0].syncSource).toBeUndefined();
    expect(rows[0].role).toBe("member");
    expect(rows[0].leftAt).toBeUndefined();

    const channel = await t.run((ctx) => ctx.db.get(world.crossChannelId));
    expect(channel?.memberCount).toBe(1);
  });

  it("is idempotent — a second call does not duplicate the row", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.outsiderId,
      },
    );
    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.outsiderId,
      },
    );

    const rows = await rowsFor(t, world, world.outsiderId);
    expect(rows.length).toBe(1);
    expect(rows[0].isPermanent).toBe(true);
  });

  it("flags an existing synced member permanent without duplicating rows", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // Roster the worship user then reconcile so they have a synced row.
    await roster(t, world, {
      userId: world.worshipUserId,
      roleId: world.roleId,
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId: world.crossChannelId },
    );
    let rows = await rowsFor(t, world, world.worshipUserId);
    expect(rows.length).toBe(1);
    expect(rows[0].syncSource).toBe("event_plan");

    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );

    rows = await rowsFor(t, world, world.worshipUserId);
    // Same single row, now BOTH synced and permanent.
    expect(rows.length).toBe(1);
    expect(rows[0].syncSource).toBe("event_plan");
    expect(rows[0].isPermanent).toBe(true);
    expect(rows[0].leftAt).toBeUndefined();
  });

  it("a plain group member (non-leader) is rejected", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.channelMemberId);

    await expect(
      t.mutation(
        api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
        {
          token: accessToken,
          channelId: world.crossChannelId,
          userId: world.outsiderId,
        },
      ),
    ).rejects.toThrow(ConvexError);
  });
});

describe("cross-team permanent members — removePermanentMemberFromChannel", () => {
  it("soft-removes a purely-permanent member", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.outsiderId,
      },
    );
    await t.mutation(
      api.functions.scheduling.crossTeamChannels
        .removePermanentMemberFromChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.outsiderId,
      },
    );

    const rows = await rowsFor(t, world, world.outsiderId);
    expect(rows.length).toBe(1);
    expect(rows[0].leftAt).toBeDefined();
    expect(rows[0].isPermanent).toBe(false);

    const channel = await t.run((ctx) => ctx.db.get(world.crossChannelId));
    expect(channel?.memberCount).toBe(0);
  });

  it("only unpins a member who is also role-synced (row stays active)", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // Synced + then pinned → one row that is BOTH.
    await roster(t, world, {
      userId: world.worshipUserId,
      roleId: world.roleId,
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId: world.crossChannelId },
    );
    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );

    await t.mutation(
      api.functions.scheduling.crossTeamChannels
        .removePermanentMemberFromChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );

    const rows = await rowsFor(t, world, world.worshipUserId);
    expect(rows.length).toBe(1);
    // Still a live synced member — active, just no longer pinned.
    expect(rows[0].leftAt).toBeUndefined();
    expect(rows[0].syncSource).toBe("event_plan");
    expect(rows[0].isPermanent).toBe(false);
  });

  it("soft-removes a synced+pinned member who has dropped off the roster", async () => {
    // Regression: the decision must come from the LIVE roster, not the stale
    // syncSource tag. A pinned member keeps syncSource="event_plan" after the
    // reconcile guard preserves them off-window — removing must still evict.
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    const assignmentId = await roster(t, world, {
      userId: world.worshipUserId,
      roleId: world.roleId,
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId: world.crossChannelId },
    );
    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );

    // Move the event out of the window — they're no longer role-matched.
    await t.run((ctx) =>
      ctx.db.patch(assignmentId, { eventDate: Date.now() - 5 * DAY }),
    );

    await t.mutation(
      api.functions.scheduling.crossTeamChannels
        .removePermanentMemberFromChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );

    const rows = await rowsFor(t, world, world.worshipUserId);
    expect(rows.length).toBe(1);
    expect(rows[0].leftAt).toBeDefined();
    expect(rows[0].isPermanent).toBe(false);
  });

  it("only unpins a purely-permanent member who is now live-rostered", async () => {
    // A purely-permanent member (no syncSource) who is later rostered keeps
    // syncSource=undefined, but is currently role-matched — removing must only
    // unpin, leaving them in via their role.
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // Pin first (purely permanent), then roster + reconcile.
    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );
    await roster(t, world, {
      userId: world.worshipUserId,
      roleId: world.roleId,
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId: world.crossChannelId },
    );
    // Reconcile leaves the existing active row untouched — still no syncSource.
    let rows = await rowsFor(t, world, world.worshipUserId);
    expect(rows[0].syncSource).toBeUndefined();

    await t.mutation(
      api.functions.scheduling.crossTeamChannels
        .removePermanentMemberFromChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );

    rows = await rowsFor(t, world, world.worshipUserId);
    expect(rows.length).toBe(1);
    // Still live-rostered → stays active, just unpinned.
    expect(rows[0].leftAt).toBeUndefined();
    expect(rows[0].isPermanent).toBe(false);
  });

  it("throws when the user is not a permanent member", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    await expect(
      t.mutation(
        api.functions.scheduling.crossTeamChannels
          .removePermanentMemberFromChannel,
        {
          token: accessToken,
          channelId: world.crossChannelId,
          userId: world.outsiderId,
        },
      ),
    ).rejects.toThrow(ConvexError);
  });
});

describe("cross-team permanent members — reconcile interaction", () => {
  it("never soft-removes a permanent row when the user drops off the window", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // Synced + pinned member.
    const assignmentId = await roster(t, world, {
      userId: world.worshipUserId,
      roleId: world.roleId,
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId: world.crossChannelId },
    );
    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );

    // Move the event well into the past — out of the removal window.
    await t.run((ctx) =>
      ctx.db.patch(assignmentId, { eventDate: Date.now() - 5 * DAY }),
    );
    const result = await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId: world.crossChannelId },
    );
    expect(result.removed).toBe(0);

    const rows = await rowsFor(t, world, world.worshipUserId);
    expect(rows.length).toBe(1);
    expect(rows[0].leftAt).toBeUndefined();
    expect(rows[0].isPermanent).toBe(true);
  });
});

describe("cross-team permanent members — getCrossTeamChannelMembership", () => {
  it("returns the permanent list and one synced card per (user, role)", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // worshipUser matches TWO worship roles → two synced cards.
    await roster(t, world, {
      userId: world.worshipUserId,
      roleId: world.roleId,
    });
    await roster(t, world, {
      userId: world.worshipUserId,
      roleId: world.worshipRoleId,
    });
    await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileCrossTeamChannel,
      { channelId: world.crossChannelId },
    );

    // outsider is a purely-permanent member (never rostered).
    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.outsiderId,
      },
    );
    // worshipUser is BOTH synced and pinned.
    await t.mutation(
      api.functions.scheduling.crossTeamChannels.addPermanentMemberToChannel,
      {
        token: accessToken,
        channelId: world.crossChannelId,
        userId: world.worshipUserId,
      },
    );

    const membership = await t.query(
      api.functions.scheduling.crossTeamChannels.getCrossTeamChannelMembership,
      { token: accessToken, channelId: world.crossChannelId },
    );

    // Permanent list: outsider + worshipUser.
    const permIds = membership.permanentMembers.map((m) => m.userId);
    expect(permIds).toContain(world.outsiderId);
    expect(permIds).toContain(world.worshipUserId);
    expect(permIds).not.toContain(world.channelMemberId);

    // Synced list: worshipUser appears twice — once per matched role.
    const worshipSynced = membership.syncedRoleMembers.filter(
      (m) => m.userId === world.worshipUserId,
    );
    expect(worshipSynced.length).toBe(2);
    const roleNames = worshipSynced.map((m) => m.roleName).sort();
    expect(roleNames).toEqual(["Drums", "Worship Leader"]);
    expect(worshipSynced.every((m) => m.teamName === "Worship Team")).toBe(true);

    // A purely-permanent member is NOT in the synced list.
    expect(
      membership.syncedRoleMembers.some((m) => m.userId === world.outsiderId),
    ).toBe(false);

    // The both-member appears in BOTH lists.
    expect(permIds).toContain(world.worshipUserId);
    expect(worshipSynced.length).toBeGreaterThan(0);
  });

  it("rejects a non-member of the channel's home group", async () => {
    const { t, world } = await setupWorld();
    const { accessToken } = await generateTokens(world.outsiderId);

    await expect(
      t.query(
        api.functions.scheduling.crossTeamChannels
          .getCrossTeamChannelMembership,
        { token: accessToken, channelId: world.crossChannelId },
      ),
    ).rejects.toThrow(ConvexError);
  });
});
