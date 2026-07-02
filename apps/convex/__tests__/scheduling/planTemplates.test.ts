/**
 * Tests for the plan ↔ template linkage backend (Phase 3).
 *
 * Covers: linking a plan materializes rows tagged with `sourceTemplateItemId`;
 * forward propagation of template item add/edit/delete to FUTURE linked plans
 * (with completion cascade on delete); PAST plans frozen; local edits detach a
 * row; local deletes populate the detached set so propagation won't re-add;
 * switch-template carryover discard vs copy; save-as-template new + existing
 * (replace/merge); revert re-syncs; unlink strips source tags; duplicateEvent
 * carries the linkage. Run-sheet siblings are covered for the shared paths.
 */

import { describe, it, expect, afterEach } from "vitest";
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

const DAY = 86400000;

async function setupWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
  return { t, world, leaderToken };
}

type T = ReturnType<typeof convexTest>;
type World = Awaited<ReturnType<typeof buildSchedulingWorld>>;

/** Create a plan `daysAhead` days from now (negative => past). */
async function createPlan(
  t: T,
  world: World,
  token: string,
  daysAhead: number,
): Promise<Id<"eventPlans">> {
  const eventDate = Date.now() + daysAhead * DAY;
  const { planId } = await t.mutation(
    api.functions.scheduling.events.createEvent,
    {
      token,
      groupId: world.groupId,
      title: "Sunday",
      eventDate,
      times: [{ label: "9 AM", startsAt: eventDate }],
    },
  );
  return planId;
}

async function createTaskTemplate(
  t: T,
  world: World,
  token: string,
  name: string,
): Promise<Id<"eventTaskTemplates">> {
  const { templateId } = await t.mutation(
    api.functions.scheduling.taskTemplates.createTaskTemplate,
    { token, groupId: world.groupId, name },
  );
  return templateId;
}

async function addTaskItem(
  t: T,
  world: World,
  token: string,
  templateId: Id<"eventTaskTemplates">,
  title: string,
  opts: { roleIds?: Id<"teamRoles">[]; segment?: "before" | "during" | "after" } = {},
): Promise<Id<"eventTaskTemplateItems">> {
  const { itemId } = await t.mutation(
    api.functions.scheduling.taskTemplates.addTaskTemplateItem,
    {
      token,
      templateId,
      teamIds: [world.teamId],
      roleIds: opts.roleIds,
      segment: opts.segment ?? "before",
      title,
      howToType: "none",
    },
  );
  return itemId;
}

/** Read a plan's raw eventTasks rows (with the template linkage columns). */
async function planTasks(t: T, planId: Id<"eventPlans">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("eventTasks")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect(),
  );
}

async function planItems(t: T, planId: Id<"eventPlans">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("eventItems")
      .withIndex("by_plan", (q) => q.eq("planId", planId))
      .collect(),
  );
}

async function getPlan(t: T, planId: Id<"eventPlans">) {
  return t.run(async (ctx) => ctx.db.get(planId));
}

// ============================================================================
// Link / instantiate
// ============================================================================

describe("setPlanTaskTemplate — link", () => {
  it("materializes template items as synced plan rows", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    const i1 = await addTaskItem(t, world, leaderToken, templateId, "First");
    const i2 = await addTaskItem(t, world, leaderToken, templateId, "Second");
    const planId = await createPlan(t, world, leaderToken, 7);

    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );

    const rows = await planTasks(t, planId);
    expect(rows).toHaveLength(2);
    const bySource = new Map(rows.map((r) => [r.sourceTemplateItemId, r]));
    expect(bySource.get(i1)?.title).toBe("First");
    expect(bySource.get(i2)?.title).toBe("Second");
    for (const r of rows) expect(r.templateDetached).toBe(false);

    const plan = await getPlan(t, planId);
    expect(plan?.taskTemplateId).toBe(templateId);
    expect(plan?.detachedTaskTemplateItemIds).toEqual([]);
  });

  it("rejects (re)linking a PAST plan", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    await addTaskItem(t, world, leaderToken, templateId, "First");
    const planId = await createPlan(t, world, leaderToken, -7);

    await expect(
      t.mutation(api.functions.scheduling.planTemplates.setPlanTaskTemplate, {
        token: leaderToken,
        planId,
        templateId,
        carryover: "discard",
      }),
    ).rejects.toThrow(/frozen/i);
  });
});

