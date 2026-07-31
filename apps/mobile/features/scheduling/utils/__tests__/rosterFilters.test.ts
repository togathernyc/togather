import {
  memberInTeamScope,
  memberNeedsAvailability,
  type RosterFilterCell,
} from "../rosterFilters";

const roleTeamMap = new Map<string, string>([
  ["role-drums", "team-worship"],
  ["role-keys", "team-worship"],
  ["role-greeter", "team-hospitality"],
]);

describe("memberInTeamScope", () => {
  it("matches a member assigned to a role on a team within scope", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "available", assignments: [{ roleId: "role-drums" }] },
    };
    expect(
      memberInTeamScope(cells, new Set(["team-worship"]), roleTeamMap),
    ).toBe(true);
  });

  it("excludes a member whose only assignment is on an out-of-scope team", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "available", assignments: [{ roleId: "role-greeter" }] },
    };
    expect(
      memberInTeamScope(cells, new Set(["team-worship"]), roleTeamMap),
    ).toBe(false);
  });

  it("excludes a member with no assignments at all when a scope is set", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "no_response", assignments: [] },
    };
    expect(
      memberInTeamScope(cells, new Set(["team-worship"]), roleTeamMap),
    ).toBe(false);
  });

  it("matches on ANY visible cell, not just the first", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "no_response", assignments: [] },
      plan2: { availability: "available", assignments: [{ roleId: "role-keys" }] },
    };
    expect(
      memberInTeamScope(cells, new Set(["team-worship"]), roleTeamMap),
    ).toBe(true);
  });

  // "All teams" / a leader-admin who manages no team here (RosterGridScreen
  // resolves `visibleTeamIds` to null in both cases) — never locked out.
  it("null visibleTeamIds (leader/admin default, or All teams) matches everyone", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "no_response", assignments: [] },
    };
    expect(memberInTeamScope(cells, null, roleTeamMap)).toBe(true);

    const assignedElsewhere: Record<string, RosterFilterCell> = {
      plan1: { availability: "available", assignments: [{ roleId: "role-greeter" }] },
    };
    expect(memberInTeamScope(assignedElsewhere, null, roleTeamMap)).toBe(true);
  });
});

describe("memberNeedsAvailability", () => {
  it("matches a member with a no_response cell on a visible event", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "no_response", assignments: [] },
    };
    expect(memberNeedsAvailability(cells, ["plan1"])).toBe(true);
  });

  it("excludes a member who marked available", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "available", assignments: [] },
    };
    expect(memberNeedsAvailability(cells, ["plan1"])).toBe(false);
  });

  it("excludes a member who marked unavailable (they DID respond)", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "unavailable", assignments: [] },
    };
    expect(memberNeedsAvailability(cells, ["plan1"])).toBe(false);
  });

  it("matches if ANY visible event is unanswered, even if others aren't", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "available", assignments: [] },
      plan2: { availability: "no_response", assignments: [] },
    };
    expect(memberNeedsAvailability(cells, ["plan1", "plan2"])).toBe(true);
  });

  it("treats a missing cell (event outside the member's map) as no_response", () => {
    const cells: Record<string, RosterFilterCell> = {};
    expect(memberNeedsAvailability(cells, ["plan1"])).toBe(true);
  });
});

describe("combined team scope + needs-availability (the composed workflow)", () => {
  it("a person on scope AND unanswered matches both filters", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "no_response", assignments: [] },
      plan2: { availability: "available", assignments: [{ roleId: "role-drums" }] },
    };
    expect(
      memberInTeamScope(cells, new Set(["team-worship"]), roleTeamMap),
    ).toBe(true);
    expect(memberNeedsAvailability(cells, ["plan1", "plan2"])).toBe(true);
  });

  it("a person off-scope but unanswered is still filtered out by scope", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "no_response", assignments: [{ roleId: "role-greeter" }] },
    };
    expect(
      memberInTeamScope(cells, new Set(["team-worship"]), roleTeamMap),
    ).toBe(false);
    expect(memberNeedsAvailability(cells, ["plan1"])).toBe(true);
  });

  it("a person in-scope but fully answered is filtered out by availability", () => {
    const cells: Record<string, RosterFilterCell> = {
      plan1: { availability: "available", assignments: [{ roleId: "role-drums" }] },
    };
    expect(
      memberInTeamScope(cells, new Set(["team-worship"]), roleTeamMap),
    ).toBe(true);
    expect(memberNeedsAvailability(cells, ["plan1"])).toBe(false);
  });
});
