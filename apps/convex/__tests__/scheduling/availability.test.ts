/**
 * Tests for member availability (ADR-023 follow-up).
 *
 * Availability is intentional ("I am available to serve this date"), recorded
 * per (plan, user), and never assigns anyone — it is only an input the leader
 * grid surfaces. The absence of a row is "no response", distinct from an
 * explicit "unavailable".
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld } from "./fixtures";

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

const DAY = 86400000;

/** Create a published-or-draft event plan and return its id. */
async function createPlan(
  t: ReturnType<typeof convexTest>,
  token: string,
  groupId: Id<"groups">,
  title: string,
  eventDate: number,
) {
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token,
      groupId,
      title,
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
    },
  );
  return planId as Id<"eventPlans">;
}

describe("setMyAvailability + myUpcomingAvailability", () => {
  it("records, toggles, and clears a member's own availability", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;

    const planId = await createPlan(
      t,
      leaderToken,
      world.groupId,
      "Sunday",
      Date.now() + 7 * DAY,
    );

    // No row yet → myStatus is null.
    let mine = await t.query(
      api.functions.scheduling.availability.myUpcomingAvailability,
      { token: memberToken, groupId: world.groupId },
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].myStatus).toBeNull();

    // Mark available.
    await t.mutation(api.functions.scheduling.availability.setMyAvailability, {
      token: memberToken,
      planId,
      status: "available",
    });
    mine = await t.query(
      api.functions.scheduling.availability.myUpcomingAvailability,
      { token: memberToken, groupId: world.groupId },
    );
    expect(mine[0].myStatus).toBe("available");

    // Switch to unavailable (upsert, not duplicate).
    await t.mutation(api.functions.scheduling.availability.setMyAvailability, {
      token: memberToken,
      planId,
      status: "unavailable",
    });
    mine = await t.query(
      api.functions.scheduling.availability.myUpcomingAvailability,
      { token: memberToken, groupId: world.groupId },
    );
    expect(mine[0].myStatus).toBe("unavailable");

    // Clear → back to no response.
    await t.mutation(api.functions.scheduling.availability.clearMyAvailability, {
      token: memberToken,
      planId,
    });
    mine = await t.query(
      api.functions.scheduling.availability.myUpcomingAvailability,
      { token: memberToken, groupId: world.groupId },
    );
    expect(mine[0].myStatus).toBeNull();
  });

  it("excludes past events by default and orders by date", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;

    await createPlan(t, leaderToken, world.groupId, "Later", Date.now() + 14 * DAY);
    await createPlan(t, leaderToken, world.groupId, "Soon", Date.now() + 3 * DAY);
    // A past plan must be inserted directly — createEvent doesn't reject past
    // dates, but we want to assert the query's cutoff filters it out.
    await t.run(async (ctx) => {
      await ctx.db.insert("eventPlans", {
        groupId: world.groupId,
        communityId: world.communityId,
        title: "Yesterday",
        eventDate: Date.now() - DAY,
        times: [],
        status: "draft",
        createdAt: Date.now(),
        createdById: world.groupLeaderId,
        updatedAt: Date.now(),
      });
    });

    const mine = await t.query(
      api.functions.scheduling.availability.myUpcomingAvailability,
      { token: memberToken, groupId: world.groupId },
    );
    expect(mine.map((e) => e.title)).toEqual(["Soon", "Later"]);
  });

  it("rejects a caller who is not a member of the group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    const planId = await createPlan(
      t,
      leaderToken,
      world.groupId,
      "Sunday",
      Date.now() + 7 * DAY,
    );

    await expect(
      t.mutation(api.functions.scheduling.availability.setMyAvailability, {
        token: outsiderToken,
        planId,
        status: "available",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("availabilityForPlan (leader grid)", () => {
  it("returns every active member with status + counts, available-first", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const modToken = (await generateTokens(world.channelModeratorId)).accessToken;

    const planId = await createPlan(
      t,
      leaderToken,
      world.groupId,
      "Sunday",
      Date.now() + 7 * DAY,
    );

    await t.mutation(api.functions.scheduling.availability.setMyAvailability, {
      token: memberToken,
      planId,
      status: "available",
    });
    await t.mutation(api.functions.scheduling.availability.setMyAvailability, {
      token: modToken,
      planId,
      status: "unavailable",
    });

    const result = await t.query(
      api.functions.scheduling.availability.availabilityForPlan,
      { token: leaderToken, planId },
    );
    expect(result).not.toBeNull();
    if (!result) return;

    // Active group members in the fixture world: leader, channel admin,
    // moderator, member, and the placeholder = 5.
    expect(result.counts.total).toBe(5);
    expect(result.counts.available).toBe(1);
    expect(result.counts.unavailable).toBe(1);
    expect(result.counts.noResponse).toBe(3);

    // Sorted available-first, unavailable last.
    expect(result.members[0].status).toBe("available");
    expect(result.members[result.members.length - 1].status).toBe(
      "unavailable",
    );

    const member = result.members.find((m) => m.userId === world.channelMemberId);
    expect(member?.status).toBe("available");
  });
});

describe("sendAvailabilityRequest + getAvailabilityRequest (chat card)", () => {
  it("a group leader can post a request that snapshots upcoming events", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;

    await createPlan(t, leaderToken, world.groupId, "Soon", Date.now() + 3 * DAY);
    await createPlan(t, leaderToken, world.groupId, "Later", Date.now() + 10 * DAY);

    // The sender must be a scheduler AND able to post in the channel. The
    // group leader isn't in the team channel by default — add them, mirroring
    // a leader who actually participates in the channel they post to.
    await t.run(async (ctx) => {
      await ctx.db.insert("chatChannelMembers", {
        channelId: world.channelId,
        userId: world.groupLeaderId,
        role: "member",
        joinedAt: Date.now(),
        isMuted: false,
      });
    });

    const { requestId } = await t.mutation(
      api.functions.messaging.availabilityRequests.sendAvailabilityRequest,
      {
        token: leaderToken,
        channelId: world.channelId,
        message: "Mark the Sundays you can serve.",
      },
    );

    // The member sees both events with no response yet.
    const hydrated = await t.query(
      api.functions.messaging.availabilityRequests.getAvailabilityRequest,
      { token: memberToken, requestId },
    );
    expect(hydrated).not.toBeNull();
    if (!hydrated) return;
    expect(hydrated.message).toBe("Mark the Sundays you can serve.");
    expect(hydrated.events.map((e) => e.title)).toEqual(["Soon", "Later"]);
    expect(hydrated.events.every((e) => e.myStatus === null)).toBe(true);
  });

  it("rejects a non-scheduler sender", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;

    await createPlan(t, leaderToken, world.groupId, "Soon", Date.now() + 3 * DAY);

    await expect(
      t.mutation(
        api.functions.messaging.availabilityRequests.sendAvailabilityRequest,
        { token: memberToken, channelId: world.channelId },
      ),
    ).rejects.toThrow(ConvexError);
  });
});

