/**
 * Duplicate-plan-date guard.
 *
 * A group used to be able to accumulate any number of indistinguishable plans
 * on one date — the roster grid's "Add date" and the quick-start both default
 * to a DETERMINISTIC "next Sunday 9 AM", so a second tap produced a byte-
 * identical second plan. That is how a leader ended up authoring tasks on one
 * Aug 2 plan while being rostered on a different Aug 2 plan.
 *
 * The guard is a typed `DUPLICATE_PLAN_DATE` ConvexError, not silent
 * idempotency: two services on one Sunday (9 AM + 11 AM) is normal, so the
 * deliberate case must stay reachable via `allowSameDay: true`.
 *
 * "Same day" is the COMMUNITY-LOCAL day, not a UTC bucket — the boundary cases
 * below are the whole reason `lib/localDay.ts` exists.
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

/**
 * Fixed instants around Sunday 2 Aug 2026 in America/New_York (EDT, UTC-4) —
 * the fixture community's default zone. Chosen so the UTC-bucket answer and
 * the local-day answer DISAGREE in both directions:
 *
 *   SUN_9AM   13:00Z Sun 2 Aug — Sun 2 Aug ET
 *   SUN_11AM  15:00Z Sun 2 Aug — Sun 2 Aug ET  (same local day, same UTC day)
 *   SAT_11PM  03:00Z Sun 2 Aug — Sat 1 Aug ET  (same UTC day, DIFFERENT local day)
 *   SUN_9PM   01:00Z Mon 3 Aug — Sun 2 Aug ET  (DIFFERENT UTC day, same local day)
 */
const SUN_9AM = Date.UTC(2026, 7, 2, 13, 0);
const SUN_11AM = Date.UTC(2026, 7, 2, 15, 0);
const SAT_11PM = Date.UTC(2026, 7, 2, 3, 0);
const SUN_9PM = Date.UTC(2026, 7, 3, 1, 0);

/**
 * Assert a thrown value is the typed duplicate-date error, and return its data.
 *
 * `convex-test` hands `ConvexError.data` back as the JSON string it wired over,
 * where a real client would have already deserialized it into the object — so
 * parse when we're given a string.
 */
function expectDuplicateError(e: unknown): Record<string, unknown> {
  expect(e).toBeInstanceOf(ConvexError);
  const raw = (e as ConvexError<Record<string, unknown> | string>).data;
  const data = (
    typeof raw === "string" ? JSON.parse(raw) : raw
  ) as Record<string, unknown>;
  expect(data.code).toBe("DUPLICATE_PLAN_DATE");
  return data;
}

async function createPlan(
  t: ReturnType<typeof convexTest>,
  token: string,
  groupId: Id<"groups">,
  title: string,
  eventDate: number,
  allowSameDay?: boolean,
) {
  return t.mutation(api.functions.scheduling.events.createEvent, {
    token,
    groupId,
    title,
    eventDate,
    times: [{ label: "9 AM", startsAt: eventDate }],
    ...(allowSameDay === undefined ? {} : { allowSameDay }),
  });
}

