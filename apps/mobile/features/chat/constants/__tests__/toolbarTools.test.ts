import { DEFAULT_TOOLS, TOOLBAR_TOOLS } from "../toolbarTools";

describe("toolbar tools", () => {
  test("includes tasks tool metadata", () => {
    expect(TOOLBAR_TOOLS.tasks).toEqual({
      id: "tasks",
      icon: "checkmark-done-outline",
      label: "Tasks",
    });
  });

  test("hides tasks from default tools until enabled", () => {
    expect(DEFAULT_TOOLS).not.toContain("tasks");
    expect(DEFAULT_TOOLS).toEqual(["attendance", "followup", "events", "bots"]);
  });
});
