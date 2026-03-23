import type { Id } from "@services/api/convex";

export type TaskSourceType =
  | "manual"
  | "bot_task_reminder"
  | "reach_out"
  | "followup"
  | "workflow_template";
export type TargetType = "none" | "member" | "group";

export type SubtaskItem = {
  _id: string;
  title: string;
  status: string;
  assignedToName?: string;
};

export type TaskListItem = {
  _id: Id<"tasks">;
  title: string;
  description?: string;
  status: string;
  sourceType: TaskSourceType;
  groupName?: string;
  groupId: Id<"groups">;
  assignedToId?: Id<"users">;
  assignedToName?: string;
  targetType: TargetType;
  targetMemberId?: Id<"users">;
  targetMemberName?: string;
  targetGroupId?: Id<"groups">;
  targetGroupName?: string;
  tags?: string[];
  parentTaskId?: Id<"tasks">;
  subtaskProgress?: { total: number; completed: number } | null;
  subtasks?: SubtaskItem[];
};

export type TaskRow = {
  task: TaskListItem;
};

export function parseTagsInput(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/**
 * Build flat task rows — subtasks are rendered inline inside their parent card,
 * so we only emit root-level tasks (and orphaned subtasks whose parent isn't
 * in the current list).
 */
export function buildTaskRows(
  tasks: TaskListItem[],
): TaskRow[] {
  const taskById = new Set(tasks.map((task) => task._id.toString()));

  return tasks
    .filter((task) => {
      const parentKey = task.parentTaskId?.toString();
      // Keep root tasks and orphaned subtasks (parent not in list)
      return !parentKey || !taskById.has(parentKey);
    })
    .map((task) => ({ task }));
}
