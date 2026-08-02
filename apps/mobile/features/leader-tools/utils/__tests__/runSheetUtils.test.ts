import { assigneeLabels } from "../runSheetUtils";

/**
 * The run sheet is one of the serving-mode surfaces that must include
 * assigned-but-unconfirmed volunteers and MARK them (see "Include unconfirmed
 * volunteers in serving mode"). Declined people stay hidden everywhere.
 */
const person = (userName: string, status: string) => ({ userName, status });

describe("assigneeLabels", () => {
  it("shows a confirmed assignee with no marker", () => {
    expect(assigneeLabels([person("Ada", "confirmed")])).toEqual(["Ada"]);
  });

  it("marks an unconfirmed assignee", () => {
    expect(assigneeLabels([person("Ada", "unconfirmed")])).toEqual([
      "Ada (Unconfirmed)",
    ]);
  });

  // Capitalised to match the "Unconfirmed" pill/text signifier the serving
  // screens already use — the run sheet must not invent a second spelling.
  it("uses the same capitalised signifier as the serving screens", () => {
    const [label] = assigneeLabels([person("Ada", "unconfirmed")]);
    expect(label).toContain("Unconfirmed");
  });

  // `status` is a plain string column, so an unexpected value must fail safe:
  // shown (not hidden like "declined") and flagged (not passed off as confirmed).
  it("treats an unrecognised status as not yet accepted", () => {
    expect(assigneeLabels([person("Ada", "invited")])).toEqual([
      "Ada (Unconfirmed)",
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
    expect(labels).toEqual(["Ada", "Bo (Unconfirmed)", "Di"]);
  });

  // The run sheet reads from a stale AsyncStorage cache when offline, and that
  // payload is cast rather than validated — a blob written by an older build can
  // arrive without `status`. Same fail-safe as an unrecognised status: flagged,
  // never silently presented as confirmed.
  it("flags an assignee whose status is missing entirely", () => {
    expect(assigneeLabels([{ userName: "Ada" } as never])).toEqual([
      "Ada (Unconfirmed)",
    ]);
  });

  it("returns nothing for an unfilled role", () => {
    expect(assigneeLabels([])).toEqual([]);
  });

  // The chip renders these comma-joined on ONE truncating line, so the joined
  // string — not the array — is what a leader actually reads. Pinned here to
  // keep the cost of the marker visible: it competes with the names it qualifies.
  it("joins into a chip line where markers cost room for names", () => {
    const labels = assigneeLabels([
      person("Ada", "unconfirmed"),
      person("Bo", "unconfirmed"),
      person("Cy", "confirmed"),
    ]);
    expect(labels.join(", ")).toBe("Ada (Unconfirmed), Bo (Unconfirmed), Cy");
  });
});