// ============================================================================
// Forward propagation
// ============================================================================

describe("forward propagation to future linked plans", () => {
  it("edits a template item → the synced plan row updates", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    const itemId = await addTaskItem(t, world, leaderToken, templateId, "Old");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );

    await t.mutation(
      api.functions.scheduling.taskTemplates.updateTaskTemplateItem,
      { token: leaderToken, itemId, title: "New" },
    );

    const rows = await planTasks(t, planId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("New");
    expect(rows[0].templateDetached).toBe(false);
  });

  it("adds a template item → it appears on the future plan", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    await addTaskItem(t, world, leaderToken, templateId, "First");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );

    const i2 = await addTaskItem(t, world, leaderToken, templateId, "Second");

    const rows = await planTasks(t, planId);
    expect(rows.map((r) => r.title).sort()).toEqual(["First", "Second"]);
    expect(rows.some((r) => r.sourceTemplateItemId === i2)).toBe(true);
  });

  it("deletes a template item → the synced row and its completions are removed", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    const itemId = await addTaskItem(t, world, leaderToken, templateId, "Role task", {
      roleIds: [world.roleId],
    });
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(api.functions.scheduling.events.setNeededRoles, {
      token: leaderToken,
      planId,
      roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
    });
    // Assign + confirm the member so they can complete the role task.
    const { assignmentId } = await t.mutation(
      api.functions.scheduling.assignments.assignRole,
      { token: leaderToken, planId, teamId: world.teamId, roleId: world.roleId, userId: world.channelMemberId },
    );
    await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
      token: memberToken,
      assignmentId,
      status: "confirmed",
    });
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    const [task] = await planTasks(t, planId);
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId: task._id,
      completed: true,
    });
    const completionsBefore = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect(),
    );
    expect(completionsBefore).toHaveLength(1);

    await t.mutation(
      api.functions.scheduling.taskTemplates.deleteTaskTemplateItem,
      { token: leaderToken, itemId },
    );

    expect(await planTasks(t, planId)).toHaveLength(0);
    const completionsAfter = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskCompletions")
        .withIndex("by_task", (q) => q.eq("taskId", task._id))
        .collect(),
    );
    expect(completionsAfter).toHaveLength(0);
  });

  it("does NOT touch a PAST linked plan", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    const itemId = await addTaskItem(t, world, leaderToken, templateId, "Old");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    // Move the plan into the past AFTER linking (freeze it).
    await t.run(async (ctx) =>
      ctx.db.patch(planId, { eventDate: Date.now() - 7 * DAY }),
    );

    await t.mutation(
      api.functions.scheduling.taskTemplates.updateTaskTemplateItem,
      { token: leaderToken, itemId, title: "New" },
    );

    const rows = await planTasks(t, planId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Old"); // frozen — not updated
  });
});

// ============================================================================
// Override marking
// ============================================================================

describe("override marking", () => {
  it("locally editing a plan row detaches it; later template edits don't clobber it", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    const itemId = await addTaskItem(t, world, leaderToken, templateId, "Template title");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    const [task] = await planTasks(t, planId);

    await t.mutation(api.functions.scheduling.eventTasks.updateTask, {
      token: leaderToken,
      taskId: task._id,
      title: "Local override",
    });
    expect((await planTasks(t, planId))[0].templateDetached).toBe(true);

    // A later template edit must NOT overwrite the overridden row.
    await t.mutation(
      api.functions.scheduling.taskTemplates.updateTaskTemplateItem,
      { token: leaderToken, itemId, title: "Template title v2" },
    );
    const rows = await planTasks(t, planId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Local override");
  });

  it("locally deleting a template-sourced row records it so propagation won't re-add", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    const itemId = await addTaskItem(t, world, leaderToken, templateId, "Doomed");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    const [task] = await planTasks(t, planId);

    await t.mutation(api.functions.scheduling.eventTasks.deleteTask, {
      token: leaderToken,
      taskId: task._id,
    });
    const plan = await getPlan(t, planId);
    expect(plan?.detachedTaskTemplateItemIds).toContain(itemId);

    // A subsequent template edit propagates but must NOT re-add the removed row.
    await t.mutation(
      api.functions.scheduling.taskTemplates.updateTaskTemplateItem,
      { token: leaderToken, itemId, title: "Doomed v2" },
    );
    expect(await planTasks(t, planId)).toHaveLength(0);
  });
});

