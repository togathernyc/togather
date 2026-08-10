/**
 * Tests for gridColumnWidths Zustand store
 */
import { useGridColumnWidths } from "../gridColumnWidths";

describe("gridColumnWidths", () => {
  beforeEach(() => {
    useGridColumnWidths.getState().clearAll();
  });

  it("stores and retrieves a column width by grid", () => {
    useGridColumnWidths.getState().setWidth("runSheet", "item", 320);
    expect(useGridColumnWidths.getState().getGridWidths("runSheet")).toEqual({
      item: 320,
    });
  });

  it("keeps grids and columns separate", () => {
    useGridColumnWidths.getState().setWidth("runSheet", "item", 320);
    useGridColumnWidths.getState().setWidth("runSheet", "notes", 400);
    useGridColumnWidths.getState().setWidth("eventTasks", "task", 260);

    expect(useGridColumnWidths.getState().getGridWidths("runSheet")).toEqual({
      item: 320,
      notes: 400,
    });
    expect(useGridColumnWidths.getState().getGridWidths("eventTasks")).toEqual({
      task: 260,
    });
  });

  it("overwrites a column's previous width", () => {
    useGridColumnWidths.getState().setWidth("runSheet", "item", 320);
    useGridColumnWidths.getState().setWidth("runSheet", "item", 200);
    expect(
      useGridColumnWidths.getState().getGridWidths("runSheet").item,
    ).toBe(200);
  });

  it("returns an empty object for a grid with no overrides", () => {
    expect(useGridColumnWidths.getState().getGridWidths("missing")).toEqual({});
  });

  it("resets a single column without touching its siblings", () => {
    useGridColumnWidths.getState().setWidth("runSheet", "item", 320);
    useGridColumnWidths.getState().setWidth("runSheet", "notes", 400);
    useGridColumnWidths.getState().resetColumn("runSheet", "item");
    expect(useGridColumnWidths.getState().getGridWidths("runSheet")).toEqual({
      notes: 400,
    });
  });

  it("reset is a no-op for an unknown column", () => {
    useGridColumnWidths.getState().setWidth("runSheet", "item", 320);
    useGridColumnWidths.getState().resetColumn("runSheet", "notes");
    useGridColumnWidths.getState().resetColumn("other", "item");
    expect(useGridColumnWidths.getState().getGridWidths("runSheet")).toEqual({
      item: 320,
    });
  });

  it("clears everything", () => {
    useGridColumnWidths.getState().setWidth("runSheet", "item", 320);
    useGridColumnWidths.getState().setWidth("eventTasks", "task", 260);
    useGridColumnWidths.getState().clearAll();
    expect(useGridColumnWidths.getState().getGridWidths("runSheet")).toEqual({});
    expect(useGridColumnWidths.getState().getGridWidths("eventTasks")).toEqual(
      {},
    );
  });
});