describe("createEvent duplicate-date guard", () => {
  it("rejects a second plan on the same local day with a typed error", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    const { planId } = await createPlan(
      t,
      token,
      world.groupId,
      "Sunday Service",
      SUN_9AM,
    );

    let thrown: unknown;
    try {
      await createPlan(t, token, world.groupId, "Sunday Service", SUN_11AM);
    } catch (e) {
      thrown = e;
    }
    const data = expectDuplicateError(thrown);
    // The client needs enough to offer "open the one you have".
    expect(data.existingPlanId).toBe(planId);
    expect(data.existingPlanTitle).toBe("Sunday Service");
    expect(data.existingEventDate).toBe(SUN_9AM);
    expect(data.existingCount).toBe(1);
    expect(data.dayLabel).toBe("Sun, Aug 2");
    expect(String(data.message)).toContain("Sun, Aug 2");

    // Nothing was written.
    const plans = await t.run(async (ctx) =>
      ctx.db
        .query("eventPlans")
        .withIndex("by_group", (q) => q.eq("groupId", world.groupId))
        .collect(),
    );
    expect(plans).toHaveLength(1);
  });

  it("allows a deliberate second service on the same Sunday via allowSameDay", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    const { planId: first } = await createPlan(
      t,
      token,
      world.groupId,
      "9 AM Service",
      SUN_9AM,
    );
    const { planId: second } = await createPlan(
      t,
      token,
      world.groupId,
      "11 AM Service",
      SUN_11AM,
      true,
    );
    expect(second).not.toBe(first);

    const plans = await t.run(async (ctx) =>
      ctx.db
        .query("eventPlans")
        .withIndex("by_group", (q) => q.eq("groupId", world.groupId))
        .collect(),
    );
    expect(plans).toHaveLength(2);
  });

  it("treats Sat 11 PM and Sun 9 AM local as different days (a UTC bucket would not)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    // Both are 2 Aug in UTC; in ET one is Saturday night, the other Sunday.
    expect(new Date(SAT_11PM).getUTCDate()).toBe(new Date(SUN_9AM).getUTCDate());

    await createPlan(t, token, world.groupId, "Saturday Night", SAT_11PM);
    await expect(
      createPlan(t, token, world.groupId, "Sunday Morning", SUN_9AM),
    ).resolves.toBeTruthy();
  });

  it("treats Sun 9 AM and Sun 9 PM local as the same day (they straddle UTC midnight)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    // Different UTC dates — a UTC bucket would wave this duplicate through.
    expect(new Date(SUN_9PM).getUTCDate()).not.toBe(
      new Date(SUN_9AM).getUTCDate(),
    );

    await createPlan(t, token, world.groupId, "Sunday Morning", SUN_9AM);
    let thrown: unknown;
    try {
      await createPlan(t, token, world.groupId, "Sunday Evening", SUN_9PM);
    } catch (e) {
      thrown = e;
    }
    expectDuplicateError(thrown);
  });

  it("uses the community's own timezone, not the server's", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    await t.run(async (ctx) => {
      await ctx.db.patch(world.communityId, { timezone: "Pacific/Auckland" });
    });

    // 13:00Z Sun 2 Aug is Monday 3 Aug 01:00 in Auckland (UTC+12); 03:00Z the
    // same UTC day is still Sunday 2 Aug there. Under ET these two are
    // DIFFERENT days but the earlier one is Saturday — under NZ they are also
    // different days, but shifted. What matters is that 13:00Z and 15:00Z (both
    // Monday in NZ) still collide, while 03:00Z (Sunday in NZ) does not.
    await createPlan(t, token, world.groupId, "Morning", SAT_11PM);
    await expect(
      createPlan(t, token, world.groupId, "Service", SUN_9AM),
    ).resolves.toBeTruthy();

    let thrown: unknown;
    try {
      await createPlan(t, token, world.groupId, "Second", SUN_11AM);
    } catch (e) {
      thrown = e;
    }
    const data = expectDuplicateError(thrown);
    // Auckland renders 15:00Z Sun 2 Aug as Monday 3 Aug.
    expect(data.dayLabel).toBe("Mon, Aug 3");
  });

  it("ignores demo-seeded plans so a demo Sunday never blocks a real one", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    await t.run(async (ctx) => {
      await ctx.db.insert("eventPlans", {
        groupId: world.groupId,
        communityId: world.communityId,
        title: "Demo Sunday",
        eventDate: SUN_9AM,
        times: [{ label: "9 AM", startsAt: SUN_9AM }],
        status: "draft",
        createdAt: Date.now(),
        createdById: world.groupLeaderId,
        updatedAt: Date.now(),
        isDemoSeed: true,
      });
    });

    await expect(
      createPlan(t, token, world.groupId, "Real Sunday", SUN_11AM),
    ).resolves.toBeTruthy();
  });

  it("scopes the collision to the group — another group may plan the same day", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    const otherGroupId = await t.run(async (ctx) => {
      const groupType = await ctx.db
        .query("groupTypes")
        .filter((q) => q.eq(q.field("communityId"), world.communityId))
        .first();
      const groupId = await ctx.db.insert("groups", {
        communityId: world.communityId,
        groupTypeId: groupType!._id,
        name: "Manhattan Campus",
        isArchived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("groupMembers", {
        groupId,
        userId: world.groupLeaderId,
        role: "leader",
        joinedAt: Date.now(),
        notificationsEnabled: true,
      });
      return groupId;
    });

    await createPlan(t, token, world.groupId, "Brooklyn", SUN_9AM);
    await expect(
      createPlan(t, token, otherGroupId, "Manhattan", SUN_9AM),
    ).resolves.toBeTruthy();
  });
});

