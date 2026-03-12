import { buildTaskRows, parseTagsInput, type TaskListItem } from "../taskHelpers";

describe("TasksTabScreen helpers", () => {
  test("parseTagsInput trims, drops empty tags, and keeps order", () => {
    expect(parseTagsInput(" care , prayer_request, , follow up ")).toEqual([
      "care",
      "prayer_request",
      "follow up",
    ]);
  });

  test("buildTaskRows only expands children for expanded parents", () => {
    const parentId = "task_parent";
    const childId = "task_child";

    const tasks: TaskListItem[] = [
      {
        _id: parentId as TaskListItem["_id"],
        title: "Parent",
        status: "open",
        sourceType: "manual",
        groupId: "group_1" as TaskListItem["groupId"],
        targetType: "none",
      },
      {
        _id: childId as TaskListItem["_id"],
        title: "Child",
        status: "open",
        sourceType: "manual",
        groupId: "group_1" as TaskListItem["groupId"],
        targetType: "none",
        parentTaskId: parentId as TaskListItem["parentTaskId"],
      },
    ];

    const collapsedRows = buildTaskRows(tasks, new Set());
    expect(collapsedRows).toHaveLength(1);
    expect(collapsedRows[0].task._id).toBe(parentId);
    expect(collapsedRows[0].hasChildren).toBe(true);

    const expandedRows = buildTaskRows(tasks, new Set([parentId]));
    expect(expandedRows).toHaveLength(2);
    expect(expandedRows[1].task._id).toBe(childId);
    expect(expandedRows[1].depth).toBe(1);
  });
});
