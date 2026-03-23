import type { Id } from "@services/api/convex";

export type TaskSourceType =
  | "manual"
  | "bot_task_reminder"
  | "reach_out"
  | "followup"
  | "workflow_template";
export type TargetType = "none" | "member" | "group";

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
};

export type TaskRow = {
  task: TaskListItem;
  depth: number;
  hasChildren: boolean;
};

export function parseTagsInput(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function buildTaskRows(
  tasks: TaskListItem[],
  expandedParents: Set<string>,
): TaskRow[] {
  const taskById = new Map(tasks.map((task) => [task._id.toString(), task]));
  const childrenMap = new Map<string, TaskListItem[]>();

  for (const task of tasks) {
    const parentKey = task.parentTaskId?.toString();
    if (!parentKey || !taskById.has(parentKey)) continue;
    const current = childrenMap.get(parentKey) ?? [];
    current.push(task);
    childrenMap.set(parentKey, current);
  }

  const rows: TaskRow[] = [];
  const roots = tasks.filter((task) => {
    const parentKey = task.parentTaskId?.toString();
    return !parentKey || !taskById.has(parentKey);
  });

  const walk = (task: TaskListItem, depth: number) => {
    const taskId = task._id.toString();
    const children = childrenMap.get(taskId) ?? [];
    rows.push({ task, depth, hasChildren: children.length > 0 });
    if (children.length > 0 && expandedParents.has(taskId)) {
      children.forEach((child) => walk(child, depth + 1));
    }
  };

  roots.forEach((task) => walk(task, 0));
  return rows;
}
