/**
 * Typed function references for the plan ↔ template linkage backend (Phase 3).
 *
 * Same rationale as `eventTemplates.ts`: the committed `_generated/api.d.ts` can
 * lag offline, so we build references directly from function paths with
 * `makeFunctionReference`, asserting the exact arg/return types from the
 * validators in `functions/scheduling/planTemplates.ts`. Phase 3 is
 * backend-only — these refs exist so the Phase 4 UI can call the mutations.
 */
import { makeFunctionReference } from "convex/server";
import type { Id } from "@services/api/convex";

/** How to treat the user's edited/added rows when linking/switching a template. */
export type TemplateCarryover = "discard" | "copy";

// ============================================================================
// Read-side state for the event editor
// ============================================================================

/** The plan's template-linkage state, as returned by `getPlanTemplateState`. */
export type PlanTemplateState = {
  taskTemplateId: Id<"eventTaskTemplates"> | null;
  taskTemplateName: string | null;
  hasTaskTemplateEdits: boolean;
  runSheetTemplateId: Id<"runSheetTemplates"> | null;
  runSheetTemplateName: string | null;
  hasRunSheetTemplateEdits: boolean;
  isPast: boolean;
};

export const getPlanTemplateStateRef = makeFunctionReference<
  "query",
  { token: string; planId: Id<"eventPlans"> },
  PlanTemplateState
>("functions/scheduling/planTemplates:getPlanTemplateState");

/** How an existing template absorbs a plan's list on save. */
export type SaveTemplateStrategy = "replace" | "merge";

// ============================================================================
// Link / switch / unlink
// ============================================================================

export const setPlanTaskTemplateRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    planId: Id<"eventPlans">;
    templateId: Id<"eventTaskTemplates"> | null;
    carryover?: TemplateCarryover;
  },
  { planId: Id<"eventPlans">; templateId: Id<"eventTaskTemplates"> | null }
>("functions/scheduling/planTemplates:setPlanTaskTemplate");

export const setPlanRunSheetTemplateRef = makeFunctionReference<
  "mutation",
  {
    token: string;
    planId: Id<"eventPlans">;
    templateId: Id<"runSheetTemplates"> | null;
    carryover?: TemplateCarryover;
  },
  { planId: Id<"eventPlans">; templateId: Id<"runSheetTemplates"> | null }
>("functions/scheduling/planTemplates:setPlanRunSheetTemplate");

// ============================================================================
// Save a plan's current list AS a template
// ============================================================================

export type SaveTaskTemplateMode =
  | { kind: "new"; name: string }
  | {
      kind: "existing";
      templateId: Id<"eventTaskTemplates">;
      strategy: SaveTemplateStrategy;
    };

export const saveTaskTemplateFromPlanRef = makeFunctionReference<
  "mutation",
  { token: string; planId: Id<"eventPlans">; mode: SaveTaskTemplateMode },
  { templateId: Id<"eventTaskTemplates"> }
>("functions/scheduling/planTemplates:saveTaskTemplateFromPlan");

export type SaveRunSheetTemplateMode =
  | { kind: "new"; name: string }
  | {
      kind: "existing";
      templateId: Id<"runSheetTemplates">;
      strategy: SaveTemplateStrategy;
    };

export const saveRunSheetTemplateFromPlanRef = makeFunctionReference<
  "mutation",
  { token: string; planId: Id<"eventPlans">; mode: SaveRunSheetTemplateMode },
  { templateId: Id<"runSheetTemplates"> }
>("functions/scheduling/planTemplates:saveRunSheetTemplateFromPlan");

// ============================================================================
// Revert a plan's edits back to its linked template
// ============================================================================

export const revertPlanTaskTemplateEditsRef = makeFunctionReference<
  "mutation",
  { token: string; planId: Id<"eventPlans"> },
  { reverted: boolean }
>("functions/scheduling/planTemplates:revertPlanTaskTemplateEdits");

export const revertPlanRunSheetTemplateEditsRef = makeFunctionReference<
  "mutation",
  { token: string; planId: Id<"eventPlans"> },
  { reverted: boolean }
>("functions/scheduling/planTemplates:revertPlanRunSheetTemplateEdits");
