import { assigneeLabels } from "../runSheetUtils";

/**
 * The run sheet is one of the serving-mode surfaces that must include
 * assigned-but-unconfirmed volunteers and MARK them (see "Include unconfirmed
 * volunteers in serving mode"). Declined people stay hidden everywhere.
 */
const person = (userName: string, status: string) => ({ userName, status });

describe("run sheet assignee labels", () => {
  it("shows a confirmed assignee with no marker", () => {
    expect(assigneeLabels([person("Ada", "confirmed")])).toEqual(["Ada"]);
  });

  it("marks an unconfirmed assignee", () => {
    expect(assigneeLabels([person("Ada", "unconfirmed")])).toEqual([
      "Ada (unconfirmed)",
    ]);
  });

  it("hides declined assignees entirely", () => {
    expect(assigneeLabels([person("Ada", "declined")])).toEqual([]);
  });

  it("keeps roster order and marks only the unconfirmed ones", () => {
    const labels = assigneeLabels([
      person("Ada", "confirmed"),
      person("Bo", "unconfirmed"),
      person("Cy", "declined"),
      person("Di", "confirmed"),
    ]);
    expect(labels).toEqual(["Ada", "Bo (unconfirmed)", "Di"]);
  });

  it("returns nothing for an unfilled role", () => {
    expect(assigneeLabels([])).toEqual([]);
  });
});
