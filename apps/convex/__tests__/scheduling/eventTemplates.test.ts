/**
 * Tests for event templates (Phase 1): reusable, per-group task templates and
 * run-sheet templates + their CRUD (taskTemplates.ts / runSheetTemplates.ts).
 *
 * Covers: create/rename templates; add/list/reorder/update/delete items;
 * delete-template cascades its items; list*Templates itemCounts; role-belongs-
 * to-team validation; run-sheet song join; and auth (a non-leader cannot
 * create or edit).
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

async function setupSchedulingWorld() {
  const t = convexTest(schema, modules);
  activeHandle = t;
  const world = await buildSchedulingWorld(t);
  return { t, world };
}

/**
 * Insert a second serving team (+ one role) in the world's group, so multi-team
 * / cross-team validation can be exercised. Mirrors the eventTasks test helper.
 */
async function addSecondTeam(
  t: ReturnType<typeof convexTest>,
  world: Awaited<ReturnType<typeof buildSchedulingWorld>>,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const teamId = await ctx.db.insert("teams", {
      groupId: world.groupId,
      communityId: world.communityId,
      name: "Hospitality",
      isArchived: false,
      createdAt: now,
      createdById: world.groupLeaderId,
      updatedAt: now,
    });
    const roleId = await ctx.db.insert("teamRoles", {
      teamId,
      communityId: world.communityId,
      name: "Greeter",
      sortOrder: 0,
      defaultNeeded: 1,
      isArchived: false,
      createdAt: now,
      createdById: world.groupLeaderId,
    });
    return { teamId, roleId };
  });
}

// ============================================================================
// Task templates
// ============================================================================

