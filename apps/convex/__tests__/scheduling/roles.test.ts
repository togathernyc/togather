/**
 * Tests for team-role read access control (roles.ts).
 *
 * `listRoles` and `suggestStarterRoles` are keyed by a `channelId`; both leak
 * channel-scoped data (role names, the channel name) and so are gated to
 * active members of the channel's campus group and community admins — an
 * authenticated outsider must not be able to enumerate a private team's
 * roles by guessing a channel id.
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

describe("listRoles access control", () => {
  it("returns the channel's roles for a group member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const roles = await t.query(api.functions.scheduling.roles.listRoles, {
      token: memberToken,
      channelId: world.channelId,
    });
    expect(roles).toHaveLength(1);
    expect(roles[0]._id).toBe(world.roleId);
  });

  it("works for a community admin", async () => {
    const { t, world } = await setupSchedulingWorld();
    const adminToken = (await generateTokens(world.communityAdminId))
      .accessToken;

    const roles = await t.query(api.functions.scheduling.roles.listRoles, {
      token: adminToken,
      channelId: world.channelId,
    });
    expect(roles).toHaveLength(1);
  });

  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.roles.listRoles, {
        token: outsiderToken,
        channelId: world.channelId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("suggestStarterRoles access control", () => {
  it("rejects an authenticated outsider with a ConvexError", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.query(api.functions.scheduling.roles.suggestStarterRoles, {
        token: outsiderToken,
        channelId: world.channelId,
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("works for a group member", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId))
      .accessToken;

    const result = await t.query(
      api.functions.scheduling.roles.suggestStarterRoles,
      { token: memberToken, channelId: world.channelId },
    );
    expect(result.channelName).toBe("Worship Team");
  });
});