describe("availabilityMatrix (leader grid)", () => {
  it("returns events as columns and members as rows with per-cell status", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const modToken = (await generateTokens(world.channelModeratorId)).accessToken;

    const planA = await createPlan(
      t,
      leaderToken,
      world.groupId,
      "Week 1",
      Date.now() + 7 * DAY,
    );
    const planB = await createPlan(
      t,
      leaderToken,
      world.groupId,
      "Week 2",
      Date.now() + 14 * DAY,
    );

    // member: available wk1, unavailable wk2. moderator: available wk1 only.
    await t.mutation(api.functions.scheduling.availability.setMyAvailability, {
      token: memberToken,
      planId: planA,
      status: "available",
    });
    await t.mutation(api.functions.scheduling.availability.setMyAvailability, {
      token: memberToken,
      planId: planB,
      status: "unavailable",
    });
    await t.mutation(api.functions.scheduling.availability.setMyAvailability, {
      token: modToken,
      planId: planA,
      status: "available",
    });

    const matrix = await t.query(
      api.functions.scheduling.availability.availabilityMatrix,
      { token: leaderToken, groupId: world.groupId },
    );

    // Columns in date order.
    expect(matrix.events.map((e) => e.title)).toEqual(["Week 1", "Week 2"]);
    // Per-event tally for wk1: 2 available.
    expect(matrix.eventCounts[planA].available).toBe(2);
    expect(matrix.eventCounts[planB].unavailable).toBe(1);

    // Most-available first → the member (2 responses, 1 available) and the
    // moderator (1 available) lead; everyone else is all no_response.
    const member = matrix.members.find((m) => m.userId === world.channelMemberId);
    expect(member?.cells[planA]).toBe("available");
    expect(member?.cells[planB]).toBe("unavailable");
    expect(member?.availableCount).toBe(1);
    expect(member?.hasResponded).toBe(true);

    // A non-responder has all no_response and counts toward the total only.
    const total = matrix.summary.totalMembers;
    expect(total).toBeGreaterThanOrEqual(5);
    expect(matrix.summary.respondedMembers).toBe(2);
    expect(matrix.members[0].availableCount).toBeGreaterThanOrEqual(
      matrix.members[total - 1].availableCount,
    );
  });

  it("caps columns at 10 upcoming events", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    for (let i = 1; i <= 12; i++) {
      await createPlan(t, leaderToken, world.groupId, `E${i}`, Date.now() + i * DAY);
    }
    const matrix = await t.query(
      api.functions.scheduling.availability.availabilityMatrix,
      { token: leaderToken, groupId: world.groupId },
    );
    expect(matrix.events).toHaveLength(10);

    // A bogus negative limit must not bypass the cap (slice-from-end footgun).
    const clamped = await t.query(
      api.functions.scheduling.availability.availabilityMatrix,
      { token: leaderToken, groupId: world.groupId, limit: -5 },
    );
    expect(clamped.events.length).toBeGreaterThanOrEqual(1);
    expect(clamped.events.length).toBeLessThanOrEqual(10);
  });

  it("rejects a non-scheduler", async () => {
    const { t, world } = await setupSchedulingWorld();
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    await expect(
      t.query(api.functions.scheduling.availability.availabilityMatrix, {
        token: memberToken,
        groupId: world.groupId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("public availability link (app-optional, OTP-verified)", () => {
  it("creates a shareable link and exposes a public read", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    await createPlan(t, leaderToken, world.groupId, "Sunday", Date.now() + 7 * DAY);

    const { publicToken } = await t.mutation(
      api.functions.scheduling.publicAvailability.createAvailabilityLink,
      { token: leaderToken, groupId: world.groupId },
    );
    expect(publicToken).toBeTruthy();

    // Public read needs no token (the page renders before sign-in).
    const pub = await t.query(
      api.functions.scheduling.publicAvailability.getPublicAvailabilityRequest,
      { publicToken },
    );
    expect(pub).not.toBeNull();
    expect(pub?.events).toHaveLength(1);
    expect(pub?.groupName).toBeTruthy();
  });

  it("records availability for a verified user and auto-joins the group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    // `outsiderId` is a real account but NOT a member of the group — stands in
    // for someone who just verified via OTP and is recording availability.
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    const planId = await createPlan(
      t,
      leaderToken,
      world.groupId,
      "Sunday",
      Date.now() + 7 * DAY,
    );
    const { publicToken } = await t.mutation(
      api.functions.scheduling.publicAvailability.createAvailabilityLink,
      { token: leaderToken, groupId: world.groupId },
    );

    const result = await t.mutation(
      api.functions.scheduling.publicAvailability.submitAvailabilityForRequest,
      {
        token: outsiderToken,
        publicToken,
        responses: [{ planId, status: "available" }],
      },
    );
    expect(result.savedCount).toBe(1);

    await t.run(async (ctx) => {
      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", world.outsiderId),
        )
        .first();
      expect(membership).not.toBeNull();

      const avail = await ctx.db
        .query("eventAvailability")
        .withIndex("by_plan_user", (q) =>
          q.eq("planId", planId).eq("userId", world.outsiderId),
        )
        .first();
      expect(avail?.status).toBe("available");
    });

    // Shows up in the leader grid.
    const grid = await t.query(
      api.functions.scheduling.availability.availabilityForPlan,
      { token: leaderToken, planId },
    );
    expect(grid?.counts.available).toBe(1);
  });

  it("reactivates a stale pending/declined membership so the response shows", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    // communityOnlyAId is a real account; give them a *pending* join request to
    // the group — availabilityForPlan would hide them until it's accepted.
    const responderToken = (await generateTokens(world.communityOnlyAId))
      .accessToken;

    const planId = await createPlan(
      t,
      leaderToken,
      world.groupId,
      "Sunday",
      Date.now() + 7 * DAY,
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("groupMembers", {
        groupId: world.groupId,
        userId: world.communityOnlyAId,
        role: "member",
        joinedAt: Date.now(),
        notificationsEnabled: true,
        requestStatus: "pending",
        requestedAt: Date.now(),
      });
    });

    const { publicToken } = await t.mutation(
      api.functions.scheduling.publicAvailability.createAvailabilityLink,
      { token: leaderToken, groupId: world.groupId },
    );
    await t.mutation(
      api.functions.scheduling.publicAvailability.submitAvailabilityForRequest,
      {
        token: responderToken,
        publicToken,
        responses: [{ planId, status: "available" }],
      },
    );

    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", world.communityOnlyAId),
        )
        .first();
      expect(m?.requestStatus).toBe("accepted");
    });

    const grid = await t.query(
      api.functions.scheduling.availability.availabilityForPlan,
      { token: leaderToken, planId },
    );
    const row = grid?.members.find(
      (mm) => mm.userId === world.communityOnlyAId,
    );
    expect(row?.status).toBe("available");
  });

  it("rejects an invalid public token", async () => {
    const { t, world } = await setupSchedulingWorld();
    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;

    await expect(
      t.mutation(
        api.functions.scheduling.publicAvailability.submitAvailabilityForRequest,
        { token: outsiderToken, publicToken: "nope-not-real", responses: [] },
      ),
    ).rejects.toThrow(ConvexError);
  });
});
