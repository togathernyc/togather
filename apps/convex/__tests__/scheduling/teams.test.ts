/**
 * Tests for serving-team channel listing (teams.ts).
 *
 * `listTeamChannels` is read-only roster info, but a private group's team
 * channel names and member counts should not be enumerable by arbitrary
 * authenticated users — the query is gated to active group members and
 * community admins.
 */

import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import { buildSchedulingWorld } from "./fixtures";

/** Spin up a convex-test handle and seed the scheduling world into it. */
async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

describe("markChannelAsTeam", () => {
  it("soft-removes synced event_plan members when the team flag is disabled", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Insert an active auto-synced (event_plan) member directly — this is the
    // kind of row the rotation engine owns and would otherwise strand.
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: world.channelId,
        userId: world.channelMemberId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
        syncSource: "event_plan",
      });
    });

    const result = await t.mutation(
      api.functions.scheduling.teams.markChannelAsTeam,
      { token: leaderToken, channelId: world.channelId, isTeam: false },
    );
    expect(result.isServingTeam).toBe(false);
    expect(result.removedSyncedMembers).toBe(1);

    // The synced row is now soft-left; the channel is no longer a team.
    await t.run(async (ctx) => {
      const synced = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_syncSource", (q) =>
          q.eq("channelId", world.channelId).eq("syncSource", "event_plan"),
        )
        .collect();
      expect(synced).toHaveLength(1);
      expect(synced[0].leftAt).toBeDefined();

      const channel = await ctx.db.get(world.channelId);
      expect(channel?.isServingTeam).toBe(false);
    });
  });

  it("leaves non-synced members untouched when the team flag is disabled", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // The fixture's channelMemberId already has a non-synced (manual) row.
    const result = await t.mutation(
      api.functions.scheduling.teams.markChannelAsTeam,
      { token: leaderToken, channelId: world.channelId, isTeam: false },
    );
    expect(result.removedSyncedMembers).toBe(0);

    await t.run(async (ctx) => {
      const manual = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q
            .eq("channelId", world.channelId)
            .eq("userId", world.channelMemberId),
        )
        .first();
      expect(manual?.leftAt).toBeUndefined();
    });
  });
});

describe("listTeamChannels", () => {
  it("returns the group's serving-team channels for a group member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const channels = await t.query(
      api.functions.scheduling.teams.listTeamChannels,
      { token: memberToken, groupId: world.groupId },
    );
    expect(channels).toHaveLength(1);
    expect(channels[0]._id).toBe(world.channelId);
    expect(channels[0].name).toBe("Worship Team");
  });

  it("works for a group leader", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const channels = await t.query(
      api.functions.scheduling.teams.listTeamChannels,
      { token: leaderToken, groupId: world.groupId },
    );
    expect(channels).toHaveLength(1);
    expect(channels[0]._id).toBe(world.channelId);
  });

  it("works for a community admin", async () => {
    const { t, world } = await setupSchedulingWorld();
    const adminToken = (await generateTokens(world.communityAdminId))
      .accessToken;

    const channels = await t.query(
      api.functions.scheduling.teams.listTeamChannels,
      { token: adminToken, groupId: world.groupId },
    );
    expect(channels).toHaveLength(1);
  });

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    // The outsider has no group/channel/community membership.
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.teams.listTeamChannels, {
        token: outsiderToken,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
