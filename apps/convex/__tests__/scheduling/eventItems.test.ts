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
      orderedItems: [ids[2], ids[0], ids[1]].map((id) => ({
        id,
        segment: "during",
      })),
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
        orderedItems: [{ id: a, segment: "during" }], // only one; plan has two
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
        orderedItems: [onA, onB].map((id) => ({ id, segment: "during" })), // onB ∈ planB
      }),
    ).rejects.toThrow(ConvexError);
  });
});

describe("duplicateItem", () => {
  it("places the copy directly after the source and resequences", async () => {
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

    // Duplicate the first item ("A").
    const { itemId: copyId } = await t.mutation(
      api.functions.scheduling.eventItems.duplicateItem,
      { token, itemId: ids[0] },
    );

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    // Copy sits right after the source: A, A(copy), B, C.
    expect(items?.map((i) => i.title)).toEqual(["A", "A", "B", "C"]);
    expect(items?.map((i) => i.sequence)).toEqual([0, 1, 2, 3]);
    expect(items?.[1]._id).toBe(copyId);
  });

  it("copies the source's role assignments", async () => {
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
        assignments: [{ roleId: world.roleId }],
      },
    );
    const { itemId: copyId } = await t.mutation(
      api.functions.scheduling.eventItems.duplicateItem,
      { token, itemId },
    );

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    const copy = items?.find((i) => i._id === copyId);
    expect(copy?.assignments[0].roleName).toBe("Drums");
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
        assignments: [{ roleId: world.roleId }],
      },
    );

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    const linked = items?.find((i) => i._id === itemId);
    // Links are role-only — the name resolves live from the roster client-side.
    expect(linked?.assignments[0].roleName).toBe("Drums");
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

  it("duplicateEvent copies items including their role-only links", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);
    await t.mutation(api.functions.scheduling.eventItems.createItem, {
      token,
      planId,
      type: "song",
      title: "Opener",
      durationSec: 300,
      assignments: [{ roleId: world.roleId }],
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
    // Role-only links are structural (they point at shared teamRoles), so they
    // are copied — they resolve to the new plan's (empty) roster.
    expect(items?.[0].assignments.map((a) => a.roleName)).toEqual(["Drums"]);
  });
});

describe("run sheet segments (before / during / after)", () => {
  const create = (
    t: ReturnType<typeof convexTest>,
    token: string,
    planId: Id<"eventPlans">,
    title: string,
    segment?: string,
  ) =>
    t.mutation(api.functions.scheduling.eventItems.createItem, {
      token,
      planId,
      type: "item",
      title,
      segment,
    });

  it("defaults to 'during' and groups items before → during → after", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    // Created out of phase order; listItems must regroup them.
    await create(t, token, planId, "Teardown", "after");
    await create(t, token, planId, "Welcome"); // defaults to during
    await create(t, token, planId, "Call time", "before");
    await create(t, token, planId, "Worship"); // during

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items?.map((i) => i.title)).toEqual([
      "Call time",
      "Welcome",
      "Worship",
      "Teardown",
    ]);
    expect(items?.map((i) => i.segment)).toEqual([
      "before",
      "during",
      "during",
      "after",
    ]);
  });

  it("sequence is per-segment (independent ordering within each phase)", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    await create(t, token, planId, "Before 1", "before");
    await create(t, token, planId, "During 1", "during");
    await create(t, token, planId, "Before 2", "before");

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    const byTitle = Object.fromEntries(
      (items ?? []).map((i) => [i.title, i]),
    );
    // Each phase counts from 0 independently.
    expect(byTitle["Before 1"].sequence).toBe(0);
    expect(byTitle["Before 2"].sequence).toBe(1);
    expect(byTitle["During 1"].sequence).toBe(0);
  });

  it("moving an item to another phase appends it there", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    await create(t, token, planId, "Before A", "before");
    const { itemId: moved } = await create(t, token, planId, "Welcome"); // during

    await t.mutation(api.functions.scheduling.eventItems.updateItem, {
      token,
      itemId: moved,
      segment: "before",
    });

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    const moveItem = (items ?? []).find((i) => i._id === moved);
    expect(moveItem?.segment).toBe("before");
    // Appended after the existing "Before A" (sequence 0) → sequence 1.
    expect(moveItem?.sequence).toBe(1);
    expect(items?.map((i) => i.title)).toEqual(["Before A", "Welcome"]);
  });

  it("reorderItems can drag an item across phases", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const { itemId: b1 } = await create(t, token, planId, "Before 1", "before");
    const { itemId: b2 } = await create(t, token, planId, "Before 2", "before");
    const { itemId: d1 } = await create(t, token, planId, "During 1", "during");

    // Drag "Before 2" into the during phase, ahead of "During 1", and leave
    // "Before 1" in before — the whole plan is sent with each item's new phase.
    await t.mutation(api.functions.scheduling.eventItems.reorderItems, {
      token,
      planId,
      orderedItems: [
        { id: b1, segment: "before" },
        { id: b2, segment: "during" },
        { id: d1, segment: "during" },
      ],
    });

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    expect(items?.map((i) => i.title)).toEqual([
      "Before 1",
      "Before 2",
      "During 1",
    ]);
    const byTitle = Object.fromEntries((items ?? []).map((i) => [i.title, i]));
    expect(byTitle["Before 2"].segment).toBe("during");
    expect(byTitle["Before 2"].sequence).toBe(0); // first in during now
    expect(byTitle["During 1"].sequence).toBe(1);
    expect(byTitle["Before 1"].segment).toBe("before");

    // A stale/incomplete list (missing an item) is rejected.
    await expect(
      t.mutation(api.functions.scheduling.eventItems.reorderItems, {
        token,
        planId,
        orderedItems: [{ id: b1, segment: "before" }],
      }),
    ).rejects.toThrow(ConvexError);
  });

  it("duplicateItem keeps the source's segment", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);

    const { itemId: src } = await create(t, token, planId, "Call time", "before");
    await create(t, token, planId, "Welcome"); // during

    await t.mutation(api.functions.scheduling.eventItems.duplicateItem, {
      token,
      itemId: src,
    });

    const items = await t.query(api.functions.scheduling.eventItems.listItems, {
      token,
      planId,
    });
    const before = (items ?? []).filter((i) => i.segment === "before");
    expect(before.map((i) => i.title)).toEqual(["Call time", "Call time"]);
    // The copy stays in the before phase; the during item is untouched.
    expect(items?.map((i) => i.title)).toEqual([
      "Call time",
      "Call time",
      "Welcome",
    ]);
  });

  it("rejects an unknown segment", async () => {
    const { t, world } = await setupSchedulingWorld();
    const token = (await generateTokens(world.groupLeaderId)).accessToken;
    const planId = await createPlan(t, token, world.groupId);
    await expect(
      create(t, token, planId, "Oops", "midway"),
    ).rejects.toThrow(ConvexError);
  });
});