// ============================================================================
// Switch template (carryover)
// ============================================================================

describe("switch template with carryover", () => {
  async function setupSwitch(t: T, world: World, token: string) {
    const templateA = await createTaskTemplate(t, world, token, "A");
    await addTaskItem(t, world, token, templateA, "a1");
    await addTaskItem(t, world, token, templateA, "a2");
    const templateB = await createTaskTemplate(t, world, token, "B");
    await addTaskItem(t, world, token, templateB, "b1");
    const planId = await createPlan(t, world, token, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token, planId, templateId: templateA, carryover: "discard" },
    );
    // Override a1 (edit → detach), leave a2 synced, add a local task.
    const rows = await planTasks(t, planId);
    const a1 = rows.find((r) => r.title === "a1")!;
    await t.mutation(api.functions.scheduling.eventTasks.updateTask, {
      token,
      taskId: a1._id,
      title: "a1-edited",
    });
    await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token,
      planId,
      teamIds: [world.teamId],
      segment: "before",
      title: "Local",
      howToType: "none",
    });
    return { templateB, planId };
  }

  it("discard drops overridden + local rows, keeps only the new template rows", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const { templateB, planId } = await setupSwitch(t, world, leaderToken);

    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId: templateB, carryover: "discard" },
    );

    const rows = await planTasks(t, planId);
    expect(rows.map((r) => r.title)).toEqual(["b1"]);
    expect(rows[0].templateDetached).toBe(false);
    expect((await getPlan(t, planId))?.taskTemplateId).toBe(templateB);
  });

  it("copy keeps overridden + local rows as plain local rows alongside the new template rows", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const { templateB, planId } = await setupSwitch(t, world, leaderToken);

    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId: templateB, carryover: "copy" },
    );

    const rows = await planTasks(t, planId);
    expect(rows.map((r) => r.title).sort()).toEqual(["Local", "a1-edited", "b1"]);
    // a2 (clean synced against A) is gone; kept rows are stripped of source tags.
    const kept = rows.filter((r) => r.title !== "b1");
    for (const r of kept) expect(r.sourceTemplateItemId).toBeUndefined();
    const b1 = rows.find((r) => r.title === "b1")!;
    expect(b1.sourceTemplateItemId).toBeDefined();
  });
});

// ============================================================================
// Save as template
// ============================================================================

describe("saveTaskTemplateFromPlan", () => {
  async function planWithTwoTasks(t: T, world: World, token: string) {
    const planId = await createPlan(t, world, token, 7);
    for (const title of ["Task 1", "Task 2"]) {
      await t.mutation(api.functions.scheduling.eventTasks.createTask, {
        token,
        planId,
        teamIds: [world.teamId],
        segment: "before",
        title,
        howToType: "none",
      });
    }
    return planId;
  }

  it("new — creates a template from the plan and links the plan to it", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const planId = await planWithTwoTasks(t, world, leaderToken);

    const { templateId } = await t.mutation(
      api.functions.scheduling.planTemplates.saveTaskTemplateFromPlan,
      { token: leaderToken, planId, mode: { kind: "new", name: "From plan" } },
    );

    const items = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(items.map((i) => i.title)).toEqual(["Task 1", "Task 2"]);
    // Plan is now linked and its rows are synced against the new template.
    const plan = await getPlan(t, planId);
    expect(plan?.taskTemplateId).toBe(templateId);
    const rows = await planTasks(t, planId);
    for (const r of rows) {
      expect(r.sourceTemplateItemId).toBeDefined();
      expect(r.templateDetached).toBe(false);
    }
  });

  it("existing replace — clears the template, repopulates from the plan, and propagates", async () => {
    const { t, world, leaderToken } = await setupWorld();
    // A template with one item, and a SECOND future plan linked to it.
    const templateId = await createTaskTemplate(t, world, leaderToken, "T");
    await addTaskItem(t, world, leaderToken, templateId, "Original");
    const otherPlan = await createPlan(t, world, leaderToken, 14);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId: otherPlan, templateId, carryover: "discard" },
    );
    const sourcePlan = await planWithTwoTasks(t, world, leaderToken);

    await t.mutation(
      api.functions.scheduling.planTemplates.saveTaskTemplateFromPlan,
      {
        token: leaderToken,
        planId: sourcePlan,
        mode: { kind: "existing", templateId, strategy: "replace" },
      },
    );

    const items = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(items.map((i) => i.title)).toEqual(["Task 1", "Task 2"]);
    // The other future plan was reconciled: old row gone, two new synced rows.
    const otherRows = await planTasks(t, otherPlan);
    expect(otherRows.map((r) => r.title).sort()).toEqual(["Task 1", "Task 2"]);
  });

  it("existing merge — appends the plan's tasks and propagates to other plans", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "T");
    await addTaskItem(t, world, leaderToken, templateId, "Original");
    const otherPlan = await createPlan(t, world, leaderToken, 14);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId: otherPlan, templateId, carryover: "discard" },
    );
    const sourcePlan = await planWithTwoTasks(t, world, leaderToken);

    await t.mutation(
      api.functions.scheduling.planTemplates.saveTaskTemplateFromPlan,
      {
        token: leaderToken,
        planId: sourcePlan,
        mode: { kind: "existing", templateId, strategy: "merge" },
      },
    );

    const items = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(items.map((i) => i.title).sort()).toEqual(["Original", "Task 1", "Task 2"]);
    const otherRows = await planTasks(t, otherPlan);
    expect(otherRows.map((r) => r.title).sort()).toEqual(["Original", "Task 1", "Task 2"]);
  });
});