describe("duplicateEvent duplicate-date guard", () => {
  it("rejects a second duplicate onto the same target week", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    const eventDate = Date.now() + 7 * DAY;
    const { planId } = await createPlan(
      t,
      token,
      world.groupId,
      "Sunday Service",
      eventDate,
    );

    await t.mutation(api.functions.scheduling.events.duplicateEvent, {
      token,
      planId,
    });

    let thrown: unknown;
    try {
      await t.mutation(api.functions.scheduling.events.duplicateEvent, {
        token,
        planId,
      });
    } catch (e) {
      thrown = e;
    }
    expectDuplicateError(thrown);

    // Exactly one copy exists.
    const plans = await t.run(async (ctx) =>
      ctx.db
        .query("eventPlans")
        .withIndex("by_group", (q) => q.eq("groupId", world.groupId))
        .collect(),
    );
    expect(plans).toHaveLength(2);
  });

  it("still duplicates onto an occupied day when allowSameDay is set", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    const eventDate = Date.now() + 7 * DAY;
    const { planId } = await createPlan(
      t,
      token,
      world.groupId,
      "Sunday Service",
      eventDate,
    );
    await t.mutation(api.functions.scheduling.events.duplicateEvent, {
      token,
      planId,
    });
    await expect(
      t.mutation(api.functions.scheduling.events.duplicateEvent, {
        token,
        planId,
        allowSameDay: true,
      }),
    ).resolves.toBeTruthy();
  });
});

describe("updateEvent duplicate-date guard", () => {
  it("rejects moving a plan onto a day the group already plans", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    await createPlan(t, token, world.groupId, "Sunday Service", SUN_9AM);
    const { planId: mover } = await createPlan(
      t,
      token,
      world.groupId,
      "Saturday Night",
      SAT_11PM,
    );

    let thrown: unknown;
    try {
      await t.mutation(api.functions.scheduling.events.updateEvent, {
        token,
        planId: mover,
        eventDate: SUN_11AM,
      });
    } catch (e) {
      thrown = e;
    }
    expectDuplicateError(thrown);

    const unchanged = await t.run(async (ctx) => ctx.db.get(mover));
    expect(unchanged!.eventDate).toBe(SAT_11PM);
  });

  it("allows the move with allowSameDay, and never collides with itself", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    await createPlan(t, token, world.groupId, "Sunday Service", SUN_9AM);
    const { planId: mover } = await createPlan(
      t,
      token,
      world.groupId,
      "Saturday Night",
      SAT_11PM,
    );

    await t.mutation(api.functions.scheduling.events.updateEvent, {
      token,
      planId: mover,
      eventDate: SUN_11AM,
      allowSameDay: true,
    });
    expect((await t.run(async (ctx) => ctx.db.get(mover)))!.eventDate).toBe(
      SUN_11AM,
    );

    // Re-saving the same date (or a same-day nudge) must not trip the guard on
    // the plan's own row.
    await t.mutation(api.functions.scheduling.events.updateEvent, {
      token,
      planId: mover,
      title: "11 AM Service",
    });
    expect((await t.run(async (ctx) => ctx.db.get(mover)))!.title).toBe(
      "11 AM Service",
    );
  });

  it("lets a plan move WITHIN its own local day even when another plan shares that day", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    // The multi-service Sunday this whole feature exists to allow.
    await createPlan(t, token, world.groupId, "9 AM Service", SUN_9AM);
    const { planId: eleven } = await createPlan(
      t,
      token,
      world.groupId,
      "11 AM Service",
      SUN_11AM,
      true,
    );

    // The web date picker rebuilds a picked date at LOCAL MIDNIGHT, dropping
    // the time of day — so re-picking "the same date" sends a different
    // millisecond. Excluding the plan from itself does not save this: the 9 AM
    // plan is a real, different plan on the same day.
    const localMidnightSun2 = Date.UTC(2026, 7, 2, 4, 0); // 00:00 ET
    await t.mutation(api.functions.scheduling.events.updateEvent, {
      token,
      planId: eleven,
      eventDate: localMidnightSun2,
    });
    expect((await t.run(async (ctx) => ctx.db.get(eleven)))!.eventDate).toBe(
      localMidnightSun2,
    );

    // Leaving the day is still guarded.
    await createPlan(t, token, world.groupId, "Next Week", SUN_9AM + 7 * DAY);
    let thrown: unknown;
    try {
      await t.mutation(api.functions.scheduling.events.updateEvent, {
        token,
        planId: eleven,
        eventDate: SUN_9AM + 7 * DAY + 2 * 3600000,
      });
    } catch (e) {
      thrown = e;
    }
    expectDuplicateError(thrown);
  });
});

