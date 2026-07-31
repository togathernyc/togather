import {
  diagnoseMineEmpty,
  mineEmptyCopy,
  myRoleNamesFromCrew,
  planTaskCountFromAllTeams,
  type MineEmptyFacts,
} from "../servingTaskEmptyState";

/** Loaded, rostered, task-bearing baseline; each test overrides one fact. */
function facts(overrides: Partial<MineEmptyFacts> = {}): MineEmptyFacts {
  return {
    planTaskCount: 4,
    myRoleNames: ["Greeter"],
    myTemplateTaskCount: 0,
    sharedTaskCount: 0,
    ...overrides,
  };
}

describe("planTaskCountFromAllTeams", () => {
  it("returns null while the query is unresolved", () => {
    expect(planTaskCountFromAllTeams(undefined)).toBeNull();
  });

  it("returns 0 for a plan with no teams and no tasks", () => {
    expect(planTaskCountFromAllTeams([])).toBe(0);
    expect(planTaskCountFromAllTeams([{ tasks: [] }])).toBe(0);
  });

  it("counts a multi-team task ONCE (rows are per team, not per task)", () => {
    // `getAllTeamsTasks` lists a task under every team it spans, so summing
    // each team's `taskCount` would over-count. Distinct taskIds is the truth.
    const count = planTaskCountFromAllTeams([
      { tasks: [{ taskId: "t1" }, { taskId: "t2" }] },
      { tasks: [{ taskId: "t1" }, { taskId: "t3" }] },
    ]);
    expect(count).toBe(3);
  });
});

describe("myRoleNamesFromCrew", () => {
  it("returns null while the query is unresolved", () => {
    expect(myRoleNamesFromCrew(undefined)).toBeNull();
  });

  it("returns [] when the viewer holds no non-declined assignment", () => {
    // `getCrewTasks` short-circuits to [] in exactly that case.
    expect(myRoleNamesFromCrew([])).toEqual([]);
  });

  it("keeps only the viewer's own rows, de-duplicated, in order", () => {
    const names = myRoleNamesFromCrew([
      { isCurrentUser: true, roleName: "Greeter" },
      { isCurrentUser: false, roleName: "Camera 1" },
      { isCurrentUser: true, roleName: "Usher" },
      { isCurrentUser: true, roleName: "Greeter" },
    ]);
    expect(names).toEqual(["Greeter", "Usher"]);
  });
});

describe("diagnoseMineEmpty", () => {
  it("has-tasks: the viewer has preloaded tasks, so nothing is explained", () => {
    expect(diagnoseMineEmpty(facts({ myTemplateTaskCount: 2 }))).toBe(
      "has-tasks",
    );
  });

  it("has-tasks wins even before the other queries resolve", () => {
    expect(
      diagnoseMineEmpty(
        facts({ myTemplateTaskCount: 1, planTaskCount: null, myRoleNames: null }),
      ),
    ).toBe("has-tasks");
  });

  it("loading: refuses to guess while the plan-wide count is unresolved", () => {
    expect(diagnoseMineEmpty(facts({ planTaskCount: null }))).toBe("loading");
  });

  it("loading: refuses to guess while the viewer's roles are unresolved", () => {
    expect(diagnoseMineEmpty(facts({ myRoleNames: null }))).toBe("loading");
  });

  it("no-plan-tasks: the plan has zero eventTasks rows", () => {
    expect(diagnoseMineEmpty(facts({ planTaskCount: 0 }))).toBe(
      "no-plan-tasks",
    );
  });

  it("no-plan-tasks outranks not-rostered when both are true", () => {
    // A freshly created plan is BOTH empty and (often) unrostered. The empty
    // task list is the root cause: fixing the roster would change nothing.
    expect(
      diagnoseMineEmpty(facts({ planTaskCount: 0, myRoleNames: [] })),
    ).toBe("no-plan-tasks");
  });

  it("not-rostered: tasks exist but the viewer holds no role on the plan", () => {
    expect(diagnoseMineEmpty(facts({ myRoleNames: [] }))).toBe("not-rostered");
  });

  it("role-mismatch: tasks exist, the viewer has roles, none match", () => {
    expect(diagnoseMineEmpty(facts())).toBe("role-mismatch");
  });

  it("role-mismatch covers the team-level-only plan (all tasks on Shared)", () => {
    // Every task is team-level, so `getMyServingTasks` returns none while
    // `getSharedTeamTasks` returns them all.
    expect(
      diagnoseMineEmpty(facts({ planTaskCount: 3, sharedTaskCount: 3 })),
    ).toBe("role-mismatch");
  });
});

describe("mineEmptyCopy", () => {
  it("renders no notice for has-tasks or loading", () => {
    expect(mineEmptyCopy("has-tasks", facts())).toBeNull();
    expect(mineEmptyCopy("loading", facts())).toBeNull();
  });

  it("no-plan-tasks does NOT blame the team lead's configuration", () => {
    const copy = mineEmptyCopy("no-plan-tasks", facts({ planTaskCount: 0 }))!;
    expect(copy.title).toBe("This event has no tasks set up yet.");
    expect(copy.hint).toContain("Nobody has added tasks to it");
    expect(copy.hint).toContain("add your own tasks below");
  });

  it("not-rostered names the rostering gap and quotes the plan's task count", () => {
    const copy = mineEmptyCopy(
      "not-rostered",
      facts({ planTaskCount: 7, myRoleNames: [] }),
    )!;
    expect(copy.title).toBe("You're not on the roster for this event.");
    expect(copy.hint).toContain("7 tasks");
    expect(copy.hint).toContain("add you to the roster");
  });

  it("role-mismatch quotes the task count and names the roles actually held", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCount: 5, myRoleNames: ["Greeter", "Usher"] }),
    )!;
    expect(copy.title).toBe(
      "This event has 5 tasks, but none are assigned to your roles.",
    );
    expect(copy.hint).toContain("You're serving as Greeter and Usher.");
  });

  it("role-mismatch uses the singular for one task and one role", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCount: 1, myRoleNames: ["Greeter"] }),
    )!;
    expect(copy.title).toBe(
      "This event has 1 task, but none are assigned to your role.",
    );
    expect(copy.hint).toContain("You're serving as Greeter.");
  });

  it("role-mismatch points at Shared when the team has shared tasks", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCount: 5, sharedTaskCount: 3 }),
    )!;
    expect(copy.hint).toContain("Shared has 3 tasks for your whole team.");
  });

  it("role-mismatch points at All teams when there are no shared tasks", () => {
    const copy = mineEmptyCopy("role-mismatch", facts({ sharedTaskCount: 0 }))!;
    expect(copy.hint).toContain("Check All teams");
  });

  it("lists three or more roles with commas and a trailing 'and'", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ myRoleNames: ["Camera 1", "Greeter", "Usher"] }),
    )!;
    expect(copy.hint).toContain("You're serving as Camera 1, Greeter and Usher.");
  });
});