// ============================================================================
// Revert + unlink
// ============================================================================

describe("revert + unlink", () => {
  it("revert re-syncs the plan to the template, dropping overrides + local rows", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    await addTaskItem(t, world, leaderToken, templateId, "Keep me");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    const [task] = await planTasks(t, planId);
    // Override it and add a local task.
    await t.mutation(api.functions.scheduling.eventTasks.updateTask, {
      token: leaderToken,
      taskId: task._id,
      title: "Edited",
    });
    await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamIds: [world.teamId],
      segment: "before",
      title: "Local",
      howToType: "none",
    });

    await t.mutation(
      api.functions.scheduling.planTemplates.revertPlanTaskTemplateEdits,
      { token: leaderToken, planId },
    );

    const rows = await planTasks(t, planId);
    expect(rows.map((r) => r.title)).toEqual(["Keep me"]);
    expect(rows[0].templateDetached).toBe(false);
    expect(rows[0].sourceTemplateItemId).toBeDefined();
    expect((await getPlan(t, planId))?.detachedTaskTemplateItemIds).toEqual([]);
  });

  it("unlink strips source tags, leaving plain local rows", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    await addTaskItem(t, world, leaderToken, templateId, "One");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );

    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId: null },
    );

    const rows = await planTasks(t, planId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceTemplateItemId).toBeUndefined();
    expect(rows[0].templateDetached).toBeUndefined();
    const plan = await getPlan(t, planId);
    expect(plan?.taskTemplateId).toBeUndefined();
    expect(plan?.detachedTaskTemplateItemIds).toBeUndefined();
  });
});

// ============================================================================
// duplicateEvent carries the linkage
// ============================================================================

describe("duplicateEvent", () => {
  it("carries the template pointer and per-row source tags to the copy", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "Setup");
    await addTaskItem(t, world, leaderToken, templateId, "One");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );

    const { planId: copyId } = await t.mutation(
      api.functions.scheduling.events.duplicateEvent,
      { token: leaderToken, planId },
    );

    const copy = await getPlan(t, copyId);
    expect(copy?.taskTemplateId).toBe(templateId);
    const rows = await planTasks(t, copyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceTemplateItemId).toBeDefined();
    expect(rows[0].templateDetached).toBe(false);
  });
});

// ============================================================================
// Run-sheet siblings (shared paths)
// ============================================================================

