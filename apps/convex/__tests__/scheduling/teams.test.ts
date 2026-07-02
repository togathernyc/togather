/**
 * Tests for serving teams as a first-class entity (teams.ts, ADR-025).
 *
 * A serving team is a `teams` row that *optionally* owns a chat channel.
 * These tests cover the team CRUD surface — `createServingTeam`, `listTeams`,
 * `getTeam`, `updateTeam`, `archiveTeam`, `listCommunityTeams` — with the same
 * auth rigor as the rest of the scheduling module: a group member can read,
 * an authenticated outsider is rejected with `ConvexError`, and mutations
 * require a scheduler (group leader / community admin / team admin).
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import { buildSchedulingWorld } from "./fixtures";

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

/** Spin up a convex-test handle and seed the scheduling world into it. */
async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

describe("createServingTeam", () => {
  it("creates a team with a chat channel by default", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { teamId, channelId } = await t.mutation(
      api.functions.scheduling.teams.createServingTeam,
      { token: leaderToken, groupId: world.groupId, name: "Tech Team" },
    );
    expect(teamId).toBeDefined();
    expect(channelId).not.toBeNull();

    await t.run(async (ctx) => {
      const team = await ctx.db.get(teamId);
      expect(team?.name).toBe("Tech Team");
      expect(team?.groupId).toBe(world.groupId);
      expect(team?.channelId).toBe(channelId);

      const channel = await ctx.db.get(channelId!);
      expect(channel?.isServingTeam).toBe(true);
      expect(channel?.name).toBe("Tech Team");
    });
  });

  it("creates a channel-less team when withChannel is false", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { teamId, channelId } = await t.mutation(
      api.functions.scheduling.teams.createServingTeam,
      {
        token: leaderToken,
        groupId: world.groupId,
        name: "Roster Only",
        withChannel: false,
      },
    );
    expect(channelId).toBeNull();

    await t.run(async (ctx) => {
      const team = await ctx.db.get(teamId);
      expect(team?.channelId).toBeUndefined();
    });
  });

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.mutation(api.functions.scheduling.teams.createServingTeam, {
        token: outsiderToken,
        groupId: world.groupId,
        name: "Sneaky Team",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects a plain group member who is not a scheduler", async () => {
    const { t, world } = await setupSchedulingWorld();
    // channelMemberId is a plain group member (not a leader).
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    await expect(
      t.mutation(api.functions.scheduling.teams.createServingTeam, {
        token: memberToken,
        groupId: world.groupId,
        name: "Member Team",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("listTeams", () => {
  it("returns the group's teams for a group member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const teams = await t.query(api.functions.scheduling.teams.listTeams, {
      token: memberToken,
      groupId: world.groupId,
    });
    expect(teams).toHaveLength(1);
    expect(teams[0]._id).toBe(world.teamId);
    expect(teams[0].name).toBe("Worship Team");
    expect(teams[0].hasChannel).toBe(true);
    expect(teams[0].channelId).toBe(world.channelId);
    expect(teams[0].memberCount).toBe(3);
  });

  it("works for a community admin", async () => {
    const { t, world } = await setupSchedulingWorld();
    const adminToken = (await generateTokens(world.communityAdminId))
      .accessToken;

    const teams = await t.query(api.functions.scheduling.teams.listTeams, {
      token: adminToken,
      groupId: world.groupId,
    });
    expect(teams).toHaveLength(1);
  });

  it("excludes archived teams", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await t.mutation(api.functions.scheduling.teams.archiveTeam, {
      token: leaderToken,
      teamId: world.teamId,
    });

    const teams = await t.query(api.functions.scheduling.teams.listTeams, {
      token: leaderToken,
      groupId: world.groupId,
    });
    expect(teams).toHaveLength(0);
  });

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.teams.listTeams, {
        token: outsiderToken,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("getTeam", () => {
  it("returns a team for a group member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const team = await t.query(api.functions.scheduling.teams.getTeam, {
      token: memberToken,
      teamId: world.teamId,
    });
    expect(team._id).toBe(world.teamId);
    expect(team.name).toBe("Worship Team");
    expect(team.hasChannel).toBe(true);
    expect(team.channelId).toBe(world.channelId);
    expect(team.isArchived).toBe(false);
  });

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.teams.getTeam, {
        token: outsiderToken,
        teamId: world.teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("updateTeam", () => {
  it("renames the team and mirrors the name onto its channel", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await t.mutation(api.functions.scheduling.teams.updateTeam, {
      token: leaderToken,
      teamId: world.teamId,
      name: "Renamed Team",
      description: "Now with a description",
    });

    await t.run(async (ctx) => {
      const team = await ctx.db.get(world.teamId);
      expect(team?.name).toBe("Renamed Team");
      expect(team?.description).toBe("Now with a description");

      const channel = await ctx.db.get(world.channelId);
      expect(channel?.name).toBe("Renamed Team");
    });
  });

  it("allows a team channel admin", async () => {
    const { t, world } = await setupSchedulingWorld();
    const adminToken = (await generateTokens(world.channelAdminId)).accessToken;

    const res = await t.mutation(api.functions.scheduling.teams.updateTeam, {
      token: adminToken,
      teamId: world.teamId,
      name: "Admin Renamed",
    });
    expect(res.teamId).toBe(world.teamId);
  });

  it("rejects a plain channel member with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    await expect(
      t.mutation(api.functions.scheduling.teams.updateTeam, {
        token: memberToken,
        teamId: world.teamId,
        name: "Sneaky Rename",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("updateChannel on a serving-team channel", () => {
  it("mirrors the channel rename onto the underlying team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await t.mutation(api.functions.messaging.channels.updateChannel, {
      token: leaderToken,
      channelId: world.channelId,
      name: "  Renamed From Channel  ",
    });

    await t.run(async (ctx) => {
      const channel = await ctx.db.get(world.channelId);
      // Name is trimmed and applied to the channel...
      expect(channel?.name).toBe("Renamed From Channel");

      // ...and mirrored onto the linked team so the two stay in sync.
      const team = await ctx.db.get(world.teamId);
      expect(team?.name).toBe("Renamed From Channel");
    });
  });

  it("rejects an empty / whitespace-only name with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await expect(
      t.mutation(api.functions.messaging.channels.updateChannel, {
        token: leaderToken,
        channelId: world.channelId,
        name: "   ",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("archiveTeam", () => {
  it("archives the team and its channel, purging synced members", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Insert an active auto-synced (event_plan) member directly — this is the
    // kind of row the rotation engine owns and would otherwise strand.
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: world.channelId,
        userId: world.outsiderId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
        syncSource: "event_plan",
      });
    });

    const result = await t.mutation(
      api.functions.scheduling.teams.archiveTeam,
      { token: leaderToken, teamId: world.teamId },
    );
    expect(result.isArchived).toBe(true);
    expect(result.removedSyncedMembers).toBe(1);

    await t.run(async (ctx) => {
      const team = await ctx.db.get(world.teamId);
      expect(team?.isArchived).toBe(true);

      const channel = await ctx.db.get(world.channelId);
      expect(channel?.isArchived).toBe(true);

      // The synced row is now soft-left.
      const synced = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_syncSource", (q) =>
          q.eq("channelId", world.channelId).eq("syncSource", "event_plan"),
        )
        .collect();
      expect(synced).toHaveLength(1);
      expect(synced[0].leftAt).toBeDefined();
    });
  });

  it("leaves non-synced (manual) members untouched when archiving", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // The fixture's channelMemberId already has a non-synced (manual) row.
    const result = await t.mutation(
      api.functions.scheduling.teams.archiveTeam,
      { token: leaderToken, teamId: world.teamId },
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

  it("unarchives when archived is false", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await t.mutation(api.functions.scheduling.teams.archiveTeam, {
      token: leaderToken,
      teamId: world.teamId,
    });
    const result = await t.mutation(
      api.functions.scheduling.teams.archiveTeam,
      { token: leaderToken, teamId: world.teamId, archived: false },
    );
    expect(result.isArchived).toBe(false);

    await t.run(async (ctx) => {
      const team = await ctx.db.get(world.teamId);
      expect(team?.isArchived).toBe(false);
      const channel = await ctx.db.get(world.channelId);
      expect(channel?.isArchived).toBe(false);
    });
  });

  it("rejects a plain channel member with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    await expect(
      t.mutation(api.functions.scheduling.teams.archiveTeam, {
        token: memberToken,
        teamId: world.teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("listCommunityTeams", () => {
  it("returns teams across the community, organized by group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const result = await t.query(
      api.functions.scheduling.teams.listCommunityTeams,
      { token: memberToken, groupId: world.groupId },
    );
    expect(result).toHaveLength(1);
    expect(result[0].group._id).toBe(world.groupId);
    expect(result[0].teams).toHaveLength(1);
    expect(result[0].teams[0]._id).toBe(world.teamId);
    expect(result[0].teams[0].roles).toHaveLength(1);
    expect(result[0].teams[0].roles[0]._id).toBe(world.roleId);
  });

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.teams.listCommunityTeams, {
        token: outsiderToken,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("linkChannel", () => {
  it("creates a chat channel for a previously channel-less team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Spin up a channel-less team and confirm `getTeam` reflects that.
    const { teamId } = await t.mutation(
      api.functions.scheduling.teams.createServingTeam,
      {
        token: leaderToken,
        groupId: world.groupId,
        name: "Hospitality",
        withChannel: false,
      },
    );

    const before = await t.query(api.functions.scheduling.teams.getTeam, {
      token: leaderToken,
      teamId,
    });
    expect(before.hasChannel).toBe(false);
    expect(before.channelId).toBeNull();

    const result = await t.mutation(
      api.functions.scheduling.teams.linkChannel,
      { token: leaderToken, teamId },
    );
    expect(result.channelId).toBeDefined();
    expect(result.addedMembers).toBe(0);

    const after = await t.query(api.functions.scheduling.teams.getTeam, {
      token: leaderToken,
      teamId,
    });
    expect(after.hasChannel).toBe(true);
    expect(after.channelId).toBe(result.channelId);

    await t.run(async (ctx) => {
      const channel = await ctx.db.get(result.channelId);
      expect(channel?.isServingTeam).toBe(true);
      expect(channel?.channelType).toBe("custom");
      expect(channel?.name).toBe("Hospitality");
    });
  });

  it("rejects a team that already has a channel", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await expect(
      t.mutation(api.functions.scheduling.teams.linkChannel, {
        token: leaderToken,
        teamId: world.teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects an archived team", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { teamId } = await t.mutation(
      api.functions.scheduling.teams.createServingTeam,
      {
        token: leaderToken,
        groupId: world.groupId,
        name: "Hospitality",
        withChannel: false,
      },
    );
    await t.mutation(api.functions.scheduling.teams.archiveTeam, {
      token: leaderToken,
      teamId,
    });

    await expect(
      t.mutation(api.functions.scheduling.teams.linkChannel, {
        token: leaderToken,
        teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects a non-scheduler with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const { teamId } = await t.mutation(
      api.functions.scheduling.teams.createServingTeam,
      {
        token: leaderToken,
        groupId: world.groupId,
        name: "Hospitality",
        withChannel: false,
      },
    );

    await expect(
      t.mutation(api.functions.scheduling.teams.linkChannel, {
        token: memberToken,
        teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("unlinkChannel", () => {
  it("detaches the channel, clears isServingTeam, purges auto-synced members, preserves permanent members", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    // Seed one auto-synced member (rotation engine's row) and one permanent
    // member (manual row, no syncSource). Only the synced one should go.
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
    await t.mutation(api.functions.scheduling.teams.addPermanentMember, {
      token: leaderToken,
      teamId: world.teamId,
      userId: world.channelAdminId,
    });

    const result = await t.mutation(
      api.functions.scheduling.teams.unlinkChannel,
      { token: leaderToken, teamId: world.teamId },
    );
    expect(result.formerChannelId).toBe(world.channelId);
    expect(result.removedSyncedMembers).toBe(1);

    // Team is detached and the channel is no longer flagged as a team channel.
    await t.run(async (ctx) => {
      const team = await ctx.db.get(world.teamId);
      expect(team?.channelId).toBeUndefined();
      const channel = await ctx.db.get(world.channelId);
      expect(channel).not.toBeNull();
      expect(channel?.isServingTeam).toBeUndefined();
      // Permanent member untouched.
      const permanent = await ctx.db
        .query("chatChannelMembers")
        .withIndex("by_channel_user", (q) =>
          q
            .eq("channelId", world.channelId)
            .eq("userId", world.channelAdminId),
        )
        .first();
      expect(permanent?.leftAt).toBeUndefined();
      expect(permanent?.syncSource).toBeUndefined();
    });

    // getTeam now reflects the channel-less state.
    const after = await t.query(api.functions.scheduling.teams.getTeam, {
      token: leaderToken,
      teamId: world.teamId,
    });
    expect(after.hasChannel).toBe(false);
    expect(after.channelId).toBeNull();
    expect(after.channelSlug).toBeNull();
  });

  it("rejects a team that has no channel", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { teamId } = await t.mutation(
      api.functions.scheduling.teams.createServingTeam,
      {
        token: leaderToken,
        groupId: world.groupId,
        name: "Hospitality",
        withChannel: false,
      },
    );

    await expect(
      t.mutation(api.functions.scheduling.teams.unlinkChannel, {
        token: leaderToken,
        teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects a non-scheduler with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    await expect(
      t.mutation(api.functions.scheduling.teams.unlinkChannel, {
        token: memberToken,
        teamId: world.teamId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});
