/**
 * Typed function references for the event-template backend (Phase 1).
 *
 * Why this file exists: the Convex backend modules
 * `functions/scheduling/taskTemplates` and
 * `functions/scheduling/runSheetTemplates` are deployed, but the committed
 * `apps/convex/_generated/api.d.ts` in this repo can be stale offline and not
 * yet list them — so `api.functions.scheduling.taskTemplates.*` would be a type
 * error until the next `npx convex dev` regenerates the api map.
 *
 * Rather than depend on the generated `api` object, we build the references
 * directly from their function paths with `makeFunctionReference`, asserting the
 * precise arg/return types — matching the validators in `taskTemplates.ts` /
 * `runSheetTemplates.ts`. This is fully type-checked at every call site and,
 * unlike traversing the `api` proxy, evaluates safely under test mocks. Once the
 * generated api map includes the modules, this file can be deleted and call
 * sites can use the `api.functions.scheduling.*` paths directly.
 *
 * Phase 1 is backend-only — these refs exist so later phases can call the CRUD.
 */
import { makeFunctionReference } from "convex/server";
import type { Id } from "@services/api/convex";

// ============================================================================
// Shared shapes
// ============================================================================

/** "when it happens" phase for a task template item. */
export type TemplateSegment = "before" | "during" | "after";

/** "how to" guidance kind on a task template item. */
export type TemplateHowToType = "none" | "text" | "link" | "media" | "doc";

/** A saved template (task or run-sheet) with its item count, as listed. */
export type EventTemplateSummary = {
  _id: Id<"eventTaskTemplates"> | Id<"runSheetTemplates">;
  groupId: Id<"groups">;
  name: string;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
};

// ============================================================================
// Task templates
// ============================================================================

export type TaskTemplateSummary = {
  _id: Id<"eventTaskTemplates">;
  groupId: Id<"groups">;
  name: string;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
};

/** A hydrated task template item, as returned by `listTaskTemplateItems`. */
export type TaskTemplateItem = {
  _id: Id<"eventTaskTemplateItems">;
  templateId: Id<"eventTaskTemplates">;
  teamIds: string[];
  roleIds: string[];
  teamNames: string[];
  roleNames: string[];
  segment: TemplateSegment;
  title: string;
  howToType: TemplateHowToType;
  howToText?: string;
  howToUrl?: string;
  howToMediaPath?: string;
  howToDoc?: string;
  sortOrder: number;
};

export const createTaskTemplateRef = makeFunctionReference<
  "mutation",
  { token: string; groupId: Id<"groups">; name: string },
  { templateId: Id<"eventTaskTemplates"> }
>("functions/scheduling/taskTemplates:createTaskTemplate");

export const renameTaskTemplateRef = makeFunctionReference<
  "mutation",
  { token: string; templateId: Id<"eventTaskTemplates">; name: string },
  { templateId: Id<"eventTaskTemplates"> }
>("functions/scheduling/taskTemplates:renameTaskTemplate");

export const deleteTaskTemplateRef = makeFunctionReference<
  "mutation",
  { token: string; templateId: Id<"eventTaskTemplates"> },
  { deletedItems: number }
>("functions/scheduling/taskTemplates:deleteTaskTemplate");

export const listTaskTemplatesRef = makeFunctionReference<
  "query",
  { token: string; groupId: Id<"groups"> },
  TaskTemplateSummary[]
>("functions/scheduling/taskTemplates:listTaskTemplates");

export const listTaskTemplateItemsRef = makeFunctionReference<
  "query",
  { token: string; templateId: Id<"eventTaskTemplates"> },
  TaskTemplateItem[]
>("functions/scheduling/taskTemplates:listTaskTemplateItems");

export const addTaskTemplateItemRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    templateId: Id<"eventTaskTemplates">;
    teamIds: Id<"teams">[];
    roleIds?: Id<"teamRoles">[];
    segment: TemplateSegment;
    title: string;
    howToType: TemplateHowToType;
    howToText?: string;
    howToUrl?: string;
    howToMediaPath?: string;
    howToDoc?: string;
  },
  { itemId: Id<"eventTaskTemplateItems"> }
>("functions/scheduling/taskTemplates:addTaskTemplateItem");

export const updateTaskTemplateItemRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    itemId: Id<"eventTaskTemplateItems">;
    title?: string;
    teamIds?: Id<"teams">[];
    roleIds?: Id<"teamRoles">[];
    segment?: TemplateSegment;
    howToType?: TemplateHowToType;
    howToText?: string;
    howToUrl?: string;
    howToMediaPath?: string;
    howToDoc?: string;
  },
  { itemId: Id<"eventTaskTemplateItems"> }