describe("run-sheet template linkage", () => {
  async function createRunSheetTemplate(t: T, world: World, token: string) {
    const { templateId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
      { token, groupId: world.groupId, name: "Order" },
    );
    return templateId;
  }
  async function addRunItem(
    t: T,
    token: string,
    templateId: Id<"runSheetTemplates">,
    title: string,
  ) {
    const { itemId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
      { token, templateId, type: "item", title, segment: "during" },
    );
    return itemId;
  }

  it("links, propagates an edit, and unlinks", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createRunSheetTemplate(t, world, leaderToken);
    const itemId = await addRunItem(t, leaderToken, templateId, "Opener");
    const planId = await createPlan(t, world, leaderToken, 7);

    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanRunSheetTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    let rows = await planItems(t, planId);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Opener");
    expect(rows[0].sourceTemplateItemId).toBe(itemId);

    // Edit propagates to the synced row.
    await t.mutation(
      api.functions.scheduling.runSheetTemplates.updateRunSheetTemplateItem,
      { token: leaderToken, itemId, title: "Welcome" },
    );
    rows = await planItems(t, planId);
    expect(rows[0].title).toBe("Welcome");

    // Local edit detaches; unlink strips source tags.
    await t.mutation(api.functions.scheduling.eventItems.updateItem, {
      token: leaderToken,
      itemId: rows[0]._id,
      title: "Local",
    });
    expect((await planItems(t, planId))[0].templateDetached).toBe(true);

    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanRunSheetTemplate,
      { token: leaderToken, planId, templateId: null },
    );
    rows = await planItems(t, planId);
    expect(rows[0].sourceTemplateItemId).toBeUndefined();
    expect(rows[0].title).toBe("Local");
    expect((await getPlan(t, planId))?.runSheetTemplateId).toBeUndefined();
  });

  it("saves a run sheet from a plan (new) and freezes past plans on propagation", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(api.functions.scheduling.eventItems.createItem, {
      token: leaderToken,
      planId,
      type: "item",
      title: "Item A",
      segment: "during",
    });

    const { templateId } = await t.mutation(
      api.functions.scheduling.planTemplates.saveRunSheetTemplateFromPlan,
      { token: leaderToken, planId, mode: { kind: "new", name: "Saved" } },
    );
    const plan = await getPlan(t, planId);
    expect(plan?.runSheetTemplateId).toBe(templateId);

    // Freeze the plan, then edit the template — the past plan must not change.
    await t.run(async (ctx) =>
      ctx.db.patch(planId, { eventDate: Date.now() - 3 * DAY }),
    );
    const items = await t.query(
      api.functions.scheduling.runSheetTemplates.listRunSheetTemplateItems,
      { token: leaderToken, templateId },
    );
    await t.mutation(
      api.functions.scheduling.runSheetTemplates.updateRunSheetTemplateItem,
      { token: leaderToken, itemId: items[0]._id, title: "Renamed" },
    );
    const rows = await planItems(t, planId);
    expect(rows[0].title).toBe("Item A"); // frozen
  });
});

// ============================================================================
// Save-to-template correctness (Phase 3 review fixes)
// ============================================================================

/** Assign + confirm a user to the world's Drums role on a plan. */
async function assignConfirm(
  t: T,
  world: World,
  leaderToken: string,
  planId: Id<"eventPlans">,
  userId: Id<"users">,
) {
  await t.mutation(api.functions.scheduling.events.setNeededRoles, {
    token: leaderToken,
    planId,
    roles: [{ teamId: world.teamId, roleId: world.roleId, count: 1 }],
  });
  const { assignmentId } = await t.mutation(
    api.functions.scheduling.assignments.assignRole,
    { token: leaderToken, planId, teamId: world.teamId, roleId: world.roleId, userId },
  );
  await t.mutation(api.functions.scheduling.assignments.respondToAssignment, {
    token: (await generateTokens(userId)).accessToken,
    assignmentId,
    status: "confirmed",
  });
}

async function taskCompletions(t: T, taskId: Id<"eventTasks">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("eventTaskCompletions")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect(),
  );
}

async function templateItems(t: T, templateId: Id<"eventTaskTemplates">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("eventTaskTemplateItems")
      .withIndex("by_template", (q) => q.eq("templateId", templateId))
      .collect(),
  );
}