describe("corrupt eventDate rows", () => {
  /**
   * `eventDate` is a Convex `v.number()`, i.e. a float64 — `NaN` and
   * `Infinity` both pass validation, and `Intl.DateTimeFormat.format` throws
   * `RangeError: Invalid time value` on them. The guard maps the formatter
   * over every sibling plan and `rosterMatrix` over every plan in the group,
   * so one bad row (a bad client, an import, a migration) would otherwise turn
   * every create into an untyped 500 and make the grid unloadable.
   */
  async function insertCorruptPlan(
    t: ReturnType<typeof convexTest>,
    world: Awaited<ReturnType<typeof setupSchedulingWorld>>["world"],
    eventDate: number,
  ) {
    return t.run(async (ctx) =>
      ctx.db.insert("eventPlans", {
        groupId: world.groupId,
        communityId: world.communityId,
        title: "Corrupt",
        eventDate,
        times: [],
        status: "draft" as const,
        createdAt: Date.now(),
        createdById: world.groupLeaderId,
        updatedAt: Date.now(),
      }),
    );
  }

  it("does not stop the group creating a plan", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    await insertCorruptPlan(t, world, NaN);

    const { planId } = await createPlan(
      t,
      token,
      world.groupId,
      "Sunday Service",
      SUN_9AM,
    );
    expect(planId).toBeTruthy();
  });

  it("does not stop the roster grid loading, and is never flagged double-booked", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    // Two corrupt rows: they must not be bucketed together either.
    await insertCorruptPlan(t, world, NaN);
    await insertCorruptPlan(t, world, Infinity);

    const matrix = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token,
      groupId: world.groupId,
    });
    for (const event of matrix.events) {
      expect(event.sameDatePlanCount).toBe(1);
    }
  });
});

describe("rosterMatrix same-date flag", () => {
  it("counts plans sharing a local day so the grid can flag ambiguous columns", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;

    // ~14 days out at 12:00Z (08:00 ET) so the +2h sibling below stays on the
    // same local day whatever timezone the test runner is in. `rosterMatrix`
    // only returns upcoming columns, so the dates must be in the future.
    const future = Math.floor(Date.now() / DAY) * DAY + 14 * DAY + 12 * 3600000;
    const at = (offsetHours: number) => future + offsetHours * 3600000;

    const { planId: a } = await createPlan(t, token, world.groupId, "A", at(0));
    const { planId: b } = await createPlan(
      t,
      token,
      world.groupId,
      "B",
      at(2),
      true,
    );
    const { planId: c } = await createPlan(
      t,
      token,
      world.groupId,
      "C",
      at(24 * 7),
    );

    const matrix = await t.query(api.functions.scheduling.roster.rosterMatrix, {
      token,
      groupId: world.groupId,
    });
    const byId = new Map(
      matrix.events.map((e) => [e._id as string, e.sameDatePlanCount]),
    );
    // A and B share a local day (they are two hours apart); C is alone.
    expect(byId.get(a as string)).toBe(2);
    expect(byId.get(b as string)).toBe(2);
    expect(byId.get(c as string)).toBe(1);
  });
});
