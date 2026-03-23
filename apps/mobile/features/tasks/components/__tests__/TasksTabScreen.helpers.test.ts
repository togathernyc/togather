import { buildTaskRows, parseTagsInput } from "../taskHelpers";

describe("TasksTabScreen helpers", () => {
  test("parseTagsInput trims, drops empty tags, and keeps order", () => {
    expect(parseTagsInput(" care , prayer_request, , follow up ")).toEqual([
      "care",
      "prayer_request",
      "follow up",
    ]);
  });

  test("buildTaskRows filters out subtasks whose parent is in the list", () => {
    const parentId = "task_parent";
    const childId = "task_child";

    const tasks = [
      {
        _id: parentId,
        title: "Parent",
        status: "open",
        sourceType: "manual",
        groupId: "group_1",
        targetType: "none",
      },
      {
        _id: childId,
        title: "Child",
        status: "open",
        sourceType: "manual",
        groupId: "group_1",
        targetType: "none",
        parentTaskId: parentId,
      },
    ];

    const rows = buildTaskRows(tasks);
    // Only root-level tasks are emitted; subtasks render inside parent card
    expect(rows).toHaveLength(1);
    expect(rows[0].task._id).toBe(parentId);
  });

  test("buildTaskRows keeps orphaned subtasks whose parent is not in the list", () => {
    const childId = "task_child";

    const tasks = [
      {
        _id: childId,
        title: "Orphan Child",
        status: "open",
        sourceType: "manual",
        groupId: "group_1",
        targetType: "none",
        parentTaskId: "missing_parent",
      },
    ];

    const rows = buildTaskRows(tasks);
    expect(rows).toHaveLength(1);
    expect(rows[0].task._id).toBe(childId);
  });
});
