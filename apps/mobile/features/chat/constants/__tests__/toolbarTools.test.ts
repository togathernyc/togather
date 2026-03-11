import { DEFAULT_TOOLS, TOOLBAR_TOOLS } from "../toolbarTools";

describe("toolbar tools", () => {
  test("includes tasks tool metadata", () => {
    expect(TOOLBAR_TOOLS.tasks).toEqual({
      id: "tasks",
      icon: "checkmark-done-outline",
      label: "Tasks",
    });
  });

  test("shows tasks in default tool order", () => {
    expect(DEFAULT_TOOLS).toContain("tasks");
    expect(DEFAULT_TOOLS.indexOf("tasks")).toBeLessThan(
      DEFAULT_TOOLS.indexOf("events"),
    );
  });
});
