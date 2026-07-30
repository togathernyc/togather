import {
  runSheetItemMatchesViewer,
  type ViewerFilterItem,
} from "../runSheetViewerFilter";

describe("runSheetItemMatchesViewer", () => {
  it("matches a single-role item when the viewer holds that role", () => {
    const item: ViewerFilterItem = {
      type: "song",
      assignments: [{ roleId: "role-vocals" }],
    };
    expect(runSheetItemMatchesViewer(item, new Set(["role-vocals"]))).toBe(true);
  });

  it("matches a multi-role item on ANY held role (union)", () => {
    const item: ViewerFilterItem = {
      type: "item",
      assignments: [{ roleId: "role-lighting" }, { roleId: "role-vocals" }],
    };
    expect(runSheetItemMatchesViewer(item, new Set(["role-vocals"]))).toBe(true);
  });

  it("excludes an item whose roles the viewer doesn't hold", () => {
    const item: ViewerFilterItem = {
      type: "song",
      assignments: [{ roleId: "role-broadcast" }],
    };
    expect(runSheetItemMatchesViewer(item, new Set(["role-vocals"]))).toBe(false);
  });

  it("always includes headers, regardless of viewer roles", () => {
    const header: ViewerFilterItem = { type: "header", assignments: [] };
    expect(runSheetItemMatchesViewer(header, new Set())).toBe(true);
    expect(runSheetItemMatchesViewer(header, new Set(["role-vocals"]))).toBe(true);
  });

  it("excludes an unassigned content item even with an empty viewer role set", () => {
    const item: ViewerFilterItem = { type: "item", assignments: [] };
    expect(runSheetItemMatchesViewer(item, new Set())).toBe(false);
  });

  it("excludes every content item when the viewer holds no roles on the plan", () => {
    const item: ViewerFilterItem = {
      type: "song",
      assignments: [{ roleId: "role-vocals" }],
    };
    expect(runSheetItemMatchesViewer(item, new Set())).toBe(false);
  });
});
