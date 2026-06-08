/**
 * Tests for the native run sheet — `eventItems` CRUD, reorder, the
 * plan-link validation, view/edit permissions, and the deleteEvent cascade /
 * duplicateEvent copy (ADR-026).
 */

import { describe, it, expect, afterEach } from "vitest";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import schema from "../../schema";
import { modules } from "../../test.setup";
import { generateTokens } from "../../lib/auth";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { buildSchedulingWorld, ts } from "./fixtures";

let activeHandle: ReturnType<typeof convexTest> | null = null;

afterEach(async () => {
  if (activeHandle) {
    // deleteEvent / duplicateEvent enqueue deferred team reconciles — drain so
    // they don't leak into the next test.
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

/** Create a draft event plan and return its id. */
async function createPlan(
  t: ReturnType<typeof convexTest>,
  token: string,
  groupId: Id<"groups">,
): Promise<Id<"eventPlans">> {
  const eventDate = Date.now() + 7 * DAY;
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token,
      groupId,
      title: "Sunday",
      eventDate,
      times: [{ label: "10 AM", startsAt: eventDate }],
    },
  );
  return planId;
}

describe("eventItems CRUD + ordering", () => {
  it("appends items in sequence order and lists them sorted", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const create = (type: string, title: string, durationSec?: number) =>
      t.mutation(api.functions.scheduling.eventItems.createItem, {
        token,
        planId,
        type,
        title,
        durationSec,
      });

    await create("item", "Welcome", 120);
    await create("song", "Opener", 300);
    await create("header", "Message", 0);

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items?.map((i) => i.title)).toEqual(["Welcome", "Opener", "Message"]);
    expect(items?.map((i) => i.sequence)).toEqual([0, 1, 2]);
    expect(items?.[1].durationSec).toBe(300);
  });

  it("updates an item's fields", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const { itemId } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token, planId, type: "song", title: "Opener", durationSec: 300 },
    );

    await t.mutation(api.functions.scheduling.eventItems.updateItem, {
      token,
      itemId,
      title: "Opening Song",
      durationSec: 240,
      songDetails: { key: "G", bpm: 72 },
    });

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items?.[0].title).toBe("Opening Song");
    expect(items?.[0].durationSec).toBe(240);
    expect(items?.[0].songDetails).toEqual({ key: "G", bpm: 72 });
  });

  it("deletes an item", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const { itemId } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token, planId, type: "item", title: "Temp" },
    );
    await t.mutation(api.functions.scheduling.eventItems.deleteItem, {
      token,
      itemId,
    });

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items).toEqual([]);
  });

  it("rejects an empty title", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    await expect(
      t.mutation(api.functions.scheduling.eventItems.createItem, {
        token,
        planId,
        type: "item",
        title: "   ",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects an unknown item type", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    await expect(
      t.mutation(api.functions.scheduling.eventItems.createItem, {
        token,
        planId,
        type: "bogus",
        title: "X",
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("reorderItems", () => {
  it("rewrites sequence to match the provided order", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const ids: Id<"eventItems">[] = [];
    for (const title of ["A", "B", "C"]) {
      const { itemId } = await t.mutation(
        api.functions.scheduling.eventItems.createItem,
        { token, planId, type: "item", title },
      );
      ids.push(itemId);
    }

    // Move C to the front: [C, A, B].
    await t.mutation(api.functions.scheduling.eventItems.reorderItems, {
      token,
      planId,
      orderedIds: [ids[2], ids[0], ids[1]],
    });

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items?.map((i) => i.title)).toEqual(["C", "A", "B"]);
  });

  it("rejects a stale reorder list (wrong length)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const { itemId: a } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token, planId, type: "item", title: "A" },
    );
    await t.mutation(api.functions.scheduling.eventItems.createItem, {
      token,
      planId,
      type: "item",
      title: "B",
    });

    await expect(
      t.mutation(api.functions.scheduling.eventItems.reorderItems, {
        token,
        planId,
        orderedIds: [a], // only one id; plan has two
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("rejects a reorder list referencing a foreign item", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planA = await createPlan(t, token, world.groupId);
    const planB = await createPlan(t, token, world.groupId);

    const { itemId: onA } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token, planId: planA, type: "item", title: "A" },
    );
    const { itemId: onB } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      { token, planId: planB, type: "item", title: "B" },
    );

    await expect(
      t.mutation(api.functions.scheduling.eventItems.reorderItems, {
        token,
        planId: planA,
        orderedIds: [onA, onB], // onB belongs to planB
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("item → role linkage", () => {
  it("accepts a link to a role in the plan's group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const { itemId } = await t.mutation(
      api.functions.scheduling.eventItems.createItem,
      {
        token,
        planId,
        type: "song",
        title: "Opener",
        assignments: [{ roleId: world.roleId, userId: world.channelMemberId }],
      },
    );

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    const linked = items?.find((i) => i._id === itemId);
    expect(linked?.assignments[0].roleName).toBe("Drums");
    expect(linked?.assignments[0].userName).toBe("Memberly Test");
  });

  it("rejects a link to a role from another group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    // A role that belongs to a team in a DIFFERENT group.
    const foreignRoleId = await t.run(async (ctx) => {
      const otherGroupId = await ctx.db.insert("groups", {
        communityId: world.communityId,
        groupTypeId: (await ctx.db.query("groupTypes").first())!._id,
        name: "Queens Campus",
        isArchived: false,
        createdAt: ts(),
        updatedAt: ts(),
      });
      const otherTeamId = await ctx.db.insert("teams", {
        groupId: otherGroupId,
        communityId: world.communityId,
        name: "Other Team",
        isArchived: false,
        createdAt: ts(),
        createdById: world.groupLeaderId,
        updatedAt: ts(),
      });
      return ctx.db.insert("teamRoles", {
        teamId: otherTeamId,
        communityId: world.communityId,
        name: "Foreign",
        sortOrder: 0,
        isArchived: false,
        createdAt: ts(),
        createdById: world.groupLeaderId,
      });
    });

    await expect(
      t.mutation(api.functions.scheduling.eventItems.createItem, {
        token,
        planId,
        type: "song",
        title: "Opener",
        assignments: [{ roleId: foreignRoleId }],
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("permissions", () => {
  it("lets an active group member view but not edit the run sheet", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, leaderToken, world.groupId);
    await t.mutation(api.functions.scheduling.eventItems.createItem, {
      token: leaderToken,
      planId,
      type: "item",
      title: "Welcome",
    });

    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    // Can view.
    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token: memberToken,
      planId,
    });
    expect(items?.length).toBe(1);
    // Cannot create.
    await expect(
      t.mutation(api.functions.scheduling.eventItems.createItem, {
        token: memberToken,
        planId,
        type: "item",
        title: "Sneaky",
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("forbids an outsider from viewing the run sheet", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, leaderToken, world.groupId);

    const outsiderToken = (await generateTokens(world.outsiderId)).accessToken;
    await expect(
      t.query(api.functions.scheduling.eventItems.listItems, {
        token: outsiderToken,
        planId,
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("plan lifecycle integration", () => {
  it("deleteEvent cascades to run sheet items", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);
    await t.mutation(api.functions.scheduling.eventItems.createItem, {
      token,
      planId,
      type: "item",
      title: "Welcome",
    });

    const result = await t.mutation(
      api.functions.scheduling.events.deleteEvent,
      { token, planId },
    );
    expect(result.deletedItems).toBe(1);

    const leftover = await t.run((ctx) =>
      ctx.db
        .query("eventItems")
        .withIndex("by_plan", (q) => q.eq("planId", planId))
        .collect(),
    );
    expect(leftover).toEqual([]);
  });

  it("duplicateEvent copies items but drops per-item assignments", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);
    await t.mutation(api.functions.scheduling.eventItems.createItem, {
      token,
      planId,
      type: "song",
      title: "Opener",
      durationSec: 300,
      assignments: [{ roleId: world.roleId, userId: world.channelMemberId }],
    });

    const { planId: copyId } = await t.mutation(
      api.functions.scheduling.events.duplicateEvent,
      { token, planId },
    );

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId: copyId,
    });
    expect(items?.length).toBe(1);
    expect(items?.[0].title).toBe("Opener");
    expect(items?.[0].durationSec).toBe(300);
    // Assignments are intentionally NOT copied.
    expect(items?.[0].assignments).toEqual([]);
  });
});