describe("task templates CRUD", () => {
  it("creates, renames, adds/lists items ordered, and reorders", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;

    const { templateId } = await t.mutation(
      api.functions.scheduling.taskTemplates.createTaskTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Sunday Setup" },
    );

    await t.mutation(
      api.functions.scheduling.taskTemplates.renameTaskTemplate,
      { token: leaderToken, templateId, name: "Sunday AM Setup" },
    );

    // Create in mixed segments to prove before < during < after ordering.
    const after = await t.mutation(
      api.functions.scheduling.taskTemplates.addTaskTemplateItem,
      {
        token: leaderToken,
        templateId,
        teamIds: [world.teamId],
        segment: "after",
        title: "Tear down",
        howToType: "none",
      },
    );
    const before1 = await t.mutation(
      api.functions.scheduling.taskTemplates.addTaskTemplateItem,
      {
        token: leaderToken,
        templateId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "before",
        title: "Set up drums",
        howToType: "text",
        howToText: "Assemble the kit",
      },
    );
    const before2 = await t.mutation(
      api.functions.scheduling.taskTemplates.addTaskTemplateItem,
      {
        token: leaderToken,
        templateId,
        teamIds: [world.teamId],
        segment: "before",
        title: "Sound check",
        howToType: "none",
      },
    );

    const list = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(list.map((x) => x.title)).toEqual([
      "Set up drums",
      "Sound check",
      "Tear down",
    ]);
    // Role names hydrated; team-level item has an empty roleNames array.
    const setUp = list.find((x) => x.title === "Set up drums")!;
    expect(setUp.roleNames).toEqual(["Drums"]);
    expect(setUp.teamNames).toEqual(["Worship Team"]);
    expect(list.find((x) => x.title === "Sound check")!.roleNames).toEqual([]);

    // Reorder: put "Sound check" before "Set up drums".
    await t.mutation(
      api.functions.scheduling.taskTemplates.reorderTaskTemplateItems,
      {
        token: leaderToken,
        templateId,
        orderedIds: [before2.itemId, before1.itemId, after.itemId],
      },
    );
    const reordered = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(reordered.map((x) => x.title)).toEqual([
      "Sound check",
      "Set up drums",
      "Tear down",
    ]);
  });

  it("updates an item and deletes an item", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { templateId } = await t.mutation(
      api.functions.scheduling.taskTemplates.createTaskTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Setup" },
    );
    const { itemId } = await t.mutation(
      api.functions.scheduling.taskTemplates.addTaskTemplateItem,
      {
        token: leaderToken,
        templateId,
        teamIds: [world.teamId],
        roleIds: [world.roleId],
        segment: "before",
        title: "Original",
        howToType: "none",
      },
    );

    // Update title + convert to team-level (empty roleIds).
    await t.mutation(
      api.functions.scheduling.taskTemplates.updateTaskTemplateItem,
      { token: leaderToken, itemId, title: "Renamed", roleIds: [] },
    );
    let list = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(list[0].title).toBe("Renamed");
    expect(list[0].roleIds).toEqual([]);

    await t.mutation(
      api.functions.scheduling.taskTemplates.deleteTaskTemplateItem,
      { token: leaderToken, itemId },
    );
    list = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(list).toHaveLength(0);
  });

  it("rejects a role that does not belong to one of the item's teams", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const team2 = await addSecondTeam(t, world);
    const { templateId } = await t.mutation(
      api.functions.scheduling.taskTemplates.createTaskTemplate,
      { token: leaderToken, groupId: world.groupId, name: "X" },
    );

    // teamIds = [team1] but roleIds = [team2's role] → cross-team, rejected.
    await expect(
      t.mutation(
        api.functions.scheduling.taskTemplates.addTaskTemplateItem,
        {
          token: leaderToken,
          templateId,
          teamIds: [world.teamId],
          roleIds: [team2.roleId],
          segment: "before",
          title: "Bad",
          howToType: "none",
        },
      ),
    ).rejects.toThrow();
  });

  it("cascades items when the template is deleted", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { templateId } = await t.mutation(
      api.functions.scheduling.taskTemplates.createTaskTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Doomed" },
    );
    await t.mutation(
      api.functions.scheduling.taskTemplates.addTaskTemplateItem,
      {
        token: leaderToken,
        templateId,
        teamIds: [world.teamId],
        segment: "before",
        title: "One",
        howToType: "none",
      },
    );
    await t.mutation(
      api.functions.scheduling.taskTemplates.addTaskTemplateItem,
      {
        token: leaderToken,
        templateId,
        teamIds: [world.teamId],
        segment: "after",
        title: "Two",
        howToType: "none",
      },
    );

    const { deletedItems } = await t.mutation(
      api.functions.scheduling.taskTemplates.deleteTaskTemplate,
      { token: leaderToken, templateId },
    );
    expect(deletedItems).toBe(2);

    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("eventTaskTemplateItems")
        .withIndex("by_template", (q) => q.eq("templateId", templateId))
        .collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  it("listTaskTemplates returns correct itemCounts", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const a = await t.mutation(
      api.functions.scheduling.taskTemplates.createTaskTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Alpha" },
    );
    const b = await t.mutation(
      api.functions.scheduling.taskTemplates.createTaskTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Bravo" },
    );
    await t.mutation(
      api.functions.scheduling.taskTemplates.addTaskTemplateItem,
      {
        token: leaderToken,
        templateId: a.templateId,
        teamIds: [world.teamId],
        segment: "before",
        title: "one",
        howToType: "none",
      },
    );
    await t.mutation(
      api.functions.scheduling.taskTemplates.addTaskTemplateItem,
      {
        token: leaderToken,
        templateId: a.templateId,
        teamIds: [world.teamId],
        segment: "before",
        title: "two",
        howToType: "none",
      },
    );

    const list = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplates,
      { token: leaderToken, groupId: world.groupId },
    );
    const byId = new Map(list.map((x) => [x._id as string, x.itemCount]));
    expect(byId.get(a.templateId as string)).toBe(2);
    expect(byId.get(b.templateId as string)).toBe(0);
  });

  it("rejects create + edit from a non-leader", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;

    await expect(
      t.mutation(
        api.functions.scheduling.taskTemplates.createTaskTemplate,
        { token: memberToken, groupId: world.groupId, name: "Nope" },
      ),
    ).rejects.toThrow();

    // Leader creates one; a plain member cannot add an item to it.
    const { templateId } = await t.mutation(
      api.functions.scheduling.taskTemplates.createTaskTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Real" },
    );
    await expect(
      t.mutation(
        api.functions.scheduling.taskTemplates.addTaskTemplateItem,
        {
          token: memberToken,
          templateId,
          teamIds: [world.teamId],
          segment: "before",
          title: "Nope",
          howToType: "none",
        },
      ),
    ).rejects.toThrow();

    // A plain group member CAN read the list (community read gate).
    const list = await t.query(
      api.functions.scheduling.taskTemplates.listTaskTemplates,
      { token: memberToken, groupId: world.groupId },
    );
    expect(list).toHaveLength(1);
  });

  it("rejects an invalid template name", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    await expect(
      t.mutation(
        api.functions.scheduling.taskTemplates.createTaskTemplate,
        { token: leaderToken, groupId: world.groupId, name: "   " },
      ),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Run-sheet templates
// ============================================================================

describe("run-sheet templates CRUD", () => {
  it("creates, adds/lists items ordered by segment+sequence, reorders", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { templateId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Standard Flow" },
    );

    const opener = await t.mutation(
      api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
      {
        token: leaderToken,
        templateId,
        type: "header",
        title: "Pre-service",
        segment: "before",
        durationSec: 0,
      },
    );
    const song = await t.mutation(
      api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
      {
        token: leaderToken,
        templateId,
        type: "song",
        title: "Opening Song",
        segment: "during",
        durationSec: 300,
      },
    );
    const item2 = await t.mutation(
      api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
      {
        token: leaderToken,
        templateId,
        type: "item",
        title: "Welcome",
        segment: "during",
        durationSec: 120,
      },
    );

    let list = await t.query(
      api.functions.scheduling.runSheetTemplates.listRunSheetTemplateItems,
      { token: leaderToken, templateId },
    );
    // before → during (opening song, then welcome).
    expect(list.map((x) => x.title)).toEqual([
      "Pre-service",
      "Opening Song",
      "Welcome",
    ]);

    // Reorder the two during items (Welcome before Opening Song).
    await t.mutation(
      api.functions.scheduling.runSheetTemplates.reorderRunSheetTemplateItems,
      {
        token: leaderToken,
        templateId,
        orderedItems: [
          { id: opener.itemId, segment: "before" },
          { id: item2.itemId, segment: "during" },
          { id: song.itemId, segment: "during" },
        ],
      },
    );
    list = await t.query(
      api.functions.scheduling.runSheetTemplates.listRunSheetTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(list.map((x) => x.title)).toEqual([
      "Pre-service",
      "Welcome",
      "Opening Song",
    ]);
  });

  it("updates, duplicates, and deletes an item", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { templateId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Flow" },
    );
    const { itemId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
      {
        token: leaderToken,
        templateId,
        type: "song",
        title: "Song A",
        segment: "during",
        durationSec: 200,
      },
    );

    await t.mutation(
      api.functions.scheduling.runSheetTemplates.updateRunSheetTemplateItem,
      { token: leaderToken, itemId, title: "Song A (edited)", durationSec: 250 },
    );
    await t.mutation(
      api.functions.scheduling.runSheetTemplates.duplicateRunSheetTemplateItem,
      { token: leaderToken, itemId },
    );

    let list = await t.query(
      api.functions.scheduling.runSheetTemplates.listRunSheetTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(list.map((x) => x.title)).toEqual([
      "Song A (edited)",
      "Song A (edited)",
    ]);
    expect(list[0].durationSec).toBe(250);
    // Contiguous sequences within the segment after duplication.
    expect(list.map((x) => x.sequence)).toEqual([0, 1]);

    await t.mutation(
      api.functions.scheduling.runSheetTemplates.deleteRunSheetTemplateItem,
      { token: leaderToken, itemId },
    );
    list = await t.query(
      api.functions.scheduling.runSheetTemplates.listRunSheetTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(list).toHaveLength(1);
  });

  it("joins a linked library song and validates cross-community songs", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { templateId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Flow" },
    );
    const { itemId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
      {
        token: leaderToken,
        templateId,
        type: "song",
        title: "Amazing Grace",
        segment: "during",
        durationSec: 300,
      },
    );

    // A library song in the same community.
    const songId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("songs", {
        communityId: world.communityId,
        title: "Amazing Grace",
        author: "John Newton",
        createdAt: now,
        createdById: world.groupLeaderId,
        updatedAt: now,
      });
    });
    await t.mutation(
      api.functions.scheduling.runSheetTemplates.updateRunSheetTemplateItem,
      { token: leaderToken, itemId, songId },
    );

    const list = await t.query(
      api.functions.scheduling.runSheetTemplates.listRunSheetTemplateItems,
      { token: leaderToken, templateId },
    );
    expect(list[0].songId).toBe(songId);
    expect((list[0].song as { title: string } | null)?.title).toBe(
      "Amazing Grace",
    );

    // A song in a DIFFERENT community cannot be linked.
    const foreignSongId = await t.run(async (ctx) => {
      const now = Date.now();
      const otherCommunityId = await ctx.db.insert("communities", {
        name: "Other",
        slug: "other",
        isPublic: true,
      });
      return ctx.db.insert("songs", {
        communityId: otherCommunityId,
        title: "Foreign",
        createdAt: now,
        createdById: world.groupLeaderId,
        updatedAt: now,
      });
    });
    await expect(
      t.mutation(
        api.functions.scheduling.runSheetTemplates.updateRunSheetTemplateItem,
        { token: leaderToken, itemId, songId: foreignSongId },
      ),
    ).rejects.toThrow();
  });

  it("validates run-sheet item role assignments against the template's group", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const { templateId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Flow" },
    );

    // A role in a different group cannot be assigned.
    const foreignRoleId = await t.run(async (ctx) => {
      const now = Date.now();
      const existingGroup = await ctx.db.get(world.groupId);
      const otherGroupId = await ctx.db.insert("groups", {
        communityId: world.communityId,
        groupTypeId: existingGroup!.groupTypeId,
        name: "Other Campus",
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      });
      const otherTeamId = await ctx.db.insert("teams", {
        groupId: otherGroupId,
        communityId: world.communityId,
        name: "Other Team",
        isArchived: false,
        createdAt: now,
        createdById: world.groupLeaderId,
        updatedAt: now,
      });
      return ctx.db.insert("teamRoles", {
        teamId: otherTeamId,
        communityId: world.communityId,
        name: "Foreign Role",
        sortOrder: 0,
        defaultNeeded: 1,
        isArchived: false,
        createdAt: now,
        createdById: world.groupLeaderId,
      });
    });

    await expect(
      t.mutation(
        api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
        {
          token: leaderToken,
          templateId,
          type: "item",
          title: "Bad assignment",
          segment: "during",
          assignments: [{ roleId: foreignRoleId }],
        },
      ),
    ).rejects.toThrow();
  });

  it("cascades items when the template is deleted; listRunSheetTemplates itemCounts", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const a = await t.mutation(
      api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Alpha" },
    );
    const b = await t.mutation(
      api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Bravo" },
    );
    await t.mutation(
      api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
      {
        token: leaderToken,
        templateId: a.templateId,
        type: "song",
        title: "s1",
        segment: "during",
        durationSec: 100,
      },
    );

    const counts = await t.query(
      api.functions.scheduling.runSheetTemplates.listRunSheetTemplates,
      { token: leaderToken, groupId: world.groupId },
    );
    const byId = new Map(counts.map((x) => [x._id as string, x.itemCount]));
    expect(byId.get(a.templateId as string)).toBe(1);
    expect(byId.get(b.templateId as string)).toBe(0);

    const { deletedItems } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.deleteRunSheetTemplate,
      { token: leaderToken, templateId: a.templateId },
    );
    expect(deletedItems).toBe(1);
    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("runSheetTemplateItems")
        .withIndex("by_template", (q) => q.eq("templateId", a.templateId))
        .collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  it("rejects create + edit from a non-leader", async () => {
    const { t, world } = await setupSchedulingWorld();
    const leaderToken = (await generateTokens(world.groupLeaderId)).accessToken;
    const memberToken = (await generateTokens(world.channelMemberId)).accessToken;

    await expect(
      t.mutation(
        api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
        { token: memberToken, groupId: world.groupId, name: "Nope" },
      ),
    ).rejects.toThrow();

    const { templateId } = await t.mutation(
      api.functions.scheduling.runSheetTemplates.createRunSheetTemplate,
      { token: leaderToken, groupId: world.groupId, name: "Real" },
    );
    await expect(
      t.mutation(
        api.functions.scheduling.runSheetTemplates.addRunSheetTemplateItem,
        {
          token: memberToken,
          templateId,
          type: "song",
          title: "Nope",
          segment: "during",
          durationSec: 100,
        },
      ),
    ).rejects.toThrow();
  });
});
