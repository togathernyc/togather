/**
 * Tests for permanent members of a serving-team channel (ADR-023).
 *
 * A "permanent member" is a `chatChannelMembers` row with no `syncSource`:
 * a leader added them by hand and the rotation engine never removes them.
 *   - `addPermanentMember` inserts a non-synced row,
 *   - `removePermanentMember` soft-removes ONLY the non-synced row,
 *   - `reconcileTeamChannel` leaves permanent members intact,
 *   - auth: group leader passes, a plain channel member is rejected.
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld, type SchedulingWorld } from "./fixtures";

const DAY = 86400000;

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

/** All `chatChannelMembers` rows for the world's channel. */
async function channelRows(
  t: ReturnType<typeof convexTest>,
  world: SchedulingWorld,
) {
  return t.run((ctx) =>
    ctx.db
      .query("chatChannelMembers")
      .withIndex("by_channel", (q) => q.eq("channelId", world.channelId))
      .collect(),
  );
}

describe("permanent members — addPermanentMember", () => {
  it("inserts an active non-synced 'member' row", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    const res = await t.mutation(
      api.functions.scheduling.teams.addPermanentMember,
      { token: accessToken, channelId: world.channelId, userId: world.outsiderId },
    );
    expect(res.added).toBe(true);

    const rows = (await channelRows(t, world)).filter(
      (r) => r.userId === world.outsiderId,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].syncSource).toBeUndefined();
    expect(rows[0].role).toBe("member");
    expect(rows[0].leftAt).toBeUndefined();
  });

  it("keeps memberCount accurate", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    await t.mutation(api.functions.scheduling.teams.addPermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });

    const channel = await t.run((ctx) => ctx.db.get(world.channelId));
    // Fixture seeds 3 manual members; adding one more makes 4.
    expect(channel?.memberCount).toBe(4);
  });

  it("is idempotent — does not duplicate an existing active row", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    await t.mutation(api.functions.scheduling.teams.addPermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });
    const res = await t.mutation(
      api.functions.scheduling.teams.addPermanentMember,
      { token: accessToken, channelId: world.channelId, userId: world.outsiderId },
    );
    expect(res.added).toBe(false);

    const rows = (await channelRows(t, world)).filter(
      (r) => r.userId === world.outsiderId,
    );
    expect(rows.length).toBe(1);
  });

  it("does not duplicate when the user is already a synced member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // Seed an auto-synced row for the outsider.
    await t.run((ctx) =>
      ctx.db.insert("chatChannelMembers", {
        channelId: world.channelId,
        userId: world.outsiderId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
        syncSource: "event_plan",
      }),
    );

    const res = await t.mutation(
      api.functions.scheduling.teams.addPermanentMember,
      { token: accessToken, channelId: world.channelId, userId: world.outsiderId },
    );
    expect(res.added).toBe(false);

    const rows = (await channelRows(t, world)).filter(
      (r) => r.userId === world.outsiderId,
    );
    // Synced row left intact, no permanent duplicate inserted.
    expect(rows.length).toBe(1);
    expect(rows[0].syncSource).toBe("event_plan");
  });
});

