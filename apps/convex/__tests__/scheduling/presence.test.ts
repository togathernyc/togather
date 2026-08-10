/**
 * Tests for roster-grid live presence (#477) — `heartbeat`, `listViewers`,
 * `leave`. Covers: heartbeat creates then updates a single row; listViewers
 * excludes the caller and omits stale rows; leave removes the row; auth gating
 * (only roster schedulers); and an invalid gridKey is rejected.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import { buildSchedulingWorld } from "./fixtures";

const GRID_STALE_MS = 30_000;

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  const world = await buildSchedulingWorld(t);
  // gridKey IS the rostering group's id.
  return { t, world, gridKey: world.groupId as string };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("roster presence", () => {
  it("heartbeat creates a row, then updates the same row (idempotent upsert)", async () => {
    const { t, world, gridKey } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await t.mutation(api.functions.scheduling.presence.heartbeat, {
      token: leaderToken,
      gridKey,
    });
    await t.mutation(api.functions.scheduling.presence.heartbeat, {
      token: leaderToken,
      gridKey,
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("rosterPresence")
        .withIndex("by_gridKey", (q) => q.eq("gridKey", gridKey))
        .collect(),
    );
    // Two heartbeats from the same user => exactly one row.
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(world.groupLeaderId);
  });

  it("listViewers excludes the calling user (shows only others)", async () => {
    const { t, world, gridKey } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;

    // Both are present. (communityAdmin passes requireGroupScheduler — the
    // same gate rosterMatrix uses — without being a group member.)
    await t.mutation(api.functions.scheduling.presence.heartbeat, {
      token: leaderToken,
      gridKey,
    });
    await t.mutation(api.functions.scheduling.presence.heartbeat, {
      token: adminToken,
      gridKey,
    });

    // The leader sees only the admin (not themselves).
    const asLeader = await t.query(
      api.functions.scheduling.presence.listViewers,
      { token: leaderToken, gridKey },
    );
    expect(asLeader.map((v) => v.userId)).toEqual([world.communityAdminId]);

    // And the admin sees only the leader.
    const asAdmin = await t.query(
      api.functions.scheduling.presence.listViewers,
      { token: adminToken, gridKey },
    );
    expect(asAdmin.map((v) => v.userId)).toEqual([world.groupLeaderId]);
  });

  it("listViewers omits stale rows past the staleness window", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-06-23T12:00:00Z").getTime();
    vi.setSystemTime(start);

    const { t, world, gridKey } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;

    // Admin heartbeats now; leader will observe later.
    await t.mutation(api.functions.scheduling.presence.heartbeat, {
      token: adminToken,
      gridKey,
    });

    // Within the window: admin is visible to the leader.
    vi.setSystemTime(start + GRID_STALE_MS - 1_000);
    const fresh = await t.query(
      api.functions.scheduling.presence.listViewers,
      { token: leaderToken, gridKey },
    );
    expect(fresh.map((v) => v.userId)).toEqual([world.communityAdminId]);

    // Past the window with no new heartbeat: admin drops out.
    vi.setSystemTime(start + GRID_STALE_MS + 1_000);
    const stale = await t.query(
      api.functions.scheduling.presence.listViewers,
      { token: leaderToken, gridKey },
    );
    expect(stale).toEqual([]);
  });

  it("leave removes the caller's presence row", async () => {
    const { t, world, gridKey } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const adminToken = (await generateTokens(world.communityAdminId)).accessToken;

    await t.mutation(api.functions.scheduling.presence.heartbeat, {
      token: adminToken,
      gridKey,
    });
    // Leader sees admin.
    expect(
      (
        await t.query(api.functions.scheduling.presence.listViewers, {
          token: leaderToken,
          gridKey,
        })
      ).map((v) => v.userId),
    ).toEqual([world.communityAdminId]);

    // Admin leaves.
    await t.mutation(api.functions.scheduling.presence.leave, {
      token: adminToken,
      gridKey,
    });
    expect(
      await t.query(api.functions.scheduling.presence.listViewers, {
        token: leaderToken,
        gridKey,
      }),
    ).toEqual([]);
  });

  it("rejects a non-scheduler caller (plain group member) with ConvexError", async () => {
    const { t, world, gridKey } = await setupSchedulingWorld();
    // channelMember is in the group but not a leader/admin — not a scheduler.
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;

    await expect(
      t.mutation(api.functions.scheduling.presence.heartbeat, {
        token: memberToken,
        gridKey,
      }),
    ).rejects.toThrow(ConvexError);
    await expect(
      t.query(api.functions.scheduling.presence.listViewers, {
        token: memberToken,
        gridKey,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects an invalid gridKey", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await expect(
      t.mutation(api.functions.scheduling.presence.heartbeat, {
        token: leaderToken,
        gridKey: "not-a-real-id",
      }),
    ).rejects.toThrow(ConvexError);
  });
});
