// Stub signatures for the Event Tasks feature — real logic lands in Agent A's pass.

import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";

/** When a task happens relative to the event's service times. */
const segmentValidator = v.union(
  v.literal("before"),
  v.literal("during"),
  v.literal("after"),
);

/** The kind of "how to" guidance attached to a task. */
const howToTypeValidator = v.union(
  v.literal("none"),
  v.literal("text"),
  v.literal("link"),
  v.literal("media"),
  v.literal("doc"),
);

/**
 * List all tasks for a plan (across teams/segments). Real hydration (team/role
 * names, completion state) lands in Agent A's pass.
 */
export const listPlanTasks = query({
  args: { planId: v.id("eventPlans") },
  handler: async (_ctx, _args) => {
    return [];
  },
});

/** Create a task on a plan. */
export const createTask = mutation({
  args: {
    planId: v.id("eventPlans"),
    teamId: v.id("teams"),
    roleId: v.optional(v.id("teamRoles")),
    segment: segmentValidator,
    title: v.string(),
    howToType: howToTypeValidator,
    howToText: v.optional(v.string()),
    howToUrl: v.optional(v.string()),
    howToMediaPath: v.optional(v.string()),
    howToDoc: v.optional(v.string()),
  },
  handler: async (_ctx, _args) => {
    return null;
  },
});

/** Update a task's editable fields. Only provided fields change. */
export const updateTask = mutation({
  args: {
    taskId: v.id("eventTasks"),
    title: v.optional(v.string()),
    roleId: v.optional(v.id("teamRoles")),
    segment: v.optional(segmentValidator),
    howToType: v.optional(howToTypeValidator),
    howToText: v.optional(v.string()),
    howToUrl: v.optional(v.string()),
    howToMediaPath: v.optional(v.string()),
    howToDoc: v.optional(v.string()),
  },
  handler: async (_ctx, _args) => {
    return null;
  },
});

/** Delete a single task. */
export const deleteTask = mutation({
  args: { taskId: v.id("eventTasks") },
  handler: async (_ctx, _args) => {
    return null;
  },
});

/** Reorder a plan's tasks by supplying the full ordered id list. */
export const reorderTasks = mutation({
  args: {
    planId: v.id("eventPlans"),
    orderedIds: v.array(v.id("eventTasks")),
  },
  handler: async (_ctx, _args) => {
    return null;
  },
});

/**
 * Toggle the current user's completion of a task. `timeLabel` is set only for
 * "during" tasks (per service time).
 */
export const toggleTaskCompletion = mutation({
  args: {
    taskId: v.id("eventTasks"),
    timeLabel: v.optional(v.string()),
    completed: v.boolean(),
  },
  handler: async (_ctx, _args) => {
    return null;
  },
});

/**
 * Aggregate readiness for a plan: overall done/total, per-segment, and per-team.
 */
export const getPlanTaskReadiness = query({
  args: { planId: v.id("eventPlans") },
  handler: async (_ctx, _args) => {
    return {
      overall: { done: 0, total: 0 },
      bySegment: {
        before: { done: 0, total: 0 },
        during: { done: 0, total: 0 },
        after: { done: 0, total: 0 },
      },
      byTeam: [] as Array<{
        teamId: string;
        teamName: string;
        done: number;
        total: number;
      }>,
    };
  },
});

/**
 * The current user's serving tasks for a plan, grouped by segment. "during"
 * entries will later be expanded per `timeLabel`.
 *
 * Returned items will later carry an `isPersonal` boolean flag so personal
 * (`personalServingTasks`) and assigned (`eventTasks`) tasks can be merged per
 * segment in the serving UI.
 */
export const getMyServingTasks = query({
  args: { planId: v.id("eventPlans") },
  handler: async (_ctx, _args) => {
    return { before: [], during: [], after: [] };
  },
});

// ============================================================================
// Personal (ad-hoc, single-user) serving tasks — never part of the template.
// ============================================================================

/** Add a personal serving task for the current user on a plan. */
export const addPersonalTask = mutation({
  args: {
    planId: v.id("eventPlans"),
    segment: segmentValidator,
    title: v.string(),
    note: v.optional(v.string()),
    timeLabel: v.optional(v.string()),
  },
  handler: async (_ctx, _args) => {
    return null;
  },
});

/** Update a personal task's editable fields. */
export const updatePersonalTask = mutation({
  args: {
    taskId: v.id("personalServingTasks"),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    segment: v.optional(segmentValidator),
  },
  handler: async (_ctx, _args) => {
    return null;
  },
});

/** Delete a personal task. */
export const deletePersonalTask = mutation({
  args: { taskId: v.id("personalServingTasks") },
  handler: async (_ctx, _args) => {
    return null;
  },
});

/** Toggle inline completion of a personal task for the current user. */
export const togglePersonalTask = mutation({
  args: {
    taskId: v.id("personalServingTasks"),
    completed: v.boolean(),
  },
  handler: async (_ctx, _args) => {
    return null;
  },
});
