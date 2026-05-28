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
    expect(DEFAULT_TOOLS).toEqual(["attendance"]);
  });

  test("retires the bots, events, and followup chips — all live elsewhere now", () => {
    expect(DEFAULT_TOOLS).not.toContain("bots");
    expect(DEFAULT_TOOLS).not.toContain("events");
    expect(DEFAULT_TOOLS).not.toContain("followup");
    expect(TOOLBAR_TOOLS as Record<string, unknown>).not.toHaveProperty("bots");
    expect(TOOLBAR_TOOLS as Record<string, unknown>).not.toHaveProperty("events");
    expect(TOOLBAR_TOOLS as Record<string, unknown>).not.toHaveProperty("followup");
  });
});