>("functions/scheduling/taskTemplates:updateTaskTemplateItem");

export const deleteTaskTemplateItemRef = makeFunctionReference<
  "mutation",
  { token: string; itemId: Id<"eventTaskTemplateItems"> },
  { deleted: boolean }
>("functions/scheduling/taskTemplates:deleteTaskTemplateItem");

export const reorderTaskTemplateItemsRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    templateId: Id<"eventTaskTemplates">;
    orderedIds: Id<"eventTaskTemplateItems">[];
  },
  { reordered: number }
>("functions/scheduling/taskTemplates:reorderTaskTemplateItems");

// ============================================================================
// Run-sheet templates
// ============================================================================

export type RunSheetTemplateSummary = {
  _id: Id<"runSheetTemplates">;
  groupId: Id<"groups">;
  name: string;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
};

/** A single free-text note on a run-sheet item, categorized by role. */
export type RunSheetTemplateNote = { category: string; content: string };

/** Lightweight per-occurrence song metadata (override of the library song). */
export type RunSheetTemplateSongDetails = {
  key?: string;
  bpm?: number;
  author?: string;
};

/** A hydrated run-sheet template item, as returned by `listRunSheetTemplateItems`. */
export type RunSheetTemplateItem = {
  _id: Id<"runSheetTemplateItems">;
  templateId: Id<"runSheetTemplates">;
  segment: TemplateSegment;
  sequence: number;
  type: string;
  title: string;
  description: string | null;
  durationSec: number;
  notes: RunSheetTemplateNote[];
  songDetails: RunSheetTemplateSongDetails | null;
  songId: Id<"songs"> | null;
  // The joined library song (client-facing shape) or null. Left as unknown here
  // to avoid duplicating the Song type; call sites narrow as needed.
  song: unknown;
  assignments: Array<{
    roleId: Id<"teamRoles">;
    roleName: string;
    roleColor: string | null;
  }>;
};

export const createRunSheetTemplateRef = makeFunctionReference<
  "mutation",
  { token: string; groupId: Id<"groups">; name: string },
  { templateId: Id<"runSheetTemplates"> }
>("functions/scheduling/runSheetTemplates:createRunSheetTemplate");

export const renameRunSheetTemplateRef = makeFunctionReference<
  "mutation",
  { token: string; templateId: Id<"runSheetTemplates">; name: string },
  { templateId: Id<"runSheetTemplates"> }
>("functions/scheduling/runSheetTemplates:renameRunSheetTemplate");

export const deleteRunSheetTemplateRef = makeFunctionReference<
  "mutation",
  { token: string; templateId: Id<"runSheetTemplates"> },
  { deletedItems: number }
>("functions/scheduling/runSheetTemplates:deleteRunSheetTemplate");

export const listRunSheetTemplatesRef = makeFunctionReference<
  "query",
  { token: string; groupId: Id<"groups"> },
  RunSheetTemplateSummary[]
>("functions/scheduling/runSheetTemplates:listRunSheetTemplates");

export const listRunSheetTemplateItemsRef = makeFunctionReference<
  "query",
  { token: string; templateId: Id<"runSheetTemplates"> },
  RunSheetTemplateItem[]
>("functions/scheduling/runSheetTemplates:listRunSheetTemplateItems");

export const addRunSheetTemplateItemRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    templateId: Id<"runSheetTemplates">;
    type: string;
    title: string;
    segment?: string;
    durationSec?: number;
    description?: string;
    notes?: RunSheetTemplateNote[];
    assignments?: Array<{ roleId: Id<"teamRoles"> }>;
    songDetails?: RunSheetTemplateSongDetails;
  },
  { itemId: Id<"runSheetTemplateItems"> }
>("functions/scheduling/runSheetTemplates:addRunSheetTemplateItem");

export const updateRunSheetTemplateItemRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    itemId: Id<"runSheetTemplateItems">;
    type?: string;
    title?: string;
    segment?: string;
    durationSec?: number;
    description?: string;
    notes?: RunSheetTemplateNote[];
    assignments?: Array<{ roleId: Id<"teamRoles"> }>;
    songDetails?: RunSheetTemplateSongDetails;
    songId?: Id<"songs"> | null;
  },
  { itemId: Id<"runSheetTemplateItems"> }
>("functions/scheduling/runSheetTemplates:updateRunSheetTemplateItem");

export const deleteRunSheetTemplateItemRef = makeFunctionReference<
  "mutation",
  { token: string; itemId: Id<"runSheetTemplateItems"> },
  { deleted: boolean }
