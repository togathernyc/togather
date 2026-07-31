import {
  diagnoseMineEmpty,
  mineEmptyCopy,
  myRoleNamesFromCrew,
  planTaskCountFromAllTeams,
  shouldOfferSharedJump,
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

  // Shared was the one fact defaulted to 0 instead of treated as unloaded, so a
  // `role-mismatch` viewer whose team DOES have shared tasks got the wrong hint
  // and no "Open Shared" button — popping in on first paint, and (offline, with
  // that section never cached) staying wrong for the whole session.
  it("loading: refuses to guess while the shared count is unresolved", () => {
    expect(diagnoseMineEmpty(facts({ sharedTaskCount: null }))).toBe("loading");
  });

  it("has-tasks still wins over an unresolved shared count", () => {
    expect(
      diagnoseMineEmpty(facts({ myTemplateTaskCount: 1, sharedTaskCount: null })),
    ).toBe("has-tasks");
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

  // This state is essentially only reachable when the viewer's assignment is
  // REMOVED or DECLINED while the screen is open — so "ask your team lead to
  // add you to the roster" was wrong for whoever had just declined it.
  it("not-rostered names both ways the assignment can vanish, and neither wrongly", () => {
    const copy = mineEmptyCopy(
      "not-rostered",
      facts({ planTaskCount: 7, myRoleNames: [] }),
    )!;
    expect(copy.title).toBe("You're not on the roster for this event.");
    expect(copy.hint).toContain("your assignment was removed, or you declined it");
    expect(copy.hint).toContain("check with your team lead");
    expect(copy.hint).not.toContain("add you to the roster");
  });

  // `planTaskCount` is PLAN-wide across every team, so leading the headline
  // with it read as "5 tasks exist and you were skipped" to a volunteer whose
  // OWN team authored none — pointing at a non-problem. The count stays (it is
  // useful) but is explicitly scoped, and the actionable instruction is back.
  it("role-mismatch scopes the count to all teams and names a next step", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCount: 5, myRoleNames: ["Greeter", "Usher"] }),
    )!;
    expect(copy.title).toBe(
      "None of this event's tasks are assigned to your roles.",
    );
    expect(copy.hint).toContain("You're serving as Greeter and Usher.");
    expect(copy.hint).toContain("Its 5 tasks — across all teams — are for other roles.");
    expect(copy.hint).toContain("Ask your team lead to add tasks for your roles.");
  });

  it("role-mismatch uses the singular for one task and one role", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ planTaskCount: 1, myRoleNames: ["Greeter"] }),
    )!;
    expect(copy.title).toBe(
      "None of this event's tasks are assigned to your role.",
    );
    expect(copy.hint).toContain("You're serving as Greeter.");
    expect(copy.hint).toContain("Its 1 task — across all teams — is for other roles.");
    expect(copy.hint).toContain("Ask your team lead to add tasks for your role.");
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

  it("says nothing at all about Shared while its count is unresolved", () => {
    const copy = mineEmptyCopy(
      "role-mismatch",
      facts({ sharedTaskCount: null }),
    )!;
    expect(copy.hint).not.toContain("Shared");
    expect(copy.hint).not.toContain("All teams");
  });
});

/**
 * The jump is a POINTER, so it must only appear where Shared is a real answer.
 * Offering it on `no-plan-tasks` let a stale-cache mix render "This event has no
 * tasks set up yet." directly above "Open Shared (2)".
 */
describe("shouldOfferSharedJump", () => {
  it("offers the jump on a role mismatch with shared tasks", () => {
    expect(
      shouldOfferSharedJump("role-mismatch", facts({ sharedTaskCount: 2 })),
    ).toBe(true);
  });

  it("offers the jump to an unrostered viewer with shared tasks", () => {
    expect(
      shouldOfferSharedJump(
        "not-rostered",
        facts({ myRoleNames: [], sharedTaskCount: 2 }),
      ),
    ).toBe(true);
  });

  it("NEVER offers it alongside 'this event has no tasks set up yet'", () => {
    expect(
      shouldOfferSharedJump(
        "no-plan-tasks",
        facts({ planTaskCount: 0, sharedTaskCount: 2 }),
      ),
    ).toBe(false);
  });

  it("withholds it while the shared count is unresolved", () => {
    expect(
      shouldOfferSharedJump("role-mismatch", facts({ sharedTaskCount: null })),
    ).toBe(false);
  });

  it("withholds it when the team has no shared tasks", () => {
    expect(
      shouldOfferSharedJump("role-mismatch", facts({ sharedTaskCount: 0 })),
    ).toBe(false);
  });

  it("renders no jump for the states that render no notice", () => {
    expect(
      shouldOfferSharedJump("has-tasks", facts({ sharedTaskCount: 2 })),
    ).toBe(false);
    expect(shouldOfferSharedJump("loading", facts({ sharedTaskCount: 2 }))).toBe(
      false,
    );
  });
});