describe("permanent members — removePermanentMember", () => {
  it("soft-removes the non-synced row", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    await t.mutation(api.functions.scheduling.teams.addPermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });
    await t.mutation(api.functions.scheduling.teams.removePermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });

    const rows = (await channelRows(t, world)).filter(
      (r) => r.userId === world.outsiderId,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].leftAt).toBeDefined();
  });

  it("never removes a synced (event_plan) row", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // Outsider is ONLY a synced member.
    await t.run((ctx) =>
      ctx.db.insert("chatChannelMembers", {
        channelId: world.channelId,
        userId: world.outsiderId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
        syncSource: "event_plan",
      }),
    );

    await expect(
      t.mutation(api.functions.scheduling.teams.removePermanentMember, {
        token: accessToken,
        channelId: world.channelId,
        userId: world.outsiderId,
      }),
    ).rejects.toThrow(ConvexError);

    const rows = (await channelRows(t, world)).filter(
      (r) => r.userId === world.outsiderId,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].syncSource).toBe("event_plan");
    expect(rows[0].leftAt).toBeUndefined();
  });

  it("removes only the non-synced row when both exist", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // Both a permanent row and (separately) a synced row for the same user.
    await t.mutation(api.functions.scheduling.teams.addPermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });
    await t.run((ctx) =>
      ctx.db.insert("chatChannelMembers", {
        channelId: world.channelId,
        userId: world.outsiderId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
        syncSource: "event_plan",
      }),
    );

    await t.mutation(api.functions.scheduling.teams.removePermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });

    const rows = (await channelRows(t, world)).filter(
      (r) => r.userId === world.outsiderId,
    );
    const synced = rows.find((r) => r.syncSource === "event_plan");
    const manual = rows.find((r) => r.syncSource === undefined);
    expect(synced?.leftAt).toBeUndefined();
    expect(manual?.leftAt).toBeDefined();
  });

  it("keeps memberCount accurate after removal", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    await t.mutation(api.functions.scheduling.teams.addPermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });
    await t.mutation(api.functions.scheduling.teams.removePermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });

    const channel = await t.run((ctx) => ctx.db.get(world.channelId));
    expect(channel?.memberCount).toBe(3);
  });
});

describe("permanent members — listPermanentMembers", () => {
  it("returns active non-synced members only", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    // Add a synced row that must NOT appear in the list.
    await t.run((ctx) =>
      ctx.db.insert("chatChannelMembers", {
        channelId: world.channelId,
        userId: world.outsiderId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
        syncSource: "event_plan",
      }),
    );

    const list = await t.query(
      api.functions.scheduling.teams.listPermanentMembers,
      { token: accessToken, channelId: world.channelId },
    );
    const ids = list.map((m) => m.userId);
    // Fixture seeds 3 manual members; the synced outsider is excluded.
    expect(list.length).toBe(3);
    expect(ids).not.toContain(world.outsiderId);
  });
});

describe("permanent members — reconcile interaction", () => {
  it("reconcileTeamChannel leaves permanent members intact", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.groupLeaderId);

    await t.mutation(api.functions.scheduling.teams.addPermanentMember, {
      token: accessToken,
      channelId: world.channelId,
      userId: world.outsiderId,
    });

    // Run a reconcile with no in-window assignments at all.
    const result = await t.mutation(
      internal.functions.scheduling.teamChannelSync.reconcileTeamChannel,
      { channelId: world.channelId },
    );
    expect(result.removed).toBe(0);

    const rows = (await channelRows(t, world)).filter(
      (r) => r.userId === world.outsiderId,
    );
    expect(rows.length).toBe(1);
    expect(rows[0].leftAt).toBeUndefined();
    expect(rows[0].syncSource).toBeUndefined();
  });
});

describe("permanent members — auth", () => {
  it("a group leader who is not a channel member is allowed", async () => {
    const { t, world } = await setupSchedulingWorld();
    // groupLeaderId is a group leader and NOT in the channel (per fixture).
    const { accessToken } = await generateTokens(world.groupLeaderId);

    const res = await t.mutation(
      api.functions.scheduling.teams.addPermanentMember,
      { token: accessToken, channelId: world.channelId, userId: world.outsiderId },
    );
    expect(res.added).toBe(true);
  });

  it("a plain channel member is rejected with ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const { accessToken } = await generateTokens(world.channelMemberId);

    await expect(
      t.mutation(api.functions.scheduling.teams.addPermanentMember, {
        token: accessToken,
        channelId: world.channelId,
        userId: world.outsiderId,
      }),
    ).rejects.toThrow(ConvexError);

    await expect(
      t.query(api.functions.scheduling.teams.listPermanentMembers, {
        token: accessToken,
        channelId: world.channelId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
