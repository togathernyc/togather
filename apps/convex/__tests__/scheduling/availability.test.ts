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

describe("public availability link (app-optional)", () => {
  it("creates a placeholder for a new phone and records availability", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

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
    expect(publicToken).toBeTruthy();

    // Public read needs no token.
    const pub = await t.query(
      api.functions.scheduling.publicAvailability.getPublicAvailabilityRequest,
      { publicToken },
    );
    expect(pub).not.toBeNull();
    expect(pub?.events).toHaveLength(1);

    // A brand-new guest submits.
    const result = await t.mutation(
      api.functions.scheduling.publicAvailability.submitPublicAvailability,
      {
        publicToken,
        firstName: "Guesty",
        phone: "(202) 555-9999",
        responses: [{ planId, status: "available" }],
      },
    );
    expect(result.matched).toBe(false);
    expect(result.savedCount).toBe(1);

    // A placeholder user keyed by the normalized phone now exists, with a
    // group membership and the availability row — the preconditions the
    // existing phone-OTP claim path relies on.
    await t.run(async (ctx) => {
      const u = await ctx.db
        .query("users")
        .withIndex("by_phone", (q) => q.eq("phone", "+12025559999"))
        .first();
      expect(u).not.toBeNull();
      expect(u?.isPlaceholder).toBe(true);
      expect(u?.phoneVerified).toBe(false);

      const membership = await ctx.db
        .query("groupMembers")
        .withIndex("by_group_user", (q) =>
          q.eq("groupId", world.groupId).eq("userId", u!._id),
        )
        .first();
      expect(membership).not.toBeNull();

      const avail = await ctx.db
        .query("eventAvailability")
        .withIndex("by_plan_user", (q) =>
          q.eq("planId", planId).eq("userId", u!._id),
        )
        .first();
      expect(avail?.status).toBe("available");
    });

    // The guest now shows up in the leader grid.
    const grid = await t.query(
      api.functions.scheduling.availability.availabilityForPlan,
      { token: leaderToken, planId },
    );
    expect(grid?.counts.available).toBe(1);
  });

  it("attributes to an existing real account and reports matched=true", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

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

    // channelMemberId is a real, active user with phone +12025550003.
    const result = await t.mutation(
      api.functions.scheduling.publicAvailability.submitPublicAvailability,
      {
        publicToken,
        firstName: "Memberly",
        phone: "+12025550003",
        responses: [{ planId, status: "unavailable" }],
      },
    );
    expect(result.matched).toBe(true);

    await t.run(async (ctx) => {
      const avail = await ctx.db
        .query("eventAvailability")
        .withIndex("by_plan_user", (q) =>
          q.eq("planId", planId).eq("userId", world.channelMemberId),
        )
        .first();
      expect(avail?.status).toBe("unavailable");
    });
  });

  it("rejects an invalid token and an unparseable phone", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
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

    await expect(
      t.mutation(
        api.functions.scheduling.publicAvailability.submitPublicAvailability,
        {
          publicToken: "nope-not-real",
          firstName: "X",
          phone: "+12025550003",
          responses: [],
        },
      ),
    ).rejects.toThrow(ConvexError);

    await expect(
      t.mutation(
        api.functions.scheduling.publicAvailability.submitPublicAvailability,
        {
          publicToken,
          firstName: "Shorty",
          phone: "123",
          responses: [{ planId, status: "available" }],
        },
      ),
    ).rejects.toThrow(ConvexError);
  });
});