describe("save-to-template is id-preserving (Phase 3 fixes)", () => {
  it("REPLACE preserves the other linked plan's row id + completions (patch, not delete+reinsert)", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;
    const templateId = await createTaskTemplate(t, world, leaderToken, "T");
    const itemId = await addTaskItem(t, world, leaderToken, templateId, "Original", {
      roleIds: [world.roleId],
    });

    // A SECOND future plan linked to the template, with a completion.
    const p2 = await createPlan(t, world, leaderToken, 14);
    await assignConfirm(t, world, leaderToken, p2, world.channelMemberId);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId: p2, templateId, carryover: "discard" },
    );
    const [p2Task] = await planTasks(t, p2);
    await t.mutation(api.functions.scheduling.eventTasks.toggleTaskCompletion, {
      token: memberToken,
      taskId: p2Task._id,
      completed: true,
    });
    expect(await taskCompletions(t, p2Task._id)).toHaveLength(1);

    // Source plan P1, linked; edit its row, then REPLACE the template from it.
    const p1 = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId: p1, templateId, carryover: "discard" },
    );
    const [p1Task] = await planTasks(t, p1);
    await t.mutation(api.functions.scheduling.eventTasks.updateTask, {
      token: leaderToken,
      taskId: p1Task._id,
      title: "Renamed",
    });

    await t.mutation(
      api.functions.scheduling.planTemplates.saveTaskTemplateFromPlan,
      { token: leaderToken, planId: p1, mode: { kind: "existing", templateId, strategy: "replace" } },
    );

    // Template item id is STABLE (updated in place, not recreated).
    const items = await templateItems(t, templateId);
    expect(items).toHaveLength(1);
    expect(items[0]._id).toBe(itemId);
    expect(items[0].title).toBe("Renamed");

    // P2's synced row is the SAME row (id stable) and its completion survives.
    const p2After = await planTasks(t, p2);
    expect(p2After).toHaveLength(1);
    expect(p2After[0]._id).toBe(p2Task._id);
    expect(p2After[0].title).toBe("Renamed");
    expect(await taskCompletions(t, p2Task._id)).toHaveLength(1);
  });

  it("MERGE appends only genuinely-local rows (no duplication of already-synced rows)", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "T");
    await addTaskItem(t, world, leaderToken, templateId, "Original");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    // Add one genuinely-local task alongside the synced "Original".
    await t.mutation(api.functions.scheduling.eventTasks.createTask, {
      token: leaderToken,
      planId,
      teamIds: [world.teamId],
      segment: "before",
      title: "Local",
      howToType: "none",
    });

    await t.mutation(
      api.functions.scheduling.planTemplates.saveTaskTemplateFromPlan,
      { token: leaderToken, planId, mode: { kind: "existing", templateId, strategy: "merge" } },
    );

    // "Original" is NOT re-appended; only "Local" is added.
    const items = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(items.map((i) => i.title)).toEqual(["Original", "Local"]);
    // The source plan is not duplicated either.
    expect((await planTasks(t, planId)).map((r) => r.title).sort()).toEqual(["Local", "Original"]);
  });
});

describe("no-op-safe detach + revert past guard (Phase 3 fixes)", () => {
  it("a no-op updateTask does NOT detach a synced row", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "T");
    const itemId = await addTaskItem(t, world, leaderToken, templateId, "Same");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    const [task] = await planTasks(t, planId);

    // Re-send the SAME title — must not silently detach.
    await t.mutation(api.functions.scheduling.eventTasks.updateTask, {
      token: leaderToken,
      taskId: task._id,
      title: "Same",
    });
    expect((await planTasks(t, planId))[0].templateDetached).toBe(false);

    // Still synced: a template edit propagates to it.
    await t.mutation(
      api.functions.scheduling.taskTemplates.updateTaskTemplateItem,
      { token: leaderToken, itemId, title: "Changed" },
    );
    expect((await planTasks(t, planId))[0].title).toBe("Changed");
  });

  it("revert throws on a PAST plan", async () => {
    const { t, world, leaderToken } = await setupWorld();
    const templateId = await createTaskTemplate(t, world, leaderToken, "T");
    await addTaskItem(t, world, leaderToken, templateId, "One");
    const planId = await createPlan(t, world, leaderToken, 7);
    await t.mutation(
      api.functions.scheduling.planTemplates.setPlanTaskTemplate,
      { token: leaderToken, planId, templateId, carryover: "discard" },
    );
    await t.run(async (ctx) =>
      ctx.db.patch(planId, { eventDate: Date.now() - 7 * DAY }),
    );

    await expect(
      t.mutation(
        api.functions.scheduling.planTemplates.revertPlanTaskTemplateEdits,
        { token: leaderToken, planId },
      ),
    ).rejects.toThrow(/frozen/i);
  });
});