>("functions/scheduling/runSheetTemplates:deleteRunSheetTemplateItem");

export const duplicateRunSheetTemplateItemRef = makeFunctionReference<
  "mutation",
  { token: string; itemId: Id<"runSheetTemplateItems"> },
  { itemId: Id<"runSheetTemplateItems"> }
>("functions/scheduling/runSheetTemplates:duplicateRunSheetTemplateItem");

export const reorderRunSheetTemplateItemsRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    templateId: Id<"runSheetTemplates">;
    orderedItems: Array<{ id: Id<"runSheetTemplateItems">; segment: string }>;
  },
  { reordered: number }
>("functions/scheduling/runSheetTemplates:reorderRunSheetTemplateItems");

// ============================================================================
// Plan ↔ template linkage (Phase 3 contract)
//
// The plan-side of templates: a plan can be LINKED to a task template and/or a
// run-sheet template, its per-event edits tracked, and its current list saved
// back into a (new or existing) template. These refs mirror the LOCKED Phase 3
// backend contract; the `functions/scheduling/planTemplates` module is being
// built in parallel and may not be in the generated api map yet, so — like the
// Phase 1 refs above — they're addressed by string path via
// `makeFunctionReference`. Mutation return values are unused by the UI and left
// as `null`; reconcile the exact shapes when Phase 3 lands.
// ============================================================================

/** Carryover strategy when switching a plan's linked template with local edits. */
export type TemplateCarryover = "discard" | "copy";

/** How saving a plan's current items into an EXISTING template merges. */
export type SaveTemplateStrategy = "replace" | "merge";

/** Reactive linkage + edit state for one plan (both task and run-sheet). */
export type PlanTemplateState = {
  taskTemplateId: Id<"eventTaskTemplates"> | null;
  taskTemplateName: string | null;
  hasTaskTemplateEdits: boolean;
  runSheetTemplateId: Id<"runSheetTemplates"> | null;
  runSheetTemplateName: string | null;
  hasRunSheetTemplateEdits: boolean;
  isPast: boolean;
};

/** How to persist a plan's current tasks into a template (new or existing). */
export type SaveTaskTemplateMode =
  | { kind: "new"; name: string }
  | {
      kind: "existing";
      templateId: Id<"eventTaskTemplates">;
      strategy: SaveTemplateStrategy;
    };

/** How to persist a plan's current run sheet into a template (new or existing). */
export type SaveRunSheetTemplateMode =
  | { kind: "new"; name: string }
  | {
      kind: "existing";
      templateId: Id<"runSheetTemplates">;
      strategy: SaveTemplateStrategy;
    };

export const getPlanTemplateStateRef = makeFunctionReference<
  "query",
  { token: string; planId: Id<"eventPlans"> },
  PlanTemplateState
>("functions/scheduling/planTemplates:getPlanTemplateState");

export const setPlanTaskTemplateRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    planId: Id<"eventPlans">;
    templateId: Id<"eventTaskTemplates"> | null;
    carryover: TemplateCarryover;
  },
  null
>("functions/scheduling/planTemplates:setPlanTaskTemplate");

export const setPlanRunSheetTemplateRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    planId: Id<"eventPlans">;
    templateId: Id<"runSheetTemplates"> | null;
    carryover: TemplateCarryover;
  },
  null
>("functions/scheduling/planTemplates:setPlanRunSheetTemplate");

export const saveTaskTemplateFromPlanRef = makeFunctionReference<
  "mutation",
  { token: string; planId: Id<"eventPlans">; mode: SaveTaskTemplateMode },
  { templateId: Id<"eventTaskTemplates"> }
>("functions/scheduling/planTemplates:saveTaskTemplateFromPlan");

export const saveRunSheetTemplateFromPlanRef = makeFunctionReference<
  "mutation",
  { token: string; planId: Id<"eventPlans">; mode: SaveRunSheetTemplateMode },
  { templateId: Id<"runSheetTemplates"> }
>("functions/scheduling/planTemplates:saveRunSheetTemplateFromPlan");

export const revertPlanTaskTemplateEditsRef = makeFunctionReference<
  "mutation",
  { token: string; planId: Id<"eventPlans"> },
  null
>("functions/scheduling/planTemplates:revertPlanTaskTemplateEdits");

export const revertPlanRunSheetTemplateEditsRef = makeFunctionReference<
  "mutation",
  { token: string; planId: Id<"eventPlans"> },
  null
>("functions/scheduling/planTemplates:revertPlanRunSheetTemplateEdits");
